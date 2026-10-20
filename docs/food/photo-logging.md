# Food photo logging (Milestone F2)

**Status: Tasks 1 to 3 are being built with a fake provider. No real image provider is configured, the provider kill switch is OFF, and nothing here analyses a real member's photo. No phone verification has been done.**

## Task 1: private image lifecycle and request admission (verified live on development with synthetic images)

### Images

- Private bucket **`food-photos`**, separate from `checkin-photos`. The food-photo code never reads, lists or deletes check-in photos (tested with a canary object).
- A member may create exactly one kind of object: `"<their user id>/<request id>.jpg"`, `image/jpeg`, at most **1.5 MB**. Other names (check-in style dates, nested folders, other extensions), other MIME types and oversized files are refused by the bucket. There is **no update policy**, so an object cannot be overwritten. Reads and deletes are own-folder only; the bucket is never public. Another member, or a signed-out caller, can neither read, sign, write, overwrite nor delete it.
- **Server-side byte check** (`_shared/food/photo/image.ts`, `inspectFoodPhoto`) runs before any provider could see an image. It ignores the MIME type the client claimed and walks the JPEG's markers: it must start like a JPEG, be well formed and end with an end-of-image marker, declare a size between 64 and 1600 pixels on each side, and carry **no metadata** (EXIF, XMP, IPTC or comments are rejected; a JFIF header, a colour profile and Adobe colour flags are allowed). Metadata is **rejected, not stripped**: the app re-encodes before upload, so an image that still has EXIF or location data did not come from the app and nothing raw is sent upstream. Limitation: it validates structure and declared size, it does not decode pixels, so it cannot tell a picture of food from any other picture.

### Request admission (the ledger)

`food_photo_requests`, one row per (member, request id), changed only by the server:

