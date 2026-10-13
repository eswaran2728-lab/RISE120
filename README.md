# Rise120

A 120-day training and nutrition app. One Expo (React Native, TypeScript) codebase, Android first. Backend: Supabase (auth, Postgres with row-level security, edge functions). Languages: English, Bahasa Malaysia, Tamil.

Phase 1 (foundation) covers: project setup, i18n, database schema with row-level security, email and Google sign-in, five-step onboarding with resume, settings, and account deletion.

Phase 2 (core loop) covers: a generated 120-day plan, Today, Workout (sets, rest timer, summary), a daily check-in with an optional private photo, and Progress (weight chart, history, photo timeline, 120-day calendar). Logging is offline-first: entries are saved on the phone and synced later, once each.

## Setup

1. Install dependencies: `npm install`
2. Create an untracked `.env.local` in the repo root (copy `.env.example`) with:

   | Variable | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `EXPO_PUBLIC_SUPABASE_KEY` | Supabase **publishable** key (never the service-role or secret key) |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth **Web** client ID |

   `.env*` files are git-ignored (only `.env.example` is tracked). The app ships only the URL and publishable key; secrets stay in edge function secrets or local untracked files.
3. For builds, set the same three variables in the EAS `development` environment: `npx eas-cli env:create --environment development --name <NAME> --visibility plaintext` (EAS does not upload git-ignored files).

## Auth setting to know about

If "Confirm email" is on in Supabase (the hosted default), email sign-up shows a "check your email" message and the user must confirm before signing in. For quick development tests you can turn it off under Authentication, Providers, Email.

## Database

Migrations are in `supabase/migrations/` (`0001_core.sql` tables, `0002_rls.sql` policies, `0003_triggers_seed.sql` signup trigger and `app_config` seed). Apply with `npx supabase db push`. Plan limits live in the server `app_config` table and are not hardcoded in the app.

## Phase 2: how it works

**Plan generation.** The `generate-plan` edge function builds the signed-in user's plan on the server from their profile (goal, level, equipment, age, height, weight, and the optional `energy_sex` / `activity_level` used for the Mifflin-St Jeor calorie estimate). The rules live only in `supabase/functions/_shared/plan/` (no coefficients in the app): three full-body workouts per seven-day block, sets by level, reps by goal, exercises only from the user's equipment group, and calorie and protein targets. Calories are left empty when sex is undisclosed, data is missing, or the estimate is below 1,500 kcal. These are starting estimates, not medical advice. The function is idempotent: one plan per user, 120 unique days, and a retry only fills in missing days. Clients read `plans` and `plan_days` but cannot write them.

**Offline sync.** Workout sets and check-ins are written to a per-user queue in AsyncStorage first (`src/sync/`). Each set has a stable id (user, date, exercise, set number), and a check-in is keyed by user and date, so replays never duplicate. The queue flushes on app start, when the app returns to the foreground, and every 30 seconds. Pending entries are only ever sent under the account that created them. Account deletion removes that account's pending entries, cached data and local photos. The last plan, profile flags, units and synced sets are cached per account so the app still opens and logs with no signal.

**Photos.** Check-in photos are private: bucket `checkin-photos`, objects at `<user id>/<date>.jpg`, readable only by that user, shown through short-lived signed URLs. Photos are downsized and re-encoded before upload. `delete-account` removes a user's photos before deleting the user.

**Migrations added in Phase 2** (apply with `npx supabase db push`): profile energy inputs, exercise seed, `create_plan_with_days` (atomic, service role only) and its column fix, and the check-in photo bucket with a 1 to 5 mood range. The exercise instructions are starter text and need owner or trainer review before public launch.

## Edge functions

Both functions verify the caller's JWT inside the function (user id comes from the token only, never the body), so they are deployed with `--no-verify-jwt`:

- `supabase/functions/delete-account` deletes the calling user and their stored photos.
- `supabase/functions/generate-plan` creates the calling user's plan (see above).

```
npx supabase functions deploy delete-account --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy generate-plan --project-ref <project-ref> --no-verify-jwt --use-api
```

Deploy and run the database tests against a development project only.

## Tests and checks

- Unit tests: `npx jest`
- Database and edge function tests (`supabase/tests/`) run against a real Supabase project and need an untracked `.env.test` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Use a development project, never production. They create and delete their own test users. Phase 2 adds live tests for plan generation, the exercise seed, profile inputs, and photo storage and deletion.
- Android bundle check: `npx expo export --platform android`
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`

## Android development build

Google sign-in and the Phase 2 photo and chart packages (`expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `react-native-svg`) use native code, so Expo Go does not work, and an older development build must be rebuilt after Phase 2 for those packages to be present.

1. `npx eas-cli login`, then `npx eas-cli init` (once, links the Expo project).
2. Create the Android signing keystore with `npx eas-cli credentials --platform android` and note its SHA-1.
3. In Google Cloud create an Android OAuth client (package `com.eswaran2728.rise120`, that SHA-1) and a Web OAuth client. In Supabase, Authentication, Providers, Google: enable it, put the Web client ID first in Client IDs followed by the Android client ID, and enter the Web client secret.
4. Build: `npx eas-cli build --profile development --platform android`, then install the APK from the link.
5. Run the dev server: `npx expo start --dev-client`.

## Notes

- Tamil and Bahasa Malaysia strings (`src/i18n/locales/ta.json`, `ms.json`) were drafted by an AI agent and still need review by native speakers.
- Plan numbers (calories, protein, sets, reps) are generic estimates for healthy adults. The app shows a translated health disclaimer beside them.
- Every user-facing string goes through `t()`. See `AGENTS.md` for the working rules.
