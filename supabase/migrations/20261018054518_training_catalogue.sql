-- Roadmap C1: the reviewed training catalogue.
--
-- exercise_versions and session_templates hold content written and reviewed by people (the validator in
-- src/workout/catalogue.ts and scripts/training-content checks the files before they are imported). A signed-in
-- member can READ rows that are published; nobody but the server can write. The database also refuses to
-- publish an item without a reviewer, a licensed demonstration and cues, so a bad import cannot put unreviewed
-- content in front of a member. Drafts and items in review may be incomplete and are invisible to members.
--
-- These tables are separate from public.exercises (the seed the generated plans reference by uuid). Linking a
-- published exercise version to those rows, and choosing sessions from this catalogue, belong to roadmap C2.

create table public.exercise_versions (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  version integer not null check (version >= 1),
  pattern text not null check (pattern in ('squat', 'hinge', 'push', 'pull', 'core')),
  equipment text not null check (equipment in ('gym', 'home', 'none')),
  name jsonb not null,
  cues jsonb not null default '[]'::jsonb,
  regressions text[] not null default '{}',
  alternatives text[] not null default '{}',
  media jsonb,
  reviewer jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint exercise_versions_published_complete check (
    status <> 'published' or (
      reviewer is not null
      and coalesce(reviewer ->> 'name', '') <> ''
      and coalesce(reviewer ->> 'role', '') <> ''
      and coalesce(reviewer ->> 'reviewedOn', '') <> ''
      and media is not null
      and coalesce(media ->> 'licence', '') <> ''
      and coalesce(media ->> 'source', '') <> ''
      and jsonb_typeof(cues) = 'array'
      and jsonb_array_length(cues) >= 2
      and coalesce(name ->> 'en', '') <> ''
      and coalesce(name ->> 'ms', '') <> ''
      and coalesce(name ->> 'ta', '') <> ''
    )
  )
);

create table public.session_templates (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  version integer not null check (version >= 1),
  goal text not null check (goal in ('lose_fat', 'build_muscle', 'recomp')),
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  minutes integer not null check (minutes in (10, 20, 30, 45, 60)),
  location text not null check (location in ('home', 'gym')),
  day_type text not null check (day_type in ('training', 'recovery')),
  exercises jsonb not null,
  reviewer jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint session_templates_exercises_array check (jsonb_typeof(exercises) = 'array' and jsonb_array_length(exercises) >= 1),
  constraint session_templates_published_complete check (
    status <> 'published' or (
      reviewer is not null
      and coalesce(reviewer ->> 'name', '') <> ''
      and coalesce(reviewer ->> 'role', '') <> ''
      and coalesce(reviewer ->> 'reviewedOn', '') <> ''
    )
  )
);

alter table public.exercise_versions enable row level security;
alter table public.session_templates enable row level security;

create policy "exercise_versions_read_published" on public.exercise_versions
  for select to authenticated
  using (status = 'published');
create policy "session_templates_read_published" on public.session_templates
  for select to authenticated
  using (status = 'published');

revoke all on public.exercise_versions from anon, authenticated;
revoke all on public.session_templates from anon, authenticated;
grant select on public.exercise_versions to authenticated;
grant select on public.session_templates to authenticated;
