-- Roadmap D1. Sourced local recipes. Additive: no existing table changes.
--
--   * Shared recipes (user_id is null) are reviewed content written by the service role only. A member sees one only
--     when it is published. Publication needs a reviewer, names in all three languages, preparation steps and a
--     nutrition source with its version, access date and licence evidence.
--   * A member may keep private recipes (user_id = themselves). A private recipe is always status 'private', never
--     verified, never reviewed, never published: a client can promote nothing.
--   * Unknown nutrients and prices are null in the JSON, never 0. Nutrition is per serving.
--   * Ingredients reference foods by (source, source_id). A shared published recipe may use only shared foods; a
--     private recipe may use shared foods and its owner's own foods.
--   * One shared recipe per (id, version): a duplicate import fails, and a change is a new version.

create table public.recipes (
  row_id uuid primary key default gen_random_uuid(),
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  version integer not null check (version >= 1),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'private')),
  verified boolean not null default false,
  region text,
  name jsonb not null,
  aliases jsonb not null default '{}'::jsonb check (jsonb_typeof(aliases) = 'object'),
  servings numeric not null check (servings > 0),
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) >= 1),
  preparation jsonb not null default '[]'::jsonb check (jsonb_typeof(preparation) = 'array'),
  prep_minutes integer check (prep_minutes >= 0),
  cook_minutes integer check (cook_minutes >= 0),
  cooking text[] not null default '{}' check (cooking <@ array['none', 'stovetop', 'rice_cooker', 'oven', 'microwave', 'kettle']),
  diet_labels text[] not null default '{}' check (diet_labels <@ array['vegetarian', 'vegan']),
  free_from text[] not null default '{}' check (free_from <@ array['peanut', 'tree_nut', 'dairy', 'egg', 'gluten', 'soy', 'shellfish', 'fish', 'sesame']),
  nutrition jsonb,
  price jsonb,
  reviewer jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint recipes_private_shape check (user_id is null or (status = 'private' and verified = false and reviewer is null and published_at is null)),
  constraint recipes_shared_not_private check (user_id is not null or status <> 'private'),
  constraint recipes_price_valid check (
    price is null or (
      coalesce(price ->> 'currency', '') ~ '^[A-Z]{3}$'
      and coalesce(price ->> 'amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
      and coalesce(price ->> 'pricedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(price ->> 'source', '') <> ''
      and coalesce(price ->> 'servings', '') ~ '^[0-9]+(\.[0-9]+)?$' and (price ->> 'servings')::numeric > 0
      and (region is distinct from 'MY' or price ->> 'currency' = 'MYR')
    )
  ),
  constraint recipes_reviewed_complete check (
    (not verified and status <> 'published') or (
      reviewer is not null
      and coalesce(reviewer ->> 'name', '') <> ''
      and coalesce(reviewer ->> 'role', '') <> ''
      and coalesce(reviewer ->> 'reviewedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and status = 'published'
    )
  ),
  constraint recipes_published_complete check (
    status <> 'published' or (
      coalesce(name ->> 'en', '') <> '' and coalesce(name ->> 'ms', '') <> '' and coalesce(name ->> 'ta', '') <> ''
      and jsonb_array_length(preparation) >= 1
      and nutrition is not null
      and coalesce(nutrition #>> '{provenance,name}', '') <> ''
      and coalesce(nutrition #>> '{provenance,version}', '') <> ''
      and coalesce(nutrition #>> '{provenance,accessedOn}', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(nutrition #>> '{provenance,licenceEvidence}', '') <> ''
    )
  )
);

create unique index recipes_shared_key on public.recipes (id, version) where user_id is null;
create unique index recipes_private_key on public.recipes (user_id, id, version) where user_id is not null;

-- Every ingredient of a published or private recipe must be a food the recipe may use.
create function private.recipe_refs_ok() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ingredient jsonb;
begin
  if new.status = 'published' or new.user_id is not null then
    for v_ingredient in select value from jsonb_array_elements(new.ingredients) loop
      if not exists (
        select 1 from public.foods f
        where f.source = v_ingredient #>> '{ref,source}'
          and f.source_id = v_ingredient #>> '{ref,sourceId}'
          and (f.user_id is null or f.user_id = new.user_id)
      ) then
        raise exception 'RECIPE_INGREDIENT_UNAVAILABLE' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.recipe_refs_ok() from public, anon, authenticated;
create trigger recipes_refs_check before insert or update on public.recipes
  for each row execute function private.recipe_refs_ok();

alter table public.recipes enable row level security;
create policy "recipes_select" on public.recipes for select to authenticated
  using ((user_id is null and status = 'published') or user_id = (select auth.uid()));
create policy "recipes_insert_own_private" on public.recipes for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'private' and verified = false and reviewer is null and published_at is null);
create policy "recipes_update_own_private" on public.recipes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status = 'private' and verified = false and reviewer is null and published_at is null);
create policy "recipes_delete_own_private" on public.recipes for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'private');
revoke all on public.recipes from anon, authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
