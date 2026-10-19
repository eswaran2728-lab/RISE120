-- Roadmap C3. Swapping the remaining sets of one exercise in a started session, and finishing the session.
--
--   * The started snapshot stays immutable. A swap is a separate, append-only record; the current exercise list is
--     the snapshot with the swaps applied in order. Sets already logged for the original exercise are never
--     touched: they stay under it and the swap moves only what is left.
--   * Every swap names the revision it was made against. A stale revision is refused, so two phones cannot silently
--     overwrite each other. A repeat of the same request id returns the same answer and changes nothing.
--   * A replacement must be a published, reviewed alternative of the exercise, usable with the member's equipment
--     where the session happens, and not already in the session.
--   * Completing records a summary of the sets actually logged (not the planned volume), exactly once.

alter table public.workout_sessions add column revision integer not null default 0 check (revision >= 0);
alter table public.workout_sessions add column summary jsonb;

create table public.workout_session_swaps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  request_id uuid not null,
  revision integer not null check (revision >= 1), -- the session revision after this swap
  from_exercise_id text not null,
  to_exercise_id text not null,
  to_snapshot jsonb not null, -- name, pattern and equipment of the replacement when it was chosen
  completed_sets integer not null check (completed_sets >= 0), -- sets of the original already logged
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete cascade,
  unique (session_id, request_id),
  unique (session_id, revision)
);

alter table public.workout_session_swaps enable row level security;
create policy "workout_session_swaps_select_own" on public.workout_session_swaps
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.workout_session_swaps from anon, authenticated;
grant select on public.workout_session_swaps to authenticated;

-- A finished session keeps its summary, revision and finish time; the revision never goes backwards.
create or replace function private.workout_session_immutable()
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
     or new.started_at is distinct from old.started_at
     or new.revision < old.revision then
    raise exception 'WORKOUT_SESSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.status = 'completed' and (
       new.status <> 'completed'
       or new.completed_at is distinct from old.completed_at
       or new.summary is distinct from old.summary
       or new.revision is distinct from old.revision) then
    raise exception 'WORKOUT_SESSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- The same rule the app uses to choose a session: at a gym everything is usable; at home only what the member has.
