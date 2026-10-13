# Rise120 Phase 3 Food Design

**Status:** For Eswar's review. **Source of truth:** Part 4 of `C:\Users\eswaranp\Downloads\Rise120-handoff.pdf`. Phase 2 code is at `1ca519a`; its phone verification and tag remain pending by owner choice.

## Purpose and scope

Make food logging usable in the daily 120-day loop: find a food, choose a meal and quantity, see calories and macronutrients remaining, and keep logging offline. Search favours verified Malaysian foods while still returning global foods. Add custom foods and barcode lookup. Phase 4, not Phase 3, enforces free-tier limits.

## Food records and provenance

- Retain the existing `foods` and `food_logs` tables and row-level-security model. Add the smallest source identifiers, barcode, translated/local name aliases, and provenance fields needed for deduplication, search, and attribution. Do not replace existing rows or migrations.
- `verified=true` is reserved for a curated Malaysian/Malay/Tamil entry whose serving size, energy, protein, carbohydrate, fat, source, and reuse right have been reviewed. No such list exists yet. Candidate entries remain unverified and are not presented as curated facts.
- USDA FoodData Central results and Open Food Facts products are unverified. Show their source to users. Missing or inconsistent nutrition fields must not silently become zero.
- Custom foods belong only to their creator, remain unverified, and are never automatically promoted to shared or verified.
- Keep source identifiers stable so repeated searches, barcode scans, and sync retries do not create duplicate foods or food logs.

## Search and source access

- Search stored foods first across the primary name and available English, Malay, and Tamil aliases, with verified Malaysian entries before other matches; then include worldwide results. Ranking changes order, not eligibility. Do not invent aliases for unreviewed foods.
- A server endpoint queries USDA FoodData Central; its API key stays in Supabase function secrets. Bound requests and handle timeouts, 429s, and incomplete nutrition records.
- Open Food Facts supports product lookup by barcode and bounded global discovery. Identify Rise120 with a custom User-Agent and respect its rate limits. Do not use its search endpoint on every keystroke.
- Open Food Facts data has attribution and share-alike reuse terms. Before durable import or caching of its data in Rise120's combined food database, Eswar must approve a compliant reuse approach. The implementation can provide read-only lookup and a source-labelled result meanwhile. This gate also applies before calling Phase 3 complete.
- A curated seed is a separate reviewed data artifact. MyFCD may supply candidate references, but its online availability alone is not permission to copy it into Rise120. Eswar reviews the seed and reuse rights before any candidate becomes verified.

## Logging and offline behaviour

- Log breakfast, lunch, dinner, or snack with a positive quantity and a stable client-generated ID. Persist the action locally first in the account-scoped queue already used for workouts and check-ins; replay is idempotent. Deleting or editing a log also works offline.
- Cache the records actually logged and recent/favourite choices per account so the user can search and log those foods when offline. A failed remote search falls back to these local records. Account deletion clears the account's local food data. Open Food Facts-derived records are excluded from durable logging and caching until the reuse gate above is resolved.
- Calculate a day's consumed calories, protein, carbohydrate, and fat from food values times quantity. Show remaining calories and protein against the plan day's targets; show consumed carbohydrate and fat unless their targets are defined elsewhere. No zero or fabricated targets.
- Phase 3 does not hardcode or enforce free food-log limits. Phase 4 reads limits from `app_config` and reconciles offline actions on the server.

## Screens

- Add a Food tab consistent with the existing dark theme, translations in English, Malay, and Tamil, and large tap targets.
- The main Food view shows the local day, meal groups, consumed and remaining values, add/edit/delete actions, and recent foods. Food search displays source and verification state. A barcode scanner has permission denied, unknown code, incomplete product, and network-failure states.
- Use the device's local calendar day, including midnight and app resume, as in the existing Today, Workout, and Check-in screens.

## Verification and phase gate

- Tests start red for search ranking, nutrition math, validation, per-user visibility, offline logging and replay, duplicate prevention, missing nutrition, source failures, barcode outcomes, and account switching.
- Each implementation task ends with one commit. Run the full Jest suite, TypeScript, lint, and Android bundle checks before reporting completion. New native barcode-scanning code requires a new development APK for phone testing.
- Full phone checks are deferred to the final cross-phase device pass at Eswar's request. Do not claim Phase 3 complete or create its tag until those checks, the curated verified seed, and the Open Food Facts reuse decision are resolved.

## Sources checked

- [USDA FoodData Central API guide](https://fdc.nal.usda.gov/api-guide/): server key, search/details, rate limits, CC0.
- [Open Food Facts API guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/): rate limits and User-Agent.
- [Open Food Facts reuse conditions](https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api/): attribution and share-alike.
- [Malaysian Food Composition Database](https://myfcd.moh.gov.my/): candidate Malaysian nutrition references.
