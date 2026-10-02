# BrandSparQ MVP scaffold status

## Implemented foundation

- Expo SDK 57 universal app: iOS, Android and web.
- Mobile-first tab shell for Home, Review, Create, Calendar and More.
- Multi-image selection with Expo Image Picker.
- R2-backed original image upload endpoint.
- D1 clients, brand profiles, assets, campaigns, approvals, social accounts and notifications.
- Review queue API and mobile review screen.
- Approval promotes a post from review into the official calendar.
- Two-week mobile agenda calendar backed by the API.
- Pre-publish decision screen with Keep Schedule, Reschedule and Publish Now.
- Queue-backed publishing jobs with idempotency protection.
- Cron-generated pre-publish notification records.
- Audit events for approval and publish decisions.

## Intentionally not locked yet

- Authentication provider and account model enforcement.
- AI provider/model router.
- Graphic rendering engine.
- Email/push notification providers.
- Social OAuth token storage and platform adapters.
- Desktop drag/drop week calendar.
- Analytics ingestion.

Those integrations stay behind the current API/domain boundaries so they can be added without redesigning the application.
