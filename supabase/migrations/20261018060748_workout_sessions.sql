-- Roadmap C2: starting a workout session stores an owned, immutable snapshot of a published session template.
--
-- A member can read their own sessions and nobody can write one through the Data API; sessions are created only
-- by public.start_workout_session (service role, called from the start-session endpoint). The snapshot copies the
-- template and each exercise's name, pattern and equipment at the moment of starting, so later edits or
-- withdrawal of the template never change a session that has begun. Only status and completed_at may change
-- afterwards (completion is roadmap C3).
--
-- Rules enforced here, not in the app:
--   * the same (account, request id) always answers with the same session (a retry after a lost answer);
--   * one active session per account, plan and day: another request that day resumes it;
--   * the plan must be the account's own and still active, the day not in the future and one the account can
--     currently open (free members: the first free_plan_days days);
--   * the template must be published, and every exercise it names must be published.

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  day_number integer not null check (day_number between 1 and 120),
  request_id uuid not null,
  template_id text not null,
  template_version integer not null,
  snapshot jsonb not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (plan_id, user_id) references public.plans(id, user_id) on delete cascade,
  unique (user_id, request_id)
);
create unique index workout_sessions_one_active_per_day on public.workout_sessions (user_id, plan_id, day_number) where status = 'active';

alter table public.workout_sessions enable row level security;
create policy "workout_sessions_select_own" on public.workout_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.workout_sessions from anon, authenticated;
grant select on public.workout_sessions to authenticated;

-- Nothing about what was started can change; a session can only be completed.
create function private.workout_session_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.plan_id is distinct from old.plan_id
     or new.day_number is distinct from old.day_number
     or new.request_id is distinct from old.request_id
     or new.template_id is distinct from old.template_id
     or new.template_version is distinct from old.template_version
     or new.snapshot is distinct from old.snapshot
     or new.started_at is distinct from old.started_at then
    raise exception 'WORKOUT_SESSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'WORKOUT_SESSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.workout_session_immutable() from public, anon, authenticated;
create trigger workout_sessions_immutable
  before update on public.workout_sessions
  for each row execute function private.workout_session_immutable();

create function public.start_workout_session(
  p_user_id uuid,
  p_request_id uuid,
  p_plan_id uuid,
  p_day_number integer,
  p_template_id text,
  p_template_version integer
)
returns table (result_session_id uuid, result_status text, result_snapshot jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_existing public.workout_sessions%rowtype;
  v_template public.session_templates%rowtype;
  v_snapshot jsonb;
  v_expected integer;
  v_today integer;
  v_access integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('session:' || p_user_id::text, 0));

  -- A repeat of an earlier request: the same session.
  select * into v_existing from public.workout_sessions where user_id = p_user_id and request_id = p_request_id;
  if found then
    return query select v_existing.id, 'existing'::text, v_existing.snapshot;
    return;
  end if;

  select * into v_plan from public.plans where id = p_plan_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Not in the future (one day of slack covers every time zone), and a day this account can currently open.
  v_today := private.quota_day() - v_plan.start_date + 1;
  v_access := case when private.is_premium(p_user_id) then 120 else private.config_int('free_plan_days') end;
  if p_day_number > v_today + 1 or p_day_number > v_access then
    raise exception 'DAY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Another request for the same day resumes the session that is already active.
  select * into v_existing from public.workout_sessions
  where user_id = p_user_id and plan_id = p_plan_id and day_number = p_day_number and status = 'active';
  if found then
    return query select v_existing.id, 'resumed'::text, v_existing.snapshot;
    return;
  end if;

  select * into v_template from public.session_templates
  where id = p_template_id and version = p_template_version and status = 'published';
  if not found then
    raise exception 'TEMPLATE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Every exercise must be published (the newest published version of each is used).
  select jsonb_agg(
           jsonb_build_object(
             'exerciseId', x ->> 'exerciseId',
             'sets', (x ->> 'sets')::integer,
             'reps', (x ->> 'reps')::integer,
             'name', ev.name,
             'pattern', ev.pattern,
             'equipment', ev.equipment
           ) order by ord)
    into v_snapshot
  from jsonb_array_elements(v_template.exercises) with ordinality as t(x, ord)
  left join lateral (
    select e.name, e.pattern, e.equipment
    from public.exercise_versions e
    where e.id = x ->> 'exerciseId' and e.status = 'published'
    order by e.version desc
    limit 1
  ) ev on true;
  select count(*) into v_expected from jsonb_array_elements(v_template.exercises);
  if v_snapshot is null or jsonb_array_length(v_snapshot) <> v_expected
     or exists (select 1 from jsonb_array_elements(v_snapshot) s where s -> 'name' = 'null'::jsonb or s -> 'pattern' = 'null'::jsonb) then
    raise exception 'TEMPLATE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_snapshot := jsonb_build_object(
    'templateId', v_template.id,
    'version', v_template.version,
    'minutes', v_template.minutes,
    'goal', v_template.goal,
    'level', v_template.level,
    'location', v_template.location,
    'dayType', v_template.day_type,
    'exercises', v_snapshot
  );

  insert into public.workout_sessions (user_id, plan_id, day_number, request_id, template_id, template_version, snapshot)
  values (p_user_id, p_plan_id, p_day_number, p_request_id, v_template.id, v_template.version, v_snapshot)
  returning id into v_id;

  return query select v_id, 'created'::text, v_snapshot;
end;
$$;
revoke all on function public.start_workout_session(uuid, uuid, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.start_workout_session(uuid, uuid, uuid, integer, text, integer) to service_role;
