# SafeHaul — App Brief

**The single orientation document for this application.** Read it before you
change anything; update it when your change makes part of it untrue. It says
what the application is and why it behaves the way it does — how it works now,
not every file. Deep detail lives in the runbooks under [`docs/`](.); the
history behind these rules — findings, incidents, measurements, review rounds —
is in
[`docs/archive/app-brief-2026-10-02.md`](./archive/app-brief-2026-10-02.md).

Condensed on 2026-10-02 from that full text and re-checked against the code; the
code is the source of truth wherever the two disagree.

---

## ⚠️ Permanent rule: this brief is a living document

**Every AI coding agent must follow this rule; it is not optional and does not
expire.**

1. **Before changing anything,** read the sections your task touches and verify
   them against the code — the code is the source of truth; fix any drift as
   part of the task.
2. **After any meaningful change** (feature, fix, removal, behavior,
   integration, workflow, permission or schedule change), review the brief again
   and, in the same commit, **update** what your work made inaccurate, **add**
   new important behavior, rules, dependencies, integrations, jobs, permissions,
   intentional exceptions and preserved decisions, and **remove** what is
   retired or no longer true.
3. **A task is not complete while this brief and the application disagree.**
4. **Not here:** minor implementation detail, file-by-file inventories, function
   signatures, or anything learned faster from the code. Add only what prevents
   a misunderstanding; keep it accurate, useful and concise.

---

## 1. App purpose

SafeHaul is a **multi-tenant SaaS platform for US trucking carriers** that turns
driver hiring into **one structured, defensible record per driver**: the
application, qualification documents, signed paperwork and verified
previous-employment history, kept against the same driver in one system instead
of scattered across an ATS, an e-signature tool, an inbox and a filing cabinet,
where months later it no longer holds together.

Two consequences shape most design decisions:

- **The record must survive.** What a driver saw, answered and signed is frozen
  at submission and never re-derived from live data (§5).
- **The application must not be lost.** Drivers apply on phones on bad
  connections; submission is idempotent and offline-tolerant (§5).

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
| Cloud Functions | `functions/` | Node 22 (Google decommissions Node 20 on 2026-10-30), **mixed v1 and v2** (both production-stable; full v2 migration planned, not urgent) |
| Firestore rules | `src/firestore.rules` | Deployed from here, not the repo root |
| Storage rules | `src/storage.rules` | |
| Public site | `web/` | Hand-written CSS, **no build step, no framework**. Serves the server-rendered blog's assets and a standalone privacy page, and redirects `/` to `/news`. The `landing/` marketing site was removed; see [`DESIGN.md`](../DESIGN.md) |
| Design system | `src/design-system/` | Business-neutral visual contract; see §11 |

**Three communication patterns**, used deliberately: (1) **direct Firestore
SDK** (`onSnapshot` / `getDocs`) for dashboards, lists and most CRUD, secured by
rules; (2) **callable Cloud Functions** for anything rules cannot express —
guest intake, third-party APIs, credential handling, cross-tenant admin work;
(3) **Firestore triggers + scheduled jobs** for stats, PDFs, notifications and
maintenance (§8).

Routing is **manifest-driven**, not hand-edited JSX:
`src/app/routes/appRouteManifest.js` (public + top-level protected) and
`src/app/routes/companyRouteManifest.js` (company workspace **and** its sidebar
— one source of truth, so they cannot drift). Add routes there, not in
`App.jsx`.

### Public (unauthenticated) routes

`/apply/:slug` · `/interest/:slug` (legacy redirect to apply) ·
`/sign/:companyId/:requestId` · `/verify/:token` · `/review-change/:token` ·
`/sandbox/apply` · `/sandbox/transfer-success`

### Company workspace (`/company/*`)

`dashboard` · `drivers/applications` · `drivers/unfinished` ·
`drivers/leads/company` · `drivers/leads/my` · `campaigns` · `e-docs` ·
`import-leads` (admin) · `quick-add-lead` (admin) · `profile` · `settings`
(admin)

`drivers/start-application` has no sidebar item and redirects to
`drivers/unfinished` with its query string intact. Unknown `/company/*` paths
redirect to the dashboard rather than rendering an empty shell.

---

## 4. Main features and workflows

**Driver application intake.** `/apply/:slug` resolves a company via the
sanitized `public_profiles/{companyId}` mirror. The driver chooses CDL photo
auto-fill or manual entry, then a 9-step wizard (Contact → Qualifications →
License → Violations → Accidents → Employment → General → Review → Consent) over
the canonical sections in `functions/shared/applicationSections.json`.
Submission goes through the `submitGuestApplication` callable (Admin SDK), not a
client write.

