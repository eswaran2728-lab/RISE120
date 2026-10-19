# Buddy milestones, reports and moderation (Milestone E2)

**Status: code complete and verified live on development. Reporting is deliberately CLOSED: it opens only when a real person and process exist (below). Nothing here has been run on a phone.**

## Participation and milestones

- One participation point per **local day with a logged workout** (`workout_logs.log_date`, distinct days). More sets, more entries, a repeated sync, more activities, heavier weights, fewer calories or weight lost never add a point. Ranking uses only those day counts; ties share a rank and are listed A to Z without regard to capital letters, then by the group-only member id, so the order is the same on every phone.
- A **milestone** is "N workout days". The thresholds live in `app_config.buddy_milestone_days` (default 7, 14, 30, 60, 90, 120) and the server decides whether a member has earned one.
- **Nothing is shared by opening the screen.** The member previews exactly what the group would see ("*Name* reached *N* workout days"), with a plain note that no weight, photos, meals, coach messages or workout details are shared, and must press Share. The server then stores the share against a request id.
- A group can read only a display name, the number, when it was shared and whether it is the caller's own. Never account ids, weight, photos, meals, coach messages or raw logs (tested live, including the raw response text).
- Access is decided on every read: **withdrawing, leaving, removal, blocking, expiry (default 30 days, `buddy_share_ttl_days`) and account deletion** take the share out of every group's view at once. A member who blocks someone leaves the group (existing E1 rule), so they stop seeing it too.
- Every share request id is remembered. A delayed replay of a share that was withdrawn is refused (`SHARE_WITHDRAWN`), so it cannot bring it back; a new, deliberate share needs a new request id. Repeats of an active share are one share.
- Cross-group access is refused: a share can only be made into a group the member is in, and shares are only readable by members of that group.

## Reports

- Any member of a group can report another member of **the same group**: a reason (harassment, spam, unsafe or harmful, other) and an optional note up to 300 characters. The server **acknowledges** with a reference and stores it for authorised review. The reported member is not told. There is no public chat and members can never read or write reports (no table grants; only the server function).
- Same request id repeated, or a second report about the same person in the same group while one is open, is acknowledged with the first (no duplicates). A member can file at most `buddy_reports_per_day` (default 5) a day.
- Reports are deleted when either account is deleted (data minimisation). A closed report keeps only names, reason, note and resolution; the moderator is never shown account ids, logs, weights, photos, meals or coach text.

## Moderation workflow (restricted)

- Endpoint `buddy-moderation`, actions `queue`, `start_review`, `resolve` (`no_action`, `removed_from_group`, `other`, with an optional note). It serves **only** accounts named in `public.buddy_moderators`; for everyone else every action returns the same 404 `not_found` an unknown endpoint gives. There is **no screen for it in the app** and no queue is exposed to ordinary members.
- `removed_from_group` removes the reported member from that group (and their shares) through the same rule E1 uses for the owner removing a member.
- Closing a report records the moderator, time and resolution.

## Gate: reporting stays closed until all of this is true

`buddy_reports_open()` is true only when **`app_config.buddy_reports_enabled` is `true` AND at least one row exists in `buddy_moderators`**. Until then the app says plainly that reporting is not open (it offers block and leave instead) and the server refuses reports (`REPORTING_UNAVAILABLE`, nothing stored). The owner must decide and write down, **before** turning it on:

1. **Who** reviews reports (a named, real person, and a named backup), and that they will use their own Rise120 account to call `buddy-moderation` (add them to `buddy_moderators` with the service role). A small internal tool for this is not built; until one exists, review calls are made with the function directly.
2. **How fast** reports are looked at, and what a member is told. The app only promises that a person will review it; it gives no time.
3. **Escalation**: threats, self-harm, illegal content or anything involving a child are not handled in the app; the process must say who contacts whom (and the emergency services where needed).
4. **Records**: how long closed reports are kept (they are deleted with either account today) and who may see them.
5. A contact route for people who are removed to ask why.

Then, with the service role: `insert into buddy_moderators (user_id) values ('<moderator user id>')` and set `buddy_reports_enabled` to `true`. To close it again set the flag to `false` or delete the moderator rows; takes effect immediately.

## What still needs a phone

Previewing and confirming a share, withdrawing, the closed-reporting explanation and a report with an acknowledgement on a real device, in English, Malay and Tamil (the Malay and Tamil wording is a machine draft and needs a native-speaker review), and the Solar Gold + Midnight styling of the new cards.
