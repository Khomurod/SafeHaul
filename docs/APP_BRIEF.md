# SafeHaul — App Brief

**The single orientation document for this application.** Read it before you
change anything; update it when your change makes part of it untrue.

It is deliberately short enough to read at the start of every task. It describes
*what the application is and why it behaves the way it does* — not every file.
Deep detail lives in the linked runbooks under [`docs/`](.).

Verified against the code and configuration on **2026-08-13**.

---

## ⚠️ Permanent rule: this brief is a living document

**Every AI coding agent working in this repository must follow this rule. It is
not optional and it does not expire.**

**Before you change anything**

1. Read the sections of this brief that touch your task.
2. Verify those claims against the current code — this brief can drift, and the
   *code is always the source of truth*. If you find a discrepancy, fix the
   brief as part of your task.

**After you finish any meaningful change** — a feature, bug fix, adjustment,
removal, behavioral change, integration change, workflow change, permission
change, or schedule change — **review this brief again** and:

- **Update** every part that your work made inaccurate.
- **Add** any new important behavior, business rule, dependency, integration,
  scheduled job, permission, intentional exception, or preserved decision.
- **Remove or correct** anything that was retired or is no longer true.

**A task is not complete while this brief says one thing and the application
does another.** Treat "brief updated" as part of the definition of done, in the
same commit as the change itself.

**What does *not* belong here:** minor implementation details, file-by-file
inventories, function signatures, or anything a future agent could learn faster
by reading the code. Add something only if not knowing it would cause a
misunderstanding. Keep it accurate, useful, and concise.

---

## 1. App purpose

SafeHaul is a **multi-tenant SaaS platform for US trucking carriers** that turns
driver hiring into **one structured, defensible record per driver**.

The business problem: a driver's qualification file is normally scattered across
an ATS, an e-signature tool, an inbox and a filing cabinet. Months later, when
someone asks to see it, it does not hold together. SafeHaul keeps the
application, the qualification documents, the signed paperwork, and the verified
previous-employment history against the same driver in the same system.

Two things follow from that and shape most design decisions:

- **The record must survive.** What a driver saw, answered and signed is frozen
  at submission and never re-derived from live data (see §5).
- **The application must not be lost.** Drivers apply on phones on bad
  connections; submission is idempotent and offline-tolerant (see §5).

SafeHaul **deliberately does not claim to make anyone DOT compliant.** It
supports the carrier's own compliance process. Do not add compliance guarantees
to product copy.

---

## 2. Main users

| User | Auth | How they use it |
|---|---|---|
| **Super admin** (platform operator) | `globalRole: super_admin` claim | Mission control at `/super-admin`: provision companies and portal users, global feature flags, AI/SMS/environment credentials, blog, releases, system health |
| **Company admin** | `roles[companyId] = company_admin` | Full company workspace at `/company`: settings, team, integrations, imports, plus everything a recruiter can do |
| **Recruiter / HR user** | `roles[companyId] = recruiter` \| `hr_user` | Daily driver: applications and leads pipeline, campaigns, e-docs, PEV |
| **Driver applicant** | **Usually unauthenticated** (guest) | Fills the 9-step application at `/apply/:slug` on a phone; signs documents; reviews company edits via token link |
| **Past employer** | **Unauthenticated, token link** | Answers a previous-employment verification at `/verify/:token` |

A user may belong to more than one company; the workspace has a company
selector, and the selected company id drives nearly every read.

---

## 3. System shape

Single Firebase project **`truckerapp-system`**, region **`us-central1`**.

| Part | Location | Notes |
|---|---|---|
| React SPA | `src/` | React 19 + Vite 7 + React Router 7 + Tailwind 3.4. Builds to `dist/` |
| Cloud Functions | `functions/` | Node 20, **mixed v1 and v2** (both production-stable; full v2 migration planned, not urgent) |
| Firestore rules | `src/firestore.rules` | Deployed from here, not the repo root |
| Storage rules | `src/storage.rules` | |
| Marketing site | `landing/` | Hand-written HTML/CSS/vanilla JS, **no build step, no framework**. Homepage, privacy page and the server-rendered blog all share `assets/css/styles.css`; see [`DESIGN.md`](../DESIGN.md) |
| Design system | `src/design-system/` | Business-neutral visual contract; see §11 |