**Fewer taps.** Only the applicant's own page-1 fields carry autofill tokens;
SSN and ZIP open the number pad, and the SSN stays masked. The SSN, previous
addresses, employers and the FMCSA lookup set `autocomplete="off"`, a request
that some browsers and password managers ignore, not a guarantee.
The auto-fill CDL photo is the CDL front, even when unreadable, unless the company
hides that upload (then it is read, not stored); the AI fills only empty fields.
Continue on a page opened by Edit on Review returns to Review; the submission
pre-flight and the server still check the whole application. The date of birth is
typed on the number pad; employment and school dates are a month and a year
(`YYYY-MM`, as on FMCSA's form), and every reader still accepts older full dates.

**The company shapes what the wizard asks, without code.** Company Settings →
Company Profile has five tabs: *Standard Questions* (show / hide / require the
DOT questions), *Application Rules* (§5), *Custom Questions*, *Agreements*
(versioned legal wording) and *Integrations* (optional PSP-report and MVR
import). Qualifications asks 49 CFR 40.25(j)'s drug and alcohol question
(pre-employment, past two years), kept apart from the broader one it replaced
(Production asks it until promoted); a draft lacking its answer goes back there.
Violations carries the one **MVR authorization** question (a versioned agreement
answered Yes/No); a Yes/No question precedes the moving-violations and the
accidents lists; Employment can offer PSP-report import and License MVR import,
both only *suggesting* entries accepted one by one (§10); General can carry an
optional **Hours of Service statement** (last seven days, last relieved).

**Progress survives from the first page.** Every forward step writes a local
copy synchronously and a server draft in the background, so a closed tab, a
dropped connection, a failed CDL scan or a page error costs nothing typed.
Drafts live in their own server-only collection (§5).

**Returning applicants are offered their unfinished application.** A device
holding its resume token restores silently. On another device the first Next
matches last name, date of birth and SSN *and* an email or phone already on the
draft, then offers to continue or — behind its own destructive confirmation —
delete it and start fresh. A failed or unmatched lookup is indistinguishable
from "nothing exists".

### Carrier-started applications

**A carrier can start an application for a driver.** Unfinished applications →
**+ Start an application** offers **Let AI read the documents** (licence,
medical card, PSP report, motor vehicle record; the reader prefills) or **Fill
in manually** (documents attach unread). In one editable form the recruiter
enters the driver's email or phone — the identity keying the draft and its
application; either suffices, each is format-checked — corrects the reader, and
copies a link. The driver lands in the ordinary wizard with the answers, adds
what only they can (SSN and signature are never in a draft), reviews and signs;
until then it is only a draft (§5) — nothing filed, emailed or counted. Once a
link exists (`sent`) email and phone are **read-only** (`identityLocked`;
re-keying would strand the link, so a different driver means a new application).
The driver may change everything but the name and USDOT number of employers
locked from a PSP report (§5).

**The editor offers each field as the wizard holds it:** states from the
wizard's own list of names, choices from the field's options, endorsements as
checkboxes (the wizard reads only its exact form, e.g. `H,N`). It never offers
the SSN or a second medical-card upload (the documents panel owns it). In
`SchemaRenderer` edit mode, which the dossier's *Edit Application* shares,
uploads, the signature and the applicant's certification are display-only and
`proposeApplicationChanges` skips them.

**The document reader** extracts text in the recruiter's browser — a PDF's text
layer, else Tesseract OCR, else page images (a photo re-encoded like a page) for
the vision AI — and only that text or those images leave the browser. Any subset
of the four documents is valid; the text task shares 16,000 characters among
them and the summary names one read only in part. A read is up to two minutes
per pass, twice; a failed second pass falls back to the first, and the second
wins where it succeeds. `useApplicationPrepDraft.applyExtraction` merges into
the answers *as they are then*, so anything typed meanwhile is kept (and
reported). The applicant and document set are captured before the call and
compared after it; a result for another driver or document set is not applied.

**A control that cannot be pressed cannot explain itself.** Save and "Create the
driver's link" stay clickable and validate on press: `prepActionPreflight`
(modelled on `publicApplyPreflight.js`) names what is missing and where; nothing
is saved, minted or copied until it is met. A link needs a saved draft
(`canMint` is `Boolean(applicantKey)`, set only by a save) and an email or phone
(`prepare.js` refuses without). Link actions refuse unsaved edits and a contact
detail corrected since the last save (`applicantKey` would address the old
document), offering save-and-mint in one press. `disabled` is only for work in
flight (the design system's `loading`); the label stays "Save" while a live
region speaks. A contact correction retires the document it moved off (one
driver, one row). A refused clipboard says so and points at the selectable
on-screen link. Pinned by
`UnfinishedApplicationsPage.prepActions.contract.test.jsx`.

### Uploads

**A signed URL is a capability, not a property of the document.** Uploads from
the wizard and the carrier's form (`useGuestFileUpload`) are kept as
`{ name, storagePath }`, never with a URL. Records from before 2026-09-08 may
still hold an expired one, and the dossier's own admin upload stores a Storage
download URL; views re-sign from `storagePath`. `useSignedUploadPreview` mints a
fifteen-minute URL through `getSignedGuestUploadUrl` (which authorizes it) when
someone looks. A `not-found` preview says the file is gone; any other error
offers a retry and the row still reads as attached (upload gates key on
presence).

**A custom "file upload" answer is the file:** `{ name, storagePath }` in
`customAnswers`, recorded only once the upload lands (answers from before
2026-10-02 hold only a filename). Every renderer (review, snapshot, PDF,
dossier) shows the name, even for a deleted question; the dossier's
*Supplemental Questions* has **Open file** (`getSignedApplicationFileUrl`,
minted on press). Deleting the application deletes the file, but only from
`companies/{id}/applications/guest_uploads/` (the answer is browser-supplied;
deletion runs with the Admin SDK; §12). While uploading, the picker is busy and
Continue waits, as on the License step.

### Unfinished applications workspace

`/company/drivers/unfinished` (*Unfinished applications*) lists every
application started and not submitted, by either side, with **+ Start an
application** first. A call to make, not an ATS record: it stays out of the
pipeline, reads `listApplicationDrafts` alone (one document, one row), and rows
never carry answers (`toCompanySummary`). **Create a continuation link** copies a
pointer: whoever opens it must prove their identity first, which a recruiter
cannot do from anything SafeHaul shows them (§5, §12).

| Started by | Status | A recruiter may… (`unfinishedRowActions.js`) | A Company Admin also may… |
|---|---|---|---|
| Company | `prepared` | open and keep editing (`getCompanyPreparedDraft`); mint the driver's first link | delete (`deleteApplicationDraft`) |
| Company | `sent` | open and keep editing; mint a replacement link | delete |
| Company | `driver_in_progress` | open the record — the server withholds the answers (`companyMayReadAnswers`); mint a continuation link | read and correct the answers (`getApplicationDraft`, `saveApplicationDraftEdits`); delete |
| Driver | `in_progress` | mint a continuation link. Nothing else: `getCompanyPreparedDraft` answers `not-found`. | read and correct the answers; delete |

The admin column (owner's decision, 2026-10-06) answers only
`assertCompanyAdminStrict` and is audited. Deleting kills the link and keeps the
uploads; the driver's device keeps its copy, which can still submit. **Edit
answers** covers every page but what only the driver gives
(`driverOnlyFields.json`), and never overwrites an answer changed since loading.

### Pipeline, documents and operations

**Recruiter pipeline (ATS).** Applications and leads are separate collections
under the company with the same tooling: status funnel, activity log, internal
notes, documents, assignment. Leads arrive by manual quick-add, CSV /
spreadsheet import, or the Facebook Lead Ads webhook.

**E-documents and signing.** Recruiters build envelopes with placed signer
fields (optionally AI-suggested); recipients sign at
`/sign/:companyId/:requestId` **with no account**. Signed envelopes are sealed
into tamper-evident PDFs. Signing is unlimited and not billed per envelope.

**Date Signed is stamped when the signer submits.** Other prefills (name,
address, date of birth, hire date, licence expiry) resolve at sending; the
`current_date` binding travels as an unresolved `{{current_date}}`, stamped once
server-side by `submitPublicEnvelope` — recruiter envelopes, templates and
post-application documents (`functions/postApplicationEdocs.js`) alike,
restamping a still-*bound* field even if an older send baked in a date.
`getPublicEnvelope` stamps the same value for display and returns its instant
(`serverTime`), so screen and sealed PDF share the server clock, in **UTC** (as
`signedAt`); before submitting, the signing room re-checks it and, if the UTC
day moved, updates any field declared a signing date (binding or unresolved
token) and asks the signer to look again. A bare `{{current_date}}` typed into
other **locked** text cannot be re-checked (string matching would rewrite a hire
date that is today): it seals correctly, only its preview can lag a day. Nothing
else is touched — an editable box mentioning the date keeps what was typed. One
definition in `src/features/signing/utils/signedDate.js` and
`functions/shared/signedDate.js` (CommonJS cannot import ESM): change both.

**Previous employment verification (PEV).** A company admin sends a request to a
past employer, who answers through a token portal with a reminder cycle (§8) and
signs **drawn or typed**. A typed name is stored as `TEXT_SIGNATURE:<name>`
(never rendered as an image) and `signatureMethod` (`drawn` | `typed`) is
recorded and printed on the DQ-file PDF. ESIGN (15 U.S.C. §7006(5)) and UETA
accept a typed name adopted with intent to sign; the server refuses any other
form or a mislabelled method (`functions/employmentVerification/signature.js`).

**Driver-approved corrections.** Company admins cannot silently rewrite a
submitted application (§5).

**Bulk SMS / email campaigns.** Audience building over leads, then a resilient
session-based worker (§8). Partial by design: the carrier connects its own
messaging provider and is billed by it. No two-way threads, no automated
multi-step drips.

**Super admin operations.** Companies, users, unified driver DB, global feature
flags, SMS integrations, Environment & Integrations vault, AI providers, blog,
website-lead archive, form builder, system health, stats backfill, releases.

---

## 5. Important business rules

These are the rules most likely to be broken by an innocent-looking change.

### Submission

**Deterministic application IDs.** The document id is
`SHA-256(companyId + ":" + email + ":" + phone)` truncated to 20 hex characters
(email lowercased/trimmed, phone reduced to digits), so retries collide into
idempotent merges, not duplicate drivers. The rules enforce it for authenticated
driver creates. **Never change the hash inputs, normalization or truncation** —
existing records would become unreachable.

**Offline-tolerant submission.** Submissions queue in IndexedDB
(`src/lib/submissionQueue.js`) with exponential backoff and retry when the
connection returns — workable only because IDs are deterministic.

**A refusal is not a failure to deliver.** Only a submission that never reached
the server is retried and queued: a dropped connection (reported as `internal`),
timeout, cold start, rate limiter. A server refusal (`invalid-argument`,
`failed-precondition` and the other permanent codes in `publicApplyRefusal.js`)
stops retries, removes the queue entry, shows the server's sentence and goes to
the page its issues name; the draft is untouched for correction. (Queue replays
do not yet do this — §12.)

### Unfinished applications: storage and identity

**Drafts are never written into `applications`** (§10). They live at
`companies/{id}/application_drafts/{applicantKey}`, keyed like the application
they become, are discarded once submitted and expire after 30 days (§8).

**A draft never holds an SSN or a signature.** Both are stripped in exactly
three independent places: the local copy, the client payload, and on arrival at
every depth. Returning applicants are matched by a keyed HMAC (`identityKey`) of
company + last name + date of birth + SSN digits, never the SSN itself.

**A save never erases `identityKey`.** The SSN lives only in page state, so a
`saveApplicationProgress` call after a reload or restore cannot recompute the
key: `identityKeyForSave` uses a fresh key if computable (names and birth dates
may be corrected), else keeps the stored one, and when the applicant key moved
(a corrected email) inherits it from the draft the resume token opened. The
one-live-draft sweep reads the key that was *written*. The key is what
cross-device resume queries (`findResumableApplication`, `identityKey ==`) and a
prepared application's only proof of ownership.

**Never-persisted fields are enforced at submission.** A resumed applicant may
never revisit the page that asks the SSN, so `submitGuestApplication` refuses a
missing required unpersisted field (`assertRequiredUnpersistedFields`) and the
wizard blocks Submit and routes there. Both derive from the shared field table,
`resolveGate` and the draft strip list, so Hidden/Optional is respected and
anything newly unpersisted is covered. The server is the authority.

**Saving must never stop an applicant.** The local copy is written first,
synchronously; the server save is background work whose failure is invisible.

### Unfinished applications: two copies, reconciled

Local is the immediate backup for weak signal and failed saves; the server copy
is the persistent primary. `reconcileApplicationDraft.js` decides, purely:

**An older server copy must never overwrite newer local work.**

- **Write sequences, never clocks.** Local counts its writes and remembers which
  the server confirmed; the server stores its copy's sequence. Unacknowledged
  local work wins; a server copy another device advanced wins; **the loser is
  merged underneath, never discarded**; work typed since page load beats both. A
  restore never overrides a Back pressed while the server read was out.
- **Field-aware merge; never a flat spread**, which replaces nested lists and
  maps whole. Repeating lists (employers, violations, accidents, schools,
  military, addresses; derived from `applicationSections.json`) are unioned,
  winner's rows first, capped; keyed maps (`customAnswers`) merge per key,
  winner first; everything else comes whole from the winner (never half an
  upload descriptor).
- **Navigation is not work.** Every navigation writes the draft (Back sends no
  server save), but a write changing no answer moves no sequence. A draft from
  before sequences existed counts as unsynchronised.
- **Acknowledgements name their draft.** Every save carries the draft's name; an
  acknowledgement must match name *and* sequence (exactly, when named — an
  unnamed stored copy is no wildcard), since a reply can land after Start Over
  reset the counter. The `online` event flushes a dirty copy once, only if
  something is owed.

### Unfinished applications: whose copy is it

Apply-page slots are keyed by company only (`draft_${slug}`,
`apply_discarded_${slug}`, `apply_resume_${slug}`,
`sh_post_apply_${companyId}`), so drivers sharing a browser share them, while an
invite names one applicant; and `loadPublicApplyCompany` sets the company before
the invite exchange resolves, while reconciliation starts on `company?.id`.

- **Ordering and identity are separate mechanisms.** `PublicApplyHandler` holds
  reconciliation while the exchange is `pending` (not `opened` — the driver's
  newer work must still win). The `applicantKey` stored beside the resume token
  names whose leftovers these are; a foreign local copy is **withheld**
  (`local: null`), not deleted, and the normal server-won write-back replaces it
  (its owner loses only that local backup; their server copy stays reachable by
  identity match). The exchange's `lastStep` and reconciliation agree via
  `Math.max`. Per-applicant storage keys were rejected: they would move on every
  email correction, a fresh load cannot know which to read, and the discard mark
  must stay un-namespaced.
- **`useResumeTokenOwnership.js` owns "which application does this tab hold a
  credential for".** `restoreFromStoredToken` returns the server's
  `applicantKey`, to re-stamp the slot after a contact correction (keeping local
  work) or abandon a reconciliation for another application; a failed restore
  clears the token only if the slot still holds it; `sendSave` sends its own
  tab's token, never the shared slot's (else `carriedPreparedFields` could copy
  `lockedEmployers` and `inviteClaimedAt` onto someone else's application).
- **Confirmation screens.** `sh_post_apply_${companyId}` (24 hours; sets
  `submissionStatus = 'success'` above the wizard) is restored only after the
  exchange and only if nothing opened. A successful exchange *clears* it and the
  unscoped `lastConfirmationNumber` (skipping would let a reload bring it back)
  — safe, because submission deletes the draft holding the invite hash — and a
  failed one touches nothing, protecting a driver who re-clicks their own dead
  link after submitting. A restored post-submission session has no `intakeMode`,
  so success stays above the chooser.
- **`retirePreparedSource`** deletes the prepared document a driver's save moved
  off (an email corrected before the first save), which `supersedeOtherDrafts`
  (sweeps by `identityKey`, which prepared drafts lack) cannot reach. It needs
  that document's own current token (`preparedSourceFor`), so one link never
  answers two live drafts.

### Unfinished applications: discards, submissions and open tabs

Tabs share `localStorage` and a deletion reads as "nothing was here", so an
ended application is announced by a mark, `apply_discarded_<slug>`: opaque,
compared only for inequality (no clock), remembered by each tab at load, pushed
by the `storage` event (to every tab but the writer), and compared before every
write.

- **Wording, not identity.** A `discard:` / `submit:` prefix only picks the
  message (an unprefixed mark reads as discard). The mark never names the
  application — a draft's name is a slot generation, and two tabs on one
  application mint different ones — so every tab acts on any change; a tab on
  another application keeps its answers unless it had restored them (accepted).
- **Start Over** deletes the server draft, resume token and local copy — local
  *before* the mark, since a mark failing on a full quota after the token is
  gone would let another tab recreate the application — clears only its own
  application (empty or unnamed slot yes, another's named slot no), and drops
  the token only if still the one it retired.
- **Reacting tabs:** restored answers return to a fresh start; answers typed
  there stay as a new application; a submitted application is never disturbed
  (success screen, confirmation number, documents checklist). At start-up the
  profile load captures the reset counter before fetching and skips the restore
  if it moved, and compares the mark as well (a mark older than the listener
  fires no event).
- **Submission re-checks** before validation and before every callable attempt —
  by mark, and by reset counter (an event during an in-flight submission is
  exempted and adopts the mark, so the counter is bumped first) — removes the
  queue entry when it abandons, and checks once more after the final failure,
  before the queued screen. The resume lookup's reply is likewise checked before
  any prompt.
- **Landing closes the draft:** write the `submit:` mark, drop the resume token,
  and abandon this tab's queued saves (a token-less one would recreate the
  draft). A queued submission does this when its replay lands, wherever and
  whenever (the slug travels with the entry), never on a transient failure — and
  is refused if the mark changed since Submit (recorded then, not at queueing;
  this also makes a failed dequeue harmless; an unrelated change drops it too —
  accepted).
- **Draft names make a late close safe.** Each draft has an opaque name minted
  at creation and kept through every write; the queue entry records it, and a
  close happens only while storage still holds that draft. A write keeps a name
  it holds, mints one when it starts an application, and leaves it alone when
  only annotating (a confirmed sync); the submitting tab never reads it back
  from storage. The write counter (restarts at zero) and the token's applicant
  key (shared) cannot substitute.
- **Edges.** With no draft stored the mark is still written; a pre-name draft is
  left alone; a direct submission clears only its own draft (mark written
  regardless); a reacting tab clears the stored copy only if it had restored it;
  Start Over, a close-out, "apply again" and reacting to a discard all forget
  the name.

### Unfinished applications: server-side protection

- **The resume lookup precedes the first server save** (a racing save would
  reset the step or let the one-live-draft rule delete the older draft); the
  hook owns this.
- **Resume is not a lookup service:** one uniform reply for nothing, another
  contact detail, or already submitted; the bar is three identity facts *plus* a
  contact detail on record; both halves rate-limited fail-closed per caller
  **and** per identity and audited without recording the attempt. Submitted
  applications are never offered or disclosed.
- **Creating a draft is open; changing one needs ownership** — the creating
  device's resume token or the full identity HMAC. Superseding another draft
  needs **that** draft's token (identity facts let a stranger create a draft
  inheriting the victim's `identityKey`, so identity is never a delete
  primitive). **Start Over** retires only the offered draft, by its own token;
  siblings await their own Start Over, a later offer or the 30-day TTL.
  Existence check, authorization and write share **one transaction**.
- **Unauthorized attempts** spend their own refusal budget per caller **and per
  targeted draft** (never per claimed identity, so refused writes cannot exhaust
  the budget the real applicant needs to find their draft), are audited, and
  look like a network failure (`{ saved: false }`, no key, no token).
  **Accepted:** someone holding both email and phone can tell refused from
  created by whether a token returns (rate-limited, audited).
- **A resume token that opens nothing is refused.** It must resolve to a live
  draft (target document, then the identity's drafts, then a bounded recent scan
  when no HMAC is derivable), judged **before** and apart from ownership. Its
  **last two generations** count (a resume lookup rotates it before the
  applicant chooses) but prove only existence; changes need the current token or
  full identity. The steps **fall through** (one save may change contact and
  identity fields together), and the browser names the key it believes the token
  opens — a hint checked in one read, never a claim. Audited as `stale_token`:
  ordinary multi-tab life, not an attack.
- **Accepted (squatting):** a draft created at someone's key before they apply
  denies them server autosave and cross-session resume at that carrier; their
  local copy and submission still work, the squatter reads nothing, and it
  expires in 30 days.
- **A copy behind a Company Admin's edit is refused** (`companyEdits.js`): a save
  outright, as is one landing on the driver's other edited draft; a submission
  back to Review. The page takes the edits (never the driver's own), drops a
  stale signature and names them on every step. Nothing the driver cannot see
  stops a submission; an older page (Production until promoted) can undo edits.

### The frozen record

**The submission snapshot is immutable.** What the driver saw, answered and
accepted is frozen into
`companies/{id}/applications/{appId}/submission/{version}`; client writes are
**denied by rules** (Admin SDK only). A genuine resubmission takes the next
sequence, beside the first, never on top.

**The original PDF is generated once, from the snapshot**, at
`application_originals/{companyId}/{applicationId}/{snapshotId}.pdf`, a prefix
with **no Storage rule** (default-deny for every client, staff included). The
only read path, `getApplicationOriginalPdfUrl`, authorizes the caller and writes
an audit record before issuing a short-lived signed URL; the PDF can carry a
full SSN. **Do not add a Storage rule for that prefix and do not regenerate the
PDF on download.**

**Legal agreement wording is versioned and frozen.** Five agreements
(`mvrAuthorization`, `electronicSignature`, `fcraDisclosure`, `pspDisclosure`,
`clearinghouseConsent`) live in `functions/shared/legalAgreements.js`. Current
`v2` (`v1` stays submittable for drafts that accepted it) follows primary
sources: FMCSA's PSP language word for word, an FCRA disclosure and
authorization only (the CFPB summary of rights is a version `link`, recorded
only if shown), and FMCSA's limited-query Clearinghouse consent (a full query
is consented only in the Clearinghouse). The MVR authorization is answered on
the Violations step (`consent-mvr`, with its version); on Consent each other
agreement has a page of its own (the FCRA and PSP stand-alone rules), then the
certification, ending with the exact 49 CFR 391.21(b)(12) sentence (hard-coded
in `Step9_Consent.jsx`, not frozen), and the signature. An acceptance counts
only at the version on screen; a submission binds to the version the applicant
saw, not what is deployed. **An acceptance's IP is the one the server saw**,
never the browser's claim: evidence forgeable by the party it incriminates is
not evidence. `legacy-1` bodies are a **frozen forensic record — never edit
them**; `clearinghouseConsent` has no `legacy-1`, so reconstruction cannot
attribute a consent nobody gave. **Applications submitted before the MVR
authorization existed have no acceptance for it**; their records say so, and
nothing back-fills one.

**Company wording is immutable too.** Versions are content-addressed (`c-<12 hex>`
of agreement id + body + the `links` copied from the platform's current version
at publishing) at `companies/{id}/legal_agreements/{agreementId}`, with no
client rule; `listCompanyAgreementWording`, `publishCompanyAgreementWording` and
`revertCompanyAgreementWording` are the only access (who may publish: §6). The
apply page gets the active text from `getApplicationAgreements`; the snapshot
freezes it at its `c-` version (a version whose hash no longer matches is
dropped; one published before links existed presents none). A submission binds each agreement to the version its acceptance
names when real (held by the company, or a current platform version), so
mid-application publishing never replaces what was read. An unreadable wording
record **fails** the read (`unavailable`) instead of falling back to platform
text: the page retries; a submission takes the failed-snapshot path.

### What the application asks and enforces

**Application gates have one resolver.** `src/config/applicationGates.js` (is a
standard DOT question required, optional or hidden?) mirrors
`functions/shared/applicationDefinition.js` exactly
(`applicationGates.test.js`): wizard, server validator and snapshot must never
disagree about what was asked. Defaults are load-bearing: `mvrConsent` is hidden
and not required until a company opts in, `emergencyContacts` is hidden —
flipping either changes or blocks every existing company's application.

**Application Rules have one engine.** `functions/shared/applicationRules.js`
mirrors `src/config/applicationRules.js` byte-for-byte
(`applicationRules.test.js`; date helpers in `applicationDates.js` likewise),
driven by `functions/shared/applicationRulesCatalog.json`, which the settings UI
also renders. `evaluateApplicationRules` runs in each wizard step as answers
change, in the final pre-flight (walking a resumed applicant to the first
failing page) and in `submitGuestApplication` (`assertApplicationRules`, same
sentence). Super Admin sets any company's rules (Companies → Edit); Company
Admins set their own (Settings). The rules: previous address when under three
years at the current one · which experience options are offered · which
vehicle-experience categories show and their wording (stored keys never change;
a hidden category with a saved value still displays) · expired CDL and expired
medical card, each allow / warn / block · require previous-licence details · MVR
authorization optional / required (a Yes needs its recorded acceptance evidence;
the question is disabled until the wording loads) · require violation and
accident details on Yes (accidents record fatalities, injuries, hazmat spill) ·
employment history allow / warn / block with a configurable minimum of years ·
require a felony explanation · Hours of Service statement off / on (covering
exactly the seven days before the reference day, so a stale week in a resumed
draft is refused and re-asked).

- **Every default reproduces the pre-2026-09-02 behaviour** (`warn` is what
  "three-year coverage" always did). An impossible date (30 February, a year out
  of range) is refused regardless of configuration.
- Legacy records with violation or accident rows but no Yes/No answer read as
  Yes. An explicit No drops everything it revealed — rows *and* conditional
  fields such as the licence-revocation, conviction and felony explanations — at
  review, pre-flight and server (`normalizeApplicationAnswers`), per
  `conditionalAnswers` in `applicationRulesCatalog.json` (read by both mirrors).
  A conditional field missing from that list is still submitted after a No and
  prints under it on the PDF.

**The reference day is the applicant's, within a day of the server's.** The
browser judges "the last seven days" and "expired" on the device calendar; the
server runs in UTC, and for part of every day the dates differ (e.g. US
evenings). A submission — and a queue replay, from its entry — carries
`applicantToday`, the day Submit was pressed; `applicantReferenceDay`
(`functions/shared/buildApplicationDoc.js`) uses it when it is a real date
within one day of the server's (every real time zone), else the server's clock —
so a device clock wrong by more than a day gains nothing.

**Employment history must cover 36 months by default** (49 CFR 391.21(b)(10)).
Employment, unemployment, schooling and military service all count; a gap is
only a gap when nothing explains it. `employmentHistoryMinimumYears` (1–10,
default 3) sets the window; `employmentHistoryEnforcement` ignores, warns once
or blocks. The calculation is calendar-month based and pure (injected reference
date), so a recorded result never drifts. The page asks what (b)(10)–(11) ask:
every employer of three years and, for a CDL job, the CMV employers of the seven
before (and says so when the company's period is longer). The reason for leaving
is required, and each employer not ended before the three years answers the two
(b)(10)(iv) questions (`subjectToFmcsrs`, `subjectToDotTesting`, the portal's
names), never pre-selected. The page and the submission pre-flight check them (a
draft resumed past the page is sent back to it); the server does not.

**Change both or neither.** The SPA cannot import the CommonJS backend, so
coverage exists twice — `functions/shared/employmentCoverage.js` and
`src/shared/utils/employmentCoverage.js`, proven identical against
`employmentCoverage.vectors.json` — as do `searchNormalization`,
`applicationRules` and `applicationDates`. The *data* files
`applicationSections.json`, `applicationRulesCatalog.json` and
`applicationRules.vectors.json` are genuinely shared, imported from
`src/config/`.

**A US state is stored as its full name.** Both wizard pickers list
`src/shared/utils/usStates.js` (fifty states and DC), which the company editors
also read (the FMCSA employer lookup keeps its own copy, DC included). Every
writer — CDL auto-fill, MVR import, the carrier's AI reader — converts the
postal codes documents print; an unmatched value is left for the driver, never
stored (a `<select>` shows its first option, "Alabama", for an unknown value
while validation passes). A stored value the list cannot name (e.g. a postal
code in a record from before 2026-10-01) shows as itself.

**A phone number is a US number: ten digits, or eleven starting with 1**
(`isValidPhone`), on page one, in the final pre-flight (back to page one) and in
the carrier's editor.

### Carrier-prepared applications and continuation links

**A prepared application is a draft a recruiter stops reading once the driver
writes.** It has `origin: 'company'` (its creator; never changes) and status
`prepared` → `sent` → `driver_in_progress`. The carrier may read back the
answers it wrote until the driver's first save flips the status one-way
(`drafts/save.js`); after that a recruiter sees contact and progress only
(`toCompanySummary`; a Company Admin can still read and correct it, §4). The
prep save never overwrites a driver-started draft; an email plus phone never open
a prepared one (no HMAC — the carrier lacks the SSN): only the invite token does.

**`companyMayReadAnswers`** (carrier-authored *and* not yet written by the
driver) decides what a link hands over, at both doors: `getCompanyPreparedDraft`
and the unauthenticated `exchangeApplicationInvite` (the first save leaves
`inviteTokenHash`, so copied links keep working). While true, the exchange hands
over everything; else it returns `requiresIdentity` alone — no answers, resume
token, step or `preparedBy` — and writes nothing (no token rotation). Minting
works after takeover (a replacement link is a pointer, not a credential). Pinned
by `companyApplications.invite.privacy.test.js`.

**Identity is checked against the draft the link names**
(`companyApplications/inviteIdentity.js`), never by a company-wide lookup (which
would discard the document the token resolved, need a composite index and make
the applicant guess which contact detail the recruiter typed).
`resolveApplyStatusScreen` shows `requires_identity` as
`ApplyIdentityCheckScreen`: last name, date of birth, SSN and one contact detail
already on record — what `InviteLinkPanel` tells recruiters.

- `identityKey` on file → recompute the HMAC (a real SSN check).
- None, **driver-started** → stored last name **and** date of birth must both
  exist (else `unverifiable`; the date of birth is the one compared fact a
  recruiter is never shown — a Company Admin is) and match; a well-formed SSN is
  required but unverified; success **establishes** the HMAC, so the tier is used
  at most once.
- None, **carrier-prepared** → `unverifiable` (the carrier typed those facts);
  the driver continues on the device where they started, which is asked nothing
  (§12).
- On success the claim fills the form in memory where it is empty: the SSN and
  date of birth only if the company asks for them, the last name always. Page
  one does not ask again, and no draft ever holds the SSN.
- Refusals are `permission-denied` with an actionable sentence, rate-limited per
  targeted draft and per caller, audited as `invite_identity_refused`, and
  disclose nothing beyond the `requiresIdentity` already given.

**A device holding the draft's resume token is asked nothing**
(`reconcileServerDraftOnLoad`); another applicant's token is not enough, and
their local copy is withheld as on `opened`. **While identity is pending nothing
else is restored:** one shared decision (production and E2E) gates
`loadPublicApplyCompany`'s local-draft restore (a stranger's answers would be
autosaved here) and post-apply restore (its success screen would cover the
check), and clears the stale post-apply session; a failed link touches neither.
**A confirmed exchange returns the step**, so the driver is not dropped at page
one (which reads as "nothing was saved").

**Any live draft can get a continuation link**; whose words it holds decides
what it hands over, never whether it opens. Driver-authored drafts are always in
the identity tier, with `status` and `origin` untouched, so they never appear in
`listCompanyPreparedApplications` (the `origin == 'company'` list, still
deployed though the workspace no longer calls it). The exchange's fallback scan
has no `origin == 'company'` filter, so that path needs no `origin`/`updatedAt`
index; the index stays for that callable.

**The invite link is its own token and its own risk.** `mintApplicationInvite`:
32 random bytes, only the SHA-256 stored, returned once; 14-day expiry, always
inside the 30-day draft retention. Unlike the resume token (browser-only,
rotated freely) it is meant to be emailed or texted. **Accepted risk, like the
absent App Check:** a link in a sent-mail archive is a bearer credential for one
prepared application until it expires or is regenerated. The exchange answers
wrong and expired links identically, is rate-limited fail-closed per IP, and
returns a resume token. Minting is rate-limited per company and caller and
refuses once the carrier stops accepting intake (every mint retires the live
link).

**Validity is per token.** Each accepted hash carries its own expiry
(`priorInvites`), and `liveInviteFor` asks "matches?" and "live?" of one entry.
Only the link the latest mint replaced stays live (`MAX_PRIOR_INVITE_HASHES` is
1), and only for `min(its own expiry, now + 10 minutes)`; expired hashes are not
carried forward; legacy bare-string prior hashes read as dead. Pinned by
`companyApplications.invite.expiry.test.js`.

**A dead link says so; starting fresh is a choice.** The exchange throws like
its sibling callables; `publicApplyInvite.js` classifies by what the driver is
told. **`unopenable` is one bucket on purpose** (wrong, expired, submitted,
superseded, discarded — the server answers them identically); other causes split
only where the driver can act, **retry first for transient ones** (a silent
fall-through would skip the claim, leave locks unenforced and hand the carrier a
second, unprepared application). `ApplyLinkProblemScreen` sits below the success
screen and above the intake chooser, so an ordinary application is an explicit
button; `resolveApplyStatusScreen` (`PublicApplyScreens.jsx`) owns that order.

### Locked employers

**Employers locked from a PSP report keep their identity.** A PSP report names a
carrier and USDOT number beside an inspection date — not when the driver
started, left or why — so a locked row's name and USDOT number are fixed and the
rest is the driver's. `applicationLockedFields.js` (byte-identical in
`functions/shared/` and `src/config/`, parity-tested) is applied three times:
the wizard renders the identity as a record, the pre-flight refuses and routes
to Employment, and `submitGuestApplication` refuses — the only real enforcement.
It applies **only once `inviteClaimedAt` is stamped** (the driver opened the
carrier's link).

- **The driver's first save stamps the claim, not the exchange:** the exchange
  records the resume token it minted (`inviteResumeTokenHash`) and
  `drafts/save.js` stamps `inviteClaimedAt` when a save presents it (clearing
  that field), so a carrier opening its own link cannot arm the lock against a
  driver who used `/apply/:slug`.
- **Every lock names a row on the application.** The carrier's editors show a
  locked identity read-only (prep: Unlock, correct, Lock; after the handover,
  **Edit answers** cannot undo a lock). `reconcileLockedEmployers` drops locks
  no row answers on every prep save (`prepare.js`, the authority) and once in
  the handover exchange — **never** on driver answers (deleting a locked row
  must not delete its lock). Refusals: `locked-employer-changed`,
  `locked-employer-missing`. The worklist shows `lockedEmployerCount`.
- **The AI reader locks the row, not the report's spelling:** a carrier already
  on the application (by name or USDOT) is locked with that row's own name and
  number, and the whole USDOT value is read before its digits are taken.
- **The lock follows the applicant.** A corrected email or phone means a new id
  (`sha256(company:email:phone)`), so `drafts/save.js` copies `origin`,
  `preparedBy`, `invitedAt`, `inviteClaimedAt` and `lockedEmployers` from the
  draft the resume token opened. Invite token hashes deliberately do **not**
  travel (two live drafts per link is worse than re-sending one).

### Company edits and previous employers

**Company edits to a submitted application need driver approval.** A company
admin's edits become per-field `pending_changes`; the main document stays the
**canonical original** until each field is resolved, so exports show originals
for unapproved edits. The driver approves, rejects or corrects them through a
token link (`/review-change/:token`, 30-day TTL); `hasPendingCompanyChanges`
clears only when all are resolved. All writes go through callables; client
writes to `pending_changes` are denied.

**Previous employers are editable there.** `SchemaSection` renders `array`
sections read-only whatever `isEditing` says (it is shared with the wizard), so
*Edit Application* swaps in `PreviousEmployersEditor` (add / edit / delete) for
that section alone; it writes nothing and sends its array through
`proposeApplicationChanges`. The driver's review portal lists employers added,
removed and changed field by field.

**An employer has an identity, because a verification is filed against it.** The
row mirrors its PEV (status, respondent, result document, history) and carries
an `employerId`: twelve opaque hex characters, minted once, never rewritten,
never content-derived (`employerSignature` in `applicationLockedFields.js` is,
and moves with a typo fix). Rows are stamped lazily by the change proposal and
`sendVerificationRequest`, never by migration or on the snapshot.
`resolveEmployerTarget` resolves by id; a pre-id request (`employerIndex`) is
honoured only while that row is still the `employerName` it recorded, else the
write-back is refused, not guessed. `verification_requests/{token}` permanently
holds response, signature, method and PDF and is authoritative; the row is a
mirror.

**A client never decides which employer owns a verification.**
`shared/employerEdits.js` strips browser-sent PEV fields and re-attaches them
from the record by identity at proposal time (accurate diff) and **again at
resolution** (authoritative — a verification may complete while a review link
waits; this also covers the driver's `edit` action, which writes straight onto
the document). Removing an employer with verification activity is allowed,
explicitly confirmed, logged with its verification state, and never deletes the
PEV record.

### Statuses and tenancy

**ATS statuses are stored strings.** `src/shared/constants/atsStatus.js` holds
the canonical funnel (`New`, `Contact Attempt 1–3`, `In Process`, `Hired`,
`Terminated`, `Declined`), plus `Interested` and legacy aliases kept selectable
so older records stay editable. Creation defaults differ: leads get `New Lead`,
applications `New Application`. Firestore rules validate status transitions and
**cannot import JS**, so renaming a value means editing the rules too.

**Tenant binding is immutable.** Rules require `companyId` to match the path on
create and stay unchanged on update, so a record can never be filed under one
company while claiming another.

---

## 6. Permissions and access rules

Authorization comes from **Firebase Auth custom claims**; the UI, routes,
Firestore rules and Storage rules use the same signals:

- `globalRole: 'super_admin'` (at the token root, or nested under `roles` for
  legacy tokens).
- `roles[companyId]` = `company_admin` \| `hr_user` \| `recruiter`.
- `companyTeamIds`, a denormalized convenience claim. Storage rules accept
  **either** it or `roles[companyId]`, because it can be stale until
  `onMembershipWrite` re-runs *and* the client refreshes its token.

Rule vocabulary: `isSuperAdmin()` · `isCompanyAdmin(companyId)` ·
`isCompanyTeam(companyId)` (admin + hr_user + recruiter + super admin) ·
`isOwner(uid)` · `readerSharesCompany(companyIds)`.

**Things that are easy to get wrong:**

- **There is no super-admin global wildcard** in Firestore rules, deliberately;
  super admin is granted per collection.
- **Cross-tenant profile reads are closed.** Staff may read a `drivers/{id}` or
  `users/{id}` profile only when they share a company with it, via
  server-maintained `companyIds`. Listing driver profiles is owner/super admin
  only.
- **Menu visibility and route access share one function**,
  `isCompanyAdminForRoute()` in `src/app/auth/roles.js`, behind both the sidebar
  and `CompanyAdminRoute`, so a hidden nav item is never reachable by URL. Keep
  it that way.
- **Server-only collections** are closed to every client, super admins included:
  `rate_limits`, `processing_status`, `integrations_index`,
  `environment_audit_log`, `ai_provider_config`, `ai_routing_config`,
  `ai_telemetry`, `blog_posts`, `blog_runs`, `platform_settings`,
  `landing_leads`, `orphaned_signature_cleanup`,
  `companies/{id}/application_drafts`, `companies/{id}/application_draft_audit`,
  `companies/{id}/legal_agreements` (callables only; publish is Super Admin
  only), and the `application_originals` Storage prefix. Some rely on
  default-deny with no rule; the AI, blog and application-draft paths carry an
  **explicit** `allow read, write: if false`, which survives a later broad
  `match` above them and states the intent. `environment_audit_log` is
  unreadable **even by super admins**, so it cannot be read around or forged
  through the callable.
- **Guests never write Firestore directly**; guest application creates go only
  through `submitGuestApplication`.
- **Documents are never public URLs.** Every file link is server-issued, single
  purpose and checked against company membership (`getSignedDocumentUrl`,
  `getSignedApplicationFileUrl`, `getSignedGuestUploadUrl`, `getSignedPevUrl`).
  Stored URLs expire or are absent, so views re-sign at view time.

**Starting an application for a driver is company-workspace access, not admin.**
`/company/drivers/unfinished` (and the `drivers/start-application` redirect) is
deliberately not `adminOnly` — a recruiter holding a driver's file does this,
and nothing it produces is filed. Its callables use
`assertCompanyAccessForRequest` / `assertCompanyAccess` (the admin's read, edit
and delete, `assertCompanyAdminStrict`) with per-user fail-closed rate limits.

**Application configuration is split by sensitivity.** A Company Admin manages
Standard Questions, Application Rules, Custom Questions and Integrations
(`applicationConfig`, `applicationRules`, `applicationIntegrations` on the
company document, an ordinary admin update) and can read the legal wording in
force; publishing or reverting a company's agreement text is **Super Admin
only**, and Super Admin can also set any company's Application Rules (Companies
→ Edit).

**Per-tenant feature flags** live on `companies/{companyId}` as `features` and
`featureSchedules`. Keys: `pev`, `campaignsEnabled`, `eDocs`, `importLeads`,
`callTracking`. Semantics are **opt-out**: a missing key means *enabled*; only
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
| **Facebook Lead Ads** | Inbound leads → company `leads` subcollection (switched off; §12) | Per company |
| **AI providers** | CDL auto-fill, e-doc field placement, blog generation, reading an applicant's own PSP report or MVR into *suggestions* where the company enables it (`extractApplicationReport`), and — for any company — reading the paperwork a recruiter attaches when starting an application (`extractCompanyApplicationDocuments`: one text task over whichever documents were attached, with a per-document vision fallback) | Secret Manager via the frozen registry in `functions/ai/registry` |
| **Telegram** | **Operator alerts**: `watchAiAndBlog` messages the chat that pressed Start on a one-time link from Super Admin → System Health (the bot token is checked with Telegram before it is stored). The marketing-site bot is **retired** (`LD-R3`): its six landing callables were deleted by the first promotion carrying `LD-R3`, and `promote-production.yml` still runs `scripts/retire-landing-functions.mjs` after each promotion (idempotent, now a no-op, and it never touches `listLandingLeads`). A rollback to a pre-`LD-R3` release would call functions that no longer exist; the procedure is in `docs/FIREBASE_HOSTING_RUNBOOK.md` | Alert bot token: Secret Manager `SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN`; chat and the watcher's state: `system_jobs/platformAlerts` (server-only). The retired bot's secrets are unbound; rotate its token (runbook) |
| **Socrata / Transportation.gov** | FMCSA employer autocomplete | Public app token |
| **Sentry** | Error monitoring for the browser app (`@sentry/react`); Cloud Functions log to Cloud Logging only | DSN |
| **GitHub API** | Release promotion from the Super Admin UI | GitHub App credential, server-side only |

**Hard boundaries:**

- **No feature may call an AI vendor directly.** Every request goes through
  `functions/ai/` (task interface → capability-aware router → provider adapter →
  schema-validated response); `npm run check:ai-boundary` fails CI otherwise.
  Each request carries a transaction id and records a per-provider timeline in
  `ai_telemetry` (Super Admin → AI Integrations → **Logs**). The connection test
  probes every capability a provider claims, not just its key, and reports a
  throttled probe as untested. Health and cooldown are **per lane** (text /
  vision), each with up to three verified model versions; one that is gone, off
  the plan or rate-limited rests, and the next is tried first while two attempt
  slices remain (a licence read; a medical card or report gets it next request).
  Driver-document reads cap each attempt (`perAttemptDeadlineMs`) and skip a
  vendor's pause over 5 s. See [`docs/ai-platform.md`](./ai-platform.md).
- **Credential access differs by function generation; grant both.** 1st- and
  2nd-generation functions default to *different* runtime service accounts (App
  Engine and Compute Engine), so `roles/secretmanager.secretAccessor` is needed
  on both or one AI entry point reads a credential the other cannot. Super Admin
  → AI Integrations → **Check credential access** asks both and names the
  account in use; "the secret is missing" and "this runtime cannot read the
  secret" are reported as different faults, since they need opposite actions.
- **SMS credentials are resolved by a factory, never inline.**
  `SMSAdapterFactory` fetches, decrypts and instantiates the right adapter. A
  per-user *keychain* (`.../sms_provider/keychain/{userId}`) maps a recruiter to
  their own "From" number, falling back to the company main number.

**A Facebook page belongs to one company.** `connectFacebookPage` takes the
company from the client and authorizes it against the caller's per-company role.
A page an earlier defect bound to a user id is reclaimed when its owning admin
reconnects it; a page held by a real company is refused, so no company can take
over another's lead feed. The claim is a Firestore transaction taken *before*
the Facebook OAuth exchange (two simultaneous connects cannot both pass),
released if the connect then fails.

---

## 8. Automatic and background behavior

### Scheduled jobs

| Job | Cadence | What it does |
|---|---|---|
| `enforceFeatureSchedules` | every 15 min | Auto-disables features whose `featureSchedules` entry has passed |
| `reconcilePublicProfilesSchedule` | every 60 min | Rewrites public profiles the `onWrite` trigger can never reach (e.g. after the projection itself changes) |
| `publishScheduledBlogPosts` | hourly at :15, America/Chicago | From 07:00, offers the day to one theme per run, in rotation, until its one article publishes |
| `processVerificationReminders` | every 24 h | PEV reminders at 5 / 15 / 20 days; at 30 days marks `no_response` and notifies the carrier, documenting the good-faith effort |
| `cleanupOrphanedSignatures` | every 24 h | Retries deleting signature PNGs left after sealing — without it, signature-image PII accumulates in Storage |
| `watchAiAndBlog` | hourly at :40, America/Chicago | Probes each AI lane (photos, text) through the router and checks the blog has an article from yesterday or today; tells the connected Telegram chat when a check goes down and when it recovers, never otherwise, and runs nothing until a chat is connected |
| Release health check | daily 07:17 UTC (GitHub Actions) | Reads what is actually live and opens/closes a GitHub issue |

The blog publishes one article a day, and its scheduler runs hourly on purpose:
that makes it idempotent, retry-safe, able to recover a day missed in an outage,
and unable to publish twice in a day (any filled slot closes it). Every run,
scheduled or operator-triggered, records one row per slot in `blog_runs` naming
the stage that refused: sourcing, generation, validation, claim check,
verification, originality, image or publication. An AI transaction's `success`
means only that a provider replied in shape, not that an article published.
Super Admin → Blog Posts → **Publication runs** is the read path. **No article
is ever published to meet the daily count**; refusing is a recorded outcome.

### Firestore triggers

- **Driver sync** — applications, company leads, logs and activities upsert a
  master `drivers/{id}` profile. A driver with no Auth account gets a **shadow
  profile** keyed by the document id; an Auth user is **never** created
  automatically — they claim the profile when they sign up.
- **Stats** — `activity_logs` writes roll up into `stats_daily`; application and
  lead writes roll up dashboard counters into `internal_stats` (server-write
  only).
- **Sealing** — a signing request moving to `pending_seal` triggers PDF sealing.
- **Notifications** — status changes, lead assignment, new applications,
  scheduled callbacks, and an applicant confirmation email on every new
  application.
- **Automated contact SMS** — moving an application or lead *into*
  `Contact Attempt 1/2/3` sends the matching template from
  `companies/{id}/settings/automated_sms`. Transition-only, so idempotent; no
  template, no message.
- **Segments** — application create/update maintains segment membership.
- **Retention** — activity logs are stamped with `expiresAt` for the eventual
  TTL policy; `blog_runs`, `application_drafts` and `application_draft_audit`
  are stamped too, with TTL field overrides declared in `firestore.indexes.json`
  so they deploy with everything else. An unfinished application expires after
  30 days if nobody returns to it.

### Idempotency

Long-running triggers guard themselves through a `processing_status` ledger
(check `completed` → set `started` → process → set `completed`), with a 30-day
`expiresAt` so a TTL policy can age entries out.

### Bulk campaigns

A recursive worker processes **50 recipients per batch** to stay inside function
timeouts, re-checking session state each batch so a cancelled campaign stops at
once rather than leaving a zombie worker. Recently-contacted numbers are
excluded by a configurable window that **defaults to 7 days**. Company and
global `blacklist` collections hold SMS opt-outs and are checked before
**every** send (`isBlacklisted()` in `batchWorker.js`), failing closed on an
unparseable number — but nothing populates them from a recipient's reply (§12).

---

## 9. Relationships between features — where changes ripple

- **`public_profiles` is the contract for the public apply page.** A sanitized
  projection of `companies/{id}` that strips `features`, `featureSchedules` and
  internal fields. It carries (DTO v3) the resolved `applicationRules` and the
  `applicationIntegrations` enabled flags (booleans only), which is how the
  wizard and `extractApplicationReport` know what the company switched on; the
  server reads its own copy, never the client's. If a company setting has no
  effect on `/apply/:slug`, check the projection allowlist first.
- **`application_drafts` holds two kinds of thing**, told apart by `origin`: a
  driver's unfinished application and a carrier's prepared one. The read cutoff,
  the locked-employer list and the invite token hang off that distinction;
  treating every draft alike would leak a driver's answers to a recruiter or
  refuse the carrier its own.
- **Text extraction happens in the browser, never the server** — `pdfjs-dist`
  for a PDF's text layer, a lazily imported `tesseract.js` for OCR. The
  tesseract chunk must stay lazy: a static import adds ~2MB to the company
  workspace bundle for every recruiter.
- **Applications and leads are near-twins.** Most callables accept a
  `collectionName` of `applications` or `leads` (strictly whitelisted against
  path injection); a change to one usually belongs in both.
- **`drivers/{id}.companyIds` and `users/{id}.companyIds` are load-bearing for
  security** — `readerSharesCompany` is built on them. They are
  server-maintained; breaking their population silently breaks legitimate reads.
- **Snapshot ↔ PDF ↔ agreements are one chain.** Touching the application
  definition, the agreement registry or the PDF renderer changes what future
  originals contain — and must never change existing ones.
- **The company route manifest drives routes *and* the sidebar**; one edit moves
  both.
- **Firestore rules encode enums and field whitelists that live in JS
  elsewhere.** Rules cannot import, so ATS statuses and driver self-update
  fields exist in two places by necessity.
- **Callable names are a contract.** `scripts/check-callable-contract.mjs` fails
  CI if the SPA calls a name `functions/index.js` does not export; see
  [`docs/callable-frontend-map.md`](./callable-frontend-map.md).
- **`functions/firebaseAdmin.js` sits under almost every function.** Functions
  deploy incrementally, following source files: editing the wrapper redeploys
  nearly all of them, while a change to `functions/package.json` or its lockfile
  alone redeploys only the functions every push includes
  (`DEPLOY_FUNCTIONS_ALWAYS_INCLUDE` in `main.yml`), so a dependency upgrade
  reaches any other function only when its own code, or a file it loads, next
  changes.
- **Every function loads the whole of `functions/index.js` on a cold start**, so
  a heavier dependency slows them all. 256 MB is the floor: a 1st Gen function at
  128 MB gets about 200 MHz, too little to load it within the start-up limit, and
  `functions/test/unit/functionMemoryFloor.test.js` refuses anything smaller.
- **The blog owns its stylesheet.** `/news`, `/news/{slug}` and `/news/feed.xml`
  are rendered by `serveBlogPublic` and styled by five files in
  `web/assets/css/`, cut from the retired marketing site's single sheet at its
  section boundaries and kept in its source order. **They are one stylesheet; the
  `<link>` order in the shell is the cascade** — moving a rule between files or
  re-ordering the tags can make a late override lose to an early rule. The parts
  from the old sections 6, 16 and 18 style the navbar, cards and footer the blog
  function emits; nothing in them may assume the homepage's markup exists.

---

## 10. Decisions that must be preserved

- **Firebase App Check is intentionally absent.** In production it **blocked
  real drivers' CDL and medical-card uploads**, killing applications at the top
  of the funnel, so it was removed as a conscious tradeoff. Audits should record
  it as an *accepted, documented risk* with compensating controls (MIME
  allowlist, 20 MB size cap, path isolation, tenant/intake gating, IP rate
  limiting, no public Storage read, Admin-SDK submit path) — **not** as a
  vulnerability to fix by re-enabling it. See
  [`docs/security-posture.md`](./security-posture.md).
- **Testing is not a sandbox.** `truckerapp-system.web.app` runs against the
  **same real** Firestore, Auth, Storage, Functions and integrations as
  production; a driver opening a Testing apply link files a real application.
  Only the frontend build served differs between channels.
- **Production never deploys automatically.** Merging to `main` deploys Testing
  and the shared backend; Production is reached only by explicit promotion of an
  already-tested Hosting version, through Super Admin → Releases. See
  [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md).
- **`workers: 1` in the Playwright CI config is deliberate**, kept on evidence
  of contention-induced flakes; sharding across runners is the sanctioned
  speed-up. A single green run is **not** sufficient evidence to change it.
- **UI standardization must not change backend behavior.** Design-system work
  may not alter Firebase rules, data structures, integrations, permissions,
  routes, feature flags or business workflows unless separately justified and
  approved.
- **Unfinished and carrier-started applications are drafts in their own
  collection, never early `applications` documents**, whose four `create`
  triggers would notify a recruiter, email "application received", create a
  `drivers/{id}` shadow profile and move the dashboard counters before anyone
  read, consented to or signed anything. The driver's own submission promotes a
  draft (§5).
- **Discarding a draft is never a dismissal.** `ConfirmDialog` routes Escape to
  `onCancel`, so "start a new application" is never the cancel action: Start
  over is its own explicit destructive confirmation, and Escape at either stage
  deletes nothing.
- **Imported reports suggest; they never answer.** A PSP report or MVR the
  applicant uploads yields suggestions with their own Add buttons. Nothing
  entered is overwritten, nothing is added twice, and a PSP carrier sighting
  becomes an employer row holding only the name and USDOT number — **PSP data is
  inspection and crash history, never employment dates or convictions**: the UI
  says so, and violations come from the MVR alone (the carrier's reader too).
  Neither document is stored or logged; its pages live in memory for one request.
- **The public site stays dependency-free**: no framework, no build step, no
  application or design-system imports. `web/privacy.html` ships no `<script>`
  at all, asserted by `src/tests/hostingConfig.test.js`.
- **Marketing claims must trace to the capability registry.**
  `functions/ai/knowledge/safehaulCapabilities.js` is the source of truth;
  `npm run check:public-claims` enforces it in the `callable-contract` CI job,
  which every push and pull request runs, and in the root `npm run lint`. It is
  a phrase list read clause by clause: a denial is a limitation, a news article
  counts only where it names SafeHaul (`claimScope.js`), and an overstatement
  slips past it. Never claim DOT/FMCSA compliance, MVR/PSP/Clearinghouse checks,
  document-expiry monitoring, a job board, or any named carrier endorsement.
- **A `web/` change runs the `frontend_unit` CI lane** — static content is
  tested, by `src/tests/hostingConfig.test.js`; `scripts/ci-plan.mjs` holds the
  mapping and `A5`/`A5b` in `scripts/test-ci-plan.mjs` pin it. The claims check
  is deliberately **not** in that lane (its inputs are the pages *and* the
  capability package, and a registry change selects only the functions lane):
  `K4` in `npm run check:ci-plan` pins it to an always-required job (today
  `callable-contract`), blocking and unconditional, with checker and package
  needing nothing installed, and refuses a page in a subdirectory the checker
  does not scan.

---

## 11. Design system and UI work

Mandatory reading before any UI, styling, responsive or accessibility change:
[`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`](./SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md)
and [`src/design-system/README.md`](../src/design-system/README.md). The roadmap
is authoritative for the rules, approved exceptions and open decisions; this is
a summary.

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

**Tables on phones.** A table whose rows are compared stays a table: a labelled,
focusable horizontal-scroll region, sticky header, first column pinned
(`DataTable` by default, `data-pin-first-column` on a native table). A matrix of
per-row form controls worked one record at a time — the SMS recruiter-assignment
matrix — becomes one card per row under 768px
(`data-mobile-presentation="cards"`), the same elements at every width. The
Super Admin feature matrix is the one specialized grid. Source and guards:
`src/design-system/components/data-table/README.md`.

**Two contracts have no exception route**, because the code refuses to run: a
dialog goes through `Modal` and takes its size and shape from the chrome
contract (props that would replace it throw); and every glyph comes from
`@design-system/icons` at a step on the icon scale (`xs`…`3xl`, 12–32px) — the
registry hands out **tokens**, not components, so `<Trash2 size={13} />` throws
by name. A glyph **inside a design-system container states no step**: `Button`,
`IconButton`, `Tabs`, `Chip`, `SegmentedControl`, `FileInput` and
`StatusMedallion` size what they hold. Every file outside the registry is on the
contract, nothing exempt; the one file that opens a glyph by hand is
`VOEDocument.jsx`, via the contract's own `glyphComponent`, because the exported
verification document must carry no `ds-*` class and `Icon` stamps one.

**These rules are checked, not just written:**

| Command | Blocking | Catches |
|---|---|---|
| `npm test` (`design-system/tests/`) | yes | An import across a layer boundary — in stylesheets as well as modules; a broken token contract or a pairing below AA |
| `npm run check:ui-contract` | yes | A raw colour, off-scale type, sub-12px text, a Tailwind radius or shadow, a hand-built overlay, a raw table, a hand-styled control, a hand-rolled tablist, toggle, current-item control or avatar disc (a raw `<button>` with `aria-pressed` or `aria-current`, or a round disc holding a person's initial), a raw file input, a hand-written `target="_blank"` — in JSX, stories and CSS |
| `npm run check:icon-contract` | yes | **Any** file under `src/`, outside `src/design-system/icons/`, importing `lucide-react`; there is no exemption list |
| `npm run check:table-layout` | yes | A cell narrower than its content, in a real browser at 412px and 1440px — for `DataTable` and the `ds-native-table` contract |
| `npm run check:visual-contract` | yes | A change to computed geometry — control heights, cell padding, radii, resolved colours, and a frozen table column losing its opaque background |
| `npm run test:stories` | yes | A story that fails to render, or fails axe |
| `npm run test:visual` | yes | A change to how anything *looks*, across 96 catalog subjects and 15 real screens at both widths. **Known gap:** the e-doc field editor and the sandbox wizard are not among the 15, so changes confined to them are guarded only by `check:visual-contract` measurements |
| `npm run test:e2e -- --grep "@a11y"` | yes | Real-browser axe on the mobile-critical journeys, plus keyboard behaviour: roving `tabIndex`, arrow/Home/End, and that every control a Tab press reaches shows the product's focus ring |

- **Inter is self-hosted** in `src/design-system/fonts/` (SIL OFL 1.1), never
  fetched from a third party at runtime: CI renders the real typeface, nobody
  sees a fallback font, and no user's IP is disclosed to render text.
- `check:ui-contract` is zero-tolerance against
  `src/design-system/ui-contract.allowlist.json`, which records every violation
  kept deliberately **and why**; an entry without a reason fails.
- Tailwind's radius and shadow scales share names with the `--ds-*` ones and sit
  one step off (`rounded-lg` is 8px, `rounded-ds-lg` 12px): convert by value,
  never name.
- **No guard catches a hand-composed pattern** — a status screen from `Card` +
  `StatusMedallion` + heading + body + actions, or a `Modal` with its own
  Cancel/Confirm footer, passes every rule while duplicating
  `patterns/page-state` or `ConfirmDialog`. Use the pattern; roadmap §7 records
  the review step that finds them.
- **In `index.html` the scan runs only the class-list rules**, so tests pin two
  values: the page ground `<body class="bg-ds-canvas">`
  (`src/tests/pageShell.test.js`; `raw-palette-class` refuses raw palette names
  but passes a swap to another `--ds-*` role, and the pixel lane cannot resolve
  it) and the `theme-color` meta, a literal copy of `--ds-color-brand-deep` that
  paints the phone's browser chrome (`src/tests/brandAssets.test.jsx`). Roadmap
  §7, "The one class no guard could hold".

---

## 12. Known limitations, retired features and intentional exceptions

**Retired — do not resurrect, and do not treat leftovers as bugs:**

- **Lead Distribution Engine** (platform-wide daily lead fan-out). Fully
  removed; no `isPlatformLead`, `distributedAt`, `visitedCompanyIds` or
  `dailyLeadQuota`.
- **Public job board / driver saved jobs.** Rules for `job_posts` and
  `drivers/{id}/saved_jobs` were deleted; those paths rely on default-deny.
  Historical documents are left unreachable rather than deleted.
- **`/join/:companyId` self-service team join.** Backing callable disabled,
  route removed. Use Super Admin → Create Portal User.
- **GitHub Models** as an AI provider.
- **`Khomurod/SafeHaul-for-Gemini-Antigravity`** — archived; never develop or
  deploy from it. Deploy jobs are guarded by repository name.

**Current limitations:**

- **The unfinished-applications workspace shows the 200 most recently active
  drafts** (`listApplicationDrafts`, by `updatedAt`). No pagination — a second
  list would break one-query, one-row-per-document. Raise the cap if a carrier
  reports a missing row.
- **Facebook lead capture is switched off, and leads may be stranded.** An
  earlier defect wrote a connected page's leads to `companies/{uid}/leads`,
  which no screen reads; `scripts/audit-facebook-lead-tenancy.mjs` (read-only)
  reports any. Connect rules: §7.
- **`users/{uid}` may carry orphaned `onboardingTourCompleted` and
  `tourCompletedAt`** from the removed welcome tour. Nothing reads or writes
  them (neither `firestore.rules` nor Cloud Functions ever referenced them);
  they stay deliberately (removing them is a data migration). Ignore them.
- **"Read the documents" reads only what the current browser holds.** Uploads
  keep `{ name, storagePath }` and send the bytes to Storage, so a prepared
  application re-opened later has its documents but nothing to read; the panel
  names them, and re-attaching one makes it readable. Fetching files back is
  deliberately not done (a cross-origin `fetch` dependent on bucket CORS this
  repository does not set).
- **A continuation link cannot verify the SSN of a draft with no `identityKey`**
  — the company set `ssn` Optional or Hidden (`GATE_DEFAULT_REQUIRED.ssn` is
  `true`, so opt-out), the driver pressed *Save as Draft* on page one before
  typing it, or, on a draft last saved before 2026-09-10, an autosave defect
  erased the key. A driver-started one is checked on its stored last name and
  date of birth, any nine digits passing for the SSN (§5) — facts a Company
  Admin can read; missing either, it is refused (`unverifiable`) and the driver
  plainly offered a new application. A carrier-prepared one is refused; the
  driver is told to continue on the device where they started (its resume token
  asks nothing) or start anew, so losing that device means starting over. The
  fix is out-of-band delivery — minting emails or texts the link to the draft's
  `contactEmail`/`contactPhone`, returning only a redacted confirmation so the
  carrier never holds it (DocuSign's Resend model) — which needs per-company
  email configuration.
- **A driver cannot dispute a locked employer that is satisfiable but wrong.** A
  PSP report is an FCRA consumer report with dispute rights, but a locked
  identity is a record to the driver (§5); no lock is unsatisfiable, yet nothing
  lets them say "that carrier is not mine" — its own feature, with policy
  questions.
- **Required custom questions are enforced only on their own page**; neither the
  final pre-flight nor `submitGuestApplication` checks them, so an application
  resumed past that page can be submitted without the answer.
- **A submitted upload's storage path is taken on trust.**
  `submitGuestApplication` only checks that an upload field holds something, and
  `deleteApplication` deletes every top-level `{ storagePath }` with the Admin
  SDK, so a hand-crafted submission could get another file deleted.
  `deleteSandboxApplication` removes the same files
  (`shared/applicationStorage.js`) but only inside `companies/SANDBOX/`, so a
  public sandbox submission cannot reach a real company's file. Viewing is safe
  (`getSignedApplicationFileUrl` refuses paths outside the caller's
  companies). Only custom-question uploads are held to
  `companies/{id}/applications/guest_uploads/`; restricting the standard fields
  needs a survey of every folder a legitimate file can live in.
- **A rule or question switched on mid-application appears only after a
  reload.** The server judges current settings while the page keeps those it
  loaded: the applicant is sent to the right page with the server's sentence,
  but the new fields appear only after reloading.
- **The offline queue's replay retries a refusal.** A direct submission stops at
  one (§5); a queued entry that meets one later (e.g. a rule changed while it
  waited) is retried up to ten times, then marked failed, with nobody told.
- **The dossier's *Edit Application* offers fields the server will not change.**
  Every schema section is editable, but `proposeApplicationChanges` applies only
  its allowlist and returns the rest as `skipped`, unmentioned — an edit to,
  say, a qualification answer disappears.
- **HEIC photos cannot be read.** The reader accepts PDF, JPG, PNG and WebP;
  browsers cannot decode HEIC (an iPhone's default), so it is refused with a
  message naming the accepted formats. Convert or re-take as JPG, or upload a
  PDF.
- **No payment processing.** `companies/{id}.planType` is a manual super-admin
  `free` / `paid` flag that only changes a badge ("Free Plan" / "Pro Plan").
  Marketing prices ($199 / $299 per month) are **not** enforced anywhere in the
  app.
- **Campaigns are one-way.** No inbound threads, no automated drip sequences.
- **Opt-out enforcement works; opt-out *capture* does not.** Sends check the
  blacklist (§8), but `handleOptOut` (`functions/blacklist.js`) triggers on
  `companies/{companyId}/inbound_messages/{msgId}`, which **nothing writes** (no
  inbound SMS webhook): a STOP reply reaches the company's own provider, and a
  number reaches the blacklist only if written directly, with no admin
  interface.
- **Frontend coverage thresholds are a ratchet** (statements 70 %, lines 72 %,
  branches 66 %, functions 72 %), a few points under measured coverage (73 / 75
  / 69 / 75) to block a real drop. Raise them as coverage improves; never lower
  them to pass a build.
- **Mixed Functions v1/v2 is intentional.** The generations default to different
  runtime service accounts, so (a) a credential can be readable by one AI entry
  point and not another (§7), and (b) binding a secret from a generation that
  never bound it fails the **entire** functions deploy until that account is
  granted access (guarded by `secretBindingGenerations.test.js`; see
  [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md)).
- **Feature flag defaults are asymmetric** (opt-out; missing means on) — easy to
  misread as a bug.
- **A direct Storage upload can bypass the backend helper** — a documented,
  accepted gap; see `docs/security-posture.md`.
- **Historical reconstruction is an ongoing migration.** Applications submitted
  before snapshot preservation get a record and PDF rebuilt only from surviving
  evidence and **marked as reconstructed**
  (`reconstructHistoricalApplications`); `surveyHistoricalReconstruction` counts
  what is outstanding, and the temporary Super Admin action reads its total
  there, retiring itself when the work is verified done. See
  [`docs/application-record-reconstruction-runbook.md`](./application-record-reconstruction-runbook.md).
- **A deleted blog article does not free its slot.** Deletion is a tombstone and
  `slotIsFilled` tests only that the slot's document exists, so the slot stays
  filled and the day stays closed (the ledger records a row saying so).
  Reopening a slot means changing the `create()`-based anti-double-publish
  guarantee, with its own justification and tests; see
  [`docs/news-and-insights.md`](./news-and-insights.md).
- **The blog's enforced word floor is 150 words**, far below the 700–1,200
  originally specified — a recorded owner decision against free-tier provider
  limits, not drift. Raising a provider tier reverses it.
- **`themesAreDistinct` is not wired into the blog pipeline** — exported and
  tested, called by nothing; with one article a day there is no day's set to
  check, and the 60-day duplicate window keeps successive days apart.
- **The AI live-credential checks cannot run in CI.** The credential-access
  diagnostic, per-capability connection tests, model-pin verification and a
  manual publication check need real credentials in a deployed environment; a
  green test run is not evidence any of them passed.
- **Known dependency advisories.** `npm audit` (root and `functions/`) gives the
  live list; most have an in-range fix (`npm audit fix`). A few wait on a major
  or upstream: root `exceljs` and the `@grpc/grpc-js` 1.9 the `firebase` web SDK
  pins; under `functions/`, `uuid` via `gaxios` 6 (required by
  `@google-cloud/storage` 8), which calls only `uuid.v4` — outside the
  advisory's v3/v5/v6 — and which `npm audit fix` would only downgrade.
  `.github/dependabot.yml` raises weekly grouped update PRs for the root,
  `functions/` and GitHub Actions, majors separately, with a **seven-day
  cooldown** so a package compromised and pulled within days never arrives;
  advisory-driven security fixes are not delayed.
- **Several one-time backfill callables are still exported**
  (`backfillUserCompanyIds`, `backfillDriverCompanyIds`,
  `backfillPublicProfiles`, `migrateEmailSettings`,
  `backfillApplicationSearchFields`, stats and SMS-phone backfills) —
  super-admin-only maintenance tools, not dead code; check before removing one.

---

## 13. Testing and operational expectations

**Commands:** `npm run lint` (frontend + backend + public-site claims) ·
`npm test` (Vitest) · `npm run test:coverage` (ratchet gate) ·
`npm run test:e2e` (Playwright) · `npm run test:rules` · `npm run typecheck` ·
`npm run storybook` / `npm run test:stories`. CI also runs
`check:callable-contract`, `check:ai-boundary`, `check:ci-plan`,
`check:release-scripts`, `check:deploy-script`, `check:function-exports`,
`check:ui-contract`, `check:table-layout`, `check:visual-contract`,
`test:stories`, `test:visual`, `test:secret-scan`, and a secret scan
(`scripts/secret-scan.mjs`, a pinned Gitleaks CLI) — all blocking. CI's frontend
job runs `lint:frontend`, not the root `npm run lint`, so a check that lives
only in the root lint is not a CI gate. Only `npm run typecheck` is
**non-blocking** (`continue-on-error`), and the modules `jsconfig.json` checks
have no type errors, so a red typecheck is a new error to fix, not a broken
build. TypeScript 7 no longer reads a JSDoc `{object}` as `any`: name the fields
a function reads, or use `Record<string, unknown>`. A `TS5xxx` error means the
configuration was rejected and nothing was checked, so fix the configuration.
TypeScript 7 has no `baseUrl`; paths in `jsconfig.json` are relative (`./src/*`).

**The secret scan covers what the change introduced** — this event's commit
range plus the resulting source tree — never the whole history. A pull request
compares against its merge base; everything else (a push to `main`, a manual or
scheduled run) against the newest ancestor carrying a **fully validated
release**: a run in which both `secret-scan` and
`Verify the release is fully validated` succeeded, the second proving the
scanner passed its own tests. So the increment behind a failed release is
re-scanned, never stepped over.

- Every base is resolved to its full SHA and must exist, be an ancestor of the
  head and not be the head; the `SECRET_SCAN_BASE` dispatch input must also
  carry a validated release (it names a known-good release, never invents one).
  An undeterminable base **fails the job**; no fallback widens or empties the
  scan.
- Exemptions are pinned, not trusted: `.gitleaks.toml` may declare only the
  reviewed tables, keys and values; `gitleaks:allow` comments are switched off;
  a `.gitleaksignore` fails the job.
- Because a deploy requires this job, nothing reaches Testing unless every
  commit since the last fully validated release was scanned by a scanner that
  passed its own tests.
- The full-history sweep is the separate, non-blocking `secret-history-audit`
  workflow (the history's known legacy findings would otherwise fail unrelated
  releases); `docs/SECRET_HISTORY_AUDIT.md` lists the credentials still needing
  owner rotation.

**Source size.** 400 physical lines asks a file to justify its shape; 500 is the
hard maximum for every handwritten source file, tests and tooling included, with
one owner-ruled exception: `src/firestore.rules`, held under a 689-line ceiling
that may only move down. `npm run check:source-size` enforces it against the
pull request's base or the last fully validated release; the details are in
`.claude/rules/source-size.md`.

**Instructions for AI agents stay small.** `AGENTS.md` is one page every agent
reads; `.claude/rules/` holds topic rules loaded per area; history lives in
`docs/archive/`. `npm run check:agent-docs` (unskippable, in
`callable-contract`) fails any file over its limit in
`scripts/agent-docs-limits.mjs` (this brief included), refuses a limit raised
against the base commit, and refuses a path the instructions name that does not
exist.

**Cloud Functions reach the Admin SDK through `functions/firebaseAdmin.js`**
(its `admin`, `db`, `auth`, `storage`) or a modular `firebase-admin/<service>`
import: `firebase-admin` 14's root export has no services, and suites that mock
it would not notice. `functions/test/unit/firebaseAdmin.test.js` refuses a root
require or an `admin.<path>` the wrapper lacks, and loads `index.js` under plain
Node. Under Jest the ES-module-only `jose` (App Check and phone-number tokens,
neither used — §10) maps to an empty stand-in; Jest on Node 22 cannot
`require()` it.

**Playwright** runs in CI as a 4-way shard matrix with `workers: 1` and
`retries: 2` per shard (§10). **Local test-runner safety** — one Playwright
suite at a time, no broad `pkill`, and the rest — is in
[`.claude/rules/testing.md`](../.claude/rules/testing.md).

**The first download has a budget.** `npm run check:bundle-budget` sums the
entry script, its module preloads and its stylesheets from `dist/index.html`,
fails the `frontend-build` job above **380 kB gzip**, and refuses a preload of
the pdf.js chunk or a Sentry Replay recorder in the entry (the pdf.js worker
wiring lives in `src/lib/pdf/pdfWorker.js`, imported only by the lazy PDF
features; Replay attaches after load in `src/lib/monitoring/sentry.js`).
`npm run test:bundle-budget` drives each refusal on throwaway builds in
`callable-contract`, and `check:ci-plan` (K1c) pins both steps. The ceiling may
only move down, with a new measurement. Figures are gzip; Hosting also serves
brotli.

**The public site has two CI gates** (§10): `npm run check:public-claims` in
`callable-contract`, which refuses a run that finds no HTML in `web/`, and
`src/tests/hostingConfig.test.js` in `frontend_unit`. There is no hand-run
accessibility audit or screenshot capture any more; both went with the marketing
site.

**Operationally:** a green CI run is *not* evidence that anything shipped.
`verify-shipped` reads the deployed SHA back off the live site, and the live
commit is always readable without credentials at
`https://truckerapp-system.web.app/release.json`. Before merging a pipeline
change, run `npm run check:ci-plan`, then **watch the real `main` run to
completion** — a PR never deploys, so it cannot exercise the changed path.

---

## 14. Where to read more

| Topic | Document |
|---|---|
| Rules for AI agents, and their topic rules | [`AGENTS.md`](../AGENTS.md), [`.claude/rules/`](../.claude/rules/); history in [`archive/`](./archive/) |
| Architecture patterns | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Product positioning, capability claims | [`PRODUCT.md`](../PRODUCT.md) |
| Collections, fields, access summary | [`docs/firestore-data-model.md`](./firestore-data-model.md) |
| Callable ↔ frontend map | [`docs/callable-frontend-map.md`](./callable-frontend-map.md) |
| Feature flags | [`docs/feature-flags.md`](./feature-flags.md) |
| Guest/public security posture | [`docs/security-posture.md`](./security-posture.md) |
| Shared AI platform | [`docs/ai-platform.md`](./ai-platform.md) |
| Automated blog | [`docs/news-and-insights.md`](./news-and-insights.md) |
| Hosting, releases, promotion | [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md); the owner's pre-release check is [`docs/RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) |
| Credentials and integrations inventory | [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md) |
| Operations, alerting, retention | [`docs/production-readiness-runbook.md`](./production-readiness-runbook.md) |
| Historical record reconstruction | [`docs/application-record-reconstruction-runbook.md`](./application-record-reconstruction-runbook.md) |
| Design-system standard and open decisions | [`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`](./SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md) |
| Public-site visual specification | [`DESIGN.md`](../DESIGN.md) |
| Manual signing-room device QA | [`docs/qa/edoc-mobile-document-first-qa.md`](./qa/edoc-mobile-document-first-qa.md) |

**`README.md`** is the getting-started guide and documentation map. For what the
application is and does it defers to this brief; this brief and the code win.

---

*Keep this brief true. See the permanent rule at the top.*
