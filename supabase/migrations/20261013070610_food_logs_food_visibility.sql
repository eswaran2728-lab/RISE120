-- A meal log may only reference a food the caller is allowed to use: a shared food (user_id is null)
-- or one of their own. Before this, the insert and update policies checked only the log's user_id, and
-- the foreign key to foods is checked without row-level security, so a user who knew another user's
-- private food id could log it, and that user later deleting the food would cascade away the log.
--
-- The checks live in the policies' WITH CHECK, so they apply to inserts, to the insert and update halves
-- of an upsert, and to updates that repoint food_id. Updates that leave food_id alone (quantity, meal)
-- still pass because the food is still visible. Existing rows are not validated or changed (an audit of
-- the development database found none that cross users). Cascades from account deletion bypass row-level
-- security, so deleting an account is unaffected.
drop policy "food_logs_insert_own" on public.food_logs;
create policy "food_logs_insert_own" on public.food_logs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.foods f
      where f.id = food_logs.food_id
        and (f.user_id is null or f.user_id = (select auth.uid()))
    )
  );

drop policy "food_logs_update_own" on public.food_logs;
create policy "food_logs_update_own" on public.food_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.foods f
      where f.id = food_logs.food_id
        and (f.user_id is null or f.user_id = (select auth.uid()))
    )
  );
