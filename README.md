# Rise120

A 120-day training and nutrition app. One Expo (React Native, TypeScript) codebase, Android first. Backend: Supabase (auth, Postgres with row-level security, edge functions). Languages: English, Bahasa Malaysia, Tamil.

Phase 1 (foundation) covers: project setup, i18n, database schema with row-level security, email and Google sign-in, five-step onboarding with resume, settings, and account deletion.

Phase 2 (core loop) covers: a generated 120-day plan, Today, Workout (sets, rest timer, summary), a daily check-in with an optional private photo, and Progress (weight chart, history, photo timeline, 120-day calendar). Logging is offline-first: entries are saved on the phone and synced later, once each.

Phase 3 (food) covers: a Food tab with four meals, consumed and remaining calories and protein, stored-food search with Malaysian foods ranked first once a reviewed seed exists, worldwide discovery through USDA FoodData Central, private custom foods, offline meal logging, and a read-only barcode lookup. **Phase 3 is not complete**: see "Phase 3 open gates" below.

Phase 4 (monetisation) covers: free limits enforced by the database, a Google Play purchase flow through RevenueCat, rewarded ads verified by Google's server callback, and offline handling for food logs refused by the limit. **Phase 4 is code complete but not verified with real services**: see "Phase 4: monetisation" below.

## Setup

