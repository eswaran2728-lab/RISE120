# Rise120 Phase 2: Core Loop Implementation Plan — approved 2026-10-13

> For Claude Code after approval: use Superpowers `executing-plans` and `test-driven-development`. Work in order. Each task ends with its own commit. Part 4 of `C:\Users\eswaranp\Downloads\Rise120-handoff.pdf` is the source of truth. Do not start Phase 3.

**Goal:** An onboarded Android user receives a 120-day plan, can complete a workout and daily check-in offline, and can view Today and Progress. Reconnection syncs each entry once.

**Architecture:** Keep plan generation on Supabase; clients read plans and days through the existing RLS policies. Store workout/check-in writes locally first in a per-user queue with stable IDs, then sync through the authenticated Supabase client. Screens consume small tested selectors rather than embedding plan or progress rules.

**Tech stack:** Existing Expo Router/React Native/TypeScript, Supabase Edge Functions/Postgres/Storage, Jest, AsyncStorage. Add only SDK-compatible packages needed for photo selection and a small chart after checking current Expo docs.

## Phase 2 rule decisions

Eswar approved the Phase 2 plan, chose additional inputs for a better estimate, and approved the numeric nutrition rules below on 2026-10-13. These are the implementation choices within Part 4's scope:

1. **Nutrition:** Add optional `energy_sex` (`male`, `female`, `undisclosed`) and `activity_level` (`sedentary`, `light`, `active`) to the profile. Explain that `energy_sex` is used only by the published Mifflin–St Jeor equation, not as a gender identity field. The server computes resting energy as `10 × weight_kg + 6.25 × height_cm − 5 × age + 5` for male or `− 161` for female; multiply by `1.4`, `1.6`, or `1.8` for the chosen activity level. Goal changes: lose fat `−300 kcal`, build muscle `+200 kcal`, recomp `0`. Round calories to the nearest 50. Protein targets: lose fat `2.0 × weight_kg`, build muscle `1.6 × weight_kg`, recomp `1.8 × weight_kg` grams, rounded to the nearest 5. These are starting estimates, not prescriptions. When sex is undisclosed, data is missing, or the estimated calories fall below 1,500, leave `calorie_target` null and show a translated message rather than invent a target. No client hardcodes coefficients. Existing onboarded users enter the two values on a short additional screen; they do not repeat onboarding.
2. **Workout:** Three full-body workouts in each seven-day block (days 1, 3, 5), with rest days between. Seed five movement patterns (squat, hinge, push, pull, core) for each equipment option. Initial names: gym = goblet squat, dumbbell Romanian deadlift, chest press machine, seated cable row, plank; home = chair squat, unloaded hip hinge, countertop incline push-up, prone W raise, dead bug; none = bodyweight squat, glute bridge, wall push-up, prone W raise, dead bug. Seed clear instructions and require owner/trainer review before public launch. Beginner gets 2 sets, intermediate 3, advanced 4; lose fat uses 12 reps, build muscle 8, recomp 10. Choose exercises only from the user's equipment group. No prescribed weight; users log what they actually lift.
3. **Progress:** Streak = consecutive local calendar days with a check-in. Today ring = workout completion and check-in completion, each half when a workout is scheduled; a rest day uses check-in only.
4. **Offline conflict:** One check-in per user/local date; latest local edit wins on sync. Workout sets keep a client-generated UUID so replay cannot duplicate them. Pending entries are scoped to the signed-in user.

