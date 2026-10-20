# Food photo logging (Milestone F2)

**Status: Tasks 1 to 3 are being built with a fake provider. No real image provider is configured, the provider kill switch is OFF, and nothing here analyses a real member's photo. No phone verification has been done.**

## Task 1: private image lifecycle and request admission (verified live on development with synthetic images)

### Images

- Private bucket **`food-photos`**, separate from `checkin-photos`. The food-photo code never reads, lists or deletes check-in photos (tested with a canary object).
- A member may create exactly one kind of object: `"<their user id>/<request id>.jpg"`, `image/jpeg`, at most **1.5 MB**. Other names (check-in style dates, nested folders, other extensions), other MIME types and oversized files are refused by the bucket. There is **no update policy**, so an object cannot be overwritten. Reads and deletes are own-folder only; the bucket is never public. Another member, or a signed-out caller, can neither read, sign, write, overwrite nor delete it.
- **Server-side byte check** (`_shared/food/photo/image.ts`, `inspectFoodPhoto`) runs before any provider could see an image. It ignores the MIME type the client claimed and walks the JPEG's markers: it must start like a JPEG, be well formed and end **exactly** at an end-of-image marker (any byte after it, including a second JPEG, is refused), declare a size between 64 and 1600 pixels on each side, and contain only application segments whose payload **verifies** as what its marker says: a 16-byte JFIF header with no thumbnail, an Adobe colour-flags segment, and an ICC colour profile (numbered chunks in order, the first with a real profile header, at most 128 KB in total). EXIF, XMP, IPTC, comments, any other application segment and any unverified payload are refused as metadata. Metadata is **rejected, not stripped**: the app re-encodes before upload, so a file that still carries it did not come from the app and nothing raw is sent upstream. **Limits, stated plainly:** this is a structural check of the container. It does not decode pixels, cannot tell a picture of food from any other picture, and cannot see data hidden inside the compressed picture or inside a valid colour profile. **It is not proof that a photo is free of metadata, and no claim of full metadata removal is made until real re-encoded phone JPEGs have been checked on a phone** (in particular that they end exactly at the end-of-image marker and that their colour-profile and header segments pass).

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
- Outcomes: `200 ok / no_match` (a stored result, replayed for the same request id even if the switch is later turned off), `409 in_progress`, `429 limited` with a retry time, `503 unavailable` (`disabled`, `premium_required`, `config`, `provider`), `503 temporary` (a Storage read failed **before** the provider started: the request is released as a known, retryable failure, nothing is charged, the provider was not started and the image is kept; the same request id can be sent again), `422 invalid_image` (`missing`, `not_jpeg`, `malformed`, `metadata`, `dimensions`, `too_large`), `502 failed` (a **known** provider failure: recorded, image deleted at once, the same id may try again), `504 unknown`.
- **Unknown outcomes** (a timeout, an error after which the provider may have answered, an unexpected error, a failed catalogue lookup after the provider answered): the request stays unresolved, the same id is **never started again**, and a late answer is ignored. The image is kept only until the retention period.
- The function never writes a food log (tested for every outcome).

**What the tests prove and do not prove.** The handler tests run the real ledger, storage and catalogue on Rise120 development with a **fake provider** and synthetic images, foods and recipes. They prove the contract above. They do **not** show that any real model can recognise a meal, how accurate it is in English, Malay or Tamil, or what it costs. With no catalogue of reviewed Malaysian foods published yet, the honest result for real use is `no_match` and manual search.

The deployed function passes `provider = null`, so on development a request ends in `unavailable` (`disabled` now; `provider` if the switch were on) and removes the image.

## Task 3: the member flow (`app/food-photo.tsx`, `src/food/photo/*`)