**Three communication patterns**, used deliberately:

1. **Direct Firestore SDK** (`onSnapshot` / `getDocs`) for dashboards, lists and
   most CRUD — security enforced by rules.
2. **Callable Cloud Functions** for anything rules cannot express: guest intake,
   third-party APIs, credential handling, cross-tenant admin work.
3. **Firestore triggers + scheduled jobs** for stats, PDFs, notifications and
   maintenance (see §8).

Routing is **manifest-driven**, not hand-edited JSX:
`src/app/routes/appRouteManifest.js` (public + top-level protected) and
`src/app/routes/companyRouteManifest.js` (company workspace **and** its sidebar).
Add routes there, not in `App.jsx`. The company manifest is the single source of
truth shared by routes and navigation, so the two cannot drift.

### Public (unauthenticated) routes

`/apply/:slug` · `/interest/:slug` (legacy redirect to apply) ·
`/sign/:companyId/:requestId` · `/verify/:token` · `/review-change/:token` ·
`/sandbox/apply` · `/sandbox/transfer-success`

### Company workspace (`/company/*`)

`dashboard` · `drivers/applications` · `drivers/leads/company` ·
`drivers/leads/my` · `campaigns` · `e-docs` · `import-leads` (admin) ·
`quick-add-lead` (admin) · `profile` · `settings` (admin)

Unknown `/company/*` paths redirect to the dashboard rather than rendering an
empty shell.

---

## 4. Main features and workflows

**Driver application intake.** Public link `/apply/:slug` resolves a company via
the sanitized `public_profiles/{companyId}` mirror. The driver chooses CDL
photo auto-fill or manual entry, then completes a 9-step wizard (Contact →
Qualifications → License → Violations → Accidents → Employment → General →
Review → Consent) over 11 canonical data sections. Submission goes through the
`submitGuestApplication` callable (Admin SDK), not a client write.

**Recruiter pipeline (ATS).** Applications and leads are separate collections
under the company with the same shape of tooling: status funnel, activity log,
internal notes, documents, assignment. Leads arrive by manual quick-add, CSV /
spreadsheet import, or the Facebook Lead Ads webhook.

**E-documents and signing.** Recruiters build envelopes with placed signer
fields (optionally AI-suggested), send them, and recipients sign at
`/sign/:companyId/:requestId` **with no account**. Signed envelopes are sealed
into tamper-evident PDFs. Signing is unlimited and not billed per envelope.

**Previous employment verification (PEV).** A company admin sends a request to a
past employer, who answers through a token portal with a reminder cycle (§8).

**Driver-approved corrections.** Company admins cannot silently rewrite a
submitted application — see §5.

**Bulk SMS / email campaigns.** Audience building over leads, then a resilient
session-based worker (§8). Partial feature by design: the carrier connects its
own messaging provider and is billed by that provider. No two-way threads, no
automated multi-step drip sequences.

**Super admin operations.** Companies, users, unified driver DB, global feature
flags, SMS integrations, Environment & Integrations vault, AI providers, blog,
landing-page settings, form builder, system health, stats backfill, releases.

---

## 5. Important business rules

These are the rules most likely to be broken by an innocent-looking change.

**Deterministic application IDs.** An application's document id is
`SHA-256(companyId + ":" + email + ":" + phone)` truncated to 20 hex characters,
with email lowercased/trimmed and phone reduced to digits. Retries therefore
collide and become idempotent merges instead of duplicate drivers. The rules
enforce this for authenticated driver creates. **Never change the hash inputs,
normalization or truncation** — existing records would become unreachable.

**Offline-tolerant submission.** Submissions are queued in IndexedDB
(`src/lib/submissionQueue.js`) with exponential backoff and retried when the
connection returns. This only works because the IDs are deterministic.

