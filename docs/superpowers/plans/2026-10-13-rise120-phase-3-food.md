# Rise120 Phase 3 Food Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and `superpowers:test-driven-development` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Eswar has chosen Claude Code for coding.

**Goal:** A Rise120 user can find food, log meals offline, and see consumed and remaining nutrition; global foods and barcodes are searchable, with verified Malaysian foods ranked first once a reviewed seed exists.

**Architecture:** Extend the existing `foods`, `food_logs`, RLS, and per-user sync queue. Search stored foods first through a tested ranking rule; call USDA through a Supabase function with its secret API key. Keep Open Food Facts lookup read-only until its reuse gate is resolved. Screens use pure validation and nutrition selectors; all writes queue locally before sync.

**Tech Stack:** Existing Expo Router, React Native, TypeScript, Supabase, Jest, AsyncStorage. Select an Expo-SDK-compatible barcode-scanner package only at Task 7.

**Spec:** [Approved Phase 3 design](../specs/2026-10-13-rise120-phase-3-food-design.md), grounded in Part 4 of `C:\Users\eswaranp\Downloads\Rise120-handoff.pdf`. Phase 2 code is at `1ca519a`; its device check and tag remain pending by owner choice.

## Global Constraints

- Follow Part 4 as source of truth. Phase 3 only: no Phase 4 limit enforcement, paywall, ads, or AI coach.
- Preserve working code, existing rows, RLS, and Phase 1 and 2 migrations; add only new migrations. One commit per task, including docs/data review tasks.
- Android first; use platform-neutral logic and cross-platform libraries where possible. Every user-facing string goes through `t()` in English, Malay, and Tamil.
- No USDA key, Supabase service-role key, or other secret in app code or Git. USDA requests use an edge-function secret. `EXPO_PUBLIC_` values are not secrets.
- Do not label any invented or unreviewed nutrition value `verified=true`. USDA and Open Food Facts values stay unverified; reject records missing calories or any macro rather than writing zero. Do not invent local-language food names; use reviewed aliases only.
- Do not durably import/cache Open Food Facts-derived rows until Eswar approves a reuse approach consistent with its attribution/share-alike terms. Read-only lookup and a source-labelled preview may ship before that gate; direct logging of those results must remain disabled until the gate is resolved.
- A verified curated Malaysian/Malay/Tamil seed is a Phase 3 closure gate: Eswar has no reviewed list yet. Prepare a review artifact with sources and values, but do not mark it verified or deploy it until Eswar reviews both nutrition and reuse rights.
- Do not create `phase-3-food` or any deferred phase tag until the final cross-phase device checks and the data gates pass. Phase 3 implementation may proceed while the Phase 2 device check/tag is pending, as Eswar explicitly requested.

## Review Focus

1. A shared global food and an own custom food are readable; another user's custom food is not. Tests in Tasks 1, 2, 4.
2. A search result with missing, mixed-unit, or inconsistent energy/macros never becomes a zero-valued log. Tests in Tasks 3, 7.
3. Offline create/edit/delete replay once after process death or a lost response; account A operations never sync as B. Tests in Task 5.
4. Search failure returns recent/logged local foods, preserving source and verified labels. Tests in Tasks 2, 6.
5. Midnight and timezone changes do not move a meal to another local day; a quantity edit updates totals rather than double-counting. Tests in Tasks 5, 6.

## File Structure

| Area | Responsibility |
| --- | --- |
| New Supabase migration(s) | Source IDs, deduplication constraints, food search index; preserve existing tables/RLS. |
| `src/food/types.ts`, `validation.ts`, `nutrition.ts` | Food shape, positive quantity/serving validation, consumed and remaining math. |
| `src/food/search.ts`, `cache.ts` | Ranking and account-scoped recent/logged food cache. |
| `supabase/functions/search-foods/index.ts` | Authenticated, bounded USDA search/details with server-only key. |
| `src/food/custom.ts` | Own unverified food create/edit/delete through existing RLS. |
| `src/sync/types.ts`, `queue.ts`, `flush.ts`, `supabaseTransport.ts` | Food log operations, idempotent replay, account isolation. |
| `src/food/log.ts`, `load.ts` | Meal log state, server/local merge, edit/delete. |
| `app/(tabs)/food.tsx`, `app/food-search.tsx`, `app/food-edit.tsx` | Food tab, search and meal entry. |
| `supabase/functions/lookup-barcode/index.ts`, `src/food/barcode.ts`, `app/food-scan.tsx` | Open Food Facts read-only lookup and scanner. |
| `docs/food/curated-candidates.csv`, `docs/food/curation-review.md` | Candidate data and review/provenance gate, without unreviewed verified seed. |

