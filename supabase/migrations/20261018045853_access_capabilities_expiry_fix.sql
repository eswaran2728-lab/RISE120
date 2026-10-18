-- Fix for 20261018045211_access_capabilities.sql, caught by supabase/tests/premium-expiry.test.ts.
--
-- That migration rewrote private.food_log_admission() from the Phase 4 Task 1 version, which tested the
-- stored tier (entitlements.tier = 'premium'). Phase 4's premium-expiry migration
-- (20261014022154_premium_expiry_gates.sql) had since replaced that test with private.is_premium(), which uses
-- database time so a lapsed subscription is free even when the tier column still says premium. This restores
-- that rule and keeps the new manual_food_unlimited switch. Nothing else changes.
create or replace function private.food_log_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.quota_day();
  existing public.food_logs%rowtype;
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

  -- Database time decides premium (a lapsed subscription is free).
  if private.is_premium(new.user_id) then
    return new;
  end if;

  -- Manual food logging is free of any daily limit when the owner has switched it on.
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