**The submission snapshot is immutable.** At submission, exactly what the driver
saw, answered and accepted is frozen into
`companies/{id}/applications/{appId}/submission/{version}`. Every client write
to it is **denied by rules** — it is written only by the Admin SDK. A genuine
resubmission takes the next sequence and sits *beside* the first, never on top.

**The original PDF is generated once, from the snapshot.** It is stored at
`application_originals/{companyId}/{applicationId}/{snapshotId}.pdf`, a prefix
that has **no Storage rule at all**, so default-deny applies to every client
including company staff. The only read path is the
`getApplicationOriginalPdfUrl` callable, which authorizes the caller and writes
an audit record before issuing a short-lived signed URL. This matters because
the document can carry a full SSN. **Do not add a Storage rule for that prefix
and do not regenerate the PDF on download.**

**Legal agreement wording is versioned and frozen.** Four agreements
(`electronicSignature`, `fcraDisclosure`, `pspDisclosure`,
`clearinghouseConsent`) live in `functions/shared/legalAgreements.js`, current
version `v1`. A submission is bound to the version the applicant actually saw,
never to whatever is deployed when the request lands. `legacy-1` bodies are a
**frozen forensic record — never edit them**. `clearinghouseConsent`
deliberately has *no* `legacy-1`, so historical reconstruction can never
attribute a consent nobody gave.

**Acceptance IP is server-observed.** The browser may report its user agent
(self-description) but its claimed IP is overwritten unconditionally with the
address the server saw. Evidence forgeable by the party it incriminates is not
evidence.

**Employment history must cover 36 months.** Per 49 CFR 391.21(b)(10), the
application must account for the previous three years; employment,
unemployment, schooling and military service all count, so a gap is only a gap
when nothing explains it. The calculation is calendar-month based and pure (no
I/O, injected reference date) so a recorded coverage result never drifts. The
logic is implemented **twice** — `functions/shared/employmentCoverage.js` and
`src/shared/utils/employmentCoverage.js` — because the browser needs the same
answer and the SPA does not import the CommonJS backend modules. Both are proven
identical against the shared `employmentCoverage.vectors.json` fixtures.
**Change both or neither.** (The same convention is used for
`searchNormalization`; note that the *data* file
`functions/shared/applicationSections.json` is genuinely shared by direct import
from `src/config/applicationDefinition.js`.)

**Company edits to a submitted application need driver approval.** A company
admin's edits become per-field `pending_changes`; the main document stays the
**canonical original** until each field is resolved, so exports keep showing
originals for unapproved edits. The driver approves, rejects or corrects them
through a token link (`/review-change/:token`, 30-day TTL). The
`hasPendingCompanyChanges` flag clears only when all fields are resolved. All
writes go through callables; client writes to `pending_changes` are denied.

**Application gates have one resolver.** Whether a standard DOT question is
required, optional or hidden is resolved by `src/config/applicationGates.js`,
which mirrors `functions/shared/applicationDefinition.js` exactly — asserted by
`applicationGates.test.js`. The wizard, the server validator and the snapshot
must never disagree about what was asked. Defaults are load-bearing: `mvrConsent`
is hidden and not required until a company opts in, and `emergencyContacts` is
hidden by default, because flipping either would retroactively change or block
every existing company's application.

**ATS statuses are stored strings.** `src/shared/constants/atsStatus.js` holds
the canonical funnel (`New`, `Contact Attempt 1–3`, `In Process`, `Hired`,
`Terminated`, `Declined`), plus `Interested` and a list of legacy aliases kept
selectable so older records stay editable. Creation defaults differ by origin:
leads get `New Lead`, applications get `New Application`. Firestore rules
validate status transitions and **cannot import JS**, so renaming a value means
editing the rules too.

**Tenant binding is immutable.** Rules require `companyId` to match the path on
create and to be unchanged on update, so a record can never be filed under one
company while claiming another.

---

## 6. Permissions and access rules

Authorization comes from **Firebase Auth custom claims**, and the same signals
are used by the UI, the routes, Firestore rules and Storage rules.

