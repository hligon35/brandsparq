# Profile and brand editors

## Changes

- Home removes the next-move hero and centers the existing stat values.
- Campaign objectives use one row; More tiles use equal heights.
- Brand assets use a two-column grid with primary/alternate choices stacked in the fourth slot. Color fields use color pickers on one row. Logo uploads select two prominent pixel colors, ignoring transparent pixels; Save Brand Brain persists them. Uploading an asset preserves unsaved brand text.
- Social icon glows follow the artwork without an icon container. Account controls and the surrounding connection cards remain available.
- Access controls show role/status badges and compact role/action rows. System statistics show their reporting period separately.
- Profile saves the avatar and name, verifies a new email using a one-time code, and supports sign-out/account deletion. Google sign-in stays linked by provider identity, so changing the verified email does not create a different account.
- Account deletion removes profile details, revokes access and devices, and disables review links. Shared client records and operational history remain. A pseudonymous identity tombstone prevents a deleted Google identity from recreating access. The last active owner must add another owner first.
- Timezone fields use a searchable IANA timezone list. Time-of-day fields use hour/minute pickers, including preferred/blackout windows. Scheduling interprets custom values in the selected client timezone and rejects nonexistent daylight-saving times. Numeric durations remain numeric.

## Image handling

Local image blobs sometimes report `application/octet-stream`. Uploads now prefer a valid image hint over a generic blob MIME type; the Worker determines the accepted image type from its bytes. HEIC/HEIF conversion uses the existing Expo image manipulator. PNG transparency is preserved. `fast-png` is a JavaScript-only dependency used to read a small logo preview for color extraction.

## Rollout

Install the updated lockfile with `npm ci`. Apply `0022_profile_email.sql` before deploying the updated Worker. From the repository root:

```powershell
npx wrangler d1 migrations apply brandsparq --remote --config .\cloudflare\wrangler.toml
```

Use the appropriate staging database and config when testing staging. Email verification uses the Worker's existing transactional-email configuration; no email secret belongs in the Expo client. No remote migration or deployment is performed by this implementation task.
