<!-- Copied into the repository on 18 October 2026 from the Codex planning folder
     (docs/superpowers/specs/2026-10-15-rise120-ui-ux.md, last updated 16 October 2026). The text below is the planning
     document unchanged; it is a PROPOSAL, not an approved replacement for the original spec. -->

# Rise120 UI/UX specification

Status: proposed design for owner review, updated 16 October 2026. This is a concrete screen and interaction specification, not a claim that a visual prototype has been tested. Companion: `2026-10-15-rise120-product-direction.md`. Visual reference: the user-selected Solar Gold + Midnight theme from the Rise 120 design chat (`codex://threads/01a13e70-185c-7591-b75a-af7db1bf0268`), whose local preview is `C:/Users/eswaranp/.codex/visualizations/2026/10/15/01a13e70-185c-7591-b75a-af7db1bf0268/rise-120.html`.

## 1. Design decision

Use **Solar Gold + Midnight** for Rise120's identity, native Android behaviour, and five existing tabs. Adapt the reference's sunrise progress arc, rounded solid cards and bold primary action to the real workout, food, coach and progress flows. The reference has only Today, Train and Journey and uses fictional interactions; those are visual examples, not the app's route map or data source. Make the experience calm, readable and practical for a beginner. Celebrate completing a meaningful action; never shame someone for missing a day. No extra tab for each new feature.

The selected palette from the reference is background `#101419`, surface `#1C232B`, gold accent `#FFC568`, primary text `#F6F5F1`, secondary text `#B1BAC5`, and dark text on gold `#101419`. Keep the existing spacing scale `0,4,8,12,16,24,32,48` and minimum touch target of 48 logical pixels. Define semantic tokens for secondary surface, border, warning, destructive, success, focus and disabled states after checking contrast. Gold communicates the main action and journey progress; do not reuse it for every status. Error, success and pending states need text/icon cues as well as colour. Do not scatter colour literals across screens.

The sunrise arc is a visual progress summary, labelled with the actual journey day and accessible as text. Do not infer workout completion from day number. On the Today card, use the gold session surface from the reference only when it leaves text and buttons legible; secondary cards stay midnight. On other tabs, use gold for focused actions and selected navigation, rather than copying the entire gold card everywhere.

Use the platform font with tested Tamil shaping, scalable 16-point body text, 24–28-point screen headings, and at least 14-point supporting text. Do not adopt a condensed sports font. Body line height approximately 1.5; no fixed-height text containers. Cards use 16-point padding and 16-point corner radius. Page margins 16, section gaps 24. Icons are consistent line icons with text labels; decorative emoji are not navigation controls.

One primary filled action per visible task. Secondary actions are outlined or plain text. No glass effects or animated background. Transitions 150–250 ms when motion is enabled; respect reduced-motion settings. Any celebration is brief, dismissible and never blocks navigation.

## 2. Navigation

Keep current order and route names: Today → Workout → Food → Coach → Progress. Settings is accessed from Today header and remains a normal stack screen. Tab changes preserve draft input. Android Back closes a sheet first, then returns to its originating screen; finishing a workout/check-in returns to Today without duplicate stack entries.

| Destination | First thing visible | Secondary access |
| --- | --- | --- |
| Today | One suitable session and Start/Resume | Quick check-in, meal suggestion, day's completion, Settings |
| Workout | Current session or exercise list | Demonstrations, swaps, rest timer, completed summary |
| Food | Meals today and Add food | Favourites, meal planner, eating-out choices, photo, barcode |
| Coach | Progress explanation and conversation | Suggested prompts, proposal cards, quota, history |
| Progress | This week's consistency and improvements | Strength, wellbeing, optional body metrics, Buddy, cycle history |

Buddy is a stack screen opened from Progress. Meal planner and photo review are stack screens opened from Food. Neither becomes a sixth tab. Keep entry links visible with words; do not hide new features exclusively behind overflow menus.

## 3. Today

Visual order:

```text
Rise120                                  Settings
Day 18 of 120                  Saved / Sync status

[Sunrise journey arc: Day 18 of 120]

What works for you today?
[20 min ▾]  [Home ▾]  [Normal energy ▾]

YOUR SESSION
Full-body basics                      ~20 minutes
Fits your time and available equipment
[ Start workout                              ]
View exercises                       Change session

TODAY'S SMALL STEPS
Workout       Check-in       Food logged

NEXT MEAL
Suggested meal • preparation time • portion
[View meal]                         [Log food]

This week: 3 sessions completed
View progress
```

Time options: 10, 20, 30, 45, 60 minutes. Location: home/gym; actual equipment comes from saved preferences and can be corrected. Energy: low/normal/high. These are candidate inputs, not permission to prescribe unsafe loads. Reviewed session templates define duration and allowed modifications. A rest day remains a rest day unless a separately reviewed rule permits light recovery; no automatic extra hard session for high energy.

Basic template selection is available free. Premium adaptation uses history to adjust future progression. The UI explains this distinction before payment, without locking the main Start button. This resolves the conflict between the promised daily choice and paid personalisation.

If a session is in progress, show Resume and preserve it; changing preferences does not replace logged work. After a gap say “Ready for a fresh start?” and offer a manageable session. Do not move missed volume into today. Food logged is a logging action, not proof that someone ate sufficiently. A short workout earns participation, not the same volume credit as a full session.

## 4. Workout

Show session title, estimated duration and exercise count. Each exercise shows name, demonstration thumbnail, text cues, and current set fields. Expand details only when requested. The numeric keypad must not hide Save set. Reuse previous set values as editable suggestions, never mark a set complete automatically.

