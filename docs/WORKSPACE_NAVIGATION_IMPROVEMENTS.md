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

## Follow-up implementation

- Brand Brain, Settings, campaign details and post copy protect unsaved changes. Back navigation, browser unloads, shared primary links, profile-menu routes, sign out and native notification opens are covered. Users can keep editing or discard; successful saves clear the guard. Discarding also restores the retained screen's saved draft.
- Approval saves edited post copy before approving. AI/assignment actions ask before replacing unsaved text.
- Disconnecting social accounts, cancelling paused posts, archiving clients, removing brand assets, and revoking invitations/sessions or account/client access require named confirmations. Cancelling makes no mutation.
- The client selector uses a searchable, bounded list with an empty state and outside-tap, Cancel and hardware-back dismissal.
- Calendar uses the selected client's zone for grouping, Today, query boundaries and time labels. The all-client view explicitly uses the device zone. Date arithmetic is independent of device DST; query boundaries handle 23/25-hour days and skipped midnight. Filters clear hidden selections, and bulk shift labels state elapsed hours.
- Post review now uses column flex sizing only on wide screens; on phones the content grows vertically so the AI editor cannot cover approval controls. The primary tab shell is the default authenticated destination.
- Publishing decisions, review recommendations and client workspace timestamps use their client zone; mixed-client Home timestamps name the device zone.
- Settings controls are read-only for unauthorized users, with retry messaging for load failures. Removing brand assets preserves other unsaved form edits.

## Remaining review items

State-specific publishing actions, additional list/search and content hierarchy refinements, and broader accessibility polish from the original review remain. Physical Android/iOS keyboard, font scaling and native modal acceptance are still necessary.

## Initial pass verification

Regression coverage includes secondary navigation, client links, return from rescheduling, Calendar refresh, and schedule presets across positive/negative offsets and daylight saving changes. Executed checks:

- `npm test`: 117 passed.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm run build:web`: passed.
- Android and iOS JavaScript exports: passed.
- The initial desktop/mobile Chromium suite exposed a narrow X filter target and web selection announcements; both were fixed. A test insertion error and a status expectation were also corrected. The affected scenarios were then rerun against the final web build: all 14 desktop/mobile Chromium checks passed.

Native exports do not establish physical-device acceptance. WebKit execution was unavailable because its required system libraries are absent.

## Follow-up verification

- `npm test`: 120 passed, zero failed. New Calendar cases cover UTC day edges, 23/25-hour days, skipped midnight and skipped civil dates.
- TypeScript, lint, formatting, web export and Android/iOS JavaScript exports passed.
- The broad desktop/mobile Chromium run passed 56 of 62 checks. It exposed a genuine mobile post-review overlap, overall layout-sweep timeout pressure, and several five-second sign-in assertion timeouts. The layout was fixed, the authenticated tab shell made the default destination, and the test budgets adjusted for the multi-page sweep and sign-in.
- The next affected-scenario run passed 24 of 28 checks, including login/session recovery, edit guards, client search and social cancellation. Its remaining failures were the old mobile layout bundle, a Calendar test observing an in-flight week request instead of the new day request, and awaiting a cancelled reload until the test deadline. These were corrected without weakening their assertions.
- Final rebuilt-app rerun: all eight desktop/mobile Chromium checks passed. This covers narrow layouts, client-zone day boundaries, post copy saved before approval with unobstructed controls, and cancelled browser reload retaining the draft.
- There was no single final full-suite run after those corrections; the broad run and focused reruns are reported separately above. Physical-device and WebKit acceptance remain outstanding.

No schema or dependency changes were made. Nothing was deployed.