## Tasks

### Task 1: Food model and numeric rules

**Files:** Create `src/food/types.ts`, `src/food/validation.ts`, `src/food/nutrition.ts`, their `__tests__` files; add one CLI-named migration for source ID, barcode, provenance, and local-name aliases; add live RLS/schema tests under `supabase/tests/`.

**Interfaces:** `parseFoodInput(input: FoodFields): FoodParseResult` accepts non-negative calories/protein/carbs/fat and positive serving quantity; `foodNutrition(food: Food, quantity: number): Nutrition`; `remainingNutrition(targets: {calories: number|null; proteinG: number|null}, consumed: Nutrition): {calories: number|null; proteinG: number|null}`. `Food` carries `id`, `userId`, `name`, `servingDesc`, four numeric values, `source`, `verified`, `region`, optional source ID/barcode. Quantity is the number of listed servings, not grams unless the serving itself is 100 g.

- [ ] Write tests for decimal comma, blank/NaN/negative fields, positive fractional quantity, 1.5 servings, round-off, and null plan targets. Live test that RLS still rejects another user's private food and any client attempt to set `verified=true`.
- [ ] Run `npx jest src/food supabase/tests/food-model.test.ts --runInBand --watch=false`; expect red from missing modules/migration.
- [ ] Implement focused types/rules and only the migration needed for stable external IDs/barcode/provenance; apply to Rise120 development (`kozskxoiyrzrokjmcqeo`) and rerun target tests green.
- [ ] Run full Jest, `npx tsc --noEmit`, `npm run lint`; commit `feat(food): model provenance and nutrition rules`.

### Task 2: Stored-food search, ranking, and recent cache

**Files:** Create `src/food/search.ts`, `src/food/cache.ts`, tests; extend account-deletion local cleanup in `src/auth/authService.ts` and its tests.

**Interfaces:** `rankFoods(query: string, foods: Food[]): Food[]` matches the primary name and reviewed English/Malay/Tamil aliases, puts a matching shared `verified=true` `region='MY'` food ahead of all other matching foods, and retains all eligible matches. `searchStoredFoods(userId: string, query: string): Promise<Food[]>` queries own and shared rows under RLS, bounded/paged. `recentFoods(userId: string): Promise<Food[]>` returns only that account's locally cached logged foods.

- [ ] Tests first: Malaysian verified before USDA/global; an approved Malay or Tamil alias matches; nonmatching Malaysian result excluded; own custom result present, other user's absent; diacritic/case handling; pagination; remote failure returns account's recent foods; deletion and account switch clear/isolate cache.
- [ ] Run `npx jest src/food --runInBand --watch=false`; expect red before implementation.
- [ ] Implement search and bounded account-scoped cache, reusing existing Supabase and AsyncStorage patterns. Do not fabricate seed rows for tests against the live database; use fixtures/mocks for ranking.
- [ ] Run target and full gates; commit `feat(food): ranked stored search and recent cache`.

### Task 3: USDA global discovery

**Files:** Create `supabase/functions/search-foods/index.ts`, focused pure parser under `supabase/functions/_shared/food/`, `supabase/tests/search-foods.test.ts`; add `src/food/usda.ts` and tests if needed for the app call.

**Interfaces:** Authenticated POST `search-foods` with `{query:string, page:number}` returns a bounded list of normalized unverified food previews with source `usda`, stable FDC ID, serving description, calories and three macros. The function reads `USDA_FDC_API_KEY` from Supabase secrets and verifies caller identity; it never returns the key. A selected result is persisted as an own unverified `foods` row through a stable source ID before it can be logged.

