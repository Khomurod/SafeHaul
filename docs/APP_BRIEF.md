# SafeHaul — App Brief

**The single orientation document for this application.** Read it before you
change anything; update it when your change makes part of it untrue.

It is deliberately short enough to read at the start of every task. It describes
*what the application is and why it behaves the way it does* — not every file.
Deep detail lives in the linked runbooks under [`docs/`](.).

Verified against the code and configuration on **2026-08-19**, and against
deployed Firestore data, Cloud Functions and Cloud Logging on **2026-09-09** for
the application-continuation and employer/PEV rules in §4, §5 and §12.

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
| Cloud Functions | `functions/` | Node 22 (since 2026-09-06; Node 20 is decommissioned by Google on 2026-10-30), **mixed v1 and v2** (both production-stable; full v2 migration planned, not urgent) |
| Firestore rules | `src/firestore.rules` | Deployed from here, not the repo root |
| Storage rules | `src/storage.rules` | |
| Public site | `web/` | Hand-written CSS, **no build step, no framework**. Serves the server-rendered blog's assets and a standalone privacy page, and redirects `/` to `/news`. The marketing site that lived in `landing/` was removed; see [`DESIGN.md`](../DESIGN.md) |
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

`dashboard` · `drivers/applications` · `drivers/unfinished` ·
`drivers/leads/company` · `drivers/leads/my` · `campaigns` · `e-docs` ·
`import-leads` (admin) · `quick-add-lead` (admin) · `profile` · `settings` (admin)

Unknown `/company/*` paths redirect to the dashboard rather than rendering an
empty shell.

---

## 4. Main features and workflows

**Driver application intake.** Public link `/apply/:slug` resolves a company via
the sanitized `public_profiles/{companyId}` mirror. The driver chooses CDL
photo auto-fill or manual entry, then completes a 9-step wizard (Contact →
Qualifications → License → Violations → Accidents → Employment → General →
Review → Consent) over the canonical data sections in
`functions/shared/applicationSections.json`. Submission goes through the
`submitGuestApplication` callable (Admin SDK), not a client write.

**What the wizard asks is shaped by the company, without code.** Company Settings
→ Company Profile has five tabs that form the whole mental model: *Standard
Questions* (show / hide / require the DOT questions), *Application Rules*
(per-company enforcement — see §5), *Custom Questions*, *Agreements* (the legal
wording presented, versioned) and *Integrations* (optional PSP-report and MVR
import). The Violations step carries the one **MVR authorization** question, a
versioned agreement the applicant answers Yes/No; a clear Yes/No question now
precedes both the moving-violations and the accidents lists; the Employment step
can offer a PSP-report import and the License step an MVR import, both of which
only *suggest* entries the applicant accepts one by one; and the General step
can carry an optional **Hours of Service statement** (last seven days, last
relieved) when the company turns it on. A company that configures nothing sees
exactly the application it had before 2026-09-02.

**A carrier can start an application for a driver.** Company → Applications →
Start an application first asks **how** to fill it in: **Let AI read the
documents** or **Fill in manually**. The AI path uploads the driver's licence,
medical card, PSP report and motor vehicle record, reads them, and prefills what
it can; the manual path goes straight to the form (documents can still be
attached there, just not read). Both land in one editable form where the recruiter
enters the driver's email and phone — the *identity* that keys the draft and the
application it becomes — and corrects anything the reader got wrong. Once a link
has been minted (the draft is `sent`), the email and phone render **read-only**:
re-keying a draft whose link is already in the driver's hands would strand that
link on the old answers, so changing the driver means starting a new application.
The only fields the driver cannot later change are the employers a PSP report
named, which stay locked to their identity. The recruiter then copies a link and sends it; the
driver opens it, lands in the ordinary public wizard with the answers already
there, completes what only they can supply (Social Security Number and signature
are never in a draft), reviews and signs. It is staged as a *draft*, never an
early `applications` document — see §5 — so nothing is filed, nobody is emailed,
and no pipeline counter moves until the driver submits it themselves.

**The reader never overwrites what the recruiter typed while it was running, and
that is a fix.** The panel used to merge into the `formData` *prop* it captured
when the button was pressed and hand the whole result to the raw setter — so it
was not "conflicting edits lose", the entire answers object was replaced from a
stale snapshot and every field typed during the read vanished, with "fill only
what is blank" judged against that snapshot too. The merge now happens inside
`useApplicationPrepDraft.applyExtraction`, against the answers as they are at that
moment, so anything typed since is left alone and reported as kept. A read is up
to two minutes per pass, twice.

Nothing used to tie an answer to what it was asked about, and `onApply` belongs
to the *page*, which outlives the panel — so a read started for one driver and
resolved after the recruiter opened another wrote the first driver's answers, and
the first driver's PSP carrier **locks**, under the second driver's key, which
manufactures exactly the unsatisfiable lock state above on somebody who never had
those employers. The applicant and the document set are captured before the call
and compared after it, against what is on screen then rather than against the
closure's own copies. A failed second pass also no longer discards the first: the
retry is its own `try`, and losing it falls back to the first pass rather than to
nothing, while still winning wherever it succeeds. All found 2026-09-08.

