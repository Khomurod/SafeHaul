# SafeHaul — App Brief

**The single orientation document for this application.** Read it before you
change anything; update it when your change makes part of it untrue. It says
what the application is and why it behaves the way it does — how it works now,
not every file. Deep detail lives in the runbooks under [`docs/`](.); the
history behind these rules — findings, incidents, measurements, review rounds —
is in
[`docs/archive/app-brief-2026-10-02.md`](./archive/app-brief-2026-10-02.md).

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
| React SPA | `src/` | React 19 + Vite 8 (Rolldown) + React Router 7 + Tailwind 3.4. Builds to `dist/` |
| Cloud Functions | `functions/` | Node 22, **mixed v1 and v2** |
| Firestore rules | `src/firestore.rules` | Deployed from here, not the repo root |
| Storage rules | `src/storage.rules` | |
| Public site | `web/` | Hand-written CSS, **no build step, no framework**. Serves the server-rendered blog's assets and a standalone privacy page, and redirects `/` to `/news`. |
| Design system | `src/design-system/` | Business-neutral visual contract; see §11 |

**Three communication patterns**: (1) **direct Firestore
SDK** (`onSnapshot` / `getDocs`) for dashboards, lists and most CRUD, secured by
rules; (2) **callable Cloud Functions** for anything rules cannot express —
guest intake, third-party APIs, credentials, cross-tenant admin;
(3) **Firestore triggers + scheduled jobs** for stats, PDFs, notifications and
maintenance (§8).

Routing is **manifest-driven**, not hand-edited JSX:
`src/app/routes/appRouteManifest.js` (public + top-level protected) and
`src/app/routes/companyRouteManifest.js` (company workspace **and** its sidebar
— one source of truth, so they cannot drift). Add routes there, not in
`App.jsx`.

**Startup** (`src/app/startup/`): an unloadable Hosting config
(`/__/firebase/init.json`) shows a reload screen; a tab whose files a release
removed reloads once, only when `/release.json` names a SHA other than its
`VITE_RELEASE_SHA`. Sign-in returns to the page asked for, else sends a
Super Admin (by the token's role) to the owner panel and a company member to
the dashboard; an account in no company (a removed member keeps the login)
gets a no-access screen with Sign out. The driver application (routes below)
waits behind one start-screen placeholder, `ApplyPagePlaceholder`, and asks for
its screen's code before React renders (`warmApplyScreen.js`); other pages
keep the branded loader; before that `index.html` shows the mark (all routes).

### Public (unauthenticated) routes

`/apply/:slug` · `/interest/:slug` (legacy redirect to apply) ·
`/sign/:companyId/:requestId` · `/verify/:token` · `/review-change/:token` ·
`/sandbox/apply` · `/sandbox/transfer-success` · `/developers/api`

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
the SSN (masked), ZIP and date of birth open the number pad. The SSN, previous
addresses, employers and the FMCSA lookup set `autocomplete="off"`, which some
browsers and password managers ignore. **No answer opens the phone's own date or
time dialog** (it can lack Set): times are lists, hours and numbers are text.
Employment and school dates are a month and a year (`YYYY-MM`, as on FMCSA's
form); every reader accepts older full dates. The auto-fill CDL photo is the CDL
front, even when unreadable, unless the company hides that upload (then it is
read, not stored); the AI fills only empty fields. Edit on Review, then Continue,
returns to Review; the submission pre-flight and the server still check it all.

**The company shapes what the wizard asks, without code.** Company Settings →
Application form has four tabs: *Questions* (show / hide / require the DOT
questions, plus custom ones), *Rules* (§5), *Agreements* (versioned legal
wording, saved on their own) and *Integrations* (optional PSP-report and MVR
import). Qualifications asks 49 CFR 40.25(j)'s drug and alcohol question
(pre-employment, past two years), kept apart from the broader one it replaced;
a draft lacking its answer goes back there.
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
draft (a phone with or without +1), then offers to continue or — behind its own
destructive confirmation — delete it and start fresh. A failed or unmatched
lookup is indistinguishable from "nothing exists".

### Carrier-started applications

**A carrier can start an application for a driver.** Unfinished applications →
**+ Start an application** offers **Let AI read the documents** (licence,
medical card, PSP report, motor vehicle record; the reader prefills) or **Fill
in manually** (documents attach unread). In one editable form the recruiter
enters the driver's email or phone — the identity keying the draft and its
application; either suffices, each is format-checked — corrects the reader, and
has SafeHaul email the driver the link (**Email it to the driver**, to the
application's own address; the screen shows where, masked, never the link) or
copies one. The driver lands in the ordinary wizard with the answers, adds
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
`proposeApplicationChanges` skips them; the dossier also locks every field off
the server's allowlist (§5).

**The document reader** extracts text in the recruiter's browser — a PDF's text
layer, else Tesseract OCR (skipped if it cannot start within a minute), else
page images (a photo re-encoded like a page) for the vision AI — and only that
text or those images leave the browser. Any subset of the four documents is
valid; the text task shares 16,000 characters among them and the summary names
one read only in part. A read is up to two minutes per pass, twice; a failed
second pass falls back to the first, and the second wins where it succeeds.
`useApplicationPrepDraft.applyExtraction` merges into the answers *as they are
then*, so anything typed meanwhile is kept (and reported). A result is not
applied if the applicant or document set changed during the call.

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
download URL; views re-sign from `storagePath`, and the dossier and
`useSignedUploadPreview` (a 15-minute URL from `getSignedGuestUploadUrl`, which
authorizes it) reuse a link 10 minutes. `not-found` says the file is gone; any
other error offers a retry, the row still attached (gates key on presence).

**A custom "file upload" answer is the file:** `{ name, storagePath }` in
`customAnswers`, recorded only once the upload lands (answers from before
2026-10-02 hold only a filename). Every renderer (review, snapshot, PDF,
dossier) shows the name, even for a deleted question; the dossier's
*Supplemental Questions* has **Open file** (`getSignedApplicationFileUrl`,
on press). Deleting the application deletes the file (only in
`guest_uploads/`; §12).

**An upload shows its real progress and a Cancel**; Continue waits for it. 45 s
without progress stops it, 20 MB or more is refused before sending, a failure
is said in plain words (beside a custom question, with **Try again**), and the
wizard keeps a landed one locally at once. Photos over 2.5 MB, the auto-fill's
too, go as JPEGs at most 2400 px a side.

### Unfinished applications workspace

`/company/drivers/unfinished` (*Unfinished applications*) lists every
application started and not submitted, by either side, with **+ Start an
application** first. A call to make, not an ATS record: it stays out of the
pipeline, reads `listApplicationDrafts` alone (one document, one row), and rows
never carry answers (`toCompanySummary`). A search and counted filters sit above
it; a row gives its step, status, last activity and days left
(`unfinishedWorklist.js`), as a card on a phone. **Copy link** makes and copies
a link, **New link** replaces one sent, **Email link** has the server email it to
the row's own address instead (a row without one says so); on answers the driver owns, its opener
must prove an identity no SafeHaul screen shows a recruiter (§5, §12).

| Started by | Status | A recruiter may… (`unfinishedRowActions.js`) | A Company Admin also may… |
|---|---|---|---|
| Company | `prepared` | open and keep editing (`getCompanyPreparedDraft`); mint the driver's first link | delete (`purgeApplicationDraft`) |
| Company | `sent` | open and keep editing; mint a replacement link | delete |
| Company | `driver_in_progress` | open the record — the server withholds the answers (`companyMayReadAnswers`); mint a continuation link | read and correct the answers (`getApplicationDraft`, `saveApplicationDraftEdits`); delete |
| Driver | `in_progress` | mint a continuation link; nothing else (`getCompanyPreparedDraft` answers `not-found`) | read and correct the answers; delete |

The admin column answers only `assertCompanyAdminStrict` and is audited.
**Delete** shows what goes, then removes answers, links, ticked
same-driver drafts (same identity, email or phone) and uploads nothing else
uses, none a submission marked or older than 2026-10-12; its tokens learn
"removed" (a device copy can still submit).
**Edit answers** covers every page but what only the driver gives
(`driverOnlyFields.json`), and never overwrites an answer changed since loading.

### Pipeline, documents and operations

**Recruiter pipeline (ATS).** Applications and leads are separate collections
under the company with the same tooling: status funnel, activity log, notes,
documents, assignment. Leads come by quick-add, CSV / spreadsheet import, the
Facebook Lead Ads webhook, or a referral quick form. **Driver referral links**
(Referral Links page: any staff member makes one; admins see all, others
theirs; deactivate only; `referral_links`, team-only). `/apply/<slug>?ref=`
offers, in the intake chooser's place, the quick form (names, phone, email,
required contact consent) or the full application. A quick-form lead
(`submitReferralInterest`) or an application with `referralCode` carries
`referral` (shown in the dossier) and goes to the link's creator while on the
team, who is notified; a carrier-prepared application goes to its preparer (§5).
**A lead who applies is linked to the application** (`onApplicationSubmitted`,
`shared/leadApplicationLink.js`): the company's lead with the same email (trimmed,
lowercased, never a placeholder; leads keep `emailNormalized`), else the one lead with
the same phone digits. One lead at most, never merged; the lead keeps its stage, gets
`applicationId`/`appliedAt` and an Activity line, the application `fromLeadId`, and an
unassigned application goes to the lead's recruiter while on the team, who is told
once (not when it is already theirs). The dossier opens one from the other; deleting
either removes the link, and a lead whose newest application is deleted points back
at an earlier one it applied with.
**The bell.** A status change on an assigned application tells its assignee only (an
unassigned one, or one whose assignee left, the team); assigning an application or
lead tells the new owner; an import that creates assigned leads tells each recruiter
once how many; a hired driver's DQ deadline, its assignee or the team (§8). Nobody is
told about their own action, and read state is per person.
Name search starts at two letters, in the lists and the
template picker; email, phone, confirmation number and id search stay exact.
**A call moves the stage only by the owner's table** (`useCallOutcome.js`): Interested →
`Interested`; Not Interested and Wrong Number → `Declined` (archived); every other result,
and any hired, terminated or already-declined record, keeps its stage. Every call is kept
as the last call (`lastCallOutcome`, `lastContactedAt`). Older `Contacted`/`Attempted`/
`Disqualified` values stay valid.