- `globalRole: 'super_admin'` (accepted both at the token root and nested under
  `roles`, for legacy tokens).
- `roles[companyId]` = `company_admin` \| `hr_user` \| `recruiter`.
- `companyTeamIds` is a denormalized convenience claim. Storage rules accept
  **either** it or `roles[companyId]`, because it can be stale until
  `onMembershipWrite` re-runs *and* the client refreshes its token.

Rule vocabulary: `isSuperAdmin()` · `isCompanyAdmin(companyId)` ·
`isCompanyTeam(companyId)` (admin + hr_user + recruiter + super admin) ·
`isOwner(uid)` · `readerSharesCompany(companyIds)`.

**Things that are easy to get wrong:**

- **There is no super-admin global wildcard** in Firestore rules. It was removed
  deliberately; super admin is granted per collection.
- **Cross-tenant profile reads are closed.** A staff member may read a
  `drivers/{id}` or `users/{id}` profile only when they share a company with it,
  via server-maintained `companyIds`. Listing driver profiles is owner/super
  admin only.
- **Menu visibility and route access share one function.**
  `isCompanyAdminForRoute()` in `src/app/auth/roles.js` backs both the sidebar
  and `CompanyAdminRoute`, so a hidden nav item can never be reachable by URL.
  Keep it that way.
- **Server-only collections** rely on default-deny with no client rule:
  `rate_limits`, `processing_status`, `integrations_index`,
  `environment_audit_log`, `ai_provider_config`, `ai_routing_config`,
  `ai_telemetry`, `blog_posts`, `platform_settings`, `landing_leads`,
  `orphaned_signature_cleanup`, and the `application_originals` Storage prefix.
  `environment_audit_log` is unreadable **even by super admins**, so it cannot be
  read around or forged through the callable.
- **Guests never write Firestore directly.** Guest application creates go
  exclusively through `submitGuestApplication`.
- **Documents are never public URLs.** Every file link is server-issued, single
  purpose and checked against company membership (`getSignedDocumentUrl`,
  `getSignedApplicationFileUrl`, `getSignedGuestUploadUrl`, `getSignedPevUrl`).
  Persisted upload URLs expire, so views re-sign at view time.

**Per-tenant feature flags** live on `companies/{companyId}` as `features` and
`featureSchedules`. Keys: `pev`, `campaignsEnabled`, `eDocs`, `importLeads`,
`callTracking`. Semantics are **opt-out**: a missing key means *enabled*, and only
an explicit `false` disables. `features` is stripped from the public profile
projection, and `/apply/:slug` is not gated by any flag. See
[`docs/feature-flags.md`](./feature-flags.md).

---

## 7. Important integrations

| Integration | Purpose | Where credentials live |
|---|---|---|
| **Firebase** (Auth, Firestore, Storage, Functions, Hosting) | Everything | Project config |
| **RingCentral** (primary) / **8x8** (alternate) | Outbound SMS | Encrypted per company in `companies/{id}/integrations/sms_provider`, decrypted server-side with `SMS_ENCRYPTION_KEY` |
| **Per-company SMTP** (Nodemailer) | All outbound email — there is no platform-wide fallback sender | `companies/{id}/system_settings/email_config` (admin-only subcollection); password encrypted with an `enc:v1:` prefix and **never returned to the browser**. A legacy fallback still reads `companies/{id}.emailSettings` for pre-migration tenants — do not delete it without migrating them |
| **Facebook Lead Ads** | Inbound leads → company `leads` subcollection | Per company |
| **AI providers** | CDL auto-fill, e-doc field placement, blog generation | Secret Manager via the frozen registry in `functions/ai/registry` |
| **Telegram** | Marketing-site lead delivery | Encrypted Firestore config, Secret Manager fallback |
| **Socrata / Transportation.gov** | FMCSA employer autocomplete | Public app token |
| **Sentry** | Error monitoring (frontend + functions) | DSN |
| **GitHub API** | Release promotion from the Super Admin UI | GitHub App credential, server-side only |

**Two hard boundaries:**

