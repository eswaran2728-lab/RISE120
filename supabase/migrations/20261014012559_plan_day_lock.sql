-- Phase 4, Task 2: free users can read only the first free_plan_days (14) days of their plan through the
-- Data API; premium users can read all 120. The lock is a row-level-security rule on plan_days, so it
-- applies to every client read (select, range, count and exports), not just to what the app displays.
--
-- The plan itself is untouched: all 120 days stay stored, the plans row stays readable, and the days
-- reappear the moment a user becomes premium. The limit comes from app_config (never a constant here); a
-- missing or non-numeric value makes the comparison null, which denies the row (fail closed).
-- The server (service role) is not affected, so generation, repair and support tooling still see everything.
drop policy "plan_days_select_own" on public.plan_days;

create policy "plan_days_select_own" on public.plan_days
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (
      exists (
        select 1 from public.entitlements e
        where e.user_id = (select auth.uid()) and e.tier = 'premium'
      )
      or day_number <= (
        select case when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::numeric end
        from public.app_config c
        where c.key = 'free_plan_days'
      )
    )
  );
