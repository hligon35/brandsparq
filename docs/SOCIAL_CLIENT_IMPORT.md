# Connect Meta accounts and create clients

Apply migration `0029_social_client_import.sql` before deploying this change.
For isolated staging, run `npm run migrate:staging`, then `npm run deploy:staging`
from the accepted clean checkout. Production retains its normal backup,
migration, acceptance and deployment requirements.

Workspace owners see **Create clients from detected Pages**, enabled by default,
on Social Connections. It works without first creating a client. Each new
Facebook Page creates a named client and an empty Brand Brain profile. Its
linked professional Instagram account uses the same client. The workspace time
zone is copied to new clients; brand voice, assets and other brand details still
need to be completed by the operator.

Existing account IDs reuse their assigned client. Reconnecting updates credentials
without creating duplicate clients or social accounts. Existing client names and
brand data are retained. Conflicting assignments across multiple clients require
the operator to reconnect from the intended client; import does not merge clients
or move accounts and their publishing history. Archived clients are not restored
by import. Disable the option to attach selected destinations to one existing
client. Other providers retain their existing-client connection workflow.

Discovery follows Meta's account pagination. An empty result produces an
actionable error rather than reporting a successful connection. Only assets
actually returned by Meta can be imported; a Facebook login alone does not grant
Page access. A Page without a returned linked Instagram account connects only
Facebook. Instagram-only login without Facebook Page discovery is not supported
by this flow.

After success, the callback selects the first connected client and reports the
saved account/client counts. The screen reloads clients and accounts on focus and
after native browser return, with stale responses fenced off. Each platform shows
**Connected** and a green glow only when the selected client has a connected,
unexpired account without a known degraded/disconnected/reauthentication health
state. Otherwise it shows Connect and a red glow. Refresh, client switching and
reload read the stored account state rather than trusting the callback banner.

Automated tests use fixture provider responses. Real Meta permission grants,
asset selection and physical-device browser return still need acceptance on the
deployed staging Worker. No native dependency or app runtime change is introduced.