- [ ] Tests first for no JWT, empty/oversized query, 429/timeout, malformed source record, missing nutrient, duplicate FDC ID, and source key never exposed; mock the upstream API for deterministic tests.
- [ ] Run `npx jest supabase/tests/search-foods.test.ts --runInBand --watch=false`; expect red before function exists.
- [ ] Implement, set key only through Supabase secrets, deploy only to Rise120 development, and rerun green. If no real key is available, keep mocked tests green and report the live discovery gate without using `DEMO_KEY` as a production substitute.
- [ ] Run full gates; commit `feat(food): server-side USDA discovery`.

### Task 4: Own custom foods

**Files:** Create `src/food/custom.ts`, tests, `app/food-edit.tsx`; add locale keys.

**Interfaces:** `createCustomFood(userId: string, input: FoodFields): Promise<Food>` and `updateCustomFood(userId: string, foodId: string, input: FoodFields): Promise<Food>` write only own `verified=false` rows. `deleteCustomFood(userId: string, foodId: string): Promise<void>` rejects deletion when logs reference that food, preserving history; show an actionable translated message.

- [ ] Tests first for valid creation, invalid nutrition, user spoofing, no verified promotion, edit ownership, logged-food deletion rejection, and custom food visibility only to owner.
- [ ] Run `npx jest src/food/__tests__/custom.test.ts --runInBand --watch=false`; expect red.
- [ ] Implement with existing RLS; make UI form keyboard-safe and translated; rerun green.
- [ ] Run full gates; commit `feat(food): private custom foods`.

### Task 5: Offline meal log queue

**Files:** Extend `src/sync/types.ts`, `queue.ts`, `flush.ts`, `supabaseTransport.ts` and their tests; create `src/food/log.ts`, `src/food/load.ts`, tests; extend user cache/deletion cleanup.

**Interfaces:** `FoodLogOperation` has `kind:'food_log'`, stable client UUID, local `date`, `foodId`, positive `quantity`, `mealType:'breakfast'|'lunch'|'dinner'|'snack'`, `deleted:boolean`, `updatedAt`. `queueFoodLog(userId,date,input): Promise<string>` returns the stable ID. Replays upsert/delete by ID only after `assertSignedInAs(userId)`; latest local edit wins; delete is a tombstone until confirmed. `loadFoodDay(userId,date): Promise<FoodDay>` merges server rows and pending operations once.

- [ ] Tests first for four meals, fractional serving, offline add/edit/delete, cold restart, lost response, duplicate flush, per-user isolation, local-day boundary, deletion failure remaining queued, and missing cached food snapshot.
- [ ] Run `npx jest src/sync src/food --runInBand --watch=false`; expect red.
- [ ] Extend the existing queue/transport additively, including food snapshots for offline display; preserve workout/check-in behavior. Reconcile signed-in account before every replay.
- [ ] Run target and full gates; commit `feat(food): offline idempotent meal logging`.

### Task 6: Food tab, totals, and search flow

**Files:** Create `app/(tabs)/food.tsx`, `app/food-search.tsx`; modify `app/(tabs)/_layout.tsx`, Today link if appropriate, and all three locale files; add selector/screen tests under `src/food/__tests__/` or `app/__tests__/`.

**Interfaces:** Food tab reads current local date, `loadFoodDay`, plan day targets, and pure nutrition selectors. Search is debounced; stored/recent choices remain available offline. A global USDA preview is normalized and persisted as an own unverified food before logging. The Food tab never reads or enforces `app_config` limits in this phase.

- [ ] Tests first for consumed totals by meal, correct remaining calories/protein including null targets, edit changing totals once, source labels, no result/offline fallback, midnight/resume reload, and new language rendering.
- [ ] Run targeted screen/selector tests; expect red.
- [ ] Implement one-handed dark UI and translations; use the existing local-date and focus patterns. Show consumed carbs/fat; do not invent carb/fat targets.
- [ ] Run full gates and Android bundle with `npx expo export --platform android`; commit `feat(food): meal screen search and daily totals`.

