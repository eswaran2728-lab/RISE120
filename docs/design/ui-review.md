# UI review log

Status at 18 October 2026. This file records what has been checked and what has not. It does not claim a usability result that has not happened.

## Reference

- Clickable concept: `docs/design/prototype.html` (open in a browser; fictional data, simulated controls). Copied from the Codex planning folder (`docs/design/rise120-prototype.html`).
- Specification: `docs/product/ui-ux-spec.md` (proposal), `docs/product/product-direction.md` (proposal), `docs/product/access-matrix.md`.
- Theme: Solar Gold + Midnight (tokens in `src/theme/tokens.ts`, contrast tests in `src/theme/__tests__/tokens.test.ts`).

## Built so far in the real app

| Item | State | Evidence |
| --- | --- | --- |
| Colour tokens (bg, surface, gold accent, text, secondary text, dark-on-gold) | Done | Jest contrast tests |
| Today: real journey-day arc, one gold session card with one action, separate small steps | Done | Jest interaction tests; not seen on a phone |
| Five-tab bar restyled (same order, line icons, 48-point items) | Done | Jest tests; not seen on a phone |
| Shared accessible components (roadmap A2): ActionButton, SectionCard, AsyncState, SyncNotice, ScreenFrame | Done; no screen uses them yet | Jest component tests; not seen on a phone |
| Workout, Food, Coach, Progress, Settings restyle (roadmap A3) | Not started | |

## Checks the owner still has to do (not done by the implementer)

1. **Screen review.** Open `docs/design/prototype.html` and the development build; confirm or change the hierarchy of the five tabs. The implementer cannot approve a design on the owner's behalf.
2. **Beginner usability pilot** (spec section 10): five target beginners are each asked to start a session, log a local meal, understand a coach proposal and find the sharing controls. Record completion and confusion honestly in the table below. A qualitative pilot, not market validation.
3. **Device checks:** 360 and 412 logical-pixel widths, 200% text, TalkBack, keyboard open, reduced motion, Android Back, Tamil long text, one offline state.

## Pilot record (empty until it happens)

| Participant | Start a session | Log a local meal | Understand a proposal | Find sharing controls | Confusion noted |
| --- | --- | --- | --- | --- | --- |
| (none yet) | | | | | |
