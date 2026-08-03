<p align="center">
  <h1 align="center">🚛 SafeHaul</h1>
  <p align="center">
    <strong>Multi-Tenant Trucking HR & Recruitment Platform</strong>
  </p>
  <p align="center">
    DOT-Compliant Driver Applications · Bulk SMS Campaigns · E-Signatures · Real-Time Analytics
  </p>
  <p align="center">
    <a href="https://truckerapp-system.web.app/">Live App</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#deployment">Deployment</a>
  </p>
</p>

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

SafeHaul is a **multi-tenant SaaS platform** built for trucking companies to manage the entire driver hiring lifecycle — from lead acquisition, through DOT-compliant applications, to e-signatures and onboarding. The platform serves three distinct user personas through role-based portals:

| Portal | Users | Purpose |
|--------|-------|---------|
| **Super Admin** (Mission Control) | Platform operators | Company provisioning, analytics, system health |
| **Company Admin / HR** | Recruiters, HR managers | Application review, pipeline tracking, campaigns, team management |
| **Driver App** | CDL drivers | Public application submission, document uploads, e-signing |

---

## Features

### 📋 DOT-Compliant Driver Applications
- **9-step wizard** (Contact → Qualifications → License → Violations → Accidents → Employment → General → Review → Consent)
- **Deterministic application IDs** — `SHA-256(companyId + email + phone)` prevents duplicates
- **Offline-resilient submission** via IndexedDB queue with exponential backoff
- **Guest submissions** through public company links (no auth required)
- **49 CFR 391.21 compliant** PDF generation with full legal agreements

### 📨 Bulk SMS/Email Campaigns
- **Recursive worker pattern** — processes in small batches (20 at a time) to avoid timeouts
- **Zombie worker prevention** — double-check strategy ensures cancelled campaigns stop immediately
- **Multi-provider SMS** — RingCentral + 8x8 integration with per-recruiter number routing
- **Automatic fallback** — if a recruiter's direct line fails, retries with the company main number
- **7-day deduplication** — prevents re-messaging recently contacted leads

### ✍️ E-Signatures & Document Management
- **Draw or type** signatures via canvas or text input
- **Document fan-out** — uploaded files are stored in structured subcollections (`dq_files`)
- **Digital sealing** with tamper-evident envelope system
- **Public signing links** — recipients can sign without creating an account

### 📊 Analytics & Pipeline
- **Real-time dashboard** with daily stats aggregation
- **Hiring pipeline** with customizable stages (In Process, On Hold, Hired, Rejected)
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
| Framer Motion | 12 | Animations & transitions |
| Recharts | 3.6 | Data visualization |
| Lucide React | 0.552 | Icon library |
| jsPDF | 4.0 | Client-side PDF generation |
| ExcelJS | 4.4 | Spreadsheet parsing for bulk imports |
| React Signature Canvas | 1.1 | Signature capture |
| TipTap | 3.17 | Rich text editor |
| React Virtuoso | 4.18 | Virtualized lists |
| Sentry | 10.32 | Error monitoring |