The exercise and nutrition rules are estimates for generally healthy adults. Show a short, translated health disclaimer beside generated targets and a route to seek professional advice for personal medical needs. The scientific basis is the original [Mifflin–St Jeor paper](https://pubmed.ncbi.nlm.nih.gov/2305711/), the [NIDDK Body Weight Planner inputs and activity range](https://www.niddk.nih.gov/bwp), [protein meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28698222/), and [ACSM resistance training guidance](https://www.acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf). The goal adjustments and 1,500-kcal cutoff are owner-approved product choices, not values directly established by those sources.

## Global constraints

- Additive changes only. Preserve Phase 1 and its `phase-1-foundation` tag.
- Android first, with platform-neutral logic and libraries.
- All user-facing text in English, Malay and Tamil through `t()`; native review remains the owner's task.
- No service-role key, AI key, or other secret in app code or git. The app has only Supabase URL and publishable key.
- Existing `plans` and `plan_days` stay client read-only; all generated writes are server-side. Existing RLS stays enabled.
- No Phase 3 food logging, Phase 4 paywall/limits/ads, or Phase 5 coach work. Display nutrition targets only.
- Each logic change follows RED → GREEN → full suite, then one commit per task. Run `npx tsc --noEmit` and `npm run lint` at each task gate.

## Review focus

1. Calling `generate-plan` twice, including after a partial failure, leaves one plan with exactly 120 unique days.
2. A user cannot generate, read, or mutate another user's plan through the client or edge function.
3. Offline replay or double taps create one workout set/check-in, including after process death.
4. A pending log from account A never syncs under account B, and account deletion removes pending local data and photos.
5. Local date around midnight does not shift the plan day, check-in date, calendar, or streak.

## Existing schema and file map

The Phase 1 schema already has `profiles`, `plans` (unique `user_id`), `plan_days` (unique `plan_id, day_number`), `exercises`, `workout_logs`, and `checkins` (unique `user_id, checkin_date`). `plans` and `plan_days` are client read-only. `workout_logs` and `checkins` have own-row CRUD RLS. Reuse these tables; add migrations only for a real missing invariant or private photo storage. Generate migration filenames with the Supabase CLI.

New focused modules: `supabase/functions/_shared/plan/` (types and pure server generation rules), `src/sync/` (per-user local queue and flush), `src/workout/` (set and summary rules), `src/checkin/` (check-in validation and photo handling), `src/today/` and `src/progress/` (display selectors). Screens: `app/plan-preview.tsx`, `app/(tabs)/today.tsx`, `app/(tabs)/workout.tsx`, `app/checkin.tsx`, `app/(tabs)/progress.tsx`. Backend: `supabase/functions/generate-plan/`, exercise seed migration, private photo bucket/policies migration. Expand `delete-account` when photos are added.

## Tasks

### Task 1 — Add energy-estimate inputs without breaking Phase 1

**Files:** Create a CLI-named profile migration and `app/plan-inputs.tsx`; modify `src/onboarding/draft.ts`, `src/onboarding/submit.ts`, `app/onboarding/[step].tsx`, `app/_layout.tsx`, locale files; add tests beside changed logic and a live migration test.

**Interfaces:** Profile gains nullable `energy_sex` and `activity_level`. `OnboardingDraft` accepts them; existing drafts and profiles remain valid. New sign-ups choose them during onboarding; existing onboarded users are asked once before plan generation. `savePlanInputs(userId, input): Promise<void>` updates only the caller's profile under existing RLS.

- [ ] Tests first: existing profiles still load; missing values route to `plan-inputs`; valid choices persist; another user cannot edit them; `undisclosed` remains a valid choice.
- [ ] Run targeted Jest and live profile test; expect red before implementation.
- [ ] Implement the additive migration and inputs. Keep the fields optional in storage so Phase 1 users are not locked out; run targeted tests green.
- [ ] Run full Jest, TypeScript, lint; commit `feat(profile): add plan energy inputs`.

### Task 2 — Approved plan rules and exercise library

**Files:** Create `supabase/functions/_shared/plan/types.ts`, `supabase/functions/_shared/plan/generate.ts`, `supabase/tests/plan-rules.test.ts`; create a CLI-named migration for the approved exercise seed; add an integration test under `supabase/tests/`.

**Interfaces:** `buildPlanDays(profile: PlanProfile, startDate: string, exercises: Exercise[], nutrition: NutritionRules): PlanDayDraft[]`; exactly 120 ordered days, `day_number` 1–120. `PlanDayDraft` includes the existing `workout` JSON shape, `calorie_target`, and `protein_target_g`.

- [ ] Use the approved workout/nutrition rules and exercise list above. Tests first: 120 days, day 1/start date, every goal/level/equipment combination, rest days, positive targets or intentionally null calories, deterministic output, and no incompatible equipment.
- [ ] Run `npx jest supabase/tests/plan-rules.test.ts --runInBand --watch=false`; expect tests to fail for missing implementation.
- [ ] Implement pure generation and seed migration; run unit and live seed tests. Expect pass, plus unchanged RLS tests.
- [ ] Run full Jest, TypeScript, lint; commit `feat(plan): approved rules and exercise seed`.

### Task 3 — Authenticated, idempotent generate-plan function

**Files:** Create `supabase/functions/generate-plan/index.ts`, `supabase/tests/generate-plan.test.ts`; create a CLI-named migration only if needed for an atomic server operation.

**Interface:** POST `generate-plan` with the caller's JWT and local start date; response `{ planId: string; created: boolean }`. Determine user ID from verified JWT, read that user's profile and the server's exercises, and write only that user's plan and 120 days. Reject unauthenticated and incomplete profiles.

- [ ] Write live tests first: 401 without JWT; other-user ID in body ignored; one plan/120 unique days after two requests; retry repairs or rolls back a partial generation; client cannot write `plans`/`plan_days` directly.
- [ ] Run `npx jest supabase/tests/generate-plan.test.ts --runInBand --watch=false`; expect fail before deploy.
- [ ] Implement, deploy only to Rise120 development, rerun tests to green. Record exact deploy command and target project; do not weaken JWT verification without checking current Supabase guidance.
- [ ] Run full gates; commit `feat(plan): authenticated idempotent generation`.

### Task 4 — Per-user offline queue and no-duplicate sync

**Files:** Create `src/sync/types.ts`, `src/sync/queue.ts`, `src/sync/flush.ts`, tests; modify sign-out/deletion handling only to prevent cross-account replay.

**Interfaces:** `enqueue(userId: string, operation: PendingOperation): Promise<void>`; `listPending(userId: string): Promise<PendingOperation[]>`; `flushPending(userId: string, transport: SyncTransport): Promise<SyncResult>`. A workout operation holds a stable client UUID used as `workout_logs.id`; a check-in operation uses `(user_id, checkin_date)` as its unique server key.

- [ ] Tests first for offline enqueue, process restart, successful flush, retry after a lost response, double tap, same-day check-in edit, failure left pending, account isolation, and deletion clearing local pending data.
- [ ] Run `npx jest src/sync --runInBand --watch=false`; expect fail before implementation.
- [ ] Implement using AsyncStorage keyed by user ID; send authenticated upserts and remove operations only after confirmed success. Ensure a single flush runs per account at a time and app-resume/reconnect triggers retry.
- [ ] Run targeted and full gates; commit `feat(sync): per-user offline logging queue`.

### Task 5 — Workout logging, rest timer and summary

**Files:** Create `src/workout/log.ts`, `src/workout/__tests__/log.test.ts`, `app/(tabs)/workout.tsx`; modify tab layout and locale files.

**Interfaces:** `queueWorkoutSet(userId: string, day: LocalDate, set: WorkoutSetInput): Promise<string>` returns stable log ID; `summarizeSession(sets: WorkoutSet[]): SessionSummary` returns completed sets, reps and volume. Rest timer uses device time, not server time.

- [ ] Tests first for set validation, unit conversion, stable IDs, summary math, and rest timer elapsed time after backgrounding.
- [ ] Run targeted Jest and observe red; implement the exercise list, set entry, timer, and summary using Task 4's queue.
- [ ] Verify offline entry persists and syncs once; run full gates; commit `feat(workout): logging timer and summary`.

### Task 6 — Daily check-in with optional private photo

**Files:** Create `src/checkin/checkin.ts`, tests, `app/checkin.tsx`; create CLI-named migration for a private Storage bucket/policies; modify `delete-account` to remove user photos before auth deletion; add storage/deletion integration tests.

**Interfaces:** `queueCheckin(userId: string, date: LocalDate, input: CheckinInput): Promise<void>`; weight, mood, sleep and optional local photo. A queued photo keeps its local URI until upload succeeds, then `checkins.photo_path` holds the private object path. Use a user-ID folder and authenticated signed URLs for reads.

- [ ] Tests first for 70,5 parsing, invalid weight/sleep, same-day edit, offline photo pending, private access, and delete-account photo cleanup while another user's photo remains. Define the mood scale in the approved check-in contract before testing it.
- [ ] Run targeted tests red; implement storage and screen. Check current Expo ImagePicker/FileSystem APIs before adding SDK-compatible dependencies and make a new dev build if native packages change.
- [ ] Run live RLS/storage/deletion tests and full gates; commit `feat(checkin): offline daily check-in and private photos`.

### Task 7 — Plan preview and Today

**Files:** Create `src/today/selectors.ts`, tests, `app/plan-preview.tsx`; modify `app/(tabs)/today.tsx`, routing, and locales.

**Interfaces:** `getPlanDay(plan: Plan, days: PlanDay[], localDate: LocalDate): PlanDay | null`; `deriveToday(day, workoutLogs, checkin): TodayState`; `checkinStreak(checkins, localDate): number`. Today shows today's workout, calorie/protein targets, progress ring, streak, and check-in action. Plan preview appears after generation and before Day 1.

- [ ] Tests first for day 1/day 120, date boundary, rest day, completed workout/check-in ring, and consecutive-day streak (including a missed day).
- [ ] Run targeted Jest red; implement server read + offline overlay and screens; use `t()` throughout.
- [ ] Run full gates; commit `feat(today): plan preview and daily dashboard`.

### Task 8 — Progress history, chart, calendar and photo timeline

**Files:** Create `src/progress/selectors.ts`, tests, `app/(tabs)/progress.tsx`; modify tabs and locales.

**Interfaces:** `deriveProgress(plan, days, workoutLogs, checkins, pending): ProgressState` produces weight points, check-in/photo history, and 120 calendar cells. Pending local entries appear once and are visibly marked pending.

- [ ] Tests first for sparse weights, day 1/120, timezone boundary, duplicate server+pending events, and a private photo from another user not appearing.
- [ ] Run targeted Jest red; implement a compact accessible weight chart, history, photo timeline and calendar. Use a small Expo-compatible chart dependency only if needed.
- [ ] Run full gates; commit `feat(progress): weight and 120-day history`.

### Task 9 — Phase 2 checkpoint

**Files:** Modify `README.md` with generation, storage, sync, environment variable names and build steps; add or update integration tests only for discovered gaps.

- [ ] Run all Jest tests, `npx tsc --noEmit`, `npm run lint`, and `npx expo export --platform android`; require all green. Check migrations, RLS and Storage isolation on the Rise120 development project.
- [ ] Fresh review of the whole Phase 2 diff against Part 4 and the five Review Focus cases; fix important findings with RED→GREEN tests.
- [ ] Commit `docs: Phase 2 setup and verification` and report exact commands/results.
- [ ] Android device checklist: plan preview and 120 days; Today target/workout/streak/ring; log a set and check-in offline, restart, reconnect and see one copy; rest timer and session summary; weight chart, history, calendar, private photo; sign out/in with no cross-account pending data. Do not claim device pass until Eswar reports it.
- [ ] After Eswar confirms device checks, create annotated tag `phase-2-core-loop` on the checkpoint commit and push the tag. Stop before Phase 3.

## Scope and risk notes

- Phase 2 displays nutrition targets but does not implement food search/logging or remaining macros. That is Phase 3.
- Free-day locking belongs to Phase 4; generating all 120 days here does not grant a free user access policy yet.
- Photo storage is sensitive. The bucket must be private, with user-scoped RLS and cleanup on account deletion. Do not put service-role credentials in the app.
- Existing `delete-account` currently deletes database rows but not Storage files; Task 6 must close that gap before photo upload ships.
