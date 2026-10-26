# Workspace UI and navigation improvements

Branch: `fix/workspace-navigation`

## Implemented

- Primary Home, Clients, Create, Calendar and More links remain available on authenticated secondary screens. Public invitation and review pages remain separate.
- Mobile primary navigation matches the desktop destination order and respects generation permissions.
- Client workspace links carry their client to Social Connections, Calendar and Analytics. Social authorization return URLs preserve that client.
- Clients, Review, Calendar and the publishing screen reload on focus, preserving local search and filter state.
- Rescheduling returns to the preceding screen, or the client calendar when opened directly. Its controls wait for the post to load and failed loads expose a retry action.
- Reschedule presets use the client's calendar date and time zone, including daylight saving transitions. Confirmation and recommendation times use that same zone.
- Calendar uses the agenda layout below 1024px to avoid crowded tablet columns.
- Analytics shows loading and retry states instead of zero activity during pending or failed requests; older filter responses cannot replace newer results.
- Calendar and Analytics filter controls expose selected states and meet the 44px minimum touch size.
- More cards retain two columns and equal heights within each row while allowing larger text to expand the row.

## Remaining review items

This change is the first implementation pass, not completion of every review finding. Remaining work includes unsaved-edit protection, confirmations for destructive administrative actions, a searchable client picker, full Calendar display/range time-zone alignment, state-specific publishing actions, and the other screen refinements from the UI review. Physical Android/iOS keyboard, font scaling and native modal acceptance remain necessary.

## Verification

Regression coverage includes secondary navigation, client links, return from rescheduling, Calendar refresh, and schedule presets across positive/negative offsets and daylight saving changes. Executed checks:

- `npm test`: 117 passed.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm run build:web`: passed.
- Android and iOS JavaScript exports: passed.
- The initial desktop/mobile Chromium suite exposed a narrow X filter target and web selection announcements; both were fixed. A test insertion error and a status expectation were also corrected. The affected scenarios were then rerun against the final web build: all 14 desktop/mobile Chromium checks passed.

Native exports do not establish physical-device acceptance. WebKit execution was unavailable because its required system libraries are absent.
