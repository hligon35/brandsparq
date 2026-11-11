# Full Coding Agent Guidelines

Apply these standards to all current and future projects. For existing projects, adopt them progressively as related areas are touched. Do not restructure or rewrite an entire repository just to force immediate compliance. Preserve working behavior, improve the areas being touched, and avoid silently expanding the scope of a request.

## 1. Clean Organization

Keep every repository structured, predictable, and easy to navigate.

- Organize code and resources into clear, purposeful folders such as pages, components, assets, services, utilities, documents, tests, configuration, and related project areas.
- Keep the repository clean. Remove dead, obsolete, duplicate, legacy, or unnecessary files when it is safe and relevant to the work being performed.
- Avoid scattered logic, duplicate systems, parallel implementations, and unnecessary dependencies.
- Extend existing architecture before creating something new.
- Never reconstruct a working system when clean integration with the existing system will work.
- Use simple, descriptive, and consistent names for objects, elements, variables, files, routes, components, services, functions, and data structures.
- Keep related code together.
- Keep styles organized by element, component, page, or section so the relevant styling can be located quickly.
- Actively detect legacy code, obsolete systems, duplicate implementations, and technical debt while working.
- Do not remove legacy code or cleanup paths until the replacement has been proven to work.
- Leave the repository cleaner and easier to understand after meaningful work, but do not over-clean unrelated areas.
- Detect broadly, but change narrowly.

## 2. Understandable, Commented, Modular Code

Build code so its structure, responsibilities, and intent remain easy to understand later.

- Design every meaningful feature as a module with a clear responsibility and boundary.
- Break large implementations into focused components, services, utilities, adapters, and modules when doing so improves maintainability and production quality.
- Avoid unnecessary fragmentation. Modular code should still be easy to follow.
- Create reusable components for repeated UI and behaviors such as headers, navigation, drawers, footers, forms, overlays, layouts, controls, and other repeated project elements.
- Reuse existing shared components, layouts, adapters, utilities, and services before creating replacements.
- Prefer configuration over project-specific or client-specific hard-coded behavior.
- Maintain one source of truth for each domain.
- Avoid duplicated state, duplicated business rules, and competing implementations.
- Automate synchronization between systems instead of manually duplicating data.
- Keep responsibilities separated and dependencies clear.
- Optimize code so it can be reopened later and understood quickly.
- Use brief, direct, informative comments to explain purpose, workflow, non-obvious decisions, integrations, or complex logic.
- Do not over-comment code whose meaning is already obvious.
- Preserve workflow continuity when modifying a feature.
- Treat UI changes as system changes when they affect data, permissions, routing, validation, responsive behavior, integrations, accessibility, or other connected behavior.
- Think in capabilities and workflows rather than treating every page as an isolated feature.
- Preserve existing working behavior unless changing that behavior is explicitly part of the request.
- Never silently expand scope beyond what is required to complete the task correctly.

## 3. Standard Hybrid App/System Stack

Use the following stack as the default for applicable projects unless there is a clear project-specific reason to deviate.

### Expo

- Default to Expo for hybrid and mobile-capable application projects.
- Build applications mobile-first.
- Establish the mobile shell early.
- Do not overbuild or fully duplicate the native/mobile experience until mobile-specific work is actually required.

### Cloudflare

Use Cloudflare as the default hosting and infrastructure platform.

Use appropriate Cloudflare services where they fit, including:

- Workers
- Pages where appropriate
- D1
- R2
- Domains
- Environment bindings
- Caching
- Related Cloudflare infrastructure

Prefer Cloudflare capabilities already available in the project before introducing additional infrastructure.

### Resend

Use Resend as the default email platform where appropriate, including:

- Transactional email
- Website form delivery
- Submission notifications
- Mailbox-related workflows
- Application email infrastructure

Use Cloudflare and Resend together for website submission workflows where appropriate.

### Infrastructure

