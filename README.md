# SwiftQuote — Production Starter

## v1.17.0 runtime and packaging update (2026-10-08)
- Added a Docker Compose local-run profile with a persistent SQLite volume and a health check that follows the configured port.
- Hardened the Docker build path for `better-sqlite3` by installing temporary native build tools, then removing them from the final image.
- Fixed the container health check to follow the runtime `PORT` instead of assuming port 3000.
- Normalized Docker/npm ignore files to keep Python cache artifacts and local secrets/databases out of builds and packages.
- The full app still needs an actual dependency install and live runtime test; registry DNS was unavailable in the build environment.

## v1.15.0 maintenance update (2026-10-08)
- Corrected the default OpenAI model to `gpt-4.1-mini`, a documented API model; removed a non-existent default model ID.
- Added optional Gemini support through the documented Gemini API, using a server-side `GEMINI_API_KEY`, configurable `GEMINI_MODEL` (default `gemini-3.8-flash`), bounded output and request timeout. OpenAI is preferred when configured; Gemini is used if OpenAI is unavailable or if only Gemini is configured.
- Added focused automated tests for provider selection, fallback, JSON mode, sanitized errors, and a timeout that remains active through response-body parsing.
- Removed a duplicate nested copy of the application from the release package. Focused AI-provider tests, JavaScript syntax checks, static security audits, schema simulations, and adversarial checks were run. Full Express runtime, live API calls, Stripe tests, and deployment remain unverified because npm registry DNS is unavailable in this environment.

SwiftQuote is a real Node/Express application for selling or operating a local-service quote funnel. It includes:

- Public mobile-first quote site
- Server-side quote calculation
- Persistent SQLite lead database
- Owner/admin login with random server-side HttpOnly sessions and CSRF protection
- Lead pipeline/statuses
- AI lead qualification through OpenAI Responses API or Gemini API (optional; server-side keys only)
- Optional webhook notification
- Optional Stripe Payment Link handoff
- Rate limiting on public quote and login endpoints
- Paginated admin leads and aggregate dashboard statistics
- Automatic session cleanup and configurable lead retention
- Graceful shutdown and container health checks
- Security headers via Helmet
- Environment-based secrets
- Health endpoint

## Run locally

### Easiest container route

With Docker Engine and the Compose plugin installed, run `docker compose up --build`. Then open `http://localhost:3000`. The SQLite database is stored in the named `swiftquote-data` volume. For a non-default port, set `PORT` and also set `APP_ORIGIN` to the matching local origin. This profile is for local development, not public production use.

### Run with Node.js

1. Install Node 22 or newer (Node 20 reached end of life).
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_PASSWORD` (12+ characters), a long random `SESSION_SECRET` (32+ characters), and a long random `LEAD_WEBHOOK_SECRET` (32+ characters) if webhooks are enabled. In production, `APP_ORIGIN` is required and must be the exact HTTPS origin used by the site. If the app is behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops (usually 1), not an unrestricted proxy trust.
4. Optionally set `OPENAI_API_KEY` to enable OpenAI. Alternatively set `GEMINI_API_KEY` to enable Gemini. If both keys are present, SwiftQuote tries OpenAI first and falls back to Gemini when that request fails. Never put either key in browser code. Set `OPENAI_MODEL` and/or `GEMINI_MODEL` when you need to override the defaults.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:3000` for the customer site and `/admin` for the owner dashboard.

## Production requirements

- Use HTTPS.
- Set strong unique `ADMIN_PASSWORD` and `SESSION_SECRET`.
- Keep `OPENAI_API_KEY` and `GEMINI_API_KEY` server-side; never put them in browser JavaScript.
- AI qualification is configured with an 8-second request timeout, limited output, and `store:false`; the quote flow still works without AI if the API is unavailable.
- Payment and webhook URLs are accepted only when they use HTTPS.
- Use a persistent disk/volume for SQLite if deploying on a host where the filesystem is ephemeral. Alternatively migrate the DB layer to Postgres.
- Configure `STRIPE_PAYMENT_LINK` only with a payment link owned by the business.
- Configure `LEAD_WEBHOOK_URL` only to a trusted HTTPS endpoint.
- Add transactional email/SMS through a provider when ready.

## Important business limitation

The quote numbers are configurable starter ranges, not a promise of final pricing. Before selling this to another business, replace the rates in `server.js` with that business's actual pricing model and service area.

## Recommended commercial offer

Sell the system as a setup service rather than promising customers guaranteed revenue. Example: $199 setup + $49/month support, with higher tiers for custom branding, notifications, analytics, and payment automation.

### Webhook security

