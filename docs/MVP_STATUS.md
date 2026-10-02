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
- OpenAI Responses API integration with versioned prompts and structured campaign output.
- GPT-6.1 Sol campaign planning, GPT-6 Luna caption rewrites, GPT Image 2.5 Flare generation, and Sunburst image editing.
- R2-backed generated graphics, AI usage/provenance logging, and graceful image-failure handling.
- Review-screen AI actions for caption rewrite, precise graphic edits, and full post regeneration.

## Intentionally not locked yet

- Authentication provider and account model enforcement.
- Email/push notification providers.
- Social OAuth token storage and platform adapters.
- Desktop drag/drop week calendar.
- Analytics ingestion.

Those integrations stay behind the current API/domain boundaries so they can be added without redesigning the application.
