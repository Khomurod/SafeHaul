# SafeHaul — Full Application Audit Report

**Audit date:** July 3, 2026
**Audited by:** Automated technical, security, and repository-cleanup review
**Branch audited:** `claude/safehaul-comprehensive-audit-g67cal`
**Latest commit at audit time:** `4f59ba0` (SMS line-assignment backfill fix, PR #70)

> ⚠️ **HISTORICAL / SUPERSEDED — Telegram application intake.** After this audit,
> the **Telegram application-intake feature was removed from this repository**
> (commit `5a4c8dd`). The `functions/telegram/*` files referenced below
> (`webhook.js`, `conversationEngine.js`, `sessionService.js`, `schemaAdapter.js`,
> `validateInitData.js`, etc.) and their tests **no longer exist on `main`**. Any
> part of this report that describes Telegram intake — its webhook, sessions,
> schema adapter, or "mostly working" status — is a point-in-time record only and
> does **not** reflect the current codebase. This note is scoped to Telegram
> *application intake in this repository*; it makes no claim about unrelated
> Telegram functionality that may still be active elsewhere in the wider SafeHaul
> ecosystem.

> **This document was newly created by this audit.** No earlier
> `FULL_APPLICATION_AUDIT_REPORT.md` existed. A separate, older
> `docs/PRODUCTION_AUDIT_REPORT.md` exists and was left untouched.

> **Nothing was changed except this report** *(as of the original audit,
> July 3, 2026)*. The audit itself was read-only. A follow-up remediation pass
> (below) was subsequently authorized and applied on the same branch.

---

## 0. Remediation status (Update: July 3, 2026)

After the read-only audit above, the owner authorized a phased fix of the
findings. The fixes were implemented, tested, and committed on this branch
(one commit per finding). **Public driver application links were explicitly
protected and verified end-to-end.** The two findings the owner asked to defer
were left untouched.

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| DEP-001 | Vulnerable `react-router-dom` + `nodemailer` | High | ✅ Fixed — upgraded to patched versions |
| SEC-002 | Any staff could read any driver/staff profile across companies | Medium | ✅ Fixed — same-company rule + server-maintained `companyIds` + super-admin backfill callable |
| FUNC-005 | Logged-in driver re-submit/edit rejected by rules (`createdAt`) | Medium | ✅ Fixed — create-safe merge; create-only fields never rewritten on update |
| SEC-003 | Recruiter links not bound to one company | Medium | ✅ Fixed — create/update bound to the link's company; `companyId` immutable |
| SEC-004 | Unauthenticated direct application creation allowed | Medium | ✅ Fixed — fallback rule removed (guest path uses the callable) |
| UI-006 | Recruiters could open admin Settings via direct URL | Medium/Low | ✅ Fixed — route guard mirroring the sidebar |
| **LEAD-UPLOAD** | *New bug found during remediation:* lead creation denied because clients never sent `companyId` | Medium | ✅ Fixed — root cause of "lead upload feels restricted" |
| STOR-007 | Uploaded file-type spoofing / SVG | Low/Medium | ⏸️ Intentionally deferred (owner instruction) |
| LOW-010 | Guest upload preview link relies on path secrecy | Low | ⏸️ Intentionally deferred (owner instruction) |

**Verification after fixes (all green):** build ✅ · lint ✅ (0 errors) ·
Firestore/Storage rules emulator **45 tests** (16 new security tests) ✅ ·
frontend unit **367** ✅ · Cloud Functions **312** ✅ · callable-contract 60 ✅ ·
Playwright e2e **21 specs** ✅ (guest + authenticated application, uploads,
e-signatures, PEV, campaigns). `npm audit` improved (root 44→42, functions
20→19). Typecheck holds at the pre-existing 10-error baseline (no new errors).

**⚠️ Required deploy order (SEC-002):** deploy the Cloud Functions first, run
the `backfillUserCompanyIds` callable (LIVE) as super admin, then deploy the
Firestore rules + hosting. Otherwise same-company teammate reads (lead
upload/assignment, team management) are denied until each user's next
membership write. **nodemailer 9** is a major bump — smoke-test a real SMTP
send in staging before production.

---

## 1. What this report is

SafeHaul is a website used by trucking companies to hire drivers. This report
is an independent inspection of the code behind that website. The goal is to
tell the owner, in plain language, what works, what does not, what might be
unsafe, and what can probably be cleaned up.

Where a technical word is unavoidable, it is explained right away.

Two words used throughout:

- **Firestore** — the online database that stores all the information.
- **Security rules** — the guard at the database door. It decides who is
  allowed to read or change each piece of information. This is the single most
  important safety mechanism in the whole system.

---

## 2. One-page summary

**Is the application generally healthy?**
Yes. This is a mature, carefully-built system. The most important safety
layer — the database guard — is strong, and it is backed by automated tests
that actually check that forbidden actions are blocked, not just that allowed
actions work. Nearly every server function that touches one company's data
first verifies the caller truly belongs to that company.

**Is it safe to use?**
Broadly yes, with a small number of things worth tightening. This audit did
**not** find a way for a stranger on the internet to steal another company's
private records or take over an account. It did find some narrower issues
(described below) that should be reviewed.

**The five biggest concerns**

1. **Outdated software libraries with known security holes.** The project
   depends on third-party code that has published vulnerabilities. Most are in
   "build tools" (used only by developers) and are low real-world risk, but two
   that ship to real users — the page-routing library and the email-sending
   library — should be updated and reviewed. *(DEP-001, High priority)*
2. **Any staff member can look up any driver's or any staff member's basic
   profile across all companies**, if they know the hidden internal ID. This
   exposes names, emails, phone numbers, and license details (but **not**
   Social Security Numbers, which are encrypted). *(SEC-002, Medium)*
3. **Recruiter "share links" are not locked to one company.** Any staff user
   could, in theory, overwrite another company's share link. *(SEC-003, Medium)*
4. **A logged-in driver who re-submits or edits an already-saved application
   may be blocked by the database guard**, because the guard's list of
   fields a driver may change is missing one automatic field the app always
   writes. First-time submissions are fine; retries/edits may fail.
   *(FUNC-005, Medium, suspected — not fully confirmed at runtime)*
5. **The "Settings" page is hidden from recruiters in the menu but not
   actually blocked** if they type the address directly. They can open the
   page, but the database still refuses to save their changes, so no data is
   exposed. *(UI-006, Low/Medium)*

**What appears to work well**

- The database guard (security rules) is strong, well-commented, and tested
  for **denied** access, not just allowed access.
- Server functions consistently verify company membership before acting.
- The public e-signature and employment-verification flows are hardened
  against tampering, replay, and double-submission.
- The public "company profile" shown to job seekers is a strict, curated copy
  that cannot leak private company fields.
- All automated tests pass: 308 server tests, 353 web tests, 29 security-rule
  tests. The site builds successfully.
- No passwords, keys, or secrets are stored in the code.
- The code is remarkably clean — essentially zero leftover "TODO/FIXME" notes.

**What should be fixed first**
Update the vulnerable third-party libraries (DEP-001), then review the
cross-company profile read (SEC-002) and the driver re-submission block
(FUNC-005).

---

## 3. Simple explanation of SafeHaul

**What it does.** SafeHaul helps trucking companies find, screen, hire, and
onboard commercial drivers. A driver fills out a long application; the company
reviews it, runs verifications, sends documents to sign, and tracks the driver
through the hiring pipeline. Companies can also run text-message and email
campaigns to reach potential drivers.

**Who uses it.**

- **Drivers** — fill out applications, upload their license and medical card,
  and sign documents.
- **Recruiters and HR staff** — review applications and leads, make calls, run
  campaigns, and manage documents.
- **Company administrators** — do everything recruiters do, plus manage the
  team, company settings, and integrations.
- **Super administrators** (the SafeHaul operators) — create and manage
  companies and see platform-wide information.
- **Members of the public** — job seekers applying through a public link,
  former employers responding to a verification request, and people signing a
  document through a secure link. None of these need an account.

**What information it stores.** Driver names, contact details, dates of birth,
driver's license and medical-card data, Social Security Numbers (stored
encrypted), employment history, uploaded documents, e-signatures, company
settings, message templates, and campaign records.