create function private.equipment_allows(p_location text, p_have text, p_need text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_location = 'gym' then true
    when p_have = 'none' then p_need = 'none'
    else p_need in ('home', 'none')
  end;
$$;

-- The session's exercises as they stand: the snapshot with each swap applied in order. An original exercise with
-- sets already done stays in the list (marked kept) with exactly those sets.
create function private.session_effective_exercises(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
  v_swap record;
  v_entry record;
  v_new jsonb;
begin
  select snapshot -> 'exercises' into v_list from public.workout_sessions where id = p_session_id;
  if v_list is null then
    return null;
  end if;
  for v_swap in select * from public.workout_session_swaps where session_id = p_session_id order by revision loop
    v_new := '[]'::jsonb;
    for v_entry in select value as x from jsonb_array_elements(v_list) with ordinality order by ordinality loop
      if v_entry.x ->> 'exerciseId' = v_swap.from_exercise_id and coalesce((v_entry.x ->> 'kept')::boolean, false) = false then
        if v_swap.completed_sets > 0 then
          v_new := v_new || jsonb_build_array(v_entry.x || jsonb_build_object('sets', v_swap.completed_sets, 'kept', true));
        end if;
        v_new := v_new || jsonb_build_array(
          jsonb_build_object('exerciseId', v_swap.to_exercise_id, 'sets', (v_entry.x ->> 'sets')::integer - v_swap.completed_sets, 'reps', v_entry.x -> 'reps')
          || v_swap.to_snapshot);
      else
        v_new := v_new || jsonb_build_array(v_entry.x);
      end if;
    end loop;
    v_list := v_new;
  end loop;
  return v_list;
end;
$$;
revoke all on function private.session_effective_exercises(uuid) from public, anon, authenticated;

create function public.swap_session_exercise(
  p_user_id uuid,
  p_session_id uuid,
  p_request_id uuid,
  p_expected_revision integer,
  p_from text,
  p_to text
)
returns table (result_status text, result_revision integer, result_exercises jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_list jsonb;
  v_entry jsonb;
  v_done integer;
  v_to public.exercise_versions%rowtype;
  v_from_alternatives text[];
  v_have text;
begin
  perform pg_advisory_xact_lock(hashtextextended('sessionact:' || p_session_id::text, 0));

  select * into v_session from public.workout_sessions where id = p_session_id and user_id = p_user_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- A repeat of an earlier swap request: the same answer, nothing changed.
  if exists (select 1 from public.workout_session_swaps where session_id = p_session_id and request_id = p_request_id) then
    return query select 'existing'::text, v_session.revision, private.session_effective_exercises(p_session_id);
    return;
  end if;

  if v_session.status <> 'active' then
    raise exception 'SESSION_COMPLETED' using errcode = 'P0001';
  end if;
  if v_session.revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT:%', v_session.revision using errcode = 'P0001';
  end if;

  v_list := private.session_effective_exercises(p_session_id);
  select x into v_entry
  from jsonb_array_elements(v_list) as t(x)
  where x ->> 'exerciseId' = p_from and coalesce((x ->> 'kept')::boolean, false) = false
  limit 1;
  if v_entry is null then
    raise exception 'EXERCISE_NOT_IN_SESSION' using errcode = 'P0001';
  end if;

  -- Sets already logged for this exercise in this session stay where they are.
  select least(count(*), (v_entry ->> 'sets')::integer) into v_done
  from public.workout_logs l
  join public.exercise_links k on k.exercise_id = l.exercise_id
  where l.session_id = p_session_id and l.user_id = p_user_id and k.catalogue_id = p_from;
  if (v_entry ->> 'sets')::integer - v_done <= 0 then
    raise exception 'NOTHING_TO_SWAP' using errcode = 'P0001';
  end if;

  select * into v_to from public.exercise_versions where id = p_to and status = 'published' order by version desc limit 1;
  if not found then
    raise exception 'REPLACEMENT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select e.alternatives into v_from_alternatives from public.exercise_versions e where e.id = p_from and e.status = 'published' order by e.version desc limit 1;
  if v_from_alternatives is null or not (p_to = any (v_from_alternatives)) then
    raise exception 'NOT_AN_ALTERNATIVE' using errcode = 'P0001';
  end if;

  if exists (select 1 from jsonb_array_elements(v_list) as t(x) where x ->> 'exerciseId' = p_to) then
    raise exception 'ALREADY_IN_SESSION' using errcode = 'P0001';
  end if;

  select equipment into v_have from public.profiles where id = p_user_id;
  if not private.equipment_allows(v_session.snapshot ->> 'location', coalesce(v_have, 'none'), v_to.equipment) then
    raise exception 'EQUIPMENT_UNSUITABLE' using errcode = 'P0001';
  end if;

  insert into public.workout_session_swaps (session_id, user_id, request_id, revision, from_exercise_id, to_exercise_id, to_snapshot, completed_sets)
  values (p_session_id, p_user_id, p_request_id, v_session.revision + 1, p_from, p_to,
          jsonb_build_object('name', v_to.name, 'pattern', v_to.pattern, 'equipment', v_to.equipment), v_done);
  update public.workout_sessions set revision = revision + 1 where id = p_session_id;

  return query select 'swapped'::text, v_session.revision + 1, private.session_effective_exercises(p_session_id);
end;
$$;
revoke all on function public.swap_session_exercise(uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.swap_session_exercise(uuid, uuid, uuid, integer, text, text) to service_role;

create function public.complete_workout_session(p_user_id uuid, p_session_id uuid)
returns table (result_status text, result_summary jsonb, result_completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_summary jsonb;
  v_sets integer;
  v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended('sessionact:' || p_session_id::text, 0));

  select * into v_session from public.workout_sessions where id = p_session_id and user_id = p_user_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_session.status = 'completed' then
    return query select 'existing'::text, v_session.summary, v_session.completed_at;
    return;
  end if;

  -- What was actually done: every set logged in this session, whatever the plan said.
  select count(*) into v_sets from public.workout_logs where session_id = p_session_id and user_id = p_user_id;
  if v_sets = 0 then
    raise exception 'NOTHING_LOGGED' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'setsCompleted', sum(n)::integer,
           'totalReps', sum(r)::integer,
           'volumeKg', sum(v),
           'byExercise', jsonb_agg(jsonb_build_object('exerciseId', exercise_id, 'name', name, 'sets', n, 'reps', r, 'volumeKg', v) order by name, exercise_id))
    into v_summary
  from (
    select l.exercise_id, ex.name, count(*)::integer as n, sum(l.reps)::integer as r, sum(l.reps * l.weight_kg) as v
    from public.workout_logs l
    join public.exercises ex on ex.id = l.exercise_id
    where l.session_id = p_session_id and l.user_id = p_user_id
    group by l.exercise_id, ex.name
  ) per_exercise;

  update public.workout_sessions set status = 'completed', completed_at = v_now, summary = v_summary where id = p_session_id;
  return query select 'completed'::text, v_summary, v_now;
end;
$$;
revoke all on function public.complete_workout_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_workout_session(uuid, uuid) to service_role;

-- The current exercises and revision of the caller's own session; nothing for anyone else's.
create function public.session_exercises(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('revision', s.revision, 'status', s.status, 'exercises', private.session_effective_exercises(s.id))
  from public.workout_sessions s
  where s.id = p_session_id and s.user_id = (select auth.uid());
$$;
revoke all on function public.session_exercises(uuid) from public, anon;
grant execute on function public.session_exercises(uuid) to authenticated;
