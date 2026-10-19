-- Roadmap D2. A member's saved meal plan: one plan per account, with a revision that every edit must name.
--
--   * Saving is premium-only, decided on database time (private.is_premium): a subscription that lapsed without an
--     event is refused, whatever entitlements.tier still says.
--   * An edit names the revision it was made against (0 for no plan yet). A different current revision raises
--     REVISION_CONFLICT with the current one, so two phones cannot overwrite each other.
--   * Every save carries a request id: a repeat returns the original result and changes nothing.
--   * A selection may point only at a published, shared (reviewed) recipe version. Choosing a recipe never creates
--     a food log: logging stays a separate, explicit act.
--   * Members read their own plan; only this function (service role) writes it.

create table public.meal_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null check (revision >= 1),
  selections jsonb not null check (jsonb_typeof(selections) = 'array'),
  updated_at timestamptz not null default now()
);
alter table public.meal_plans enable row level security;
create policy "meal_plans_select_own" on public.meal_plans for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.meal_plans from anon, authenticated;
grant select on public.meal_plans to authenticated;

-- The answer to each save, so a lost reply can be repeated safely. Not readable by clients.
create table public.meal_plan_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  revision integer not null,
  selections jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.meal_plan_requests enable row level security;
revoke all on public.meal_plan_requests from anon, authenticated;

create function public.save_meal_plan(p_user_id uuid, p_request_id uuid, p_expected_revision integer, p_selections jsonb)
returns table (result_status text, result_revision integer, result_selections jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.meal_plan_requests%rowtype;
  v_current integer;
  v_item jsonb;
  v_seen text[] := '{}';
  v_slot text;
begin
  perform pg_advisory_xact_lock(hashtextextended('mealplan:' || p_user_id::text, 0));

  select * into v_existing from public.meal_plan_requests where user_id = p_user_id and request_id = p_request_id;
  if found then
    return query select 'existing'::text, v_existing.revision, v_existing.selections;
    return;
  end if;

  if not private.is_premium(p_user_id) then
    raise exception 'PREMIUM_REQUIRED' using errcode = 'P0001';
  end if;

  select revision into v_current from public.meal_plans where user_id = p_user_id;
  v_current := coalesce(v_current, 0);
  if v_current <> p_expected_revision then
    raise exception 'REVISION_CONFLICT:%', v_current using errcode = 'P0001';
  end if;

  if p_selections is null or jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) not between 1 and 42 then
    raise exception 'INVALID_SELECTIONS' using errcode = 'P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_selections) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'recipeId', '') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
       or coalesce(v_item ->> 'version', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item ->> 'servings', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v_item ->> 'servings')::numeric <= 0 or (v_item ->> 'servings')::numeric > 50
       or coalesce(v_item ->> 'day', '') !~ '^[0-6]$'
       or coalesce(v_item ->> 'slot', '') !~ '^[0-5]$' then
      raise exception 'INVALID_SELECTIONS' using errcode = 'P0001';
    end if;
    v_slot := (v_item ->> 'day') || ':' || (v_item ->> 'slot');
    if v_slot = any (v_seen) then
      raise exception 'INVALID_SELECTIONS' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_slot;
    -- Only a reviewed, published, shared recipe version.
    if not exists (
      select 1 from public.recipes r
      where r.id = v_item ->> 'recipeId' and r.version = (v_item ->> 'version')::integer and r.user_id is null and r.status = 'published'
    ) then
      raise exception 'RECIPE_UNAVAILABLE' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.meal_plans (user_id, revision, selections) values (p_user_id, v_current + 1, p_selections)
  on conflict (user_id) do update set revision = excluded.revision, selections = excluded.selections, updated_at = now();
  insert into public.meal_plan_requests (user_id, request_id, revision, selections) values (p_user_id, p_request_id, v_current + 1, p_selections);

  return query select 'saved'::text, v_current + 1, p_selections;
end;
$$;
revoke all on function public.save_meal_plan(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_meal_plan(uuid, uuid, integer, jsonb) to service_role;
