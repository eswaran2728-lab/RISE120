# Importing approved guided-workout content

`npm run content:import` loads **approved** content from `content/` into the Rise120 development database. It is dry-run first, and the current draft pack cannot be imported: every item is a draft, so the tool refuses it. Nothing has been uploaded, and nothing in the database was changed to build or test this tool.

## What it refuses (all-or-nothing: one problem stops the whole import)

| Code | Meaning |
| --- | --- |
| `not_published` | the item is `draft` or `in_review` |
| `missing_reviewer`, `missing_media`, `missing_licence` | review or media evidence is absent or blank |
| `catalogue_invalid` | any catalogue rule fails: names, cues, unknown or different-pattern alternatives, no home substitute, session references, length that does not fit |
| `mapping_unreviewed` | the mapping has no complete `reviewedBy` |
| `link_missing` / `session_exercise_unlinked` | an exercise (or one in a session) has no reviewed mapping entry |
| `link_unknown_exercise` | the mapping names an exercise that is not in the pack |
| `link_target_invalid` / `link_target_unknown` | the target is not a uuid, or not a row of `public.exercises` |
| `link_shared_target` | two catalogue exercises point at the same logged-set exercise |
| `link_conflict` | an existing link points elsewhere; links are never re-pointed because logged sets use them |
| `version_conflict` | a different version of an already published item; change the `version` number instead |

Exercises are **never matched to `public.exercises` by name**. The mapping is a reviewed file a person writes:

```json
{
  "reviewedBy": { "name": "<who checked the mapping>", "role": "<role>", "reviewedOn": "<YYYY-MM-DD>" },
  "links": { "<catalogue exercise id>": "<uuid of the public.exercises row>" }
}
```

## Dry run

```
npm run content:import -- --mapping content/review/exercise-links.json
```

Reads the database (read-only, needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment, never in Git) and prints every proposed `INSERT`, `UPDATE` and `LINK` with its exact row, then a **plan hash**. `--existing <snapshot.json>` compares with a saved snapshot instead; `--offline` assumes an empty database and does not verify mapping targets (it says so). Exit code 1 means refused.

## Apply

```
npm run content:import -- --mapping <file> --apply --plan-hash <hash> --project-ref kozskxoiyrzrokjmcqeo --confirm-project kozskxoiyrzrokjmcqeo
```

- Only the development project: the ref, the linked project in `supabase/.temp/project-ref`, the host of `SUPABASE_URL`, and the typed confirmation must all be `kozskxoiyrzrokjmcqeo`. Otherwise nothing is read or written.
- Writes exactly the dry-run plan: the hash must match what is in the database now. If the database changed, run the dry run again.
- **One atomic call.** Apply sends the whole plan to a single service-role-only database function, `import_guided_catalogue` (migration `20261019063238`), which runs it in **one transaction**: every write or none. A crash of the tool, a lost connection, a constraint failure or a concurrent change cannot leave a partial publication, and there is no undo step because there is nothing to undo.
- **Rechecked inside the transaction.** The function takes a lock and rechecks every step against the rows as they are at that moment: an insert needs the row to be absent (or already identical); an update needs the stored row to still equal what the dry run saw and not yet be published; a link needs to be absent or identical. Otherwise it raises `PLAN_STALE`, nothing is written, and the tool tells you to run the dry run again.
- **Narrow.** It writes only `exercise_versions`, `session_templates` and `exercise_links`; any other table, an unknown operation, or a row that is not `published` is refused (`INVALID_PLAN`). It never touches `workout_logs` or `exercises`. Members and signed-out callers cannot call it.
- **Idempotent, with correct `published_at`.** Items already identical are skipped and their `published_at` is never rewritten. When an item first becomes published, `published_at` is set from the database clock (one value for the whole import); an existing `published_at` on a draft being published is kept.

## Still blocking the real pack

See `guided-content-review-checklist.md`. In short: a qualified reviewer and review dates; media with source and licence for all 18 exercises; native-speaker review of Malay and Tamil; the reviewer's design decisions; and a reviewed mapping file for 18 exercises (11 have candidate rows in `public.exercises`, 7 need new rows or a change of drafts: see section 5 of `guided-content-pack.md`).