### Backend (Firebase)
| Technology | Version | Purpose |
|-----------|---------|---------|
| Firebase Admin SDK | 13.6 | Server-side Firestore, Auth, Storage |
| Firebase Functions | 7.0 | Serverless Cloud Functions (v1 + v2) |
| Cloud Firestore | — | NoSQL database |
| Firebase Auth | — | Authentication with custom claims (RBAC) |
| Firebase Storage | — | File uploads (CDL, medical cards, etc.) |
| Firebase Hosting | — | Static site hosting |
| Nodemailer | 7.0 | Email delivery |
| Sentry Node | 10.32 | Server-side error tracking |
| Joi | 18.0 | Request validation |
| pdf-lib | 1.17 | Server-side PDF manipulation |

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
│   ├── features/                 # Feature modules (domain-driven)
│   │   ├── analytics/            # Charts & performance dashboards
│   │   ├── applications/         # Application list & management
│   │   ├── auth/                 # Login, registration
│   │   ├── campaigns/            # Bulk SMS/Email campaign builder
│   │   ├── companies/            # Company profiles & settings
│   │   ├── company-admin/        # HR portal (leads, uploads, pipeline)
│   │   ├── driver-app/           # Public driver application wizard
│   │   ├── drivers/              # Driver profiles & management
│   │   ├── onboarding/           # New user onboarding flow
│   │   ├── settings/             # User & company settings
│   │   ├── signing/              # E-signature system
│   │   └── super-admin/          # Platform-wide admin tools
│   ├── firestore.rules           # Firestore security rules
│   ├── storage.rules             # Storage security rules
│   └── tests/                    # Frontend tests
├── functions/                    # Firebase Cloud Functions
│   ├── index.js                  # Function exports registry
│   ├── firebaseAdmin.js          # Admin SDK singleton
│   ├── driverSync.js             # Application → Profile trigger
│   ├── guestApplication.js       # Guest submission handler
│   ├── leadDistribution.js       # Scheduled lead dealing
│   ├── leadLogic.js              # Distribution algorithms
│   ├── bulkActions/              # Bulk messaging worker system
│   ├── integrations/             # SMS adapters (RingCentral, 8x8)
│   ├── emailService.js           # Email delivery (Nodemailer)
│   ├── statsAggregator.js        # Daily stats computation
│   ├── companyAdmin.js           # Company management functions
│   ├── hrAdmin.js                # HR admin operations
│   ├── digitalSealing.js         # Document sealing
│   ├── publicSigning.js          # Public e-signature handler
│   └── shared/                   # Shared constants & utilities
├── firebase.json                 # Firebase project config
├── firestore.indexes.json        # Composite index definitions
├── .env                          # Environment variables (frontend)
├── functions/.env                # Environment variables (backend)
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
git clone https://github.com/Khomurod/SafeHaul-for-Gemini-Antigravity.git
cd SafeHaul-for-Gemini-Antigravity

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

> **Note**: Firebase Cloud Functions also use runtime configuration for service-specific keys. See `firebase functions:config:get` for current values.

### Running Locally

```bash
# Start the Vite development server
npm run dev

# The app will be available at http://localhost:5173
```

For a full Firebase emulator setup:

```bash
# Start Firebase emulators (Firestore, Functions, Auth)
firebase emulators:start
```

---

## Cloud Functions

SafeHaul uses **40+ Cloud Functions** organized by domain. Key function groups:

| Group | Functions | Trigger |
|-------|-----------|---------|
| **Driver Sync** | `onApplicationCreated` | Firestore trigger (v2) |
| **Guest Application** | `submitGuestApplication` | Callable (v1) |
| **Bulk Actions** | `startBulkSession`, `processBulkBatch` | Callable (v2) |
| **SMS Integration** | `sendDirectSms` | Callable (v2) |
| **Email Service** | `sendCustomEmail` | Callable |
| **Stats** | `aggregateStats`, `rebuildLeadStats` | Trigger + Scheduled |
| **E-Signatures** | `generateSigningRequest`, `processSignedDocument` | Callable + Trigger |
| **Admin** | `setUserRole`, `addTeamMember`, `createCompany` | Callable |

### Deploying Individual Functions

```bash
# Deploy a single function (recommended for limited resources)
firebase deploy --only functions:functionName

# Deploy all functions
firebase deploy --only functions

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
| `super_admin` | Global | Full read/write to all collections |
| `company_admin` | Company | Manage team, settings, templates, applications |
| `hr_user` / `recruiter` | Company | Read/write leads, applications, campaigns |
| `driver` | Self | Own profile, own applications |
| Guest (unauthenticated) | Limited | Submit via callables; see [docs/security-posture.md](docs/security-posture.md) |

> Security rules are defined in [`src/firestore.rules`](src/firestore.rules). Guest security model: [docs/security-posture.md](docs/security-posture.md).

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

Pushes to `main` now deploy Hosting automatically from GitHub Actions after the existing Functions checks and frontend build pass.

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

- `Khomurod/SafeHaul-for-Gemini-Antigravity` deploys Hosting to
  `truckerapp-system.web.app` and `safehaul-landing-testing.web.app`.
- `Khomurod/SafeHaul` deploys Hosting to `app.safehaul.io`, `safehaul.io`, and
  `www.safehaul.io`, and owns shared Functions, Firestore rules, Storage rules,
  and indexes.
- The workflow decides the destination from `github.repository`, so the same
  repository files can be copied between test and production safely.

Push or merge changes into `main`; successful checks trigger the appropriate
deployment automatically.

See [docs/FIREBASE_HOSTING_RUNBOOK.md](docs/FIREBASE_HOSTING_RUNBOOK.md) for the
simple test-to-production copy process, DNS rules, landing-form security, and
recovery steps.

> **Important**: When deploying Cloud Functions, deploy them **one at a time** if you have limited CPU to avoid OOM issues during build.

---

## Testing

```bash
# Frontend unit tests (Vitest)
npm test

