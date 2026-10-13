-- Optional inputs for the plan's calorie estimate. Nullable so Phase 1 profiles stay valid.
-- energy_sex is used only by the published Mifflin-St Jeor equation, not as a gender identity field.
alter table public.profiles
  add column energy_sex text check (energy_sex in ('male', 'female', 'undisclosed')),
  add column activity_level text check (activity_level in ('sedentary', 'light', 'active'));
