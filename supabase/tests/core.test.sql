-- Run against the development database before and after Task 2 migrations.
do $$
declare
  actual integer;
begin
  select count(*) into actual
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (array[
      'profiles', 'plans', 'plan_days', 'exercises', 'workout_logs',
      'foods', 'food_logs', 'checkins', 'entitlements', 'usage_daily', 'app_config'
    ])
    and c.relrowsecurity;
  if actual <> 11 then
    raise exception 'Expected 11 RLS-enabled Rise120 tables, found %', actual;
  end if;

  select count(*) into actual
  from public.app_config
  where (key, value) in (
    ('free_plan_days', '14'::jsonb),
    ('free_food_logs_per_day', '3'::jsonb),
    ('free_ai_messages_per_day', '1'::jsonb),
    ('ad_rewards_max_per_day', '3'::jsonb),
    ('ad_reward_food_logs', '2'::jsonb),
    ('ad_reward_ai_messages', '1'::jsonb)
  );
  if actual <> 6 then
    raise exception 'Expected six server-side limit values, found %', actual;
  end if;

  select count(*) into actual
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and t.tgname = 'on_auth_user_created'
    and not t.tgisinternal;
  if actual <> 1 then
    raise exception 'Expected one signup trigger, found %', actual;
  end if;
end;
$$;
