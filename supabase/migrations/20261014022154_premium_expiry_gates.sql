-- Phase 4, Task 3 fix: premium expiry is enforced at read time by every access gate.
--
-- entitlements.tier is moved only by RevenueCat webhook events, so a subscription that lapses without a
-- delivered event would leave the tier at 'premium'. billing_state.premium_until_ms holds the expiry; this
-- migration makes one rule, "premium = tier is premium AND the stored expiry (if any) has not passed on
-- database time", and points the three gates at it:
--   * food-log admission (trigger),
--   * direct plan_days reads (row-level security),
--   * check-limit (through is_premium_now, service role only).
-- Lifetime access (premium_until_ms null) and premium with no billing_state row (manual grants) stay
-- premium. The tier column is deliberately not rewritten here; gates never trust it alone.

create function private.is_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.entitlements e where e.user_id = p_user_id and e.tier = 'premium'
         )
     and not exists (
           select 1 from public.billing_state b
           where b.user_id = p_user_id
             and b.premium_until_ms is not null
             and b.premium_until_ms <= (extract(epoch from now()) * 1000)::bigint
         );
$$;

-- For check-limit (service role).
create function public.is_premium_now(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_premium(p_user_id) $$;

-- For row-level security: answers only for the signed-in caller.
create function public.current_user_is_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_premium((select auth.uid())) $$;

revoke all on function private.is_premium(uuid) from public, anon, authenticated;
revoke all on function public.is_premium_now(uuid) from public, anon, authenticated;
revoke all on function public.current_user_is_premium() from public, anon;
grant execute on function public.is_premium_now(uuid) to service_role;
grant execute on function public.current_user_is_premium() to authenticated, service_role;

-- Same admission function as before; only the premium check changed.
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

  if private.is_premium(new.user_id) then
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

drop policy "plan_days_select_own" on public.plan_days;

create policy "plan_days_select_own" on public.plan_days
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (
      (select public.current_user_is_premium())
      or day_number <= (
        select case when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::numeric end
        from public.app_config c
        where c.key = 'free_plan_days'
      )
    )
  );
