<!-- Copied into the repository on 18 October 2026 from the Codex planning folder
     (docs/superpowers/specs/2026-10-15-rise120-product-direction.md, last updated 15 October 2026). The text below is the planning
     document unchanged; it is a PROPOSAL, not an approved replacement for the original spec. -->

# Rise120: revised product direction

Draft for review — 15 October 2026. This records the feature interview and an initial public-source competitor review. It does not replace the approved implementation plan or authorize extra code. Claude Code already received Phase 5 Task 5; review that work against its existing brief. Preserve completed work and reconcile this proposed expansion before issuing further feature tasks.

## Product promise

Help a beginner in Malaysia or Singapore choose a realistic workout and meal approach today, understand progress, and return after interruptions throughout a 120-day journey. The proposed distinguishing experience combines local context, daily flexibility, understandable progress and private accountability. This is a positioning hypothesis to test with users, not a claim that no competitor offers similar features.

## Confirmed preferences

| Area | User decision |
| --- | --- |
| Audience | Beginners first, busy working adults second, regular gym users third |
| Geography | Malaysia and Singapore first; worldwide later |
| Goal | Personal paths for fat loss, muscle building and general fitness; consistency supports every path |
| Home | Lead with available time, location and energy; show one suitable session and its reason |
| Workouts | Demonstrations, exercise swaps, no-equipment home sessions, gradual progression, detailed gym logging—in that order |
| Food logging | Local search/favourites first, photo-assisted logging with confirmation second, simple guidance third |
| Nutrition | Meal planning first, local eating-out help second, preferences third, optional detailed tracking fourth |
| Meal practicality | Adapt to time, budget and cooking access; beginner default is easy preparation |
| Retention | Flexible reminders, buddy challenges, daily guidance, then weekly reviews |
| Return after gaps | Gentle restart and rescheduling; optional buddy encouragement |
| Social | Completion sharing first, optional milestone sharing, then group leaderboard; health details private by default |
| Coach | Explain progress first, daily guidance, review proposed plan changes, then general fitness questions |
| Progress | Consistency, strength/fitness, wellbeing, body changes; adjust emphasis for the user's goal |
| Integrations | Manual logging remains available; optional health-app/wearable sync added in stages |
| Journey | 120 calendar days with recovery from missed sessions; after Day 120 offer another cycle or maintenance |
| Free/premium | Proposed free basic workouts and manual food logging; paid adaptations, meal plans, photo assistance and more coaching |
| Ads | Optional rewarded ads for free users; premium ad-free; no forced interruptions during logging or training |
| Style | Calm daily use with celebrations for meaningful progress |
| Release | User wants the agreed feature set completed before public launch, implemented and tested in stages |
| Budget | Up to RM100/month for development/testing services; no validated production cost estimate yet |
| AI | OmniRoute candidate confirmed as diegosouzapw/OmniRoute; hosting and upstream provider selection remain unconfirmed |

## What competing apps already do

Public documentation checked 15 October 2026; these are product-documentation findings, not hands-on testing or an exhaustive market survey. Store pricing, availability and platform parity require separate verification. Absence from a page does not prove absence from an app.

| Product | Documented strength | Lesson for Rise120 |
| --- | --- | --- |
| Fitbod | Workout recommendations use goals, history, recovery and equipment; duration is adjustable | Daily flexibility alone is not a unique claim. Make the beginner decision process clearer and connect it to local food habits. |
| Freeletics | Adapt Session and equipment spaces alter workouts for current conditions | Preserve meaningful progression when users shorten or change sessions. |
| Hevy | Workout logs, routines, rest timers, personal records and friend activity | Keep logging fast; put detailed gym metrics behind an optional advanced view. |
| MyFitnessPal | Food logging, premium scans and a meal planner with shopping lists; its documented meal-planner regions do not include Malaysia/Singapore | Locally reviewed recipes and portions are a potential regional opportunity; validate demand rather than asserting exclusivity. |
| Healthy 365 | Singapore meal logging including photo search, activity/sleep goals, challenges and rewards | Local food and rewards already have a strong competitor. Rise120 must offer a coherent training-and-nutrition journey, not merely a local food database. |
| Nike Training Club | Free workouts and guided demonstrations | Basic workouts face strong free alternatives; charge for useful personalisation and convenience. |
| Cronometer | Premium nutrition analysis and recurring food/meal scheduling | Rich nutrition detail can be optional; beginners should not need to understand every metric. |

Sources:
- Fitbod: https://help.fitbod.me/hc/en-us/sections/360001078993-Understanding-Fitbod-How-It-Works
- Freeletics: https://www.freeletics.com/en/blog/posts/freeletics-spaces-feature/
- Hevy: https://www.hevyapp.com/
- MyFitnessPal: https://support.myfitnesspal.com/hc/en-us/articles/34347930588557-Premium
- Healthy 365: https://www.healthhub.sg/programmes/healthyliving
- Healthy 365 photo flow: https://www.healthhub.sg/programmes/healthyliving/dishtrictgames
- Nike Singapore: https://www.nike.com/sg/membership/free-running-training-apps
- Cronometer: https://cronometer.com/gold/

