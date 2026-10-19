# Faster local logging and eating-out guidance (Milestone D3)

**Status: code complete; the database table was verified live on development with synthetic dishes. No dish is published, so the eating-out screen shows its honest empty state until reviewed dishes exist.** Nothing here has been run on a phone.

## Favourites and recent foods

`src/food/favourites.ts`, shown on the food search screen (`app/food-search.tsx`) above Recent foods.

- Kept on the phone **per account** (`rise120.cache.<account>.favourites`), so they are there after a restart and with no signal, are never shown to another account, and are removed with the account (sign-out keeps the phone's data for that account; account deletion clears it, tested).
- A favourite is a **snapshot of the food as saved**, including its source, source id and verified label. A curated food stays labelled verified and a USDA or custom food stays unverified; nothing is promoted. If the latest version of the food the app has seen differs from the snapshot, the row says the catalogue now holds different values, and keeps showing what was saved. A recipe food carries its version in its source id (`recipe-id@version`), so an old version stays identifiable.
- The servings last used are remembered and the next log starts there, but the member can always edit the portion before saving.
- **Open Food Facts products are never stored as favourites** (read-only preview decision unchanged).
- Saving a meal uses the existing food-log queue with the entry's stable id, so pressing Save repeatedly makes **one log**, and a pending log replays through the existing sync. Existing food-log authorisation and the free manual logging path are unchanged.

## Eating-out guidance

`app/eating-out.tsx`, linked from the Food tab. Data: table `eating_out_dishes` (migration `20261019071400`), read model `src/food/eatingOutData.ts`, rules `src/food/eatingOut.ts`.

- **Reviewed dishes only.** Members read a dish only when it is published; they never write. Publishing needs a complete reviewer, names in all three languages and at least one tip in all three languages.
- **Approximate, never precise.** Calories are an approximate **range** (minimum below maximum) for a portion the dish describes, with the source, version, access date and licence evidence of that figure. A single exact figure is refused by the database and the app; unknown calories are shown as unknown, never zero.
- The screen always states that this is general guidance, not a menu, and does not mean any restaurant serves the dish. There is no restaurant or live availability data.
- With no reviewed dishes it says so and offers the manual path (log food myself).

## What is needed before the eating-out screen shows anything

Reviewed dishes written by someone qualified: names, tips and (optionally) a calorie range with its source and licence, in English, Malay and Tamil. None exist, and none were invented. The same review and rights gates as the curated food seed apply (`curation-review.md`).
