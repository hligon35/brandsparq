# Provider acceptance safeguards follow-up

## Changes

- Meta webhook POST returns 503 when its app secret is missing. Unsupported methods
  retain 405. This distinguishes configuration failure from an incorrect HTTP method.
- HMAC validation uses Web Crypto signature verification. Unsigned, malformed and
  tampered signatures fail with 401 before parsing or storing the delivery.
- Signed invalid JSON, null/array payloads and missing entry collections return 400.
- Exact payload replays share a SHA-256 delivery identity and are recorded once,
  including simultaneous deliveries. Distinct batches sharing the same first entry
  are retained instead of being silently discarded. This is delivery-record
  deduplication, not semantic deduplication of individual entries or outbound posting.
  Existing historical rows retain their previous identifiers; replay across the
  upgrade boundary can create an additional audit record.
- Production preflight blocks on provider_processing posts and
  PUBLISH_OUTCOME_UNKNOWN failures as well as claimed publishing jobs. A completed
  queue job does not imply the provider has confirmed the post.

## Verification

116 backend tests passed, including three new provider acceptance regressions.
Worker TypeScript, lint and formatting passed. No dependencies, native code or
schema changed; no new migration is required for this follow-up.

## Acceptance limits

These tests use isolated databases and mocked/signed test deliveries. They are
not a real Meta OAuth, webhook subscription, provider publication, physical-device
acceptance or actual restoration drill. The previous live acceptance blockers
remain open in RELEASE_ACCEPTANCE.md. No production configuration, deployment,
client invitations or real social posts were changed in this work.
