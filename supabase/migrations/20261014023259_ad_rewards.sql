-- Phase 4, Task 4: verified AdMob reward ledger.
--
-- Rewarded-ad credits are written only here, and only from a verified Google callback:
--   1. request_ad_reward  (authenticated function, service role) stores a one-use token hash bound to the
--      user and reward type. The raw token goes to the app and is passed to AdMob as SSV custom_data.
--   2. grant_ad_reward    (grant-ad-reward function, after the Google signature, ad unit and token hash are
--      checked) consumes the token once, records Google's transaction_id once, enforces the daily cap from
--      app_config on database time, and inserts the ad_credits row that Task 1's food gate and Task 2's
--      read model already count.
-- Clients cannot read or write the request table, write credits, or call either function.

create table public.ad_reward_requests (
  token_hash text primary key, -- sha256 of the opaque token; the raw token is never stored
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_type text not null check (reward_type in ('food', 'ai')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  outcome text check (outcome in ('granted', 'cap_reached', 'premium')),
  transaction_id text
);
create index ad_reward_requests_user_idx on public.ad_reward_requests (user_id, created_at);
alter table public.ad_reward_requests enable row level security;
revoke all on public.ad_reward_requests from public, anon, authenticated;

-- One Google transaction can be credited at most once, across all users.
alter table public.ad_credits add column transaction_id text;
alter table public.ad_credits add column ad_unit text;
create unique index ad_credits_transaction_uidx on public.ad_credits (transaction_id) where transaction_id is not null;

-- Issues a token if the user may still earn a reward today.
--   'issued' | 'premium' (premium sees no ads) | 'cap_reached'
create function public.request_ad_reward(p_user_id uuid, p_reward_type text, p_token_hash text, p_ttl_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.quota_day();
  v_max integer;
  v_used integer;
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

  -- Housekeeping: this user's long-expired requests.
  delete from public.ad_reward_requests where user_id = p_user_id and expires_at < now() - interval '1 day';
  insert into public.ad_reward_requests (token_hash, user_id, reward_type, expires_at)
  values (p_token_hash, p_user_id, p_reward_type, now() + make_interval(secs => p_ttl_seconds));
  return 'issued';
end;
$$;

-- Applies one verified callback. Outcomes:
--   'granted' credits added          'duplicate'  this transaction was already credited (or this token's own)
--   'unknown_token'                  'token_used' the token was spent by a different transaction
--   'expired'                        'cap_reached' / 'premium'  token consumed, nothing credited
create function public.grant_ad_reward(p_token_hash text, p_transaction_id text, p_ad_unit text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.ad_reward_requests;
  v_today date := private.quota_day();
  v_max integer;
  v_used integer;
  v_credits integer;
begin
  -- Row lock: concurrent callbacks for one token run one at a time.
  select * into v_request from public.ad_reward_requests where token_hash = p_token_hash for update;
  if not found then
    return 'unknown_token';
  end if;

  if v_request.consumed_at is not null then
    return case when v_request.transaction_id = p_transaction_id then 'duplicate' else 'token_used' end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ads:' || v_request.user_id::text, 0));

  if exists (select 1 from public.ad_credits where transaction_id = p_transaction_id) then
    return 'duplicate';
  end if;
  if v_request.expires_at <= now() then
    return 'expired';
  end if;

  if private.is_premium(v_request.user_id) then
    update public.ad_reward_requests set consumed_at = now(), outcome = 'premium', transaction_id = p_transaction_id where token_hash = p_token_hash;
    return 'premium';
  end if;

  v_max := private.config_int('ad_rewards_max_per_day');
  select count(*) into v_used from public.ad_credits where user_id = v_request.user_id and quota_day = v_today;
  if v_used >= v_max then
    update public.ad_reward_requests set consumed_at = now(), outcome = 'cap_reached', transaction_id = p_transaction_id where token_hash = p_token_hash;
    return 'cap_reached';
  end if;

  v_credits := private.config_int(case v_request.reward_type when 'food' then 'ad_reward_food_logs' else 'ad_reward_ai_messages' end);
  insert into public.ad_credits (user_id, reward_type, credits, quota_day, transaction_id, ad_unit)
  values (v_request.user_id, v_request.reward_type, v_credits, v_today, p_transaction_id, p_ad_unit);
  update public.ad_reward_requests set consumed_at = now(), outcome = 'granted', transaction_id = p_transaction_id where token_hash = p_token_hash;
  return 'granted';
end;
$$;

revoke all on function public.request_ad_reward(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.grant_ad_reward(text, text, text) from public, anon, authenticated;
grant execute on function public.request_ad_reward(uuid, text, text, integer) to service_role;
grant execute on function public.grant_ad_reward(text, text, text) to service_role;