- **No feature may call an AI vendor directly.** Every AI request goes through
  `functions/ai/` (task interface → capability-aware router → provider adapter →
  schema-validated response). `npm run check:ai-boundary` fails CI if one tries.
  See [`docs/ai-platform.md`](./ai-platform.md).
- **SMS credentials are resolved by a factory, never inline.**
  `SMSAdapterFactory` fetches, decrypts and instantiates the right adapter. A
  per-user *keychain* (`.../sms_provider/keychain/{userId}`) maps a recruiter to
  their own "From" number, with fallback to the company main number.

---

## 8. Automatic and background behavior

### Scheduled jobs

| Job | Cadence | What it does |
|---|---|---|
| `enforceFeatureSchedules` | every 15 min | Auto-disables features whose `featureSchedules` entry has passed |
| `reconcilePublicProfilesSchedule` | every 60 min | Rewrites public profiles the `onWrite` trigger can never reach (e.g. after the projection itself changes) |
| `publishScheduledBlogPosts` | hourly at :15, America/Chicago | Fills at most one of the day's three themed slots if due and empty |
| `processVerificationReminders` | every 24 h | PEV reminders at 5 / 15 / 20 days; at 30 days marks `no_response` and notifies the carrier, documenting the good-faith effort |
| `cleanupOrphanedSignatures` | every 24 h | Retries deleting signature PNGs left after sealing — without it, signature-image PII accumulates in Storage |
| Release health check | daily 07:17 UTC (GitHub Actions) | Reads what is actually live and opens/closes a GitHub issue |

The blog scheduler runs hourly rather than three times a day on purpose: that one
choice makes it idempotent, retry-safe, able to recover a slot missed during an
outage, and incapable of posting three articles a minute apart.

### Firestore triggers

- **Driver sync** — applications, company leads, logs and activities upsert a
  master `drivers/{id}` profile. A driver with no Auth account gets a **shadow
  profile** keyed by the document id; an Auth user is **never** created
  automatically. They claim it when they sign up.
- **Stats** — `activity_logs` writes roll up into `stats_daily`; application and
  lead writes roll up dashboard counters into `internal_stats` (server-write only).
- **Sealing** — a signing request moving to `pending_seal` triggers PDF sealing.
- **Notifications** — status changes, lead assignment, new applications,
  scheduled callbacks, and an applicant confirmation email on every new
  application.
- **Automated contact SMS** — moving an application or lead *into* `Contact
  Attempt 1/2/3` sends the matching template from
  `companies/{id}/settings/automated_sms`. It fires only on transition, so it is
  idempotent; no template configured means no message.
- **Segments** — application create/update maintains segment membership.
- **Retention** — activity logs are stamped with `expiresAt` for the eventual TTL
  policy.

### Idempotency

Long-running triggers guard themselves through a `processing_status` ledger
(check `completed` → set `started` → process → set `completed`), with a 30-day
`expiresAt` so a TTL policy can age entries out.

### Bulk campaigns

A recursive worker processes **50 recipients per batch** to stay inside function
timeouts, re-checking session state each batch so a cancelled campaign stops
immediately rather than leaving a zombie worker running. Recently-contacted
numbers are excluded using a configurable window that **defaults to 7 days**.
Company and global `blacklist` collections hold SMS opt-outs and are checked
before **every** send, failing closed on an unparseable number — but nothing
currently populates them from a recipient's reply; see §12.

---

## 9. Relationships between features — where changes ripple

- **`public_profiles` is the contract for the public apply page.** It is a
  sanitized projection of `companies/{id}` that deliberately strips `features`,
  `featureSchedules` and internal fields. If a company setting has no effect on
  `/apply/:slug`, the projection allowlist is the first place to look — that has
  been the bug before.
- **Applications and leads are near-twins.** Most callables accept a
  `collectionName` of `applications` or `leads` (strictly whitelisted against
  path injection). A change to one usually belongs in both.
- **`drivers/{id}.companyIds` and `users/{id}.companyIds` are load-bearing for
  security**, not just convenience — `readerSharesCompany` is built on them. They
  are server-maintained; breaking their population silently breaks legitimate
  reads.
