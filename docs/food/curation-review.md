# Curated Malaysian food seed: review and rights gate

**Status: OPEN. No food is verified and no verified seed is deployed.** This file is the review package for Eswar. Phase 3 stays open until this gate is closed (see "What closes the gate").

## What "verified" means in Rise120

A food may be marked `verified = true` only if a person has reviewed all of: the serving size, energy, protein, carbohydrate and fat for that serving, the source record, and the right for Rise120 to reuse the data. Search ranks verified Malaysian foods (`verified = true`, `region = 'MY'`) first. Nothing else is ever labelled verified: USDA, Open Food Facts and users' own foods are always "unverified" in the app.

## Where things stand

| Item | State |
| --- | --- |
| `docs/food/curated-candidates.csv` | 20 well-known foods, **names only**. Every row is `unreviewed`. No serving size, nutrition, alias or source is filled in, on purpose. |
| Tooling (`supabase/tools/curated/curation.ts`, tests in `supabase/tests/curated-candidates.test.ts`) | Done and tested. It refuses to build a seed unless a row is `approved` **and** has a valid serving, numeric nutrition, source name, URL, record id, access date, written reuse-permission evidence and a reviewer. A blank nutrient is never treated as zero, and numbers cannot exist without a source. |
| Seed migration | **Not created.** It will be generated only from rows you approve. |

I did not invent any nutrition value, serving size or Malay/Tamil name, and I did not copy values from MyFCD. Aliases in `ms` and `ta` appear in the app only after a native-speaking reviewer supplies them.

## Source and reuse-rights findings (read before choosing a source)

1. **Malaysian Food Composition Database (MyFCD), myfcd.moh.gov.my.** The site shows a copyright notice for the MyFCD Programme (Institute for Medical Research, 1997 to 2015) and a liability disclaimer. I found **no licence, no statement that reuse or redistribution is allowed, no download and no API.** Being viewable online is not permission. Treat the data as all rights reserved until the owner of the data says otherwise. The general contact on the site is the Nutrition Division, Ministry of Health Malaysia (nutrition@moh.gov.my; +603-8892 4503 / 4556).
2. **USDA FoodData Central** is public domain (CC0) per USDA, so its values can be used and cross-checked. It has few Malaysian dishes, and what is imported from it stays unverified, not "curated".
3. **Your own data** (weighed and measured dishes, or values from product labels you are allowed to use) belongs to you or the person who produced it. Record the method in `notes` and put the producer's consent in `reuse_permission_evidence`.

## Suggested permission request (for MyFCD)

> To the Nutrition Division, Ministry of Health Malaysia: I am building Rise120, a nutrition and fitness app. May I store selected MyFCD values (listed foods only) in the app's database and show them to users with attribution to MyFCD? Please tell me whether this is allowed for a commercial app, the wording you want for attribution, and whether modified or rounded values may be shown.

Keep the reply. Paste its reference (date, name, ticket number) into `reuse_permission_evidence` for each row it covers.

## Review checklist for each row

- The serving is defined clearly (for example "1 plate (250 g)"), the numbers are **per that serving, not per 100 g**, and the serving amount and unit match the description.
- Energy is consistent with protein, carbs and fat (the validator checks this; a mismatch usually means a unit or serving mix-up).
- The preparation variant is stated (with or without sugar, with sauce, and so on).
- Source name, URL, record id and the date you looked at it are filled in.
- Reuse permission evidence is filled in, and a reviewer name.
- Malay and Tamil names (`alias_ms`, `alias_ta`, separated with `;`) were written or approved by a native speaker. Leave blank if unsure.

## How to approve

1. Fill in a row and set `verdict` to `approved`.
2. Run `npx jest supabase/tests/curated-candidates.test.ts` to see any problems with the file.
3. Tell Claude the rows are approved. It will generate the seed migration from the approved rows only, add live checks, deploy it to the Rise120 development project, and then you can review it in the app before anything goes to production.

## Decisions needed from you

1. Which data source and which rights path (permission from MyFCD, your own measurements, or both).
2. Who reviews the nutrition values (you, a dietitian, or another reviewer).
3. Who reviews the Malay and Tamil names.
4. Edits to the 20 candidate foods, and what a "standard plate" means for mixed dishes such as nasi kandar.

## Open Food Facts reuse decision (needed from you)

Open Food Facts publishes its database under the Open Database Licence (ODbL), the individual contents under the Database Contents Licence (DbCL), and product images under CC BY-SA. In plain terms: you may use it, including commercially, but you must **credit Open Food Facts and name the licence with a link**, and **derivative or combined databases must be shared under the same terms (share-alike)**. Being able to call its API is not permission to merge its data into a database you do not want to share.

Today Rise120 only **looks products up and shows them with their source, never stores or logs them**. The scan screen already shows the attribution. The options:

| Option | What it means | Obligations |
| --- | --- | --- |
| A. Stay read-only (current) | Scanning shows a source-labelled preview; users add their own food instead. | Attribution on the scan screen (done). No share-alike exposure. |
| B. Let users log scanned products into their own private foods | Each logged product is copied into that user's private data. | Needs advice on whether that is a derivative database; keep OFF-derived rows isolated by source id so they can be exported or removed. |
| C. Merge into the shared food database | OFF products become shared rows searchable by everyone. | Share-alike likely applies to the combined database; do not choose without legal advice. |

I have kept the app on option A. Tell me which option you choose; for B or C I will write the failing offline-replay tests first, keep the rows isolated and auditable by source id, and add the attribution text, but only after your decision.

## Recipes (Milestone D1)

The recipe schema, validator, read model and database rules are built (see `recipes.md`). They hold no data: every recipe needs the same review and rights evidence as a curated food, plus ingredient tags and Malay and Tamil text. Nothing from this file's candidate list has been turned into a recipe.

## What closes the gate

Phase 3 is not complete until: a reviewed, rights-cleared seed is approved and deployed; the Open Food Facts reuse decision is made; and the final cross-phase phone checks pass.
