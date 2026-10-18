-- Roadmap C3 (link). A reviewed catalogue exercise (text id, versioned) is mapped to exactly one row of
-- public.exercises, the table that workout logs, history and progress already reference by uuid. Nothing about
-- existing logs changes. A logged set may also say which started session it belongs to, and only to the same
-- member's own session.

create table public.exercise_links (
  catalogue_id text primary key check (catalogue_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- The catalogue id must name a real catalogue exercise (the catalogue is keyed by id and version, so a plain
-- foreign key cannot express it).
create or replace function private.exercise_link_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.exercise_versions e where e.id = new.catalogue_id) then
    raise exception 'UNKNOWN_CATALOGUE_EXERCISE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger exercise_links_check before insert or update on public.exercise_links
  for each row execute function private.exercise_link_check();

alter table public.exercise_links enable row level security;
create policy "exercise_links_read" on public.exercise_links for select to authenticated using (true);
revoke all on public.exercise_links from anon, authenticated;
grant select on public.exercise_links to authenticated;

-- A set can belong to a started session, but only the member's own.
alter table public.workout_sessions add constraint workout_sessions_id_user_key unique (id, user_id);
alter table public.workout_logs add column session_id uuid;
alter table public.workout_logs
  add constraint workout_logs_session_owner_fkey foreign key (session_id, user_id)
  references public.workout_sessions (id, user_id) on delete set null (session_id);
create index workout_logs_session_idx on public.workout_logs (session_id) where session_id is not null;
