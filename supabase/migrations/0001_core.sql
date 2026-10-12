-- Core Rise120 schema. Policies are added in 0002_rls.sql (Phase 1 Task 3).
-- RLS starts enabled so these tables are never exposed without policies.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  age integer check (age between 18 and 80),
  height_cm numeric check (height_cm between 120 and 230),
  weight_kg numeric check (weight_kg between 30 and 300),
  goal text check (goal in ('lose_fat', 'build_muscle', 'recomp')),
  training_level text check (training_level in ('beginner', 'intermediate', 'advanced')),
  equipment text check (equipment in ('gym', 'home', 'none')),
  food_preferences text[] not null default '{}',
  language text not null default 'en' check (language in ('en', 'ms', 'ta')),
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  start_date date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.plan_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  day_number integer not null check (day_number between 1 and 120),
  workout jsonb,
  calorie_target integer check (calorie_target > 0),
  protein_target_g integer check (protein_target_g > 0),
  created_at timestamptz not null default now(),
  unique (plan_id, day_number),
  foreign key (plan_id, user_id) references public.plans(id, user_id) on delete cascade
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text not null,
  equipment text not null,
  instructions text not null,
  created_at timestamptz not null default now()
);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  reps integer not null check (reps >= 0),
  weight_kg numeric not null check (weight_kg >= 0),
  created_at timestamptz not null default now()
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  serving_desc text not null,
  calories numeric not null check (calories >= 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  source text not null,
  verified boolean not null default false,
  region text,
  created_at timestamptz not null default now()
);

create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  food_id uuid not null references public.foods(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  weight_kg numeric check (weight_kg between 30 and 300),
  mood integer,
  sleep_hours numeric check (sleep_hours >= 0 and sleep_hours <= 24),
  photo_path text,
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  source text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.usage_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  food_logs integer not null default 0 check (food_logs >= 0),
  ai_messages integer not null default 0 check (ai_messages >= 0),
  ad_rewards integer not null default 0 check (ad_rewards >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, usage_date)
);

create table public.app_config (
  key text primary key,
  value jsonb not null
);

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.foods enable row level security;
alter table public.food_logs enable row level security;
alter table public.checkins enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_daily enable row level security;
alter table public.app_config enable row level security;