- **Snapshot ↔ PDF ↔ agreements** are one chain. Touching the application
  definition, the agreement registry or the PDF renderer affects what future
  originals contain — and must never affect existing ones.
- **The company route manifest drives routes *and* the sidebar.** One edit moves
  both.
- **Firestore rules encode enums and field whitelists that live in JS elsewhere.**
  Rules cannot import, so ATS statuses and driver self-update fields exist in two
  places by necessity.
- **Callable names are a contract.** `scripts/check-callable-contract.mjs` fails
  CI if the SPA calls a name `functions/index.js` does not export. See
  [`docs/callable-frontend-map.md`](./callable-frontend-map.md).
- **The privacy page shares a stylesheet with the server-rendered blog.**
  `/news`, `/news/{slug}` and `/news/feed.xml` are rendered by `serveBlogPublic`
  and use `landing/assets/css/styles.css` (section 16), as do
  `landing/privacy.html` and `landing/index.html`, so that file cannot be
  rewritten without carrying the blog's styles along. Sections 6, 16 and 18 dress
  the navbar, cards and footer the blog function emits, so nothing in them may
  assume the homepage's markup exists.

---

## 10. Decisions that must be preserved

- **Firebase App Check is intentionally absent.** It was implemented, and in
  production it **blocked real drivers' CDL and medical-card uploads**, killing
  applications at the top of the funnel. It was removed as a conscious tradeoff.
  Audits should record it as an *accepted, documented risk* with compensating
  controls (MIME allowlist, 20 MB size cap, path isolation, tenant/intake gating,
  IP rate limiting, no public Storage read, Admin-SDK submit path) — **not** as a
  newly discovered vulnerability to fix by re-enabling it. See
  [`docs/security-posture.md`](./security-posture.md).
- **Testing is not a sandbox.** `truckerapp-system.web.app` runs against the
  **same real** Firestore, Auth, Storage, Functions and integrations as
  production. A driver opening a Testing apply link files a real application. The
  only difference between channels is which frontend build is served.
- **Production never deploys automatically.** Merging to `main` deploys Testing
  and the shared backend; Production is reached only by explicit promotion of an
  already-tested Hosting version, through Super Admin → Releases. See
  [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md).
- **`workers: 1` in the Playwright CI config is deliberate.** Raising it was
  evaluated and rejected on evidence of contention-induced flakes. Sharding
  across runners is the sanctioned way to speed the suite up. A single green run
  is **not** sufficient evidence to change this.
- **UI standardization must not change backend behavior.** Design-system work may
  not alter Firebase rules, data structures, integrations, permissions, routes,
  feature flags or business workflows unless that is separately justified and
  approved.
- **The landing site stays dependency-free.** No framework, no build step, and no
  application or design-system imports — asserted by
  `src/tests/landingNewsSection.test.js`. This holds for every surface, homepage
  included.
- **Marketing claims must trace to the capability registry.**
  `functions/ai/knowledge/safehaulCapabilities.js` is the source of truth, and
  `npm run check:landing-claims` enforces it as part of `npm run lint`. Never
  claim DOT/FMCSA compliance, MVR/PSP/Clearinghouse checks, document-expiry
  monitoring, a job board, or any named carrier endorsement.
- **A `landing/` change runs the `frontend_unit` CI lane.** The marketing site has
  no build step, so "static content is not tested" is an easy assumption — and
  `scripts/ci-plan.mjs` used to encode it, mapping `landing/` to no lane at all.
  A landing-only commit therefore passed CI green while shipping a homepage that
  claimed MVR checks, captured no lead, and failed `npm run lint`. The two
  landing suites live in `src/tests/` and run in that lane; `A5`/`A5b` in
  `scripts/test-ci-plan.mjs` pin it.

---

## 11. Design system and UI work

Mandatory reading before any UI, styling, responsive or accessibility change:
[`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`](./SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md)
and [`src/design-system/README.md`](../src/design-system/README.md). The roadmap
is authoritative for the design-system rules, the approved exceptions and the
open decisions; this section is only a summary of it.

