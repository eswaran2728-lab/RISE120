-- Phase 4 review: request_ad_reward kept every unused token a user asked for, so one signed-in user could
-- create unlimited rows. Each new request now also drops the user's oldest unused tokens beyond a small
-- number. This is an abuse bound, not a plan limit: a user watches one ad at a time, and a few spare tokens
-- cover ads that failed to load or a callback that arrives late. Only the newest tokens stay valid.
-- Granting is unchanged (a pruned token is simply "unknown_token").
create or replace function public.request_ad_reward(p_user_id uuid, p_reward_type text, p_token_hash text, p_ttl_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.quota_day();
  v_max integer;
  v_used integer;
  v_keep_unused constant integer := 4; -- plus the token being issued
begin
  if p_reward_type not in ('food', 'ai') or p_ttl_seconds <= 0 then
    raise exception 'AD_REWARD_REQUEST_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ads:' || p_user_id::text, 0));

  if private.is_premium(p_user_id) then
    return 'premium';
  end if;
  v_max := private.config_int('ad_rewards_max_per_day');
  select count(*) into v_used from public.ad_credits where user_id = p_user_id and quota_day = v_today;
  if v_used >= v_max then
    return 'cap_reached';
  end if;

  -- Housekeeping: this user's long-expired requests, then their oldest unused ones beyond the bound.
  delete from public.ad_reward_requests where user_id = p_user_id and expires_at < now() - interval '1 day';
  delete from public.ad_reward_requests
  where token_hash in (
    select r.token_hash
    from public.ad_reward_requests r
    where r.user_id = p_user_id and r.consumed_at is null
    order by r.created_at desc, r.token_hash desc
    offset v_keep_unused
  );
  insert into public.ad_reward_requests (token_hash, user_id, reward_type, expires_at)
  values (p_token_hash, p_user_id, p_reward_type, now() + make_interval(secs => p_ttl_seconds));
  return 'issued';
end;
$$;