**A control that cannot be pressed cannot explain itself.** Save and "Create the
driver's link" were `disabled` whenever their prerequisites were unmet, and
nothing on the screen said what those were. The link's real precondition was
*"save first"* — `canMint` was `Boolean(applicantKey)`, which only a save sets —
and that sentence appeared nowhere at all; the other one was already written on
the server (`prepare.js`: "Enter the driver's email or phone first — it
identifies the application") and was unreachable, because the client guard stopped
the request ever being made. Both are clickable now and the press validates:
`prepActionPreflight` returns what is missing and which field, modelled on
`publicApplyPreflight.js`, which does the same job for submission. Clickable is
not a licence to skip the check — nothing is saved, minted or copied when the
prerequisites are unmet. `disabled` remains for the one thing it is honest about,
an operation in flight, through the design system's `loading`; the label stays
"Save" and a live region beside it speaks, because a label that changes to
"Saving…" is content rather than an announcement.

Two things the link actions could not previously notice, because no dirty flag
existed: unsaved edits, which would hand the driver the answers as they were, and
a **corrected contact detail**, which is worse — `applicantKey` is the key of the
last save, so minting after one addressed a *different document*, leaving the new
email on screen beside a link that opens the old record, with `identityLocked`
then freezing that mismatch in place. Both are refused with an offer to save and
mint in one press. A carrier's contact correction also retires the document it
moved off, so one driver is not two rows in the worklist. Email or phone is still
enough — never both — and each supplied one is now format-checked, which neither
side did: `dana@` used to become an application's primary key. A refused clipboard
says so and points at the link, which is on screen and selectable either way.
Driven through the real fields and the real controls by
`StartApplicationPage.actions.contract.test.jsx`. All found 2026-09-08.

The reader extracts text in the recruiter's own browser first — a PDF's own text
layer, else Tesseract OCR of the rendered pages, else the page images sent to the
vision AI — and only the text (or, for an unreadable document, the images) leaves
the browser, to one AI task. Any subset of the four documents is valid; a photo of
a card (JPG/PNG/WebP) is read as readily as a PDF.

**A signed URL is a capability, not a property of the document.** An upload used
to leave `{name, url, storagePath}` in the form data, and that `url` is a signed
read URL with a **fifteen-minute** life. It was persisted into the draft verbatim
and handed to the driver by the invite exchange, so a document a recruiter
attached on Tuesday was a broken image and a Storage error page by the time the
driver opened their link — and the same for a recruiter reopening their own draft
an hour later. The durable identifier was sitting beside it, unused, and the
company's own dossier view had already been re-signing from it for the same
reason. Nothing is stored now: `useSignedUploadPreview` mints one from
`storagePath` when somebody is looking. Access is unchanged —
`getSignedGuestUploadUrl` authorizes exactly as before, and `storagePath` was
already in the draft, so whoever could read the draft could already reach the
file. Found and fixed 2026-09-08.

An expired signature, a deleted object and a refusal all rendered as the same
broken thumbnail and the same XML page in a new tab, so "your link expired" was
indistinguishable from "your file is gone" — and only the second means anything
has to be sent again. `not-found` is the file and says so; anything else is that
attempt and offers to retry, with the row still reading as attached, because the
upload gates key on presence and a preview is a courtesy.

**Progress survives, from the first page onward.** Every forward step writes a
local copy synchronously and a server-side draft in the background, so a closed
tab, a dropped connection, a failed CDL scan or a page error no longer costs an
applicant everything they typed. Nothing waits for the last page. Drafts live in
their own server-only collection, never in `applications` — see §5.

**Returning applicants are offered their unfinished application.** A device that
still holds its resume token restores silently on load. On another device, the
first Next matches last name + date of birth + SSN *and* an email or phone
already on the draft, and offers a two-stage choice: continue where they left
off, or — behind its own explicit destructive confirmation — delete it and start
genuinely fresh. A failed or unmatched lookup is indistinguishable from "nothing
exists", and the applicant simply carries on filling the form.

**Unfinished applications are visible to the carrier, and can be sent back.**
`/company/drivers/unfinished` lists who started and did not finish, with contact
details only — deliberately no answers and no way to open or edit one. It is a
call to make, not a record in the ATS funnel. **Copy continuation link** (added
2026-09-09) mints a link for that draft and copies it; the link is a pointer, so
whoever opens it must confirm their own identity before anything comes back, and a
recruiter cannot pass that check. Before it existed the screen had one control —
Refresh — and the only way to get a stalled applicant moving was to ask them to
start again.

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
The employer signs the response **drawn or typed** (since 2026-09-06): a typed
name is stored as `TEXT_SIGNATURE:<name>` — never rendered into an image — and
the method (`signatureMethod`: `drawn` | `typed`) is recorded with the
response and printed on the DQ-file PDF, so the two stay distinguishable. ESIGN
(15 U.S.C. §7006(5)) and UETA treat a typed name adopted with intent to sign as a
valid electronic signature; the server refuses any other form and any
mislabelled method (`functions/employmentVerification/signature.js`).

**Driver-approved corrections.** Company admins cannot silently rewrite a
submitted application — see §5.

**Bulk SMS / email campaigns.** Audience building over leads, then a resilient
session-based worker (§8). Partial feature by design: the carrier connects its
own messaging provider and is billed by that provider. No two-way threads, no
automated multi-step drip sequences.

**Super admin operations.** Companies, users, unified driver DB, global feature
flags, SMS integrations, Environment & Integrations vault, AI providers, blog,
website-lead archive, form builder, system health, stats backfill, releases.

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

**Drafts are never written into `applications`, and this is load-bearing.** Four
triggers fire on `create` under `companies/{id}/applications/{appId}` —
notification, applicant email confirmation, driver sync / shadow profile, and the
stats rollup. A draft written there would email every half-finished applicant "we
received your application" and create driver profiles for people who typed a name
and left. Unfinished applications therefore live in
`companies/{id}/application_drafts/{applicantKey}`, keyed by the *same*
deterministic applicant key so a draft and the application it becomes share one
identity. The draft is discarded on successful submission.

**A draft never holds an SSN or a signature.** Both are stripped in three
independent places — the local browser copy, the client payload, and again on
arrival, at every depth of the object. Matching a returning applicant uses a keyed
HMAC of company + last name + date of birth + SSN digits, never the SSN itself, so
there is no new place a Social Security Number comes to rest.

**And because the SSN is never stored, a save cannot be allowed to recompute the
identity HMAC as nothing.** `saveApplicationProgress` wrote
`identityKey: identityKey || null` on *every* save, and the HMAC needs the SSN —
which lives only in the page's own React state. So the first autosave issued after
a page reload, or after a restore from the server copy, recomputed the key as null
and **erased it**. `findResumableApplication` queries `identityKey ==`, so what the
applicant silently lost was cross-device resume, and what a carrier-prepared
application lost was the only thing that could ever prove the driver owns it.

Measured in production on 2026-09-09: three of six live drafts held
`identityKey: null`, including the reported one at the consent step, whose
`resumeApplicationDraft` restore was followed 46 seconds later by the save that
erased it. `identityKeyForSave` now takes a computed key when there is one — an
applicant may correct their own last name or date of birth — and otherwise leaves
the stored one alone; when the applicant key has *moved* (a corrected email writes
a different document) it is inherited from the draft the resume token opened,
which is the same applicant, proven by that token. The at-most-one-live-draft
sweep reads the key that was **written** rather than the one the request could
compute, or an applicant correcting their email on a reloaded page would leave two
live drafts.

On resume the applicant must re-enter it, and that is now **enforced rather than
assumed**. The wizard validates a step when it is pressed Next on, so an applicant
who resumed at the licence page never passed back through page one, nothing
re-asked, and the application could be submitted without a field the company marked
Required. `submitGuestApplication` refuses such a submission
(`assertRequiredUnpersistedFields`) and the wizard blocks Submit and routes the
applicant to the page that collects the field. Both halves are derived from the
same three sources — the shared field table, `resolveGate`, and the draft module's
own strip list — so a company that hides the question or marks it Optional is
respected, and anything that stops being persisted later is covered automatically.
The server half is the authority: "the applicant visited that page" is not
something a server can observe, and not something a caller of the callable has to
have done at all.

**Saving progress must never be able to stop an applicant.** The local copy is
written first and synchronously; the server save is background work whose failure
is invisible. The feature exists because drivers on bad connections were losing
everything they had typed, and a version of it that blocked them on a bad
connection would be a worse bargain than not having it.

**An older server draft must never overwrite newer local work.** There are two
copies on purpose — local is the immediate backup for weak signal and failed
saves, the server one is the persistent primary — and restoring the server copy
used to win every field unconditionally. That destroyed the backup with the exact
failure it exists to survive: a save fails, the driver refreshes, and yesterday's
values come back over their edits with nothing said.

Reconciliation is decided on **write sequences, never on wall-clock time**: a
Firestore `serverTimestamp` and a phone's clock are different clocks, and phone
clocks are routinely wrong, so comparing them would mark some drivers' local work
permanently stale. The local copy counts its own writes and remembers which the
server confirmed; the server stores the sequence that came with its copy. Local
holding unacknowledged work wins; a server copy another device advanced wins;
**the loser is always merged underneath, never discarded**, so a field only one
side has always survives. Work typed since page load outranks both. The decision
lives in `reconcileApplicationDraft.js`, is pure, and is covered case by case.

**Reconciliation answers "which copy is newer". It also has to answer "whose is
it".** Every slot on the apply page is namespaced by company slug and nothing
else — `draft_${slug}`, `apply_discarded_${slug}`, `apply_resume_${slug}`,
`sh_post_apply_${companyId}` — so two drivers using one browser at one carrier
share all of them. That was survivable while there was only ever one candidate
applicant per browser. A carrier's invite link names a *specific* one, and every
guard on this path answered "was this discarded?", never "is this the same
applicant?".

The consequence, found 2026-09-08: `loadPublicApplyCompany` sets the company
*before* it awaits the exchange, and the server-draft reconciliation fires as
soon as `company?.id` exists — so it raced the exchange over those shared slots.
Either ordering lost. Read the token slot before the invite stored its own and
the **previous** applicant's server draft was fetched, merged and applied over
the invited answers; read it after and the server side was right but `local` was
still the previous applicant's draft, which wins outright when dirty. Upload
descriptors are handed to the winner whole and repeating rows are unioned, so
the symptom was a new driver's application carrying a previous driver's stored
document information — and it persisted, written back under the invite's draft
name and autosaved onto the carrier's draft.

**Two mechanisms, deliberately not one.** `PublicApplyHandler` gates the
reconciliation until the exchange has resolved, which fixes the ordering; the
`applicantKey` stored beside the resume token identifies whose leftovers this
browser holds, which fixes the identity. Gating alone is not enough, and the gate
is on `pending` only and never on `opened`: the exchange returns no `lastStep`,
so the reconciliation is the only thing that restores an invited driver's page,
and their own newer unsynced work must still be able to win. A foreign local copy
is **withheld** from the merge (`local: null`, a supported input meaning "this
browser has no copy of *this* application") rather than deleted, so the ordinary
server-won write-back replaces it and no new writer is introduced to a slot whose
naming and sequence rules are this intricate. The cost is stated where it
happens: the previous applicant loses their local backup of that slug, while
their server copy — the persistent primary — is untouched and still reachable by
identity match.

Per-applicant storage keys were considered and rejected. The name would have to
move whenever a driver corrects their own email, which is normal and supported,
so every slot would need renaming in shared storage at the worst possible moment;
a fresh load cannot know which namespace to read; and the discard mark must stay
un-namespaced, because naming it was tried and silently restored the bug it was
meant to fix.

**Three smaller guards came out of the same review, and each was one line of
intent away from its neighbour.** `restoreFromStoredToken` already *received* the
server's own `applicantKey` and dropped it, so no caller could ask the question
at all — it is returned now, used to re-stamp the slot when the server resolved a
different document (a corrected contact detail, which must never cost the
applicant their local work), and used to abandon a reconciliation whose answer
belongs to a different application. Its failure path cleared the resume token
**unconditionally**, while `startOver` twelve lines below guarded exactly that —
so a stale token's failed restore could delete the credential a carrier's invite
had just minted, and a prepared draft has no identity HMAC to fall back on. And
`sendSave` re-read the shared slot *at transmit time* rather than using the token
its own tab was issued, so a previous applicant's still-open tab presented the
invited driver's token and `carriedPreparedFields` copied the carrier's
`lockedEmployers` and `inviteClaimedAt` onto that other person's application. All
three live in `useResumeTokenOwnership.js` now, which owns the question "which
application does this tab hold a credential for".

**A live invitation retires a finished application's confirmation screen, and a
dead one may not.** `sh_post_apply_${companyId}` is keyed to a company, lasts 24
hours and sets `submissionStatus = 'success'`, which renders above the wizard —
and it was restored *before* the exchange, so a new invitation to the same carrier
in the same tab loaded its answers into state and then showed the previous
applicant's success screen and documents checklist over them. The restore now
runs after the exchange and only when nothing opened, and a successful exchange
clears that session and the unscoped `lastConfirmationNumber` with it. Clearing
rather than merely skipping, or a later reload of the bare apply page brings the
screen back. Safe by construction and not by luck: a submission **deletes** the
draft and the invite hash lives on that document, so a link that still opens
proves the application it opened was not submitted. A failed exchange touches
none of it, which is what protects the driver who re-clicks their own dead link
after submitting. The render precedence itself is unchanged — a restored
post-submission session has no `intakeMode`, so the success screen must stay
above the chooser.

**`supersedeOtherDrafts` cannot reach a carrier-prepared draft, and now something
else does.** It sweeps by `identityKey`, and a prepared draft has none — the HMAC
is built from the driver's SSN, which the carrier does not know. So a driver who
corrected their email before their first save landed left the prepared document
alive with its invite hash intact: two live drafts answering one link, which the
non-travel of those hashes exists to prevent. `retirePreparedSource` deletes it,
under the same bar as every other deletion here — the caller must hold that
document's own current token, which `preparedSourceFor` established a moment
earlier.

**Merging is field-aware, because a flat spread destroys nested answers.** The
draft is not flat: repeating lists (employers, violations, accidents, schools,
military, addresses) and keyed answer maps (`customAnswers`) are whole structures,
and a top-level spread replaces one side's structure wholesale — silently deleting
an employment record typed on one device or a custom answer given on another, which
is a larger loss than the scalar case this reconciliation was built for. Repeating
lists are **unioned** (winner's rows first, then loser rows not already present,
capped), keyed answer maps are **merged key by key** with the winner's key winning,
and every other value is taken whole from the winner so a composite such as an
upload descriptor is never assembled from two halves. The repeating-field list is
derived from `applicationSections.json`, not hand-written.

**Navigation is not applicant work.** The draft is written on *every* wizard
navigation, Back included, and Back sends no server save. Advancing the local
sequence on such a write marked this device as holding unsynchronised work
permanently, after which its stale copy beat genuinely newer work from another
device for the rest of the draft's life. A write that changes no answer therefore
leaves the sequences exactly where they were; the step is still recorded. A draft
written before sequences existed is always treated as unsynchronised instead,
because nothing is known about whether the server has its contents.

**An acknowledgement has to name the application it acknowledges.** A save's response
can arrive after a Start Over, and the new draft's counter has restarted from zero — so
the sequence alone can match work the server has never seen. Marking that synced would
make the reconnect flush skip the save it owes, and the applicant would silently lose
server autosave and cross-device resume. Every server save therefore carries the draft's
name, and the acknowledgement requires both the name and the sequence to match. An
*unnamed* stored copy is not a wildcard either — an older client can replace the shared
slot with a pre-name envelope at the same small sequence — so a named acknowledgement
requires an exact match, not merely the absence of a contradiction.

**A dirty local copy is retried when the connection returns.** The `online` event
flushes it once — and only when something is genuinely owed, so a reconnect on a
fully synchronised draft sends nothing.

**A discard has to reach every open tab, and deletion alone cannot carry it.** Start
Over removes the server draft, the resume token and the local copy, and `localStorage`
is shared, so a tab that reloads afterwards already starts clean. What survived was
another tab's *memory*: it still held the answers and still believed it owned a
draft, so its next navigation wrote them back to storage and its next save recreated
on the server the very application the applicant had asked to be rid of. Nothing in
storage could tell it otherwise, because everything the discard touched was deleted —
and a deletion is indistinguishable from "there was never anything here".

So a discard leaves a **positive trace**: `apply_discarded_<slug>`, an opaque value
compared *only for inequality* (no clock is a decision input here either). Every tab
remembers the value it loaded with. The `storage` event — which browsers fire in every
tab except the one that wrote it, so the acting tab never resets itself — updates the
others immediately, and a comparison before every write makes the delayed, queued and
offline-reconnect cases deterministic rather than dependent on an event a suspended
tab may have missed.

Start Over clears the local copy *before* writing the mark, and that order is the safe
one, and it clears only the application it discarded: deleting the server draft is a
round trip, and another tab can write a different application into that one shared slot
while it runs. A tab that never stored a draft of its own — its writes refused on a full
quota — has no name to compare, and that is not a licence to clear somebody else's: an
empty or unnamed slot it will clear, a named one it will not. The resume token is treated the same way — dropped only if it is still the
token that Start Over just retired, because a save from another tab in that window is
issued a token of its own. Clearing frees the space the mark needs; a mark written first can fail on a full
quota, and by then the shared resume token is gone too — so another tab would see
neither a changed mark nor a token, and its next save would be accepted as a
token-less first save that recreates the application just deleted.

What a discard costs a tab depends on where its answers came from. If it **restored**
them, they *are* the discarded application and it returns to a genuinely fresh start.
If the applicant typed them in that tab and never restored anything, they are their
own work: they stay on screen and simply become the start of a new application. A
submitted application is exempt outright — a late signal must never take away a
success screen, a confirmation number or the documents checklist.

**A discard that lands while a tab is still starting up is the narrowest window of
all.** The reaction runs with nothing on screen to reset, so it adopts the mark and
every later comparison reads clean — and the load then restores the stored draft, which
may be the discarded one. The reset counter is what still remembers: the profile load
captures it before its fetch and skips the restore if it moved, the same mechanism the
server reconciliation uses. It checks the mark there as well, for the mirror image of
the same race: a mark written before the listener was installed delivers no event, so
the counter never moves — but the mark this tab loaded with is still different from the
one in storage.

**The comparison runs at the two moments a missed signal would be unrecoverable.** One
is submission: it is checked before any validation, because submitting writes an
application and freezes an immutable snapshot, so a signal the `storage` event never
delivered — a suspended tab, or a discard between the last navigation and the click —
would otherwise make permanent exactly what the applicant asked to be rid of. It is
checked **again immediately before each attempt at the callable**, and by two different
tests, because between the first check and the wire lie an id generation, a queue write
and, on a retry, a backoff wait. The mark comparison catches a discard no event
announced. The reset counter catches one that *did* arrive as an event: an event during
a submission in flight is exempted, so it cannot wipe a submission that has landed —
and that exemption adopts the new mark, which would leave a comparison reading clean.
The counter is bumped before the exemption, so it still remembers. A discard landing in those seconds finds a submission "in flight", which the
reaction deliberately leaves alone so that it cannot wipe one that has *landed* — so
the submit path has to notice for itself. Abandoning it also removes the queue entry
written for guaranteed delivery, or that entry would replay the discarded answers hours
later. The same question is asked once more after the final attempt fails, before the
queued screen appears: that screen promises the submission will go when the connection
returns, and for a discarded application the replay will correctly refuse it, so showing
it would leave the applicant waiting for something that is never going to happen. The
other is the return of the resume lookup, before any prompt is offered: a draft
discarded while that request was open no longer exists, and both answers to a prompt
for it fail against the deleted document, leaving the gate that holds autosave shut
for the rest of the visit.

**Submission closes the draft's life the same way, including when it arrives late.**
The server discards the draft on submission, so the client writes the same mark, drops
the resume token **and abandons its own queued saves**. All three are needed: writing the mark tells other tabs, but
the submitting tab *adopts* that mark, so its own staleness check stays false and a
payload already queued behind an in-flight save would still go out — token-less, which
the server accepts as a first save. Without this a second tab's autosave, or this
tab's own queue, would recreate a draft for an application that had already been
submitted, and the applicant would reappear in the recruiter's "started, incomplete"
list after successfully applying.

**A queued submission is also refused when the application was discarded while it
waited.** The entry records the page's discard mark as it stood when the applicant
pressed Submit — not as it stands at the moment of queueing, because a discard arriving
in between is exempted while a submission is in flight, and exempting it adopts the new
mark. Recording that would give the entry a baseline equal to the discard itself, and a
replay would find nothing changed. The abort dequeues the entry, but a dequeue can fail;
the baseline is what makes that failure harmless. A replay compares it before sending. Nothing else can be relied on to cancel it: the tab
that queued it may be showing a *queued* screen, which a discard deliberately leaves
alone so it cannot wipe a submission in progress, or may be closed altogether. The mark
does not say which application ended, so an unrelated change also drops the entry —
accepted, because the alternative is submitting answers the applicant deleted, and
because a second application queued on the same page while the first was waiting is far
rarer than either.

An offline submission does the same thing at the moment it actually lands. Those three
writes belong to a submission *reaching the server*, not to the applicant pressing
Submit — a queued submission has not been sent yet, and clearing its draft on a
transient network failure would destroy the only copy of their work. So the apply
page's slug travels with the queue entry, which may outlive the tab that made it, and
the queue closes the draft out when a replay succeeds — possibly in a different tab,
possibly a day later. Without that, every other open tab still believes the application
is unfinished and is free to submit those same answers a second time.

**A late close has to prove it is closing the right application.** The slug names the
apply page, not which application was submitted from it, and in the interval the
applicant may have gone back and started a new one. Clearing *that* would delete work
they have not sent and announce their new application as submitted — worse than the
duplicate submission the close exists to prevent. So a draft carries an **opaque name**
of its own, minted when it is created and kept through every later write, and the queue
entry carries the name of the draft it was made from. The close happens only when
storage still holds that draft.

Neither of the two obvious shortcuts works, and both were tried. The write counter is
progress, not identity: it restarts from zero whenever a draft is cleared, so a later
unrelated application eventually reads equal to the one before it. The resume token's
applicant key lives in shared storage, so another tab correcting a contact detail — or
starting over entirely — can move it before this tab queues its submission, stamping
the entry with an application it never submitted. The name is captured from what the
*submitting tab* was working on rather than read back later, for the same reason.

The name is **owned by the writer, not by the slot**. Two tabs can each open the apply
page before either has saved, and if the second one's first write inherited the name it
found in shared storage, one name would cover two different applications — and a
submission holding it would later accept the wrong draft as its own. So a write says
which application it believes it is writing: a name it already holds is kept, no name
means this write is starting one and gets a fresh name, and a write that only annotates
an existing draft — recording a confirmed sync — makes no claim and leaves the name
alone. For the same reason the submitting tab never falls back to reading the name out
of storage: a tab whose own writes failed on quota would otherwise stamp its submission
with whatever another tab had stored.

An empty slot is not somebody else's work: when no draft is stored the mark is still
written, because other tabs may hold those answers in memory. A draft written before
drafts had names cannot be proved either way, so it is left alone.

**A direct submission is scoped the same way, and for the same reason.** Two tabs can
hold two different applications for one page — that is exactly what the discard rule
above produces when one tab keeps what the applicant typed there — so a submission
clears the draft *it* was written from and leaves another application in that slot
alone. The mark is still written either way, because a third tab may be holding the
answers that were just submitted and nothing else will ever tell it. A tab reacting to
a mark clears the stored copy only when it had restored it: in the other case the slot
holds that tab's own application, and deleting it would destroy the backup of work the
applicant is still typing.

**A name never outlives its application.** Start Over, a submission closing out,
"apply again" after one, and reacting to a discard elsewhere all forget it — including
when the reaction *keeps* the answers, because the applicant is then told outright that
those answers will start a new application. Left in place, a queued submission still
holding that name would take the applicant's next application for the one it submitted
and delete it.

**The mark deliberately does *not* say which application ended, and that asymmetry with
the scoped clear is the point.** Naming it was tried, so that a tab minding a different
application could ignore the news. It silently restored the original bug, and the
two-tab browser test caught it: a draft's name identifies one local slot generation, not
the application, so two tabs working on the same application each mint their own the
first time they write. A tab comparing names then decides a discard is none of its
business and goes on showing the answers the applicant just deleted. The name answers
"is what is in the slot still the draft I submitted from?", which is a question about
storage; it cannot answer "is this news about my application?".

So every tab acts on any change to the mark. The residual is accepted and bounded: a tab
minding a genuinely different application on the same page is told that an application
was submitted or discarded, and keeps the answers it holds unless it had restored
them.

**The mark says which of the two things happened.** Discarding and submitting delete
the same three things, and a tab reacting to either sees nothing but a changed value —
so the value carries a `discard:` or `submit:` prefix, read *only* for wording, never
compared for anything. Telling an applicant who has just successfully applied that
their application was discarded would be misinformation about the one action they
cannot undo. A mark written before the prefix existed reads as a discard, which never
claims a submission that did not happen.

**The resume lookup runs before the first server save.** A save racing it loses
the very draft the feature protects: it overwrites the saved step with page one
when the email matches, and the at-most-one-live-draft rule hard-deletes the older
draft when it does not. The hook owns that ordering so no call site can get it
wrong.

**A resume match must not become a lookup service.** "Does a driver with this name
and SSN have an application at this carrier" is not a question an unauthenticated
caller may ask. The response is uniform whether nothing exists, something exists
under a different contact detail, or the applicant already submitted; the bar is
three identity facts *plus* a contact detail already on the record; and both halves
are rate-limited fail-closed per caller **and** per identity, audited without
recording what was attempted. A submitted application is never offered for resume
and its existence is never disclosed.

**Creating a draft and updating an existing one are different security
situations.** Progress saves are public by necessity — an applicant has no account
— but that meant contact details alone could overwrite or supersede a draft that
already existed, so anyone who knew an applicant's email and phone could replace
their saved work, and anyone who knew name, date of birth and SSN digits could
delete it. Creating a new draft is still open. Modifying one that exists now
requires proof of ownership: the resume token issued to the device that created it,
or the full identity HMAC. Superseding another draft on a save requires the
token of **the draft being deleted** — not merely a token for some draft with the
same identity, because the identity facts let a stranger create their own draft,
inherit the victim's identity key, and use the token minted for it. So identity
knowledge alone is not a delete primitive.

**Start Over discards the application the applicant was offered, not every
application their identity has**, and that boundary is a security property rather
than a simplification. Sweeping the identity looks reasonable — start over resolved a
live draft of it by token before deleting anything — but knowing a last name, a date
of birth and an SSN is enough to *create* a draft that inherits the victim's identity
HMAC and to be handed a valid token for it. "I own a draft with this identity" is
therefore true of a stranger, and a sweep authorized by it deletes the real
applicant's work. So a draft is retired only by a caller holding that draft's own
token. A sibling — which exists because some other browser created one without a
token — is left to its own start over, to being offered on a later visit, or to the
30-day TTL. The existence check, the authorization decision and the write happen in **one
transaction**: a standalone read followed by a later write leaves a window in which
two first saves each mint a token and overwrite each other, or a save lands after
Start Over and resurrects the application the applicant just discarded.

An unauthorized attempt spends a refusal budget kept per caller **and per targeted
draft** — keyed on the draft being attacked rather than on the identity the caller
claims, because the caller supplies those facts and could vary them per request,
and on its own key, so a stranger's refused writes cannot exhaust the budget the
real applicant needs to find their draft. It is audited, and returns exactly what a
network failure returns —
`{ saved: false }` with no key and no token — so the refusal does not confirm that
a draft exists. **Known and accepted limitation:** a caller who already holds both
the email and the phone can still distinguish "refused" from "created" by watching
whether a token comes back; it is hard rate-limited and audited, and is strictly
narrower than the overwrite capability it replaced. **A resume token that opens nothing is refused.** Presenting one says "I am writing
the draft I already own", and when that draft has been deleted — by Start Over in
another tab, or by submission — the sentence is no longer true and the payload was
composed against something that is gone. The client cannot cover this case on its
own: the request may already have been on the wire. So a presented token must still
resolve to a live draft (the target document, then the identity's own drafts, then a
bounded recent scan when no identity HMAC can be derived), and otherwise the save is
refused. **Resolving includes the token's last two generations**, because a resume lookup
rotates the token on a live draft *before* the applicant has chosen anything: a second
device reaching that prompt and closing it again would otherwise end the first device's
server autosave for good, for an applicant who deleted nothing. The old generations prove
only that the draft still exists; changing it still requires the current token or the
full identity, so a harvested old token gains nothing. It is judged **before** ownership and independently of it, because the
identity bar would happily authorize that same stale payload — the applicant's own
name, date of birth and SSN are in it — and let it overwrite whatever replaced the
draft it was written against. Legitimate saves never trip it: ordinary autosave
presents the token of the document it is writing, an applicant correcting their email
presents a token whose draft is alive until that same save retires it, and a first
save presents none. The resolution steps **fall through** rather than deciding, which
is what keeps that promise when someone corrects a contact field and an identity field
before the same save — both the document id and the identity HMAC change at once, and
an early answer from either would refuse every save after it. For that same case the
browser also names the key it believes its token belongs to, and the server resolves it
with a single read — a hint and never a claim, because the token hash on the named
document still has to match, so naming another applicant's draft proves nothing and
gains nothing. It is what keeps the promise when the owned draft is old enough to sit
outside the bounded recent scan. Audited as `stale_token`, which is ordinary multi-tab life and
deliberately not filed as an attack.

A second, accepted
consequence: someone who creates a draft at another person's key *before* they
ever apply leaves that applicant without server-side autosave or cross-session
resume at that carrier, because the squatted document is the one their saves would
have to modify. Their local copy and their submission are unaffected, the squatter
can read nothing, and the squatted draft expires with the 30-day TTL.

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

**Legal agreement wording is versioned and frozen.** Five agreements
(`mvrAuthorization`, `electronicSignature`, `fcraDisclosure`, `pspDisclosure`,
`clearinghouseConsent`) live in `functions/shared/legalAgreements.js`, current
version `v1`. Each carries `presentedOn`: the MVR authorization is answered
Yes/No on the Violations step (the `consent-mvr` answer records
`agreementAcceptances.mvrAuthorization` with the version shown); the other four
are accepted on the Consent step. A submission is bound to the version the
applicant actually saw, never to whatever is deployed when the request lands.
`legacy-1` bodies are a **frozen forensic record — never edit them**.
`clearinghouseConsent` deliberately has *no* `legacy-1`, so historical
reconstruction can never attribute a consent nobody gave. **Applications
submitted before the MVR authorization existed have no acceptance for it** and
their records say so; nothing back-fills a consent.

**A company may publish its own wording for an agreement, and that wording is
immutable too.** Versions are content-addressed (`c-<12 hex>` of agreement id +
body) and stored at `companies/{id}/legal_agreements/{agreementId}`, a path with
no client rule at all — the three callables (`listCompanyAgreementWording`,
`publishCompanyAgreementWording`, `revertCompanyAgreementWording`) are the only
access, and **publishing or reverting is Super Admin only**; a Company Admin can
read what is in force. The public apply page receives the active company text
through `getApplicationAgreements`; the snapshot freezes the company text at its
`c-` version, so an applicant who accepted an older company version keeps that
exact text forever, and a version whose hash no longer matches its body is
dropped rather than trusted. A submission binds each agreement to the version
the acceptance names when that version is real — a company version the company
actually holds, or a current platform version — so wording published between the
page loading and the submission landing never replaces what the applicant read.
If the company's wording record cannot be read, the read **fails** (`unavailable`)
rather than degrading to platform text: the apply page retries, and a submission
falls into the existing failed-snapshot path instead of freezing text the
applicant never saw.

**Application Rules have one engine.** `functions/shared/applicationRules.js`
mirrors `src/config/applicationRules.js` (bodies byte-identical, asserted by
`applicationRules.test.js`; the date helpers in `applicationDates.js` likewise),
driven by `functions/shared/applicationRulesCatalog.json`, which is also what the
settings UI renders. The same `evaluateApplicationRules` runs in each wizard step
(inline, the moment an answer changes), in the browser's final pre-flight (which
walks a resumed applicant to the first page that fails) and in
`submitGuestApplication` (`assertApplicationRules`, which refuses with the same
sentence). Rules: previous address when under three years at the current one;
which experience options are offered; which vehicle-experience categories are
shown and how they are worded (stored keys never change — a hidden category with
a saved value still displays); expired CDL and expired medical card, each
allow / warn / block; require previous-licence details; MVR authorization
optional / required; require violation details and accident details when the
applicant answers Yes (accidents record fatalities, injuries and hazmat spill);
employment-history enforcement allow / warn / block with a configurable minimum
of years; require a felony explanation; Hours of Service statement off / on (when
on, the statement must cover exactly the seven days before the reference day, so
a week carried in a resumed draft is refused and re-asked). A Yes to the MVR
authorization is accepted only with its recorded acceptance evidence beside it;
the question stays disabled until the wording has loaded.
**Every default reproduces the pre-2026-09-02 behaviour**, so an unconfigured
company is unchanged, and `warn` is what "three-year coverage" always did. An
impossible date (30 February, a year outside the field's range) is refused
everywhere regardless of configuration. Legacy records with violation or
accident rows but no Yes/No answer read as Yes; an explicit No drops everything
that answer revealed — leftover rows *and* the conditional fields beneath it,
such as the licence-revocation, conviction and felony explanations — at review,
pre-flight and on the server alike (`normalizeApplicationAnswers`). The full set
is `conditionalAnswers` in `functions/shared/applicationRulesCatalog.json`, which
both mirrors read; a conditional field added to a step but not listed there is
still submitted after the driver answers No, and prints on the recruiter's PDF
under an answer reading No.
Super Admin sets any company's rules from Companies → Edit; Company Admins set
their own from Settings.

**Acceptance IP is server-observed.** The browser may report its user agent
(self-description) but its claimed IP is overwritten unconditionally with the
address the server saw. Evidence forgeable by the party it incriminates is not
evidence.

**Employment history must cover 36 months by default.** Per 49 CFR
391.21(b)(10), the application must account for the previous three years;
employment, unemployment, schooling and military service all count, so a gap is
only a gap when nothing explains it. The company's `employmentHistoryMinimumYears`
rule (1–10, default 3) sets the window and `employmentHistoryEnforcement` decides
whether incomplete coverage is ignored, warned about once, or blocks submission. The calculation is calendar-month based and pure (no
I/O, injected reference date) so a recorded coverage result never drifts. The
logic is implemented **twice** — `functions/shared/employmentCoverage.js` and
`src/shared/utils/employmentCoverage.js` — because the browser needs the same
answer and the SPA does not import the CommonJS backend modules. Both are proven
identical against the shared `employmentCoverage.vectors.json` fixtures.
**Change both or neither.** (The same convention is used for
`searchNormalization`, `applicationRules` and `applicationDates`; note that the
*data* files `functions/shared/applicationSections.json`,
`applicationRulesCatalog.json` and `applicationRules.vectors.json` are genuinely
shared by direct import from `src/config/`.)

**A carrier-prepared application is a draft, and the carrier stops being able to
read it the moment the driver writes.** It lives at
`companies/{id}/application_drafts/{applicantKey}` with `origin: 'company'` and a
status of `prepared` → `sent` → `driver_in_progress`. The carrier may read back
the answers it wrote until the driver's first save, which flips the status
one-way (in `drafts/save.js`) and from then on returns contact and progress only —
the same shape `listApplicationDrafts` has always returned. The company's own
authorship is what earns that read; the driver's first write ends it. A carrier
may never overwrite a draft the driver started themselves, and knowing an email
and a phone does not open a prepared one: it carries no identity HMAC (the
carrier does not know the driver's SSN), so only the invite token lets the
intended driver in.

**That cutoff has two doors, and until 2026-09-08 only one was shut.**
`getCompanyPreparedDraft` consulted `companyMayReadAnswers`, which tests
`status`; `exchangeApplicationInvite` consulted `isCompanyPrepared`, which tests
`origin` — the field recording who *created* the draft, which deliberately never
changes. So a carrier could mint a link, exchange it itself (the exchange is
unauthenticated by necessity), and recover exactly the answers the cutoff had
just withheld, plus a resume token that could rewrite them — and
`StartApplicationPage` offered the mint button on the very screen that says the
answers are the driver's. Gating the mint would not have closed it: the driver's
first save leaves `inviteTokenHash` alone, so the link the carrier had already
copied kept working.

**So the link is tiered, and since 2026-09-09 one predicate decides the tier.**
`companyMayReadAnswers` — the carrier authored these answers *and* the driver has
not written over them — is now asked at both doors, which is what stops the
composition being written a third time. While it holds, the exchange hands over
everything. Otherwise it returns `requiresIdentity` and nothing else — no answers,
no resume token, no step, not even `preparedBy` — and writes nothing, so it can
neither read the driver's work nor displace the token their browser is saving with.
(It used to rotate that token on every open, demoting the driver's to a prior
hash, which grants liveness but never write authorization: a carrier opening its
own link a few times could silently stop the driver's autosave.) Minting still
works after takeover, deliberately: a driver who lost their link needs a
replacement, and the replacement is a pointer rather than a credential. Pinned by
`companyApplications.invite.privacy.test.js`.

**The second tier was a sentence, not a mechanism, and that was the reported
bug.** It delegated to `findResumableApplication`, and neither half of the
delegation worked. Measured in production on 2026-09-09 against a carrier-prepared
application at the consent step:

- **Nothing rendered `requires_identity`.** The outcome reached
  `resolveApplyStatusScreen`, matched no branch, and the intake chooser is what
  sits at the bottom of that function — so a driver who opened the replacement
  link their recruiter had just sent was shown *"How would you like to start your
  driver application?"* with their own hour of work behind the link and nothing
  said. The exchange returned 200 both times they tried. The code comment standing
  in for the missing screen claimed the driver "is asked for their details by the
  ordinary resume flow underneath"; that flow only fires on the first Next of page
  one, inside the blank application the chooser had just started.
- **The lookup could not have matched anyway.** It queries `identityKey ==`, and
  autosave was erasing that field (below). The reported draft held
  `identityKey: null`.
- **A global lookup is the wrong question.** The link already resolved the
  document from its own token. "Does any draft at this company match this
  identity" throws that away, needs a composite index, and makes the applicant
  guess which of their contact details the recruiter typed.

**The claim is now checked against the draft the link names**
(`companyApplications/inviteIdentity.js`), and `ApplyIdentityCheckScreen` asks for
it: last name, date of birth, Social Security Number, and one contact detail
already on the record — the sentence `InviteLinkPanel` had been showing recruiters
all along. Two tiers of *checking*, because production holds both shapes. With an
`identityKey` on file the claim is verified by recomputing the HMAC, which is a
real check on the SSN and subsumes the other two facts. Without one — a draft the
erasure caught, or one predating the field — the name and date of birth are
checked against the draft's own answers and a well-formed SSN is required but
cannot be verified; a success then **establishes** the HMAC, so a draft passes
through that tier at most once. A refusal is `permission-denied` with a sentence
the driver can act on (they may simply have mistyped), rate-limited per targeted
draft as well as per caller, and audited as `invite_identity_refused`. Saying
"those details do not match" discloses nothing new: the holder was already told
`requiresIdentity`.

**A device that already holds the draft's resume token is asked nothing at all.**
`reconcileServerDraftOnLoad` satisfies the challenge when the stored token
resolves the very application the link named — the strongest resume path is the
one that asks the applicant for nothing, and a replacement link may not take it
away. A token belonging to a *different* applicant does not satisfy it, and their
local copy is withheld from the merge exactly as it is on the `opened` path.

**A confirmed exchange returns the step.** Withholding it was survivable only
while a prepared draft was always on page one: handing a driver their answers and
dropping them at the start of the wizard reads as "nothing was saved", which is
the failure the whole draft feature exists to prevent.

**A continuation link is not only for an application the carrier prepared.**
`isCompanyPrepared` gated the mint and the exchange's resolution predicate, so the
people on `/company/drivers/unfinished` — a list whose whole purpose is "who
started and did not finish" — could not be sent back to their own work at all, and
the only answer to "how do I get this driver to finish?" was "ask them to start
again". Minting now works for any live draft; whose words are in the draft decides
what the link *hands over*, never whether it opens. A driver-authored draft is
always in the identity tier, its `status` and `origin` are left exactly as they
are, and it never appears in the prepared-applications list. Dropping the
`origin == 'company'` filter from the exchange's fallback scan also removed that
path's dependency on the `origin`/`updatedAt` composite index.

**The invite link is its own token, and its own risk.** Minted by
`mintApplicationInvite` (random 32 bytes, only the SHA-256 stored, returned once),
it expires in 14 days — independently of, and always inside, the draft's 30-day
retention. It is deliberately not the resume token: a resume token lives only in
the driver's browser and is rotated freely, while this one is designed to be
copied into an email or a text message. **Accepted risk, in the same family as
the absent App Check:** a link in a sent-mail archive is a bearer credential for
one prepared application until it expires or is regenerated.
`exchangeApplicationInvite` answers a wrong link and an expired one identically,
is rate-limited fail-closed per IP, and hands back a resume token so the rest of
the wizard behaves like any other resumed session. Minting is rate-limited too,
per company and caller, and refuses when the carrier has stopped accepting
intake — every regeneration retires the driver's live link, so an unbounded loop
would be a way to keep one application permanently unopenable.

**Validity belongs to a token, not to the document, and that is a correction.**
Until 2026-09-08 matching accepted the current hash *or* any prior hash while
validity read a single document-level `inviteTokenExpiresAt` that every mint
rewrote — two independent questions composed into one answer. Regenerating
therefore did not retire the old link, it **revived** it: a link dead for a week
opened again, with a fresh resume token, for another fourteen days, while the
panel told the recruiter the opposite. `MAX_PRIOR_INVITE_HASHES` was also 2 over a
`[current, ...prior]` slice, so three links were live at once where this brief
said one. Each accepted hash now carries its own expiry (`priorInvites`), and
`liveInviteFor` asks both questions of one entry, which is what stops the
composition being written again. A replaced link keeps
`min(its own expiry, now + 10 minutes)` — the mid-page grace the prior hash always
claimed to be, now bounded in time rather than in generation count — and an
already-expired hash is not carried forward at all. Legacy bare-string prior
hashes have no expiry of their own and are read as dead. Pinned by
`companyApplications.invite.expiry.test.js`, whose first case is the sequence the
original suite structurally could not see: expire, regenerate, present the old
token.

**A link that will not open says so, and starting fresh is a choice.** Every
failure used to resolve to `null`, and the bootstrap used the same `false` for
"the invite could not be opened" as for "there is no invite in this URL" — so a
wrong link, an expired one, a rate-limited exchange, a Firestore hiccup (the
limiter fails closed) and a temporary outage were all indistinguishable from
having followed no link at all, and the driver was dropped into the ordinary
application, possibly pre-filled from a different applicant's saved draft, with
nothing said. The consequence was more than a missing message: a silent
fall-through never claims the invitation, so the carrier's locked employers went
unenforced and it received a second, unprepared application — losing the
49 CFR 391.21 employment history it had prepared.

`exchangeApplicationInvite` now throws like every other callable in its file and
`publicApplyInvite.js` classifies the failure, into statuses named for what the
driver is told rather than for the server code. **`unopenable` is deliberately one
bucket** for wrong, expired, already-submitted, superseded and discarded, because
the server answers all of them identically on purpose and saying more on this
side of the wire would give away what it withholds. Everything else is separated
only along the line the driver can act on, and **retry leads for the transient
causes** precisely because retrying is what prevents the duplicate application.
`ApplyLinkProblemScreen` renders below the success screen — a dead link may not
take away a confirmation number — and above the intake chooser, so continuing to
an ordinary application is an explicit button and never a fallback. The render
precedence itself is unchanged. `resolveApplyStatusScreen` in
`PublicApplyScreens.jsx` holds that order beside the screens it orders, because
three of its four positions were learned from a defect.

**Employers a carrier locked from a PSP report keep their identity.** A PSP
report names a carrier and its USDOT number beside an inspection date; it does
not say when the driver started, left, or why. So a locked row's name and USDOT
number are fixed and everything else on it is the driver's. Enforced by
`applicationLockedFields.js`, mirrored byte-identically between
`functions/shared/` and `src/config/` with a parity test, and checked in three
places: the wizard renders the identity as a record rather than a field, the
browser pre-flight refuses and routes to the employment page, and
`submitGuestApplication` refuses again — the only one of the three that is
enforcement. It applies **only once `inviteClaimedAt` is stamped**, i.e. to a
driver who actually opened the carrier's link: refusing someone for leaving out
an employer nobody showed them would be refusing them for the carrier's homework.

**The exchange no longer stamps that claim; the driver's first save does**
(changed 2026-09-08). Stamping it on the exchange meant the *carrier* could arm
the refusal by opening its own link once — after which a driver who applied at
`/apply/:slug` instead of through the link was blocked at submission by rows
nobody had ever shown them, which is the exact failure the field exists to
prevent. So the exchange records which resume token it minted
(`inviteResumeTokenHash`) and `drafts/save.js` stamps the claim when a save
presents that token, clearing the field as it does. That proves both halves: the
link was opened, and the session holding the carrier's answers is the one
writing.

**A lock is a snapshot, and the carrier kept editing the rows it was taken
from.** Nothing held the two in step, so four ordinary carrier actions produced an
application the driver was blocked on at submission and could not fix (found
2026-09-08): deleting a locked row left the lock behind as an invisible
requirement, with the row's own Unlock button gone along with the row; correcting
the NAME on a row locked by USDOT number tripped `locked-employer-changed` while
the wizard renders that identity as a record rather than a field, so the driver
was blocked on the one field they are not allowed to touch; and correcting the
name, or adding a USDOT number, on a row locked by name moved its signature onto
`locked-employer-missing` for a row sitting right there.

Two halves fix it. **The carrier's editor renders a locked row's identity
read-only** — the same rule the design system already states for a field its
viewer may not change, and the same shape the driver's wizard uses — so a
signature cannot drift while the lock exists; correcting it means Unlock,
correct, Lock, which mints a lock that matches. And
**`reconcileLockedEmployers`** drops any lock no longer answered by a row, which
is the case that leaves nothing to render. It runs on every carrier save
(`prepare.js`, the authority) and **once inside the exchange that hands the
application over**, which is what heals a draft already carrying an orphan —
before its driver can be blocked by it, and while the rows are still provably the
carrier's. It deliberately never runs against answers the *driver* supplied:
reconciling at submission would make deleting a locked row enough to delete its
lock, which is the whole thing the lock prevents. `lockedEmployerCount` — computed
and returned all along, and rendered nowhere — is now in the worklist, so the
number is checkable rather than a thing to trust.

**The lock follows the applicant, not the document id.** A draft's id is
`sha256(company:email:phone)`, so a driver who corrects their own email or phone
on page one writes to a different document than the carrier prepared. The
carrier's facts about the application — `origin`, `preparedBy`, `invitedAt`,
`inviteClaimedAt` and `lockedEmployers` — are copied onto the new id by
`drafts/save.js`, using the draft the driver's resume token opened. Without that
copy the submission would read the locks from a key that has none, so correcting
a typo would silently unlock every employer the carrier locked. The invite token
hashes deliberately do **not** travel: they address one document, and two live
drafts answering one link is a worse problem than a claimed link that has to be
sent again.

**Company edits to a submitted application need driver approval.** A company
admin's edits become per-field `pending_changes`; the main document stays the
**canonical original** until each field is resolved, so exports keep showing
originals for unapproved edits. The driver approves, rejects or corrects them
through a token link (`/review-change/:token`, 30-day TTL). The
`hasPendingCompanyChanges` flag clears only when all fields are resolved. All
writes go through callables; client writes to `pending_changes` are denied.

**Previous employers are editable through that workflow, and `employers` is the
one field that is not just a value.** `SchemaSection` renders an `array` section
read-only whatever `isEditing` says, so until 2026-09-09 Edit Application could
change every scalar field and none of the employment history — the section a
recruiter most often has to correct, since 49 CFR 391.21(b)(10) wants three years
accounted for. That renderer is shared with the driver's own wizard, so
`PreviousEmployersEditor` (add / edit / delete) is swapped in for the one section
while editing and every other section renders exactly as before. Nothing there
writes: it produces an array that goes through `proposeApplicationChanges` like
any other edit. The driver's review portal renders that change as named employers
added, removed and changed field by field, rather than as the generic
"2 item(s) → 1 item(s)" — which is not a decision anybody can make.

**An employer has an identity, because a verification is filed against it.** A PEV
mirror lives on the employer row (status, respondent, result document, history)
and `verification_requests/{token}` addressed it **positionally**, by
`employerIndex`. Both the employer's own response and the reminder cycle wrote
their result into `employers[idx]`, which is sound only while nobody changes the
array — and making employers editable makes changing it a supported workflow. The
failure is exact: with `[0] ABC Trucking` completed and `[1] XYZ Transport` not
started, deleting ABC makes XYZ index 0, and ABC's outstanding request then files
ABC's respondent, signature and result PDF against **XYZ**, silently. Reordering
does the same.

So each row carries an `employerId` — twelve opaque hex characters, minted once
and never rewritten, deliberately *not* derived from the row's contents, because
`employerSignature` in `applicationLockedFields.js` is content-derived and
correcting a typo would move it. Rows are stamped lazily by the two paths that
already write the array (the change proposal, and `sendVerificationRequest`),
never by a migration and never on the frozen snapshot. `resolveEmployerTarget`
answers by id; for a request that predates ids it honours the index **only while
the row there is still the employer the request was sent to**, which the request
itself recorded as `employerName`, and otherwise refuses the write-back rather
than guessing. Nothing is lost by refusing: `verification_requests` holds the
response, the signature, the method and the PDF permanently and is the
authoritative record — the row is a mirror of it.

**A client never decides which employer owns a verification.**
`shared/employerEdits.js` strips every PEV field the browser sent and re-attaches
it from the record by identity — at proposal time so the driver sees an accurate
diff, and **again at resolution time**, which is the authoritative pass: a
verification can complete while a review link sits unopened for days, and
applying the proposal's snapshot would roll it back. That second pass is also what
closes the driver's `edit` action, which writes its value straight onto the
document with no other validation. Removing an employer that has verification
activity is allowed — a carrier legitimately removes a row added in error — but it
is confirmed explicitly, named in the activity log with the verification state
that went with it, and never deletes the PEV record.

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
- **Server-only collections** are closed to every client, including super
  admins: `rate_limits`, `processing_status`, `integrations_index`,
  `environment_audit_log`, `ai_provider_config`, `ai_routing_config`,
  `ai_telemetry`, `blog_posts`, `blog_runs`, `platform_settings`,
  `landing_leads`, `orphaned_signature_cleanup`,
  `companies/{id}/application_drafts`, `companies/{id}/application_draft_audit`,
  `companies/{id}/legal_agreements` (company legal wording — callables only,
  publish is Super Admin only), and the `application_originals` Storage prefix. Some rely on default-deny with
  no rule at all; the AI, blog and application-draft paths carry an **explicit**
  `allow read, write: if false`, which is the stronger form — it survives a later
  broad `match` being added above them, and it states the intent where a reader
  looks. `environment_audit_log` is unreadable **even by super admins**, so it
  cannot be read around or forged through the callable.
- **Guests never write Firestore directly.** Guest application creates go
  exclusively through `submitGuestApplication`.
- **Documents are never public URLs.** Every file link is server-issued, single
  purpose and checked against company membership (`getSignedDocumentUrl`,
  `getSignedApplicationFileUrl`, `getSignedGuestUploadUrl`, `getSignedPevUrl`).
  Persisted upload URLs expire, so views re-sign at view time.

**Starting an application for a driver is company-workspace access, not admin.**
`/company/drivers/start-application` is deliberately not `adminOnly`: a recruiter
holding a driver's file is who does this, and nothing it produces is filed. The
callables use `assertCompanyAccessForRequest` / `assertCompanyAccess` for the
same reason, with per-user fail-closed rate limits.

**Application configuration is split by sensitivity.** A Company Admin manages
Standard Questions, Application Rules, Custom Questions and Integrations
(`applicationConfig`, `applicationRules`, `applicationIntegrations` on the
company document, an ordinary admin update). Legal wording is the exception:
reading what is in force is Company Admin, but publishing or reverting a
company's agreement text is **Super Admin only**, and Super Admin can also set
any company's Application Rules from Companies → Edit.

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
| **AI providers** | CDL auto-fill, e-doc field placement, blog generation, reading an applicant's own PSP report or MVR into *suggestions* where the company enables it (`extractApplicationReport`), and — for any company — reading the paperwork a recruiter attaches when starting an application (`extractCompanyApplicationDocuments`: one text task over whichever documents were attached, with a per-document vision fallback) | Secret Manager via the frozen registry in `functions/ai/registry` |
| **Telegram** | **Retired 2026-08-29** with the marketing-site lead form (`LD-R3`). No callable in `functions/index.js` sends to it. The six retired landing callables were still deployed on 2026-09-06 because the live Production frontend still called them; since 2026-09-06 `promote-production.yml` deletes them automatically as its last step, the first time a release carrying `LD-R3` is promoted (`scripts/retire-landing-functions.mjs`, idempotent, verified by URL probe); procedure and manual fallback in `docs/FIREBASE_HOSTING_RUNBOOK.md` | Secrets unbound; rotate the bot token (runbook) |
| **Socrata / Transportation.gov** | FMCSA employer autocomplete | Public app token |
| **Sentry** | Error monitoring (frontend + functions) | DSN |
| **GitHub API** | Release promotion from the Super Admin UI | GitHub App credential, server-side only |

**Two hard boundaries:**

- **No feature may call an AI vendor directly.** Every AI request goes through
  `functions/ai/` (task interface → capability-aware router → provider adapter →
  schema-validated response). `npm run check:ai-boundary` fails CI if one tries.
  Every request carries a transaction id and records a per-provider timeline in
  `ai_telemetry`, visible at Super Admin → AI Integrations → **Logs**; the
  connection test probes each capability a provider claims rather than only that
  its key works, and reports a throttled probe as untested rather than as broken.
  Health and cooldown are tracked **per lane** (text / vision), because a
  provider's text and image work reach different models on different entitlements
  and fail independently. A task may set `perAttemptDeadlineMs` below its total so
  no single provider can consume the whole budget: without it the first provider
  in the routing order could stall for the entire deadline and the request would
  time out (`deadline_exceeded`) before a healthy provider was ever tried — the
  document reader sets it so a stalled leader fails over instead. See
  [`docs/ai-platform.md`](./ai-platform.md).
- **Credential access differs by function generation, and both must be granted.**
  This project mixes 1st- and 2nd-generation functions, which default to
  *different* runtime service accounts (App Engine and Compute Engine), so
  `roles/secretmanager.secretAccessor` is needed on both or one AI entry point
  reads a credential the other cannot. Super Admin → AI Integrations →
  **Check credential access** asks both generations and names the account actually
  in use. "The secret is missing" and "this runtime cannot read the secret" are
  reported as different faults, because they need opposite actions.
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

Every publication run — scheduled or operator-triggered — records one row per slot
in `blog_runs`, naming the pipeline stage that refused: sourcing, generation,
validation, claim check, verification, originality, image or publication. Before
this, a refusal existed only as a log line, and an AI transaction reporting
`success` meant "a provider replied in shape" — not "an article published" — so
generation and fact-check could both read green for a run that published nothing.
Super Admin → Blog Posts → **Publication runs** is the read path. **No article is
ever published to meet the daily count**; refusing is a recorded outcome.

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
  policy. `blog_runs`, `application_drafts` and `application_draft_audit` are
  stamped the same way, with TTL field overrides declared in
  `firestore.indexes.json` so they deploy with everything else. An unfinished
  application expires after 30 days if nobody comes back to it.

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
  `featureSchedules` and internal fields. Since DTO v3 it carries the resolved
  `applicationRules` and the `applicationIntegrations` enabled flags (booleans
  only), which is how the wizard and `extractApplicationReport` know what the
  company switched on; the server reads its own copy, never the client's. If a
  company setting has no effect on `/apply/:slug`, the projection allowlist is
  the first place to look — that has been the bug before.
- **`application_drafts` now holds two kinds of thing.** A driver's unfinished
  application and a carrier's prepared one live in the same collection, told
  apart by `origin`. Anything that reads or writes that collection has to keep
  that distinction: the read cutoff, the locked-employer list and the invite
  token all hang off it, and a change that treats every draft alike would either
  leak a driver's answers to the carrier or refuse the carrier its own.
- **Text extraction happens in the browser, not the server.** `pdfjs-dist` for a
  PDF's text layer and a lazily-imported `tesseract.js` for OCR. Nothing
  server-side parses a PDF or runs recognition, and the tesseract chunk must stay
  lazy — a static import would put ~2MB into the company workspace bundle for
  every recruiter, including the ones who only ever attach real PDFs.
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
- **The blog owns its stylesheet now.** `/news`, `/news/{slug}` and
  `/news/feed.xml` are rendered by `serveBlogPublic` and styled by five files in
  `web/assets/css/`, cut out of the retired marketing site's single 3447-line
  sheet at its own section boundaries and kept in its source order. **They are
  one stylesheet and the `<link>` order in the shell is the cascade** — moving a
  rule between them, or re-ordering the tags, can make a late override start
  losing to an early rule it used to beat. Historical note, because it explains
  the shape: the marketing homepage and privacy page shared that single file with
  the blog, which is why removing the landing site could not be a deletion.
  The old sections 6, 16 and 18 dress the navbar, cards and footer the blog
  function emits, so nothing in them may
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
- **Unfinished applications live in their own collection.** Not in `applications`,
  because four `create` triggers there would email half-finished applicants and
  create driver profiles for people who typed a name and left. See §5.
- **Discarding a draft is never a dismissal.** `ConfirmDialog` routes Escape to
  `onCancel`, so if "start a new application" were the cancel action a stray
  keypress would permanently delete the work an applicant came back for. Start over
  is its own explicit destructive confirmation, and Escape at either stage deletes
  nothing.
- **A carrier-started application is never an early `applications` document.**
  Creating one fires four triggers — a recruiter notification, an "application
  received" email to the applicant, a `drivers/{id}` shadow profile and the
  dashboard counters — before anyone has read, consented to or signed a word of
  it. It is staged as a draft and promoted by the driver's own submission,
  exactly as an unfinished application already was.
- **Imported reports suggest; they never answer.** A PSP report or MVR the
  applicant uploads yields suggestions with their own Add buttons. Nothing
  already entered is overwritten, nothing is added twice, and a PSP carrier
  sighting becomes an employer row holding only the name and USDOT number —
  **PSP data is inspection and crash history, never employment dates**, and the
  UI says so. Nothing from either document is stored or logged; the pages live in
  memory for one request.
- **The public site stays dependency-free.** No framework, no build step, and no
  application or design-system imports. `web/privacy.html` ships no `<script>` at
  all, asserted by `src/tests/hostingConfig.test.js`.
- **Marketing claims must trace to the capability registry.**
  `functions/ai/knowledge/safehaulCapabilities.js` is the source of truth, and
  `npm run check:public-claims` enforces it — as a step of the always-required
  `callable-contract` CI job, which runs on every push and pull request and
  which no lane selection can skip, and as part of the root `npm run lint`. Never
  claim DOT/FMCSA compliance, MVR/PSP/Clearinghouse checks, document-expiry
  monitoring, a job board, or any named carrier endorsement.
- **A `web/` change runs the `frontend_unit` CI lane.** The public site has
  no build step, so "static content is not tested" is an easy assumption — and
  `scripts/ci-plan.mjs` used to encode it, mapping the old `landing/` to no lane
  at all. A static-only commit therefore passed CI green while shipping a homepage
  that claimed MVR checks, captured no lead, and failed `npm run lint`. That site
  is gone and `web/` replaced it — the directory changed, the lesson did not.
  `src/tests/hostingConfig.test.js` covers it in that lane; `A5`/`A5b` in
  `scripts/test-ci-plan.mjs` pin the mapping. The claims check is deliberately
  NOT in this lane: it has two inputs, the pages and the capability package, and
  a registry change selects only the functions lane. It runs in the
  always-required `callable-contract` job instead. Until 2026-09-01 it lived in
  the root `npm run lint` only, which CI never ran (the job runs
  `lint:frontend`), so it was documented as a gate without being one. `K4` pins
  the step to an always-required job, blocking and unconditional, pins that the
  checker and the package need nothing installed, and refuses a page in a
  subdirectory the checker does not scan.

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
the temporary exception. **No 9px or 10px body text.**

**Tables on phones (since 2026-09-06).** A table whose rows are compared keeps
the table: a labelled, focusable horizontal-scroll region, a sticky header and
the first column pinned so the row's label stays in view (`DataTable` by
default, `data-pin-first-column` on a native table). A matrix of per-row form
controls worked one record at a time — the SMS recruiter-assignment matrix —
becomes one card per row under 768px (`data-mobile-presentation="cards"`), the
same elements at every width. The Super Admin feature matrix is the one
specialized grid. Source and guards: `src/design-system/components/data-table/README.md`.

Two contracts have no exception route at all, because both are enforced by the
code refusing to run rather than by a check that has to notice. A dialog goes
through `Modal` and takes its size and shape from the chrome contract — the
props that used to let a call site replace that wholesale now throw. And every
glyph comes from `@design-system/icons` at a step on the icon scale
(`xs`…`3xl`, 12–32px): the registry hands out **tokens**, not components, so
`<Trash2 size={13} />` throws by name at the call site. A glyph **inside a
design-system container states no step at all** — `Button`, `IconButton`, `Tabs`,
`Chip`, `SegmentedControl`, `FileInput` and `StatusMedallion` each size the glyph
they hold, so two controls of the same size can never carry differently-sized
glyphs. **Every file outside the registry is on the contract**: the migration campaign
finished on 2026-09-06, its backlog file was deleted, and `npm run
check:icon-contract` now refuses a `lucide-react` import anywhere under `src/`
outside `src/design-system/icons/` — with nothing recorded and nothing exempt.
The one file that opens a glyph by hand is `VOEDocument.jsx`, through the
contract's own `glyphComponent`, because the exported verification document must
carry no `ds-*` class and `Icon` stamps one; the reason is written above the
calls. Update the roadmap with
evidence in the same task, and never mark an item complete without the
functional, visual, mobile, accessibility, documentation and diff checks
actually having run.

**These rules are now checked, not just written.** Eight automated guards stand
behind them, and they exist because for most of 2026 a substantial, well-adopted
design system coexisted with 660 raw palette classes, off-scale type and
sub-12px text — all of which passed review, lint, 234 test files and CI, because
nothing looked:

| Command | Blocking | Catches |
|---|---|---|
| `npm test` (`design-system/tests/`) | yes | An import across a layer boundary — in stylesheets as well as modules; a broken token contract or a pairing below AA |
| `npm run check:ui-contract` | yes | A raw colour, off-scale type, sub-12px text, a Tailwind radius or shadow, a hand-built overlay, a raw table, a hand-styled control, a hand-rolled tablist, a hand-rolled toggle, current-item control or avatar disc (a raw `<button>` with `aria-pressed` or `aria-current`, or a round disc holding a person's initial), a raw file input, a hand-written `target="_blank"` — in JSX, in stories and in CSS |
| `npm run check:icon-contract` | yes | **Any** file under `src/`, outside `src/design-system/icons/`, importing `lucide-react`. The migration campaign finished on 2026-09-06 and its backlog file was deleted, so there is nothing recorded and no list to add to; while it ran, the direction was read out of git so a change could not record its own exemption |
| `npm run check:table-layout` | yes | A cell narrower than its content, in a real browser at 412px and 1440px — for `DataTable` and the `ds-native-table` contract |
| `npm run check:visual-contract` | yes | A change to computed geometry — control heights, cell padding, radii, resolved colours, and a frozen table column losing its opaque background |
| `npm run test:stories` | yes | A story that fails to render, or fails axe |
| `npm run test:visual` | **yes**, since 2026-08-25 | A change to how anything *looks*, across 96 catalog subjects and 15 real screens at both widths. **Known gap:** the e-doc field editor and the sandbox wizard are not among the 15, so changes confined to them are guarded by `check:visual-contract` measurements rather than by a photograph |
| `npm run test:e2e -- --grep "@a11y"` | **yes**, since 2026-08-25 | Real-browser axe on the mobile-critical journeys, plus keyboard behaviour: roving `tabIndex`, arrow/Home/End, and that every control a Tab press reaches shows the product's focus ring |

Two of those became blocking on 2026-08-25, and the pixel lane is the one worth
knowing about: it had **never once been green in CI**, failing all 20
application-screen baselines on every run while `continue-on-error: true`
swallowed it. The cause was not the baselines — it was that the product's
typeface was fetched from `rsms.me` at runtime and does not arrive on GitHub's
runners. Inter is now served from `src/design-system/fonts/` (SIL OFL 1.1), which
also means the application no longer renders in a fallback font for anyone whose
network cannot reach that host, and no user's IP is disclosed to a third party to
render text.

`check:ui-contract` is zero-tolerance against
`src/design-system/ui-contract.allowlist.json`, which records every violation
the product deliberately keeps **and why**. An entry without a reason fails.

Note that Tailwind's radius and shadow scales share their names with the
`--ds-*` ones and sit one step off them — `rounded-lg` is 8px where
`rounded-ds-lg` is 12px. Convert by value, never by name.

**One thing no guard catches**, recorded here because it accumulated twenty-five
call sites: a *hand-composed pattern*. A status screen built from `Card` +
`StatusMedallion` + heading + body + actions, or a `Modal` with its own
Cancel/Confirm footer, is made entirely of approved primitives — so it passes
every rule above while being a second implementation of `patterns/page-state` or
`ConfirmDialog`. Use the pattern; roadmap §7 records the review step that finds
these.

**And a second thing, in `index.html`.** The scan reaches that file but runs only
the class-list rules there, so nothing in it is held by a rule alone. Two values
are therefore pinned by tests instead: the page ground (`<body class="bg-ds-canvas">`,
`src/tests/pageShell.test.js`) — because `raw-palette-class` refuses raw palette
names and a swap to a *different* `--ds-*` role passes, while the pixel lane
cannot resolve the colour at all — and the `theme-color` meta, a literal copy of
`--ds-color-brand-deep` that paints the phone's browser chrome
(`src/tests/brandAssets.test.jsx`). Both were measured, not assumed; roadmap §7,
"The one class no guard could hold".

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

- **Facebook lead capture wrote to a tenant that does not exist (fixed
  2026-08-25).** `connectFacebookPage` stored the caller's user id where a
  company id belongs, so leads from a connected page were written to
  `companies/{uid}/leads` — a tree no screen reads. They were not sent to the
  wrong company; they went nowhere. The callable now takes the company from the
  client and authorizes it against the caller's per-company role. The feature
  remains switched off. Run `scripts/audit-facebook-lead-tenancy.mjs` (read-only)
  to see whether any leads were stranded while the fault was live. A page that
  the old code bound to a uid is reclaimed automatically when its owning admin
  reconnects it; a page held by a real company is refused, so one company can no
  longer take over another's lead feed by reconnecting it. That claim is a
  Firestore transaction taken *before* the Facebook OAuth exchange, so two
  companies connecting the same page at the same moment cannot both pass the
  check; a connect that then fails releases the claim rather than locking the
  page away from its owner.
- **Two orphaned fields on `users/{uid}`: `onboardingTourCompleted` and
  `tourCompletedAt`.** The welcome tour was removed on 2026-08-25 and nothing
  writes or reads them any more. Existing values are left in place deliberately —
  stripping fields from live user records is a data migration, not a UI removal —
  so expect to see them on older accounts and ignore them. Nothing in
  `firestore.rules` or Cloud Functions ever referenced them.
- **"Read the documents" only reads what the current browser holds.** An upload
  leaves `{name, url, storagePath}` in the form data and sends the bytes to
  Storage, so a prepared application re-opened in a later session has its
  documents on the application but nothing for the reader to read. The panel says
  which ones and offers to read the rest; attaching a document again makes it
  readable. Deliberately not solved by fetching the signed URL back into a Blob:
  that is a cross-origin `fetch` against the Storage bucket, and whether it works
  depends on bucket CORS configuration this repository does not set.
- **A continuation link's identity check cannot verify a Social Security Number
  against a draft that has no identity HMAC on file.** Largely closed on
  2026-09-09 and worth stating precisely, because the previous wording of this
  limitation ("no cross-device recovery when the company hides the SSN question")
  described a much larger hole that turned out to be a defect rather than a
  design limit: the HMAC was being *erased* by ordinary autosave (§5), and the
  challenge the link handed off to had no screen at all.
  What remains: a draft with no `identityKey` — one the erasure caught before the
  fix, or one whose company set `ssn` to Optional or Hidden
  (`GATE_DEFAULT_REQUIRED.ssn` is `true`, so this is opt-out) — is verified
  against the last name and date of birth its own answers hold, and the SSN it
  also demands is required but **not checked**. That moves the bar from "knows
  what it typed" to "knows the driver's Social Security Number", which a carrier
  that has anyway can use to impersonate the driver everywhere else in this
  product; it is not the same as verifying it. One success establishes the HMAC,
  so a draft is in that tier at most once.
  A draft holding **neither** a last name nor a date of birth cannot be verified
  at all and is refused outright (`unverifiable`), with the driver told plainly and
  offered a new application rather than being handed somebody's answers. That is
  narrow — a last name is required to leave page one — and it is the honest answer
  when the identity information never existed.
  Their own browser's resume token still works throughout, and asks nothing.
  The fix that closes the residue properly is out-of-band delivery — minting
  emails or texts the link to the `contactEmail`/`contactPhone` on the draft and
  returns only a redacted confirmation, so the carrier never holds it — which is
  DocuSign's Resend model and depends on per-company email configuration this
  change did not take on.
- **A driver cannot dispute a locked employer that is satisfiable but wrong.** A
  PSP report is an FCRA consumer report and the driver has dispute rights over its
  contents, but the application holds them to whichever carriers the report named:
  the identity of a locked row is a record rather than a field for them, by design
  (§5). Every *unsatisfiable* lock state is gone as of 2026-09-08 — a lock always
  names a row that is on the application — so nobody is blocked by a requirement
  they cannot meet. What is missing is the route to say "that carrier is not mine",
  which is its own feature with its own policy questions about what the carrier
  then sees.
- **HEIC photos cannot be read.** The reader accepts PDF, JPG, PNG and WebP;
  browsers cannot decode HEIC (an iPhone's default), so such a photo is refused
  with a message naming the accepted formats. (This is the surviving edge after
  the fix that made ordinary photos readable at all — the pipeline's image reader
  had no production default, so every photo failed while PDFs worked.) Convert or
  re-take as JPG, or upload a PDF.
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
  no admin interface for that either. The removed marketing site sold this as
  "opt-out handling"; the claims gate is a phrase list and cannot see a claim that
  is merely too generous, which is why that page was pinned by a test while it
  existed.
  **The corrected copy is on `main` and the Testing target, and not yet on
  `safehaul.io`** — verified 2026-08-13, the live production page is still the
  pre-correction build and still carries the bullet. Production never deploys
  automatically (§10), so publishing the correction needs an explicit promotion
  through Super Admin → Releases.
- **Frontend coverage thresholds are a ratchet** (statements 70 %, lines 72 %,
  branches 66 %, functions 72 % since 2026-09-06) — set a few points under the
  measured coverage (73 / 75 / 69 / 75) to block a real drop, not to describe
  good coverage. The June 2026 values (16 / 16 / 13 / 13) sat untouched while
  coverage quadrupled, which made the gate decorative. Raise them as coverage
  genuinely improves; never lower them to make a build pass.
- **Mixed Functions v1/v2** — intentional, not a defect. It has two real
  consequences worth knowing before touching either: the two generations default
  to *different* runtime service accounts, so (a) a credential can be readable by
  one AI entry point and not another (§7), and (b) binding a secret from a
  generation that has never bound it fails the **entire** functions deploy until
  someone grants that account access. `secretBindingGenerations.test.js` guards
  the second; see
  [`docs/environment-and-integrations-runbook.md`](./environment-and-integrations-runbook.md).
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
- **A deleted blog article does not free its slot.** `slotIsFilled` tests only
  whether the document exists and a tombstone exists, so that `{date, theme}` slot
  stays filled and no replacement is written. The ledger now records a row saying
  so, rather than leaving it to be discovered. Reopening a slot safely means
  changing the `create()`-based anti-double-publish guarantee, which needs its own
  justification and tests; see [`docs/news-and-insights.md`](./news-and-insights.md).
- **The blog's enforced word floor is 150 words**, far below the 700–1,200
  originally specified. A recorded owner decision taken three times against
  free-tier provider limits, not drift. Raising a provider tier reverses it.
- **`themesAreDistinct` is not wired into the blog pipeline.** It is exported and
  tested and nothing calls it; same-day distinctness comes from the one-document-per
  `{date, theme}` rule and the 60-day duplicate window. The docs used to describe
  it as enforced.
- **The AI live-credential checks cannot run in CI.** The credential-access
  diagnostic, the per-capability connection tests, model-pin verification and a
  manual publication check all need real credentials in a deployed environment.
  Nothing in the repository can substitute for them, and a green test run is not
  evidence that any of them passed.
- **20 known dependency advisories remain, all behind a major version.** The
  2026-09-06 audit counted 53 in the root tree and 22 under `functions/`, none
  watched. Every fix inside the declared ranges was applied that day (root
  53 → 10 moderate, functions 22 → 12 moderate, then 12 → 10 on 2026-09-08 with the `uuid` 14,
  `@google-cloud/secret-manager` 7 and `@google-cloud/tasks` 7 majors). What is
  left in the root tree needs `exceljs`. What is left under `functions/` needs
  `firebase-admin` 14, which **cannot install yet**: `firebase-functions-test`
  has no release whose peer range accepts it (its newest, 3.5.0, stops at
  `^13`; `firebase-functions` 7.3.2 already accepts `^14`), so that bump waits
  on the upstream release rather than on work here. `.github/dependabot.yml` now raises weekly
  grouped update pull requests for the root, `functions/` and the GitHub
  Actions, majors on their own, with a **seven-day cooldown** so a package
  compromised and pulled within days never reaches this tree — the standard
  answer to the 2025 npm supply-chain worms. Advisory-driven security fixes are
  not delayed by the cooldown.
- **Several one-time backfill callables are still exported** (`backfillUserCompanyIds`,
  `backfillDriverCompanyIds`, `backfillPublicProfiles`, `migrateEmailSettings`,
  `backfillApplicationSearchFields`, stats and SMS-phone backfills). They are
  super-admin-only maintenance tools, not dead code — check before removing one.

---

## 13. Testing and operational expectations

**Commands:** `npm run lint` (frontend + backend + public-site claims) ·
`npm test` (Vitest) · `npm run test:coverage` (ratchet gate) ·
`npm run test:e2e` (Playwright) · `npm run test:rules` ·
`npm run typecheck` · `npm run storybook` / `npm run test:stories`.
CI also runs `check:callable-contract`, `check:ai-boundary`, `check:ci-plan`,
`check:release-scripts`, `check:deploy-script`, `check:function-exports`,
`check:ui-contract`, `check:table-layout`, `check:visual-contract`,
`test:stories`, `test:visual`, `test:secret-scan`, and a secret scan
(`scripts/secret-scan.mjs`, a pinned Gitleaks CLI). Every one of those is
blocking; `typecheck` is the only lane that is not (see below).

The secret scan compares **what the change introduced** — the commit range for
this event, plus the resulting source tree — and never the whole repository
history. A pull request compares against its merge base. Everything else — a
push to `main`, a manual run, a scheduled run — compares against the newest
ancestor carrying a **fully validated release**: one run in which both
`secret-scan` and `Verify the release is fully validated` succeeded. The second
is what proves the scanner's own tests passed with it, so a commit that broke the
scanner cannot become the thing later releases trust. The increment behind a
failed release is therefore re-scanned rather than stepped over. Every base is
resolved to its full SHA and must exist, be an ancestor of the head and not be
the head itself; the `SECRET_SCAN_BASE` dispatch input must additionally carry a
validated release of its own, so it names a known-good release rather than
inventing one. A base that cannot be determined **fails the job**, and there is
no fallback that widens the scan or empties it. Exemptions are pinned rather
than trusted: `.gitleaks.toml` may declare only the reviewed tables, keys and
values, `gitleaks:allow` comments are switched off, and a `.gitleaksignore`
fails the job instead of silencing it. The invariant that buys: because
a deploy requires this job, nothing reaches Testing unless every commit since the
last fully validated release was scanned by a scanner that passed its own tests. The full-history sweep is a separate, non-blocking workflow
(`secret-history-audit`), because the history's known legacy findings were
failing unrelated releases; see `docs/SECRET_HISTORY_AUDIT.md`, which also lists
the credentials that still need owner rotation.

CI also enforces a **source-size standard**: 400 physical lines asks a file to
justify its shape, 500 is the hard maximum, and it applies to tests and tooling
as much as to runtime code. It measures every handwritten source language —
JS/TS, CSS, HTML and Firestore rules — not only the scripts.
`npm run check:source-size` prints the inventory and fails on a new offender.
The retirement campaign **completed on 2026-09-01**: the backlog
(`.github/source-size-backlog.json`) drained from 70 files to zero and was then
deleted, as its own instructions required. 500 is the hard maximum for every
handwritten file, with one owner-approved exception: `src/firestore.rules` is
measured on every run against a 689-line ceiling that may never grow and may
only move down (see `AGENTS.md`). No unaccounted file exceeds the maximum.
`docs/source-size-refactor/PLAN.md` and
`docs/source-size-refactor/TRACKER.md` remain as the campaign's record. The commit it compares
against is a pull request's own base, or the newest ancestor GitHub says carried
a fully validated release — never the branch's own history, and never a
manually-named commit that does not contain either. Where there is no earlier
backlog at all, each entry must name a file the base already carried at that
size, so a bootstrap cannot exempt debt it created. Workflows, JSON, Markdown and
the one MDX story are deliberately unmeasured, with reasons recorded in the
checker, and a test refuses any tracked format anywhere in the repository that is
in none of its lists. See `AGENTS.md`.

CI runs Playwright as a 4-way shard matrix with `workers: 1` and `retries: 2`
per shard.

**The first download has a budget.** Measured on 2026-09-06 against the
production build: the public application on a phone downloaded **517 kB (gzip)**
before a line of it ran — a 1.18 MB entry script, a 399 kB pdf.js chunk
preloaded on a page that renders no PDF, and Sentry's Session Replay recorder
inside the entry. Moving the pdf.js worker wiring out of the entry
(`src/lib/pdf/pdfWorker.js`, imported by the PDF features, which are already
lazy chunks) and attaching Replay after load (`src/lib/monitoring/sentry.js`,
Sentry's own bundler guidance) took it to **363 kB**, with no route or screen
changed. `npm run check:bundle-budget` sums the entry script, its module
preloads and its stylesheets from `dist/index.html` and fails the
`frontend-build` job above **380 kB gzip**, refuses any preload of the pdf.js
chunk, and refuses a Replay recorder in the entry; `npm run test:bundle-budget`
drives each refusal on throwaway builds in `callable-contract`, and
`check:ci-plan` (K1c) pins both steps. The ceiling may only move down with a
new measurement. Figures are gzip; Hosting also serves brotli, which is smaller.

`npm run typecheck` is a **non-blocking** baseline (`continue-on-error` in the
workflow) and currently reports pre-existing errors in
`src/config/applicationDefinition.js`. A red typecheck is not a broken build;
do not assume a pre-existing one is yours.

**The public site has two gates, both in CI since 2026-09-01**:
`npm run check:public-claims`, a step of the always-required `callable-contract`
job (so it runs on every push and pull request whichever lanes are selected, and
it refuses a run that finds no HTML in `web/` rather than passing vacantly), and
`src/tests/hostingConfig.test.js` in the `frontend_unit` lane, which a `web/`
change selects. Before that date the claims check was in `npm run lint` only and
CI ran `lint:frontend`, so no job executed it; `K4` in `npm run check:ci-plan`
now pins the step. The hand-run accessibility
audit and the screenshot capture went with the marketing site they served.

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
| Public-site visual specification | [`DESIGN.md`](../DESIGN.md) |
| Manual signing-room device QA | [`docs/qa/edoc-mobile-document-first-qa.md`](./qa/edoc-mobile-document-first-qa.md) |

**Note on `README.md`:** it is the getting-started guide and documentation map —
setup, environment variables, commands, deployment. It defers to this brief for
what the application is and how it behaves. Where the two ever disagree, this
brief and the code win.

---

*Keep this brief true. See the permanent rule at the top.*
