-- Roadmap B3: more than one plan per account (repeat and maintenance cycles) without losing history.
--
-- Audit of what assumed a single plan per account (done before this migration):
--   * plans.user_id was UNIQUE.                                    -> replaced by "one ACTIVE plan per account".
--   * create_plan_with_days did ON CONFLICT (user_id).             -> now conflicts on the active plan.
--   * private.decide_coach_proposal selected the account's plan.   -> now the active plan (replaced below).
--   * the coach context loader and the app's plan reader (TypeScript) -> now ask for the active plan.
--   * delete-account, RLS: plans and plan_days cascade from the user and are owner-read, which is unchanged
--     for any number of plans.
-- Workout logs, check-ins and food logs belong to the account and a calendar date, not to a plan, so they are
-- untouched and stay readable. Which cycle a log belongs to is the plan whose 120-day window contains its date;
-- no plan_id is added to them, so a log queued offline before a new cycle started still lands on the date it was
-- made and therefore on the original cycle.
--
-- Existing plans become cycle 1, mode 'initial', keep status 'active' (or whatever they have), and
-- journey_time_zone stays NULL (the phone's own zone) as set by the journey_preferences migration.

alter table public.plans drop constraint plans_user_id_key;

alter table public.plans
  add column cycle_number integer not null default 1 check (cycle_number >= 1),
  add column mode text not null default 'initial' check (mode in ('initial', 'progression', 'maintenance')),
  add column started_request_id uuid,
  add column completed_at timestamptz;

create unique index plans_one_active_per_user on public.plans (user_id) where status = 'active';
create unique index plans_cycle_per_user on public.plans (user_id, cycle_number);
create unique index plans_request_per_user on public.plans (user_id, started_request_id) where started_request_id is not null;

-- The first cycle: unchanged behaviour (one plan, a retry fills in missing days) but against the active plan.
create or replace function public.create_plan_with_days(p_user_id uuid, p_start_date date, p_days jsonb)
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
  on conflict (user_id) where status = 'active' do nothing
  returning id into v_plan_id;

  if v_plan_id is not null then
    v_created := true;
  else
    select p.id into v_plan_id from public.plans p where p.user_id = p_user_id and p.status = 'active';
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

-- Starts the next cycle in one transaction: complete the finished plan, create the new active plan and its 120
-- days. Same request id for the same account always answers with the same cycle (a retry after a lost answer).
-- Raises NO_ACTIVE_PLAN, CYCLE_NOT_FINISHED (the current plan has not passed day 120 on p_start_date) and
-- INVALID_START_DATE (more than two days from today by UTC). Any failure rolls everything back.
create function public.start_next_cycle(
  p_user_id uuid,
  p_request_id uuid,
  p_mode text,
  p_start_date date,
  p_days jsonb,
  p_journey_time_zone text
)
returns table (result_plan_id uuid, was_created boolean, result_cycle_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.plans%rowtype;
  v_existing public.plans%rowtype;
  v_new_id uuid;
begin
  if p_mode not in ('progression', 'maintenance') then
    raise exception 'INVALID_MODE';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> 120 then
    raise exception 'p_days must contain exactly 120 days';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cycle:' || p_user_id::text, 0));

  -- A repeat of an earlier request: the same answer, nothing created.
  select * into v_existing from public.plans where user_id = p_user_id and started_request_id = p_request_id;
  if found then
    return query select v_existing.id, false, v_existing.cycle_number;
    return;
  end if;

  select * into v_old from public.plans where user_id = p_user_id and status = 'active' for update;
  if not found then
    raise exception 'NO_ACTIVE_PLAN' using errcode = 'P0001';
  end if;
  if abs(p_start_date - private.quota_day()) > 2 then
    raise exception 'INVALID_START_DATE' using errcode = 'P0001';
  end if;
  if p_start_date < v_old.start_date + 120 then
    raise exception 'CYCLE_NOT_FINISHED' using errcode = 'P0001';
  end if;

  update public.plans set status = 'completed', completed_at = now() where id = v_old.id;

  insert into public.plans (user_id, start_date, cycle_number, mode, started_request_id, journey_time_zone)
  values (p_user_id, p_start_date, v_old.cycle_number + 1, p_mode, p_request_id, p_journey_time_zone)
  returning id into v_new_id;

  insert into public.plan_days (user_id, plan_id, day_number, workout, calorie_target, protein_target_g)
  select
    p_user_id,
    v_new_id,
    (d ->> 'day_number')::integer,
    d -> 'workout',
    (d ->> 'calorie_target')::integer,
    (d ->> 'protein_target_g')::integer
  from jsonb_array_elements(p_days) as d;

  return query select v_new_id, true, v_old.cycle_number + 1;
end;
$$;

revoke all on function public.start_next_cycle(uuid, uuid, text, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_next_cycle(uuid, uuid, text, date, jsonb, text) to service_role;

-- The coach decision function, unchanged except that it now binds to the account's ACTIVE plan (the only change is
-- the plan lookup near the top). Source: 20261015023735_coach_proposal_decision.sql.
create or replace function private.decide_coach_proposal(p_user_id uuid, p_proposal_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_earliest_offset constant integer := 2;
  c_horizon constant integer := 14;
  c_max_patches constant integer := 7;
  c_min_calories constant integer := 1500;
  c_calorie_step constant integer := 50;
  c_max_calorie_delta constant integer := 250;
  c_sets_min constant integer := 1;
  c_sets_max constant integer := 6;
  c_sets_delta constant integer := 1;
  c_reps_min constant integer := 4;
  c_reps_max constant integer := 20;
  c_reps_delta constant integer := 2;
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_prop public.coach_proposals;
  v_profile public.profiles;
  v_row public.plan_days;
  v_reason text;
  v_patches jsonb;
  v_patch jsonb;
  v_next jsonb;
  v_expected jsonb;
  v_new_workout jsonb;
  v_entry jsonb;
  v_cur jsonb;
  v_plan_id uuid;
  v_start date;
  v_today integer;
  v_access integer;
  v_first integer;
  v_last integer;
  v_day integer;
  v_days integer[] := '{}';
  v_ids text[];
  v_raw numeric;
  v_value numeric;
  v_min_protein integer;
  v_max_protein integer;
  v_ex_id uuid;
  v_ex_pattern text;
  v_cur_pattern text;
  v_idx integer;
  v_changed boolean;
  v_valid jsonb[] := '{}';
begin
  if p_decision not in ('accept', 'decline') then
    raise exception 'COACH_DECISION_INVALID';
  end if;

  -- Same lock as the coach ledger: one coach operation per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_user_id::text, 0));

  select * into v_prop from public.coach_proposals where id = p_proposal_id and user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_decision = 'decline' then
    if v_prop.status = 'accepted' then
      return jsonb_build_object('status', 'conflict', 'current', 'accepted');
    end if;
    if v_prop.status <> 'declined' then
      update public.coach_proposals set status = 'declined', decided_at = coalesce(decided_at, now()) where id = p_proposal_id;
    end if;
    return jsonb_build_object('status', 'declined');
  end if;

  -- accept
  if v_prop.status = 'accepted' then
    return jsonb_build_object('status', 'accepted', 'changed_days', to_jsonb(v_prop.applied_days));
  end if;
  if v_prop.status = 'declined' then
    return jsonb_build_object('status', 'conflict', 'current', 'declined');
  end if;
  if v_prop.status = 'stale' then
    return jsonb_build_object('status', 'stale', 'reason', v_prop.decision_reason);
  end if;

  begin
    v_patches := v_prop.patch -> 'patches';
    if jsonb_typeof(v_prop.patch) <> 'object' or jsonb_typeof(v_patches) <> 'array' then
      raise exception 'COACH_REJECT:malformed_proposal';
    end if;
    if jsonb_array_length(v_patches) = 0 then
      raise exception 'COACH_REJECT:empty_patch';
    end if;
    if jsonb_array_length(v_patches) > c_max_patches then
      raise exception 'COACH_REJECT:too_many_patches';
    end if;

    select * into v_profile from public.profiles where id = p_user_id;
    if not found or v_profile.goal is null or v_profile.equipment is null or v_profile.weight_kg is null
       or v_profile.height_cm is null or v_profile.age is null then
      raise exception 'COACH_REJECT:no_profile';
    end if;

    select p.id, p.start_date into v_plan_id, v_start from public.plans p where p.user_id = p_user_id and p.status = 'active';
    if not found then
      raise exception 'COACH_REJECT:no_plan';
    end if;

    -- The days this account may change now: future by UTC (+2 covers every time zone), within the horizon, and
    -- among the days it can currently open.
    v_today := private.quota_day() - v_start + 1;
    v_access := case when private.is_premium(p_user_id) then 120 else private.config_int('free_plan_days') end;
    v_first := greatest(1, v_today + c_earliest_offset);
    v_last := least(120, v_access, v_today + c_horizon);

    -- The raw (unrounded) calorie estimate, as in the plan rules. Null when the inputs are missing.
    if v_profile.energy_sex in ('male', 'female') and v_profile.activity_level is not null then
      v_raw := (10 * v_profile.weight_kg + 6.25 * v_profile.height_cm - 5 * v_profile.age
                 + case v_profile.energy_sex when 'male' then 5 else -161 end)
               * case v_profile.activity_level when 'sedentary' then 1.4 when 'light' then 1.6 else 1.8 end
               + case v_profile.goal when 'lose_fat' then -300 when 'build_muscle' then 200 else 0 end;
    end if;
    v_min_protein := ceil(round(1.6 * v_profile.weight_kg, 6));
    v_max_protein := floor(round(2.0 * v_profile.weight_kg, 6));

    -- Lock every affected day first, in day order, so nothing can change under the checks below.
    perform 1 from public.plan_days d
    where d.plan_id = v_plan_id
      and d.day_number in (
        select (p ->> 'dayNumber')::integer from jsonb_array_elements(v_patches) p
        where jsonb_typeof(p) = 'object' and private.coach_is_int(p -> 'dayNumber')
      )
    order by d.day_number
    for update;

    for v_patch in select value from jsonb_array_elements(v_patches) loop
      if jsonb_typeof(v_patch) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_patch) k where k not in ('dayNumber', 'next', 'expected')) then
        raise exception 'COACH_REJECT:malformed_proposal';
      end if;
      v_next := v_patch -> 'next';
      v_expected := v_patch -> 'expected';
      if jsonb_typeof(v_next) <> 'object' or jsonb_typeof(v_expected) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_next) k where k not in ('workout', 'calorieTarget', 'proteinTargetG'))
         or exists (select 1 from jsonb_object_keys(v_expected) k where k not in ('workout', 'calorieTarget', 'proteinTargetG')) then
        raise exception 'COACH_REJECT:malformed_proposal';
      end if;

      if not private.coach_is_int(v_patch -> 'dayNumber') then
        raise exception 'COACH_REJECT:day_not_editable';
      end if;
      v_day := (v_patch ->> 'dayNumber')::integer;
      if v_day < v_first or v_day > v_last then
        raise exception 'COACH_REJECT:day_not_editable';
      end if;
      if v_day = any (v_days) then
        raise exception 'COACH_REJECT:duplicate_day';
      end if;
      v_days := v_days || v_day;

      select * into v_row from public.plan_days d where d.plan_id = v_plan_id and d.day_number = v_day;
      if not found then
        raise exception 'COACH_REJECT:day_not_editable';
      end if;

      if not (v_next ? 'workout') and not (v_next ? 'calorieTarget') and not (v_next ? 'proteinTargetG') then
        raise exception 'COACH_REJECT:empty_patch';
      end if;

      -- The day must still be exactly what the proposal was made against.
      if v_row.workout is distinct from (v_expected -> 'workout')
         or v_row.calorie_target is distinct from (v_expected ->> 'calorieTarget')::integer
         or v_row.protein_target_g is distinct from (v_expected ->> 'proteinTargetG')::integer then
        raise exception 'COACH_REJECT:stale_plan';
      end if;

      v_changed := false;

      if v_next ? 'workout' then
        v_new_workout := v_next -> 'workout';
        if v_row.workout ->> 'kind' is distinct from 'workout' then
          raise exception 'COACH_REJECT:workout_on_rest_day';
        end if;
        if jsonb_typeof(v_new_workout) <> 'object' or v_new_workout ->> 'kind' is distinct from 'workout'
           or jsonb_typeof(v_new_workout -> 'exercises') <> 'array'
           or jsonb_array_length(v_new_workout -> 'exercises') <> jsonb_array_length(v_row.workout -> 'exercises') then
          raise exception 'COACH_REJECT:workout_shape';
        end if;

        v_ids := '{}';
        for v_idx in 0 .. jsonb_array_length(v_new_workout -> 'exercises') - 1 loop
          v_entry := (v_new_workout -> 'exercises') -> v_idx;
          v_cur := (v_row.workout -> 'exercises') -> v_idx;
          if jsonb_typeof(v_entry) <> 'object'
             or exists (select 1 from jsonb_object_keys(v_entry) k where k not in ('exercise_id', 'sets', 'reps')) then
            raise exception 'COACH_REJECT:malformed_proposal';
          end if;

          -- Exercises are looked up within the member's own equipment group only.
          v_ex_pattern := null;
          if jsonb_typeof(v_entry -> 'exercise_id') = 'string' and (v_entry ->> 'exercise_id') ~ c_uuid then
            v_ex_id := (v_entry ->> 'exercise_id')::uuid;
            select e.muscle_group into v_ex_pattern from public.exercises e where e.id = v_ex_id and e.equipment = v_profile.equipment;
          end if;
          if v_ex_pattern is null then
            raise exception 'COACH_REJECT:unknown_exercise';
          end if;
          v_cur_pattern := null;
          if jsonb_typeof(v_cur -> 'exercise_id') = 'string' and (v_cur ->> 'exercise_id') ~ c_uuid then
            select e.muscle_group into v_cur_pattern from public.exercises e
            where e.id = (v_cur ->> 'exercise_id')::uuid and e.equipment = v_profile.equipment;
          end if;
          if v_cur_pattern is distinct from v_ex_pattern then
            raise exception 'COACH_REJECT:pattern_mismatch';
          end if;
          if (v_entry ->> 'exercise_id') = any (v_ids) then
            raise exception 'COACH_REJECT:duplicate_exercise';
          end if;
          v_ids := v_ids || (v_entry ->> 'exercise_id');

          if not private.coach_is_int(v_entry -> 'sets') or not private.coach_is_int(v_entry -> 'reps') then
            raise exception 'COACH_REJECT:invalid_number';
          end if;
          if (v_entry ->> 'sets')::numeric not between c_sets_min and c_sets_max
             or abs((v_entry ->> 'sets')::numeric - (v_cur ->> 'sets')::numeric) > c_sets_delta then
            raise exception 'COACH_REJECT:sets_out_of_range';
          end if;
          if (v_entry ->> 'reps')::numeric not between c_reps_min and c_reps_max
             or abs((v_entry ->> 'reps')::numeric - (v_cur ->> 'reps')::numeric) > c_reps_delta then
            raise exception 'COACH_REJECT:reps_out_of_range';
          end if;
        end loop;
        if v_new_workout is distinct from v_row.workout then
          v_changed := true;
        end if;
      end if;

      if v_next ? 'calorieTarget' then
        if not private.coach_is_int(v_next -> 'calorieTarget') then
          raise exception 'COACH_REJECT:invalid_number';
        end if;
        v_value := (v_next ->> 'calorieTarget')::numeric;
        if v_row.calorie_target is null then
          raise exception 'COACH_REJECT:calories_without_base';
        end if;
        if v_raw is null or v_raw < c_min_calories then
          raise exception 'COACH_REJECT:raw_estimate_below_minimum';
        end if;
        if v_value < c_min_calories then
          raise exception 'COACH_REJECT:calories_below_minimum';
        end if;
        if v_value % c_calorie_step <> 0 then
          raise exception 'COACH_REJECT:calories_not_rounded';
        end if;
        if abs(v_value - v_row.calorie_target) > c_max_calorie_delta then
          raise exception 'COACH_REJECT:calories_change_too_large';
        end if;
        if v_value <> v_row.calorie_target then
          v_changed := true;
        end if;
      end if;

      if v_next ? 'proteinTargetG' then
        if not private.coach_is_int(v_next -> 'proteinTargetG') then
          raise exception 'COACH_REJECT:invalid_number';
        end if;
        v_value := (v_next ->> 'proteinTargetG')::numeric;
        if v_value < v_min_protein or v_value > v_max_protein then
          raise exception 'COACH_REJECT:protein_out_of_range';
        end if;
        if v_row.protein_target_g is null or v_value <> v_row.protein_target_g then
          v_changed := true;
        end if;
      end if;

      if not v_changed then
        raise exception 'COACH_REJECT:no_change';
      end if;
      v_valid := v_valid || jsonb_build_object('day', v_day, 'next', v_next);
    end loop;

    -- Every patch passed: write them all.
    foreach v_patch in array v_valid loop
      update public.plan_days d
      set workout = case when (v_patch -> 'next') ? 'workout' then (v_patch -> 'next') -> 'workout' else d.workout end,
          calorie_target = case when (v_patch -> 'next') ? 'calorieTarget' then ((v_patch -> 'next') ->> 'calorieTarget')::integer else d.calorie_target end,
          protein_target_g = case when (v_patch -> 'next') ? 'proteinTargetG' then ((v_patch -> 'next') ->> 'proteinTargetG')::integer else d.protein_target_g end
      where d.plan_id = v_plan_id and d.day_number = (v_patch ->> 'day')::integer;
    end loop;
  exception when raise_exception then
    if sqlerrm like 'COACH_REJECT:%' then
      v_reason := substr(sqlerrm, length('COACH_REJECT:') + 1);
    else
      raise; -- for example an invalid configuration: fail closed, change nothing
    end if;
  end;

  if v_reason is not null then
    update public.coach_proposals set status = 'stale', decision_reason = v_reason, decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'stale', 'reason', v_reason);
  end if;

  select array_agg(d order by d) into v_days from unnest(v_days) d;
  update public.coach_proposals set status = 'accepted', decided_at = now(), applied_days = v_days, decision_reason = null where id = p_proposal_id;
  return jsonb_build_object('status', 'accepted', 'changed_days', to_jsonb(v_days));
end;
$$;
