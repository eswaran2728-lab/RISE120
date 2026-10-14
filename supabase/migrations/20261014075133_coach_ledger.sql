-- Phase 5, Task 1: coach ledger and atomic AI allowance.
--
-- coach_requests   one row per (user, client request id): the unit of admission and of charging.
-- coach_messages   the stored exchange (the member's message and the reply) of a completed request.
-- coach_proposals  an optional plan-adjustment proposal stored with the reply (decided in a later task).
--
-- The AI allowance is enforced here, in the database, never by the app:
--   * reserve  admits a request if the user is effectively premium, or if completed requests plus live
--              reservations today are below the allowance (app_config free_ai_messages_per_day plus today's
--              verified AI ad credits). It is serialized per user, so two requests cannot both take the
--              last slot. A missing or invalid config value fails closed.
--   * finish   stores the one reply, marks the request completed and recounts usage_daily.ai_messages. Only a
--              completed, stored reply is charged; a failed request charges nothing, and finishing twice
--              returns the first result without a second charge.
--   * fail     releases a reservation whose failure is KNOWN (no answer exists).
-- A reservation whose outcome is unknown is never retried automatically: the same request id answers
-- "in_progress" until it is finished or failed deliberately. Its slot is held only for a lease (so an
-- abandoned request cannot lock the account); after that the slot frees up but the id stays unresolved.
--
-- Everything is own-read, server-write: clients get select on their own rows and no write privilege, and the
-- functions are callable only by the service role (through the public wrappers below; private is not exposed).

create table public.coach_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  quota_day date not null,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  reserved_at timestamptz not null default now(),
  lease_until timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index coach_requests_user_day_idx on public.coach_requests (user_id, quota_day, status);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id uuid not null,
  message text not null check (char_length(message) between 1 and 4000),
  reply text not null check (char_length(reply) between 1 and 16000),
  language text not null check (language in ('en', 'ms', 'ta')),
  created_at timestamptz not null default now(),
  unique (user_id, request_id),
  foreign key (user_id, request_id) references public.coach_requests (user_id, request_id) on delete cascade
);

create table public.coach_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id uuid not null,
  patch jsonb not null check (jsonb_typeof(patch) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, request_id),
  foreign key (user_id, request_id) references public.coach_requests (user_id, request_id) on delete cascade
);

alter table public.coach_requests enable row level security;
alter table public.coach_messages enable row level security;
alter table public.coach_proposals enable row level security;

create policy "coach_requests_select_own" on public.coach_requests for select to authenticated using (user_id = (select auth.uid()));
create policy "coach_messages_select_own" on public.coach_messages for select to authenticated using (user_id = (select auth.uid()));
create policy "coach_proposals_select_own" on public.coach_proposals for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.coach_requests, public.coach_messages, public.coach_proposals from public, anon, authenticated;
grant select on public.coach_requests, public.coach_messages, public.coach_proposals to authenticated;

-- Reserve a slot for one request. Returns jsonb: status = reserved | completed | in_progress | limited,
-- resets_at (next 00:00 UTC), and message_id when the request already completed.
create function private.reserve_coach_request(p_user_id uuid, p_request_id uuid, p_lease_seconds integer default 120)
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

  insert into public.coach_requests (user_id, request_id, quota_day, status, reserved_at, lease_until, updated_at)
  values (p_user_id, p_request_id, v_day, 'reserved', now(), now() + make_interval(secs => p_lease_seconds), now())
  on conflict (user_id, request_id) do update
    set status = 'reserved', quota_day = v_day, reserved_at = now(),
        lease_until = now() + make_interval(secs => p_lease_seconds), completed_at = null, updated_at = now();
  return jsonb_build_object('status', 'reserved', 'resets_at', v_resets);
end;
$$;

-- Store the one reply for a reserved request and charge it. Returns jsonb: status = completed | not_found |
-- not_reserved, and message_id. Finishing again returns the first result and charges nothing more. An
-- oversized or empty message/reply, or an unknown language, raises and stores nothing.
create function private.finish_coach_request(
  p_user_id uuid, p_request_id uuid, p_message text, p_reply text, p_language text, p_proposal jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.coach_requests;
  v_message uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_user_id::text, 0));

  select * into r from public.coach_requests where user_id = p_user_id and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.status = 'completed' then
    select m.id into v_message from public.coach_messages m where m.user_id = p_user_id and m.request_id = p_request_id;
    return jsonb_build_object('status', 'completed', 'message_id', v_message);
  end if;
  if r.status <> 'reserved' then
    return jsonb_build_object('status', 'not_reserved');
  end if;

  insert into public.coach_messages (user_id, request_id, message, reply, language)
  values (p_user_id, p_request_id, p_message, p_reply, p_language)
  returning id into v_message;

  if p_proposal is not null then
    insert into public.coach_proposals (user_id, request_id, patch) values (p_user_id, p_request_id, p_proposal);
  end if;

  update public.coach_requests set status = 'completed', completed_at = now(), updated_at = now()
  where user_id = p_user_id and request_id = p_request_id;

  -- Count, don't increment: exact and idempotent, like the food counter.
  insert into public.usage_daily (user_id, usage_date, ai_messages)
  select p_user_id, r.quota_day, count(*)
  from public.coach_requests q
  where q.user_id = p_user_id and q.quota_day = r.quota_day and q.status = 'completed'
  on conflict (user_id, usage_date) do update set ai_messages = excluded.ai_messages;

  return jsonb_build_object('status', 'completed', 'message_id', v_message);
end;
$$;

-- Release a reservation whose failure is known (no answer exists). Never touches a completed request.
create function private.fail_coach_request(p_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.coach_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_user_id::text, 0));

  select * into r from public.coach_requests where user_id = p_user_id and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.status = 'completed' then
    return jsonb_build_object('status', 'completed');
  end if;
  update public.coach_requests set status = 'failed', lease_until = now(), updated_at = now()
  where user_id = p_user_id and request_id = p_request_id;
  return jsonb_build_object('status', 'failed');
end;
$$;

-- Service-role entry points (the private schema is not exposed to the Data API).
create function public.coach_reserve_request(p_user_id uuid, p_request_id uuid, p_lease_seconds integer default 120)
returns jsonb language sql security definer set search_path = ''
as $$ select private.reserve_coach_request(p_user_id, p_request_id, p_lease_seconds) $$;

create function public.coach_finish_request(
  p_user_id uuid, p_request_id uuid, p_message text, p_reply text, p_language text, p_proposal jsonb default null
)
returns jsonb language sql security definer set search_path = ''
as $$ select private.finish_coach_request(p_user_id, p_request_id, p_message, p_reply, p_language, p_proposal) $$;

create function public.coach_fail_request(p_user_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select private.fail_coach_request(p_user_id, p_request_id) $$;

revoke all on function private.reserve_coach_request(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function private.finish_coach_request(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.fail_coach_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.coach_reserve_request(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.coach_finish_request(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.coach_fail_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.coach_reserve_request(uuid, uuid, integer) to service_role;
grant execute on function public.coach_finish_request(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.coach_fail_request(uuid, uuid) to service_role;