**E-documents and signing.** Recruiters build envelopes with placed signer
fields (optionally AI-suggested); recipients sign **with no account** at
`/sign/:companyId/:requestId`; typed values (no drawn signature) wait in a
local draft. The server sends the link; a corrected email or phone gets a new
one, voiding the old, and a channel Correct turns off loses its send status. A
correction or Void changes a request only while it is `sent` (checked in the
write's transaction), so one signed meanwhile keeps what was signed. An
opted-out number gets no text: beside an email a note (`smsStatus: 'skipped'`), alone
a failed send. Signed envelopes are sealed into tamper-evident PDFs, once:
a delivery that finds the request no longer `pending_seal` changes nothing. The
bell then tells the sender (`senderId`; one nobody sent: its application's
recruiter, else the team) "Document signed" or "Seal failed", once per request and
outcome, title and signer name only. A document filled from an application uses only
listed fields (`APPLICATION_TOKEN_FIELDS` in `functions/shared/postApplicationRequest.js`,
the browser's copy `src/config/applicationTokenFields.json` held to it by a parity test):
never SSN, signature, consents, ids, the confirmation number or links.
The template wizard's picker finds applicants and leads, each labelled. A document
sent to the one picked is linked to it (`sourceApplicationId` or `sourceLeadId`,
while the recipient's name is still that record's) and fills those fields from it;
the email is the one typed. A sealed document linked to a record is filed once in
its DQ file (`dq_files/signed_<requestId>`: the sealed PDF's path and checksum, never
a copy), opens through `getSignedDocumentUrl`, and removing it only hides it. A seal
that failed, or has not finished ten minutes after signing or the last retry, can be
sealed again from the document's details (**Retry seal**, `retrySealDocument`): it
seals what the signer submitted, records the attempt in `sealAttempts`, never reseals
a signed document, and the signer's images stay until a seal succeeds.
**A driver's signing documents** are listed in the dossier's **Documents to sign** tab
(id `documents`): the requests linked to the record, and each required post-application
form no request carries yet as *Not started*; *Link expired* (unsigned, `expiresAt` past)
and *Not delivered* (unsigned, a send failed; outranks it) are derived.
A post-application form is one document per application and form
(`postapp_<application>_<template>`), made by whichever comes first: the thank-you
page (it opens the form, never emails or texts it) or a team member's **Send to
driver** (`sendPostApplicationDocument`). That emails a usable address and texts only
after the driver's explicit "Yes" (`sms-consent`; the opt-out list as for every
signing text, and an opted-out number is not reported as texted); with neither it says why
and sends nothing. A link the server builds goes only to one of the app's own sites
(`shared/appOrigin.js`), whatever base URL a browser sent. One transaction decides:
a new request is sent by the creation triggers, one never sent gets its flags turned
on and the correction trigger sends it with seven more days. A link already sent is
not sent again (Remind does), a signed form is reported, a voided one refused.
*Link expired* (`isLinkExpired`) is never stored, so the numbers count it as awaiting.
**Remind** (`remindSigner`, from a document's details and the dossier)
sends an unsigned document's link again on each channel it was sent by, with seven
more days: one per ten minutes, claimed in a transaction and recorded in `reminders`;
an application's driver is texted only after "Yes"; the answer names any channel that
failed, a skipped text as a note. A document shared only by copied link cannot be reminded (Correct adds a
channel). Once a day (11:00 Central) **one automatic reminder** goes to a document
still `sent` and created 3 to 7 days ago (`createdAt`, which Send to driver does not
move; oldest first) whose link has not run out (`remindUnsignedSigners`), by Remind's rules
(`shared/signerReminder.js`), counted in `reminders` as the system's
(`lastBy: 'system:auto-reminder'`) and claimed once (`autoReminder`) before anything is
sent; a document whose signer got a message about it in the last day waits a day, and a
company with E-Docs off or deactivated gets none. Every 15 minutes **the required
post-application forms go out by themselves** (`autoSendPostApplicationForms`, owner
decision В6): for an application the driver submitted through the public form
(`lifecycle.processedViaFunction`) 30 minutes to 2 hours ago (`submittedAt`), each
required, enabled form goes by Send to driver's rules and transaction
(`shared/postApplicationSend.js`), from the company (`senderId: 'system:post-application'`,
which the bell reads as nobody, so a signed form tells the application's recruiter, else
the team; `source: 'post_application_auto'`); a form signed, voided, being submitted or
already sent gets nothing.
A **company signature** (`company_signature`) is an image the team uploads to
`secure_documents/{companyId}/originals/company-signatures/` and places on a
template or one document (each may replace its template's); the signer sees it
fixed (its box reads "Company signature" when the image cannot load, and never
blocks signing), the seal draws it from that file (missing → `error_sealing`)
and keeps it. Nothing emails a signed PDF by itself: for a signed document with
one, a team member reviews and approves **Send signed copy**
(`sendSignedDocumentCopy`, claimed once in `signedCopy`; only to the address the
approval showed, refused if a correction changed it; checksum-checked; company
SMTP; a failure, or a send unfinished after ten minutes, may be approved again). Signing is unlimited and not billed per envelope. The Documents workspace keeps
the newest 100 requests live, older on request; past that, its numbers are server
counts and a live list holds those needing attention (`firestore.indexes.json`): an
unsigned document (`sent`, or the older `opened`) whose send failed, or a failed seal; a
signed or voided one leaves by itself, and its details keep the old error. Each
Overview number opens its list; a Needs attention card opens the document: its cause in
plain words (`deliveryFailureCause.js`) and, while `sent`, **Fix recipient and resend**
(inline: Correct's checks and write for the recipient alone, on the request's current
fields and title; refused when it would send nothing while a failed send stays on, which
Resend sends again), **Resend** (Remind) and **Void** (records
`voidedBy`/`voidedByName`, keeps delivery errors, warns a `postapp_…` form is never
resent; never Delete). Only admins see a template's Delete; the forms tab is
*After-application forms* (`?view=forms`).

**Date Signed is stamped when the signer submits.** Other prefills (name,
address, date of birth, hire date, licence expiry) resolve at sending; the
`current_date` binding travels as an unresolved `{{current_date}}`, stamped once
server-side by `submitPublicEnvelope` — recruiter envelopes, templates and
post-application documents (`functions/shared/postApplicationRequest.js`) alike,
restamping a still-*bound* field even if an older send baked in a date.
`getPublicEnvelope` stamps the same value for display and returns its instant
(`serverTime`) and zone: screen and sealed PDF share the server clock, read in
the zone the signer's browser names (`signerTimeZone`, else **UTC**; in
`auditTrail`); before submitting, the room re-checks it and, if the day moved,
updates any signing-date field and asks the signer to look again. A bare
`{{current_date}}` in other **locked** text is not re-checked (matching would
rewrite a hire date that is today): it seals correctly, only its preview can lag
a day. One definition in `src/features/signing/utils/signedDate.js` and
`functions/shared/signedDate.js`: change both.

**Previous employment verification (PEV).** Any member of the company's team sends a
request to a past employer, who answers in a token portal (reminders §8) and signs drawn or
typed (`TEXT_SIGNATURE:<name>`; `signature.js` refuses others). Violation details
are required after a violation; a rehire "No" reason, the follow-up testing plan
and non-DOT-recordable accidents are optional, kept only after their questions.
Email and reminders attach a request PDF (`requestPdf.js`, also in the DQ file):
SSN last four, no link, a signature only under the release the driver signed (as
in VOE): the v3 statement naming this employer, from `submissionRecord` with its
own signature, else the certification's (`previousEmployerRelease.js`; none before
2026-01-23), dated by the driver's own day (`signatureDay`), else UTC.
Up to 5 CC (Settings → Email) get it too. A request whose first email fails is
`send_failed`, never reminded nor marked no-response; **Resend** supersedes the
employer's earlier live request (the portal then refuses its link). **Upload
Result** (any status short of Completed, so also a late answer) records through
`recordManualVerificationResult`: the row reads Completed, the request is completed
so reminders stop, the no-response mark stays in history. Every result, from the
portal or uploaded, is filed once in the DQ file and opens through
`getSignedPevUrl`; the row shows when the employer first opened the link. On an
answer and at day 30 the request's sender (`createdBy`, else the team) gets one
bell notification naming only the employer and the driver.
Every attempt is logged on the request (`attempts`): the send or a failed first email,
each reminder and whether it went out, the first open, the answer, an uploaded result,
the day-30 mark, and the calls, faxes and notes a recruiter adds with **Record attempt**
(`recordVerificationAttempt`: a day and a short note, against the employer's newest live
request, at most 50). Each employer card lists its newest three history entries; View
History holds them all. At day 30 the log is printed as a one-page record of attempts
(the parties, dates, each attempt's outcome and who made it; no legal claims), stored
beside the request PDF, linked from the no-response entry and filed once in the DQ file.
No PEV PDF prints the portal token; the result names the request by its reference.

**DQ file: the original's consents.** The DQ row of the preserved original
application lists, on request, each agreement the applicant answered (accepted and
signed, declined, not recorded, or certified only within a combined acknowledgement),
with version, time and signature type. It reads the frozen `submission/{snapshotId}`
once, when first opened, through the Application tab's presenter; the PDF still opens
only through the audited `getApplicationOriginalPdfUrl`.

**Driver-approved corrections.** Company admins cannot silently rewrite a
submitted application (§5). The review link is emailed by the server (**Email
review link to driver**) or copied.

**Company setup (dashboard).** For a company admin, read once when the dashboard
opens: what is not set up, each linking to its page — company email not connected or
not verified, no texting line, no contact email for PEV notices, no post-application
form, a form whose company signature has no image or whose template was deleted (PEV
copies are a hint). Ready, it is one line; others see nothing.

**Needs attention (dashboard).** For admins and the team, read once when the dashboard
opens (kept two minutes) through `getDashboardAttention`: signed documents whose seal
failed, documents unsigned for more than 7 days, PEV requests still waiting for the
employer and those marked no response, drivers with company changes to approve
(applications and leads), unfinished applications removed within 5 days, and hired
drivers whose DQ documents expire within 30 days or have expired (counted exactly on the
applications status + `dqExpiresNext` index, the five earliest named, each opening the
driver's file). Each row links to the page that shows those records where one exists
(PEV and changes live in each driver's file). Counts only, scoped to the company; rows
of a feature that is off are left out. A failed count says "could not be checked";
with nothing to show it is one calm line.

**DQ file: what's in it, valid-until dates.** The DQ tab opens with *What's in the
file*: the application, CDL, medical card, MVR, the employers of the three years before
the application (each answered, no answer after the attempts, waiting or not requested),
road test and full Clearinghouse report; the PSP report and the annual items are
optional and never counted. It says what the file holds, not whether it is compliant,
and the sidebar's DQ marker follows it. A CDL, medical card or MVR uploaded by the team
may carry a valid-until date, and a CDL, medical card, MVR or TWIC record may have it
set or cleared (logged); expired, or expiring within 30 days, is judged by the UTC day.
The driver's uploads have one place, the DQ File tab, which lists and opens them.

**Bulk SMS / email campaigns.** Audiences over leads, sent by a session-based
worker (§8); the carrier connects and pays its own messaging provider. No
two-way threads or drips. Campaigns lists the newest 50 drafts and campaigns
(more on request) and every live one (Total Outreach: a server sum once
incomplete). A launch marks its draft (`launchedAt`, `sessionId`): kept, off
Drafts; opened, it links its report, not Launch.

**Super admin operations.** Dashboard, companies (features, SMS), features
overview, users, unified driver DB, environment vault, AI providers, blog,
website leads, health, releases, Maintenance (writes ask first).

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

**Offline-tolerant submission.** Submissions queue in IndexedDB with backoff
(deterministic IDs make replays safe) and send from this device only, while a
site page is open, so the screen says *Not sent yet* and to keep it open. A
replay waits out the page's own attempts and sends its `seenRevision`; its end
reaches the page in any tab (`useQueuedApplicationOutcome`): the confirmation
number, or why not (refused, or out of attempts) and where to fix it, kept for
that draft's next open if none was.

**A refusal is not a failure to deliver.** Only a submission that never reached
the server is retried and queued: a dropped connection (reported as `internal`),
timeout, cold start. A server refusal (`invalid-argument`,
`failed-precondition` and the other permanent codes in `publicApplyRefusal.js`)
stops retries, removes the queue entry, shows the server's sentence, reads the
company's settings again and goes to the page its issues name (a missing upload
or SSN's too); the draft is untouched for correction. A rate limit is said in
the server's words, never queued.

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

- **Wording, not identity.** The prefix picks the message: `discard:`,
  `submit:`, or `removed:` once the server tells a token this tab holds that
  the company deleted it (`draftRemoval.js`); unprefixed reads as discard. It
  never names the application (a draft's name is a slot generation; two tabs on
  one application mint different ones), so every tab acts on any change
  (accepted).
- **Start Over** deletes the server draft, resume token and local copy — local
  *before* the mark, since a mark failing on a full quota after the token is
  gone would let another tab recreate the application — clears only its own
  application (empty or unnamed slot yes, another's named slot no), and drops
  the token only if still the one it retired.
- **Reacting tabs:** restored answers return to a fresh start, typed ones too
  on `removed:` (else they stay as a new application); a submitted application
  is never disturbed (success screen, confirmation number, documents checklist),
  a queued one only by `removed:`, since the queue drops it. At start-up
  the profile load captures the reset counter before fetching and skips the
  restore if it moved, and compares the mark as well (a mark older than the
  listener fires no event).
- **Submission re-checks** before validation and before every callable attempt —
  by mark, and by reset counter (an event during an in-flight submission is
  exempted and adopts the mark, so the counter is bumped first) — removes the
  queue entry when it abandons, and checks once more after the final failure,
  before the queued screen. The resume lookup's reply is likewise checked before
  any prompt.
- **Landing closes the draft:** write the `submit:` mark, drop the resume token,
  and abandon this tab's queued saves (a token-less one would recreate the
  draft). A queued submission does this when its replay lands (the slug travels
  with the entry), never on a transient failure — and is refused if the mark
  changed since Submit (recorded then, not at queueing; this also makes a failed
  dequeue harmless; an unrelated change drops it too, accepted).
- **Draft names make a late close safe.** Each draft has an opaque name minted
  at creation and kept through every write; the queue entry records it, and a
  close happens only while storage still holds that draft. A write keeps the
  name it holds, mints one for a new application and leaves it alone for a
  confirmed sync; the submitting tab never reads it back from storage. The
  write counter (restarts at zero) and the token's applicant key (shared)
  cannot substitute.
- **Edges.** With no draft stored the mark is still written; a pre-name draft is
  left alone; a direct submission clears only its own draft (mark written
  regardless); a reacting tab clears the stored copy only if it had restored it
  or read `removed:`; Start Over, a close-out, "apply again" and reacting to a
  discard all forget the name.

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
  stops a submission.

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
PDF on download.** Given 15 s at most (the unfinished draft is deleted first), one
cut short is `pdfPreserved: false`, left to `reconstructHistoricalApplications`.

**Legal agreement wording is versioned and frozen** in
`functions/shared/legalAgreements.js`. Current `v3` (`v1`, `v2` stay
submittable for drafts that accepted them; a screen naming no version gets `v2`)
follows primary sources: FMCSA's PSP language word for word, an FCRA disclosure
and authorization only (the CFPB summary of rights is a version `link`, recorded
only if shown), FMCSA's limited-query Clearinghouse consent (a full query is
consented in the Clearinghouse), and from v3 the **previous employers' release**
(`employerReleaseAgreement.js`): a statement per listed employer (40.321(b) bans
blanket releases), not shown or frozen with none, accepted only for the
employers on screen (`employersShown`), not company-worded. The MVR
authorization is answered on the Violations step (`consent-mvr`); on Consent
each other agreement has its own page, then the certification ending with the
exact 391.21(b)(12) sentence, and the signature. An acceptance counts only at
the version on screen and binds the submission to it. **An acceptance's IP is
the one the server saw**, never the browser's claim. `legacy-1` bodies are a
**frozen forensic record — never edit them**; `clearinghouseConsent` has no
`legacy-1`, so reconstruction cannot attribute a consent nobody gave.
**Applications from before the MVR authorization have no acceptance for it**,
and nothing back-fills one.

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
mirrors `src/config/applicationRules.js` exactly
(`applicationRules.test.js`; date helpers in `applicationDates.js` likewise),
driven by `functions/shared/applicationRulesCatalog.json`, which the settings UI
also renders. `evaluateApplicationRules` runs in each wizard step as answers
change, in the final pre-flight (sending a resumed applicant to the first
failing page) and in `submitGuestApplication` (`assertApplicationRules`, same
sentence). Super Admin sets any company's rules, Company Admins their own. The
rules: previous address when under three years at the current one · which
experience options are offered (Step 2, vehicle lists) · which vehicle
categories show and their wording (stored keys never change; a hidden category's
saved value still displays; each list offers "None" first, one box sets all) ·
expired CDL and expired medical card, each allow / warn / block · require
previous-licence details · MVR authorization optional / required (a Yes needs
its recorded acceptance evidence, so only Yes waits for the wording) · require
violation and accident details on Yes (accidents: fatalities, injuries, hazmat)
· employment history allow / warn / block with a configurable minimum of years ·
require a felony explanation · Hours of Service statement off / on (exactly the
seven days before the reference day: a stale week in a resumed draft is refused
and re-asked; a driver never on duty gives no relief).

- **On by default:** previous addresses (3 years back; the server asks for one
  until it is strict), other-state licence, violation and accident details, the
  felony explanation; other defaults keep the old behaviour (`warn` coverage).
  An impossible date (30 February) is refused whatever the configuration.
- Legacy records with violation or accident rows but no Yes/No answer read as
  Yes. An explicit No drops everything it revealed — rows *and* conditional
  fields such as the licence-revocation, conviction and felony explanations — at
  review, pre-flight and server (`normalizeApplicationAnswers`, per the
  catalog's `conditionalAnswers`); a field missing there survives a No.

**The reference day is the applicant's, within a day of the server's.** The
browser judges "the last seven days", "expired" and the employment window's
month on the device calendar; the server runs in UTC, and for part of every day
the dates differ (US evenings). A submission — and a queue replay, from its
entry — carries `applicantToday`, the day Submit was pressed;
`applicantReferenceDay` (`functions/shared/buildApplicationDoc.js`) uses it when
it is a real date within a day of the server's, else the server's clock — so a
clock wrong by more than a day gains nothing.

**Employment history must cover 36 months by default** (49 CFR 391.21(b)(10)).
Employment, unemployment, schooling and military service all count; a gap is
only a gap when nothing explains it. `employmentHistoryMinimumYears` (1–10,
default 3) sets the window; `employmentHistoryEnforcement` ignores, warns once
or blocks. The calculation is calendar-month based and pure (injected reference
date), so a recorded result never drifts. The page asks what (b)(10)–(11) ask:
every employer of three years and, for a CDL job, the CMV employers of the seven
before (and says so when the company's period is longer). The reason for leaving
is required, and each employer not ended before the three years answers the two
(b)(10)(iv) questions (`subjectToFmcsrs`, `subjectToDotTesting`), never
pre-selected. Continue lists what each row lacks, each line a link to its field;
the pre-flight checks too (a resumed draft goes back), not the server. A lookup
pick fills no unsendable email and clears what the last pick filled.

**Change both or neither.** The SPA cannot import the CommonJS backend, so
coverage exists twice — `functions/shared/employmentCoverage.js` and
`src/shared/utils/employmentCoverage.js`, proven identical against
`employmentCoverage.vectors.json` — as does `searchNormalization`. The *data*
files `applicationSections.json`, `applicationRulesCatalog.json` and
`applicationRules.vectors.json` are genuinely shared, imported from
`src/config/`.

**A state is stored as its full name**, from `src/shared/utils/usStates.js`
(fifty states, DC and five territories) in every picker; an address, accident or
employer also lists Canada's and Mexico's (`northAmericanRegions.js`).
CDL auto-fill, MVR import and the carrier's AI reader convert printed postal
codes, the FMCSA lookup with the row's country; an unmatched value is left for
the driver, never stored (a `<select>` would show "Alabama" while validation
passes). A stored value no list names shows as itself.

**A phone number is a US number: ten digits, or eleven starting with 1**
(`isValidPhone`), on page one, in the final pre-flight (back to page one) and in
the carrier's editor.

### Carrier-prepared applications and continuation links

**The preparer owns what the driver submits.** `submitGuestApplication` reads
`preparedBy.uid` from the draft (never the payload); while that person is on the
team it writes `assignedTo`/`assignedToName` in the transaction that files the
application, only if nobody is assigned, and tells them once. A recruiter or
referral link in the same submission does not reassign it.

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
the identity tier, with `status` and `origin` untouched. The exchange's fallback
scan has no `origin == 'company'` filter, so it needs no `origin`/`updatedAt`
index; no query uses that index any more.

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

**A dead link says so; starting fresh is a choice.** `publicApplyInvite.js`
classifies the exchange's refusal by what the driver is told. **`unopenable` is
one bucket on purpose** (wrong, expired, submitted, superseded, discarded: the
server answers alike; a deleted draft's own link hears `removed`); other causes
split only where the driver can act, **retry first for transient ones** (a
silent fall-through would skip the claim and its locks).
`ApplyLinkProblemScreen` sits below the success screen and above the intake
chooser; `resolveApplyStatusScreen` (`PublicApplyScreens.jsx`) owns that order.

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
**canonical original** until each field resolves, so exports show originals.
The driver approves, rejects or corrects each, none preselected, through a
token link (`/review-change/:token`, 30-day TTL, newest only; `deliver: 'email'`
emails it to the application's own `email`);
`hasPendingCompanyChanges` clears once all are resolved. Only callables
write `pending_changes`. *Edit Application* gives a box only to the fields on the
server's allowlist (`functions/shared/applicationEditableFields.json`, read by both
sides): names, date of birth, SSN, contact details, address, licence, experience
and previous employers. Everything else is display-only, and the edit bar says
why; the result names each field the server left out (no change, or not the
company's to change).

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
mirror. Its `attempts` log is authoritative too; the row's history carries a short entry
per attempt, never the error text, the token or an address.

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
`Terminated`, `Declined`), plus `Interested`. The dossier's status picker offers
only those, and the record's own value when it is a legacy one: one that names a
stage takes its place under the stage's name (`New Lead` and `New Application` read
New, `Approved` Hired, `Rejected` Declined), any other keeps its stored name.
Legacy values stay stored and valid in the rules. Creation defaults differ: leads get `New Lead`,
applications `New Application`. Application lists show one name per group
(`applicationStatusLabel`: `Approved` reads Hired); the value stays. Rules
validate transitions and **cannot import JS**: a rename edits them too.

**Tenant binding is immutable.** Rules require `companyId` to match the path on
create and never change, so no record claims another company.

**A deactivated company** (`isActive: false`) takes no applications, passes no
server staff check, drops out of its staff's tokens (§8) and closes their workspace; never a super admin's.

---

## 6. Permissions and access rules

Authorization comes from **Firebase Auth custom claims**; the UI, routes,
Firestore and Storage rules and the Cloud Functions
(`functions/shared/superAdmin.js`) use the same signals:

- `globalRole: 'super_admin'`, under `roles` (from a membership) or at the
  token root.
- `roles[companyId]` = `company_admin` \| `hr_user` \| `recruiter`.
- `companyTeamIds`, a convenience claim. Storage rules accept **either** it or
  `roles[companyId]`: either can lag until the client refreshes its token.

Rule vocabulary: `isSuperAdmin()` · `isCompanyAdmin(companyId)` ·
`isCompanyTeam(companyId)` (admin + hr_user + recruiter + super admin) ·
`isOwner(uid)` · `readerSharesCompany(companyIds)`.

**Things that are easy to get wrong:**

- **There is no super-admin global wildcard** in Firestore rules, by design;
  super admin is granted per collection.
- **Cross-tenant profile reads are closed.** Staff may read a `drivers/{id}` or
  `users/{id}` profile only when they share a company with it, via
  server-maintained `companyIds`. Listing driver profiles is owner/super admin
  only.
- **Team changes go through the server.** Only Super Admin writes `memberships`
  directly; a company admin uses `createPortalUser` (an existing account keeps
  its password; no Super Admin) and `deletePortalUser` (membership only).
  Changing or deleting another person's login is Super Admin only.
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
  default-deny; the AI, blog and draft paths say `allow read, write: if false`.
  `environment_audit_log` is unreadable **even by super admins**, so it cannot
  be read around or forged through the callable.
- **Guests never write Firestore directly**; guest application creates go only
  through `submitGuestApplication`.
- **Documents are never public URLs.** Every file link is server-issued, single
  purpose and checked against company membership (`getSignedDocumentUrl`,
  `getSignedApplicationFileUrl`, `getSignedGuestUploadUrl`, `getSignedPevUrl`).
  Stored URLs expire or are absent, so views re-sign at view time.
- **The SMS opt-out list** (`companies/{id}/blacklist`, callables only): any team member lists and adds a
  number, only a Company Admin removes one, and never from the global list. Its screen is in Settings (admins).
- **Send to driver, Remind, Retry seal and Record attempt are team actions** (any company
  team member, `assertCompanyAccessForRequest`): the application or request must be
  under that company, and Send to driver's template in its post-application list.

**Starting an application for a driver is company-workspace access, not admin.**
`/company/drivers/unfinished` is deliberately not `adminOnly` — a recruiter
holding a driver's file does this, and nothing it produces is filed. Its
callables use `assertCompanyAccessForRequest` / `assertCompanyAccess` (the
admin's read, edit and delete, `assertCompanyAdminStrict`) with per-user
fail-closed rate limits.

**Application configuration is split by sensitivity.** A Company Admin manages
Standard Questions, Application Rules, Custom Questions and Integrations
(`applicationConfig`, `applicationRules`, `applicationIntegrations` on the
company document, an ordinary admin update) and can read the legal wording in
force; publishing or reverting a company's agreement text is **Super Admin
only**.

**Per-tenant feature flags** live on `companies/{companyId}` as `features` and
`featureSchedules`. Keys: `pev`, `campaignsEnabled`, `eDocs`, `importLeads`,
`callTracking`. Semantics are **opt-out**: a missing key means *enabled*; only
an explicit `false` disables. `features` is stripped from the public profile
projection, and `/apply/:slug` is not gated by any flag. See
[`docs/feature-flags.md`](./feature-flags.md). Only a super admin changes them,
`planType`, `appSlug`, `isActive` or `status`.

---

## 7. Important integrations

| Integration | Purpose | Where credentials live |
|---|---|---|
| **Firebase** (Auth, Firestore, Storage, Functions, Hosting, Performance) | Everything | Project config |
| **RingCentral** (primary) / **8x8** (alternate) | Outbound SMS; logs omit the number texted | Encrypted per company in `companies/{id}/integrations/sms_provider`, decrypted server-side with `SMS_ENCRYPTION_KEY` |
| **Per-company SMTP** (Nodemailer) | All outbound email (logs omit the recipient); no platform-wide fallback sender | `companies/{id}/system_settings/email_config` (server only); password encrypted (`enc:v1:`), shown only by the vault's reveal. Company emails and campaigns share one reader (`functions/shared/smtpSettings.js`), with fallbacks for old tenants (`companies/{id}.emailSettings`, `integrations/email_settings`: keep until Data cleanup moves them) |
| **Facebook Lead Ads** | Inbound leads → company `leads` subcollection (switched off; §12) | Per company |
| **AI providers** | CDL auto-fill, e-doc field placement, blog, an applicant's own PSP/MVR read into *suggestions* where enabled (`extractApplicationReport`), and a recruiter's attached paperwork (`extractCompanyApplicationDocuments`) | Secret Manager via the frozen registry in `functions/ai/registry` |
| **Telegram** | Operator alerts (`watchAiAndBlog`) and release offers (`offerProductionRelease`) in the chat connected in Super Admin → System Health. Marketing-site bot **retired** (`LD-R3`; rollback caveat, token rotation: `docs/FIREBASE_HOSTING_RUNBOOK.md`) | Bot token: Secret Manager `SAFEHAUL_AI_ALERTS_TELEGRAM_BOTTOKEN`; chat, `approverId` (pressed Start; only their release press counts), watcher state: `system_jobs/platformAlerts`. `telegramWebhook` (header = token HMAC; release secrets; 120 s) keeps Starts in `…Inbox` (1-day TTL), runs release presses. Server-only |
| **Company API** (`companyApi`, read-only) | Another service reads submitted applications with a key made in Settings → API Keys (Company Admin) | Hash in `company_api_keys` (server-only); key shown once |
| **Socrata / Transportation.gov** | Employer lookup: name, trade name or USDOT, active first | Public app token |
| **GitHub API** | Promotion from Super Admin → Releases or the Telegram button (`runPromotion`). Reads and token minting give up after 15 s (shown as GitHub unreachable); the dispatch that starts a release has no limit of its own | GitHub App credential, server-only |

**Hard boundaries:**

- **No feature may call an AI vendor directly.** Every request goes through
  `functions/ai/` (task interface → capability-aware router → provider adapter →
  schema-validated response); `npm run check:ai-boundary` fails CI otherwise.
  Each request logs a transaction id and a per-provider timeline in
  `ai_telemetry` (Super Admin → AI Integrations → **Logs**). **Test** probes
  each claimed capability (throttled = untested) and logs as `manual`, never an
  outage; a full pass clears cooldowns. Health and cooldown are **per lane**
  (text / vision), each up to three versions, kept by `refreshAiModelLists`
  (**Model versions**); a code re-pin
  wins. One gone, off the plan or rate-limited rests; the next is tried while two
  slices remain. Document reads cap each attempt and skip a vendor's pause over
  5 s while another can serve. See [`docs/ai-platform.md`](./ai-platform.md).
- **Credential access differs by function generation; grant both.** 1st- and
  2nd-generation functions default to *different* runtime service accounts (App
  Engine and Compute Engine), so `roles/secretmanager.secretAccessor` is needed
  on both or one AI entry point reads a credential the other cannot. Super Admin
  → AI Integrations → **Check credential access** asks both, names the account
  in use, and reports a missing secret apart from an unreadable one.
- **SMS credentials are resolved by a factory, never inline.** `SMSAdapterFactory` fetches, decrypts and
  instantiates the right adapter. A *keychain* holds each line's JWT under its number (as typed with +, else US +1);
  `assignments` give recruiters a "From" line, else the main line. Every RingCentral request gives up after 20 s
  (`ringcentralSdk.js`, which also gives each SDK its own session), 8x8 the same; a send it never answered may have
  gone out, so it says so and is never resent automatically.
- **The company API reads only its key's company and logs each answer.** It
  serves the frozen record, not the live one; files need `documents:read`, the
  full SSN `ssn:read`, the PDF both (it shows the SSN). Each answer is logged in
  `api_audit` (90 days) before it is sent, or not at all. Five keys on per
  company, 60 requests a minute each, none if the company is deactivated; a record
  is listed a minute after its stamp; a reconstruction keeps its old date, so a
  cursor sync misses it.

**A Facebook page belongs to one company.** `connectFacebookPage` takes the
company from the client and authorizes it against the caller's per-company role.
A page bound to a user id (an old defect) is reclaimed when its admin reconnects
it; one held by another company is refused. The claim is a Firestore transaction taken *before*
the Facebook OAuth exchange (two simultaneous connects cannot both pass),
released if the connect then fails. Graph calls give up after 15 s. An event needs
Meta's `X-Hub-Signature-256`, compared in constant time; SHA-1 alone is refused.

---

## 8. Automatic and background behavior

### Scheduled jobs

| Job | Cadence | What it does |
|---|---|---|
| `enforceFeatureSchedules` | every 15 min | Auto-disables features whose `featureSchedules` entry has passed |
| `reconcilePublicProfilesSchedule` | every 60 min | Rewrites public profiles the `onWrite` trigger cannot reach (after a projection change) |
| `publishScheduledBlogPosts` | hourly at :15, America/Chicago | From 07:00, offers the day to one theme per run, in rotation, until its one article publishes |
| `processVerificationReminders` | every 24 h | PEV reminders at 5 / 15 / 20 days, each logged sent or not (a failed one is retried next run); at 30 days marks `no_response`, notifies the sender (bell), files the record of attempts (PDF, DQ file) and notifies the carrier (email, citing 49 CFR 391.23(c) and saying the record reached the DQ file only when it did): the good-faith record. Only live requests, each moved only while still live; never overwrites a Completed row |
| `autoSendPostApplicationForms` | every 15 min | For applications submitted through the public form 30 min–2 h ago (`submittedAt`, oldest first), sends each required, enabled post-application form by Send to driver's rules: a new request, or flags on for one the thank-you page opened and the driver did not sign; once per form through the transaction's `already-sent`, nothing written on the application. Skips companies with E-Docs off, deactivated or with no required form; no channel → skipped and logged. Stops after 4 min, and each run starts one company further on; ids-only logs |
| `remindUnsignedSigners` | daily 11:00, America/Chicago | One reminder for each `sent` signing request created 3–7 days ago (oldest first, its link not run out), once (`autoReminder` claimed in a transaction before sending; `outcome` sent/failed). Skips companies with E-Docs off or deactivated, a request messaged in the last day, and one with no channel or link (not marked; looked at again next run). A failed one is not counted or retried. Ids-only logs |
| `notifyDqExpiry` | daily 07:00, America/Chicago | For each hired driver whose `dqExpiresNext` is today or within 30 days (UTC day; Needs attention's query and index), one bell notice "expires soon", and one "expired" once the date has passed, until 30 days after it (first seen past it, only "expired"; an older date stays on Needs attention); a new date gets its own. Once each (id `dq_<stage>_<applicationId>_<date>`, looked up before the DQ file is read). Names the driver, the documents holding the date and the date, opens the dossier; for the assignee while on the team, else the team. No email or text. Skips deactivated companies; stops after 7 min, and the next day starts one company further on; ids-only logs |
| `reconcileDashboardStatsDaily` | every 24 h | Recounts each company's applications, leads and hired applications and sets the dashboard counters, marked `reconciledAt`; one that cannot be counted is logged by id and the rest go on |
| `reconcileCompanyClaims` | every 60 min | Fixes tokens a trigger run missed: removes a deactivated company's role (ending the session), restores an active one's |
| `checkSmsDeliveries` | every 10 min | Asks RingCentral about queued campaign texts |
| `cleanupOrphanedSignatures` | every 24 h | Retries deleting signature PNGs left after sealing, so signature-image PII does not accumulate |
| `watchAiAndBlog` | hourly at :40, America/Chicago | Probes each AI lane (photos, text) through the router and checks the blog has an article from yesterday or today; tells the Telegram chat when a check goes down and recovers |
| `refreshAiModelLists` | hourly at :25, America/Chicago | Daily and after a lane failure: re-tests enabled providers' versions (photos on a made-up licence, text on a question), keeps or adds those that pass, never empties a lane; tells Telegram what changed |
| `offerProductionRelease` | every 10 min | Offers a new eligible Testing release in the alert chat with a Release button; reports the outcome |
| Release health check | daily 07:17 UTC (GitHub Actions) | Reads what is live and opens/closes a GitHub issue |

The blog publishes one article a day; the hourly scheduler is idempotent,
retry-safe, recovers a missed day, never publishes twice (a filled slot closes
the day). Every run records a row per slot in `blog_runs` naming the refusing
stage (sourcing, generation, validation, claim check, verification, originality,
image, publication), shown in Blog Posts → **Publication runs**; an
AI `success` means only a reply in shape. **No article is ever published to meet
the daily count**; refusing is a recorded outcome.

### Firestore triggers

- **Driver sync** — a new lead or signed application (an unsigned one is
  marked `validation_error`) adds its company to an existing profile's `companyIds`,
  copying none of the driver's details (`{id}`: the Auth uid of a known email;
  for a placeholder one, a profile matched by phone; else the document id); call and data-change logs merge into `drivers/{document id}`. No Auth user is created. A signed application also links its lead (§4).
- **DQ file** — an application's uploads become `dq_files/{type}` records when it
  arrives or one changes, matched by `storagePath` (a link only without one);
  opening the DQ tab files any still missing (`syncDqFiles`, leads too). A
  removed entry stays removed. PEV request PDFs, results and day-30 records of
  attempts are filed by the PEV callables and job, one record each (`pev_request_<id>`,
  `pev_result_<hash of path>`, `pev_attempts_<requestId>`); a sealed signing request
  linked to an application or lead by `sealDocument` (`signed_<requestId>`), and by
  `syncDqFiles` when the tab opens if it is missing (a failed filing, an older seal).
  A changed `cdlExpiration`, `medCardExpiration` or `twicExpiration` moves the date of
  the synced records of that type, never the other way. `onDqFileWritten` keeps each
  application's and lead's `dqExpiresNext` (the earliest valid-until date among records
  not removed) and writes it only when it changes; `syncDqFiles` corrects it when the
  tab opens, and Data cleanup → DQ valid-until dates writes it on older records.
- **Stats** — only calls in `activity_logs` roll up into `stats_daily`; application and
  lead writes roll up dashboard counters into server-write-only `internal_stats`, which
  the daily job recounts. The dashboard shows them only when recounted within 36 hours
  and none is below zero; otherwise it counts the records itself.
- **Signing links** — a new request's email (`notifySigner`) and text (`notifySignerSMS`)
  each claim the event on the request (`emailDeliveryId`, `smsDeliveryId`, with the
  address in `linkSentTo`) before they send, so an event delivered twice sends once.
- **Sealing** — a signing request entering `pending_seal`, or a Retry seal recording a
  new attempt while it is there, triggers PDF sealing, only while the stored request is
  still on that attempt; then one bell notification of the outcome (§4) and, for a
  linked record, its DQ entry. Neither failing fails the seal.
- **Team cache** — a membership write rewrites `companies/{id}.teamMembers` (uid, role, name by `nameFromProfile`
  else `'Unknown'`, email). Team pickers and filters read it; Assign Leads and Import Leads read it fresh on opening.
- **Notifications** — a status change on an assigned application tells its assignee
  only (`recipientId`), else the team; an assignment tells the new owner
  (`onApplicationAssigned`, `onLeadAssigned`), unless the owner made it or a server step
  that told them itself stamped it (`server:notified`); an import writes one summary per
  recruiter. Screens stamp who acted (`statusChangedBy`/`assignmentChangedBy` with their
  times, `shared/utils/changeStamps.js`); a team notice naming its `actorId` is hidden
  from them, and `readBy` keeps read state per person (an older `read: true` counts for
  everyone). Also new applications and an applicant confirmation email. A call with a callback time (or "Remind me in 1
  Hour", still No Answer) reminds only its recruiter (`recipientId`). The bell
  reads the team's newest 20 and the reader's own newest 20 reminders (index in
  `firestore.indexes.json`), and shows the newest 20 of both. A seal outcome, a
  prepared application's submission, a lead's application, a PEV answer or no-response,
  a status change and an assignment notify once per event (`createNotification` with a
  fixed id).
- **Automated contact SMS** — moving an application or lead *into* `Contact Attempt 1/2/3` sends the
  matching template from `companies/{id}/settings/automated_sms`; transition-only, so idempotent; no template, no message.
  An application is texted only after the driver's explicit "Yes" to the optional SMS question (`sms-consent`);
  leads were never asked and are texted; no number on an opt-out list is texted. Each automatic text (sent, not
  sent and why, failed) leaves one `Automated SMS` Activity entry, without the message or number (`shared/smsPermission.js`).
  The entry is written before the provider is called, so a repeated delivery of the same change finds it and sends
  nothing, even when the first run stopped before recording a result; an entry that cannot be written sends nothing.
  `{application link}` becomes the company's apply page with the assignee's recruiter link
  (`?r=`), else the plain page (`shared/applicationLink.js`); campaigns' `[Application Link]` too.
- **Retention** — TTL overrides in `firestore.indexes.json` delete `blog_runs`,
  `application_drafts`, `application_draft_audit` and `rate_limits` at
  `expiresAt` (activity logs carry one). An unfinished application expires
  30 days after its last save, its uploads too (`deleteExpiredDraftFiles`).

### Idempotency

The submit trigger records each event once in `processing_status` (30-day
`expiresAt`) and writes to the application only what it changes.

### Bulk campaigns

A launch or retry sends at most **2,000** (`launchLimit.js`), refused before
writing. A worker sends **50 per batch**, re-checking the session: a cancel stops at once, and a batch starts no
send after 4.5 min (the next carries on). One rule (`recentlyMessaged.js`) leaves out of count, preview
and launch whom a same-channel campaign reached (its ledger; a call is not a
message): **7 days** by default for uploads, none for CRM. Limit Volume
keeps the newest N. Recipients: `meta/targets` (older: `targetIds`); a deleted
record takes `logs`, `meta` and `targets` (`deleteBulkSessionData`). Company
and global `blacklist`s hold SMS opt-outs, checked before every SMS (failing
closed on a bad number) and every email with a usable one; the team fills the company's by hand (§12).
A lead campaign built from filters leaves out leads who applied (`applicationId`;
the count before launch may still include them; hand-picked leads stay).
An SMS campaign to applicants also skips anyone without an explicit "Yes" to SMS
("Driver did not agree to SMS" in the report; still counted in preview).
An SMS logs as sent once RingCentral accepts it; a check (also `checkCampaignDelivery`) reads the line's message
store (Read Messages) by id, else number and time, and fails an undelivered text (reason, totals). A text the
provider never answered logs `sendUnconfirmed` ("May have been sent"): Retry Failed leaves it out; three with
no sent text between them, also across batches, pause the campaign. The recipient log and the Delivery Report
read 200 logs at a time, newest first, and say how many exist (a server count); Retry Failed is offered when any
log failed (a count of `status == 'failed'`, what `retryFailedAttempts` reads).

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
  for a PDF's text layer, a lazily imported `tesseract.js` for OCR. Keep it
  lazy; its worker, core and English data come from this site's `/ocr/`
  (`ocrAssets.js`), never a CDN.
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
- **A function's cold start loads its own module only** (`functions/index.js`
  by `FUNCTION_TARGET`; no name, or one it lacks, loads all), from its next
  deploy on. 256 MB stays the floor (`deployedEntryPoint.test.js`): at 128 MB a
  1st Gen function gets ~200 MHz, too little to load all in time.
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
  production; a driver on a Testing apply link files a real application.
  Only the frontend build differs. So that no driver finds Testing in a search,
  the app marks itself `noindex, nofollow` on every host but `app.safehaul.io`
  (`src/app/startup/searchIndexing.js`). It cannot be a Hosting header:
  promotion clones Testing's headers onto Production.
- **Production never deploys automatically.** Merging to `main` deploys Testing
  and the shared backend; Production is reached only by explicit promotion of an
  already-tested Hosting version: Super Admin → Releases, or the Telegram
  button the approver confirms twice (`runPromotion`, same checks). See
  [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md).
- **`workers: 1` in the Playwright CI config is deliberate** (contention flakes);
  sharding across runners is the sanctioned speed-up, and a single green run is
  **not** evidence to change it.
- **UI standardization must not change backend behavior.** Design-system work
  may not alter Firebase rules, data structures, integrations, permissions,
  routes, feature flags or business workflows unless separately justified and
  approved.
- **Unfinished and carrier-started applications are drafts in their own
  collection, never early `applications` documents**, whose four `create`
  triggers would notify a recruiter, email "application received", mark the
  unsigned record `validation_error` and move the dashboard counters before anyone
  read, consented to or signed anything. The driver's own submission promotes a
  draft (§5).
- **Discarding a draft is never a dismissal.** `ConfirmDialog` routes Escape to
  `onCancel`, so "start a new application" is never the cancel action: Start
  over is its own explicit destructive confirmation, and Escape at either stage
  deletes nothing.
- **Imported reports suggest; they never answer.** A PSP report or MVR the
  applicant uploads yields suggestions with their own Add buttons. Nothing
  entered is overwritten or added twice; a PSP carrier becomes an employer row
  with its name and USDOT number, and the carrier's reader fills blank contacts
  from FMCSA by that exact number — **PSP data is never employment dates or
  convictions**: the UI says so, and violations come from the MVR alone. Neither
  document is stored or logged; its pages live in memory for one request.
- **The application sites refuse to be framed by other sites**
  (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` in `firebase.json`),
  and their full Content Security Policy is **report-only**: nothing is blocked
  or collected. Enforcing it (a report collector comes first) or letting an
  outside site embed a page is a deliberate later change; a new external service
  joins the policy when introduced. See [`docs/security-posture.md`](./security-posture.md).
- **Speed data carries no secret.** Firebase Performance gets one `page_load`
  per page load (not per in-app navigation), by route pattern, `site` and
  `release`. Automatic traces are off; `/verify/` and `/review-change/` record
  nothing: the SDK sends the page address with every trace.
- **No long cache on the app's files, `/assets/**` included.** Hosting attaches
  header rules to a missing file's response too, so a long `Cache-Control` would
  store the 404 (or SPA fallback) an open tab gets for a chunk a release removed,
  failing that browser even after a rollback. Everything stays on the one-hour default.
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
  document-expiry monitoring, a job board, or any named carrier endorsement. The DQ
  checklist and dates may be described only as listing what the file holds and
  showing valid-until dates, and `notifyDqExpiry` only as a daily in-app notice to the
  team about hired drivers; never as monitoring, renewal reminders, a compliance check
  or a complete DQ file.
- **A `web/` change runs the `frontend_unit` CI lane**
  (`src/tests/hostingConfig.test.js`, A5). Its claims check runs in an
  always-required job, blocking and install-free, and refuses nested pages (K4)
  and a run with no HTML in `web/`.
- **A `src/features/` change skips the catalog job** (it builds only
  `src/design-system/`); feature screens' baselines run in `app-visual` (A7).
- **The rules job runs its suites once, only for what they read:** the rules,
  the suites, the Vitest setup, or a CI or dependency file (B36).
- **A follow-up push reuses its pull request's earlier results** for each lane
  the files changed since cannot affect (M).

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
(`data-mobile-presentation="cards"`), the same elements at every width, as does
a `DataTable` of such rows (`mobilePresentation="cards"`). Source and guards:
`src/design-system/components/data-table/README.md`.

**Two contracts have no exception route**, because the code refuses to run: a
dialog goes through `Modal` and takes its size and shape from the chrome
contract (props that would replace it throw); and every glyph comes from
`@design-system/icons` at a step on the icon scale (`xs`…`3xl`, 12–32px) — the
registry hands out **tokens**, not components, so `<Trash2 size={13} />` throws
by name. Such a throw, as every design-system prop check, happens outside a
production build; a production build logs it to the console and draws the default
(`src/design-system/contract.js`). A glyph **inside a design-system container
states no step**: `Button`, `IconButton`, `Tabs`, `Chip`, `SegmentedControl`,
`FileInput` and `StatusMedallion` size what they hold. The one file that opens a
glyph by hand is `VOEDocument.jsx`, via `glyphComponent`: the exported
verification document must carry no `ds-*` class, and `Icon` stamps one.

**These rules are checked, not just written:**

| Command | Blocking | Catches |
|---|---|---|
| `npm test` (`design-system/tests/`) | yes | An import across a layer boundary, in stylesheets or modules; a broken token contract or a pairing below AA |
| `ds/*` rules in `lint:frontend` | yes | An arbitrary colour, size or layer (`ds/no-raw-values`), a raw table (`ds/native-table`), a hand-styled control, tablist, toggle, current-item control, raw file input or hand-written `target="_blank"` (`ds/use-primitive`); stylesheets by `stylesheetContract.test.js` |
| `npm run lint:frontend` | yes | **Any** file under `src/`, outside `src/design-system/icons/`, importing `lucide-react`; there is no exemption list (`scripts/test-lint-rules.mjs` drives the rule) |
| `npm run check:table-layout` | yes | A cell narrower than its content, in a real browser at 412px and 1440px — for `DataTable` and the `ds-native-table` contract |
| `npm run check:visual-contract` | yes | A change to computed geometry — control heights, cell padding, radii, resolved colours, and a frozen table column losing its opaque background |
| `npm run test:stories` | yes | A story that fails to render, or fails axe |
| `npm run test:visual` | yes | A change to how anything *looks*, across 96 catalog subjects and 15 real screens at both widths. **Known gap:** the e-doc field editor and the sandbox wizard are not among the 15, so changes confined to them are guarded only by `check:visual-contract` measurements |
| `npm run test:e2e -- --grep "@a11y"` | yes | Real-browser axe on the mobile-critical journeys, plus keyboard behaviour: roving `tabIndex`, arrow/Home/End, and that every control a Tab press reaches shows the product's focus ring |

- **Inter is self-hosted** in `src/design-system/fonts/` (SIL OFL 1.1), never
  from a third party (CI renders the real typeface, no user's IP is disclosed),
  cut by script: a page loads only letters it shows (`fonts/README.md`).
- A `ds/*` exception is a file in `scripts/eslint-rules/exceptions.mjs`, with
  its reason; adding one is judged in review.
- The Tailwind theme is strict: a default colour, size, radius, shadow or layer
  (`bg-white`, `rounded-lg`, `z-10`) compiles to nothing. Use the `--ds-*` ones.
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

- **Lead Distribution Engine** (no `isPlatformLead`, `distributedAt`,
  `visitedCompanyIds`, `dailyLeadQuota`). **Job board / saved jobs** (rules
  deleted; old documents unreachable). **`/join/:companyId`** (use Create Portal User).
- **GitHub Models** as an AI provider.
- **Smart Segments** — triggers go at the next promotion; data stays unread.
- **`Khomurod/SafeHaul-for-Gemini-Antigravity`** — archived; never develop or
  deploy from it. Deploy jobs are guarded by repository name.

**Current limitations:**

- **Browser errors are not collected anywhere**; users must report them.
- **Sent Documents search and filters cover the loaded documents** (newest 100,
  more on request), and say so; the server totals refresh when a loaded
  document changes or the page reopens, so a change to an older document shows
  on the next one.
- **The unfinished-applications workspace shows the 200 most recently active
  drafts** (`listApplicationDrafts`, by `updatedAt`), and says when there are
  more (`truncated`). No pagination — a second list would break one-query,
  one-row-per-document.
- **A record without `createdAt` is missing from the candidate lists**, which
  Firestore sorts by it (newest first, or as its date header says): a sort
  leaves it out. A notice counts such records (`UndatedRecordsNotice`) and
  search finds them; dating them is the owner's data change.
- **An unassigned lead stores `assignedTo: ''`**, which the Unassigned filter
  asks for. Older leads with `null` (imported) or none (Quick Add, Facebook)
  are not found there until Data cleanup's lead fields item runs (below).
- **Facebook lead capture is switched off; an earlier defect may have stranded
  leads** in `companies/{uid}/leads`, which no screen reads
  (`scripts/audit-facebook-lead-tenancy.mjs` reports any). Connect rules: §7.
- **"Read the documents" reads only what the current browser holds.** A
  prepared application re-opened later names its documents, readable once
  re-attached; files are not fetched back (that needs bucket CORS, not set).
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
  link can now be emailed by the server (`deliver: 'email'`, `shared/linkDelivery.js`),
  never shown to the recruiter, though a copy may stay in the company mailbox's Sent
  folder; the exchange still treats it like a copied one, since a prepared draft's
  address is one the carrier typed. Letting an emailed link stand in for the identity
  check is an owner decision; texting the link is not built.
- **A driver cannot dispute a locked employer that is satisfiable but wrong.** A
  PSP report is an FCRA consumer report with dispute rights, but a locked
  identity is a record to the driver (§5); no lock is unsatisfiable, yet nothing
  lets them say "that carrier is not mine" — its own feature, with policy
  questions.
- **Until the next release the browser is stricter than the server**: the wizard
  refuses a Yes disclosure unexplained and an unanswered required custom
  question; `submitGuestApplication` does not yet (old page).
- **A submitted upload's storage path is taken on trust.** Submission only
  checks that an upload exists and marks it (`guestUploads.js`), and
  `deleteApplication` deletes every top-level `{ storagePath }` with the Admin
  SDK, so a hand-crafted submission could get another file deleted.
  `deleteSandboxApplication` removes the same files
  (`shared/applicationStorage.js`) but only inside `companies/SANDBOX/`, so a
  public sandbox submission cannot reach a real company's file. Viewing is safe
  (`getSignedApplicationFileUrl` refuses paths outside the caller's companies).
  Only custom-question uploads are held to `guest_uploads/`; restricting the
  standard fields needs a survey of every folder a legitimate file can live in.
- **Violations, accidents and previous addresses** are on the server's allowlist,
  but *Edit Application* has no editor for them (array sections render read-only),
  so they show display-only.
- **Older `drivers/{id}/pending_updates` documents remain** until the owner runs
  Data cleanup → Old driver staging copies (В7), which deletes them; nothing reads or
  writes them.
- **HEIC photos cannot be read** (an iPhone's default; browsers cannot decode
  it): the reader refuses it, naming what it takes: PDF, JPG, PNG, WebP.
- **No payment processing.** `companies/{id}.planType` is a manual super-admin
  `free` / `paid` flag that only changes a badge ("Free Plan" / "Pro Plan");
  marketing prices ($199 / $299 a month) are **not** enforced.
- **A STOP reply is not captured automatically:** **nothing writes** the `inbound_messages` that `handleOptOut`
  (`blacklist.js`) watches (no inbound SMS webhook). The reply reaches the company's own provider, and the
  team adds the number by hand in Settings → Text messages (`smsOptOuts.js`). Sends check the list (§8).
- **Frontend coverage thresholds are a ratchet** (`vitest.config.js`), a few
  points under measured coverage: raise them as it improves, never lower them.
- **Mixed Functions v1/v2 is intentional.** The generations run as different
  service accounts (§7), so binding a secret from a generation that never bound
  it fails the **entire** functions deploy until that account is granted access
  (`secretBindingGenerations.test.js`; see
  [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md)).
- **A direct Storage upload can bypass the backend helper** — a documented,
  accepted gap; see `docs/security-posture.md`. Client writes are named per
  folder in `src/storage.rules`: a PEV result is add-only; PEV signatures,
  request PDFs and sealed copies are server-only.
- **PEV records before 2026-11 are not backfilled:** earlier results are not in
  the DQ file and keep a stored download link; requests already live then keep
  reminding until day 30 (their mark no longer overwrites a Completed row).
- **Batch 3 limits (2026-11):** a personal bell notice is hidden, not private (the rules
  let the team read every notification), and others' personal notices take slots in the
  team read; until Production is promoted its screens neither stamp who acted nor keep
  read state per person. Phone matching links the only lead with the number even when its
  email differs; older mixed-case lead emails match only after Data cleanup → Old lead
  fields. Remind's cooldown guards against mistakes, not a team member editing the
  database; a reminder whose every send failed does not count. Company setup reads once
  per dashboard visit.
- **Batch 8 limits (2026-11):** the DQ deadline notice is for hired applications only
  (not leads), in the bell only (no email or text; the driver is not told); a record none
  of whose DQ files holds its `dqExpiresNext` gets none until that date is put right; a
  date more than 30 days past is never told (Needs attention lists it); the first run, and
  the first after Data cleanup → DQ valid-until dates, tell at once about every hired
  driver within 30 days either side of their date. A notice goes to the stored assignee
  when the team roster cannot be read (as other notices do). Settings lists the newest 300
  opted-out numbers (and says how many there are), so an older one can be removed there
  only once newer ones are; adding one is never limited.
- **Batch 6 limits (2026-11):** the automatic post-application send looks only 30
  minutes to 2 hours after the first submission, so an application whose driver later
  gets a usable email or says Yes, a resubmission, one missed during an outage longer than
  that, and an optional form get nothing from it (Send to driver still works); a failed
  send is not retried by it (Remind and the day-3 reminder are); a template that cannot be
  filled is skipped and logged on each run in the window; a text can go at night, 30–120
  minutes after the driver's own submission and only after their Yes. The no-response
  email's DQ-file sentence follows the filing result of that run.
- **Batch 5 limits (2026-11):** the automatic reminder goes only 3–7 days after a
  document was created, so a document corrected to add a channel later, one whose link
  ran out, a run missed four days in a row, or a form sent later through Send to driver
  may get none (Remind still works);
  it is never retried after a failed send, which shows on the document as a delivery
  error, as a failed Remind does; a run stops after seven minutes and leaves the rest to
  the next day, and one cut off between claim and send loses that reminder rather than
  sending twice. Between daily recounts the dashboard counters can be off by a trigger
  delivered twice or lost, or by a record added or removed while the recount ran. A record without a confirmation number (a lead, an older or
  hand-made application) shows none in the dossier, though the applicant's email named
  the first eight characters of its id instead.
- **Batch 4 limits (2026-11):** the DQ checklist reads the DQ list when the tab opens or
  after a change made there, and the employers as the dossier loaded them (reopen it after
  another person's change or a PEV change), while the sidebar's marker follows the DQ list
  live; `dqExpiresNext` reaches older records on a
  DQ write, when their DQ tab opens, or through Data cleanup → DQ valid-until dates; an
  old card left in the file keeps the record's earliest date (and the daily notice about
  it) until it is removed; a date
  the team set on a synced record gives way to the application's next change of that
  answer; inquiries uploaded by hand are counted, not matched to employers. Needs
  attention's no-response count
  includes every request still marked so, even where a newer one for that employer was
  answered, and its unsigned count includes sends that failed; an unfinished
  application's removal is read from its last save, and the Unfinished page lists only
  the 200 most recent drafts.
- **Batch 2 limits (2026-11):** requests sent before the PEV attempt log show only later
  attempts (their day-30 record notes the gap), and an attempt recorded after day 30 is not
  in the already-filed record; a day-30 record that failed to file is not made again
  (logged). A sealed document missing from the DQ file is filed when its DQ tab opens. Send to driver does not resend a form already sent, even
  after its link expired (Remind does); an optional post-application form is listed only once a request
  for it exists. A retried document's certificate prints the retry time as COMPLETED AT.
  Retry seal and the record link guard against mistakes, not a team member: the rules let
  the team write any signing-request field.
- **`signedCopy` stops accidental and concurrent resends, not a team member
  editing the database:** the rules let the team write any signing-request
  field, so clearing it directly would allow a second approved send.
- **Historical reconstruction is an ongoing migration.** Applications submitted
  before snapshot preservation get a record and PDF rebuilt only from surviving
  evidence and **marked as reconstructed** (`reconstructHistoricalApplications`);
  `surveyHistoricalReconstruction` counts what is left when asked on
  Maintenance, and says when nothing is. See
  [`docs/application-record-reconstruction-runbook.md`](./application-record-reconstruction-runbook.md).
- **A deleted blog article does not free its slot.** Deletion leaves a tombstone
  and `slotIsFilled` checks only that the slot's document exists, so the day
  stays closed (the ledger says so). Reopening it means changing the
  `create()`-based anti-double-publish guarantee; see
  [`docs/news-and-insights.md`](./news-and-insights.md).
- **The blog's word floor is 150 words**, not the 700–1,200 first specified: a
  recorded owner decision for free-tier provider limits; a higher tier undoes it.
- **`themesAreDistinct` is called by nothing** (one article a day; the 60-day
  window keeps days apart).
- **The AI live-credential checks cannot run in CI**: the credential-access
  diagnostic, connection tests, model-pin verification and manual publication
  check need a deployed environment's credentials; a green run proves none.
- **Known dependency advisories.** `npm audit` (root and `functions/`) gives the
  live list; a few wait on a major or upstream. `.github/dependabot.yml` raises
  weekly grouped PRs (root, `functions/`, Actions; majors apart) with a
  **seven-day cooldown**; security fixes are not delayed.
- **One-time backfill callables are still exported** (`backfillPublicProfiles`,
  `migrateEmailSettings`, `backfillApplicationSearchFields`, stats backfills):
  Super Admin maintenance tools, not dead code; check before removing one.
- **Maintenance → Data cleanup** (`dataCleanup`) removes leftovers item by item:
  Deep Diagnostic test accounts, SSN copies, stored PEV links, old lead fields,
  application search fields, SMTP password copies outside `email_config`, DQ
  valid-until dates (`dqExpiresNext` on records filed before it), old driver
  staging copies (`drivers/{id}/pending_updates`, deleted whole). Check
  counts; Run confirms, needs a recent sign-in, is audited, resumes
  (`done: false`). Several-value `driverType` lists are only counted.

---

## 13. Testing and operational expectations

**Commands:** `npm run lint` (frontend + backend + public-site claims) ·
`npm test` (Vitest) · `npm run test:coverage` (ratchet gate) ·
`npm run test:e2e` (Playwright) · `npm run test:rules` · `npm run typecheck` ·
`npm run storybook` / `npm run test:stories`. CI also runs
`check:callable-contract`, `check:ai-boundary`, `check:ci-plan`,
`check:release-scripts`, `check:deploy-script`, `check:function-exports`,
`check:table-layout`, `check:visual-contract`,
`test:visual`, `test:secret-scan`, and a secret scan
(`scripts/secret-scan.mjs`, a pinned Gitleaks CLI) — all blocking. CI's frontend
job runs `lint:frontend`, not the root `npm run lint`, so a check that lives
only in the root lint is not a CI gate. `npm run typecheck` blocks in
`frontend-quality`. TypeScript 7 reads a JSDoc `{object}` strictly (name the
fields, or `Record<string, unknown>`) and has no `baseUrl`; a `TS5xxx` error
means the configuration was rejected and nothing was checked.

**The secret scan covers what the change introduced** — this event's commit
range plus the resulting source tree — never the whole history. A pull request
compares against its merge base; anything else (a push to `main`, a manual or
scheduled run) against the newest ancestor with a **fully validated release**:
a run where `secret-scan` and `Verify the release is fully validated` (proving
the scanner passed its own tests) succeeded. A failed release's increment is
re-scanned, never stepped over.

- Every base is resolved to its full SHA and must exist, be an ancestor of the
  head and not be the head; the `SECRET_SCAN_BASE` dispatch input must also
  carry a validated release. An undeterminable base **fails the job**; no
  fallback widens or empties the scan.
- Exemptions are pinned, not trusted: `.gitleaks.toml` may declare only the
  reviewed tables, keys and values; `gitleaks:allow` comments are switched off;
  a `.gitleaksignore` fails the job.
- A deploy requires this job.
- The full-history sweep is the separate, non-blocking `secret-history-audit`
  workflow (the history's known legacy findings would otherwise fail unrelated
  releases); `docs/SECRET_HISTORY_AUDIT.md` lists the credentials still needing
  owner rotation.

**Source size.** Runtime code and tooling warn past 500 physical lines and are
refused past 700; tests have no limit. `npm run check:source-size` enforces it
(`.claude/rules/source-size.md`).

**Instructions for AI agents stay small.** `AGENTS.md` is one page every agent
reads; `.claude/rules/` holds topic rules loaded per area; history lives in
`docs/archive/`. `npm run check:agent-docs` (unskippable, in
`callable-contract`) refuses `AGENTS.md` and `CLAUDE.md`, which every session
loads, past their pinned limits in `scripts/agent-docs-limits.mjs`, and warns
for every other file there, this brief included. It also refuses a topic rule
without `paths:` and a path the instructions name that does not exist.

**Cloud Functions reach the Admin SDK through `functions/firebaseAdmin.js`**
(its `admin`, `db`, `auth`, `storage`) or a modular `firebase-admin/<service>`
import: `firebase-admin` 14's root export has no services, and suites that mock
it would not notice. `functions/test/unit/firebaseAdmin.test.js` refuses a root
require or an `admin.<path>` the wrapper lacks; `deployedEntryPoint.test.js`
loads `index.js` under plain Node. Under Jest the ES-module-only `jose` (unused, §10) maps to an
empty stand-in.

**Playwright** runs in CI as 4 shards (`workers: 1`, `retries: 2`; §10):
desktop Chromium and `@mobile` on an emulated Pixel 7. Runner safety:
[`.claude/rules/testing.md`](../.claude/rules/testing.md).

**The first download has a budget.** `npm run check:bundle-budget` sums the
entry, its module preloads (libraries: `vendor`) and stylesheets from
`dist/index.html`; above **276 kB gzip** it fails `frontend-build`. It refuses a
pdf.js preload, code that loads later (speed monitoring, Storage, DOMPurify) in
it, and a first download without the offline queue (all pages run it), and holds
`/apply/:slug` (its chunks, the English font) to **492 kB**.
`npm run test:bundle-budget` drives each refusal in `callable-contract`;
`check:ci-plan` K1c pins both. Ceilings only move down.

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

**`README.md`** is the getting-started guide and documentation map; on what the
app does, this brief and the code win.

---

*Keep this brief true. See the permanent rule at the top.*
