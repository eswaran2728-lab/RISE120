-- Atomic import of APPROVED guided-workout content. One call, one transaction: every write or none.
--
-- The caller (scripts/import-training-content.ts, service role only) sends the exact plan its dry run showed. Inside the
-- transaction this function:
--   * takes a lock, so two imports cannot interleave;
--   * rechecks every step against the rows as they are NOW: an insert needs the row to be absent (or already
--     identical, which is a no-op replay); an update needs the stored row to still equal what the dry run saw and not
--     to be published yet; a link needs to be absent or identical. Anything else raises PLAN_STALE and rolls back all;
--   * writes only exercise_versions, session_templates and exercise_links (any other table raises INVALID_PLAN);
--   * publishes only: a row whose status is not 'published' raises INVALID_PLAN;
--   * sets published_at from database time (now(), one value for the whole import) when an item first becomes
--     published, keeps a published_at that already exists, and never touches a row that is already identical.
-- It never touches workout_logs or public.exercises. Any failure, including a constraint, rolls everything back.

create function private.json_row_contains(p_current jsonb, p_expected jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_current is not null
    and not exists (select 1 from jsonb_each(p_expected) e where p_current -> e.key is distinct from e.value);
$$;
revoke all on function private.json_row_contains(jsonb, jsonb) from public, anon, authenticated;

create function public.import_guided_catalogue(p_ops jsonb, p_plan_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op jsonb;
  v_kind text;
  v_table text;
  v_row jsonb;
  v_prev jsonb;
  v_cur jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if p_plan_hash is null or p_plan_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_PLAN: plan hash' using errcode = 'P0001';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'INVALID_PLAN: operations' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guided-catalogue-import', 0));

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_kind := v_op ->> 'kind';
    v_table := v_op ->> 'table';
    v_row := v_op -> 'row';
    v_prev := v_op -> 'previous';

    if v_kind is null or v_kind not in ('insert', 'update')
       or v_table is null or v_table not in ('exercise_versions', 'session_templates', 'exercise_links')
       or v_row is null or jsonb_typeof(v_row) <> 'object' then
      raise exception 'INVALID_PLAN: operation' using errcode = 'P0001';
    end if;
    if v_table <> 'exercise_links' and coalesce(v_row ->> 'status', '') <> 'published' then
      raise exception 'INVALID_PLAN: only published rows may be imported' using errcode = 'P0001';
    end if;
    if v_table = 'exercise_links' and v_kind <> 'insert' then
      raise exception 'INVALID_PLAN: links are insert-only' using errcode = 'P0001';
    end if;
    if v_kind = 'update' and (v_prev is null or jsonb_typeof(v_prev) <> 'object') then
      raise exception 'INVALID_PLAN: update without its starting row' using errcode = 'P0001';
    end if;

    -- The row as it is now.
    v_cur := null;
    if v_table = 'exercise_versions' then
      select to_jsonb(e) into v_cur from public.exercise_versions e where e.id = v_row ->> 'id' and e.version = (v_row ->> 'version')::integer;
    elsif v_table = 'session_templates' then
      select to_jsonb(s) into v_cur from public.session_templates s where s.id = v_row ->> 'id' and s.version = (v_row ->> 'version')::integer;
    else
      select to_jsonb(l) into v_cur from public.exercise_links l where l.catalogue_id = v_row ->> 'catalogue_id';
    end if;

    -- Already exactly what the plan wants: a replay, nothing to write and published_at stays as it is.
    if v_cur is not null and private.json_row_contains(v_cur, v_row) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_kind = 'insert' then
      if v_cur is not null then
        raise exception 'PLAN_STALE: % % already exists with different content', v_table, coalesce(v_row ->> 'id', v_row ->> 'catalogue_id') using errcode = 'P0001';
      end if;
      if v_table = 'exercise_versions' then
        insert into public.exercise_versions (id, version, pattern, equipment, name, cues, regressions, alternatives, media, reviewer, status, published_at)
        select r.id, r.version, r.pattern, r.equipment, r.name, r.cues, r.regressions, r.alternatives, r.media, r.reviewer, r.status, now()
        from jsonb_populate_record(null::public.exercise_versions, v_row) r;
      elsif v_table = 'session_templates' then
        insert into public.session_templates (id, version, goal, level, minutes, location, day_type, exercises, reviewer, status, published_at)
        select r.id, r.version, r.goal, r.level, r.minutes, r.location, r.day_type, r.exercises, r.reviewer, r.status, now()
        from jsonb_populate_record(null::public.session_templates, v_row) r;
      else
        insert into public.exercise_links (catalogue_id, exercise_id)
        select r.catalogue_id, r.exercise_id from jsonb_populate_record(null::public.exercise_links, v_row) r;
      end if;
      v_inserted := v_inserted + 1;
    else
      -- An update only moves a row that is still unpublished and still what the dry run saw.
      if v_cur is null or coalesce(v_cur ->> 'status', '') = 'published' or not private.json_row_contains(v_cur, v_prev) then
        raise exception 'PLAN_STALE: % % changed after the dry run', v_table, v_row ->> 'id' using errcode = 'P0001';
      end if;
      if v_table = 'exercise_versions' then
        update public.exercise_versions e
        set pattern = r.pattern, equipment = r.equipment, name = r.name, cues = r.cues, regressions = r.regressions, alternatives = r.alternatives,
            media = r.media, reviewer = r.reviewer, status = r.status, published_at = coalesce(e.published_at, now())
        from jsonb_populate_record(null::public.exercise_versions, v_row) r
        where e.id = r.id and e.version = r.version;
      else
        update public.session_templates s
        set goal = r.goal, level = r.level, minutes = r.minutes, location = r.location, day_type = r.day_type, exercises = r.exercises,
            reviewer = r.reviewer, status = r.status, published_at = coalesce(s.published_at, now())
        from jsonb_populate_record(null::public.session_templates, v_row) r
        where s.id = r.id and s.version = r.version;
      end if;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
revoke all on function public.import_guided_catalogue(jsonb, text) from public, anon, authenticated;
grant execute on function public.import_guided_catalogue(jsonb, text) to service_role;
