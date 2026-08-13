<p align="center">
  <h1 align="center">🚛 SafeHaul</h1>
  <p align="center">
    <strong>Multi-Tenant Trucking HR &amp; Recruitment Platform</strong>
  </p>
  <p align="center">
    Driver applications · Bulk SMS campaigns · E-signatures · Previous-employment verification
  </p>
  <p align="center">
    <a href="docs/APP_BRIEF.md">App Brief</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#deployment">Deployment</a> ·
    <a href="#testing">Testing</a> ·
    <a href="#documentation-map">Documentation</a>
  </p>
</p>

---

> ## Start here: [`docs/APP_BRIEF.md`](docs/APP_BRIEF.md)
>
> The App Brief is the **single maintained description of this application** —
> purpose, users, workflows, business rules, permissions, integrations,
> background jobs, preserved decisions and known limitations. Every contributor
> and AI coding agent reads the relevant parts before making changes and updates
> it in the same task when their work changes what it describes.
>
> This README is a **getting-started guide and a map**, not a second App Brief.
> Where the two disagree, the App Brief and the code win.

---

## What SafeHaul is

A multi-tenant SaaS platform for US trucking carriers that turns driver hiring
into **one structured, defensible record per driver** — the application, the
qualification documents, the signed paperwork and the verified previous
employment held against the same driver, in the same system, so the file still
holds together months later when someone asks to see it.

| Surface | Users |
|---|---|
| **Super Admin** | Platform operators — provisioning, credentials, releases, system health |
| **Company workspace** | Recruiters and company admins — pipeline, campaigns, e-docs, PEV |
| **Public driver application** | CDL drivers, usually unauthenticated, usually on a phone |
| **Verification portal** | Past employers, via a token link |

> SafeHaul deliberately makes **no claim to deliver DOT or FMCSA compliance.**
> It supports the carrier's own compliance process.

Full detail — the nine-step application, the ATS funnel, e-signing, campaigns,
Super Admin operations and the business rules behind them — is in the
[App Brief](docs/APP_BRIEF.md).

### What it does not do

Every product claim must trace to an `available` or `partial` entry in
[`functions/ai/knowledge/safehaulCapabilities.js`](functions/ai/knowledge/safehaulCapabilities.js),
which is the **source of truth for what SafeHaul can honestly say about
itself**. `npm run check:landing-claims` enforces it as part of `npm run lint`.

Notably absent, and never to be claimed as shipped: document-expiry monitoring
or renewal reminders · MVR, PSP or FMCSA Clearinghouse **checks** (the
applicant-facing disclosures exist; the queries do not) · a job board · drip
campaigns or two-way message threads · **opt-out capture** (the blacklist is
enforced on every send, but nothing feeds it from a recipient's reply — see App
Brief §12) · payment processing · any named carrier endorsement.

---

## Tech stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| Vite | 7 | Build tool & dev server |
| React Router | 7 | Client-side routing |
| TailwindCSS | 3.4 | Utility-first styling |
| Recharts | 3.6 | Data visualization |
| Lucide React | 0.552 | Icon library |
| jsPDF | 4.0 | Client-side PDF generation |
| pdfjs-dist / react-pdf | 5.4 / 10.2 | PDF rendering (E-Docs editor, signing room) |
| ExcelJS | 4.4 | Spreadsheet parsing for bulk imports |
| Papa Parse | 5.5 | CSV parsing for lead imports |
| React Signature Canvas | 1.1 | Signature capture |
| React Virtuoso | 4.18 | Virtualized lists |
| DOMPurify | 3.4 | HTML sanitization |
| Sentry | 10.32 | Error monitoring (browser) |

### Backend (Firebase)

Cloud Functions run on **Node 20**.

