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

## Remaining tasks

Task 2 (analysis function over a fake provider), Task 3 (member confirmation flow) and Task 4 (real provider gate, device checks) follow; this document is extended as each lands.