Layering: the design system owns reusable appearance and interaction and must
never know what a driver, lead or campaign is; feature folders own content,
actions and domain-to-visual mapping; hooks and services own data, state and
business logic; `src/app` owns routing and composition.

Reuse approved components and semantic `--ds-*` tokens. Do not add a local
button, modal, form control, table, status treatment, arbitrary color or
unsupported font size unless the roadmap records the gap and the code documents
the temporary exception. **No 9px or 10px body text.** Update the roadmap with
evidence in the same task, and never mark an item complete without the
functional, visual, mobile, accessibility, documentation and diff checks
actually having run.

---

## 12. Known limitations, retired features and intentional exceptions

**Retired — do not resurrect, and do not treat leftovers as bugs:**

- **Lead Distribution Engine** (platform-wide daily lead fan-out). Fully removed;
  no `isPlatformLead`, `distributedAt`, `visitedCompanyIds` or `dailyLeadQuota`.
- **Public job board / driver saved jobs.** Rules for `job_posts` and
  `drivers/{id}/saved_jobs` were deleted; those paths now rely on default-deny.
  Historical documents are left unreachable rather than deleted.
- **`/join/:companyId` self-service team join.** The backing callable was
  disabled; the route was removed. Use Super Admin → Create Portal User.
- **GitHub Models** as an AI provider.
- **`Khomurod/SafeHaul-for-Gemini-Antigravity`** — archived; never develop or
  deploy from it. Deploy jobs are guarded by repository name.

**Current limitations:**

- **No payment processing.** `companies/{id}.planType` is a manual super-admin
  `free` / `paid` flag that only changes a badge ("Free Plan" / "Pro Plan").
  Marketing prices ($199 / $299 per month) are **not** enforced anywhere in the
  app.
- **Campaigns are one-way.** No inbound threads, no automated drip sequences.
- **Opt-out enforcement works; opt-out *capture* does not.** `batchWorker.js`
  calls `isBlacklisted()` before every send, checks both the company and global
  `blacklist` collections, and fails closed on an unparseable number — that half
  is real. But `handleOptOut` (`functions/blacklist.js`) is a Firestore trigger on
  `companies/{companyId}/inbound_messages/{msgId}`, and **nothing in the
  repository writes that collection**: there is no inbound SMS webhook, and the
  function's own comment says a real deployment would need one. A recipient's STOP
  reply therefore reaches the company's own provider, not SafeHaul, and a number
  arrives on the blacklist only when something writes it there directly. There is
  no admin interface for that either. The marketing site sold this as "opt-out
  handling" until 2026-08-13; the claims gate is a phrase list and cannot see a
  claim that is merely too generous.
- **Frontend coverage thresholds are a low ratchet** (statements 16 %, lines
  16 %, branches 13 %, functions 13 %) — deliberately set just under the current
  baseline to block regressions, not to describe good coverage. Raise them as
  coverage genuinely improves; never lower them to make a build pass.
- **Mixed Functions v1/v2** — intentional, not a defect.
- **Feature flag defaults are asymmetric** (opt-out; missing means on). Easy to
  misread as a bug.
- **A direct Storage upload can bypass the backend helper** — a documented,
  accepted gap; see `docs/security-posture.md`.
- **Historical reconstruction is an ongoing migration.** Applications submitted
  before snapshot preservation get a reconstructed record and PDF built only from
  evidence that survives, and explicitly **marked as reconstructed**
  (`reconstructHistoricalApplications`). `surveyHistoricalReconstruction` is the
  read-only counter of what is genuinely outstanding, and the temporary Super
  Admin action reads its total from there rather than a hard-coded number, so it
  retires itself when the work is verified complete. See
  [`docs/application-record-reconstruction-runbook.md`](./application-record-reconstruction-runbook.md).
- **Several one-time backfill callables are still exported** (`backfillUserCompanyIds`,
  `backfillDriverCompanyIds`, `backfillPublicProfiles`, `migrateEmailSettings`,
  `backfillApplicationSearchFields`, stats and SMS-phone backfills). They are
  super-admin-only maintenance tools, not dead code — check before removing one.