| Technology | Version | Purpose |
|---|---|---|
| Firebase Admin SDK | 13.6 | Server-side Firestore, Auth, Storage |
| Firebase Functions | 7.0 | Serverless Cloud Functions (v1 + v2) |
| Cloud Firestore | — | NoSQL database |
| Firebase Auth | — | Authentication with custom claims (RBAC) |
| Firebase Storage | — | File uploads (CDL, medical cards, etc.) |
| Firebase Hosting | — | Static site hosting |
| Nodemailer | 9.0 | Email delivery (per-company SMTP) |
| Joi | 18.1 | Request validation |
| pdf-lib | 1.17 | Server-side PDF manipulation |
| @ringcentral/sdk | 5.0 | RingCentral SMS adapter |
| @google-cloud/secret-manager | 6.1 | AI and integration credentials |
| @google-cloud/tasks | 6.2 | Bulk campaign worker queue |

> There is **no server-side Sentry**. Only the browser DSN (`VITE_SENTRY_DSN`)
> and the deploy-time sourcemap-upload secrets are consumed.

### Testing

Vitest (frontend) · Jest (Cloud Functions) · Playwright (E2E) ·
Testing Library · Storybook (design-system catalog).

---

## Project structure

```
SafeHaul/
├── src/                     # React SPA
│   ├── app/                 # Routing, guards, route manifests, roles
│   ├── config/              # Application definition and gates
│   ├── context/             # DataContext — auth, roles, selected company
│   ├── design-system/       # Business-neutral visual contract (see its README)
│   ├── features/            # Domain modules (driver-app, company-admin, signing, …)
│   ├── lib/                 # firebase.js, applicationId.js, submissionQueue.js
│   ├── shared/              # Cross-feature components, hooks, utils, workers
│   ├── firestore.rules      # Firestore security rules — deployed from here
│   ├── storage.rules        # Storage security rules — deployed from here
│   └── tests/               # Frontend tests
├── functions/               # Cloud Functions (Node 20, v1 + v2)
│   ├── index.js             # The authoritative function export registry
│   ├── ai/                  # Shared AI platform (router, providers, tasks)
│   ├── blog/                # News & Insights pipeline + public rendering
│   ├── bulkActions/         # Bulk messaging worker system
│   ├── employmentVerification/
│   ├── environmentVault/    # Super Admin credential inventory
│   ├── integrations/        # SMS adapters, Facebook Lead Ads
│   ├── releaseManagement/   # Production promotion / rollback
│   └── shared/              # Constants, snapshot + PDF preservation
├── landing/                 # Marketing site (no build step, no framework)
├── docs/                    # App Brief + specialized docs and runbooks
├── e2e/                     # Playwright specs
└── scripts/                 # CI validators and operational scripts
```

Routing is **manifest-driven**: add routes in
`src/app/routes/appRouteManifest.js` or `src/app/routes/companyRouteManifest.js`,
not in `App.jsx`. The company manifest drives both the routes and the sidebar.

---

## Getting started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20.x |
| npm | 10.x+ |
| Firebase CLI | 15.x+ |
| Git | 2.x+ |

### Installation

```bash
git clone https://github.com/Khomurod/SafeHaul.git
cd SafeHaul
npm install
cd functions && npm install && cd ..
```

### Running locally

```bash
npm run dev          # Vite dev server at http://localhost:5000
firebase emulators:start   # Firestore, Functions, Auth
```

> The dev server is pinned to port **5000** with `strictPort: true` — it fails
> rather than silently moving, because the Playwright config and its
> `reuseExistingServer` behaviour depend on that exact port.

### Environment variables

**Complete inventory:** the tables below are the getting-started subset. The
authoritative, machine-checked list of every variable, secret and stored
integration credential — with its source, whether it can be read back, and what
may be changed — is
[docs/environment-and-integrations-runbook.md](docs/environment-and-integrations-runbook.md),
surfaced in the app under Super Admin → **Environment & Integrations**. The
registry in `functions/environmentVault/registry.js` is verified against the
repository by `functions/test/unit/environmentRegistry.inventory.test.js`, so a
new configuration key cannot silently escape it.

#### Frontend

