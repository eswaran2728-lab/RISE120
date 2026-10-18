# Training content

Reviewed exercises and session templates. **This folder is empty on purpose**: nothing here may be invented or copied. Every published item needs a qualified reviewer and licensed or owned demonstrations, and neither exists yet. See `docs/superpowers/plans/2026-10-15-rise120-full-roadmap.md`, task C1.

- `exercises/<id>.json` — one `ExerciseVersion` per file (type in `src/workout/catalogue.ts`).
- `sessions/<id>.json` — one `SessionTemplate` per file.
- Check everything with `npm run content:check` (exit code 1 on a real problem; "nothing published" is reported as a launch gate, not a failure).

## Status

| Status | Meaning |
| --- | --- |
| `draft` | being written; may be incomplete; never offered to members |
| `in_review` | written, waiting for a qualified reviewer; never offered |
| `published` | reviewed and complete; the only status members can ever see |

A **published exercise** needs: a reviewer (name, role, review date); a name and at least two cues in English, Malay and Tamil; a demonstration with its source and licence; and, if it is a home or no-equipment exercise, at least one published home alternative of the same movement pattern.

A **published session** needs: a reviewer; a length of 10, 20, 30, 45 or 60 minutes that matches its sets (within about a third); sets 1 to 6 and reps 1 to 50; and every exercise in it published.

The app and server also re-check these rules and drop anything that fails, so a mistake here cannot put unreviewed content in front of a member.

## What is not allowed

- Agent-generated exercise descriptions or cues published as reviewed. A person with the right qualification must review them.
- Video, images or text copied from other apps or sites. Use media Rise120 owns or has a written licence for, and record that licence in the file.
- Medical claims, calorie-burn figures or promises about results.