If `LEAD_WEBHOOK_URL` is enabled, also set `LEAD_WEBHOOK_SECRET` to a long random secret (32+ characters). SwiftQuote sends `X-SwiftQuote-Timestamp` and `X-SwiftQuote-Signature` headers. The signature is `sha256=HMAC-SHA256(secret, timestamp + "." + raw_request_body)`. The receiving service should reject timestamps outside a short replay window (for example, 5 minutes) and compare signatures using a constant-time comparison.

### Production hardening

- Set `APP_ORIGIN` to the exact HTTPS origin serving SwiftQuote.
- Set `TRUST_PROXY_HOPS` only when a known reverse proxy is in front of the app, and set the exact hop count.
- Keep SQLite on persistent storage and back it up before retention cleanup.
- Run dependency vulnerability scanning on the deployment host as part of every update.
- Do not expose `/admin` publicly without HTTPS.
- Dashboard errors are surfaced separately from the login form so authenticated failures are visible.


## Lead-source and industry expansion
SwiftQuote now supports an authorized lead-source layer. Configure official platform/API connectors or signed intake webhooks from the admin dashboard. Supported source types include Meta/Facebook Lead Ads, Instagram Lead Ads, LinkedIn Lead Sync, TikTok Lead Gen webhooks, generic signed webhooks, CSV/manual imports, and the built-in website.

Credentials for configured sources are encrypted at rest with an AES-256-GCM key derived from SESSION_SECRET and are never returned by the admin API. Polling endpoints are restricted to approved HTTPS platform hosts, redirects are disabled, upstream responses are capped, syncs are rate-limited, and imported leads are deduplicated by source + source lead ID.

Industries can be tagged across home services, landscaping, cleaning, junk removal, moving, handyman, roofing, HVAC, plumbing, electrical, painting, automotive, legal, real estate, insurance, photography, events, fitness, beauty, professional services, and construction.

Platform access still requires the business owner to authorize the appropriate official API/product. SwiftQuote does not scrape private accounts, bypass platform controls, or harvest personal contact information from arbitrary social posts.


## v7 marketplace and subscription layer

SwiftQuote v1.3 adds a two-sided marketplace architecture:
- Public service directory and provider directory.
- Free customer accounts and provider accounts for individuals, independent contractors, and companies.
- Provider profiles with industries, services, ZIP/service areas, verification state, and job history.
- Server-side provider subscription gating. Providers cannot receive or claim leads unless their subscription is active.
- Provider lead matching by service/industry, ZIP, and verification signals.
- Per-provider lead isolation: provider APIs only return matches belonging to the authenticated provider account.
- Customer marketplace requests create auditable requests and corresponding leads.
- Subscription records, usage limits, and payment records are stored separately from lead data.
- Stripe Checkout scaffolding and signed webhook verification are included; live billing requires valid Stripe environment configuration.

### Billing environment
Set `STRIPE_SECRET_KEY`, `STRIPE_PROVIDER_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` to enable subscription checkout/webhooks. `APP_ORIGIN` must be an HTTPS origin in production. Do not paste secrets into chat or commit `.env`.

### Test boundary
This release was statically checked, syntax-checked, schema-tested with SQLite, and fuzz/security-pattern tested. The sandbox package-registry install timed out, so no claim is made that a live Express/Stripe runtime passed here. A deployed environment should receive an additional black-box penetration and payment-webhook test before production launch.


## v1.5 marketplace trust layer
- Transparent provider matching and trust scoring.
- Provider verification requests with admin review.
- Job dispute records for customers and providers.
- Customer service-passport endpoint for transaction history.
- Account audit trail for important account and transaction actions.
- Automatic cleanup of expired sessions, old notifications, audit records, and webhook idempotency records.


## v1.6 marketplace transaction layer
- Provider weekly availability and blackout scheduling.
- Idempotency protection for high-value account operations.
- Full-amount protected Stripe Checkout before booking when payment is configured.
- Payment hold ledger tied to quotes.
- Provider Stripe Connect account/onboarding data model ready for payout integration.
- AI request structuring with `store:false`, bounded output, and no invented facts.
- Customer/provider digital job agreement acceptance flow.
- Provider-submitted customer-approved change orders.
- Verified-provider public availability and verified-job review endpoints.
- Risk-event ledger for fraud/risk signals without storing raw IP addresses.


## v1.7 marketplace intelligence layer
- Customer reliability metrics and provider/customer trust graph.
- Workload-aware matching and emergency-service weighting.
- Provider service-area radius/emergency configuration.
- Automated appointment reminders and notification scheduling.
- Review-risk flagging for moderation.
- Service-level price benchmarks and quote reasonableness checks.
- Provider ROI analytics.


