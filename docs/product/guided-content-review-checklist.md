# Guided-workout content: review checklist and publication gates

Nothing in `content/` may be published until every box below is ticked for that item. Do not change a status, add a reviewer name, a date, a licence or a video link unless it is real and can be shown. `npm run content:readiness` lists what is still missing.

## A. Supplied by the owner (cannot be drafted)

- [ ] A named **qualified reviewer** (name, role, qualification) for exercises and sessions, and the real review date for each item.
- [ ] **Media for each of the 18 exercises**: a video or image Rise120 owns or has a written licence for. For each: source (who made it), licence terms, and a link if it is shown in the app. None exists yet.
- [ ] **Native-speaker reviewers** for Malay and Tamil (all cues and exercise names).
- [ ] Decision on **who loads approved content** into the database (no import script exists) and who creates the `exercise_links`.

## B. Qualified reviewer, per exercise (18)

- [ ] Instructions are correct and safe for a beginner, with no missing safety cue.
- [ ] Equipment class (`none`, `home`, `gym`) is right, including household items (chair, counter, bench).
- [ ] Alternatives are genuinely suitable substitutes (same movement; confirm vertical vs horizontal pulls, and lat pulldown as an alternative to rows).
- [ ] Easier versions (regressions) are correct.
- [ ] Reference relied on is recorded: ______ (this pack cites none).

## C. Qualified reviewer, per session (8)

- [ ] Sets, reps and order suit a beginner; the declared length is realistic.
- [ ] Decide: should there be a **45/60-minute home** session, a **60-minute** session, a **gentle (recovery) session**, a **bodyweight pull**? (Currently left out on purpose.)
- [ ] Define what `reps` means for per-side exercises (dead bug, bird dog, one-arm row) and make the cue text match.
- [ ] Decide whether a general "stop if you feel sharp pain" note is added, and where.

## D. Language review

- [ ] English, Malay and Tamil cues read correctly and naturally (check "otot punggung", transliterated equipment terms).
- [ ] No health, calorie or results claims (enforced by a test; confirm by eye).

## E. Media and licence evidence (per exercise)

- [ ] Source and licence recorded in the exercise file (`media.source`, `media.licence`, `media.url` if shown).
- [ ] Ownership or written permission is on file outside Git. Nothing is copied from other apps or sites.

## F. Technical steps after approval (not done, not to be done early)

- [ ] Set `reviewer`, `media`, and `status` in the JSON for approved items only; run `npm run content:check` and the content tests.
- [ ] Create `exercise_links` (see section 5 of `guided-content-pack.md`; seven exercises have no existing row).
- [ ] Load into `exercise_versions` and `session_templates` on the development project first (dry run, then apply), then verify the guided card offers the sessions.
- [ ] Phone checks: the full guided flow, large text, TalkBack, Android Back.