---

## 13. Testing and operational expectations

**Commands:** `npm run lint` (frontend + backend + landing claims) ·
`npm test` (Vitest) · `npm run test:coverage` (ratchet gate) ·
`npm run test:e2e` (Playwright) · `npm run test:rules` ·
`npm run typecheck` · `npm run storybook` / `npm run test:stories`.
CI also runs `check:callable-contract`, `check:ai-boundary`, `check:ci-plan`,
`check:release-scripts`, `check:deploy-script`, `check:table-layout`, and a
Gitleaks secret scan.

CI runs Playwright as a 4-way shard matrix with `workers: 1` and `retries: 2`
per shard.

`npm run typecheck` is a **non-blocking** baseline (`continue-on-error` in the
workflow) and currently reports pre-existing errors in
`src/config/applicationDefinition.js`. A red typecheck is not a broken build;
do not assume a pre-existing one is yours.

**The marketing site has three of its own gates**, and only the middle one runs
in CI: `npm run check:landing-claims` (part of `npm run lint`),
`src/tests/landingPage.test.js` + `src/tests/landingNewsSection.test.js` (the
`frontend_unit` lane, which a `landing/` change now selects), and
`npm run check:landing-a11y`, which needs a real Chromium and is run by hand.
Run all three before pushing a change to `landing/`.

**Local test-runner safety.** Four rules — run one Playwright suite at a time,
never use a broad `pkill`, collect a long suite's real exit status before
calling it a failure, and never fabricate a commit around a failing PR API —
each learned the expensive way. Also: do not edit files in the module graph
while a Playwright suite is running. [`AGENTS.md`](../AGENTS.md#local-test-runner-process-safety)
is authoritative and explains why each exists; follow it exactly rather than
this summary.

**Operationally:** a green CI run is *not* evidence that anything shipped.
`verify-shipped` reads the deployed SHA back off the live site, and the live
commit is always readable without credentials at
`https://truckerapp-system.web.app/release.json`. Before merging a pipeline
change, run `npm run check:ci-plan` and then **watch the real `main` run to
completion** — a PR never deploys, so it cannot exercise the path you changed.

---

## 14. Where to read more

| Topic | Document |
|---|---|
| Agent working process, MCP tool policy, UI policy | [`AGENTS.md`](../AGENTS.md) / [`CLAUDE.md`](../CLAUDE.md) |
| Architecture patterns | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Product positioning, capability claims | [`PRODUCT.md`](../PRODUCT.md) |
| Collections, fields, access summary | [`docs/firestore-data-model.md`](./firestore-data-model.md) |
| Callable ↔ frontend map | [`docs/callable-frontend-map.md`](./callable-frontend-map.md) |
| Feature flags | [`docs/feature-flags.md`](./feature-flags.md) |
| Guest/public security posture | [`docs/security-posture.md`](./security-posture.md) |
| Shared AI platform | [`docs/ai-platform.md`](./ai-platform.md) |
| Automated blog | [`docs/news-and-insights.md`](./news-and-insights.md) |
| Hosting, releases, promotion | [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md) |
| Credentials and integrations inventory | [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md) |
| Operations, alerting, retention | [`docs/production-readiness-runbook.md`](./production-readiness-runbook.md) |
| Historical record reconstruction | [`docs/application-record-reconstruction-runbook.md`](./application-record-reconstruction-runbook.md) |
| Design-system standard and open decisions | [`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`](./SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md) |
| Marketing-site visual specification | [`DESIGN.md`](../DESIGN.md) / [`landing/README.md`](../landing/README.md) |
| Manual signing-room device QA | [`docs/qa/edoc-mobile-document-first-qa.md`](./qa/edoc-mobile-document-first-qa.md) |

**Note on `README.md`:** it is the getting-started guide and documentation map —
setup, environment variables, commands, deployment. It defers to this brief for
what the application is and how it behaves. Where the two ever disagree, this
brief and the code win.

---

*Keep this brief true. See the permanent rule at the top.*