Demo: captions/text cues, mute by default, play/pause, no autoplay on cellular. Show a still image and instructions offline when video is unavailable. Do not use unlicensed clips.

Swap sheet: show only reviewed alternatives that match available equipment and the intended movement. Explain “Same movement, different equipment” where accurate. No alternatives means an honest message; never fabricate an exercise. Swaps preserve completed sets and affect remaining work only. Finish shows completed sets, actual duration and optional effort feedback. No calories-burned estimate unless a separately validated method exists.

## 5. Food

Primary action Add food. Search opens with recent foods and favourites, then local verified results and other results with provenance. User chooses portion before saving. Logging a favourite requires food selection, portion confirmation, Save; no compulsory AI call.

Meals today are grouped by breakfast/lunch/dinner/snacks. Show energy/protein summaries only when appropriate targets are available. A missing target says “No target set”; never render zero as a goal. Optional detailed macros stay behind Details. No red moral judgement for food choices.

Meal planner asks cooking access, available time, food preferences and budget when first opened, not during initial signup. Budget is user-entered in MYR or SGD; display prices as estimates with source/date, never a guaranteed shop price. Unknown pricing must remain unknown. Recipes show ingredients, portion, preparation, nutrition source and substitutions. Shopping list consolidates compatible units only. An allergy/preference filter is not a guarantee of safety; incomplete ingredient data is visibly incomplete.

Eating-out uses reviewed local dishes and portion guidance. It does not claim live restaurant menus, halal certification or exact calories without evidence.

Photo flow: permission → take/select photo → confirm food candidates → correct portion → preview totals → Save. AI produces suggestions, not an automatically logged meal. Offer manual search after no match, network failure or exhausted allowance. Separate meal images from private check-in body photos.

## 6. Coach

Keep the existing Task 5 chat/proposal implementation. Add entry prompts tied to logged evidence: “Explain my week”, “Help me choose today”, “Review my plan”. Do not send automatically when a tab opens. Explain what dates/data support a conclusion; incomplete data means a qualified answer.

Proposals display each affected date, before/after changes and Accept/Decline. Pending, accepted, declined and stale states remain distinct. Accept waits for server confirmation; failed cache refresh shows that the change was accepted but the current view needs refreshing. Offline history is readable, but sending requires connectivity. Show remaining AI allowance and reset from the server. No retry loop after an unknown provider outcome.

## 7. Progress and Buddy

Progress default: weekly participation, then strength/fitness, then wellbeing. Weight/photo cards can be hidden. Charts always have readable summaries, units and missing-data states; never connect sparse data in a way that implies a measured daily trend. No causal claim from correlation alone.

Buddy default: private invitation-only group with display name and completion milestones. No public discovery, chat or unsolicited contact in this release. Sharing weight, food logs, body photos or AI chats is off and is not part of automatic group sync. Optional milestone sharing requires a preview and explicit action.

Leaderboard is optional within the group, uses a bounded daily participation score, and offers tied ranks. More sets, fewer calories or more weight lost do not earn extra points. Leave, block and report are visible. Invite previews disclose exactly what joining shares. Member removal immediately removes access to group content.

## 8. Onboarding, reminders and cycle end

Preserve resumable onboarding and existing required plan inputs. Explain why body inputs are needed. Ask optional cooking, buddy and health-sync preferences at their feature entry point. Notifications are requested after the user chooses a reminder, not at first launch.

Reminders: user-selected local time, quiet hours, pause and category switches. Notification content is generic on the lock screen. Never reveal weight, meal details or coach text. No reminder for an action already completed when the app can establish completion. Denied permission leaves the app fully usable.

Day 120 ends with a review and explicit next-cycle or maintenance choice. Old logs and photos remain associated with their original cycle. Starting a cycle never overwrites history or silently renews a purchase.

## 9. Payments and failure states

Prices come from the store, in its returned currency. Clearly distinguish subscription billing and lifetime purchase. Do not preselect a purchase or imply that lifetime includes unlimited provider cost. The final premium fair-use policy must be explicit before selling it. Restore is discoverable; account changes invalidate stale purchase state. Existing server-confirmed entitlement protections remain.

Rewarded ads are optional and explain the exact server-configured benefit before opening. No ads in an active workout, no ad required to recover an unsynced log. With free unlimited manual food logging, retire the food-log ad offer; keep verified AI rewards subject to the existing cap until explicitly changed.

Every async screen must cover loading, empty, error/retry, offline cache with last-sync time, and account transition. Pending user work stays visible. Never call cached access verified. A retry button retries the specific failed action; it does not navigate the user away or discard input.

## 10. Acceptance before screen implementation

Create a clickable prototype of Today, Workout, Food, Coach and Progress, plus example sheets for swap, meal review and buddy invitation. Include one offline state and one Tamil long-text state. Owner reviews actual screens before broad visual changes. The prototype must use fictional data and clearly mark simulated controls.

Test at 360 and 412 logical-pixel widths, 200% text scale, TalkBack, keyboard open, reduced motion and Android Back. Meet at least 4.5:1 normal-text contrast and 3:1 large-text/control contrast; colour is never the only status cue. Small usability pilot: five target beginners, each asked to start a session, log a local meal, understand a proposal and locate sharing controls. Record task completion and confusion honestly; this is a qualitative pilot, not market validation.

This specification combines the user's chosen colour direction with the real app's five-tab product design. Final screen approval and usability results are still pending.
