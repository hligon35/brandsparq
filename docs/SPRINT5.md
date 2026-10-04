# Sprint 5 — Review and Calendar UX

Status: implemented on `main`.

## Implemented

- Secure public review now supports:
  - direct headline/caption edits
  - reviewer comments
  - request changes / reject
  - AI regenerate
  - approve to calendar
- Authenticated review supports direct copy editing and request-changes actions.
- Review inbox now includes:
  - search
  - multi-select
  - bulk approve
  - bulk request changes
- Rescheduling now supports:
  - quick options
  - exact date
  - exact time
  - client timezone display
  - BrandSparQ next-available recommendation
  - scheduler validation before saving
- Calendar now includes real navigable:
  - day view
  - week view
  - month grid
- Calendar includes:
  - previous / today / next navigation
  - client filters
  - platform filters
  - search
  - multi-select
  - bulk shift ±1 day
  - bulk pause
- Bulk calendar shifts always pass through the scheduling engine.
- Review comments and rejection metadata are retained in D1.

## Migration

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Sprint 5 adds:

- `0013_sprint5_review_calendar.sql`