---

## 4. Overall scorecard

Ratings: **Working** · **Mostly working** · **Needs attention** · **Broken** ·
**Not enough evidence** · **Not currently used**

| Area | Rating | Notes |
|------|--------|-------|
| Login and user accounts | Working | Roles come from secure server-issued "claims," not editable by the user. |
| Driver application | Mostly working | Strong offline/retry design; but re-submit by a logged-in driver may be blocked (FUNC-005). |
| Company dashboard | Working | Data is company-scoped by rules. |
| Leads | Working | Company-scoped; status values validated by rules. |
| Campaigns | Working | Resilient batch/worker design with cancel protection; verified by tests. |
| SMS | Mostly working | Encrypted provider credentials; admin-only config; not sent live during audit. |
| Email | Mostly working | Passwords stored in an admin-only hidden area; nodemailer needs a security update (DEP-001). |
| E-Docs (documents) | Working | Template/field system with strict server checks. |
| Electronic signatures | Working | Constant-time token checks, double-submit protection, tamper-evident sealing. |
| Employment verification (PEV) | Working | Token-based, rate-limited, files kept private. |
| Telegram intake | Mostly working | Server-only sessions; webhook fails closed; bot token not yet configured (by design). |
| Super-admin tools | Working | Backfills/migrations are super-admin-only and rate-limited. |
| Firebase database permissions | Mostly working | Strong overall; two cross-company read/write gaps (SEC-002, SEC-003). |
| File permissions | Mostly working | Tenant-isolated; file-type is client-declared and spoofable (STOR-007). |
| Privacy | Mostly working | SSNs encrypted; public surface curated; some cross-company profile reads (SEC-002). |
| Reliability | Working | Idempotent triggers, retry queues, fail-closed rate limits. |
| Tests | Working | Meaningful, including denied-access security tests; all passing. |
| Documentation | Mostly working | Generally accurate and honest about gaps; README tech-stack list is stale. |
| Repository cleanliness | Working | Very clean; a few dead/duplicate shims. |

---

## 5. Critical problems

**None confirmed.**

This audit did not confirm any Critical issue — that is, no confirmed way for
someone to steal highly sensitive data, take over accounts, cross company
boundaries at will, send messages as another company, or destroy production
data. The strongest safety layers (database rules and server-side company
checks) held up under inspection and under the project's own security tests.

Two items below (SEC-002, SEC-003) are cross-company weaknesses but are rated
**Medium** because they require knowing a hidden internal ID and expose limited
information (no SSNs, no ability to read full private records).

---

## 6. High-priority problems

### DEP-001 — Outdated third-party libraries with known security holes
- **Severity:** High · **Confidence:** High (confirmed by `npm audit`)
- **Plain explanation:** The project reuses code written by others. Some of
  that borrowed code has publicly known security bugs. The automated scanner
  reports **44** issues in the website's libraries (3 critical, 21 high) and
  **20** in the server's libraries (4 high).