Production reads the six Firebase values from Firebase Hosting's reserved
`/__/firebase/init.json` endpoint; they are no longer stored in GitHub. A local
`.env` is optional, for local development only.

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Cloud Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_SENTRY_DSN` | Sentry error tracking DSN |
| `VITE_FACEBOOK_APP_ID` | Facebook Lead Ads integration |
| `VITE_SOCRATA_APP_TOKEN` | FMCSA carrier autocomplete |
| `VITE_SUPER_ADMIN_EMAIL` | Super admin fallback email |

The deploy workflow reads the Facebook, Sentry and Socrata browser settings from
Google Secret Manager; they are shared by the test and production builds.

#### Cloud Functions (Google Secret Manager)

| Variable | Description |
|---|---|
| `PROCESS_BULK_BATCH_URL` | Cloud Run URL for `processBulkBatch` (required for bulk campaigns) |
| `BULK_WORKER_SECRET` | Shared secret for bulk worker HTTP auth (same on `initBulkSession` and `processBulkBatch`) |
| `GROQ_API_KEY` | Groq vision API for CDL parsing (legacy binding, retained as an AI-platform rollback path) |
| `SMS_ENCRYPTION_KEY` | AES key for encrypting SMS provider credentials |

A local `functions/.env` is only for emulator development and must never be
committed.

> **Legacy `functions.config()` is disabled** for this project
> (`disallowLegacyRuntimeConfig: true` in `firebase.json`). Do not use
> `firebase functions:config:get` — secrets bind from Google Secret Manager, and
> the inventory is the Environment & Integrations vault.

> **Bulk campaigns** need a Cloud Tasks queue. Setup and verification:
> [docs/production-readiness-runbook.md](docs/production-readiness-runbook.md#bulk-sms--email-campaigns).

---

## Cloud Functions

[`functions/index.js`](functions/index.js) is the authoritative registry of
every exported function — callables, Firestore triggers and scheduled jobs.
`scripts/check-callable-contract.mjs` fails CI if the SPA calls a name it does
not export; the full mapping is in
[docs/callable-frontend-map.md](docs/callable-frontend-map.md).

```bash
npm run deploy:functions:plan          # Plan an incremental deploy
npm run deploy:functions:incremental   # Incremental deploy — the normal path
firebase deploy --only functions:functionName
firebase deploy --only hosting
```

> On a machine with limited CPU, prefer `deploy:functions:incremental` (or
> `deploy:functions:sequential`) over a full parallel deploy, to avoid OOM
> during the build.

---

## Security model

Authorization comes from **Firebase Auth custom claims**, used identically by
the UI, the routes, Firestore rules and Storage rules:

```jsonc
{
  "globalRole": "super_admin",        // platform-wide
  "roles": {
    "companyId_abc": "company_admin",
    "companyId_xyz": "recruiter"
  }
}
```

| Role | Scope | Access |
|---|---|---|
| `super_admin` | Global | Granted **per collection** — there is no global wildcard |
| `company_admin` | Company | Team, settings, integrations, templates, applications |
| `hr_user` / `recruiter` | Company | Leads, applications, campaigns |
| `driver` | Self | Own profile and applications (whitelisted fields only) |
| Guest | Limited | Submits through callables only |

Rules live in [`src/firestore.rules`](src/firestore.rules) and
[`src/storage.rules`](src/storage.rules) and are deployed from those paths. The
permission rules that are easiest to get wrong — the removed super-admin
wildcard, closed cross-tenant profile reads, and the server-only collections
that rely on default-deny — are in the
[App Brief §6](docs/APP_BRIEF.md#6-permissions-and-access-rules).

---

## Deployment

Pushes to `main` deploy the **Testing** channel automatically once CI passes.
**Production never deploys automatically** — it updates only by explicit
promotion of an already-tested Hosting version, through Super Admin → Releases.

| Channel | Application | Landing page | Updates |
|---|---|---|---|
| Testing | `truckerapp-system.web.app` | `safehaul-landing-testing.web.app` | automatically, on merge to `main` |
| Production | `app.safehaul.io` | `safehaul.io`, `www.safehaul.io` | only by explicit promotion |

The workflow uses keyless Google Workload Identity Federation; no Google JSON
key is stored in GitHub. `Khomurod/SafeHaul` is the only active repository;
`Khomurod/SafeHaul-for-Gemini-Antigravity` is archived and its deploy jobs are
guarded off by repository name.

> **Testing is not a sandbox.** It runs against the same real Firestore, Auth,
> Storage, Functions and integrations as Production — a driver who opens a
> Testing application link is filing a real application. The only difference
> between the channels is which frontend build is served.

Promotion, rollback, shared-backend compatibility rules, DNS and recovery:
[docs/FIREBASE_HOSTING_RUNBOOK.md](docs/FIREBASE_HOSTING_RUNBOOK.md).

---

## Testing

```bash
npm test                  # Frontend unit tests (Vitest)
npm run test:coverage     # Coverage ratchet gate — raise it, never lower it
cd functions && npm test  # Cloud Functions tests (Jest)
npm run test:rules        # Security-rules tests
npm run test:e2e          # End-to-end (Playwright)
npm run test:stories      # Design-system catalog: render every story + axe
npm run lint              # Frontend + backend + landing claims
npm run typecheck
```

CI additionally runs `check:callable-contract`, `check:ai-boundary`,
`check:ci-plan`, `check:release-scripts`, `check:deploy-script`,
`check:table-layout` and a Gitleaks secret scan.

> **Run only one Playwright suite at a time**, and **never use broad
> process-killing patterns** such as `pkill -f vite` — that matches the invoking
> shell's own command line and kills it. Both rules exist because the failure
> actually happened. The full rules, and why each exists, are in
> [AGENTS.md](AGENTS.md#local-test-runner-process-safety).

> A green CI run is **not** evidence that anything shipped. `verify-shipped`
> reads the deployed SHA back off the live site, and the live commit is readable
> without credentials at `https://truckerapp-system.web.app/release.json`.

