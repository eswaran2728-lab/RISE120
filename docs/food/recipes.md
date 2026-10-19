# Sourced local recipes: schema, provenance and what is still needed

**Status: code complete for the schema, validator, read model and database rules. No recipe exists and none is published.** `content/recipes/` is empty on purpose. The 20 Malaysian food candidates in `docs/food/curated-candidates.csv` are names only; they have no nutrition, serving size, licence, translation, reviewer or recipe, and none was invented. Run `npm run recipes:check` to validate `content/recipes/*.json`.

## What a recipe is

Types in `src/food/recipes.ts`, rules in `src/food/recipeRules.ts`, read model in `src/food/recipeData.ts`, arithmetic in `src/food/portions.ts`, table `public.recipes` (migrations `20261019064800` and `20261019065200`).

| Part | Rule |
| --- | --- |
| Ingredients | explicit references to foods by `(source, source_id)`, an amount greater than zero and a unit (g, kg, ml, l, tsp, tbsp, cup, piece), and allergy and diet **tags** (`null` tags mean unknown) |
| Yield | a positive number of servings; any portion, including fractions, scales from it |
| Preparation | localised steps (English, Malay, Tamil), prep and cook minutes (unknown = `null`), equipment needed (none, stovetop, rice cooker, oven, microwave, kettle) |
| Regional names | reviewed `aliases` per language only; none are invented |
| Diet labels and free-from claims | only `vegetarian`, `vegan`, and named allergens. A claim is allowed only when **every ingredient has known tags and none contradicts it**; unknown never supports a claim. "Halal" is a certification, not a property of ingredients, so it cannot be a label here |
| Nutrition | per serving, with provenance: source name, version read, access date, record id/URL, and written licence evidence. Unknown nutrients are `null`, never `0` |
| Price | optional: amount, ISO currency, date priced, servings it covers, source. The currency must match the region (MY = MYR). Unknown price is `null` |
| Publication | a published shared recipe needs a complete reviewer, names in all three languages, preparation steps, and the nutrition provenance above. `verified` is only possible on a published, reviewed recipe |

## Portions: grams, servings and per-100 g are different things

Values carry their basis (`per_serving` or `per_100g`) and the functions refuse the wrong one. Per-100 g values become per-serving only with a known serving weight; with an unknown weight every value is unknown. Volumes and pieces convert to grams only when a weight per unit is supplied. Scaling multiplies per-serving nutrition by the servings wanted, and ingredient amounts by servings over yield.

## Database rules (verified live on development)

- Shared recipes (`user_id` null) are written by the service role only. A member sees one only when it is `published`.
- A member may keep private recipes of their own. A client can insert or edit only rows that are `private`, not verified, not reviewed and not published: it can promote nothing, and cannot make a recipe shared or owned by someone else.
- One shared recipe per `(id, version)`: a duplicate import fails; a change is a new version. Accounts can each have a private recipe with the same id.
- A shared published recipe may use only shared foods; a private recipe may use shared foods and its owner's own foods. Unknown foods are refused.
- A price in a currency other than the region's, or malformed, is refused. Blank or whitespace-only required text never satisfies a rule.
- Private recipes are deleted with their account.

## Sources and reuse (not changed by this task)

No external data was added, so no source terms were re-checked for this task. The findings in `curation-review.md` stand as last checked: MyFCD has no reuse licence found (permission needed); USDA FoodData Central is CC0; Open Food Facts stays read-only preview (option A) and nothing from it is stored, merged or used as a recipe ingredient. Do not copy competitor databases.

## What must be supplied before any recipe can be published

1. **Review and rights evidence for the 20 candidate foods** (see `curation-review.md`): serving size, per-serving energy, protein, carbohydrate and fat from a named source and version, the written right to reuse it, a reviewer.
2. **Recipes themselves** for dishes the owner wants in the planner: ingredient list with amounts, yield, preparation, equipment, and the nutrition source for the finished dish. These must be written or approved by a person; none exist.
3. **Ingredient foods** the recipes reference must exist as shared foods (a reviewed curated seed or imported USDA foods), because a published recipe can reference only shared foods.
4. **Ingredient tags** (meat, dairy, egg, gluten, peanut and so on) checked by someone qualified, before any diet or allergy claim is made.
5. **Malay and Tamil** names, aliases and preparation text from native speakers.
6. **Prices**: a dated price and its source, in ringgit, if the budget feature is to say anything about cost.
7. A decision on **how approved recipes are loaded** into the database (no import tool exists yet; the guided-content import tool is the pattern to follow).
