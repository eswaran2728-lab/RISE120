-- Roadmap B2: lifestyle preferences and the journey time zone.
--
-- profiles gets six optional preferences (region, journey time zone, cooking access and time, an optional
-- budget with its currency). They are the member's own: the existing own-row policies apply. None of them is
-- read by plan generation, so a budget or cooking time can never change a calorie or protein target.
--
-- plans gets journey_time_zone: the zone the journey's days are counted in. NULL means the phone's own zone,
-- which is exactly what every existing plan has used, so existing plans keep their day calculation unchanged
-- (backfilling UTC would have moved the day boundary to 08:00 in Malaysia). A new cycle records the member's
-- zone when it is created (roadmap B3); a later change of preference never rewrites an existing plan.
-- Quota resets stay on UTC and are unrelated.
--
-- Time zone names are checked against the database's own list, in the database, so a client that skips the
-- app's checks still cannot store one that does not exist.

alter table public.profiles
  add column region text check (region in ('MY', 'SG', 'other')),
  add column journey_time_zone text,
  add column cooking_access text check (cooking_access in ('full', 'basic', 'none')),
  add column cooking_minutes integer check (cooking_minutes between 5 and 240),
  add column budget_amount numeric check (budget_amount >= 0 and budget_amount <= 100000),
  add column budget_currency text check (budget_currency in ('MYR', 'SGD')),
  add constraint profiles_budget_pair check ((budget_amount is null) = (budget_currency is null));

alter table public.plans add column journey_time_zone text;

create function private.validate_journey_time_zone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.journey_time_zone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.journey_time_zone) then
    raise exception 'INVALID_TIME_ZONE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_journey_time_zone() from public, anon, authenticated;

create trigger profiles_validate_time_zone
  before insert or update of journey_time_zone on public.profiles
  for each row execute function private.validate_journey_time_zone();

create trigger plans_validate_time_zone
  before insert or update of journey_time_zone on public.plans
  for each row execute function private.validate_journey_time_zone();
