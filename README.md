# Rise120

A 120-day training and nutrition app. One Expo (React Native, TypeScript) codebase, Android first. Backend: Supabase (auth, Postgres with row-level security, edge functions). Languages: English, Bahasa Malaysia, Tamil.

Phase 1 (foundation) covers: project setup, i18n, database schema with row-level security, email and Google sign-in, five-step onboarding with resume, settings, and account deletion.

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

## Edge function

`supabase/functions/delete-account` deletes the calling user (user id comes from the verified JWT only). Deploy:

```
npx supabase functions deploy delete-account --project-ref <project-ref> --no-verify-jwt
```

## Tests and checks

- Unit tests: `npx jest`
- Database and edge function tests (`supabase/tests/`) run against a real Supabase project and need an untracked `.env.test` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Use a development project, never production. They create and delete their own test users.
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`

## Android development build

Google sign-in uses native code, so Expo Go does not work; use a development build.

1. `npx eas-cli login`, then `npx eas-cli init` (once, links the Expo project).
2. Create the Android signing keystore with `npx eas-cli credentials --platform android` and note its SHA-1.
3. In Google Cloud create an Android OAuth client (package `com.eswaran2728.rise120`, that SHA-1) and a Web OAuth client. In Supabase, Authentication, Providers, Google: enable it, put the Web client ID first in Client IDs followed by the Android client ID, and enter the Web client secret.
4. Build: `npx eas-cli build --profile development --platform android`, then install the APK from the link.
5. Run the dev server: `npx expo start --dev-client`.

## Notes

- Tamil and Bahasa Malaysia strings (`src/i18n/locales/ta.json`, `ms.json`) were drafted by an AI agent and still need review by native speakers.
- Every user-facing string goes through `t()`. See `AGENTS.md` for the working rules.