# Cloud Functions tests (Jest)
cd functions && npm test

# End-to-end tests (Playwright)
npm run test:e2e

# Linting (Frontend + Backend)
npm run lint
```

---

## Key Integrations

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Firebase** | Auth, Database, Storage, Hosting, Functions | `.env` + Firebase Console |
| **RingCentral** | SMS sending (primary) | Encrypted in Firestore (`companies/{id}/integrations/sms_provider`) |
| **8x8** | SMS sending (alternate) | Encrypted in Firestore |
| **Sentry** | Error monitoring (frontend + backend) | `VITE_SENTRY_DSN` / `SENTRY_DSN` |
| **Facebook Lead Ads** | Lead ingestion | `VITE_FACEBOOK_APP_ID` |
| **Nodemailer** | Email delivery | Company-specific SMTP settings |

---

## Known Issues & Audit Findings

> **Last Audited:** March 4, 2026  
> **Status:** ✅ All identified issues have been resolved.

All critical, high, medium, and low issues from previous audits have been addressed. See git history for details on each fix.

### Resolved Issues Summary

| Phase | Issues Fixed | Key Fixes |
|-------|-------------|-----------|
| **Phase 1** | AF2, #1, #2, #3, #4, #11, #12, #16, #19, #22, AF5, AF7, AF8, L2, L5 | Timestamp handling, confirmation numbers, phone validation, gitignore, SSN masking, auth checks, placeholder domains, email pooling, rate-limit TTL |
| **Phase 2** | AF1, AF3, AF4, AF6, M1, M2, M4, M6, #5, #6, #7, #8, #9, #10, #13, #14, #15, #17, #18, #20, #21, L1, L3, L4 | Payload normalization, array/file rendering, signature validation, SHA-256 checksums, guest storage access, phone normalization, SSN/consent in review, custom questions for guests, step navigation, dead code removal, upload instructions, leads scoping, activity_logs security, ARCHITECTURE.md updates, guest signed-URL previews, segment rules export, auto-save guard, internal field filtering |

---

## Scaling Roadmap

Strategic path from ATS to a full-scale **Compliance & Automation Platform**.

### 🚨 Phase 1 — Compliance Engine

| Feature | Tasks |
|---------|-------|
| **Automated VOE** | `sendVOERequest` Cloud Function (pre-filled PDF + digital signature) · External Verification Portal for past employers |
| **Smart DQ File Management** | Schema standardization (`expirationDate` as Timestamp, `medCardExpirationDate`) · Daily expiry monitor (30/60/90-day scan) · Auto-email alerts to drivers + dashboard alerts for recruiters · Red/Yellow row highlighting in driver lists |

### 🤖 Phase 2 — Marketing Automation

| Feature | Tasks |
|---------|-------|
| **"Speed to Lead" Auto-SMS** | Twilio integration · Triggered SMS on lead assignment · 2-way chat interface in Recruiter Workspace |
| **Drip Campaigns** | Automated 4-week nurture workflow for "No Answer" / "Not Interested" leads · Re-engagement trigger on email click |

### 🔗 Phase 3 — Integrations

| Feature | Tasks |
|---------|-------|
| **Background Checks (MVR & PSP)** | Provider integration (SambaSafety / Asurint) · "Order MVR" button in DriverProfile · Auto-save report to DocumentsManager |
| **FMCSA Clearinghouse** | Clearinghouse Limited Query Consent step · Query automation (MVP: formatted text; Scale: direct API) |

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
