-- Roadmap D3. Eating-out guidance for REVIEWED dishes. Additive.
--
--   * Reviewed content written by the service role only. Members read a dish only when it is published, and never
--     write, edit or delete.
--   * Calories, when present, are an approximate RANGE (min below max) for a portion described by serving_note, with
--     the source, version, access date and licence evidence of that figure. A single precise number is refused, and
--     unknown calories are null, never zero.
--   * Publishing needs a complete reviewer, names in all three languages and tips in all three languages.
--   * One row per (id, version): a duplicate import fails and a change is a new version.
-- It describes dishes in general. It never says a restaurant serves one.

create table public.eating_out_dishes (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published')),
  region text,
  name jsonb not null,
  aliases jsonb not null default '{}'::jsonb check (jsonb_typeof(aliases) = 'object'),
  tips jsonb not null default '[]'::jsonb check (jsonb_typeof(tips) = 'array'),
  calories_min numeric check (calories_min >= 0),
  calories_max numeric,
  serving_note jsonb,
  provenance jsonb,
  reviewer jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint eating_out_calorie_range check (
    (calories_min is null and calories_max is null)
    or (calories_min is not null and calories_max is not null and calories_max > calories_min
        and serving_note is not null
        and btrim(coalesce(serving_note ->> 'en', '')) <> '' and btrim(coalesce(serving_note ->> 'ms', '')) <> '' and btrim(coalesce(serving_note ->> 'ta', '')) <> '')
  ),
  constraint eating_out_published_complete check (
    status <> 'published' or (
      reviewer is not null
      and btrim(coalesce(reviewer ->> 'name', '')) <> ''
      and btrim(coalesce(reviewer ->> 'role', '')) <> ''
      and coalesce(reviewer ->> 'reviewedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and btrim(coalesce(name ->> 'en', '')) <> '' and btrim(coalesce(name ->> 'ms', '')) <> '' and btrim(coalesce(name ->> 'ta', '')) <> ''
      and jsonb_array_length(tips) >= 1
      and (
        calories_min is null or (
          provenance is not null
          and btrim(coalesce(provenance ->> 'name', '')) <> ''
          and btrim(coalesce(provenance ->> 'version', '')) <> ''
          and coalesce(provenance ->> 'accessedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
          and btrim(coalesce(provenance ->> 'licenceEvidence', '')) <> ''
        )
      )
    )
  )
);

-- A check constraint cannot look inside the tips list, so a trigger confirms every published tip is written in all
-- three languages.
create function private.eating_out_tips_complete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and exists (
    select 1 from jsonb_array_elements(new.tips) t
    where jsonb_typeof(t) <> 'object' or btrim(coalesce(t ->> 'en', '')) = '' or btrim(coalesce(t ->> 'ms', '')) = '' or btrim(coalesce(t ->> 'ta', '')) = ''
  ) then
    raise exception 'EATING_OUT_TIPS_INCOMPLETE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.eating_out_tips_complete() from public, anon, authenticated;
create trigger eating_out_tips_check before insert or update on public.eating_out_dishes
  for each row execute function private.eating_out_tips_complete();

alter table public.eating_out_dishes enable row level security;
create policy "eating_out_dishes_read_published" on public.eating_out_dishes for select to authenticated using (status = 'published');
revoke all on public.eating_out_dishes from anon, authenticated;
grant select on public.eating_out_dishes to authenticated;
