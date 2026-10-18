-- Roadmap B1: a switch for the proposed free core, without weakening any authorisation.
--
-- New server setting `manual_food_unlimited` (jsonb boolean, shipped as false):
--   * false (default): everything behaves exactly as before. Free users have free_food_logs_per_day logs per
--     UTC day plus verified ad credits.
--   * true: manual food logging has no daily limit for anyone. Food logs are still owner-checked by
--     row-level security (own foods and visible shared foods only), re-sending a log id still spends nothing,
--     and usage_daily still counts accepted logs.
-- The free plan length is not a new mechanism: it is the existing free_plan_days setting (set it to 120 to
-- open every plan day for free). Turning the policy on is a deliberate configuration change by the owner,
-- see docs/product/access-matrix.md; this migration does not turn it on.
--
-- While the switch is true, request_ad_reward stops issuing FOOD rewards ('unavailable'); AI rewards are
-- unaffected. grant_ad_reward is untouched, so an already issued token still settles and earned credits
-- are never deleted.
--
-- A malformed value (not a boolean) fails closed: the gate raises LIMIT_CONFIG_INVALID like any other bad
-- limit. A missing row means "off".

insert into public.app_config (key, value) values ('manual_food_unlimited', 'false'::jsonb)
on conflict (key) do nothing;

create function private.config_flag(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select c.value into v from public.app_config c where c.key = p_key;
  if v is null then
    return false;
  end if;
  if jsonb_typeof(v) <> 'boolean' then
    raise exception 'LIMIT_CONFIG_INVALID' using errcode = 'P0001', detail = p_key;
  end if;
  return (v #>> '{}')::boolean;
end;
$$;
revoke all on function private.config_flag(text) from public, anon, authenticated;

-- Same gate as before (20261014010348_food_quota.sql) with one extra early exit after the premium check.
create or replace function private.food_log_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.quota_day();
  existing public.food_logs%rowtype;
  is_premium boolean;
  base integer;
  bonus integer;
  used integer;
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'FOOD_LOG_OWNER_IMMUTABLE' using errcode = 'P0001';
    end if;
    if new.accepted_utc_date is distinct from old.accepted_utc_date then
      raise exception 'ACCEPTED_DATE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    new.accepted_utc_date := today;
    return new;
  end if;

  select * into existing from public.food_logs where id = new.id;
  if found then
    new.accepted_utc_date := existing.accepted_utc_date;
    return new;
  end if;

  new.accepted_utc_date := today;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || today::text, 0));

  select * into existing from public.food_logs where id = new.id;
  if found then
    new.accepted_utc_date := existing.accepted_utc_date;
    return new;
  end if;

  select exists (
    select 1 from public.entitlements e where e.user_id = new.user_id and e.tier = 'premium'
  ) into is_premium;
  if is_premium then
    return new;
  end if;

  -- New: manual food logging is free of any daily limit when the owner has switched it on.
  if private.config_flag('manual_food_unlimited') then
    return new;
  end if;

  base := private.config_int('free_food_logs_per_day');
  select coalesce(sum(c.credits), 0) into bonus
  from public.ad_credits c
  where c.user_id = new.user_id and c.reward_type = 'food' and c.quota_day = today;
  select count(*) into used
  from public.food_logs f
  where f.user_id = new.user_id and f.accepted_utc_date = today;

  if used >= base + bonus then
    raise exception 'FOOD_LIMIT_REACHED' using errcode = 'P0001', hint = (today + 1)::text || 'T00:00:00Z';
  end if;
  return new;
end;
$$;

-- Same as 20261014072526_ad_request_pruning.sql plus 'unavailable' for food rewards while food is unlimited.
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
  if p_reward_type = 'food' and private.config_flag('manual_food_unlimited') then
    return 'unavailable';
  end if;
  v_max := private.config_int('ad_rewards_max_per_day');
  select count(*) into v_used from public.ad_credits where user_id = p_user_id and quota_day = v_today;
  if v_used >= v_max then
    return 'cap_reached';
  end if;

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
