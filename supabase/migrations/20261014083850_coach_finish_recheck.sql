-- Phase 5, Task 1 fix: finishing an expired reservation must recheck admission.
--
-- A reservation holds its slot only for a lease. Once the lease runs out the slot is free for another request,
-- so a late finish could be stored and charged on top of the allowance (two replies, two charges, one message
-- allowed). finish_coach_request now rechecks admission, atomically under the same per-user lock, when the
-- reservation being finished has expired. It uses the request's own quota day and the same rules as reserve:
-- effective premium bypasses the cap, otherwise completed requests plus live reservations of that day (other
-- than this one) must be below the server-configured allowance plus that day's verified AI ad credits.
--
-- If the slot has been taken, nothing is stored (no reply, no proposal, no charge), the request is marked failed
-- so it is not left dangling, and the status 'slot_taken' is returned. The same id can then only be admitted
-- again by reserve, under the normal rules. A reservation that is still live was already admitted and is not
-- rechecked. Everything else (idempotent re-finish, not_found, not_reserved, validation) is unchanged.
create or replace function private.finish_coach_request(
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
  v_allowance integer;
  v_used integer;
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

  -- The lease ran out, so another request may have taken this slot: admit it again, or refuse.
  if r.lease_until <= now() and not private.is_premium(p_user_id) then
    v_allowance := private.config_int('free_ai_messages_per_day')
      + coalesce((
          select sum(c.credits)::integer from public.ad_credits c
          where c.user_id = p_user_id and c.reward_type = 'ai' and c.quota_day = r.quota_day
        ), 0);
    select count(*) into v_used
    from public.coach_requests q
    where q.user_id = p_user_id and q.quota_day = r.quota_day and q.request_id <> p_request_id
      and (q.status = 'completed' or (q.status = 'reserved' and q.lease_until > now()));
    if v_used >= v_allowance then
      update public.coach_requests set status = 'failed', lease_until = now(), updated_at = now()
      where user_id = p_user_id and request_id = p_request_id;
      return jsonb_build_object('status', 'slot_taken');
    end if;
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