- Keep infrastructure boring, simple, understandable, and predictable.
- Avoid introducing additional providers, services, databases, frameworks, queues, or architectural layers when the standard stack already solves the problem adequately.
- Keep external integrations behind adapters or service layers.
- Provider-specific implementation details should not spread throughout the application.
- Integrations should be replaceable without requiring application-wide rewrites.
- Separate reusable platform capabilities from client-specific configuration such as branding, credentials, domains, content, permissions, and integrations.
- Design for clean project handoff from the beginning.

## 4. Environment Management

Use a predictable environment structure.

- Use `.env.sandbox` and `.env.production` as the standard environment files where applicable.
- Keep both environment definitions updated with the variables required by their environments.
- Keep production configuration explicit and unambiguous.
- Avoid hidden configuration fallbacks that make it unclear which database, bucket, worker, domain, API, or environment is being used.
- Never expose secrets in committed code or client-side configuration.
- Document required variables and bindings so another developer can reproduce the environment.

## 5. Authentication and Authorization

Treat authentication and authorization as separate systems.

- Authentication determines who the user is.
- Authorization determines what that authenticated user is allowed to do.
- A valid session must never automatically imply unrestricted access.
- Prefer secure, server-managed session cookies.
- Do not store authentication tokens, passwords, refresh tokens, or equivalent secrets in `localStorage`.
- Sensitive authentication state should not rely on script-readable browser storage.
- Prefer server-authoritative permission checks.
- Client-side authorization checks may improve UX but must not be the final authority.
- Fail closed. If identity, authorization, permissions, signatures, or security state cannot be verified, deny the protected action rather than allowing it by default.

## 6. Session Management

Standardize session behavior across projects.

- Use sensible idle session lifetimes.
- Use sensible absolute session lifetimes.
- Session cookies and server-side session state should expire consistently.
- Logout must properly invalidate or revoke the session rather than merely changing UI state.
- Session expiration should cleanly return users to an appropriate authentication flow.
- Avoid inconsistent session behavior across authenticated areas.

## 7. Caching

Caching must be intentional.

### Private and Authenticated Content

- Private pages must not be CDN cached.
- Authenticated API responses must not expose sensitive user data through caching.
- Use `no-store` or equivalent behavior where appropriate for authenticated and sensitive content.
- Private data should remain private at every layer, including:
  - Browser cache
  - CDN cache
  - Service workers
  - APIs
  - Logs
  - Client state
  - Storage
  - URLs
  - Third-party integrations

### Public Static Assets

- Cache public static assets aggressively.
- Use hashed, fingerprinted, or versioned filenames for immutable assets.
- Allow long-lived caching for assets whose URLs change when their content changes.

### Public HTML and Data

- Cache public HTML and data intentionally according to how frequently the content changes.
- Do not use one blanket cache duration for every public response.

### Cloudflare Caching

- Explicitly configure Cloudflare caching behavior.
- Do not rely only on Cloudflare defaults.
- Define browser caching, CDN caching, bypass behavior, and authenticated exclusions intentionally.

### Deployment Cache Behavior

- Deployments should prevent stale assets from becoming a normal user problem.
- Prefer versioned or hashed asset URLs so new deployments naturally reference new files.
- Purge or bypass caches when required.
- Users should not routinely need to manually clear their browser cache after deployments.

## 8. Private Files and R2

Private files must remain private.

- Do not expose private R2 buckets or sensitive stored files publicly simply for convenience.
- Require authenticated and authorized access.
- Use Workers, controlled endpoints, or short-lived signed URLs where appropriate.
- Apply authorization before file delivery.
- Avoid permanent public URLs for private documents.
- Do not allow CDN behavior to unintentionally expose sensitive files.

## 9. One Source of Truth

Maintain one authoritative system for each domain.

Examples may include:

- Users
- Profiles
- Inventory
- Orders
- Payments
- Content
- Submissions
- Permissions
- Financial data
- Application status
- Workflow state