- **Who could be affected:** Mostly developers; in a few cases, real users.
- **What could happen:** Most flagged items are in *developer build tools*
  (`vitest`, `vite`, `rollup`, and the Firebase command-line tool's helpers
  such as `basic-ftp`, `tar`, `ws`). These do **not** ship to real users and
  are low real-world risk. **Two do reach real users and deserve attention:**
  - `react-router-dom` (the page-navigation library) — advisories about
    cross-site scripting and open redirects.
  - `nodemailer` (the email sender) — an advisory about "header injection,"
    where crafted input could tamper with email headers.
- **Evidence:** `npm audit` in the project root and in `functions/`;
  `package.json` (`react-router-dom ^7.9.6`) and `functions/package.json`
  (`nodemailer ^8.0.7`).
- **How to reproduce safely:** Run `npm audit` in the root folder and in
  `functions/`. No changes needed to observe.
- **Recommended fix:** Update `react-router-dom` and `nodemailer` first and
  test the app; then schedule updates for the build tools. Do this as its own
  change with the test suite as a safety net. **Do not** run `npm audit fix
  --force` blindly — it can introduce breaking changes.
- **Tests to add:** None specific; rely on the existing suites after upgrade.
- **Status:** Confirmed (that the libraries are outdated). Whether any hole is
  actually reachable in SafeHaul's specific usage was not separately confirmed.

---

## 7. Medium-priority problems

### SEC-002 — Any staff member can read any driver's or staff member's basic profile across all companies
- **Severity:** Medium · **Confidence:** High (read directly from the rules)
- **Plain explanation:** The database guard lets **any** logged-in staff user
  (recruiter, HR, or admin, from **any** company) fetch a single driver profile
  document or a single staff-user document — even one belonging to a completely
  different company — as long as they know that person's hidden internal ID.
- **Who could be affected:** Drivers and staff of every company on the platform.
- **What could happen:** A recruiter at Company A could look up the name,
  email, phone number, and license details of a driver or staff member tied
  only to Company B. Social Security Numbers are **not** exposed here because
  they are stored encrypted. Full private application records are **not**
  exposed by this rule.
