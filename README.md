<p align="center">
  <h1 align="center">🚛 SafeHaul</h1>
  <p align="center">
    <strong>Multi-Tenant Trucking HR & Recruitment Platform</strong>
  </p>
  <p align="center">
    DOT-Compliant Driver Applications · Bulk SMS Campaigns · E-Signatures · Real-Time Analytics
  </p>
  <p align="center">
    <a href="docs/APP_BRIEF.md">App Brief</a> ·
    <a href="https://app.safehaul.io/">Live App</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#deployment">Deployment</a>
  </p>
</p>

---

> **Start here: [`docs/APP_BRIEF.md`](docs/APP_BRIEF.md)** — the central,
> maintained orientation document for this application (purpose, users,
> workflows, business rules, permissions, background jobs, preserved decisions
> and known limitations). Every contributor and AI coding agent should read the
> relevant parts before making changes and update it in the same task when their
> work changes what it describes.
>
> Production is `app.safehaul.io`; `truckerapp-system.web.app` is the **Testing**
> channel, which runs against the same real backend. Details of this README may
> lag the code — where they disagree, the App Brief and the code win.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Cloud Functions](#cloud-functions)
- [Firestore Security](#firestore-security)
- [Deployment](#deployment)
- [Testing](#testing)
- [Key Integrations](#key-integrations)
- [Scaling Roadmap](#scaling-roadmap)
- [License](#license)

---

## Overview

SafeHaul is a **multi-tenant SaaS platform** built for trucking companies to manage the entire driver hiring lifecycle — from lead acquisition, through DOT-compliant applications, to e-signatures and onboarding. The goal is **one structured, defensible record per driver**, so the file still holds together months later when someone asks to see it.

| Portal | Users | Purpose |
|--------|-------|---------|
| **Super Admin** (Mission Control) | Platform operators | Company provisioning, analytics, credentials, releases, system health |
| **Company Admin / HR** | Recruiters, HR managers | Application review, pipeline tracking, campaigns, e-docs, team management |
| **Driver App** | CDL drivers | Public application submission, document uploads, e-signing (usually unauthenticated) |
| **Verification Portal** | Past employers | Answer a previous-employment verification via a token link (unauthenticated) |

> SafeHaul deliberately makes **no claim to deliver DOT or FMCSA compliance**. It
> supports the carrier's own compliance process.

---

## Features

### 📋 DOT-Compliant Driver Applications
- **9-step wizard** (Contact → Qualifications → License → Violations → Accidents → Employment → General → Review → Consent)
- **Deterministic application IDs** — `SHA-256(companyId + email + phone)` prevents duplicates
- **Offline-resilient submission** via IndexedDB queue with exponential backoff
- **Guest submissions** through public company links (no auth required)
- **49 CFR 391.21 compliant** PDF generation with full legal agreements

### 📨 Bulk SMS/Email Campaigns
- **Recursive worker pattern** — processes in small batches (50 at a time) to avoid timeouts
- **Zombie worker prevention** — double-check strategy ensures cancelled campaigns stop immediately
- **Multi-provider SMS** — RingCentral + 8x8 integration with per-recruiter number routing
- **Automatic fallback** — if a recruiter's direct line fails, retries with the company main number
- **Recent-contact deduplication** — excludes recently messaged leads using a configurable window (`excludeRecentDays`, default 7 days)

> One-way only: no inbound message threads and no automated multi-step drip sequences.

### ✍️ E-Signatures & Document Management
- **Draw or type** signatures via canvas or text input
- **Document fan-out** — uploaded files are stored in structured subcollections (`dq_files`)
- **Digital sealing** with tamper-evident envelope system
- **Public signing links** — recipients can sign without creating an account

### 📊 Analytics & Pipeline
- **Real-time dashboard** with daily stats aggregation
- **Hiring pipeline** — canonical ATS funnel of New → Contact Attempt 1/2/3 → In Process → Hired / Terminated / Declined, plus an `Interested` bucket and legacy status aliases kept selectable so older records stay editable (`src/shared/constants/atsStatus.js`)
- **Activity logging** on all driver and lead interactions
- **Performance charting** via Recharts

### 🏢 Multi-Tenant Company Management
- **Company provisioning** with slug-based public profiles
- **Team management** — invite recruiters, assign roles, manage permissions
- **Custom application schemas** — companies can add custom questions to the driver wizard
- **Segment-based audience targeting** for campaigns

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
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
| Technology | Version | Purpose |
|-----------|---------|---------|
Cloud Functions run on **Node 20**.

| Technology | Version | Purpose |
|-----------|---------|---------|
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
> and the deploy-time sourcemap-upload secrets are consumed — see the
> Environment Variables note below.

### Testing
| Technology | Purpose |
|-----------|---------|
| Vitest | Unit testing (frontend) |
| Jest | Unit testing (Cloud Functions) |
| Playwright | End-to-end browser testing |
| Testing Library | React component testing |

---

## Architecture

SafeHaul uses three distinct communication patterns:

```
┌──────────────────┐     ┌────────────────────┐     ┌──────────────────┐
│   React Frontend │────▶│  Firestore (SDK)    │     │  Cloud Functions  │
│   (Vite + SPA)   │     │  Real-time Listeners│     │  (v1 + v2)       │
│                  │────▶│  Direct Reads/Writes│     │                  │
│                  │────▶│                     │     │  - Triggers      │
│                  │     └────────────────────┘     │  - Callables     │
│                  │──────────────────────────────▶│  - Scheduled     │
└──────────────────┘                                └──────────────────┘
        │                                                    │
        │              ┌────────────────────┐                │
        └──────────────│  Firebase Storage   │◀──────────────┘
                       │  (Document Uploads) │
                       └────────────────────┘
```

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Real-time Listeners** (`onSnapshot`) | Dashboards, feeds | Lead lists, application status |
| **Direct SDK** (`getDocs`, `setDoc`) | Low-latency CRUD | Templates, search, stats |
| **Cloud Functions** (`httpsCallable`) | Complex logic, 3rd-party APIs | Bulk SMS, automations, auth |
| **Background Triggers** (`onDocumentCreated`) | Automated pipelines | Driver profile sync, stats aggregation |

> For detailed architecture documentation, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Project Structure

```
SafeHaul/
├── src/                          # Frontend source
│   ├── App.jsx                   # Root component & routing
│   ├── main.jsx                  # Entry point
│   ├── index.css                 # Global styles
│   ├── config/                   # App configuration
│   ├── context/                  # React Context (DataContext — auth, roles, company)
│   ├── hooks/                    # Global custom hooks
│   ├── lib/                      # Core libraries
│   │   ├── firebase.js           # Firebase SDK initialization
│   │   ├── applicationId.js      # Deterministic ID generator (SHA-256)
│   │   ├── submissionQueue.js    # IndexedDB offline queue
│   │   └── signature.js          # Signature canvas utilities
│   ├── shared/                   # Shared components & utilities
│   │   ├── components/           # Reusable UI (Stepper, Modals, Layout)
│   │   ├── hooks/                # Shared hooks (useBulkImport, etc.)
│   │   ├── utils/                # Helpers, validation, PDF generation
│   │   └── workers/              # Web Workers (import.worker.js)
│   ├── app/                      # Routing, guards, route manifests, roles
│   ├── design-system/            # Business-neutral visual contract (see its README)
│   ├── features/                 # Feature modules (domain-driven)
│   │   ├── analytics/            # Charts & performance dashboards
│   │   ├── applications/         # Application list & management
│   │   ├── auth/                 # Login
│   │   ├── campaigns/            # Bulk SMS/Email campaign builder
│   │   ├── companies/            # Company profiles
│   │   ├── company-admin/        # HR portal (leads, uploads, e-docs, imports)
│   │   ├── driver-app/           # Public driver application wizard
│   │   ├── driver-changes/       # Driver review portal for company-proposed edits
│   │   ├── onboarding/           # New user onboarding tour
│   │   ├── sandbox/              # Sandbox tenant application + transfer
│   │   ├── settings/             # User & company settings
│   │   ├── signing/              # E-signature system
│   │   ├── super-admin/          # Platform-wide admin tools
│   │   └── verification/         # Previous-employment verification portal
│   ├── firestore.rules           # Firestore security rules (deployed from here)
│   ├── storage.rules             # Storage security rules (deployed from here)
│   └── tests/                    # Frontend tests
├── functions/                    # Firebase Cloud Functions (Node 20)
│   ├── index.js                  # Function exports registry
│   ├── firebaseAdmin.js          # Admin SDK singleton
│   ├── driverSync.js             # Application/lead → master driver profile
│   ├── guestApplication.js       # Guest submission handler
│   ├── applicationChanges.js     # Company edits → driver-approved changes
│   ├── bulkActions/              # Bulk messaging worker system
│   ├── employmentVerification/   # PEV requests, portal, reminders
│   ├── integrations/             # SMS adapters (RingCentral, 8x8), Facebook
│   ├── ai/                       # Shared AI platform (router, providers, tasks)
│   ├── blog/                     # News & Insights pipeline + public rendering
│   ├── environmentVault/         # Super Admin credential inventory
│   ├── releaseManagement/        # Production promotion / rollback callables
│   ├── emailService.js           # Email delivery (per-company SMTP)
│   ├── statsAggregator.js        # Stats computation
│   ├── companyAdmin.js           # Company management functions
│   ├── hrAdmin.js                # Portal user + membership operations
│   ├── digitalSealing.js         # Document sealing
│   ├── publicSigning.js          # Public e-signature handler
│   └── shared/                   # Shared constants, snapshot + PDF preservation
├── landing/                      # Marketing site (no build step, no framework)
├── docs/                         # App Brief + runbooks
├── e2e/                          # Playwright specs
├── firebase.json                 # Firebase project config
├── firestore.indexes.json        # Composite index definitions
├── .env                          # Environment variables (frontend, local only)
├── functions/.env                # Environment variables (backend, emulator only)
├── ARCHITECTURE.md               # Detailed architecture docs
└── package.json                  # Frontend dependencies
```

---

## Getting Started

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20.x |
| npm | 10.x+ |
| Firebase CLI | 15.x+ |
| Git | 2.x+ |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Khomurod/SafeHaul.git
cd SafeHaul

# 2. Install frontend dependencies
npm install

# 3. Install Cloud Functions dependencies
cd functions && npm install && cd ..
```

### Environment Variables

> **Complete inventory:** the tables below are the getting-started subset. The
> authoritative, machine-checked list of every variable, secret and stored
> integration credential — with its source, whether it can be read back, and what
> may be changed — is
> [docs/environment-and-integrations-runbook.md](docs/environment-and-integrations-runbook.md),
> surfaced in the app under Super Admin → **Environment & Integrations**. The
> registry in `functions/environmentVault/registry.js` is verified against the
> repository by `functions/test/unit/environmentRegistry.inventory.test.js`, so a
> new configuration key cannot silently escape it.

#### Frontend (Firebase Hosting runtime config)

Production reads the six Firebase values from Firebase Hosting's reserved
`/__/firebase/init.json` endpoint. They are no longer stored in GitHub or
Vercel. A local `.env` remains optional for local development only.

| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Cloud Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_SENTRY_DSN` | Sentry error tracking DSN |
| `VITE_FACEBOOK_APP_ID` | Facebook Lead Ads integration |
| `VITE_SOCRATA_APP_TOKEN` | FMCSA carrier autocomplete |
| `VITE_SUPER_ADMIN_EMAIL` | Super admin fallback email |

The deploy workflow reads the Facebook, Sentry, and Socrata browser settings
from Google Secret Manager. They are shared by the test and production builds.

#### Cloud Functions (Google Secret Manager)

| Variable | Description |
|----------|-------------|
| `PROCESS_BULK_BATCH_URL` | Cloud Run URL for `processBulkBatch` (required for bulk campaigns) |
| `BULK_WORKER_SECRET` | Shared secret for bulk worker HTTP auth (same on `initBulkSession` and `processBulkBatch`) |
| `GROQ_API_KEY` | Groq vision API for CDL parsing |
| `SMS_ENCRYPTION_KEY` | AES key for encrypting SMS provider credentials |

These production values are bound directly from Google Secret Manager. A local
`functions/.env` is only for emulator development and must never be committed.

> `SENTRY_DSN` was previously listed here for server-side error tracking. The
> 2026-08-02 configuration audit found no backend code that reads it — only the
> browser DSN (`VITE_SENTRY_DSN`) and the deploy-time sourcemap-upload secrets
> (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) are consumed — so it has
> been removed rather than left as a key operators would set to no effect.

> **Bulk campaigns:** See [docs/production-readiness-runbook.md](docs/production-readiness-runbook.md#bulk-sms--email-campaigns) for Cloud Tasks queue setup and verification.

> **Note**: The legacy `functions.config()` runtime configuration is **disabled**
> for this project (`disallowLegacyRuntimeConfig: true` in `firebase.json`).
> Do not use `firebase functions:config:get` — secrets are bound from Google
> Secret Manager, and the inventory is the Environment & Integrations vault.

### Running Locally

```bash
# Start the Vite development server
npm run dev

# The app will be available at http://localhost:5000
```

> The dev server is pinned to port **5000** with `strictPort: true` — it fails
> rather than silently moving to another port, because the Playwright config
> and its `reuseExistingServer` behaviour depend on that exact port.

For a full Firebase emulator setup:

```bash
# Start Firebase emulators (Firestore, Functions, Auth)
firebase emulators:start
```

---

## Cloud Functions

SafeHaul exports **140+ Cloud Functions** from
[`functions/index.js`](functions/index.js), which is the authoritative registry.
Representative examples by domain:

| Group | Examples | Trigger |
|-------|----------|---------|
| **Driver Sync** | `onApplicationSubmitted`, `onApplicationUpdated`, `onCompanyLeadSubmitted` | Firestore trigger (v2) |
| **Guest Application** | `submitGuestApplication`, `getApplicationAgreements` | Callable (v1/v2) |
| **Bulk Actions** | `initBulkSession`, `processBulkBatch`, `cancelBulkSession` | Callable |
| **SMS Integration** | `sendSMS`, `sendTestSMS`, `saveIntegrationConfig` | Callable |
| **Automated SMS** | `onApplicationAtsContactSms`, `onLeadAtsContactSms` | Firestore trigger (v2) |
| **Email** | `sendAutomatedEmail`, `saveEmailSettings`, `getEmailSettingsMeta` | Callable |
| **Stats** | `onActivityLogCreated` (trigger), `backfillCompanyStats` (callable) | Trigger + Callable |
| **E-Signatures** | `notifySigner` (callable), `sealDocument` (trigger), `getPublicEnvelope` | Callable + Trigger |
| **PEV** | `sendVerificationRequest`, `submitVerificationResponse`, `processVerificationReminders` | Callable + Scheduled |
| **Admin** | `createPortalUser`, `updatePortalUser`, `deleteCompany`, `listCompanyTeam` | Callable |
| **Releases** | `getReleaseStatus`, `promoteTestingToProduction`, `rollbackProductionRelease` | Callable |

Scheduled jobs: `enforceFeatureSchedules` (15 min) ·
`reconcilePublicProfilesSchedule` (60 min) · `publishScheduledBlogPosts`
(hourly at :15, America/Chicago) · `processVerificationReminders` (24 h) ·
`cleanupOrphanedSignatures` (24 h).

`scripts/check-callable-contract.mjs` fails CI if the SPA calls a callable that
`functions/index.js` does not export. The full mapping is in
[docs/callable-frontend-map.md](docs/callable-frontend-map.md).

### Deploying Individual Functions

```bash
# Plan an incremental deploy (deploys only changed/mapped functions)
npm run deploy:functions:plan

# Incremental deploy — the normal path
npm run deploy:functions:incremental

# Deploy a single function
firebase deploy --only functions:functionName

# Deploy hosting only
firebase deploy --only hosting
```

---

## Firestore Security

Security is enforced through **Role-Based Access Control (RBAC)** using Firebase Custom Claims:

```
Custom Claims Structure:
{
  "globalRole": "super_admin",           // Platform-wide access
  "roles": {
    "companyId_abc": "company_admin",    // Company admin
    "companyId_xyz": "recruiter"         // Recruiter at another company
  }
}
```

| Role | Scope | Permissions |
|------|-------|-------------|
| `super_admin` | Global | Broad access **granted per collection** — there is no global wildcard |
| `company_admin` | Company | Manage team, settings, integrations, templates, applications |
| `hr_user` / `recruiter` | Company | Read/write leads, applications, campaigns |
| `driver` | Self | Own profile, own applications (whitelisted fields only) |
| Guest (unauthenticated) | Limited | Submit via callables; see [docs/security-posture.md](docs/security-posture.md) |

Three things are easy to get wrong and are enforced by the rules:

- **The super-admin global wildcard was deliberately removed.** Super admin is
  granted collection by collection, and `environment_audit_log` is unreadable
  even by super admins so it cannot be read around or forged.
- **Cross-tenant profile reads are closed.** Staff may read a `drivers/{id}` or
  `users/{id}` profile only when they share a company with it, via the
  server-maintained `companyIds` field. Listing driver profiles is owner /
  super-admin only.
- **Several collections are server-only by default-deny** — no client rule at
  all — including `rate_limits`, `processing_status`, `environment_audit_log`,
  `ai_*`, `blog_posts`, `landing_leads`, and the `application_originals`
  Storage prefix.

> Security rules are defined in [`src/firestore.rules`](src/firestore.rules) and
> [`src/storage.rules`](src/storage.rules), and are deployed from those paths.
> Guest security model: [docs/security-posture.md](docs/security-posture.md).
> Collection-by-collection access: [docs/firestore-data-model.md](docs/firestore-data-model.md).

---

## Shared AI platform and News & Insights

Every AI-powered feature routes through one server-side system, `functions/ai/`.
Nine providers are supported behind a capability-aware router with automatic
fallback, bounded timeouts and persisted cooldowns; credentials live in Google
Secret Manager and are managed from **Super Admin -> AI Integrations**. No
feature calls a vendor directly, and `scripts/check-ai-provider-boundary.mjs`
fails CI if one tries.

Fallback order: Groq, Google Gemini, Cloudflare Workers AI, GitHub Models
*(retired by its vendor on 2026-07-30 and never selected)*, Mistral, Cerebras,
SambaNova, OpenRouter, Hugging Face.

**SafeHaul News & Insights** publishes three articles a day, one per theme, in
America/Chicago. Articles are researched from official government feeds and
reputable trade press, drafted and fact-checked through the shared router,
checked against an approved capability package so no unsupported product claim
ships, illustrated with a licensed or SafeHaul-owned image, and served as
crawlable server-rendered HTML at `/news`. **Super Admin -> Blog Posts** lists
titles and offers Delete.

Neither system ships with a provider key: until one is configured, AI features
return a "not configured" precondition error and the blog publishes nothing.

- [`docs/ai-platform.md`](docs/ai-platform.md) - architecture, capability matrix,
  credential storage, Groq migration, emergency disable, outage recovery, and the
  manual IAM actions a project owner must perform.
- [`docs/news-and-insights.md`](docs/news-and-insights.md) - themes, scheduling,
  research policy, pipeline, duplicate prevention, image licensing, SEO routes,
  Firestore model, deletion behaviour and stated limitations.

## Deployment

The application and marketing landing page are deployed to **Firebase Hosting**.

Pushes to `main` deploy the **Testing** channel automatically from GitHub Actions
once CI passes. **Production never deploys automatically** — it updates only by
explicit promotion of an already-tested Hosting version.

```bash
# Full deployment (frontend + functions + rules)
firebase deploy

# Application and landing page (select the appropriate named targets)
npm run build && firebase deploy --only hosting:testing,hosting:landing-testing

# Firestore rules only
firebase deploy --only firestore:rules

# Storage rules only
firebase deploy --only storage
```

### Automatic GitHub Deploys

The workflow uses keyless Google Workload Identity Federation. No Google JSON
key or application setting is stored in GitHub.

`Khomurod/SafeHaul` is the only active repository. It has two frontend release
channels sharing one Firebase backend:

- **Testing** — merging to `main` deploys `truckerapp-system.web.app` and
  `safehaul-landing-testing.web.app` automatically, and rolls out the shared
  Functions, Firestore rules, Storage rules and indexes.
- **Production** — `app.safehaul.io`, `safehaul.io` and `www.safehaul.io` are
  **never** released automatically. They update only when someone runs the
  *Promote a tested release to Production* workflow for a specific tested SHA,
  which copies that exact Hosting version rather than rebuilding `main`.

`Khomurod/SafeHaul-for-Gemini-Antigravity` is archived. Its deploy jobs are
guarded off by repository name and it cannot deploy anything.

See [docs/FIREBASE_HOSTING_RUNBOOK.md](docs/FIREBASE_HOSTING_RUNBOOK.md) for the
promotion and rollback process, the shared-backend compatibility rules, DNS
rules, landing-form security, and recovery steps.

> **Important**: Testing is **not a sandbox**. It runs against the same real
> Firestore, Auth, Storage, Functions and integrations as Production — a driver
> who opens a Testing application link is filing a real application. The only
> difference between the channels is which frontend build is served.

> On a machine with limited CPU, prefer `npm run deploy:functions:incremental`
> (or `npm run deploy:functions:sequential`) over a full parallel deploy to
> avoid OOM during build.

---

## Testing

```bash
# Frontend unit tests (Vitest)
npm test

# Frontend coverage (enforces a ratchet gate — raise it, never lower it)
npm run test:coverage

# Cloud Functions tests (Jest)
cd functions && npm test

# Security-rules tests
npm run test:rules

# End-to-end tests (Playwright)
npm run test:e2e

# Design-system catalog: render every story + axe
npm run test:stories

# Linting (frontend + backend + landing claims)
npm run lint
```

> **Run only one Playwright suite at a time.** The config serves the app on port
> 5000 with `reuseExistingServer`, so a second concurrent run attaches to the
> first run's dev server and then collapses when that run tears it down —
> producing a cascade of failures that are not real. **Never use broad
> process-killing patterns** such as `pkill -f vite`: that matches the invoking
> shell's own command line and kills it. Capture the dev server's PID instead.
> Full rules, and why each exists, are in [AGENTS.md](AGENTS.md#local-test-runner-process-safety).

---

## Key Integrations

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Firebase** | Auth, Database, Storage, Hosting, Functions | `.env` + Firebase Console |
| **RingCentral** | SMS sending (primary) | Encrypted in Firestore (`companies/{id}/integrations/sms_provider`) |
| **8x8** | SMS sending (alternate) | Encrypted in Firestore |
| **Sentry** | Error monitoring (browser only) | `VITE_SENTRY_DSN` |
| **Facebook Lead Ads** | Lead ingestion | `VITE_FACEBOOK_APP_ID` |
| **Nodemailer** | Email delivery | Company-specific SMTP; no platform-wide fallback sender |
| **AI providers** (9, behind one router) | CDL auto-fill, e-doc field placement, blog | Google Secret Manager — see [docs/ai-platform.md](docs/ai-platform.md) |
| **Telegram** | Marketing-site lead delivery | Encrypted Firestore config, Secret Manager fallback |
| **GitHub API** | Release promotion from Super Admin | GitHub App credential, server-side only |

---

## Known Issues & Audit Findings

> **Last Audited:** March 4, 2026  
> **Status:** All issues identified by *those* audits have been resolved.

This refers only to the numbered findings from the March 2026 audit rounds
listed below. It is **not** a statement that the system has no open gaps —
current limitations and deliberately accepted risks (most notably the removal of
Firebase App Check, and the direct-Storage-upload gap) are documented in
[docs/APP_BRIEF.md](docs/APP_BRIEF.md#12-known-limitations-retired-features-and-intentional-exceptions)
and [docs/security-posture.md](docs/security-posture.md). Those are accepted
tradeoffs with compensating controls, not regressions to "fix".

### Resolved Issues Summary

| Phase | Issues Fixed | Key Fixes |
|-------|-------------|-----------|
| **Phase 1** | AF2, #1, #2, #3, #4, #11, #12, #16, #19, #22, AF5, AF7, AF8, L2, L5 | Timestamp handling, confirmation numbers, phone validation, gitignore, SSN masking, auth checks, placeholder domains, email pooling, rate-limit TTL |
| **Phase 2** | AF1, AF3, AF4, AF6, M1, M2, M4, M6, #5, #6, #7, #8, #9, #10, #13, #14, #15, #17, #18, #20, #21, L1, L3, L4 | Payload normalization, array/file rendering, signature validation, SHA-256 checksums, guest storage access, phone normalization, SSN/consent in review, custom questions for guests, step navigation, dead code removal, upload instructions, leads scoping, activity_logs security, ARCHITECTURE.md updates, guest signed-URL previews, segment rules export, auto-save guard, internal field filtering |

---

## Scaling Roadmap

Strategic path from ATS to a full-scale **Compliance & Automation Platform**.

> ⚠️ **Nothing below is a current capability.** Anything on the marketing site
> must trace to an `available` or `partial` entry in
> `functions/ai/knowledge/safehaulCapabilities.js`, enforced by
> `npm run check:landing-claims` as part of `npm run lint`.

### ✅ Already shipped (previously on this roadmap)

- **Previous-employment verification (PEV).** `sendVerificationRequest`, the
  token portal at `/verify/:token`, tracked responses, a 5/15/20-day reminder
  cycle and a 30-day `no_response` close-out are all live.
- **Clearinghouse and PSP *disclosures*** are collected from the applicant as
  versioned legal agreements. The *queries themselves* are not implemented — see
  Phase 3.

### 🚨 Phase 1 — Compliance Engine (not built)

| Feature | Tasks |
|---------|-------|
| **Smart DQ File Management** | Schema standardization (`expirationDate` as Timestamp, `medCardExpirationDate`) · Daily expiry monitor (30/60/90-day scan) · Auto-email alerts to drivers + dashboard alerts for recruiters · Red/Yellow row highlighting in driver lists |

> Document-expiry monitoring and renewal reminders **do not exist today** and
> must never be claimed as a current feature.

### 🤖 Phase 2 — Marketing Automation (partly built)

| Feature | Status / Tasks |
|---------|----------------|
| **"Speed to Lead" Auto-SMS** | *Partly built:* automated SMS fires on transition into `Contact Attempt 1/2/3`, using RingCentral/8x8 and per-company templates — **not** Twilio, and not on lead assignment. Still missing: a two-way chat interface in the Recruiter Workspace |
| **Drip Campaigns** | *Not built.* Automated multi-step nurture workflows and re-engagement triggers. Campaigns today are one-way, single-send |

### 🔗 Phase 3 — Integrations (not built)

| Feature | Tasks |
|---------|-------|
| **Background Checks (MVR & PSP)** | Provider integration (SambaSafety / Asurint) · "Order MVR" button in DriverProfile · Auto-save report to DocumentsManager |
| **FMCSA Clearinghouse** | Query automation (MVP: formatted text; Scale: direct API). The applicant-facing consent step already exists; the query does not |

> MVR, PSP and FMCSA Clearinghouse **checks** are not implemented. SafeHaul also
> makes no claim to deliver DOT or FMCSA compliance — it supports the carrier's
> own compliance process.

---

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm test` to verify
4. Submit a pull request

---

## License

This project is proprietary software. All rights reserved.

---

<p align="center">
  Built with ❤️ for the trucking industry
</p>