---

## Documentation map

| Topic | Document |
|---|---|
| **What the app is — start here** | [docs/APP_BRIEF.md](docs/APP_BRIEF.md) |
| Working process, MCP tool policy, test-runner and pipeline rules | [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) |
| Communication patterns, SMS routing, bulk worker | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Product positioning and capability claims | [PRODUCT.md](PRODUCT.md) |
| Marketing-site visual specification | [DESIGN.md](DESIGN.md) · [landing/README.md](landing/README.md) |
| Collections, fields, access summary | [docs/firestore-data-model.md](docs/firestore-data-model.md) |
| Callable ↔ frontend map | [docs/callable-frontend-map.md](docs/callable-frontend-map.md) |
| Feature flags | [docs/feature-flags.md](docs/feature-flags.md) |
| Guest and public security posture | [docs/security-posture.md](docs/security-posture.md) |
| Shared AI platform | [docs/ai-platform.md](docs/ai-platform.md) |
| Automated blog | [docs/news-and-insights.md](docs/news-and-insights.md) |
| Hosting, releases, promotion | [docs/FIREBASE_HOSTING_RUNBOOK.md](docs/FIREBASE_HOSTING_RUNBOOK.md) |
| Credentials and integrations inventory | [docs/environment-and-integrations-runbook.md](docs/environment-and-integrations-runbook.md) |
| Operations, alerting, retention | [docs/production-readiness-runbook.md](docs/production-readiness-runbook.md) |
| Historical record reconstruction | [docs/application-record-reconstruction-runbook.md](docs/application-record-reconstruction-runbook.md) |
| Design-system standard and open decisions | [docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md](docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md) · [src/design-system/README.md](src/design-system/README.md) |
| Manual signing-room device QA | [docs/qa/edoc-mobile-document-first-qa.md](docs/qa/edoc-mobile-document-first-qa.md) |

---

## Contributing

1. Create a feature branch from `main`.
2. Make your changes.
3. Run `npm run lint` and `npm test`.
4. Update the [App Brief](docs/APP_BRIEF.md) if your change made any part of it
   untrue — that is part of the definition of done, in the same commit.
5. Open a pull request.

---

## License

Proprietary software. All rights reserved.

---

<p align="center">
  Built with ❤️ for the trucking industry
</p>