- **Why it is only Medium:** The internal ID is a long, non-guessable value, so
  this is not a mass-download hole — it is a targeted-lookup exposure. The code
  comment even acknowledges the trade-off ("get (single doc) still allowed for
  staff — needed for application detail views").
- **Evidence:**
  - `src/firestore.rules:450` — `allow get: if isOwner(driverId) ||
    isSuperAdmin() || isStaff();` on `drivers/{driverId}`.
  - `src/firestore.rules:463` — `allow read: if isOwner(userId) ||
    isSuperAdmin() || (isSignedIn() && isStaff());` on `users/{userId}`.
  - `isStaff()` (`src/firestore.rules:64`) is true for **any** user who has a
    role at **any** company.
- **How to reproduce safely:** In the rules emulator, sign in as a user whose
  only role is at Company A and `get` a `drivers/<uid>` document whose driver
  belongs only to Company B. It succeeds today.
- **Recommended fix:** Restrict the driver/user single-document read to the
  owner, super admin, and staff **who share a company with that person** (for
  example, staff of a company where the driver has an application). If the
  cross-company `get` is genuinely required for a feature, document exactly
  which feature and consider routing it through a server function that checks
  the relationship.
- **Tests to add:** A rule test that a Company-A recruiter is **denied** `get`
  on a Company-B-only driver and a Company-B-only user.

### SEC-003 — Recruiter share links are not locked to a single company
- **Severity:** Medium · **Confidence:** High (read directly from the rules)
- **Plain explanation:** "Recruiter links" are short public codes that route a
  driver to a specific recruiter. The guard lets **any** staff user create or
  overwrite **any** link code, with no check that the code belongs to their
  company.
- **Who could be affected:** Companies whose share links could be overwritten.
- **What could happen:** A staff user at one company could overwrite or hijack
  another company's link (if they know or guess the code), redirecting or
  breaking that company's recruiting funnel. The codes are also world-readable
  by design (needed to resolve them).
- **Evidence:** `src/firestore.rules:514-518` —
  `allow read: if true;` and `allow create, update: if isStaff() ||
  isSuperAdmin();` on `recruiter_links/{code}`, with no company binding.
- **How to reproduce safely:** In the emulator, sign in as any staff user and
  `set` a `recruiter_links/<code>` document — it is allowed regardless of which
  company the code belongs to.
- **Recommended fix:** Store the owning `companyId` on each link and require
  `isCompanyTeam(companyId)` for create/update, plus block changing the
  `companyId` after creation.
- **Tests to add:** A rule test that staff of Company A cannot create/overwrite
  a link owned by Company B.

### SEC-004 — Database rules permit unauthenticated creation of application records (an unused fallback path)
- **Severity:** Medium · **Confidence:** High (rules) / impact Low–Medium
- **Plain explanation:** The guard allows a **not-logged-in** visitor to create
  an application document directly, as long as the document ID matches the
  applicant field and the company ID matches the path. The real app does **not**
  use this path — public applications go through the `submitGuestApplication`
  server function, which is rate-limited and sanitizes input. The direct rule
  is a leftover "fallback."
- **Who could be affected:** Companies could receive spam/junk applications.
- **What could happen:** An automated script could create many junk application
  documents (varying the email/phone to make each ID unique), cluttering a
  company's pipeline. The guest-create path also does not restrict the `status`
  field, so a junk record could be labeled, e.g., "Hired."
- **Evidence:** `src/firestore.rules:366-367` (guest create branch);
  `isValidGuestApplication` (`:183`) only checks companyId + a non-empty
  applicant string. Real submission path: `src/hooks/useSubmissionQueue.js:86`
  and `PublicApplyHandler.jsx:660` both call the `submitGuestApplication`
  callable instead.
- **How to reproduce safely:** In the emulator, as an unauthenticated user,
  create `companies/<id>/applications/<deterministicId>` with matching fields —
  it succeeds.
- **Recommended fix:** Since the app relies on the server function, consider
  removing the unauthenticated direct-create branch (or tightening it to reject
  a client-chosen `status` and require the deterministic-ID shape the server
  produces). Confirm no legacy client still depends on it first.
- **Tests to add:** A rule test asserting an unauthenticated client **cannot**
  create an application, if the fallback is removed.

### FUNC-005 — A logged-in driver's re-submission or edit may be blocked by the rules
- **Severity:** Medium · **Confidence:** Medium (traced in code; not confirmed
  at runtime)
- **Plain explanation:** When a driver submits an application, the app writes
  the record and always stamps a `createdAt` time. The database guard has a
  strict list of fields a driver is allowed to change on an existing
  application — and that list does **not** include `createdAt`. On a
  first-time submission (a brand-new record) there is no field restriction, so
  it works. But on a **re-submission** (a retry after a dropped network
  response, an offline-queue replay, or an edit), the write becomes an *update*
  of an existing record, and because it re-stamps `createdAt`, the guard
  rejects the whole write.
- **Who could be affected:** Drivers on flaky connections (the exact audience
  the "bulletproof" retry system was built for) and any driver editing a saved
  application.
- **What could happen:** The driver sees a "submission failed" error even
  though the data may already be saved, or an edit silently fails to save.
- **Evidence:**
  - Allowed-field list `applicationDriverSelfUpdateAllowedKeys()` includes
    `submittedAt` and `updatedAt` but **not** `createdAt`
    (`src/firestore.rules:71-90`).
  - The submit payload always re-writes `createdAt: serverTimestamp()`
    (`src/features/driver-app/services/driverService.js:415`), and uses
    `setDoc(..., { merge: true })` (`:418`), which becomes an *update* when the
    record already exists.
  - The offline-queue replay for authenticated submissions also uses
    `setDoc(..., { merge: true })` (`src/hooks/useSubmissionQueue.js:117-129`).
  - The existing rule test only exercises a tiny two-field update
    (`src/tests/firestore.rules.security.test.js:60`), so the full-payload
    re-submit case is not covered.
- **How to reproduce safely:** In the emulator, create an application as the
  driver, then have the same driver `setDoc(..., {merge:true})` the same
  payload again (including `createdAt: serverTimestamp()`). The second write
  should be denied.
- **Recommended fix:** Either add `createdAt` (and any other always-written
  system fields the driver legitimately re-sends) to the driver self-update
  allow-list, **or** stop re-writing `createdAt` on merge updates (write it only
  on first create). The second option is safer.
- **Tests to add:** A rule test for a driver re-submitting the full application
  payload to an existing record.

### UI-006 — "Admin-only" menu items are hidden but not blocked by the route
- **Severity:** Medium/Low · **Confidence:** High
- **Plain explanation:** Some menu items (notably **Settings**) are marked
  "admin only" and hidden from recruiters in the sidebar. But the page itself is
  registered for all company roles, so a recruiter who types the address
  (`/company/settings`) can open the page. The database still refuses to save
  changes they are not allowed to make, so **no private data is exposed and no
  unauthorized change succeeds** — this is a presentation gap, not a data
  breach.
- **Evidence:** `src/app/routes/companyRouteManifest.js:100` marks Settings
  `adminOnly` in **nav only**; `src/App.jsx:124-153` mounts company child
  routes with the workspace role guard (which includes `recruiter`) and no
  per-item admin check. Sidebar hiding is in `CompanySidebar.jsx` (documented
  in `docs/feature-flags.md`).
- **How to reproduce safely:** Sign in as a recruiter and navigate directly to
  `/company/settings`. The page loads; saving is blocked by rules.
- **Recommended fix:** Add an admin-role check to the Settings route (and any
  other `adminOnly` route) so lower roles are redirected, matching the menu.
- **Tests to add:** A UI/routing test that a recruiter is redirected away from
  `/company/settings`.

---

## 8. Low-priority improvements

### STOR-007 — Uploaded file type is client-declared and can be faked; SVG images allowed
- **Severity:** Low/Medium · **Confidence:** Medium
- **Plain explanation:** File uploads are limited to "PDF or image." But the
  file's declared type is metadata the uploader controls, so a determined user
  could label a non-image as an image. The image rule also allows SVG, a format
  that can contain scripts.
- **What could happen:** A disguised or SVG file could be stored; if later
  opened in a browser in a way that runs it, it could execute scripts
  (cross-site scripting). Guest uploads also have no per-file limit, so a script
  could waste storage.
- **Evidence:** `src/storage.rules:46-50` (`isValidFile()` checks only declared
  `contentType`); guest create at `src/storage.rules:69-76` is unauthenticated.
- **Recommended fix:** Serve user files with a "download, don't render" header
  (`Content-Disposition: attachment`), reject `image/svg+xml`, and consider
  server-side content sniffing for high-value paths.

### LOW-008 — Type-checking reports 10 errors (non-blocking)
- The optional type-check (`npm run typecheck`) fails with 10 errors, including
  one "invalid character" caused by an em-dash inside a code comment
  (`src/shared/services/fmcsaEmployerSocrata.js:161`). This check is
  intentionally **non-blocking** in CI (a "ratchet" baseline), so it does not
  stop releases. Worth cleaning up over time. *(Confidence: High.)*

### LOW-009 — Large JavaScript bundles
- The production build succeeds but warns that several bundles exceed 500 KB
  (largest: the main app bundle ~587 KB, the driver-profile modal ~479 KB).
  This slows first load, especially on mobile. Consider code-splitting.
  *(Evidence: build output; Confidence: High.)*

### LOW-010 — Unauthenticated preview link relies on path secrecy
- `getSignedGuestUploadUrl` (`functions/getSignedGuestUploadUrl.js`) hands out a
  temporary read link for a guest-uploaded file **without requiring login**,
  protected only by path-format checks, a rate limit, and the fact that the
  file path is hard to guess (it embeds a timestamp plus `Math.random()`).
  `Math.random()` is not a cryptographically strong source. The practical risk
  is low (paths are long and rate-limited), but this is "security by
  obscurity." Consider requiring the guest's session token or using a stronger
  random component. *(Confidence: Medium.)*

---

## 9. Firebase permission report (in plain language)

### The roles

| Role | Who they are |
|------|--------------|
| **Guest** | A visitor with no account (applicant, document signer, former employer). |
| **Driver** | A logged-in commercial driver. |
| **Recruiter / HR user** | Company staff who work leads and applications. |
| **Company administrator** | Company staff who also manage the team, settings, and integrations. |
| **Super administrator** | SafeHaul operators with platform-wide control. |

Roles are decided by **server-issued claims** — a tamper-proof stamp Firebase
puts inside the user's login token. A user **cannot** edit their own role by
editing a database document; the rules read the claim, not the document. This
is the correct, secure design. *(Evidence: `functions/hrAdmin.js`
`onMembershipWrite`; `src/context/dataContext/claims.js`.)*

### What each role can do (summary)

- **Guest:** Submit a public application (through a rate-limited server
  function), view a company's **public** profile (a curated, safe copy), sign a
  document via a secure token link, and respond to an employment-verification
  token. Guests cannot read private company or driver records.
- **Driver:** Read and update **their own** application (limited fields), read
  and write **their own** driver profile and drafts, and respond to offers.
  They cannot change their assigned recruiter, company, or hiring status (only
  accept/decline an offer), and cannot delete their application.
- **Recruiter / HR:** Read and write leads and applications **within their own
  company**, run campaigns, create documents/templates, and set pipeline
  statuses (validated against an allowed list). They cannot change company
  settings, manage the team, or create administrators.
- **Company admin:** Everything a recruiter can do, plus manage the team,
  settings, integrations, and delete applications — **within their own
  company**. They cannot touch another company, and cannot create a super
  administrator.
- **Super admin:** Full platform control, including creating/deleting companies
  and running maintenance jobs (which are rate-limited).

### Confirmed strengths (privilege-escalation blocked)

- A company admin **cannot** create a super administrator — blocked in both the
  server function (`hrAdmin.js:27-29`) and the rules
  (`firestore.rules:477`, `role != 'super_admin'`).
- A recruiter **cannot** promote themselves — creating team members and
  memberships requires an admin claim (`hrAdmin.js:31-35`;
  `firestore.rules:477`).
- A company admin **cannot** edit a user who is not in their company — an
  explicit cross-company check exists (`hrAdmin.js:307-329`, "BUG-11 FIX").
- The company ID on applications and leads is **path-bound and immutable** — a
  driver or recruiter cannot move a record to another company
  (`firestore.rules:381`, `:415`, tested at
  `firestore.rules.security.test.js:356`).
- Server-only collections (`telegram_sessions`, `verification_requests`,
  `change_reviews`, `rate_limits`, `processing_status`, `integrations_index`)
  are **denied to all clients**, including super admins, and this is tested
  (`firestore.rules.security.test.js:283`, `:330`).
- The e-signature access token was moved out of the readable document into a
  secrets sub-area that **no client can read** (tested at `:215`).

### Confirmed vulnerabilities / weaknesses
- **SEC-002** (Medium) — cross-company single-profile reads for any staff.
- **SEC-003** (Medium) — recruiter links not company-bound.
- **SEC-004** (Medium) — unauthenticated direct application creation allowed.

### Missing security tests (see Section 19)
- Cross-company driver/user profile read should be tested as **denied**.
- Recruiter-link cross-company write should be tested as **denied**.
- Driver full-payload re-submission should be tested (FUNC-005).
- Company list restricted to super admin; guest cannot read a private company
  document — currently relied upon but not explicitly asserted.

### Legitimate actions currently blocked by the rules
- **FUNC-005** — a logged-in driver re-submitting/editing an application is
  likely blocked by the `createdAt` field not being on the allow-list. This is
  a rule blocking a legitimate product action.

---

## 10. Feature-by-feature report

For each: what it should do · what was inspected · evidence · works · broken ·
not verified · next action.

### Login & accounts
- **Should:** Authenticate users and assign the right role/portal.
- **Inspected:** `DataContext.jsx`, `claims.js`, `hrAdmin.js`, login screen.
- **Evidence:** Roles derived from secure claims; dual driver+staff users get a
  portal chooser; logout clears state.
- **Works:** Role derivation, portal switching, super-admin detection.
- **Not verified:** Password-reset email delivery (not triggered — would send a
  real email).
- **Next action:** None urgent.

### Driver application
- **Should:** Let drivers (and guests) submit a DOT-compliant application with
  uploads and a signature, safely and without duplicates.
- **Inspected:** `driverService.js`, `PublicApplyHandler.jsx`, wizard steps,
  `submissionQueue.js`, `guestApplication.js`, rules.
- **Evidence:** Deterministic IDs prevent duplicates; offline queue with
  retries; guest path uses the rate-limited server function; `merge:true`
  protects recruiter notes.
- **Works:** First-time submission (guest and authenticated), duplicate
  prevention, offline queueing.
- **Broken/suspected:** Re-submission/edit by a logged-in driver may be blocked
  by rules (FUNC-005).
- **Next action:** Fix FUNC-005 and add a re-submit rule test.

### Company dashboard, Leads, Search
- **Inspected:** company-admin views, `companyRouteManifest.js`, rules.
- **Evidence:** Reads/writes are company-scoped; lead status validated by rules;
  cross-company lead creation blocked (tested).
- **Works:** Scoping and status validation.
- **Note:** "Search drivers" is gated by the `searchDB` feature flag on both
  the menu and the page.

### Campaigns, SMS, Email
- **Inspected:** `bulkActions/*`, `integrations/*`, `emailService.js`,
  `saveEmailSettings.js`, and their tests.
- **Evidence:** Encrypted provider credentials; admin-only configuration;
  "zombie worker" cancellation checks; email password stored in an admin-only
  sub-area and never returned to the browser; 60 server tests specific to bulk
  actions/SMS pass.
- **Works (by tests):** Session building, cancellation safety, phone
  normalization, fallback number logic.
- **Not verified:** Live send (intentionally not performed).
- **Next action:** Apply the `nodemailer` security update (DEP-001).

### E-Docs & electronic signatures
- **Inspected:** `publicSigning.js`, `digitalSealing.js`, `getSigningLink.js`,
  signing UI, rules, tests.
- **Evidence:** Constant-time token comparison; transactional double-submit
  protection; required-field validation; server-set signer IP; token
  invalidation after signing; voided/expired blocked server-side; tamper-evident
  sealing; access token unreadable by clients.
- **Works:** The full draft → sent → processing → pending_seal → signed flow is
  well-guarded. A separate nightly job cleans up orphaned signature images.
- **Not verified:** Visual PDF fidelity across screen sizes (would need a live
  browser session with real templates).

### Employment verification (PEV)
- **Inspected:** `employmentVerification.js`, `getSignedPevUrl.js`, PEV UI.
- **Evidence:** Token-based public access, rate-limited; result files require a
  server-issued signed link that checks company membership and the PEV path.
- **Works:** Token flow, private result files, company access checks.
- **Not verified:** Reminder scheduling behavior over time (not run live).

### Telegram intake
- **Inspected:** `telegram/webhook.js`, `telegram/*`, rules.
- **Evidence:** Webhook rejects requests unless a secret matches (fails closed,
  constant-time); missing bot token is handled gracefully; sessions are
  server-only.
- **Works:** Security posture is sound.
- **Not verified:** End-to-end conversation (bot token not configured — by
  design, per README).

### Super-admin tools
- **Inspected:** `systemIntegrity.js`, `statsBackfill.js`, `companyAdmin.js`.
- **Evidence:** All backfills/migrations require the super-admin claim and are
  rate-limited.
- **Works:** Authorization is correct.
- **Note:** `systemIntegrity` repairs a top-level `leads` collection that does
  not exist (leads live under each company) — harmless dead branch.

---

## 11. Test results

All commands were run during this audit. Times are approximate.

| Command | Result | Plain-language meaning |
|---------|--------|------------------------|
| `cd functions && npm test` (Jest) | **PASS** — 59 suites, 308 tests | All server-side unit tests pass. |
| `npx vitest --run` (web unit tests) | **PASS** — 353 passed, 29 skipped | All web tests pass; the 29 "skipped" are the security-rule tests, which run separately with the database emulator. |
| `npm run build` | **PASS** (with large-bundle warnings) | The website compiles for production. |
| `npm run lint` | **PASS** — 0 errors, 203 warnings | Code style is clean; warnings are mostly unused variables in tests. |
| `npm run typecheck` | **FAIL** — 10 errors | Optional type-check baseline; intentionally non-blocking in CI. See LOW-008. |
| `npm run test:rules:emulators` (rules) | **PASS** — 29 tests (13 database + 16 storage) | The security rules were tested against a real database emulator, including **denied**-access cases. |
| `node scripts/check-callable-contract.mjs` | **PASS** — 60 callables verified | Every server function the website calls actually exists (no broken links between front and back end). |
| `npm audit` (root) | 44 issues (3 critical, 21 high) | Vulnerable libraries; mostly developer build tools. See DEP-001. |
| `npm audit` (functions) | 20 issues (4 high) | Vulnerable server libraries, incl. `nodemailer`. See DEP-001. |

**What the numbers mean:** The suites that verify behavior all pass, and the
security tests specifically check that forbidden actions are refused. The two
"failures" are: (a) an optional type-check that the team deliberately treats as
non-blocking, and (b) the dependency scanner, which flags libraries to update
rather than bugs in SafeHaul's own code.

---

## 12. Unused / duplicated / potentially deletable code

| File or code | Why it may be unused | Confidence | Risk if removed | Recommendation |
|--------------|----------------------|------------|-----------------|----------------|
| `src/features/driver-app/components/DriverApplicationWizard.jsx` | 7-line backward-compatibility re-export; no code imports this path (the real one is `.../application/DriverApplicationWizard.jsx`). | Probably unused | Low — only breaks if an unseen import uses the old path. | Safe to remove after a final repo-wide import search; harmless to keep. |
| `functions/systemIntegrity.js` — `repairCollection("leads", ...)` branch | Scans a top-level `leads` collection that does not exist (leads live under each company). | Confirmed dead branch | Low | Remove the branch or repoint it to company subcollections. |
| `functions/companyAdmin.js` — `runMigration` | Explicitly a "no-op" kept only as a ping/diagnostic. | Legacy but still wired | Low | Keep as a diagnostic, or retire if unused by ops. |
| `functions/migrateEmailSettings.js` | One-time migration of email settings; likely already run in production. | Legacy but still wired | Medium — removing a migration others may re-run is risky. | Keep until confirmed complete in production, then retire. |
| `README.md` tech-stack claims (Framer Motion, TipTap) | Listed as dependencies but **not** present in `package.json`. | Confirmed stale text | None (docs only) | Correct the README. |

No large blocks of commented-out code, no leftover debugging code, and
essentially **zero** `TODO/FIXME/HACK` markers were found (the only matches
were `XXX-XX-XXXX` SSN placeholders). This is an unusually clean repository.

---

## 13. Possible deletion candidates

**No files were deleted during this audit.**

The only genuinely safe deletion candidate is the 7-line re-export shim
`src/features/driver-app/components/DriverApplicationWizard.jsx` (see Section
12). Even that should get one more repo-wide import check first. Everything
else classified as "legacy" is still wired into exports or migrations and
should **not** be deleted without operational confirmation.

---

## 14. Outdated dependencies and code

**Classification of dependency findings:**

- **Security upgrade needed (reaches real users):** `react-router-dom`,
  `nodemailer`. *(Do first, with tests.)*
- **Security upgrade needed (developer tools only, low real-world risk):**
  `vite`, `vitest`, `@vitest/coverage-v8`, `rollup`, and Firebase CLI
  transitive helpers (`basic-ftp`, `tar`, `ws`, `@grpc/grpc-js`, `protobufjs`,
  `form-data`, `path-to-regexp`, etc.).
- **Normal maintenance:** `firebase-admin`/`firebase-functions` are recent;
  keeping them current will clear several transitive advisories.
- **Version/label mismatches (documentation):** README lists `nodemailer 7.0`
  but the code uses `8.x`; README lists Framer Motion and TipTap, which are not
  installed; README says "40+ Cloud Functions" while the registry exports 103.

**Outdated implementation patterns:**
- The code mixes Firebase Functions "v1" and "v2" styles. This is intentional
  and documented (`ARCHITECTURE.md`), production-stable, and not urgent.
- `functions` targets Node 20 (declared), while this audit ran on Node 22 for
  tests. Deployments still target Node 20; keep the declared engine aligned
  with the deploy runtime.

*(No dependencies were updated during this audit.)*

---

## 15. Documentation problems

- **Correct and impressive:** `docs/feature-flags.md` and
  `docs/security-posture.md` are accurate and, importantly, **honest about
  gaps** (e.g., they state plainly that the `driverApp` flag is not enforced on
  the public apply page — which matches the code). `ARCHITECTURE.md` matches the
  implemented patterns.
- **Outdated / misleading (Low):**
  - `README.md` "Tech Stack" lists **Framer Motion** and **TipTap**, which are
    not in `package.json`.
  - `README.md` names Cloud Functions `setUserRole`, `addTeamMember`,
    `createCompany` that are **not** exported anywhere.
  - `README.md` "Known Issues & Audit Findings" states *"All identified issues
    have been resolved"* (dated March 4, 2026). Documentation should never be
    treated as proof of correctness; this audit found several open items above.
  - Minor version drift (`nodemailer`, function count).
- **Recommendation:** Refresh the README tech stack and function list; soften
  the "all resolved" claim to reference the dated audit only.

---

## 16. Privacy and sensitive-data findings

- **Good:** Social Security Numbers are **encrypted** before being stored in
  driver profiles (`driverSync.js:103`, using a server-only key). The
  public-facing company profile is a strict allow-list copy that cannot leak
  private company fields or feature flags (`publicProfileDto.js`). Email
  passwords are stored in an admin-only sub-area and are never returned to the
  browser (`getEmailSettingsMeta.js`, `saveEmailSettings.js`). Server logs and
  error messages are scrubbed and avoid leaking secrets/PII in the paths
  reviewed.
- **Needs attention:** Cross-company reads of basic driver/staff profiles
  (SEC-002) expose names, emails, phones, and license details (not SSNs).
- **Note:** Application documents contain sensitive data and are correctly
  restricted to the owning company's team and the driver; guest-uploaded files
  are re-signed at view time through server functions that verify company
  access.

---

## 17. Performance and scaling findings

- **Large web bundles** (LOW-009) slow first load; code-splitting recommended.
- **Feature scheduler** scans *all* companies every 15 minutes
  (`featureScheduler.js`); fine at current scale, would need indexing at large
  tenant counts (already noted in the docs).
- **Backfill/stats jobs** stream documents and batch writes to avoid memory
  problems — good practice for large datasets.
- **Bulk campaigns** use a small-batch recursive worker to avoid timeouts, with
  cancellation double-checks — a solid design for scale.

---

## 18. Recommended fix order

**Fix immediately (before next release)**
1. **DEP-001** — Update `react-router-dom` and `nodemailer`; re-run the test
   suite.

**Fix before the next production release**
2. **SEC-002** — Lock down cross-company driver/user single-profile reads.
3. **FUNC-005** — Stop the driver re-submission block (don't re-write
   `createdAt` on merge, or add it to the allow-list) and add a test.
4. **SEC-003** — Bind recruiter links to a company.

**Fix soon**
5. **SEC-004** — Remove or tighten the unauthenticated application-create
   fallback.
6. **UI-006** — Add an admin route guard for Settings (and other admin-only
   pages).
7. **STOR-007** — Serve user files as downloads; reject SVG; consider content
   sniffing.

**Cleanup when time permits**
8. Update the remaining (developer-tool) vulnerable libraries.
9. Fix the README tech-stack/function-list drift and the "all resolved" claim.
10. Remove the dead re-export shim and the dead `leads` repair branch.
11. Clear the 10 type-check errors; address large-bundle warnings.

---

## 19. Missing-test plan (ordered by risk)

1. **Cross-company profile read is denied (SEC-002).** Assert a Company-A
   recruiter cannot `get` a Company-B-only driver or user document. *(High risk,
   easy to add — the rules test harness already exists.)*
2. **Driver full-payload re-submission (FUNC-005).** Assert the intended
   behavior — re-submitting an existing application should succeed (after the
   fix). *(High risk.)*
3. **Recruiter-link cross-company write is denied (SEC-003).** *(Medium.)*
4. **Guest cannot read a private company document; company list is
   super-admin-only.** Explicitly assert scenarios currently only relied upon.
   *(Medium.)*
5. **Admin-only route guard (UI-006).** A routing test that a recruiter is
   redirected from `/company/settings`. *(Medium.)*
6. **End-to-end coverage gaps.** The Playwright suite covers guest apply,
   authenticated apply, campaigns, e-docs, PEV, and access control. Consider
   adding: driver *edit/re-submit*, and a super-admin company-create/delete
   journey. *(Medium.)*

Note on test quality: the existing tests are **meaningful** — server tests
exercise real logic (auth checks, phone normalization, sealing, cancellation),
and the rule tests check **denied** access, not just success. They are not
"render-only" placeholders. The main gap is negative tests for the specific
cross-company reads above.

---

## 20. Technical evidence appendix

**Security rules**
- Cross-company profile reads: `src/firestore.rules:450` (drivers `get`),
  `:463` (users `read`), helper `isStaff()` `:64`.
- Recruiter links: `src/firestore.rules:514-518`.
- Guest application create fallback: `:183-199`, `:366-367`.
- Driver self-update allow-list (missing `createdAt`): `:71-95`.
- Company ID immutability: `:381`, `:415`; tested `firestore.rules.security.test.js:356`.
- Server-only collections: `:213-236`, `:503-505`; tested `:283`, `:330`.
- Signing-request secrets unreadable: `:354-357`; tested `:215`.

**Cloud Functions**
- Robust company-access helpers: `functions/shared/companyAccess.js:26`
  (`assertCompanyAccess`), `:82` (`assertCompanyAdminStrict`).
- Signed-URL functions bind companyId to the path:
  `getSignedDocumentUrl.js:35-43`, `getSignedPevUrl.js:35-49`,
  `getSignedApplicationFileUrl.js:41-57`.
- Public signing hardening: `publicSigning.js:9` (constant-time compare),
  `:169-198` (transaction), `:151` (fail-closed rate limit).
- Telegram webhook fail-closed secret: `functions/telegram/webhook.js:21-33`.
- Super-admin-only backfills: `statsBackfill.js:205`, `:234`;
  `companyAdmin.js:30`, `:156`, `:188`; `systemIntegrity.js:76`, `:164`.
- Privilege-escalation blocks: `hrAdmin.js:27-39`, `:307-329`.
- SSN encryption on sync: `driverSync.js:103`.
- Public profile allow-list: `functions/shared/publicProfileDto.js`.
- Driver merge re-write of `createdAt`: `driverService.js:415-418`;
  authenticated queue replay `useSubmissionQueue.js:117-129`.

**Frontend / routing**
- Route guards: `src/App.jsx:55-61` (`ProtectedRoute`), `:32-46`
  (`RootRedirect`).
- Role source (secure claims): `src/context/dataContext/claims.js`;
  `DataContext.jsx:189-278`.
- E2E mock-auth gated by build-time flag (not reachable in normal production):
  `src/lib/runtime/e2eMode.js:1`; `src/lib/firebase/config.js` fails closed in
  production.
- Feature registry maps every route to a real component:
  `src/app/routes/featureRegistry.jsx`.

**Commands run (with results in Section 11):** `npm test` (functions),
`npx vitest --run`, `npm run build`, `npm run lint`, `npm run typecheck`,
`npm run test:rules:emulators`, `node scripts/check-callable-contract.mjs`,
`npm audit` (root and functions), plus targeted `grep` searches for secrets,
TODO markers, and unused imports.

**Confidence levels** are stated on each finding: High = confirmed by code,
tests, or safe reproduction; Medium = strong code evidence without full runtime
confirmation; Low = a concern needing more investigation.

---

## Honesty note

Several important paths could not be exercised end-to-end in this audit,
because doing so would require live credentials, real external services, or
would risk sending real messages:

- Live SMS/email delivery (RingCentral, 8x8, SMTP) — **not sent**.
- The Telegram bot conversation — bot token not configured (by design).
- Real Facebook Lead Ads ingestion, Groq CDL parsing, and FMCSA lookups —
  **not called** to avoid using paid/live services.
- Visual PDF/signature fidelity across devices — needs a live browser session
  with real templates.

For each of these, the **code and its authorization checks were inspected** and
appear correct, but this report says **"not enough evidence to confirm end to
end"** rather than "this works," in keeping with the audit's honesty rule.
