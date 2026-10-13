-- Food provenance, stable source ids, barcode and reviewed language aliases. Additive: existing rows,
-- policies and migrations are unchanged except the delete policy below, which gains a safety check.
create extension if not exists pg_trgm with schema extensions;

alter table public.foods
  add column source_id text,
  add column source_url text,
  add column barcode text,
  -- Reviewed names only, e.g. {"en":["..."],"ms":["..."],"ta":["..."]}. No machine-invented aliases.
  add column aliases jsonb not null default '{}'::jsonb check (jsonb_typeof(aliases) = 'object'),
  add column search_text text generated always as (lower(name) || ' ' || lower(aliases::text)) stored;

-- One food per source record, so repeated searches, scans and sync retries never duplicate it.
create unique index foods_shared_source_key on public.foods (source, source_id)
  where user_id is null and source_id is not null;
create unique index foods_user_source_key on public.foods (user_id, source, source_id)
  where user_id is not null and source_id is not null;
create index foods_barcode_idx on public.foods (barcode) where barcode is not null;
create index foods_search_text_idx on public.foods using gin (search_text extensions.gin_trgm_ops);

-- A user may not delete an own food that a meal log still references: that would also delete the log
-- (food_logs.food_id cascades) and rewrite history. Cascades from account deletion bypass row-level
-- security, so deleting an account is unaffected.
drop policy "foods_delete_own" on public.foods;
create policy "foods_delete_own" on public.foods
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and verified = false
    and not exists (select 1 from public.food_logs fl where fl.food_id = foods.id)
  );