## v1.8 transaction safety and communication layer
- In-app job messaging with link/contact-data restrictions.
- Job timeline/status event history.
- Customer/provider cancellation request workflow.
- Customer completion confirmation before review/payout eligibility.
- Provider payout ledger foundation.
- Public provider profiles for account-free browsing.
- Emergency mode now requires configured service areas.
- Appointment reminders are scheduled for both customer and provider.
- Positive change orders explicitly require additional payment handling rather than silently changing the agreed amount.


## v1.9 transaction integrity
- Fixed marketplace request ZIP persistence.
- Stripe quote checkout now converts SwiftQuote whole-dollar amounts to Stripe cents.
- Stripe checkout webhooks verify paid status, exact amount, currency, and customer ownership before booking.
- Positive change orders use real Stripe Checkout payment and retry states.
- Approved negative change orders can use Stripe partial refunds; failed refunds remain explicitly marked as failed.
- Provider payout requests use Stripe Connect transfers, require completion confirmation, freeze on open disputes, and use idempotency.
- Public provider trust/review lookups require active provider subscriptions.
- Provider plans can map to distinct Stripe Price IDs.
- Payout onboarding uses company/individual provider type.

### Validation boundary
Static JavaScript syntax, SQLite schema/foreign-key checks, route/security assertions, AI provider unit tests, and release-archive integrity can be run in the development sandbox. Live Stripe transactions, Connect onboarding, real webhook delivery, and browser end-to-end behavior still require a deployed environment with real test credentials.


## v1.10 extreme transaction/security hardening
- Public GET endpoints no longer persist provider metrics or price benchmarks as a side effect.
- Public provider profiles expose configured service areas from the dedicated service-area table.
- Provider availability validates IANA timezones, rejects reversed/overlapping slots, rejects duplicate/invalid blackout dates, and validates service-area ZIP format.
- Login throttling now applies to both client IP and normalized email.
- Stripe Checkout operations use deterministic idempotency keys and crash-recovery states.
- Quote payment startup uses a recoverable `payment_starting` state and a starting payment hold so a completed Stripe webhook can recover from an interrupted local write.
- Change-order Checkout uses a recoverable `checkout_starting` state.
- Negative change-order refunds are cumulatively capped against the original captured payment to prevent over-refunding.
- Stripe Checkout webhooks require the expected Checkout Session ID when one is recorded.
- Connect account creation uses deterministic Stripe idempotency.
- Open duplicate disputes for the same participant/job are rejected.
- Stale payment-start and change-checkout states are automatically recovered by cleanup.
- Production startup requires distinct Stripe Price IDs for all published provider plans when Stripe billing is enabled.

### Release validation v1.18.0 (current candidate)
- AI-provider unit tests: **11/11 PASS**, including fallback behavior, timeout aborts, prompt/output bounds, malformed responses, and secret-safe errors.
- 254-point static/schema/security/business/deployment audit: **254/254 PASS** on this candidate.
- 100-point maintenance audit: **100/100 PASS** on this candidate.
- 22 adversarial SQLite/business-flow simulations: **22/22 PASS** on this candidate.
- JavaScript syntax checks: **PASS**.
- Full Express server startup and browser/API end-to-end checks remain unverified because dependencies are not installed in this sandbox; npm registry DNS failures previously prevented installation. Live AI calls, dependency vulnerability scanning, and real Stripe test-mode transactions also remain unverified.
- The included `extreme_audit.py`, `deep_audit.py`, and `adversarial_sim.py` scripts make major checks repeatable.

### Validation boundary
These are static, schema-level, package-level, and simulated adversarial checks. Live Stripe transactions, Connect onboarding/transfers/refunds, browser end-to-end behavior, concurrent production traffic, external lead APIs, OpenAI execution, and deployment-specific HTTPS/cookie behavior still require a real runtime environment with test credentials.


## Render staging deployment

The root `render.yaml` is a **free staging/smoke-test** Blueprint. It configures the Node service, `/api/health` health check, a generated session secret, and prompts for a non-default admin password. On Render, the app derives its origin from `RENDER_EXTERNAL_URL` when `APP_ORIGIN` is not explicitly set.

**Important:** Render free web services do not provide persistent disks. This staging configuration uses SQLite in the service filesystem, so stored records may be lost on redeploy or instance replacement. Do not use this free configuration for real customer data. Before production, select a paid service and attach persistent storage at the database directory (or migrate the database to a managed persistent database), then set and verify all billing/webhook secrets in the Render Dashboard. Never commit `.env` files or secret values.

To deploy the Blueprint, the source must first be in a Git repository connected to Render. Select the confirmed Render workspace and the repository containing this `render.yaml`, then create the Blueprint and supply the admin password when prompted.
