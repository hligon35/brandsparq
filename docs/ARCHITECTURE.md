# BrandSparQ architecture

## Lifecycle
Images → AI analysis → graphics/captions → strategic slot suggestion → review/edit/approve → approved calendar → pre-publish alert → keep schedule / reschedule / publish now → publish → analytics.

## Rules
- Expo is never the scheduler; Cloudflare is authoritative.
- Calendar contains approved content only.
- suggested_publish_at and scheduled_publish_at are distinct.
- Publishing jobs must be idempotent.
- Social credentials remain server-side.
- Platform integrations are adapters behind one publishing contract.
- Every consequential action is auditable.
- AI/provider integrations remain model-agnostic.
