-- The first version returned a column named plan_id, which clashed with plan_days.plan_id inside
-- "on conflict (plan_id, day_number)" ("column reference plan_id is ambiguous"). Rename the outputs.
drop function public.create_plan_with_days(uuid, date, jsonb);

create function public.create_plan_with_days(p_user_id uuid, p_start_date date, p_days jsonb)
returns table (result_plan_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_created boolean := false;
begin
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> 120 then
    raise exception 'p_days must contain exactly 120 days';
  end if;

  insert into public.plans (user_id, start_date)
  values (p_user_id, p_start_date)
  on conflict (user_id) do nothing
  returning id into v_plan_id;

  if v_plan_id is not null then
    v_created := true;
  else
    select p.id into v_plan_id from public.plans p where p.user_id = p_user_id;
  end if;

  insert into public.plan_days (user_id, plan_id, day_number, workout, calorie_target, protein_target_g)
  select
    p_user_id,
    v_plan_id,
    (d ->> 'day_number')::integer,
    d -> 'workout',
    (d ->> 'calorie_target')::integer,
    (d ->> 'protein_target_g')::integer
  from jsonb_array_elements(p_days) as d
  on conflict (plan_id, day_number) do nothing;

  return query select v_plan_id, v_created;
end;
$$;

revoke all on function public.create_plan_with_days(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.create_plan_with_days(uuid, date, jsonb) to service_role;