1. Install dependencies: `npm install`
2. Create an untracked `.env.local` in the repo root (copy `.env.example`) with:

   | Variable | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `EXPO_PUBLIC_SUPABASE_KEY` | Supabase **publishable** key (never the service-role or secret key) |
   | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth **Web** client ID |

   Optional public build settings for purchases and ads (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID`, `ADMOB_ANDROID_APP_ID`) are described in `.env.example` and "Phase 4" below. Leave them unset to run without purchases and with Google test ads in development builds.

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

## Phase 3: food (open gates below)

**Data model.** `foods` gains stable source ids, a barcode, a source URL and reviewed English, Malay and Tamil aliases; a food is unique per user and source id (and per source id when shared). Only a reviewed Malaysian food may be `verified = true`, and the app never sets it: the database refuses a client trying to. A user cannot delete a food that meal logs still reference. Meal logs are `food_logs` (quantity is the number of listed servings).

**Search.** Stored foods first (own and shared, under row-level security), ranked so a matching verified Malaysian food comes first and matching aliases in any supported language count. Worldwide discovery is an explicit "Search worldwide (USDA)" step through the `search-foods` function; a chosen result is saved as the user's own unverified food keyed by its FDC id. If the server cannot be reached, search falls back to this account's recent foods, keeping each food's source and verified label.

**Offline meal logging.** A meal is saved to the per-user queue first with a stable id, and edits and deletes work offline (a delete is a tombstone until the server confirms). The queue replays each change once. The last synced day and the foods used are cached per account for offline use, and are removed on account deletion. Meals stay on the local day they were logged for. Creating a new custom or USDA food needs a connection; logging a food the phone already knows does not.

**Nutrition values.** Missing nutrients are never turned into zeros: a blank field is rejected, USDA and Open Food Facts records with a missing nutrient, mixed units, or energy that does not match protein, carbs and fat are skipped or reported as incomplete. USDA values are shown per 100 g (or per a branded serving stated in grams); the serving size and source are always visible.

**Barcode scanning.** `expo-camera` reads EAN-13, UPC-A and EAN-8. `lookup-barcode` asks Open Food Facts and returns an unverified, source-labelled preview. It is **read-only**: nothing from Open Food Facts is stored, cached or loggable until the owner approves a compliant reuse approach (see `docs/food/curation-review.md`). The app needs a new development build for the camera package.

**Server configuration (names only, never commit values).** Set as Supabase function secrets for the target project, for example `npx supabase secrets set NAME=value --project-ref <ref>`:

| Secret | Used by | Without it |
| --- | --- | --- |
| `USDA_FDC_API_KEY` | `search-foods` | the function answers 503 and worldwide search shows "not available yet" |
| `OFF_CONTACT` | `lookup-barcode` | the function answers 503 and never calls Open Food Facts |

`OFF_CONTACT` is a real contact email or URL that Open Food Facts can reach; it goes in the User-Agent (`Rise120/1.0 (contact)`). Open Food Facts allows about 15 product lookups per minute per IP, and the function's outbound IP is shared by all users, so heavy use may hit that limit.

**Migrations added in Phase 3:** `food_model_provenance` (provenance columns, uniqueness, search index, and the safer delete rule) and `food_logs_food_visibility` (a meal log may only reference a shared food or the caller's own food, enforced by the database for inserts, upserts and updates). Apply with `npx supabase db push`.

### Phase 3 open gates

Phase 3 cannot be called complete until all of these are closed. None is a code task:

1. **Reviewed Malaysian seed.** `docs/food/curated-candidates.csv` has 20 names only. The owner must supply or approve serving sizes, nutrition values, sources, reuse permission evidence and Malay and Tamil names; see `docs/food/curation-review.md`. No verified seed exists or is deployed.
2. **Open Food Facts reuse decision.** The owner must choose how (or whether) Open Food Facts data may be stored; see the same document. Until then lookup stays read-only.
3. **USDA key.** `USDA_FDC_API_KEY` is not set on the development project, so live USDA discovery has not been exercised (the code is tested against mocked responses).
4. **Open Food Facts contact.** `OFF_CONTACT` is not set, so live barcode lookup has not been exercised.
5. **Phone checks.** Deferred to the final cross-phase device pass.

## Phase 4: monetisation (code complete; real-service checks open)

Free users get 14 plan days, 3 food logs per UTC day and (from Phase 5) 1 AI message per day; one verified rewarded ad adds 2 food logs or 1 AI message, up to 3 ads per UTC day; premium removes the limits. **Every number comes from the server `app_config` table; the app holds none.** The server decides everything: the app displays what `check-limit` returns and never grants access or credit itself.

**Phase 4 is not verified end to end.** The code is finished, reviewed and tested against mocks and the development database, and a development build compiles. No real Google Play purchase, RevenueCat webhook delivery, AdMob ad or Google verification callback has ever run. See "Phase 4 verification levels" and "Phase 4 open gates" below.

### How it works

- **Food limit (database).** A trigger on `food_logs` admits an insert only if the user is premium or still has free capacity for the current UTC day (`app_config` base plus today's verified ad credits). It runs per user and day under an advisory lock, so two inserts for the last slot cannot both win, and re-sending a log with an existing id spends no slot. A refused insert raises `FOOD_LIMIT_REACHED` with the next 00:00 UTC as a hint. `usage_daily` mirrors the counts; clients cannot write it.
- **Plan-day lock.** A row-level-security rule on `plan_days` shows a free user only the first `free_plan_days` days. The plan stays stored; all 120 days reappear when the user is premium.
- **Premium and expiry.** `entitlements.tier` is changed only by the `revenuecat-webhook` function, from an authenticated RevenueCat event (header secret, constant-time compare). Each event id is recorded once (`revenuecat_events`), and the newest applied event time and expiry are kept per user (`billing_state`), so a late older event can never restore access after a newer expiration or refund. An expiration or refund that lists only another entitlement is ignored; a normal cancellation keeps access until expiry; unsupported, anonymous, sandbox (unless enabled) or malformed events never grant. **Every access gate uses one database-time rule** (`private.is_premium`: tier is premium and any stored expiry has not passed), so a lapsed subscription is free even if the webhook never delivered the expiration. Lifetime and manual grants stay premium.
- **Rewarded ads.** `request-ad-reward` issues a short-lived (15 minute), one-use opaque token bound server-side to the user and reward type (only its hash is stored; at most 5 unused tokens per user). The app passes it to AdMob as SSV `custom_data`. `grant-ad-reward` verifies Google's ECDSA signature over the raw callback query with Google's published key (cached for an hour, refreshed on an unknown key id), checks the ad unit is ours (otherwise anyone could earn credits from their own AdMob account), consumes the token once, records each AdMob `transaction_id` once, and enforces the daily cap on database time. The local "reward earned" callback in the app is a UI event only: it grants nothing, and the app then re-reads `check-limit` to see the verified credit.
- **Offline queue.** A food log the server refuses for the limit stays in that account's offline queue under its own id with a typed reason and the server's reset time. It survives restarts, never shows under another account, syncs once capacity returns (reset, verified ad, or premium), and does not block other queued operations.
- **Screens.** Food shows the server allowance, the reset time (local and UTC) and the pending reason; Today and Workout show a Locked notice from day 15 while check-ins and food stay usable. `app/paywall.tsx` shows Monthly, Yearly and Lifetime with the **price string the store returns**, Restore, and a translated "cannot verify access" state with Retry whenever access is not confirmed by a fresh server answer (no products are offered then, to avoid double charges). Purchase and ad state is tied to the account that started it, and store identity changes are applied one at a time, so a late result for a previous account cannot affect the current one.
- **Strings.** All new text is in English, Malay and Tamil through `t()`.

### Phase 4 server pieces

| Piece | Purpose |
| --- | --- |
| `check-limit` | Authenticated read model: tier, allowances, ad rewards, reset time, accessible plan days |
| `revenuecat-webhook` | RevenueCat events to entitlement (header-authenticated, not a Supabase JWT) |
| `request-ad-reward` | Issues the one-use ad token (authenticated) |
| `grant-ad-reward` | Google SSV callback to credit ledger (Google signature, not a Supabase JWT) |

Migrations added in Phase 4 (apply with `npx supabase db push`): `food_quota`, `plan_day_lock`, `revenuecat_events`, `premium_expiry_gates`, `ad_rewards`, `revoke_client_writes` (clients get no write privilege on `entitlements` or `app_config`), `ad_request_pruning`.

Supabase function secrets (names only; set per project, never commit values):

| Secret | Used by | Notes |
| --- | --- | --- |
| `REVENUECAT_WEBHOOK_AUTH` | `revenuecat-webhook` | exact Authorization header value RevenueCat sends; without it the function answers 503 |
| `REVENUECAT_ENTITLEMENT_ID` | `revenuecat-webhook` | entitlement that means premium (`premium`) |
| `REVENUECAT_ACCEPT_SANDBOX` | `revenuecat-webhook` | `true` on development only; leave unset in production |
| `REVENUECAT_API_KEY` | `revenuecat-webhook` | optional RevenueCat **secret** key; only used to confirm entitlements after a TRANSFER (restore on a new account) |
| `ADMOB_REWARDED_AD_UNIT_IDS` | `grant-ad-reward` | our rewarded ad unit ids; without it the function answers 503 |

Public build settings live in the EAS `development` environment, not in Git: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID`, `ADMOB_ANDROID_APP_ID` (read by `app.config.js` at build time). Without them the app still builds: purchases show "not set up in this version" and development builds use Google's public test ads. A `production` build refuses to build without `ADMOB_ANDROID_APP_ID`. Step-by-step account setup is in `docs/monetization-setup.md`. `app.json` keeps a top-level `react-native-google-mobile-ads` key on purpose: the ads library's Android Gradle script fails without it.

### Phase 4 verification levels

These are four different things; only the first three have happened.

1. **Mocked tests (Jest, no network).** Store and ad SDK adapters against mocked SDKs; purchase, restore, cancellation, webhook delay, unavailable offerings, account switch and sign-out; ad load failure and a local reward callback that grants nothing; the paywall screen and the ad hook rendered with mocks, including late results for a previous account; RevenueCat event mapping and ordering; AdMob signature verification against **signed fixtures from a throwaway key pair** (forged, changed, reordered and re-encoded queries, unknown key, malformed callbacks); key cache and rotation; offline queue persistence and per-account isolation.
2. **Live Rise120 development-database tests (`supabase/tests/`, project `kozskxoiyrzrokjmcqeo`).** Food quota admission including concurrency, plan-day lock, `check-limit`, premium expiry on every gate (including expiry passing with no event), webhook through the deployed function (auth, idempotency, ordering, refund, cross-account), ad request and grant (unknown, expired, used and replayed tokens, concurrent callbacks, daily cap, correct bonus, wrong account), client write refusals, and the real `FOOD_LIMIT_REACHED` error shape. The webhook and SSV are driven with **simulated** events and signed fixtures, not by RevenueCat or Google.
3. **Compiled development build.** An Android development build with the new native modules (`react-native-purchases`, `react-native-google-mobile-ads`) built successfully on EAS (build `622d2b05-85a6-41d8-b3c4-813ccf9bc708`, https://expo.dev/accounts/eswaran0321s-team/projects/eswar/builds/622d2b05-85a6-41d8-b3c4-813ccf9bc708). It proves the native code compiles. **It has not been installed or run on a phone.** Later changes were JavaScript only, so this build can load them; rebuild once the EAS variables below are set, because the AdMob App ID is baked in at build time.
4. **Real purchases and ads: untested.** No Google Play product, store sheet, real price, purchase, restore, refund, RevenueCat webhook delivery, AdMob ad, or Google verification callback has run. Specifically unproven: that Supabase delivers the callback's raw query to `grant-ad-reward` byte for byte (the signature depends on it), that RevenueCat's real payloads match the documented fields, and that transfer/restore onto a new account works (needs `REVENUECAT_API_KEY`).

Latest results (commit of this README): `npx jest` **78 suites, 1047 tests passed** (about 610 mocked unit tests in 57 suites under `src/`, the rest in `supabase/tests/`, which includes the live development-database tests), `npx tsc --noEmit` clean, `npm run lint` clean, `npx expo export --platform android` exports, and migration parity on development is 17 of 17 in sync. All eight edge functions are deployed and active on development.

### Final review of Phase 4

Reviewed: database grants and RLS (anonymous and signed-in clients probed against every server-only table and function), webhook and SSV trust boundaries, token lifetime and replay, expiry, queue persistence, account switching, translations, price display, refund and restore, build configuration, and a scan of tracked files for secrets (only Google's public sample ad ids appear). Findings fixed, each with a failing test first and its own commit:

- `fix(monetization)`: a rewarded ad started by one account could keep another account's buttons busy and leave its message behind.
- `fix(db)`: clients lacked only a policy, not a privilege, to write `entitlements` and `app_config`; the privilege is now revoked.
- `fix(ads)`: one user could create unlimited unused ad tokens; now bounded.

Earlier in Phase 4, review also fixed: expiry not enforced when no webhook event arrived; EXPIRATION/refund for another entitlement revoking premium; the paywall treating remembered access as confirmed; and account-switch races in store identity and in the paywall.

### Phase 4 known limitations

- `entitlements.tier` itself stays `premium` after a subscription lapses without a webhook event. Every access gate ignores the column alone (it also checks the stored expiry on database time), and the app reads limits only through `check-limit`, but anything else reading `tier` directly would be wrong. No scheduled sweep exists.
- Restoring a purchase on a different account promotes it only if `REVENUECAT_API_KEY` is set; until then a transfer revokes the old account and does not promote the new one.
- EU consent (Google UMP) for ads is not implemented. Fine for Malaysia-only testing; needed before an EU release.
- The quota-day rollover at 00:00 UTC and prior-day slot release have no live clock tests (no clock seam); the fail-closed path for a missing `app_config` value is only unit-tested.
- Free-plan locked days: the Workout tab shows the lock because the server withholds that day's exercises; there is no separate free-form workout log.
- The AI allowance and the AI ad reward exist in the server but have no screen until Phase 5.
- Some live suites change shared `app_config` values briefly. They are written to tolerate this, but run the live tests against a development project only, and note that a full run creates many test users and can hit Supabase's sign-in rate limit if repeated within minutes.
- Malay and Tamil strings were drafted by an AI agent and still need native review.
- Prices are never stored in the app. Product ids, prices and offerings are configured in Google Play and RevenueCat (RM 39.90 monthly, RM 199 yearly, RM 399 lifetime are the intended values).

### Phase 4 open gates (exact account setup remaining)

Nothing here is a code task. Details: `docs/monetization-setup.md`.

1. **Google Play:** app for `com.eswaran2728.rise120` on an internal testing track; products `monthly` (RM 39.90), `yearly` (RM 199), `lifetime` (RM 399); your account as a licence tester.
2. **RevenueCat:** Android app connected to Google Play, entitlement `premium`, a **current** offering with Monthly, Annual and Lifetime packages, webhook URL `https://kozskxoiyrzrokjmcqeo.supabase.co/functions/v1/revenuecat-webhook` with its Authorization header equal to the Supabase secret `REVENUECAT_WEBHOOK_AUTH`; copy the public `goog_` key. Optional: set the Supabase secret `REVENUECAT_API_KEY` (a RevenueCat secret key) for restore on a new account.
3. **AdMob:** app and a Rewarded ad unit with server-side verification and callback `https://kozskxoiyrzrokjmcqeo.supabase.co/functions/v1/grant-ad-reward`; set the Supabase secret `ADMOB_REWARDED_AD_UNIT_IDS` to the ad unit id (development currently holds Google's sample unit).
4. **EAS `development` environment:** `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID`, `ADMOB_ANDROID_APP_ID`; then a new development build.
5. **Phase 3 gates still open** (see "Phase 3 open gates" above): the reviewed Malaysian food seed, the Open Food Facts reuse decision, `USDA_FDC_API_KEY`, `OFF_CONTACT`, and the Phase 3 phone checks. The only phase tag is `phase-1-foundation`; no tag exists for Phase 2, 3 or 4, and none should be created until the final cross-phase device pass and your approval.
6. **Production only, later:** a separate Supabase project and Play/RevenueCat/AdMob configuration; leave `REVENUECAT_ACCEPT_SANDBOX` unset there.

### Final Android checklist (deferred cross-phase device pass)

Run after the gates above and a fresh development build. Tick each only when it is actually seen on a phone; none has been run yet.

- Sign in (email and Google), finish onboarding, see the Today plan; switch the app language to Malay and Tamil.
- Workout and check-in work in airplane mode and sync later without duplicates; check-in photo uploads; Progress shows the history.
- Food: log meals, edit and delete, offline logging; search, USDA discovery (needs `USDA_FDC_API_KEY`) and barcode scan (needs `OFF_CONTACT`) only after those are set.
- Free limit: log 3 meals; the 4th shows "Waiting for daily limit" with the reset time; close and reopen the app and it is still there; other workouts and check-ins still sync.
- Watch ad: the Watch ad button loads an ad, finishing it shows "being verified" and then the bonus appears; the waiting meal syncs on its own. With ads watched up to the daily cap the button reports the cap. A premium account shows no ad choice.
- Day-15 lock: move the dev plan's start date back 14 days (SQL on the development project) and check Today and Workout show Locked with Subscribe, while check-in and Food stay usable.
- Paywall: prices shown are exactly Google Play's; cancel a purchase (no charge, clear message); buy with the licence-tester account and premium unlocks within a minute; Restore purchases; refund the test purchase in Play and see access return to free.
- Offline paywall: open it in airplane mode and see "cannot verify access" with Retry, not "Premium active" and no products.
- Account switch and sign-out: sign out and in as another account while the paywall or an ad is open; nothing from the first account appears for the second.
- Delete account removes the user; a new sign-up starts on the free tier.

## Phase 5: AI coach (code complete; no real provider, no phone)

A Coach tab where a member asks a question in English, Malay or Tamil and may get a small, reviewable adjustment to their future plan days. **No real model has ever answered**: the Gemini secrets (`GEMINI_API_KEY`, `GEMINI_MODEL`) are unset on every project, and nothing in Phase 5 has run on a phone. See "Phase 5 verification levels" and "Phase 5 open gates".

### How it works

- **The server decides everything.** `ai-coach` takes the account from the verified JWT (never the body), reserves the request in a ledger, builds a bounded context, calls the provider, validates the answer, and stores it. The app only displays what it returns.
- **Allowance.** Free members get the `app_config` AI messages per UTC day (1 initially) plus verified rewarded-ad credits; premium is unlimited. Admission is atomic per user, so two requests for the last slot cannot both win. **A failed request is not charged.** A late finish after a lease expired succeeds only if its slot is still free; otherwise the reply is discarded and never shown as successful (`slot_taken`).
- **Retries and unknown outcomes.** The same request id returns the stored answer and never calls the provider twice. If a provider call may have been processed but the answer was lost (timeout), the server reports an unknown outcome and does not regenerate it by itself; the app offers Check again (same id) and, as a separate explicit tap, Ask again (new id). Nothing is queued offline and nothing repeats a model call automatically.
- **Rate guard.** Separate from the daily allowance: at most 5 provider starts per rolling minute and 1 active provider request per account (`app_config`), for free and premium alike. A limited request calls no provider and spends no allowance; the answer carries a server-generated `retryAt`.
- **What the model sees.** Goal, level, equipment, weight, up to 10 recent check-in numbers and the editable plan days, plus the member's message. Never a user id, email, name, photo, food preference or plan id. The prompt is versioned (`coach-2026-10-14.1`).
- **Proposals are checked, not trusted.** The model's output is parsed against an allowlist and validated against the member's real plan: existing exercises of the member's equipment and movement pattern, the rest-day structure, sets within 1 and reps within 2, calories within 250 in steps of 50 and never below 1,500, protein 1.6 to 2.0 g per kg. Only days from plan day today+2 to today+14 (by UTC) that the member can currently open are eligible. One bad patch drops the whole proposal; the reply text may stay.
- **Accepting is a database transaction.** `decide-coach-proposal` accepts only `{proposalId, decision}`, loads the stored patch (never one from the client), locks the proposal and affected days, rechecks ownership, pending status, access, eligibility, expected prior values and the same exercise and nutrition rules, and applies all days or none. Repeating a decision is idempotent; the opposite decision is refused; a proposal that no longer fits is marked stale and changes nothing. Declining changes no day.
- **After acceptance** the app drops that account's plan cache, reads the plan strictly from the server, and Today, Workout and Food read the new values. If that refresh fails the accepted decision stays visible with a Refresh plan retry, and old cached values are never described as current.
- **Account safety.** Coach state, cached history and late responses are tied to the signed-in account; a late answer for account A is dropped after switching to B. The coach cache is cleared on account deletion. Server tables are readable by their owner only (row-level security); every write goes through server functions.
- **Strings.** All text is in English, Malay and Tamil through `t()`.

### Phase 5 server pieces

- Tables: `coach_requests`, `coach_messages`, `coach_proposals`, `coach_attempts` (RLS on; clients can only `select` their own rows from the first three and nothing from `coach_attempts`).
- Functions: `public.coach_reserve_request`, `coach_finish_request`, `coach_fail_request` and `coach_decide_proposal` (security definer, executable by the service role only; `anon` and `authenticated` cannot call them), with their `private.*` implementations.
- Edge functions: `ai-coach` and `decide-coach-proposal`, deployed with `--no-verify-jwt` and verifying the JWT inside.
- `app_config` keys: `coach_rate_limit_attempts`, `coach_rate_limit_window_seconds`, `coach_max_active_requests`, plus the existing AI allowance keys.

### Phase 5 verification levels

These are four different things; only the first two have happened.

1. **Mocked tests (Jest, no network).** Provider adapter against a fake `fetch`; prompt, context and validator rules; the request handler with a fake provider (idempotency, unknown outcome, failed call not charged, `slot_taken`, rate limit); the Coach screen and hook with mocked services (duplicate taps, proposal decisions, failed plan refresh, offline history, rate-limit countdown, a late account-A response after switching to B); the tab layout.
2. **Live Rise120 development-database tests (`supabase/tests/`, project `kozskxoiyrzrokjmcqeo`).** Ledger and atomic allowance including concurrency, lease expiry, server-configured limits, ad credits, premium expiry, account isolation, blocked client writes and account deletion; the deployed `ai-coach` and `decide-coach-proposal` functions with a **fake provider path only**; the proposal decision function including all-or-nothing, stale, idempotency, concurrent accepts, and a differential test that the SQL rules and the TypeScript validator decide the same cases.
3. **Real provider: not run.** No Gemini or other model has answered through `ai-coach`; model quality, real latency and cost, Malay and Tamil reply quality, and safety refusals are unknown. The provider comparison tool (`npm run eval:coach`) exists and is tested in fixture mode only; see `docs/ai-coach-evaluation.md`.
4. **Phone: not run.** Layout, keyboard behaviour, the proposal card, the tab icon, the retry countdown and everything in the checklist below have been seen only as rendered test components.

### Phase 5 known limitations

- If the phone goes offline after an acceptance and before the plan refresh, Today shows its retry state and Workout shows "plan not ready" until it reconnects. It does not keep showing the old plan.
- The app cannot tell a request that never left the phone from one that reached the server, so an offline send is treated as uncertain and Check again reuses the request id.
- A provider refusal is shown like any reply (the referral text) and is charged one message.
- Nothing notifies the member when a proposal becomes stale; it is found when they open the tab or tap Accept.
- Live database suites are slow and can time out under load on the shared development project. Each passes when run alone; running many in one go can fail with timeouts. Test accounts from interrupted runs accumulate in the development project (they use `label-<timestamp>-<random>@example.com`) and can be removed with a pattern-matched cleanup.
- Malay and Tamil strings were drafted by an AI agent and need native review.

### Phase 5 open gates

1. **Gemini (paid API project):** set Supabase secrets `GEMINI_API_KEY` and `GEMINI_MODEL` on the development project only after reading the current paid-tier terms, model availability and prices. Never in Git or a chat.
2. **Real comparison:** ten deidentified scenarios with independently verified consent, a second provider, dated prices, native-speaker review, a written provider decision (`docs/ai-coach-evaluation.md`).
3. **Phone pass** (below), on a fresh development build.
4. Production deployment of the coach is a separate, later decision; nothing here touches another project.

### Phase 5 phone checklist (not run yet)

Run after the Gemini secrets are set on development and a fresh development build is installed. Tick each only when seen on a phone.

- Coach is the fourth tab. Ask a question in English, then Malay, then Tamil (switch the app language each time); the reply is in that language and is not cut off.
- Free account: one message works and the allowance reads used; the second shows the limit with the reset time, and the draft is kept. Watch a rewarded ad, see "being verified", and then one more message becomes available (this needs the Phase 4 AdMob setup). A premium account shows no limit.
- Kill the network mid-send (airplane mode just after tapping Send): the app shows an uncertain result with Check again, not an error that invites a second charge; Check again after reconnecting returns the stored answer or says it is still working; the allowance is charged at most once.
- Send several messages quickly: the rate-limit notice appears with a countdown, Send is disabled until it ends, and nothing is sent by itself.
- Ask for a plan change (for example lowering calories on a day a few days ahead): the proposal card shows the day numbers and dates and exact before and after values. Decline changes nothing. Accept changes exactly those days; Today, Workout and Food then show the new values. Switch to airplane mode and accept another proposal: the accepted state stays visible with Refresh plan, and the old values are not shown as current.
- Ask about an injury or medical problem: the reply refers to a professional and offers no plan change.
- Open the Coach tab in airplane mode: the saved history shows with an offline notice.
- Sign out and in as another account while a reply is loading: nothing from the first account appears for the second. Delete the account: history is gone and a new sign-up starts empty.

## Edge functions

Functions called by the app verify the caller's JWT inside the function (user id comes from the token only, never the body), so all functions are deployed with `--no-verify-jwt`. `revenuecat-webhook` and `grant-ad-reward` are called by RevenueCat and Google, which cannot send a Supabase JWT; they trust only their header secret or Google's signature:

- `supabase/functions/delete-account` deletes the calling user and their stored photos.
- `supabase/functions/generate-plan` creates the calling user's plan (see above).
- `supabase/functions/search-foods` searches USDA FoodData Central with a server-side key (Phase 3).
- `supabase/functions/lookup-barcode` is a read-only Open Food Facts barcode lookup (Phase 3).
- `supabase/functions/check-limit`, `revenuecat-webhook`, `request-ad-reward` and `grant-ad-reward` are the Phase 4 limit, entitlement and ad-reward functions (see Phase 4).

```
npx supabase functions deploy delete-account --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy generate-plan --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy search-foods --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy lookup-barcode --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy check-limit --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy revenuecat-webhook --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy request-ad-reward --project-ref <project-ref> --no-verify-jwt --use-api
npx supabase functions deploy grant-ad-reward --project-ref <project-ref> --no-verify-jwt --use-api
```

- `supabase/functions/ai-coach` answers a coach question for the calling user: server allowance, rate guard, idempotent request ids, validated proposals (Phase 5). Needs the `GEMINI_API_KEY` and `GEMINI_MODEL` secrets, which are unset.
- `supabase/functions/decide-coach-proposal` accepts or declines a stored coach proposal in one transaction (Phase 5).
Deploy and run the database tests against a development project only.

## Tests and checks

- Unit tests: `npx jest`
- Database and edge function tests (`supabase/tests/`) run against a real Supabase project and need an untracked `.env.test` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Use a development project, never production. They create and delete their own test users. Phase 2 adds live tests for plan generation, the exercise seed, profile inputs, and photo storage and deletion; Phase 3 adds live tests for the food model and row-level security, USDA discovery and barcode lookup (authentication and validation), and checks that candidate foods cannot become verified without review. Phase 4 adds live tests for quota admission, the plan-day lock, `check-limit`, premium expiry, the RevenueCat webhook, the ad reward ledger, and client write refusals, plus pure-logic suites for webhook event mapping and AdMob signature verification (signed fixtures from a throwaway key, never a real key).
- Android bundle check: `npx expo export --platform android`
- Migration parity: `npx supabase migration list` (every local migration should also be applied remotely; run against the development project)
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`

## Android development build

Google sign-in, the Phase 2 photo and chart packages (`expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `react-native-svg`) the Phase 3 barcode camera (`expo-camera`) and the Phase 4 `react-native-purchases` and `react-native-google-mobile-ads` use native code, so Expo Go does not work, and an older development build must be rebuilt after Phase 2 after Phase 3, and again after Phase 4 for those packages to be present. The EAS `development` environment also needs the public purchase and ad settings listed in Phase 4.

1. `npx eas-cli login`, then `npx eas-cli init` (once, links the Expo project).
2. Create the Android signing keystore with `npx eas-cli credentials --platform android` and note its SHA-1.
3. In Google Cloud create an Android OAuth client (package `com.eswaran2728.rise120`, that SHA-1) and a Web OAuth client. In Supabase, Authentication, Providers, Google: enable it, put the Web client ID first in Client IDs followed by the Android client ID, and enter the Web client secret.
4. Build: `npx eas-cli build --profile development --platform android`, then install the APK from the link.
5. Run the dev server: `npx expo start --dev-client`.

## Notes

- Tamil and Bahasa Malaysia strings (`src/i18n/locales/ta.json`, `ms.json`) were drafted by an AI agent and still need review by native speakers.
- Plan numbers (calories, protein, sets, reps) are generic estimates for healthy adults. The app shows a translated health disclaimer beside them.
- Every user-facing string goes through `t()`. See `AGENTS.md` for the working rules.