| Result | Meaning |
| --- | --- |
| `reserved` | Admitted. Exactly one provider start may follow. |
| `in_progress` | The same request id is already running or its outcome is unknown. **Never started a second time.** |
| `completed` | The one stored result is replayed, whatever the switches say now. The first result wins. |
| `limited` | The daily allowance is used (completed analyses plus live reservations). Concurrent requests cannot exceed it (tested with six at once). |
| `unavailable` | `disabled` (the provider kill switch `food_photo_enabled` is off, **the default**), `premium_required` (the same server rule behind `check-limit`'s `photoFood`), or `config` (a missing or invalid value: fails closed). |

A **known failure** is recorded with `failPhotoRequest`; it does not count as a completed analysis and the id may be admitted again. The image reference must be exactly the member's own `<user id>/<request id>.jpg`, so a check-in photo path or another member's path is refused before anything is stored. A stored result must be a JSON object of at most 16 KB. Members can read their own rows and nothing else; they cannot call the functions or write the table.

Server configuration (`app_config`): `food_photo_enabled` (false), `food_photo_per_day` (10), `food_photo_retention_hours` (24). The numbers are placeholders chosen to be safe, not a cost decision; the owner sets the real ceiling before any live provider.

### Retention and cleanup

- **Maximum temporary-image retention: 24 hours.** A completed or known-failed request has its image deleted by the server on the next cleanup run (and the later analysis function deletes it immediately); an abandoned upload with no request, and an unfinished request, are removed once older than the retention period.
- Files are removed through the **Storage API** (`food-photo-cleanup` function). Deleting `storage.objects` rows with SQL would orphan the files (Supabase's own storage documentation warns about this), so SQL is used only to list what is due and to record what was deleted.
- **Scheduling** uses Supabase's documented mechanism (`pg_cron` calling an Edge Function through `pg_net`, with the credentials in Vault; checked against the Supabase guide "Scheduling Edge Functions" on 20 Oct 2026). The job `food-photo-cleanup` runs hourly at minute 17. It is authenticated with a random secret held as the function secret `FOOD_PHOTO_CLEANUP_SECRET` and the Vault secret `food_photo_cleanup_secret` (never in Git); without it the function refuses every request (tested), and the job does nothing if the Vault secrets are missing. On development the secrets are set and one scheduled tick was run end to end (HTTP 200, nothing to delete). **Production needs the same two secrets set; this is a deployment step.**
- Deleting an account deletes its ledger rows (cascade) and, in `delete-account`, every object in the `food-photos` folder (tested), so a stranded image cannot block the deletion.

### What was and was not tested

| Claim | Level |
| --- | --- |
| Bucket policies, MIME and size limits, no overwrite, cross-member and anonymous denial | Live on Rise120 development, synthetic images |
| Admission, replay, concurrency, failure, fail-closed config, premium gate, result bound, direct access denied | Live on development |
| Cleanup of finished, abandoned and expired images; other buckets untouched; repeat safe | Live on development |
| The scheduled job reaching the function with the secret | One manual tick on development; the hourly schedule itself has not yet run unattended |
| Account deletion removes rows and images | Live on development |
| Byte validation (non-JPEG, truncated, metadata, dimensions, size) | Unit tests on synthetic byte sequences (not real camera files) |
| Real camera JPEGs from a phone pass the validator after the app re-encodes them | **Not tested** (needs a phone) |

## Task 2: candidate analysis contract (fake provider only)

`analyse-food-photo` (deployed to development with **no provider configured**): `POST { requestId, privateImageRef }` with a member JWT.

- The image reference must be exactly the member's own `<user id>/<request id>.jpg`; another member's path, a check-in photo path or a different request id is a 400. Extra body fields (including any nutrition a client sends) are ignored and never stored.
- Flow: reserve (ledger) -> read the image -> byte check -> **one** provider call under **one** deadline covering the whole call -> resolve the provider's suggestions against the catalogue -> store the one result -> delete the image.
- A provider (the `PhotoProvider` port) only suggests **references** (`food` id or `recipe` id, optional confidence and portion). The answer is built by the server: only shared, sourced foods (`curated` or `usda`, verified or with a source id) and shared, published recipes survive. Unknown, fabricated, draft, private, other members', unsourced and Open Food Facts references are dropped. Names come from the catalogue, never from the provider; the uncertainty label is one of `likely`, `possible`, `unsure`; a portion is a quarter-serving suggestion between 0.25 and 10 or none; at most 5 candidates. **No nutrition is returned.** The app reads the full record under the member's own access when they review it.
- A candidate whose record lacks complete sourced nutrition comes back with `loggable: false` (it can only lead to manual search).
- Outcomes: `200 ok / no_match` (a stored result, replayed for the same request id even if the switch is later turned off), `409 in_progress`, `429 limited` with a retry time, `503 unavailable` (`disabled`, `premium_required`, `config`, `provider`), `422 invalid_image` (`missing`, `not_jpeg`, `malformed`, `metadata`, `dimensions`, `too_large`), `502 failed` (a **known** provider failure: recorded, image deleted at once, the same id may try again), `504 unknown`.
- **Unknown outcomes** (a timeout, an error after which the provider may have answered, an unexpected error, a failed catalogue lookup after the provider answered): the request stays unresolved, the same id is **never started again**, and a late answer is ignored. The image is kept only until the retention period.
- The function never writes a food log (tested for every outcome).

**What the tests prove and do not prove.** The handler tests run the real ledger, storage and catalogue on Rise120 development with a **fake provider** and synthetic images, foods and recipes. They prove the contract above. They do **not** show that any real model can recognise a meal, how accurate it is in English, Malay or Tamil, or what it costs. With no catalogue of reviewed Malaysian foods published yet, the honest result for real use is `no_match` and manual search.

The deployed function passes `provider = null`, so on development a request ends in `unavailable` (`disabled` now; `provider` if the switch were on) and removes the image.

## Remaining tasks

Task 3 (member confirmation flow) and Task 4 (real provider gate, device checks) follow; this document is extended as each lands.
