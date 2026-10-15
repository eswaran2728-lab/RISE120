-- Phase 5 fix: a rate limit on coach provider starts, separate from the daily message allowance.
--
-- The daily allowance bounds what a free member can spend; it does nothing for a premium member (no daily cap) or
-- for a request id that fails and is retried (failures are free). Both could drive provider cost. This adds an
-- atomic guard inside reserve_coach_request, applied to free and premium alike:
--   * at most coach_rate_limit_attempts provider starts per rolling coach_rate_limit_window_seconds, and
--   * at most coach_max_active_requests provider requests in flight per account.
-- Settings live in app_config (initially 5 per 60 seconds, 1 active) so they can be tuned without a release.
--
-- An "attempt" is a reserve that admits a request to the provider. Every attempt is logged in coach_attempts, one
-- row each, so a known failure retried with the SAME request id still counts (coach_requests has one row per id).
-- The guard runs only for requests that would otherwise reach the provider: a completed id still returns its stored
-- answer, an unfinished id still answers in_progress, and an exhausted daily allowance is still reported as
-- "limited". A rate-limited request creates no request row, logs no attempt and consumes no allowance. The
-- response carries a server-generated retry_at: when the oldest attempt in the window leaves it, or a few seconds
-- ahead when another request is in flight (never later than that request's lease). Lease handling, the
-- slot_taken recheck and unknown-outcome behaviour are unchanged: an expired lease is not "active".

insert into public.app_config (key, value) values
  ('coach_rate_limit_attempts', '5'::jsonb),
  ('coach_rate_limit_window_seconds', '60'::jsonb),
  ('coach_max_active_requests', '1'::jsonb)
on conflict (key) do nothing;

create table public.coach_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  started_at timestamptz not null default clock_timestamp()
);
create index coach_attempts_user_time_idx on public.coach_attempts (user_id, started_at);

alter table public.coach_attempts enable row level security;
revoke all on public.coach_attempts from public, anon, authenticated;

create or replace function private.reserve_coach_request(p_user_id uuid, p_request_id uuid, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.quota_day();
  v_resets timestamptz := ((private.quota_day() + 1)::text || 'T00:00:00Z')::timestamptz;
  r public.coach_requests;
  v_allowance integer;
  v_used integer;
  v_message uuid;
  v_max_attempts integer;
  v_window integer;
  v_max_active integer;
  v_recent integer;
  v_blocking timestamptz;
  v_active integer;
  v_first_lease timestamptz;
  v_retry timestamptz;
  v_reason text;
  v_active_retry_seconds constant integer := 5; -- polling hint while another request is running
begin
  if p_lease_seconds is null or p_lease_seconds <= 0 or p_lease_seconds > 3600 then
    raise exception 'COACH_LEASE_INVALID';
  end if;

  -- One lock per user serializes every coach operation for that account.
  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_user_id::text, 0));

  select * into r from public.coach_requests where user_id = p_user_id and request_id = p_request_id;
  if found then
    if r.status = 'completed' then
      select m.id into v_message from public.coach_messages m where m.user_id = p_user_id and m.request_id = p_request_id;
      return jsonb_build_object('status', 'completed', 'resets_at', v_resets, 'message_id', v_message);
    end if;
    if r.status = 'reserved' then
      return jsonb_build_object('status', 'in_progress', 'resets_at', v_resets);
    end if;
    -- 'failed': the failure was known, so the id may be admitted again below.
  end if;

  if not private.is_premium(p_user_id) then
    v_allowance := private.config_int('free_ai_messages_per_day')
      + coalesce((
          select sum(c.credits)::integer from public.ad_credits c
          where c.user_id = p_user_id and c.reward_type = 'ai' and c.quota_day = v_day
        ), 0);
    select count(*) into v_used
    from public.coach_requests q
    where q.user_id = p_user_id and q.quota_day = v_day and q.request_id <> p_request_id
      and (q.status = 'completed' or (q.status = 'reserved' and q.lease_until > now()));
    if v_used >= v_allowance then
      return jsonb_build_object('status', 'limited', 'resets_at', v_resets);
    end if;
  end if;

  -- Provider-start guard: applies to everyone who would now reach the provider. A missing or invalid setting
  -- fails closed (config_int raises).
  v_max_attempts := private.config_int('coach_rate_limit_attempts');
  v_window := private.config_int('coach_rate_limit_window_seconds');
  v_max_active := private.config_int('coach_max_active_requests');

  select count(*) into v_recent from public.coach_attempts a
  where a.user_id = p_user_id and a.started_at > clock_timestamp() - make_interval(secs => v_window);
  if v_recent >= v_max_attempts then
    -- The earliest moment the count drops below the limit: when the attempt that is now blocking leaves the window.
    select a.started_at into v_blocking from public.coach_attempts a
    where a.user_id = p_user_id and a.started_at > clock_timestamp() - make_interval(secs => v_window)
    order by a.started_at asc offset (v_recent - v_max_attempts) limit 1;
    v_retry := coalesce(v_blocking, clock_timestamp()) + make_interval(secs => v_window);
    v_reason := 'rate';
  end if;

  select count(*), min(q.lease_until) into v_active, v_first_lease from public.coach_requests q
  where q.user_id = p_user_id and q.status = 'reserved' and q.lease_until > now() and q.request_id <> p_request_id;
  if v_active >= v_max_active then
    v_retry := greatest(
      coalesce(v_retry, clock_timestamp()),
      least(coalesce(v_first_lease, clock_timestamp() + make_interval(secs => v_active_retry_seconds)),
            clock_timestamp() + make_interval(secs => v_active_retry_seconds))
    );
    v_reason := coalesce(v_reason, 'active');
  end if;

  if v_reason is not null then
    return jsonb_build_object('status', 'rate_limited', 'resets_at', v_resets, 'retry_at', v_retry, 'reason', v_reason);
  end if;

  insert into public.coach_attempts (user_id, request_id, started_at) values (p_user_id, p_request_id, clock_timestamp());
  delete from public.coach_attempts where user_id = p_user_id and started_at < clock_timestamp() - interval '1 day';

  insert into public.coach_requests (user_id, request_id, quota_day, status, reserved_at, lease_until, updated_at)
  values (p_user_id, p_request_id, v_day, 'reserved', now(), now() + make_interval(secs => p_lease_seconds), now())
  on conflict (user_id, request_id) do update
    set status = 'reserved', quota_day = v_day, reserved_at = now(),
        lease_until = now() + make_interval(secs => p_lease_seconds), completed_at = null, updated_at = now();
  return jsonb_build_object('status', 'reserved', 'resets_at', v_resets);
end;
$$;
