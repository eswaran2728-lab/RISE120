# Android Health Connect (Milestone G2)

**Status: code complete and tested with a scripted adapter and mocked native library. It has NOT been run on a phone, so nothing here claims it works on a real device or with a real wearable. A new development client is required before it can be tried.**

## What it does

An optional, read-only link to Android Health Connect for **steps** and **sleep**, in Settings (Android only):

- Off until the member taps **Connect**; the permission dialog appears only then. Nothing is read, requested or stored before that.
- Reads the last 30 local days, one value per day: steps (Health Connect's own per-day total, which it already de-duplicates across apps) and minutes asleep (overlapping sessions from several apps are merged as time intervals and counted once; awake and out-of-bed stages are left out when a record has stages). A night belongs to the local day the person **woke up**, using the zone stored with the record when there is one, otherwise the phone's zone.
- Shows the **source** (Health Connect, and the apps the numbers came from) and the **last read time**, and the last 7 days.
- **Manual entries are never touched.** Imported values live in their own per-account store (`rise120.cache.<account>.health`), displayed with their source, and are not merged into check-ins.
- Re-reading the whole 30-day window every time means an updated source record changes that day's copy and a deleted one removes it; the same data read twice changes nothing. Days older than 30 days cannot be re-checked and are kept until they are older than 120 days.
- A failed read keeps the earlier copy and says so; the next read recovers with no duplicates. All reads must succeed before anything is saved.
- Permission handling: before every read the app asks Health Connect what is currently granted. All access gone: nothing is read, the screen says so, what was imported is kept until the member disconnects. One of the two gone: the other keeps importing and the missing one is not touched or deleted.
- **Disconnect** (with a confirmation) asks Health Connect to drop the app's access, then removes every imported copy for that account. On Android 14 and later the system applies a revoke when the app restarts (library and platform documentation), so the screen says that and offers Health Connect settings; if the revoke itself fails the copies are still removed and the member is told to remove Rise120 in Health Connect settings.
- Account switching: every read, save and removal is keyed by the account that started it; a read that finishes after the signed-in account changed is dropped, and the screen is rebuilt per account. Deleting an account clears the stored copies with the other per-account caches.

## What it deliberately does not do

- It never writes to or deletes from Health Connect, and requests exactly two permissions, `READ_STEPS` and `READ_SLEEP` (tests pin the manifest and the request). No background reading, no history beyond 30 days, no energy, heart rate, weight, exercise or any other type.
- **Wearable calorie estimates can never change a nutrition target**: this code cannot see them, and a test checks that no plan, food, today or coach code (client or server) imports it.
- **Imported data is not sent to Rise120's server.** The roadmap's file list included a `*_health_imports.sql` migration; nothing yet uses imported values on the server, so keeping health data on the phone is the more private choice and there is **no migration and no server deployment** in G2. If a later feature needs it server-side, that needs its own disclosure and migration.

## Compatibility, checked 21 Oct 2026

Sources: Android developers, Health Connect "Get started"; the library's published package (4.1.3, MIT, last published 6 Aug 2026), read from its npm tarball.

- Health Connect client library needs Android 8 (API 26) or higher; the Health Connect app itself needs Android 9 (API 28). Android 14+ has it built in; Android 13 and below need the app from Play. The app checks `getSdkStatus` and reports unsupported, not installed, or update required.
- Library: **`react-native-health-connect` 4.1.3** (pinned exactly). Expo integration is included since v4 (no separate package); built against React Native 0.86 and Expo config plugins 57 (this project: Expo SDK 57, RN 0.86.3); supports old and new architecture; Android only; **not usable in Expo Go**. It uses `androidx.health.connect:connect-client:1.1.0`.
- Its config plugin adds the permission-rationale intent filter and the `ViewPermissionUsageActivity` alias; its manifest adds the Health Connect package query. `app.json` adds the two read permissions and `expo-build-properties` with **`minSdkVersion: 26`** (React Native's default is 24).
- **Consequence: Rise120 will no longer install on Android 7.x (API 24 and 25).** That is a product decision for the owner; the alternative is dropping the feature.
- `expo prebuild` was run to inspect the result: the manifest contains `READ_STEPS`, `READ_SLEEP`, the rationale intent filter and activity alias, and `android.minSdkVersion=26`.

## Open findings

1. **The camera permission is removed from the Android manifest.** The prebuilt manifest contains `uses-permission android.permission.CAMERA tools:node="remove"`, which comes from `expo-image-picker` configured with `"cameraPermission": false`. That removal wins over the permission `expo-camera` declares, so the barcode scanner and the F2 photo camera would not be able to get camera permission. This is not G2's change, but the previous F2 note ("the Android CAMERA permission comes from the barcode plugin") was **wrong**. It needs a fix (for example remove that option or give the picker plugin the camera permission text) and a phone test; it is not fixed here.
2. **Permission rationale screen.** Health Connect's permission dialog links to the app's privacy policy through the intent filter the plugin adds. That intent opens Rise120's main screen; Google requires it to show the same privacy policy as the Play listing. A screen or web page for that does not exist yet.

## Google Play: declarations still needed before release

Not done (they are made in Play Console, not in code):

- Health Connect **permissions declaration** for the two data types, `READ_STEPS` and `READ_SLEEP`, with the user-facing purpose ("show your steps and sleep next to your training; never used for targets, ads or sale"). The manifest permissions must match what is declared.
- A **privacy policy** URL covering Health Connect data (what is read, that it stays on the phone, how to remove it, that it is not shared or sold), identical to what the rationale screen shows.
- The **Data safety** form updated for health data, and compliance with Play's Health Connect permitted-use and limited-use rules.
- Wording check: the Gemini and Health Connect terms both restrict medical advice claims; nothing in this feature gives any.

## Build

Native dependencies changed (`react-native-health-connect`, `expo-build-properties`, minSdk 26, new manifest entries), so a **new development client** is needed: `eas build --profile development --platform android`. Until that build is installed on a phone, the Settings section reports "not available in this version of the app" on Android.

## Phone checks (none done)

On a phone with Android 14 or later and Health Connect holding steps and sleep from at least two apps:

1. Settings shows the section only on Android; before tapping Connect, check in Health Connect that Rise120 has no access.
2. Connect: the permission screen lists exactly Steps and Sleep, read only. Allow both; steps and sleep for recent days appear with the source apps and a last-read time.
3. Compare a day's steps with Health Connect's own total (no double count when two apps overlap), and a night's sleep with the sleep apps (overlap counted once; the night is under the wake-up day).
4. Deny the dialog once, then twice (Android stops asking): the app explains and offers Health Connect settings.
5. Allow only one of the two; then revoke one later in Health Connect: the app keeps the other importing and says which is missing; revoke both: it stops reading and says so.
6. Delete or edit a record in the source app; read again: the day changes or disappears and nothing duplicates.
7. Change the phone's time zone and re-read: nights recorded with their own zone stay on the same day.
8. Airplane mode: reading still works (it is local); the app does not break.
9. Disconnect: confirm; the imported days vanish; check-ins you typed are untouched; Health Connect shows whether Rise120 still has access (on Android 14+ it may only drop after restarting the app).
10. Sign out and sign in as another account: the other account sees nothing from the first; delete a test account and confirm nothing stays.
11. Try on Android 13 or lower with and without the Health Connect app installed (unavailable, update required) and on a phone below Android 9 (unsupported). Rise120 itself will not install on Android 7.
12. Large text, TalkBack and the Android Back button on the section; Malay and Tamil text read by a native speaker (the Malay and Tamil strings are drafts awaiting review).