### Task 7: Open Food Facts barcode lookup

**Files:** Create `supabase/functions/lookup-barcode/index.ts`, pure response parser/tests, `src/food/barcode.ts`, `app/food-scan.tsx`; add translated permission/error/source text and SDK-compatible scanner configuration in `app.json` only if required.

**Interfaces:** Authenticated POST `lookup-barcode` with a barcode returns `{found:false}` or an unverified source-labelled preview with complete nutrition. Use a custom Rise120 User-Agent configured with a legitimate contact endpoint; do not use OFF search on every keystroke. Scanner opens the preview; logging or durable caching stays disabled until the reuse gate is approved.

- [ ] Tests first for valid/invalid barcode, unknown product, missing or ambiguous per-100g versus per-serving values, rate limit, offline, permission denied, and no accidental durable write. Mock upstream requests.
- [ ] Run targeted tests; expect red.
- [ ] Implement read-only lookup and scanner; check current Expo and OFF API docs for package/API compatibility before installing; deploy only to Rise120 development. If contact details are missing, leave live OFF calls disabled and report the configuration gate.
- [ ] Run full gates and Android bundle; commit `feat(food): read-only barcode lookup`.

### Task 8: Curated candidates and rights review

**Files:** Create `docs/food/curated-candidates.csv`, `docs/food/curation-review.md`; only after Eswar's separate review, create a CLI-named seed migration and live seed tests.

**Interfaces:** Candidate rows contain name, reviewed English/Malay/Tamil aliases where available, language/region, exact serving amount and unit, calories/protein/carbs/fat, source URL and source record ID, access date, reuse permission evidence, and reviewer verdict. Import script/migration refuses candidate rows lacking approval and verified nutrient values. Approved shared rows have `user_id=null`, `region='MY'`, `verified=true`; repeated deploys are idempotent.

- [ ] Write validation tests first: reject blank source, absent permission evidence, nonnumeric nutrient, inconsistent serving, and unreviewed candidate; expect red.
- [ ] Build a small source-backed candidate file for Eswar to review. Do not copy MyFCD values without confirming reuse permission. Commit the review artifact as `docs(food): prepare curated seed for review`.
- [ ] After Eswar supplies/approves values and rights, write seed migration tests red, then add an idempotent verified seed migration, deploy to dev, rerun green, and commit `feat(food): reviewed Malaysian seed`.
- [ ] If the review is not complete, leave this task's seed substep pending and report Phase 3 as open. Continue independent Task 9 documentation/checks if useful.

### Task 9: Reuse decision and checkpoint

**Files:** Update `README.md`, `docs/food/curation-review.md`, and any attribution screen text; add migration/transport tests if Eswar approves durable OFF use.

**Interfaces:** Document the chosen OFF reuse approach and required attribution/share-alike obligations. If approved, enable durable OFF logging/cache with an isolated, auditable source ID and test offline replay; otherwise keep lookup read-only and mark the Phase 3 closure gate open. Record USDA key and OFF contact configuration by variable name only.

- [ ] Verify the chosen reuse decision with Eswar; do not silently treat API access as permission to combine and redistribute OFF data.
- [ ] Write a failing test for any newly approved durable OFF path, implement it, and rerun green. Keep it disabled if the decision remains open.
- [ ] Run full Jest, `npx tsc --noEmit`, `npm run lint`, `npx expo export --platform android`, live RLS/source tests, and a whole-phase review. Document exact results and account/data gates in `README.md`.
- [ ] Commit `docs: Phase 3 food checkpoint`. Do not tag yet; device checks are deferred to the final cross-phase pass at Eswar's request. Provide the phone checklist and list every remaining closure gate.

## Self-review against Part 4

The plan covers the Food tab, meal logging, remaining values, verified-Malaysian-first search, worldwide USDA discovery, Open Food Facts lookup, custom foods, barcode scanning, logged-food cache, source labels, and offline replay. Phase 4 owns free limits. The two unresolved source rights/review gates are explicit; neither can be represented as a completed Phase 3 feature before owner action.
