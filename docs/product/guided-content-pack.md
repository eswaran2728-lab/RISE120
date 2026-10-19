# Guided-workout content pack: audit, design and status

**Status: DRAFT. Nothing here is reviewed, nothing is published, and the app offers none of it.** All 18 exercises and 8 sessions in `content/` are `draft`, with `reviewer: null` and `media: null`. They were written by an AI assistant (Claude) and are a starting point for a qualified reviewer, not approved training advice. Run `npm run content:check` (structure) and `npm run content:readiness` (what is still missing) at any time.

## 1. Audit: what the app and database require

**Where the schema lives:** `src/workout/catalogue.ts` (types and rules), `scripts/training-content/validate.ts` (the checker behind `npm run content:check`), `supabase/migrations/20261018054518_training_catalogue.sql` (tables `exercise_versions`, `session_templates`), `20261018070000_exercise_links.sql` (`exercise_links`).

**An exercise** (`content/exercises/<id>.json`): `id` (lowercase letters, digits, hyphens), `version`, `pattern` (squat, hinge, push, pull, core), `equipment` (`none` bodyweight, `home` home equipment, `gym`), `name` and `cues` in English, Malay and Tamil, `regressions` and `alternatives` (ids), `media`, `reviewer`, `status`.

**To be published** an exercise needs, enforced twice (the app checker and a database check constraint): a reviewer with name, role and review date; a name in all three languages; at least two cues, each in all three languages; media with a **source** and a **licence**. The app checker also requires that a `none` or `home` exercise has a published alternative of the same pattern that can be done at home, and that alternatives share the exercise's pattern.

**To be published** a session needs a complete reviewer, a length of 10, 20, 30, 45 or 60 minutes, 1 to 6 sets and 1 to 50 reps per exercise, every exercise published, and a declared length within 35% of the estimate (100 seconds per set plus 2 minutes of warm-up). For drafts the checker only enforces the structural rules (known ids, same-pattern alternatives, valid minutes and prescription), so a draft can look valid while still being incomplete. That gap is why `npm run content:readiness` exists: it reports what each draft still lacks.

**What the app does with it** (`selectSession`): it never offers more than the minutes chosen, never a level above the member's, and only sessions whose every exercise the member can do. At a gym everything is usable; at home a member with equipment `home` can use `none` and `home` exercises, and a member with `none` only `none`. It picks the longest session that fits, so a request for 45 or 60 minutes with no longer session gets the longest shorter one, labelled as shorter to fit. Ties are rotated by the day number.

**What is not connected yet:**

1. There is no import path from `content/*.json` into `exercise_versions` and `session_templates`. Publication today would be hand-written SQL by someone with database access. A reviewed, dry-run-first import script is a task still to do.
2. `exercise_links` maps each catalogue exercise to a row of `public.exercises` (the table logged sets use). It is empty. Guided sessions are offered only when every exercise in them has a link.
3. `public.exercises` is the existing seed (15 rows, some duplicated by equipment). Candidate matches for the pack are listed in section 5.

## 2. What the pack contains

18 exercises (9 bodyweight, 5 home-equipment, 4 gym) and 8 beginner sessions, goal `recomp` (which the app treats as a fit for any goal), normal training days.

| Session | Place | Needs | Minutes | Sets |
| --- | --- | --- | --- | --- |
| `home-bodyweight-10` | home | nothing | 10 | 6 |
| `home-bodyweight-20` | home | a chair or counter | 20 | 12 |
| `home-bodyweight-30` | home | a chair or counter | 30 | 18 |
| `home-equipment-20` | home | dumbbells, a chair or bench | 20 | 12 |
| `home-equipment-30` | home | dumbbells, a band, a chair or bench | 30 | 18 |
| `gym-beginner-20` | gym | machines | 20 | 12 |
| `gym-beginner-30` | gym | machines, dumbbells | 30 | 18 |
| `gym-beginner-45` | gym | machines, dumbbells | 45 | 24 |

All use 2 to 3 sets of 8 to 12 repetitions. Every exercise lists same-pattern alternatives (and easier versions where one is drafted).

## 3. Coverage of the 10 / 20 / 30 / 45 / 60 minute choices

Verified by `npm run content:readiness`, which simulates what the app would pick if everything were approved:

