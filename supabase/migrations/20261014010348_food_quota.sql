-- Phase 4, Task 1: the free food-log quota is enforced in PostgreSQL, so every write path (the app,
-- direct Data API inserts and upserts, and the service role) goes through the same gate.
--
-- Rules (the numbers come from app_config, never from the client):
--   * Free users: free_food_logs_per_day accepted logs per UTC day, plus verified ad credits for that day.
--   * Premium users (entitlements.tier = 'premium'): no food limit.
--   * The day a log counts against is the UTC day the SERVER first accepted it (accepted_utc_date). It is
--     set here, ignored if a client supplies it, and cannot be changed. food_logs.log_date stays the
--     intended local meal date and has no effect on the quota, so a changed clock, time zone or meal date
--     cannot gain an allowance.
--   * Editing a log (quantity, meal, date) or re-sending the same id (a retry or upsert) spends nothing;
--     deleting a log releases its slot for its original quota day.
--   * Admission is serialised per user and quota day, so two simultaneous inserts cannot both take the
--     last slot.
-- Existing rows keep their data: their accepted day is backfilled from created_at (UTC) and they are never
-- rejected or deleted, even if an old day is over the limit.

create function private.quota_day()
returns date
language sql
stable
as $$ select (now() at time zone 'utc')::date $$;

-- A limit read from app_config. A missing or malformed value fails closed.
create function private.config_int(p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select c.value into v from public.app_config c where c.key = p_key;
  if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$' then
    raise exception 'LIMIT_CONFIG_INVALID' using errcode = 'P0001', detail = p_key;
  end if;
  return (v #>> '{}')::integer;
end;
$$;

-- Server-written ledger of rewarded-ad credits. Only the verified AdMob callback (Task 4) inserts here;
-- clients may read their own rows and nothing else.
create table public.ad_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_type text not null check (reward_type in ('food', 'ai')),
  credits integer not null check (credits > 0),
  quota_day date not null,
  created_at timestamptz not null default now()
);
create index ad_credits_user_day_idx on public.ad_credits (user_id, quota_day, reward_type);
alter table public.ad_credits enable row level security;
create policy "ad_credits_select_own" on public.ad_credits
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.ad_credits from anon, authenticated;
-- usage_daily is already select-only through row-level security; also remove the table privileges.
revoke insert, update, delete on public.usage_daily from anon, authenticated;

-- The quota day each log was accepted on.
alter table public.food_logs add column accepted_utc_date date;
update public.food_logs set accepted_utc_date = (created_at at time zone 'utc')::date;
alter table public.food_logs alter column accepted_utc_date set not null;
create index food_logs_user_accepted_idx on public.food_logs (user_id, accepted_utc_date);

-- Bring usage_daily in line with the existing logs.
insert into public.usage_daily (user_id, usage_date, food_logs)
select user_id, accepted_utc_date, count(*)
from public.food_logs
group by user_id, accepted_utc_date
on conflict (user_id, usage_date) do update set food_logs = excluded.food_logs;

-- Admission gate for inserts (including the insert half of an upsert) and the immutability guard for updates.
create function private.food_log_admission()
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

  -- A signed-in client writing a row for someone else is refused by row-level security. Leave that to the
  -- policy so this gate never reveals another user's limit status.
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    new.accepted_utc_date := today;
    return new;
  end if;

  -- Re-sending a log that already exists (a retry after a lost response, or an upsert) keeps its original
  -- accepted day and spends no slot. Any client-supplied date is overwritten.
  select * into existing from public.food_logs where id = new.id;
  if found then
    new.accepted_utc_date := existing.accepted_utc_date;
    return new;
  end if;

  new.accepted_utc_date := today;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || today::text, 0));

  -- Another transaction may have created this id while we waited for the lock.
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

  base := private.config_int('free_food_logs_per_day');
  select coalesce(sum(c.credits), 0) into bonus
  from public.ad_credits c
  where c.user_id = new.user_id and c.reward_type = 'food' and c.quota_day = today;
  select count(*) into used
  from public.food_logs f
  where f.user_id = new.user_id and f.accepted_utc_date = today;

  if used >= base + bonus then
    -- The hint carries the next reset, 00:00 UTC.
    raise exception 'FOOD_LIMIT_REACHED' using errcode = 'P0001', hint = (today + 1)::text || 'T00:00:00Z';
  end if;
  return new;
end;
$$;

-- Keeps usage_daily.food_logs equal to the accepted logs for the day. Counting (not incrementing) under
-- the same lock keeps it exact under concurrency. It only updates existing rows on delete, so deleting an
-- account (a cascade) never tries to insert for a user that is going away.
create function private.food_log_usage_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_day date;
begin
  if tg_op = 'INSERT' then
    v_user := new.user_id;
    v_day := new.accepted_utc_date;
  else
    v_user := old.user_id;
    v_day := old.accepted_utc_date;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_day::text, 0));

  if tg_op = 'INSERT' then
    insert into public.usage_daily (user_id, usage_date, food_logs)
    values (v_user, v_day, (select count(*) from public.food_logs f where f.user_id = v_user and f.accepted_utc_date = v_day))
    on conflict (user_id, usage_date) do update set food_logs = excluded.food_logs;
    return new;
  end if;

  update public.usage_daily u
  set food_logs = (select count(*) from public.food_logs f where f.user_id = v_user and f.accepted_utc_date = v_day)
  where u.user_id = v_user and u.usage_date = v_day;
  return old;
end;
$$;

revoke all on function private.quota_day() from public, anon, authenticated;
revoke all on function private.config_int(text) from public, anon, authenticated;
revoke all on function private.food_log_admission() from public, anon, authenticated;
revoke all on function private.food_log_usage_sync() from public, anon, authenticated;

create trigger food_logs_admission
  before insert or update on public.food_logs
  for each row execute function private.food_log_admission();

create trigger food_logs_usage
  after insert or delete on public.food_logs
  for each row execute function private.food_log_usage_sync();
