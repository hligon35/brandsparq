# Mobile controls and notification inbox

- Profile and notification icons appear in the app headers. The profile menu contains Profile, Settings, and Sign out and closes on outside touch, navigation, or device rotation.
- Home statistics and quick links use three columns. More, social channels, and analytics statistics use two columns.
- Calendar navigation puts previous / Today / current range / next above Day / Week / Month.
- Sync and refresh controls use accessible icons at the right of page headers.
- Social icon assets are unchanged. Red indicates disconnected or unhealthy; green indicates a connected account without a reported reauthorization, degradation, or expiry problem. Account management retains verification, reconnect, disconnect, and additional-account actions.
- Notification device registration and test actions live in Settings.
- Notification taps mark the current user's notice as read and navigate only to known internal app destinations. Inbox deletion is per user; shared notices and provider delivery history are preserved.

## Database rollout

Apply `0021_notification_inbox.sql` before deploying the Worker that uses it. From the repository root:

```powershell
npx wrangler d1 migrations apply brandsparq --remote --config .\cloudflare\wrangler.toml
```

Use the staging database/config for staging. This task does not deploy or migrate a remote database.

## Verification

Run root and Worker TypeScript checks, schema check, lint, formatting, unit/integration tests, web export, and the browser tests in `tests/e2e/workflow.spec.mjs`. Native JavaScript export checks bundling; device testing still verifies native appearance and system interactions.