Reached from a **Log a meal with a photo** button on the Food tab. The button always opens the screen; the screen asks the server (`check-limit`'s `photoFood`, through `loadLimitsOrCached`) and shows one of: the photo steps, Premium plus manual search (server says not available), or "we could not check" with a retry plus manual search (no server answer: access is never guessed). **Manual food search is one tap away on every state.**

The six steps, each in the member's hands:

1. **Permission.** The camera is requested only when the member taps Take a photo. Denied: a plain explanation, the camera is not opened, and Choose a photo and manual search stay available.
2. **Capture or select.** The picked image is downsized (longer edge at most 1280 px) and re-encoded as a JPEG into a per-account folder (`food-photos/<user id>/`, separate from check-in photos). The temporary re-encoder file is removed.
3. **Upload and analyse.** One request id per photo, kept for retries; upload to the private bucket (an object already there counts as sent), then `analyse-food-photo`. The local copy is kept until the server has given a definite answer (or the screen is left), so that if cleanup has already removed the uploaded image before a retry, the app sends the kept photo again, once, under the same request id; a second "missing" is explained, not looped. Failure states are explained (no match, unavailable, premium needed, daily limit, still in progress, unknown outcome, failed, unusable photo, offline). Only a lost connection, a plain error, a temporary problem or "still in progress" offer **Try again** (same request id). An **unknown outcome is never retried automatically** and has no retry button: choose another photo or search.
4. **Candidate review.** Up to five candidates with the catalogue name, an uncertainty label (likely, possible, not sure), the source and verified label (or "Reviewed recipe") and a suggested amount labelled as a guess. A candidate the server marked unloggable shows why and cannot be opened.
5. **Portion correction and 6. nutrition and source preview.** The record is read under the member's own access (a shared sourced food, or a published recipe at that version; a missing, private or no-longer-sourced record is "gone"). The existing entry sheet shows the source, serving, nutrition and total for the amount, prefilled with the suggestion and editable, plus a note that a photo cannot show the exact amount. A recipe with any unknown core nutrient is unloggable.
7. **Save.** `confirmPhotoCandidate` is the only path from a photo to a meal. It uses the existing offline queue (`queueFoodLog`) with the entry's stable log id, so repeated Save is one log; the food keeps its source and verified label. A recipe goes through its private food (`recipe_food` queued before the log) exactly as in the meal planner. It works offline, and syncs later.

Account safety: the screen is rebuilt per account; a late analysis for the previous account is dropped; leaving the screen removes the local photo and, if no answer arrived, the uploaded object; sign-out and account deletion remove the account's local food-photo folder.

No text anywhere claims exact nutrition, allergy safety or halal status (tested).

**Tested (Jest, synthetic data and mocked services):** the API contract and error mapping, candidate normalisation and caps, record resolution, the confirmation rules, local file handling, every screen state above including account switching, double Save and offline Save, the Food-tab entry and its access hint, sign-out and deletion clean-up, and the Malay and Tamil strings being present. **Not tested:** anything on a phone, real camera or gallery behaviour, whether the re-encoder really leaves no EXIF (the server rejects such a file if it does), and whether real camera JPEGs pass the server's byte check.

**Strings.** Malay and Tamil text for this feature are drafts written without a native speaker and **await native-speaker review**.

**Android permission note.** `expo-image-picker` is configured with `cameraPermission: false`; the Android CAMERA permission comes from the `expo-camera` plugin (barcode scanning), and its iOS usage text mentions only barcodes. Before a build that ships photo logging, the camera permission text must cover meal photos and the new build must be tried on a phone.

## Review fixes (after `c29ff3d`)

1. **A transient Storage read error no longer ends the request.** The server used to treat any download error as "image missing", which recorded a failure and deleted the image, and a thrown read error left the request reserved (so a retry got `in_progress` and the quota slot stayed held). Now only a clear not-found means missing. Any other read failure releases the reservation as a known failure before the provider starts (`503 temporary`), keeps the image, charges nothing and allows exactly one provider start on the retry (tested: one start, one completed analysis, two simultaneous retries start it once, an unrelated request is still admitted under a one-a-day allowance). If cleanup has really removed the image, the answer is `missing` and the app re-sends its kept local photo once.
2. **The byte check is stricter.** Trailing bytes after the end-of-image marker, and APP0/APP2/APP14 payloads that do not verify, are refused (synthetic bytes). A real phone's re-encoded JPEG normally ends at the marker and carries only a JFIF header and perhaps a colour profile, so it should still pass, but that is **unverified until tried on a phone**.

## Task 4: not started (gate)

Task 4 needs all of: a named operator, approved image-provider commercial and data terms for member photos, a bounded test budget, measured retention, a server-owned daily and monthly spend ceiling with a kill switch, and a sourced candidate catalogue. None exists, F1's OmniRoute no-go does not authorise routing images through it, and the provider kill switch (`food_photo_enabled`) stays off. With no provider the deployed function answers "unavailable" and the app shows manual search; with no catalogue of reviewed Malaysian foods the honest real-world result would be "no match".

### Phone checklist (when a provider exists)

Permission denied then allowed; capture and gallery selection; candidate edit and manual fallback; explicit Save; airplane mode after a candidate arrived; app restart; account switch; account deletion; a poor connection; large text, TalkBack and the Android Back button; English, Malay and Tamil with native-speaker review.
