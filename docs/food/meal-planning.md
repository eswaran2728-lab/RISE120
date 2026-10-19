# Meal planning and shopping lists (Milestone D2)

**Status: code complete and verified against the development project with synthetic reviewed recipes. No real recipe is published, so members see the empty state until reviewed recipes exist** (see `recipes.md` for what is needed). The planner never claims a plan fits a budget or a target it cannot check.

## What it does

`app/meal-planner.tsx`, linked from the Food tab. Logic in `src/food/mealPlanner/`:

- **`select.ts` (`selectMeals`)**: deterministic selection from **reviewed recipes only** (published and shared). No AI; calories and protein come from each recipe's own sourced values. It respects:
  - cooking access: a recipe needs every piece of equipment it lists; with no cooker only no-cook recipes are offered (no cooker is the default, never assumed);
  - time: prep plus cook minutes within the limit; a recipe with unknown times is left out when a limit is set;
  - diet and allergens: only recipes whose claims (already validated against their ingredients) cover the choice; vegan counts as vegetarian;
  - targets: portions (0.5 to 2 servings) chosen towards the calorie target per meal; recipes with unknown calories are left out when there is a calorie target; with no target it uses one serving and says the plan was not checked;
  - budget: a fit is claimed only when every price is known and in the budget currency; unknown prices, another currency and an over-budget plan are each reported, never hidden.
  When nothing matches it plans nothing and says why (`excluded` counts by reason).
- **`shoppingList.ts` (`mergeShoppingList`)**: quantities are added only when units are compatible (g with kg, ml with l, or the same unit); anything else stays a separate line, because a spoon cannot be turned into grams without guessing. Ingredients are identified by reference, not display name.
- **`prefs.ts`**: the member's choices, per account on the phone, validated.
- **`api.ts`** and the **`meal-plan`** function: save with `{requestId, expectedRevision, selections}`.
- **`plannedLog.ts`**: logging a planned meal.

## Server rules (verified live on development, migration `20261019065700_meal_plans.sql`)

Saving is **premium only, decided on database time** (a lapsed subscription is refused even if the tier still says premium). An edit names the revision it was made against (0 for the first save); a different current revision is refused with the current one, so two phones cannot overwrite each other, and two simultaneous saves give one winner. A repeat of the same request id returns the original result and writes nothing. A selection may only point at a **published, shared (reviewed)** recipe version; drafts, in-review, missing and other members' private recipes are refused. Members can read only their own plan and never write the table directly. Saving never creates a food log.

## Reopening a saved plan

Opening Food, then Meal Planner, shows the plan the member saved, with its revision, exactly as saved. It does not depend on current preferences or on the order recipes arrive in, and it never changes by itself.

- **Suggest a new plan** is an explicit action. A new suggestion is saved only by a separate Save, against the revision the member saw (stale revisions are still refused by the server), with a request id that is reused on retry. "Back to my saved plan" returns without saving anything.
- A saved recipe version that is no longer available is shown with a plain explanation, **Replace** (with an eligible reviewed recipe, same servings) or **Remove**. Edits are a draft until saved; Save is offered only when every meal is available. A free member sees the saved plan and is offered Premium for edits (the server still enforces it).
- If the saved plan cannot be read, the screen says so, offers Try again and does not offer to overwrite it.

## Logging a planned meal

Choosing a recipe logs nothing. The member presses Log, is asked to confirm, and only then is the meal logged through the existing food-log queue with a **stable id** (account, day, meal, recipe and slot), so a double tap, a retry or a replay is one log, and an edited portion updates that log. Logging is offered for today's meals only. The recipe is logged as the member's private food (`source = recipe`, unverified) holding its per-serving values; a recipe with any unknown core value cannot be logged (a log needs real numbers, never zeros). The first log of a recipe version needs a connection to create that food; afterwards it works offline from the phone's remembered foods.

## Limits

- The plan shown is always a fresh suggestion; the saved plan is only used for its revision. Re-opening a saved plan is not built.
- Budget is per day and in ringgit only (Malaysian recipes are priced in MYR).
- Premium is read from the limits snapshot; with no snapshot the server decides.
- Nothing here has been run on a phone.
