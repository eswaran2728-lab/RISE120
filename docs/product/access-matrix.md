# Rise120 access matrix (proposed free core and premium capabilities)

Status: **proposed amendment to the original Part 4**, implemented task by task from roadmap item B1 on the owner's instruction of 18 October 2026 ("proceed full roadmap"). It has **not** had the prototype review or the beginner usability pilot the roadmap asks for in A1; those remain open and the matrix can be revised. Source: `docs/product/product-direction.md` (Free/premium, Ads rows) and the roadmap (`2026-10-15-rise120-full-roadmap.md`, A1 and B1).

Every limit and capability below is enforced by the server (`app_config`, database triggers, edge functions, row-level security). The app only displays what `check-limit` returns. Missing configuration for a paid or AI feature fails closed.

| Capability (`check-limit` key) | Free | Premium | Notes |
| --- | --- | --- | --- |
| Basic 120-day plan (`basicPlan`) | All 120 days | All 120 days | Replaces the 14-day free lock |
| Manual food logging (`manualFood`) | Unlimited | Unlimited | Replaces the 3 logs per UTC day limit |
| Manual workout, check-in logging and history | Yes | Yes | Never paywalled |
| Daily session choice (time, place, energy) | Yes, reviewed templates | Yes | The Start button is never locked |
| Adaptive progression (`adaptiveProgression`) | No | Yes | Uses history to adjust future progression; previews and needs confirmation |
| Meal planner and shopping list (`mealPlanner`) | No | Yes | Reviewed recipes only |
| Photo-assisted food logging (`photoFood`) | No | Yes | Always confirmed by the member; separate cost quota |
| Coach (`coach`) | Server-configured daily allowance (initially 1 per UTC day) plus verified rewarded-ad credits | Server-controlled fair use | Proposals always need explicit acceptance; no unlimited-provider promise |
| Rewarded ads | AI message credits only (existing cap of 3 per UTC day) | None | Food-log ad rewards retired in the new UI; earned ledger records are kept |
| Buddy groups (invitation only) | Open question | Open question | Participation feature; decide before E1 ships |
| Health-app sync (read-only) | Open question | Open question | Decide before G2 ships |

Rules that do not change:

- Premium comes only from the verified RevenueCat webhook and the database-time expiry rule. A client SDK event, cache or ad callback never grants it.
- Lapsed premium removes paid capabilities but never the member's own data or the basic plan.
- Prices come from the store. Existing proposed prices (RM 39.90 monthly, RM 199 yearly, RM 399 lifetime) stay as proposed until store review. No new tier is sold before its benefits exist.

Open decisions for the owner: buddy and health-sync tiers; whether a short free coach explanation of the week should not consume the daily message; the final premium fair-use wording (must exist before selling it).

## How the policy is switched on (B1, implemented 18 October 2026)

The mechanism exists on the development project and is **off**, so current behaviour (3 food logs per UTC day, 14 free plan days) is unchanged until the owner decides. To turn the proposed free core on:

```sql
update public.app_config set value = 'true'::jsonb where key = 'manual_food_unlimited';
update public.app_config set value = '120'::jsonb  where key = 'free_plan_days';
```

To go back, set them to `false` and `14`. Nothing else needs a deploy. `check-limit` then reports unlimited manual food for free accounts, 120 accessible plan days, and a `capabilities` object (`basicPlan`, `manualFood`, `adaptiveProgression`, `mealPlanner`, `photoFood`, `coach`). While `manual_food_unlimited` is true, `request-ad-reward` refuses food rewards (`409 reward_unavailable`); AI rewards and already earned credits are untouched.

The adaptive, meal-planner and photo capabilities are reported now but gate nothing yet: each feature will enforce its own server check when it is built (roadmap C2, D2, F2).
