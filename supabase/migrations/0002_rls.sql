-- Row-Level Security policies for Rise120 tables.
-- Follows Rise120 Design Spec (Part 4) and Phase 1 Task 3 Plan (Part 5).

-- Ensure RLS is enabled on all tables
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.foods enable row level security;
alter table public.food_logs enable row level security;
alter table public.checkins enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_daily enable row level security;
alter table public.app_config enable row level security;

-- 1. profiles: own-row select, insert, update (no client delete)
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 2. plans: select-only on own plans
create policy "plans_select_own" on public.plans
  for select to authenticated
  using (user_id = auth.uid());

-- 3. plan_days: select-only on own plan_days
create policy "plan_days_select_own" on public.plan_days
  for select to authenticated
  using (user_id = auth.uid());

-- 4. exercises: select-only for signed-in users
create policy "exercises_select_authenticated" on public.exercises
  for select to authenticated
  using (true);

-- 5. workout_logs: own-row select/insert/update/delete
create policy "workout_logs_select_own" on public.workout_logs
  for select to authenticated
  using (user_id = auth.uid());

create policy "workout_logs_insert_own" on public.workout_logs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "workout_logs_update_own" on public.workout_logs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "workout_logs_delete_own" on public.workout_logs
  for delete to authenticated
  using (user_id = auth.uid());

-- 6. foods: select shared (user_id is null) or own; insert/update/delete only own unverified
create policy "foods_select" on public.foods
  for select to authenticated
  using (user_id is null or user_id = auth.uid());

create policy "foods_insert_own" on public.foods
  for insert to authenticated
  with check (user_id = auth.uid() and verified = false);

create policy "foods_update_own" on public.foods
  for update to authenticated
  using (user_id = auth.uid() and verified = false)
  with check (user_id = auth.uid() and verified = false);

create policy "foods_delete_own" on public.foods
  for delete to authenticated
  using (user_id = auth.uid() and verified = false);

-- 7. food_logs: own-row select/insert/update/delete
create policy "food_logs_select_own" on public.food_logs
  for select to authenticated
  using (user_id = auth.uid());

create policy "food_logs_insert_own" on public.food_logs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "food_logs_update_own" on public.food_logs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "food_logs_delete_own" on public.food_logs
  for delete to authenticated
  using (user_id = auth.uid());

-- 8. checkins: own-row select/insert/update/delete
create policy "checkins_select_own" on public.checkins
  for select to authenticated
  using (user_id = auth.uid());

create policy "checkins_insert_own" on public.checkins
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "checkins_update_own" on public.checkins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "checkins_delete_own" on public.checkins
  for delete to authenticated
  using (user_id = auth.uid());

-- 9. entitlements: select-only on own entitlements
create policy "entitlements_select_own" on public.entitlements
  for select to authenticated
  using (user_id = auth.uid());

-- 10. usage_daily: select-only on own usage_daily
create policy "usage_daily_select_own" on public.usage_daily
  for select to authenticated
  using (user_id = auth.uid());

-- 11. app_config: select-only for signed-in users
create policy "app_config_select_authenticated" on public.app_config
  for select to authenticated
  using (true);