Other interfaces and systems should reference or synchronize with that source rather than creating independent competing copies.

When the same information must appear in multiple systems:

- Synchronize it automatically where reasonable.
- Avoid manual duplicate entry.
- Avoid creating disconnected sources of truth.

## 10. Workflow Design

Optimize for complete, fluid workflows.

- Preserve workflow continuity when modifying existing systems.
- Avoid unnecessary page transitions, repeated information entry, context loss, or disconnected tools.
- Related actions should feel like parts of one system.
- Think about the user's full objective rather than only the page currently being modified.
- Every important workflow should have explicit states.
- Avoid inferring important workflow state from scattered conditions.

Typical states may include:

- Draft
- Pending
- Processing
- Approved
- Rejected
- Failed
- Completed
- Archived

Use the states appropriate to the domain rather than forcing unnecessary ones.

## 11. Automation

Automate reasonable follow-up work instead of relying on hidden manual steps.

If the system can safely perform actions such as:

- Synchronizing data
- Creating related records
- Updating workflow state
- Sending notifications
- Calculating derived information
- Reconciling integrations
- Performing routine follow-up actions

then users should not have to remember undocumented manual steps.

However:

- Automation should be reversible whenever practical.
- Prefer idempotent operations.
- Provide retry and reconciliation paths for important operations.
- Preserve enough observability to understand what automation did.
- Use human review when automation could have consequential effects.

## 12. External Integrations

Build external services behind clean internal boundaries.

- Use adapters or service layers for external providers.
- Avoid spreading provider-specific APIs throughout pages and components.
- Keep external integrations replaceable.
- Isolate credentials and environment-specific behavior.
- Maintain useful error handling.
- Preserve workflow continuity when integrations fail.
- Avoid creating tight vendor lock-in unnecessarily.

## 13. Webhooks

Treat webhooks as first-class integration infrastructure.

Webhook implementations should account for:

- Signature verification
- Authentication where applicable
- Duplicate delivery
- Idempotency
- Retries
- Processing failures
- Logging
- Event identifiers
- Reconciliation
- State transitions

Do not treat important webhooks as disposable one-off endpoints.

## 14. Server-Authoritative Business Rules

Important rules should ultimately be enforced by trusted server-side logic.

Examples include:

- Authorization
- Ownership
- Pricing
- Totals
- Inventory changes
- Payment state
- Workflow state
- Validation
- Business constraints
- Access to private resources

The client may mirror these rules to improve responsiveness and UX, but it should not be the sole authority.

## 15. Responsive and Hybrid UX

Responsive behavior is part of implementation.

- Build mobile-first.
- Ensure features work appropriately across relevant screen sizes.
- Do not treat mobile responsiveness as optional polish.
- Maintain a consistent interaction system across the application.
- Use a canonical UX system for shared controls, spacing, layouts, navigation, overlays, forms, states, and feedback.
- Prefer progressive disclosure.
- Show users the information and controls they need without overwhelming primary workflows.
- Advanced or less common controls should remain accessible when needed.

## 16. User Feedback

Keep user feedback clear, contextual, and appropriately transient.

Use relevant states such as:

- Loading
- Success
- Error
- Validation
- Empty states
- Disabled states
- Processing states

Feedback should generally appear near the action or workflow it relates to.

Avoid persistent interface clutter for messages that only need temporary visibility.

## 17. SEO

Keep SEO current as an ongoing requirement rather than a final launch task.

Maintain applicable areas such as:

- Page metadata
- Titles
- Descriptions
- Canonical URLs
- Structured data
- Open Graph metadata
- Social sharing metadata
- Sitemap behavior
- Robots behavior
- Semantic markup
- Performance-related SEO
- Accessibility-related discoverability

When meaningful page content, routing, or site structure changes, review the SEO implications.

## 18. Production Readiness

Production readiness is an ongoing development constraint.

Do not wait until launch to consider:

- Security
- Performance
- Responsiveness
- Accessibility
- SEO
- Error handling
- Data integrity
- Environment configuration
- Deployment behavior
- Observability
- Session handling
- Cache behavior
- Integration reliability
- Handoff readiness

Important work should move the relevant portion of the application closer to production-ready quality.

## 19. Observability

Important integrations and workflows should be diagnosable.

Where appropriate, include:

- Structured logging
- Clear error information
- Request or event identifiers
- Integration status
- Delivery status
- Retry visibility
- Failure tracking
- Reconciliation information

The system should make it possible to understand what happened without relying solely on guesswork or reproducing the issue manually.

## 20. Routing and Deployment Diagnosis

Verify routing and deployment behavior before unnecessarily rewriting application code.

When diagnosing unexpected behavior, inspect relevant areas such as:

- Routes
- Redirects
- Middleware
- Worker routing
- Domains
- Environment bindings
- Deployment targets
- Cached versions
- Authentication gates

Do not assume every visible problem is caused by the component where it appears.

## 21. Migrations and Replacement

Prefer additive and reversible migrations whenever practical.

- Introduce replacements safely.
- Preserve compatibility while transitioning where reasonable.
- Avoid destructive changes before the new path is validated.
- Do not delete the old implementation until the replacement has been proven.
- Maintain a rollback or recovery path for consequential changes where practical.

Prefer evolution over replacement.

## 22. Branch Discipline

Branches should represent intent.

- Use branch names that clearly communicate the purpose of the work.
- Keep unrelated changes out of focused branches where practical.
- Avoid turning branches into permanent miscellaneous workspaces.
- Preserve a clean path toward review, merge, deployment, and rollback.

## 23. Documentation and Handoff

Design for handoff from day one.

- Avoid undocumented dependencies.
- Avoid unnecessary coupling to a developer's personal accounts or environment.
- Keep infrastructure ownership and client configuration clearly separated.
- Keep setup information aligned with the real implementation.
- Update relevant documentation when architecture, configuration, integrations, or deployment requirements materially change.
- Generate documentation from reality rather than allowing documentation and implementation to drift apart.

## 24. Final Validation

Validate substantial work systematically before considering it complete.

Review relevant areas such as:

- Primary workflows
- Routing
- Navigation
- Permissions
- Authentication
- Authorization
- Forms
- Validation
- Responsive behavior
- Error states
- Empty states
- Integrations
- Webhooks
- Environment requirements
- Build behavior
- Deployment behavior
- Caching
- Session handling
- Data flow
- Regressions affecting nearby functionality

Use judgment about which areas apply to the task rather than mechanically testing unrelated systems.

## 25. Scope and Change Discipline

Be thorough without turning every request into a repository-wide project.

- Never silently expand scope.
- Make related changes required to complete the request correctly.
- Identify broader issues when discovered.
- Do not automatically fix unrelated issues without justification.
- Preserve established behavior.
- Favor small, complete, compatible improvements over unnecessary rewrites.
- Extend working systems rather than rebuilding them without a clear reason.
- Improve nearby code when useful and safe.
- Do not use cleanup as an excuse to reconstruct unrelated architecture.

## 26. General Engineering Standard

Always use strong production-oriented coding practices.

Prioritize:

- Maintainability
- Security
- Accessibility
- Performance
- Responsiveness
- Error handling
- Data integrity
- Clear architecture
- Testability
- Predictable behavior
- Clean deployment
- Understandable code

Be thorough. Complete requested work end-to-end rather than only implementing the visible happy path.

# Core Operating Principle

**Understand broadly, change deliberately.**

Before implementing a request, understand the existing architecture, workflow, dependencies, routing, integrations, data sources, and reusable capabilities.

Then make the smallest complete change that:

- solves the request,
- integrates cleanly with the existing system,
- preserves working behavior,
- improves the touched area,
- follows these standards,
- and avoids unnecessary reconstruction or scope expansion.

Existing projects should move toward these standards progressively with each request rather than through forced repo-wide rewrites.