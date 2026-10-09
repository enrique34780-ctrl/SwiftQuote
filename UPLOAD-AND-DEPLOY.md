# SwiftQuote — upload and free staging deployment

This package preserves the SwiftQuote v1.18.0 source. It is prepared for a **staging/test deployment**, not production use with real customer data.

## Before uploading

- Create a **private** GitHub repository named `SwiftQuote` at https://github.com/new.
- Do not initialize it with a README, `.gitignore`, or license; this package already contains project files.
- Upload the *contents* of this folder to the repository root (not the ZIP file itself). Include hidden files/folders such as `.gitignore`, `.npmignore`, `.dockerignore`, `.env.example`, and `.github/workflows/ci.yml`.
- Never upload `.env`, API keys, passwords, database files, or other secrets. This package's `.gitignore` excludes the usual local secrets and SQLite files.

## Connect Render

1. Open https://dashboard.render.com/ and make sure the selected workspace is **My Workspace**.
2. Choose **New + → Blueprint** (or the equivalent Blueprint creation option).
3. Connect the private `SwiftQuote` GitHub repository and select the branch containing these files.
4. Review `render.yaml` before creating the service. It creates a **free `swiftquote-staging` web service** in Ohio, runs `npm install --omit=dev --no-audit --no-fund`, starts with `npm start`, and checks `/api/health`.
5. When prompted for `ADMIN_PASSWORD`, set a unique password of at least 12 characters. Render generates `SESSION_SECRET`; do not share either secret in chat or commit them to the repository.
6. Wait for the build/deploy to finish. Open the service URL and test `/api/health`; it should return JSON with `"ok": true`.

## Important limitations

- This is a free staging service. The local SQLite database at `./data/swiftquote.db` is **not durable on a free Render web service**. Do not enter real customer data or take live payments until persistent storage or a hosted database is configured and verified.
- The application needs Node.js 22 or newer. The GitHub Actions workflow installs dependencies and runs automated tests on pushes and pull requests.
- The local automated tests do not prove that the full Express server, external AI providers, or Stripe payments work in the live environment. Run smoke tests after deployment and configure API/payment secrets only through the host's secret/environment settings.
- Do not delete previous SwiftQuote ZIP releases. This package is additive; keep older archives as rollback copies.