## Recommended experience

1. **Today:** time, location and energy choices produce one recommended session with duration and a short explanation. Start is prominent; swaps and details remain available. A short session counts as participation without misleadingly equating its training volume to a full session.
2. **Food:** easy meals appropriate to cooking access and budget, reusable favourites and practical local portions. Show nutrient sources and uncertainty. Photo results are candidates the member confirms; never silently treat an image as precise calories or infer allergen safety from it.
3. **Progress:** lead with useful changes over time, explain missing data and distinguish observations from causes. Let users hide weight and photos. Do not present a few incomplete meal logs as a reliable metabolic estimate.
4. **Coach:** explain progress using actual logged evidence; proposals show affected dates and exact before/after values. The user decides. Existing server quota, validation and approval mechanisms are retained.
5. **Buddy:** invitation-only groups initially, completion milestones and optional sharing. Include leave/block/report controls before launch. Leaderboards use bounded participation goals so excessive training does not earn unlimited points.
6. **Recovery:** offer a manageable next session after missed days. Avoid shame messages and compulsory catch-up workouts. Day 120 is a review and next-step choice, not loss of access to history.

Do not add more top-level screens for every feature. Prototype a five-destination navigation within the existing app, keeping buddy features under progress/community access and meal planning under Food. Test this with beginners before committing the layout.

## Changes that must be reconciled with the current build

- The current free plan-day lock and food-log quota conflict with free core workouts/manual logging. Change entitlements and server rules deliberately with migrations and regression tests; do not merely remove the paywall UI.
- Current coach proposals affect future UTC days with a two-day margin. Same-day session adaptation needs a separate explicit design, time-zone handling and tests; it cannot be implemented by loosening coach validation globally.
- The current schema has one plan per user. Repeat cycles/maintenance require historical plan ownership, active-plan selection and log association without overwriting the first cycle.
- The exercise seed needs a broader reviewed catalogue plus owned/licensed demonstration media. Existing one-exercise-per-pattern data cannot support meaningful swaps.
- Local food data review, food-source reuse decisions, real billing/ads, provider evaluation and device checks remain launch gates. More features do not satisfy those existing gates.
- Buddy sharing, health-platform permissions, photo processing and reminders each require their own bounded specification. Do not silently append them to Phase 5 Task 5.

## Build sequence proposed for review

Finish and review the already-issued Task 5; preserve the remaining approved Phase 5 evaluation/review work. Then map the expansion against the original Phase 6 scope before assigning phase numbers or coding tasks. Proposed dependency order: (A) navigation prototype and revised free/premium rules; (B) exercise catalogue and daily session selection; (C) reviewed meals, budget/cooking preferences and planning; (D) reminders and private buddy participation; (E) confirmed photo logging and a specified Android health-data integration; (F) repeat-cycle data model, complete usability tests and release verification. These are planning workstreams, not replacement phase numbers. The user wants all agreed features ready before public launch; staged internal testing still applies.

## RM100/month and OmniRoute

RM100 is a testing spending ceiling, not evidence that the public service can run at that cost. Use existing free allowances where suitable, local tests, small authorised model evaluations, per-user limits and a global spending stop. Cache reusable catalogue content and avoid model calls for routine calculations. Reviewed videos/recipes, hosting, store fees and ongoing provider usage need a separate estimate; do not assume volunteers, licences or free tiers cover them.

Eswar confirmed https://github.com/diegosouzapw/OmniRoute. Documentation reviewed on 15 October 2026 describes an MIT gateway, not a grant of free model access: users bring eligible provider accounts, each with its own limits and terms. The README recommends at least 2 GB container memory for light chat; hosting is a separate cost. These are documentation findings, not a runtime or security audit.

Recommendation: evaluate locally with synthetic data first, then consider a server-side adapter. Keep the path Rise120 → Supabase coach endpoint → OmniRoute → approved provider. Preserve database quotas, request IDs, output validation and explicit proposal acceptance. Use one evaluated primary model and at most one evaluated fallback, not every free provider. Test English, Malay and Tamil, structured outputs, latency, failure/retry behaviour and measured cost before selecting them. Do not introduce automatic retries that invalidate the current unknown-outcome protection.

The security document says stored credentials remain plaintext without STORAGE_ENCRYPTION_KEY and guardrail errors fail open. Configure encryption, authenticated HTTPS and restricted administration, verify prompt/log retention, and retain Rise120's own validation. Gateway filtering is not a substitute for it. Review each upstream provider's commercial-use and data-handling terms before sending member data. No gateway or provider key belongs in the app. No installation, deployment or provider change has been made.

Sources: https://github.com/diegosouzapw/OmniRoute and https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.52/SECURITY.md

## Next evidence needed

Evaluate the confirmed OmniRoute candidate and eligible upstream providers; review the six-phase source plan against these additions; verify Malaysian/Singapore availability and pricing for the shortlisted competitors; conduct hands-on UX comparison where accessible and collect a small, clearly labelled sample of current user feedback. Test the proposed Today/Food/Progress flow with beginners. Record where findings are measured versus inferred. No claim of uniqueness or market superiority is approved by this draft.