| Member | 10 | 20 | 30 | 45 | 60 |
| --- | --- | --- | --- | --- | --- |
| no equipment (home) | `home-bodyweight-10` | `home-bodyweight-20` | `home-bodyweight-30` | `home-bodyweight-30` | `home-bodyweight-30` |
| home equipment | `home-bodyweight-10` | `home-bodyweight-20` or `home-equipment-20` | `home-bodyweight-30` or `home-equipment-30` | same as 30 | same as 30 |
| gym | `home-bodyweight-10` | `gym-beginner-20` | `gym-beginner-30` | `gym-beginner-45` | `gym-beginner-45` |

(The two home-equipment choices are tied, so the app rotates them by day number.)

**Deliberate gaps for the reviewer to decide, not filled by guesswork:**

- **No 45- or 60-minute home session and no 60-minute session at all.** 45 and 60 fall back to a shorter session. Whether a 60-minute beginner session is appropriate is a design and safety decision.
- **No gentle (recovery) session.** Low energy therefore falls back to the normal session. A reviewed gentle session would need to be designed.
- **No bodyweight pull exercise.** Bodyweight sessions have no pulling movement. The existing plan seed uses a "Prone W raise" for this; whether it belongs in the catalogue is the reviewer's call.
- **Time-based exercises (planks, holds) are left out** because the schema counts repetitions, not seconds.
- **Per-side exercises** (dead bug, bird dog, one-arm row): `reps` is drafted as the number of repetitions per set, and whether that means each side or in total is not yet defined. The reviewer should decide and the cue text should say so.

## 4. Source and authorship notes

- **Authorship:** every name, cue, alternative and prescription was drafted by Claude (an AI assistant) in October 2026 from general, widely taught beginner resistance-training technique.
- **No external text, images, video or app content was copied.** No third-party source is cited, because none was consulted for this draft. The qualified reviewer must record the reference they relied on when they approve each item; this file does not claim one.
- **Translations:** the Malay and Tamil are AI-drafted. They have not been checked by a native speaker. Known points to check: the Malay "otot punggung" is used for the gluteal muscles (in Malay *punggung* can mean buttocks or, in some usage, back); sports terms such as "deadlift" and "dumbbell" are transliterated or kept in English and may have preferred local forms.
- **No health claims:** cues contain no calorie, fat-loss, results or medical claims (a test enforces this). They contain general safety wording only ("choose a weight you can control", "check the band for tears"). Whether to add a general "stop if you feel sharp pain" note, and where, is for the reviewer and owner.
- **Media:** there is none. No video, image, URL, licence or ownership statement exists, and none was invented. See the checklist for exactly what to supply.

## 5. Link candidates to the existing `public.exercises` seed

For the person who sets up `exercise_links` (this draft changes nothing in the database):

| Catalogue id | Possible existing row | Note |
| --- | --- | --- |
| `bodyweight-squat` | Bodyweight squat (`none`) | exact name |
| `chair-squat` | Chair squat (`home`) | exact name |
| `glute-bridge` | Glute bridge (`none`) | exact name |
| `hip-hinge-bodyweight` | Unloaded hip hinge (`home`) | name differs |
| `wall-push-up` | Wall push-up (`none`) | exact name |
| `incline-push-up` | Countertop incline push-up (`home`) | name differs |
| `dead-bug` | Dead bug (`home` or `none`) | two rows share this name; pick one |
| `goblet-squat` | Goblet squat (`gym`) | seed lists it as gym; catalogue draft says home equipment |
| `dumbbell-romanian-deadlift` | Dumbbell Romanian deadlift (`gym`) | same equipment difference |
| `chest-press-machine` | Chest press machine (`gym`) | exact name |
| `seated-cable-row` | Seated cable row (`gym`) | exact name |
| `knee-push-up`, `dumbbell-floor-press`, `band-row`, `dumbbell-row`, `leg-press-machine`, `lat-pulldown`, `bird-dog` | none | need new `exercises` rows (a migration), or the drafts should be changed to use what exists |

Logged sets, history and progress use the `exercises` row, so a link is a permanent statement that two names are the same movement: choose carefully.

## 6. Tests that guard this pack

`src/workout/__tests__/contentPack.test.ts` keeps the pack structurally sound (valid ids and file names, three-language cues that are not copies of English, same-pattern alternatives, a home substitute for every non-gym exercise, sessions that fit their length once approved, equipment that matches each session's name, full coverage of the time choices) and keeps it honest: every item must stay `draft` with no reviewer and no media, and any item moved out of `draft` must carry a complete reviewer. `src/workout/__tests__/contentReadiness.test.ts` tests the readiness tool itself.
