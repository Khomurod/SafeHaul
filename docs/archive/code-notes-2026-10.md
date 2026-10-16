# Archive: dated notes moved out of code comments (2026-10)

> **History, not instructions.** These are the dated defect, migration and review
> notes that lived in code comments, copied here verbatim and grouped by file,
> with only the comment markers removed. The code now states each rule in a line
> or two. Read this only to learn *why* a rule exists: the defects, measurements
> and review rounds behind it. Do not follow it as current guidance where the
> code differs. A production identifier in a note — a person's name, a
> record id — is replaced with a placeholder in square brackets.

---

## `src/features/driver-app/components/application/ApplyIdentityCheckScreen.jsx`

```text
## What happened without it

`exchangeApplicationInvite` answers `requiresIdentity` once the answers behind a
link are the driver's own rather than the carrier's. That reply reached
`resolveApplyStatusScreen`, matched no branch, and fell through to the intake
chooser — so a driver who opened the replacement link their recruiter had just
sent was shown **"How would you like to start your driver application?"**, with
their own half-finished application sitting behind the link and nothing on
screen saying so. Measured in production on 2026-09-09: the exchange returned
200 twice, and the page offered a fresh application both times.

The code comment that stood in for this screen said the driver "is asked for
their details by the ordinary resume flow underneath". They were not. That flow
only triggers on the first Next of page one, so reaching it meant choosing an
intake mode, retyping four fields into what looks like a brand-new application,
and trusting that something would recognise them — and the lookup it runs
queries a field autosave had been erasing.
```

## `src/features/driver-app/components/application/PublicApplyHandler.jsx`

```text
The submission path lives in publicApplySubmit.js since the 2026-09-01
source-size split (PA-1a); the bootstrap — session restore and the company
load — in publicApplyBootstrap.js since PA-1b. The two draft-sync effects
moved on to publicApplyDraftSync.js on 2026-09-08, when the reconciliation
grew the question of whose application this browser is holding.
```

```text
And the PA-1c split: the circular discard/resume pair, the draft
lifecycle, and the post-submission documents flow.
```

```text
The cross-tab discard machinery — this tab's identity refs, the two
discard callbacks, the guards ref, the storage-event subscription — and
the server resume flow live together in useDiscardAwareResume since the
2026-09-01 source-size split (PA-1c); the pair is circular, which is why
one hook owns both. See its header.
```

```text
The draft lifecycle — the per-step local write, Continue's restore-and-mark-synced
path, the post-submission close, Start Over and Save-as-Draft — lives in
useDraftLifecycle since the 2026-09-01 source-size split (PA-1c).
```

```text
The submission path — pre-flight validation, the queue-first guaranteed
delivery, the three-attempt Cloud Function call and every discard
re-check — lives in publicApplySubmit.js since the 2026-09-01
source-size split (PA-1a). One expression, so the caller awaits the
module's own promise; this tab's refs are passed as the objects
themselves so their capture-then-re-read semantics are unchanged.
```

```text
The post-submission Required Documents flow lives in
usePostSubmitDocuments since the 2026-09-01 source-size split (PA-1c).
```

```text
The chain moved into `PublicApplyScreens.jsx` on 2026-09-08: that module
already owns all six screens, so which one a given state calls for is the
same subject — and the ORDER is load-bearing rather than incidental, which
makes it worth having in one place with the screens it orders. See the
function's own comment for what each position is protecting.
```

## `src/features/driver-app/components/application/PublicApplyScreens.jsx`

```text
DEFECTS FIXED (2026-07-27): none of these screens was a `<main>` landmark,
none had an `<h1>` (they opened at `<h2>`, so an applicant landing on one
heard an unlabelled page), the loading and queued states were not announced,
and the "Go to home" / "Start a new application" controls were bare
`<button>`s styled as text links with no affordance beyond hover.
```

```text
 5. **The identity check in the same position, for the same reason.** A link
    whose application the driver has already started resolves to
    `requires_identity`, and until 2026-09-09 that outcome matched no branch at
    all — so the chooser rendered, and a driver sent a replacement link was
    offered a brand-new application with no mention of the one they had spent
    an hour on. It sits below the success screen because a confirmed
    submission outranks a request to confirm anything, and above the chooser
    because that fall-through IS the defect.
```

```text
**2026-08-25: all five screens are the approved page-state pattern.** They were
hand-composed `Card` + `StatusMedallion` + heading + body + actions, which is
what `PageState` is — it was built later and never applied back here. Measured
across these five and the four in the signing room, one kind of screen had two
title sizes, two medallion sizes, icons at 28/32/40/48px and three different
gaps under the medallion. The pattern owns the shape now; this feature keeps
the words, the tone, the icon, the actions and the domain logic (the
confirmation-number fallback, the checklist gate, the pending-required switch).
```

```text
Moved out of `PublicApplyHandler` on 2026-09-08. This module already owns every
screen below, and the ORDER is load-bearing rather than incidental, so it
belongs with them: each position is protecting something, and three of the four
reasons were learned from a real defect.
```

## `src/features/driver-app/components/application/RequiredDocumentsChecklist.jsx`

```text
DEFECTS FIXED (2026-07-27):
- Status pills used `text-[10px]` and the progress line `text-[11px]`, both
  below the 12 px interface-text floor the design standard sets.
- Progress changes were silent; `role="status"` now announces "1 of 2
  completed" as documents are signed.
- The row action was a full-width `<button>` wrapping the status pill, so its
  accessible name was "<title> Not started" and the retry control sat *inside*
  another control's hit area. The action is now a named `Button` beside the
  status, never nested.
```

## `src/features/driver-app/components/application/UploadField.jsx`

```text
DEFECT FIXED (2026-07-28): the removal prompt was a bare `confirm(...)`. The
*rule* (removal is always confirmed) is preserved; the blocking browser dialog
is replaced by the approved accessible `ConfirmDialog`.
```

```text
DEFECTS FIXED (2026-07-27):
- The empty state was a `<div onClick>`: unreachable by keyboard, no role, no
  accessible name. It is now an approved `Button` that names the field.
- Progress, success and failure were silent. They are now announced through
  `role="status"` / `role="alert"` live regions.
- The hidden input used `display:none`, so a `required` empty input made
  `form.reportValidity()` fail with no focusable control and therefore no
  visible message. It is now visually hidden but focusable, and kept out of
  the tab order with `tabIndex={-1}` so the visible trigger stays the only
  tab stop.
```

```text
Belt and braces since the picker became `FileInput` (2026-08-25): it is
only rendered in the idle/error state, so in the state this runs from
the ref is usually null — and clearing `value` is not needed there
anyway, because dropping `value` to null remounts a fresh input. The
guard stays for the case where it IS live, so re-selecting the same
filename still fires `change`.
```

```text
2026-10-09 — REAL PROGRESS, AND A WAY OUT. The bar was a made-up ramp that
stopped at 90% and waited there for as long as the upload took, with Continue
locked and nothing to press. It now shows what `onProgress` reports, **Cancel
upload** aborts through `signal` and returns the field to its picker, and a
failure shows the upload's own plain sentence (`GuestUploadError`).
```

```text
`FileInput` renders its own rejection alert, but this field removes the
picker the moment a file arrives — so on a mixed drop (one file accepted,
another refused) that alert is unmounted in the commit that created it and
the applicant never learns a file was turned away. Found in review on
2026-08-26. `onReject` fires after `onChange`, so the clear below runs
first and this wins.
```

```text
IDLE / EMPTY STATE — `FileInput variant="dropzone"`.
This was a `Button` styled as a dashed panel driving a hidden input
with `tabIndex={-1}`, under the roadmap's "no approved file-input
contract" exception, which closed on 2026-08-21. The primitive is a
real focusable input behind a real `<label>`, and `FileInput`'s
`onDrop` makes the whole panel a real drop target — which this field
never had.
```

## `src/features/driver-app/components/application/publicApplyBootstrap.js`

```text
How the guest application page boots and stays reconciled, split out of
`PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
(PA-1b). Four React-free functions, bodies verbatim from the component:
the post-apply session restore, the company load (sandbox / E2E /
production, with the local-draft restore and its discard guards), the
server-draft reconciliation (returning the effect's own cleanup), and the
reconnect flush listener (likewise returning its cleanup). The component's
effects keep their exact dependency arrays and pass this tab's refs as the
ref OBJECTS, so capture/re-read semantics are unchanged.
```

## `src/features/driver-app/components/application/publicApplyDraftSync.js`

```text
`Math.max`: never move an applicant *backwards* from where they already
are in this session — and never *forwards* past a Back they pressed while
this was in flight. That press is their answer to "where am I", and the
fetch is a cold-startable round trip: until 2026-10-01 a driver who
confirmed their identity on a continuation link, or reloaded, and went back
a page inside that window was put straight back where they had been.
```

```text
The two draft-sync effects the guest apply page installs once its company is
known: reconciling the server copy on load, and flushing a dirty local copy
when the connection returns. Split out of `publicApplyBootstrap.js` on
2026-09-08 for the source-size standard — the company load and the draft sync
are different subjects, and the reconciliation grew when it learned to ask
whose application this browser is holding.

Both return their effect's own cleanup, and both take this tab's refs as the
ref OBJECTS, so capture/re-read semantics are unchanged from when the bodies
were inline in the component.
```

```text
Asked of any outcome that NAMED an applicant, which since 2026-09-09 means
`requires_identity` too. It used to read `=== OPENED`, and that was only
safe while the other outcome carried no answers to contaminate: a
confirmation screen renders over the wizard, and the previous applicant's
leftovers would have been merged and written back underneath it while the
driver was still typing their date of birth.
```

## `src/features/driver-app/components/application/publicApplyHelpers.js`

```text
Built on the same vocabulary as `buildPostApplyDocErrorMessage` above, because
it is the same job on a neighbouring surface — the machinery existed and the
invite path simply was not using it. Until 2026-09-08 every failure resolved to
`null` and the driver was dropped into the ordinary application with nothing
said, so a rate-limited exchange, a Firestore hiccup (the limiter fails closed)
and a temporary outage were indistinguishable from having followed no link at
all.
```

## `src/features/driver-app/components/application/publicApplyInvite.js`

```text
`PublicApplyHandler` gates the reconcile effect until the outcome here is no
longer `pending`, which fixes the ORDERING. `foreignSlot` below fixes the
IDENTITY. Gating alone would not be enough, because after a successful exchange
the reconcile still has to run: the driver's own newer unsynced local work must
still be able to win. (Until 2026-09-09 it was also the ONLY thing that restored
an invited driver's page, because the exchange returned no `lastStep`. It does
now — a driver who confirms their identity to continue must land on the page they
were on, not back at the start — so the reconcile's `Math.max` is what keeps the
two from arguing.)
```

```text
Split out of `publicApplyBootstrap.js` on 2026-09-08 — for the source-size
standard, and because it is one job with one question at the end of it: whose
application is this browser holding?
```

## `src/features/driver-app/components/application/publicApplyPreflight.js`

```text
Split out of `publicApplySubmit.js` on 2026-09-02 when the company's
Application Rules joined the checks. The server refuses every one of these
independently (`assertRequiredUnpersistedFields`, `assertRequiredUploads`,
`assertApplicationRules`); this half exists to tell the applicant which
answer and take them to it, not to be the enforcement.
```

```text
Validate email and phone — and go to the page that holds them. Both used to be
refused here with a toast and no routing, which left the applicant on the
signature page with no idea where the field was (found 2026-10-01).
```

## `src/features/driver-app/components/application/publicApplySubmit.js`

```text
The guest application's submission path, split out of
`PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
(PA-1a). One React-free function, body verbatim from the component: the
pre-flight (now `publicApplyPreflight.js` — unpersisted fields, the company's
Application Rules, required uploads, signature, email/phone), the E2E queue
path, the queue-first guaranteed delivery, the
three-attempt Cloud Function submission with backoff, and every discard
re-check in between. This tab's refs are passed as the ref OBJECTS so the
mutation semantics — capture before an await, re-read after it — are
exactly the component's. `submittedDraftIdentity` moved with it because
nothing else reads it.
```

## `src/features/driver-app/components/application/refusalCodes.js`

```text
Until 2026-10-01 every error was retried three times. Because a queue entry
existed, the applicant was then shown "Application Saved … will be automatically
submitted. No data will be lost." For a refusal that was false twice over. The
replay sends the identical payload into the identical refusal, and after ten
attempts it marks the entry failed without telling anyone. The driver believed
they had applied, and the carrier never received the application.
```

## `src/features/driver-app/components/application/steps/DynamicQuestionsStep.jsx`

```text
Presentation migrated to the approved `Card` / `FormField` / `Input` /
`Textarea` / `Select` / `Checkbox` / `Radio` / `ChoiceGroup` / `Badge`
primitives (2026-07-27).
```

```text
DEFECTS FIXED (2026-10-09): a time question needed the phone's own dialog, which
can lack Set; it is three lists (`TimeSelectField`, the same `HH:MM`), checked
with the page before it moves on. A number box stored "1,000" as nothing; it is
text on the number pad now, kept as typed.
```

```text
DEFECT FIXED (2026-10-02): a file question recorded `file?.name` as its answer
the moment a file was chosen, without waiting for the upload and discarding the
storage path it returned. So the company saw a filename that nothing referenced,
and a failed upload still read as answered. The answer is now the uploaded file
itself, recorded only once the upload has landed — see `uploadAnswer`.
```

```text
DEFECTS FIXED (2026-07-27):
- Every control was unlabelled. The question text sat in a `<label>` that
  closed *before* the control was rendered, so no input, textarea, select,
  radio group or scale had an accessible name at all — the whole step was
  unusable with a screen reader. Each control now gets its question as a real
  label (or a `ChoiceGroup` legend for multi-option types).
- "Back" had no `type`, so inside `#driver-form` it defaulted to `submit` and
  triggered native validation instead of navigating back.
- The linear scale's endpoint captions and value numbers were the only cue for
  what each radio meant; each option now carries a real label naming its value
  and, at the ends, the endpoint wording.
```

## `src/features/driver-app/components/application/steps/Step1_Contact.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Select` /
`Checkbox` primitives and the shared field adapters (2026-07-27).
```

```text
2026-09-02: the date-of-birth age check is also shown inline the moment the
date changes (it used to surface only as a toast on Continue), and the
company's `requirePreviousAddressUnderThreeYears` rule asks for a previous
address as soon as the applicant answers No to the three-year question. The
previous-address editor moved to `PreviousAddressesSection` unchanged.
```

```text
2026-10-06: the applicant's own name, contact, date-of-birth and current-address
fields carry autofill tokens, so a phone can fill them from the saved contact
card, and SSN and ZIP open the number pad. The SSN stays a masked field with
autofill off. `applicationAutofill.test.jsx` pins which fields may be filled.
The date of birth is typed on the number pad (`TypedDateField`) instead of
picked from three lists; it is stored as the same `YYYY-MM-DD`.
```

```text
3. Phone — the rule the final pre-flight applies (`isValidPhone`), and the
one the inline check below the field already used. This gate accepted any
ten digits or more, so "+52 55 1234 5678" moved on from this page and was
refused only at Submit, nine pages later, by a toast that did not say
where the field was (found 2026-10-01).
```

## `src/features/driver-app/components/application/steps/Step2_Qualifications.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
primitives and the shared `RadioGroup` adapter (2026-07-27). Field keys,
`YES_NO_OPTIONS` / `EXPERIENCE_OPTIONS`, the conditional drug-test
explanation, the DOT question wording (except as noted below), and the VAL-1
`form.checkValidity()` gate are unchanged.
```

```text
2026-10-06: the drug and alcohol question is now the one 49 CFR 40.25(j)
requires, in its own terms: pre-employment tests in the past two years. It
asked "ever", and about any DOT test, which is wider than the rule. The answer
has its own key, `pre-employment-test-positive`: the backend is shared with
the Production frontend, which asks the broader question (`drug-test-positive`)
until it is promoted, and each is recorded under its own label. Answering the
new question clears a draft's earlier answer to the broader one, which no page
shows any more.
```

## `src/features/driver-app/components/application/steps/Step3_License.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Select` /
`Checkbox` / `ChoiceGroup` primitives (2026-07-27).
```

```text
DEFECT FIXED (2026-07-27): the missing-upload message was a plain `<div>` — not
announced, and not focused. An applicant who pressed Continue with a document
missing got no feedback at all from a screen reader, and on a long step the
message could be off-screen. It is now a `role="alert"` region that receives
focus, so the reason Continue did nothing is always reachable.
```

```text
2026-09-02 — company rules. An expiration date in the past is judged the
moment the date changes (`expiredCdl` / `expiredMedicalCard`: allow, warn or
block), the other-state licence list can be required to hold one complete
record (`requirePreviousLicenseDetails`), and the signed-form upload is
labelled as what it is — a paper form — so it is not mistaken for the MVR
authorization question on the next step.
```

## `src/features/driver-app/components/application/steps/Step4_Violations.jsx`

```text
2026-09-02 — ONE MVR authorization. The step used to ask "I Consent to MVR
Check" under two sentences of prose that recorded nothing, while a separate
"MVR Consent Form" upload lived on the licence step and the FCRA disclosure
mentioned driving records again. The Yes/No question now sits under the
versioned `mvrAuthorization` agreement from the server registry, and a Yes is
recorded exactly like the consent-step agreements (`agreementAcceptances`,
with the version shown). Whether a No stops the application is the company's
`mvrAuthorization` rule; the explanation is the rule engine's own wording, the
same the server gives.
```

## `src/features/driver-app/components/application/steps/Step5_Accidents.jsx`

```text
2026-09-02 — a proper accident module. A clear Yes/No question
(`has-accidents`) precedes the list, and each row carries the details
49 CFR 391.21(b)(7) actually asks for: fatalities, injuries and whether
hazardous materials were spilled (`fatalities` / `injuries` / `hazmatSpill`,
appended after the original keys so stored rows keep their order). They are
optional unless the company's `requireAccidentDetails` rule is on, in which
case every row must be complete before the applicant continues — and the
server refuses the same submission with the same wording.
```

## `src/features/driver-app/components/application/steps/Step6_Employment.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
primitives (2026-07-27).
```

```text
DEFECT FIXED (2026-07-27): the per-row radio groups (`mayContact`, `branch`,
`heavyEq`, `honorable`) used the bare field name, so every row emitted the same
element ids and shared one browser radio group — clicking row 2's option
toggled row 1's input through the duplicated `label[for]`. Each row now scopes
its ids and grouping name by index while `name` (the saved key) is unchanged.
```

```text
2026-09-02 — the company decides what incomplete coverage means
(`employmentHistoryEnforcement`: allow / warn / block) and how many years must
be accounted for (`employmentHistoryMinimumYears`). `warn` is the behaviour
this step always had: one interruption, then "Continue anyway". `block` shows
the same panel without that escape until the months are accounted for, and the
server refuses the same submission. `allow` never interrupts. The schooling,
gap and military row renderers moved to `EmploymentHistoryRows.jsx` unchanged.
```

```text
2026-10-06 — the page asks what 49 CFR 391.21(b)(10)-(11) asks: every
employer of the past three years and, for a CDL job, the employers of the
seven years before that the applicant drove a CMV for. It asked for every
employer of ten. Each employer of the three years answers the two
(b)(10)(iv) questions (`EmployerDotQuestions`), and the reason for leaving is
required with the rest of the row. Employment dates are a month and a year
(`YYYY-MM`), as on FMCSA's own application form; rows saved with a full
`YYYY-MM-DD` keep it until changed, and every reader accepts both.
```

```text
2026-10-07 — Continue lists what the page still needs, row by row, each line
taking the applicant to the field, and marks the fields (`employmentStepIssues.js`),
in place of the browser's bubble on one field and the email and contact toasts.
```

## `src/features/driver-app/components/application/steps/Step7_General.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
primitives (2026-07-27).
```

```text
Company rules applied here (2026-09-02): the vehicle categories and their
wording (`vehicleExperienceHidden` / `vehicleExperienceLabels`), whether a
felony explanation is mandatory (`requireFelonyExplanation`), and the optional
Hours of Service statement (`hoursOfServiceStatement: 'application'`), which
renders here rather than as a tenth step so no company's application grows a
mandatory page it did not ask for.
```

## `src/features/driver-app/components/application/steps/Step9_Consent.jsx`

```text
2026-10-06 — ONE DOCUMENT PER PAGE. The agreements used to share one page with
each other and with the certification's release paragraph. The FCRA disclosure
must be a document consisting solely of itself, and the PSP form's own notice
says its language must stand alone and "may NOT be included with other consent
forms or any other language". So each agreement now has its own page (see
`AgreementDocumentPage`), and the certification and signature come last. An
acceptance counts only at the version on screen, so a draft that accepted
wording since replaced is asked again. The certification ends with the exact
49 CFR 391.21(b)(12) sentence, which the rule requires "at the end of the
application form".
```

```text
2026-10-09 — THE SIGNATURE SAVES ITSELF. It was kept only when the driver
pressed Save Signature, and Submit stayed grey with no reason given to a driver
who drew and went on. Each stroke now saves as it ends, the pad stays open for
the next stroke, Clear is always there, and a signature already given is drawn
back when the page is shown again (it said "Saved" over an empty pad). Under
Submit, a line names whatever is still missing: an agreement, the signature, the
certification, or an upload still on its way. A resumed draft never holds the
signature, so it is asked again there.
```

## `src/features/driver-app/components/application/steps/components/BusinessInfoSection.jsx`

```text
Owner-operator business details. Presentation migrated to the approved
`FormSection` primitive and the shared field adapters (2026-07-27); every
field key (`ein`, `driverInitials`, `businessName`, `businessStreet`,
`businessCity`, `businessState`, `businessZip`), element id and required flag
is unchanged — `business-state` stays optional.
```

## `src/features/driver-app/components/application/steps/components/CustomFileQuestion.jsx`

```text
`FileInput variant="dropzone"`. This was a hand-built version of the same thing
under a comment saying the design system had no file-input contract, which
stopped being true on 2026-08-21 — and it had a real defect the primitive
cannot have: TWO `<label for>` elements pointed at the one input, so its
accessible name was the question text AND the drop-zone copy concatenated.
`FileInput` renders one label.
```

## `src/features/driver-app/components/application/steps/components/EmergencyContactsSection.jsx`

```text
Two emergency contacts. Presentation migrated to the approved `FormSection`
primitive and the shared field adapter (2026-07-27); the `ec1*` / `ec2*` field
keys and element ids are unchanged.
```

## `src/features/driver-app/components/application/steps/components/EmploymentHistoryRows.jsx`

```text
Moved out of `Step6_Employment.jsx` verbatim on 2026-09-02 so the step could
take on the company's coverage rules without passing the source-size limit.
Every element id (`school-name-<n>`, `unemp-start-<n>`, `mil-branch-<n>`, …),
every saved key and every required flag is exactly what the step rendered.
The per-row radio groups scope their ids and grouping name by index while
`name` (the saved key) stays bare.
```

```text
2026-10-06: school dates are a month and a year (`YYYY-MM`), like the gap and
military dates beside them.
```

## `src/features/driver-app/components/application/steps/components/HoursOfServiceSection.jsx`

```text
2026-10-09 — nothing here opens a phone's own picker. The time was an
`<input type="time">`, which on a phone can be set only through the phone's
dialog; a driver whose dialog showed Clear and Cancel without Set could not
finish. It is three lists now (`TimeSelectField`), storing the same `HH:MM`.
The hours were a number box stepping by half hours, so a log's 7.25 was
refused and a decimal comma read as nothing; they are typed text now, a comma
read as a point and ".5" as 0.5, held to the rule's own "0 to 24, two
decimals" by `HOURS_PATTERN`.
```

## `src/features/driver-app/components/application/steps/components/StateSelectField.jsx`

```text
A stored value that is not in the list is shown AS ITSELF. Without that option
the browser shows the first one it can, so a "TX" from a CDL auto-fill or a
carrier's typing rendered as "Alabama" while the form still held "TX", and the
required check passed because the field was not empty (found 2026-10-01). The
writers now normalise to listed names (`toUsStateName`); this is what keeps a
value they could not normalise, or one saved before they did, honest on screen.
```

## `src/features/driver-app/components/application/steps/components/VehicleExperienceSection.jsx`

```text
DEFECT FIXED (2026-09-02): the selects fell back to `'0'` and `'<6 months'`,
neither of which is in its option list, so the control silently displayed the
FIRST option ("Student / Recent Grad") while nothing was saved. An unanswered
select now shows a placeholder, and a stored value the current options do not
contain is rendered as its own option so it stays visible and unchanged.
```

## `src/features/driver-app/components/application/useDiscardAwareResume.js`

```text
The guest application's cross-tab discard machinery and the server resume
flow, split out of `PublicApplyHandler.jsx` on 2026-09-01 for the
source-size standard (PA-1c). This hook owns the four refs that give a tab
its identity (the discard mark it loaded with, whether the screen came out
of a stored draft, the reset generation, and the draft's own name), the two
discard callbacks with the guards ref the long-lived writers read through,
the storage-event subscription — and the `useApplicationResume` call, which
lives HERE because the pair is circular: the resume hook needs
`discardedElsewhere`, and reacting to a discard needs the resume hook's
`forgetDraftOwnership`. Bodies verbatim.
```

## `src/features/driver-app/components/application/useDraftLifecycle.js`

```text
The guest application's draft lifecycle, split out of
`PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
(PA-1c): the synchronous per-step local write, the restore-and-mark-synced
path behind Continue, the post-submission close, Start Over with its
quota-ordering rules, and the explicit Save-as-Draft. Bodies verbatim; the
refs arrive as the ref objects, so ownership semantics are unchanged.
```

## `src/features/driver-app/components/application/usePostSubmitDocuments.js`

```text
The post-submission Required Documents flow, split out of
`PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
(PA-1c): per-template checklist state persisted to the session snapshot,
the start-new-application reset, and opening a post-application template
through the signing room (E2E and production paths). Bodies verbatim.
```

## `src/features/driver-app/hooks/useInviteIdentityCheck.js`

```text
Dismissed by the same flag as the link-problem screen, because it offers
the same explicit way out: starting a fresh application is a choice the
driver makes and never a fallback that happens to them. Until 2026-09-09
this outcome had no screen at all, and that fall-through to the intake
chooser is the reported bug.
```

## `src/features/driver-app/hooks/useResumeTokenOwnership.js`

```text
Split out of `useApplicationResume.js` on 2026-09-08, both for the source-size
standard and because it is one subject: three questions that were previously
answered by reading shared storage at the moment each answer was needed.
```

## `src/features/driver-app/hooks/useSignedUploadPreview.js`

```text
An upload left `{name, url, storagePath}` in the form data, and that `url` is a
signed read URL with a **fifteen-minute** life (`GUEST_READ_TTL_MS` in
`functions/getSignedGuestUploadUrl.js`). It was persisted into the draft
verbatim and handed to the driver by the invite exchange — so a document a
recruiter attached on Tuesday was a broken image and a Storage error page by
the time the driver opened the link, and the same for a recruiter reopening
their own draft an hour later. Found 2026-09-08.
```

## `src/features/verification/components/PortalStatusScreens.jsx`

```text
`StatusIcon` lived here until 2026-09-06 — a 64px tinted square holding a 36px
glyph, with its own three-tone class map, in a file that already imported from
the design system. It is `StatusMedallion`, hand-built.

Two things brought it out. The 36px is not a step on the icon scale, and an
off-scale size is the signal that a container is missing. And `StatusIcon`
rendered its `icon` prop DIRECTLY — `<Icon className="h-9 w-9" />` — which
throws the moment a glyph name becomes a token, on this public portal, in a
branch no unit test reaches.

The four screens below are also consistent for the first time: the loading one
had a bare spinner where the other three had a disc.
```

## `src/features/verification/components/RadioGroup.jsx`

```text
DEFECT FIX (2026-07-27): this was `text-ds-content-muted`. That is
slate-500, and the roadmap already records `content-muted` as
**approved on `surface` only** — it fails AA on tinted surfaces.
Two of these groups render inside the drug-and-alcohol block, whose
background is `--ds-color-status-warning-bg`, where it measured
4.27:1 in Chromium against the required 4.5:1. Real-browser axe
reported it as a serious `color-contrast` violation.

`content-secondary` is the remedy the token blocker already
prescribes for exactly this pairing, and it is darker on every
surface, so the untinted groups improve too.

UPDATE (2026-08-21): `content-muted` is now slate-600 and clears AA
on every surface, including `status-warning-bg`, so the blocker this
cites is resolved. This stays on `content-secondary` — it is correct
and needs no change; the note is here so a future reader does not go
looking for a constraint that no longer exists.
```

## `src/features/verification/components/sections/RespondentSection.jsx`

```text
Section 4: Respondent Verification & Signature. Field names, placeholders
and the E2E test-signature affordance are unchanged. Since 2026-09-06 the
signature is collected by `SignatureInput` — drawn on the pad or typed as a
name — and `updateSignature` stores the mark together with its method.
```

## `src/features/verification/hooks/useVerificationPortal.js`

```text
`mock` is the pre-existing fixture path and is **bit-for-bit unchanged**. The
others were added on 2026-07-27 so the expired, invalid, already-completed and
generic-failure screens can be reached — and axe-scanned — in a real browser.
They are additive: nothing about `mock`, and nothing about the real callable
path, changes.
```

```text
'drawn' | 'typed' | null — recorded with the response so the PDF and the
audit trail say how the mark was made (audit step J, 2026-09-06).
```

## `src/lib/monitoring/sentry.js`

```text
Sentry wiring, extracted from `main.jsx` on 2026-09-06 (audit step I) so the
two decisions in it can be tested rather than trusted.
```

## `src/lib/pdf/pdfWorker.js`

```text
Until 2026-09-06 this lived in `main.jsx`, which made `react-pdf` — and with
it the 399 kB `pdfjs` chunk (117 kB over the wire) — part of the entry bundle
for EVERY route, including the public application a driver opens on a phone
at a truck stop, where no PDF is ever rendered. Measured against the
production build: the entry preloaded that chunk on `/apply` and `/login`
alike. Moving the wiring here lets it travel with the PDF features (signing
room, envelope creator, application prep), which are already lazy chunks.
```

## `src/shared/components/admin/BulkUploadLayout.jsx`

```text
Migrated to the design system on 2026-07-27. Defects fixed in that pass, each
of which changed presentation only:

 1. The overlay was a bare `fixed inset-0` div: no `role="dialog"`, no
    `aria-modal`, no focus move, no focus trap, no focus restore and no
    Escape. It is now the approved accessible `Modal`.
 2. `ImportLeadsPage` has always passed `isEmbedded`, but nothing consumed it,
    so a full-screen modal rendered on top of the page's own header. The prop
    is now honoured: embedded renders in place, and only the dashboard's
    overlay usage gets a dialog.
 3. The close control was an icon-only `<button>` with no accessible name.
 4. The file input was `display: none`, which removes it from the tab order
    entirely — the upload control was unreachable by keyboard. It is now
    visually hidden but focusable, and the drop zone shows a focus ring.
    Its `id` was also a hard-coded global; it is per-instance now.
 5. The two import-method tiles were toggle buttons whose selected state was
    communicated by colour alone. They are now a real radio group.
 6. The Google Sheet URL field had a placeholder but no label.
 7. The preview table had no accessible name, no `scope`, and its scroll
    region was neither focusable nor labelled. It is now the approved
    `DataTable`.
 8. Upload progress was silent: the string was the disabled button's label,
    never announced, and there was no `progressbar`. It is now a live region
    plus a determinate `ProgressBar` when a countable total is supplied.
```

```text
`FileInput variant="dropzone"`. This was the same structure by
hand — a real input plus a `<label>` — under a comment saying
"there is no approved file-input contract in the design system
yet", which stopped being true on 2026-08-21. The label is
hidden because the radio above it already says "Upload a file";
the accessible name stays.
```

## `src/shared/components/badges/StatusBadge.jsx`

```text
Before 2026-08-21 it was a second badge implementation — its own pill, its own
size scale, and forty raw palette classes across a ten-status colour table.
Beside a real `Badge` on the same screen it was a visibly different shape.
```

## `src/shared/components/badges/index.js`

```text
`FieldConfidenceTag` was removed on 2026-08-21: no consumers anywhere, and it
was a third badge implementation with its own size scale and raw palette
colours. Use `Badge` from `@design-system/components`.
```

## `src/shared/components/feedback/ErrorBoundary.jsx`

```text
Migrated to `ErrorState` on 2026-08-21. Presentation only — the Sentry
capture, the `console.error`, the reload and go-home behaviour, the
development-only error text and the `UI_CRASH_HANDLER` code are unchanged.

What changed, beyond the tokens: the old markup announced nothing. A crash
replaced the page with a `<div>` containing an `<h2>`, so a screen-reader user
whose action had just failed got silence. `ErrorState` is `role="alert"`, so
the failure is announced the moment it appears — which for the screen that
appears *because something broke* is the whole point.

The medallion, heading, body and action row are the pattern's, so this crash
screen is now the same shape as every other error state in the product rather
than a bespoke card with its own shadow, radius and red header band.
```

## `src/shared/components/feedback/FeatureErrorBoundary.jsx`

```text
Migrated to `PageState` on 2026-08-21. The Sentry tags, the retry that clears
the boundary's own state, and the go-home navigation are unchanged.
```

## `src/shared/components/feedback/PaywallMessage.jsx`

```text
Presentation migrated to the approved `Button` and `--ds-*` tokens
(2026-07-27) as part of the PEV initiation/tracking campaign. Consumed by the
PEV tab and the Campaigns dashboard; the sales contact URL, the
`window.open(url, '_blank')` behaviour and both default strings are unchanged.
```

```text
DEFECT FIXED (2026-07-27): the heading was always an `<h3>`, which collides
with the section heading of whichever surface renders it — inside the driver
dossier that put a second `<h3>` at the same level as the dossier's own
section title. The level is now the caller's choice, defaulting to the
previous `h3` so existing consumers are unaffected.
```

## `src/shared/components/feedback/QueueStatusIndicator.jsx`

```text
Migrated to `--ds-*` status roles and `Button` on 2026-08-21. The four states,
their order of precedence, every string, the `processQueueNow` wiring and the
`useSubmissionQueue` contract are unchanged.

Two real defects fixed along the way, both of which mattered most on the
surface this appears on — the public driver application, which is mobile-first
and is where a queued submission is a driver's completed application:

 1. **It announced nothing.** Four states appeared and disappeared in silence.
    Going offline mid-application, or a queue error, is exactly the kind of
    thing a screen-reader user needs told. The region is now a live region:
    polite for the informational states, `alert` for the error.
 2. **The two actions were hand-built buttons** at `px-2 py-1 text-xs` — about
    22px tall, well under any touch-target guidance, on the most mobile-heavy
    screen in the product. They are `Button size="sm"` now, which is 36px.
```

## `src/shared/components/feedback/ToastProvider.jsx`

```text
DEFECT FIXED (2026-07-27): this dismiss control had no accessible
name at all — an icon-only button whose only child was a decorative
`<X>`. The real-browser axe scan of the public driver application
reported it as `button-name [critical]`, once per visible toast (the
guest wizard shows one per upload plus one per submission message).
It also had no explicit `type`, so inside a form it would submit.
The hit area was 16×16 px, failing WCAG 2.2 AA SC 2.5.8.

It is now the approved `IconButton`, which owns the name
requirement, the type, the hit area and the focus ring — so the
locally hand-rolled 28 px box is gone too.
```

```text
Visual migration completed 2026-07-28, closing the roadmap's
"Toast/notification" row. This is presentation only — the public API
(`showSuccess` / `showError` / `showInfo` / `showWarning`), the
`addToast(type, message, duration = 4000)` signature, the id shape, the
`setTimeout` auto-dismiss, the `role="alert"` announcement and the
`Dismiss notification: {message}` control name are all unchanged. No caller
needs to change.

Two accessibility defects on the dismiss control were fixed separately on
2026-07-27 (it had no accessible name — axe `button-name` critical — and a
16×16 px hit area). The palette migration was deliberately deferred then
because this is a global surface; it is done here.

Defects fixed in this pass:
 1. **Nine legacy palette classes** — `border-green-200`, `bg-green-50`,
    `text-green-600` and the red/blue/yellow equivalents — replaced with the
    semantic status tokens. `text-yellow-600` in particular was never an
    approved token and measured below AA on white.
 2. **The dismiss icon was `text-gray-400` on white = 2.56:1.** It is now an
    approved `IconButton`, which also gives it the shared focus ring and hit
    area rather than a locally hand-rolled 28 px box.
 3. **Severity was inaudible.** The icon was `aria-hidden` and the message
    never says what kind of notification it is, so a screen-reader user could
    not distinguish success from failure. Each toast now announces its severity
    before the message.
 4. **Long messages could push the toast off-screen on a phone.** The stack was
    pinned to `right-6` with no max width and no wrapping rule, so an
    unbreakable string (a Firebase error, a long file name) overflowed
    horizontally at 412 px. The stack now insets from both edges below `sm`,
    caps its width against the viewport, and wraps long words.
 5. **An unbounded stack could exceed the viewport height.** The column is now
    capped and clips, so a burst of notifications cannot paint over the whole
    screen or grow the document.
 6. Hard-coded `rounded-lg`, `shadow-lg`, `text-sm` and raw `px-4 py-3` /
    `gap-3` spacing replaced with radius, elevation, type and spacing tokens.
```

## `src/shared/components/form/RadioGroup.jsx`

```text
DEFECT FIXED (2026-07-27): inside `DynamicRow` the same `name` was reused for
every row, so every row emitted the *same* element ids and the same radio
grouping name. `label[for="commercial-yes"]` then resolved to row 1's input,
which meant clicking row 2's "Yes" toggled row 1 — and the browser treated all
rows as one radio group. Callers inside a repeating row now pass a
row-unique `idPrefix` / `groupName`; both default to `name`, so every
single-instance call site keeps its existing ids byte-for-byte.
```

## `src/shared/components/layout/Stepper.jsx`

```text
DEFECTS FIXED (2026-07-27):
- The step title was an `<h2>` on a page with no `<h1>`, and every step then
  rendered its own `<h3>` repeating the same "Step N of 9" text — which was
  also *wrong* whenever custom questions made it 10 steps. The title is now
  the page's single `<h1>` and the duplicated per-step headings are gone.
- Progress was communicated by a bare `<div>`'s width, invisible to assistive
  technology. It is now an approved `ProgressBar` labelled by the step title.
- On every step change focus was silently dropped to `<body>` (the Continue
  button that triggered the change unmounts), so keyboard and screen-reader
  users were never told the step had changed and had to tab from the top of
  the document. Focus now moves to the step heading.
- Two competing scrolls ran per transition (`PublicApplyHandler` did an
  instant `window.scrollTo(0, 0)` and this component a smooth one). The
  smooth animation raced Playwright's scroll-into-view + hit-test on the next
  step's controls. Focusing the heading now performs the scroll once, without
  an animation to race.
```

## `src/shared/components/modals/CallOutcomeModalUI.jsx`

```text
The outcome grid is the design system's `SegmentedControl` (2026-08-25). It was
a `role="group"` of raw `<button aria-pressed>` cards with a local six-tone
class map, recorded as an exception "because the design system has no approved
Segmented/ToggleGroup primitive" — one shipped on 2026-08-21 naming this exact
call site. The semantics are identical by design: the primitive is
deliberately `role="group"` + `aria-pressed` rather than a radiogroup, for the
reason its own README gives, so nothing about how this dialog announces changed.
```

```text
Migrated to the design system 2026-07-28; it was a hand-built overlay found by
the repository-wide dialog scan.
```

```text
Defects fixed:
 1. **No focus management.** The overlay declared `role="dialog"` and
    `aria-modal` but was a bare div: focus never moved into it, Tab escaped to
    the page behind, Escape did nothing, and focus was not restored on close.
    `role="dialog"` was also on the *backdrop*, so the whole page was nominally
    inside the dialog. It now uses the approved accessible `Modal`.
 2. **Six controls had no accessible name.** Position, Experience, Freight
    Type, the callback Date and Time, and Recruiter Notes all had `<label>`
    elements with no `htmlFor` and controls with no `id`. `FormField` owns the
    association now.
 3. **`text-[10px]` in five places** — every detail-field label and the network
    hint — plus `text-gray-400` on them, which is 2.56:1 on white.
 4. **The outcome grid communicated its selection by colour and a focus ring
    only** — no `aria-pressed`, no grouping, so a screen-reader user could not
    tell which of the eight outcomes was chosen.
 5. **Eight locally-invented palette trios** (`border-green-200 bg-green-50
    text-green-800` and friends, including a `text-red-400` icon) replaced by the
    semantic status tokens. The feature keeps the domain→tone decision.
 6. A `<label>` carried both `block` and `flex` display classes, so its icon
    alignment depended on class order.
```

## `src/shared/components/modals/CompanyChooserModal.jsx`

```text
Migrated to the design system 2026-07-28; it was a hand-built overlay found by
the repository-wide dialog scan.
```

```text
Defects fixed:
 1. **The overlay was a hand-built `fixed inset-0` div** with no
    `role="dialog"`, no `aria-modal`, no focus move on open and no focus trap.
    This is a blocking auth gate over the whole application, so a keyboard user
    landed on the page body with the dialog visually covering everything. It now
    uses the approved accessible `Modal`, deliberately **non-dismissable** (no
    `onClose`): there is no valid way past this gate except choosing a company
    or logging out, which is the behaviour it always had.
 2. **The company list was an unnamed scroll region** (`max-h-60
    overflow-y-auto`); it is now named by the dialog heading.
 3. **Loading and error states were not announced** — a user with a slow
    connection or a permissions problem got silent grey or red text.
 4. Legacy palette throughout — `bg-gray-900 bg-opacity-75` backdrop,
    `bg-gray-50`/`hover:border-blue-500`/`focus:ring-blue-500` rows,
    `bg-blue-100 text-blue-600` avatar, `text-red-600` error and `text-2xl` /
    `text-lg` arbitrary type — replaced with `--ds-*` tokens and approved
    primitives. The per-company row stays a `<button>` because it is a real
    activation, and it now uses the shared focus ring.
```

## `src/shared/components/modals/FeatureLockedModal.jsx`

```text
Migrated to the design system 2026-07-28. Presentation only — `onClose`, the
`featureName` default of `"Search For Drivers"`, the Telegram sales URL and its
`_blank` target, and every user-facing string are unchanged.
```

```text
Defects fixed:
 1. **The close control's `aria-label` was the bare word "Close"** on a dialog
    that also has a "Close" button in the action row, so a screen-reader user
    heard two identically-named controls. It now names what it closes.
 2. **Legacy palette and unapproved type throughout** — a `bg-gray-900/70`
    backdrop, `bg-white rounded-2xl shadow-2xl border-white/20` chrome,
    `text-3xl font-extrabold`, a `from-blue-600 to-indigo-600` gradient pill,
    `text-gray-600 text-lg` body copy and two `bg-blue-600` / `bg-white`
    hand-built buttons.
 3. **Four purely decorative animated blur orbs and a `ring-4` lock badge** ran
    `animate-pulse` and `animate-bounce` indefinitely with no reduced-motion
    guard, on a dialog whose whole purpose is to deliver one sentence. The
    decoration is removed rather than tokenised: it carried no meaning, and
    keeping it would have meant inventing approved values for it.
 4. **A dead `<style>` block** defined a `shimmer` keyframe animation that
    nothing referenced.
 5. The unused `onGoToLeads` prop and `ArrowRight` import are removed — no
    caller ever passed the prop and nothing rendered the icon.
```

## `src/shared/components/schema/SchemaEditControls.jsx`

```text
How a schema `select` and `checkbox` are edited in place, by the company's two
editors (the carrier's prep editor and the dossier's Edit Application). Both used
to be a text box, which wrote values the driver's wizard could not show. Split out
of `SchemaRenderer.jsx` on 2026-10-01; see that file for the rest of edit mode.
```

## `src/shared/components/schema/schemaOptions.js`

```text
Pure helpers the schema renderer and its edit controls share: how an option is
read, how a multi-choice value is read, and which field types may be edited in
place. Split out of `SchemaRenderer.jsx` on 2026-10-01, when the edit controls
grew past what one file should hold.
```

```text
Every type used to fall through to `<Input type="text">` in edit mode. A file is
a document reference, so its box read "[object Object]" — and typing into it
replaced the reference with a string, which a carrier's prepared application
then handed to the driver as their medical card. A signature is an image of
somebody's mark and showed as a base64 string. Both stay read-only while the
rest of the section edits; documents are attached through their own control.
(Found 2026-10-01, in the carrier's prep editor and the dossier's Edit
Application — the only two callers of edit mode.) The names are the schema's
own `type` strings.
```

## `src/shared/components/signature/SignatureInput.jsx`

```text
Until 2026-09-06 the verification portal offered only `SignaturePad`, a
canvas — which has no keyboard or assistive-technology path at all, and which
the roadmap carried as an open decision because a typed mark rendered into
the same PNG as a drawn one would be indistinguishable in the record.
```

## `src/shared/components/table/ModernDriverTable.jsx`

```text
Migrated to the design system 2026-07-28, closing the roadmap's oldest table
row. **`DataTable` is deliberately not adopted here** — see the recorded
exception below.
```

```text
**No accessibility or visual debt hides behind this exception.** Everything
`DataTable` would have given it is provided here explicitly, and the defects the
roadmap recorded against this file are fixed:

 1. **Selection was two icon-only `<button aria-pressed>` controls** with a
    `CheckSquare`/`Square` icon standing in for a checkbox. They are now real
    `Checkbox` controls, so the browser owns the semantics, the keyboard model
    and the indeterminate-free checked state. Per-row names can now identify the
    record via the new optional `getRowLabel`, instead of eight identical
    "Select row" controls.
 2. **Row activation was mouse-only.** The `<tr>` had an `onClick` with no
    `tabIndex` and no key handling, so the primary action of the table — opening
    a driver — was unreachable by keyboard. Rows are now focusable and respond
    to Enter/Space, using the same `event.target !== event.currentTarget` guard
    `DataTable` uses so activating a control *inside* a row does not also
    activate the row.
 3. **The table had no accessible name and no caption.** It now requires one via
    `ariaLabel` (defaulted, and also used to name the pager).
 4. **The scroll region was unnamed and unfocusable**, so a keyboard user could
    not scroll a wide table horizontally.
 5. **The loading skeleton announced nothing** during a multi-second load.
 6. **Selection state was not exposed on the row** — only a background tint.
    Rows now carry `aria-selected` when selection is enabled.
 7. **25 legacy palette values** (`bg-white`, `border-slate-200`,
    `bg-slate-50/50`, `text-slate-500`, `text-slate-300`, `bg-blue-50/40`,
    `text-blue-600`) plus hard-coded `rounded-xl` / `shadow-sm` / `text-xs`
    replaced with `--ds-*` tokens.
```

## `src/shared/components/table/index.js`

```text
`SkeletonRow` / `SkeletonTable` were removed on 2026-08-21. They had no
consumers anywhere in the tree — `DataTable` renders its own skeleton, using
the `--ds-*` tokens — and they carried raw `bg-gray-200` placeholders that the
UI-contract ratchet would otherwise have had to tolerate forever.
```

## `src/shared/hooks/useBulkImport.js`

```text
The default used to be `alert(message)`, which froze the tab. Both real
consumers now pass a handler — `CompanyBulkUpload` always did, and
`AudienceBuilder` was fixed on 2026-07-28 — so this fallback is no longer
reachable in the app. It logs instead of blocking, because a hook must not
own presentation, and a native prompt is the one sink it cannot style,
announce or dismiss consistently.
```

```text
@param {(message: string) => void} [options.onError] Where import failures are
  reported. Defaults to a blocking `window.alert`, which is what every caller
  used before the lead-intake design-system migration.

  The default is kept deliberately: `AudienceBuilder` (campaigns) also consumes
  this hook and was not part of that migration, so omitting the option must
  behave exactly as before. `CompanyBulkUpload` passes a sink that renders the
  same message as a non-blocking in-page alert instead — a blocking modal
  dialog steals focus, cannot be reached by assistive technology as page
  content, and halts the JS event loop.

  Messages are unchanged in both paths.
```

## `src/shared/services/fmcsaEmployerSocrata.js`

```text
Separate queries rather than `$order` on the status, which would have Socrata
sort every match; each of these answered in about 0.3 s (2026-10-07).
```

```text
Two callers with their own queries: the driver's employer lookup
(`fetchFmcsaEmployerSuggestions`) and the company's verification request
(`fetchFmcsaCarrierCandidatesForPev`, whose query is unchanged since before
2026-10-07 but for a Canadian or Mexican region, now asked for with its
country). Both map a row through this file, so a value FMCSA holds but no
form should, such as "NONE" in the email column, is dropped in one place.
```

## `src/shared/utils/dateFormHelpers.js`

```text
@param {string} value — YYYY-MM, legacy mm/yyyy or MM/YYYY, or a full
  YYYY-MM-DD (its month and year: employment and school dates were stored
  with a day until 2026-10-06, and a row saved then still shows its month)
```

## `src/shared/utils/domId.js`

```text
The HTML spec forbids ASCII whitespace in an `id`, and anything that builds a
CSS selector from one — axe-core when it names the element in a finding, a
test's `querySelector('#…')` — reads `#a b` as two selectors. `EXPERIENCE_OPTIONS`
carries values such as "0-6 months", and three components interpolated them
straight into ids. happy-dom 20.4+ refuses the selector axe builds from such an
id and axe never returns, which is how the defect surfaced on 2026-09-06 when
the dependency update landed; the ids were invalid HTML all along.
```

## `src/shared/utils/northAmericanRegions.js`

```text
Every name is unique across the three lists, so a stored name says which
country it is in. FMCSA records a region as a two-letter code that is only
unique within a country: "NL" is Newfoundland and Labrador in Canada and
Nuevo León in Mexico. Mexico's codes are FMCSA's own, not ISO 3166-2:MX;
all 32 were checked against the census (2026-10-07), and the cities each one
holds.
```

## `src/shared/utils/usStates.js`

```text
Every state picker in the application holds a full name ("Texas"). Licences,
motor vehicle records and the readers that parse them print a postal code
("TX"), and a carrier typing into a free-text box writes whatever it likes. A
picker given a value that is none of its options does not show "nothing":
the browser shows the first option it can, so until 2026-10-01 a driver whose
CDL auto-fill read an Austin address saw "Alabama" on both state pickers while
the form still held "TX" — and the step's validation passed, because the field
was not empty. What a driver saw was not what was submitted.
```

```text
The District of Columbia is listed too, since 2026-10-02, in its alphabetical
place: it issues its own licences and is a real address. Until then the list had
the fifty states only, so a DC address or licence could not be selected at all
and `toUsStateName('DC')` was `''`. The five inhabited territories followed on
2026-10-09, in theirs: each issues its own licences, and FMCSA's census holds
carriers in all five under the same codes (about 7,200 in Puerto Rico).
```

## `src/design-system/components/data-table/README.md`

```
Decided 2026-09-06 (audit step K), after the roadmap had carried it as an open
per-table decision. The standard applied is Nielsen Norman Group's guidance for
mobile tables (Amy Schade, *Mobile Tables: Comparisons and Other Data Tables*,
2017): when a table must scroll sideways, *"the leftmost column … should be
locked in place, so users can see the necessary labels at all times"*, sticky
column headers *"help users know what they are looking at"*, and the cut-off
columns themselves are the signal that there is more.
```

```
Until 2026-08-21 that overflow was invisible, because an icon inside a button
could be squeezed by a pixel or two to make the content fit. `Button` now pins
icon size and sets `flex: 0 0 auto`, so a cell that is too small reports it
instead of quietly distorting its glyphs.
```

## `src/design-system/components/file-input/FileInput.css`

```
As a `<label>` the whole panel is the click target for the input it labels,
which none of the hand-built versions managed. It is a drop target too, but not
for free: this comment claimed "with no event handler at all" until 2026-08-25,
and that was wrong — a label forwards a click to its control, never a drop, so
a file dropped on the panel landed on the label and was discarded. `FileInput`
has an explicit `onDrop` now; see the note beside it.
```

## `src/design-system/components/file-input/FileInput.jsx`

```
## Two shapes, `loading` and `labelHidden` (2026-08-25)

Four days after this component shipped it had two consumers, and nine raw
`<input type="file">` controls were still in the tree, every one of them
carrying a comment that said "the design system has no approved file-input
contract yet". Migrating them is what showed why: the contract existed but the
API covered one of the product's three real shapes.

- `variant="dropzone"` is the full-width dashed panel that four uploads use.
  As a `<label>` the whole panel is the click target, and `onDrop` below makes
  it a real drop target. An earlier version of this line claimed the label gave
  the second one "without a single event handler" — it does not, a label
  forwards clicks and not drops, and the panels ignored dropped files until
  2026-08-25. See `handleDrop`.
- `loading` is what the avatar and company-logo pickers needed. Both used
  `Button loading` plus a hidden input, because an upload picker is exactly the
  control that has to say it is busy.
- `labelHidden` is for a picker whose field is already named on screen — a
  photo preview beside it — matching `Checkbox`'s prop of the same name. The
  name stays in the accessibility tree either way.
```

```
## `loading` says so out loud, too (2026-08-26)

Both pickers this replaced also carried a `<p role="status">` region reading
"Uploading company logo…", and the migration dropped it on the reasoning that
`aria-busy` plus the button text now carried the state. Neither is announced:
`aria-busy` is on an input that `loading` has just disabled and taken focus
from, and the button text is ordinary content, not a live region. The upload
went silent for a screen-reader user. Restored here rather than at each call
site — one region per picker, in the component whose prop `loading` is. See
`loadingStatus`.
```

```
## Both handlers cancel the event FIRST, disabled or not

The first version of this returned early when `inert || loading`, before
calling `preventDefault`. That handed the drop back to the browser, whose
default action for a dropped file is to navigate to it — so dropping a second
file onto a panel that was mid-upload could replace the page and discard a
half-filled form. On the public driver application that is somebody's work
gone, which makes it the most expensive thing a disabled control could do.

Found in review on 2026-08-25. The rule is: cancelling the browser's default
is what a drop target owes the page whether or not it can accept the file.
Only the assignment and the `change` dispatch are conditional.
```

```
The native picker filters by `accept` in its own dialog, so a call site
that passes `accept="image/*"` has never had to check the type it got. The
company logo is exactly that: `BrandingSection` passes `image/*`, and
`CompanyProfileTab`'s handler uploads and persists whatever arrives with no
validation of its own — and Storage permits PDFs in `company_assets`. So
before this filter, dropping a PDF on the logo control saved it as the
logo and left a broken image on the company profile.

Found in review on 2026-08-25, one round after the drop handling itself was
added. Programmatic assignment inherits none of the picker's behaviour, and
`accept` was the piece of it that mattered.

## And then it has to SAY so (2026-08-26)

Filtering silently is its own defect, and it shipped for a day: the file
went nowhere, no message appeared, and the panel looked exactly as it had.
A drop is a direct manipulation, so "nothing visibly happened" reads as
"this control is broken" rather than "that file is not allowed here".

`resolveDroppedFiles` decides both halves together, because they are one
decision — what survives, and what the user has to be told. The accepted
files go down the existing path untouched; the message is state, below.
```

```
Several call sites render the picker only while there is no file —
`EnvelopeSidebar` is `{!file ? <FileInput/> : …}`, `UploadField` renders it
only in its idle state — so a mixed drop hands them a file, they
re-render, and the alert below is unmounted in the very commit that
created it. Found in review on 2026-08-26 and reproduced: the message
never reached the screen, while the all-refused case (which calls no
`onChange`, so nothing unmounts) worked.
```

## `src/design-system/components/file-input/README.md`

```
Every one of those nine carried a comment saying "the design system has no
approved file-input contract yet". It shipped on 2026-08-21; four days later this
component had **two** consumers and the other nine were untouched. Migrating them
(2026-08-25) showed why, and it was not neglect: **the contract existed and its
API covered one of the product's three shapes.** A primitive that fits a third of
its call sites does not get adopted. `check:ui-contract`'s `raw-file-input` rule
is what stops the tenth being written.
```

```
| `variant="dropzone"` | The full-width dashed panel. `BulkUploadLayout`, the driver application's `UploadField`, the campaign recipient import and the e-doc envelope creator had each built this by hand. As a `<label>` the whole panel is the click target, and `onDrop` accepts a file dropped anywhere on it — none of the four hand-built versions had the second, and neither did this until 2026-08-25: the docs claimed the label supplied it, but a label forwards a click to its control and never a drop, so dropped files were silently discarded |
```

```
`loading` disables the input, and disabling the element that currently has focus
drops focus to `<body>`. An upload started from the keyboard therefore ended with
the user at the top of the document once it finished — the picker they were on had
been disabled underneath them.

The two hand-built pickers this component replaced each had their own
focus-return effect for exactly this, and deleting them without putting the
behaviour here is a real regression a review caught on 2026-08-25. It lives in
the component now, because `loading` is the component's prop and this is the
component's consequence.

It is a **restore**, not a grab, and it asks a narrower question than it first
did. An earlier version armed the flag on every `change`, reasoning that the
event comes from the input so the input must be focused. True of the picker,
false of a drop: `handleDrop` dispatches `change` *from* the input and a drop
moves no focus at all, so a mouse user who dragged a logo onto the panel had
focus jump into a clipped 1x1 input when the upload finished. The flag is now
armed only when this input *is* `document.activeElement` as the file arrives, and
focus is returned only if nothing meaningful holds it when `loading` clears. A
user who tabbed away during the upload keeps their place.
```

```
- **A drop the `accept` list refuses says so.** The native picker will not offer
  a file it cannot accept; a drop inherits none of that, so `handleDrop` enforces
  `accept` itself — and, since 2026-08-26, reports what it refused instead of
  returning in silence. The message is a `role="alert"`, matching `FieldMessage`'s
  rule that errors are assertive and everything else polite, and it is visible as
  well as announced. While it stands the input is `aria-invalid` and the message
  joins its `aria-describedby`; any later selection clears all three.
```

```
- **`onReject` transfers ownership of that message**, and a call site that
  removes the picker needs it. `EnvelopeSidebar` renders the picker only while
  `!file` and `UploadField` only in its idle state, so on a *mixed* drop the
  accepted file unmounts the alert in the commit that created it — found in
  review on 2026-08-26 and reproduced. `onReject` fires **after** `onChange`, so
  a call site can clear stale state in its own handler and still receive the
  message that arrived with this drop. **`FileInput` still shows its own message
  whenever it is mounted**; a call site that takes `onReject` shows it only while
  the picker is *gone*. Those are exact complements, so there is never a second
  copy and never a render where the visible text disagrees with the input's
  `aria-invalid` — and no transition has to be enumerated to keep them in step,
  which is what three earlier attempts got wrong.
```

## `src/design-system/components/file-input/useFocusRestore.js`

```
`loading` disables the input, and disabling the element that currently has
focus drops focus to `<body>` — so an upload started from the keyboard ended
with the user at the top of the document once it finished. The two pickers
this component replaced each had their own focus-return effect for exactly
this; deleting them without putting the behaviour here is what a review of
2026-08-25 caught.
```

```
## Focus goes back only if it was HERE to begin with (2026-08-26)

The first version armed the flag on every `change`, reasoning that "the
change event comes from the input, so the input is focused". True of the
picker, false of a drop: `handleDrop` below assigns the dropped files to
this input and dispatches `change` *from* it, and a drop moves no focus at
all. Measured in Chromium — after a drop on the panel `document.activeElement`
is still `<body>`, and the dispatched `change` arrives with it still there.

So a mouse user who dragged a logo onto the dashed panel had focus jump into
a 1x1 clipped input the moment the upload finished. The restore guard below
cannot catch that, because `<body>` is both "the user had nothing focused"
and "focus was just taken away from this input" — the two states it exists
to tell apart. Found in review on 2026-08-26.

The fix asks the question the guard cannot: was this input *itself* what
focus was on when the file arrived? That is exactly what separates the
paths, and each half was measured rather than assumed:
```

## `src/design-system/components/status-medallion/StatusMedallion.jsx`

```
A `size` written here has no effect, which is the point. Until 2026-09-06 it
did, and the six call sites had picked 24, 28, 40 and 48 between them.
```

## `src/design-system/components/tabs/README.md`

```
All eleven are migrated (2026-08-25). `check:ui-contract`'s
`hand-rolled-tablist` rule is what keeps the twelfth from being written: this
component was built on 2026-08-21 and still had **zero** consumers four days
later, because a roadmap line is not a guard.
```

## `src/design-system/patterns/modal/README.md`

```
Added 2026-09-05. Before it, `Modal` took a `className` and an
`overlayClassName` that **replace** the panel and backdrop wholesale, and 38 of
the 41 call sites used them — writing 30 different spellings of the same handful
of intentions. A hairline border here and none there; `max-h-[85vh]` beside
`max-h-[92vh]`; `backdrop-blur-md` beside `backdrop-blur-sm`. None of it was
visible to any guard, because every one of those classes is perfectly
on-contract. The variation was the problem, not the classes.

So the chrome moved into `Modal.css` and the variation became six enumerated
props:
```

```
`className` and `overlayClassName` were removed on 2026-09-05, and passing
either now throws. They REPLACED the chrome rather than extending it, which is
how 38 call sites came to write 30 spellings of the same six intentions.
```

```
Dialog structure was always meant to be a pattern. It sat in
`src/shared/components/modals` until 2026-08-21 for one reason: `ConfirmDialog`
composes `Modal`, and the design system may not depend on `shared`, so moving
either alone would have created the exact dependency inversion the migration
exists to remove. They moved together, and `tests/architecture.test.js` now
forbids `shared` imports from this directory outright — a rule that could not be
written while these two files were the counterexample.
```

## `src/design-system/stories/Button.stories.jsx`

```
**It means two different things, and the variant decides which.** On a
`primary` it FILLS, and only `success` is allowed: a primary action already
carries the strongest emphasis on the page, so a second colour on top competes
with that rather than adding to it. Until 2026-09-05 a single rule applied the
fill to every variant, which is why the secondary button below used to be
solid green and is now a tint — the tint is the point.
```

## `src/design-system/tokens/typeface.css`

```
## Why this file exists

Until 2026-08-25 `src/index.css` opened with

    @import url('https://rsms.me/inter/inter.css');

so SafeHaul's typeface was fetched from a third party at runtime. Three things
followed from that, and the third is what forced this change:

 1. Anyone whose network cannot reach `rsms.me` saw the entire application in
    a fallback font — not a graceful degradation, a different product.
 2. Every user's IP address was disclosed to a third party in order to render
    text.
 3. **The visual-regression lane could never be trusted.** On GitHub's runners
    the font did not arrive, so all twenty application-screen baselines failed
    on every run — 20 of 152, every time — while `continue-on-error: true`
    swallowed it. The recorded diff was every glyph offset and every box
    unchanged: a pure substitution. The lane had never once been green in CI.

`.storybook/preview.css` had already written down the right principle for the
catalog: "a webfont that may or may not have loaded is exactly the kind of
timing-dependent difference that makes a catalog untrustworthy." It is exactly
as true of the application, which is why the carve-out that kept Inter out of
the catalog is gone too — the catalog now renders in the product's real
typeface, so `check:table-layout` and `check:visual-contract` finally measure
the metrics the product actually has rather than a fallback's.
```

## `src/design-system/utilities.css`

```
It lived in `components/form/FormControls.css` until 2026-08-21, which meant
it only existed on a page that had rendered a form control. `Link` is the
component that would have broken on that: an external link on a page with no
form would have shown its hidden hint as visible text.
```

```
The design-system focus ring is a `box-shadow`, so it does not replace the
browser's own `outline` — it draws *next to* it. The convention is to write
`focus-visible:outline-none` alongside `focus-visible:shadow-ds-focus`, and 67
of the 74 call sites do. The seven that forgot showed the UA outline instead:
`auto 1px rgb(16, 16, 16)`, a black ring in a product whose focus colour is
blue. The 2026-08-25 walkthrough found one of them on the driver
application's step heading, which every applicant sees on every step.

Doing it here rather than at those seven call sites means the next one cannot
forget either. The attribute selector matches the Tailwind utility by name
because that is how call sites ask for the ring; `.ds-*` components set the
shadow in their own CSS and already reset their outline.
```

```
A global rule, and the one thing in
`src/shared/styles/designTokens.css` that still had an effect when that file
was retired on 2026-08-25. Everything else in it — a second colour, type,
radius, shadow, spacing, z-index and focus-ring scale, plus `.focus-ring`,
`.skip-link`, `.hide-mobile` and `.two-column-layout` — had no consumer left
anywhere in `src/`. This did, and it belongs here: it is a decision every
component inherits, which is exactly what this file is for.
```

## `src/features/company-admin/applicationPrep/InviteLinkPanel.jsx`

```
## The copy below is a claim about the server, and it was false

"Creating a new one retires this one" described the intent while the server did
the opposite: one document-level expiry, rewritten by every mint and shared by
every accepted hash, so regenerating revived the old link for a further fourteen
days instead of retiring it. Fixed on 2026-09-08 in
`functions/companyApplications/invite.js`, where each hash now carries its own
expiry and a replaced link keeps a ten-minute grace so a driver mid-page is not
cut off. **The sentence names the grace**, because "retires this one" on its own
is the wording that was wrong before.
```

```
**And until 2026-09-09 that last sentence was another claim about the server
that was not true.** The link did reach the right application and did ask for
identity — and the browser had no screen for that answer at all, so the driver
landed on the fresh-application chooser. The sentence below names all four
things the screen now asks for, because naming only two of them is the same
kind of drift the expiry copy above records.
```

## `src/features/company-admin/applicationPrep/UnfinishedApplicationReview.jsx`

```
Until 2026-10-06 the carrier could see only that a driver had started and how
far they had got. The owner decided that a Company Admin sees what the driver
has filled in, so a follow-up call can start from it. This is that view:
`getApplicationDraft`'s record, through the presenter and the view a submitted
application uses (`presentSubmission`, `PreservedApplicationView`), so the
answers read the way they will once the driver submits.
```

## `src/features/company-admin/applicationPrep/applyExtractedFields.js`

```
A date the form's date controls can show, or nothing — the rule the fill plan
already applies to the licence expiration. A value they cannot show is held by
the form and seen by nobody: the carrier's box and the driver's picker were both
blank over "03/11/1988" (2026-10-01).
```

```
And it is the ROW that is locked, as it stands. Locking the report's
own spelling made a lock no driver could satisfy (found 2026-10-01): a
row "Acme Trucking LLC" matched by USDOT to the report's "ACME
TRUCKING" passed every carrier save, then failed submission as
`locked-employer-changed` — on a name the wizard shows the driver as a
record they cannot edit. Matched by name with no number on the row, the
report's number gave the lock a signature no row had, and the save
silently dropped it.
```

## `src/features/company-admin/applicationPrep/useInviteLink.js`

```
`describeError` is shared with the prep-draft hook and answers
`resource-exhausted` with "Too many saves in a row", which is the wrong noun
here — nothing was being saved, and `mintApplicationInvite` has a rate limit of
its own. It only started mattering when `UnfinishedApplicationsPage` began
rendering this error at all (2026-09-09); before that the message went nowhere,
which was the defect. Everything else `describeError` says is right for both.
```

```
`mint` returns the URL for this reason; the row action on
`UnfinishedApplicationsPage` passes it straight here. Found by its own
contract test on 2026-09-09.
```

## `src/features/company-admin/components/modals/PEVRequestModal.jsx`

```
Presentation migrated to the approved accessible `Modal`, the approved
`ChoiceGroup`/`Radio`, `FormField`/`Input`, `Button` and `IconButton`
primitives, and `--ds-*` tokens (2026-07-27).
```

```
DEFECTS FIXED (2026-07-27):
- **The delivery-method choice was three plain `<button>`s with a hand-drawn
  radio dot and no `aria-checked`, `aria-pressed` or grouping.** Assistive
  technology was told nothing about which method was selected, or even that
  the three belonged together. They are now native radios inside a real
  `<fieldset>`/`<legend>`, so the browser owns arrow-key selection and the
  group is announced once.
- **The dialog was hand-rolled** — a fixed overlay with no `role="dialog"`, no
  `aria-modal`, no focus containment, no focus restoration and no Escape,
  opened on top of the driver dossier, which *is* a dialog.
- **The close control had no accessible name.**
- **10 px and 11 px interface text** in the "Missing Info" pill and the legal
  note, below the 12 px floor.
```

## `src/features/company-admin/components/modals/VOEPreviewModal.jsx`

```
── SCOPE OF THE 2026-07-27 MIGRATION ────────────────────────────────────────
```

```
Note what that reason is NOT, corrected 2026-09-04: it is not that the export
paths lack the custom properties. `handleDownloadPDF` rasterises with
html2canvas from **computed** style, which resolves `var()` first; and
`handlePrint` inlines the application's own stylesheets through
`collectPrintStyles`, tokens included. Tokens would resolve. They are withheld
because the document must not follow the theme, not because it could not.
`VOEPreviewModal.export.test.jsx` enforces this: the document subtree must
contain no `ds-*` class and no `var(--ds-…)` value. Do not "finish the
migration" by tokenising it without first proving export parity.
```

```
── PRINT PIPELINE (rebuilt 2026-07-27) ──────────────────────────────────────
```

```
DEFECTS FIXED (2026-07-27):
- **The dialog was hand-rolled**: no `role="dialog"`, no `aria-modal`, no
  focus containment, no focus restoration and no Escape — layered on top of
  `PEVRequestModal`, which is itself a dialog inside the driver dossier, which
  is a third. Tab walked straight out of all three.
- **The close control had no accessible name.**
- **Export failure used `window.alert`**, which blocks the thread and is not
  announced as part of the dialog. It is now an in-dialog `role="alert"`.
- **A blocked pop-up crashed the print action** with a TypeError on
  `windowPrint.document`, with nothing shown to the user.
- **PDF generation was silent** — an icon swap with no live region.
- **Missing data rendered `null`**, so choosing "Continue to Preview" opened
  nothing at all with no explanation and no way back.
- **The disabled Transmit action never said why** it was disabled; the reason
  was only visible inside the document image.
- `text-[10px]` chrome text below the 12 px floor.
```

```
DEFECT FIX (2026-07-27): this used to serialise the document to a string,
run it through `sanitizeUserContent` — the strict *user-content* policy —
and write the result into the print window. That policy allows no `div`,
no `class` and no `img`, so Print emitted a flat, unstyled text dump with
the applicant's signature deleted: an unsigned §391.23 release. See
`@shared/utils/printDocument` for why trusted structure needs its own
policy and why the shared sanitiser must not be loosened to accommodate
this call site.
```

## `src/features/company-admin/components/modals/driver-dossier/DossierContent.jsx`

```
Presentation migrated to `--ds-*` tokens (2026-07-27). Every prop handed to
every tab, the lazy-loading split, and the `'application' | 'documents' | 'dq'
| 'pev' | 'activity' | 'notes'` routing values are unchanged.

DEFECT FIXED (2026-07-27): the lazy-tab loading fallback was a bare spinner
with no live region, so switching to Previous Employment, Activity or Notes
announced nothing at all while the chunk downloaded.
```

## `src/features/company-admin/components/modals/driver-dossier/DossierHeader.jsx`

```
Presentation migrated to the approved `IconButton`, `Select` and `Badge`
primitives with `--ds-*` tokens (2026-07-27).
```

```
DEFECTS FIXED (2026-07-27):
- **The close button had no accessible name at all** — an icon-only `<button>`
  with neither `title` nor `aria-label`. Screen-reader users were offered an
  unlabelled control as the only way out of a modal dialog.
- The Status and Assign To selects took their accessible name from a `<span>`
  marked `hidden lg:inline`. Below `lg` that span is `display:none`, which
  removes it from the accessible name computation — so on every tablet and
  phone both selects were **completely unlabelled**. The label text is now
  always present, visually hidden below `lg` instead of removed.
- The Download action relied on `title` alone for its name; it now carries an
  explicit `aria-label`.
- **At 412 px the Close and Delete actions were off-screen entirely.** The
  action group was `shrink-0`, so its `flex-wrap` never engaged: it stayed at
  its 489 px max-content width inside a 412 px dialog panel whose
  `overflow-hidden` then clipped it. On a phone — which has no Escape key —
  there was no way at all to close the dossier. The group now shrinks and
  wraps.
```

## `src/features/company-admin/components/modals/driver-dossier/DossierSidebar.jsx`

```
Presentation migrated to the approved `Button` and `--ds-*` tokens
(2026-07-27). Frozen contracts: the six navigation ids
(`application`, `documents`, `dq`, `pev`, `activity`, `notes`) in that order,
their visible labels, the exact `setActiveTab(id)` values, the
`tel:` / `mailto:` href schemes, and the `dqStatus === 'incomplete'` rule.
```

```
The strip is the design system's `TabList` (2026-08-25). It was a feature-owned
WAI-ARIA composition, recorded as an exception because "the design system has
no approved Tabs primitive" — true when it was written, and untrue from
2026-08-21, when `TabList` shipped naming this file as one of its nine intended
consumers. This is the split-across-components case the primitive's `tabIds`
export exists for: the sidebar owns the strip and `DriverProfileModal` owns the
panel, and they now derive their ids from one `idBase` instead of passing two
id-builder functions between them.
```

```
DEFECTS FIXED (2026-07-27):
- The navigation was six plain `<button>`s. There was no `tablist`, no
  `aria-selected`, no `aria-controls` and no arrow-key model, so assistive
  technology could not tell it was a tab interface, could not say which
  section was current, and a keyboard user had to Tab through all six.
- Selection was signalled by background colour alone.
- The DQ-incomplete warning was a bare red dot with no text or label —
  invisible to a screen reader and to anyone who cannot distinguish it.
- The Call/Email labels used `text-[10px]`, below the 12 px interface floor.
- The disabled contact state used `pointer-events-none` on a live
  `<a href="tel:">`, so it stayed in the tab order and announced as a link
  pointing nowhere. Missing contact details now render as inert text.
```

## `src/features/company-admin/components/modals/driver-dossier/DriverProfileModal.jsx`

```
Presentation migrated to the approved accessible `Modal`, the approved `Button`
and `--ds-*` tokens (2026-07-27).
```

```
DEFECTS FIXED (2026-07-27):
- The dialog was hand-rolled: `role="dialog"`/`aria-modal` with **no focus
  containment, no focus move-in and no focus restoration**. Tab walked straight
  out of the dossier into the page behind it, and closing dumped the keyboard
  user back at the top of the document. It now uses the shared accessible
  `Modal`, which owns all three.
- Escape was a `window` listener owned by this component. While a delete was
  in flight the confirmation's own `onClose` is intentionally `undefined`, so
  nothing stopped the event and Escape tore down the whole dossier
  mid-delete. `Modal` now owns Escape per dialog, so Escape dismisses the
  topmost one and is inert while deleting.
- The layout was `flex-row` with a fixed **280 px** sidebar inside a `90vw`
  panel. At 412 px that left roughly 90 px for the actual content. The panel is
  now full-screen below `sm` with the navigation as a horizontal strip, and the
  three-pane desktop layout from `sm` up.
- Loading was a bare spinning icon (no role, no text) and the error was a plain
  `<div>`; neither was announced. They are now `role="status"` / `role="alert"`.
- The destructive confirmation focused its first focusable element, which was
  the destructive button. It now opens with focus on Cancel.
```

## `src/features/company-admin/components/modals/driver-dossier/tabs/ApplicationTab.jsx`

```
The read-only summary (identity, license, safety, employment, consent), the
summary/full toggle and the pending-changes banner are migrated to the
approved `Card` / `Button` / `IconButton` / `Badge` / `FieldDisplay`
primitives and `--ds-*` tokens (2026-07-27).
```

```
`SchemaSection` renders an `array` section read-only whatever `isEditing` says,
so until 2026-09-09 "Edit application" could change every scalar field and none
of the employment history — the section a recruiter most often has to correct.
That renderer is shared with the driver's own wizard, so the editor lives in the
applications feature (`PreviousEmployersEditor`) and is swapped in here for the
one section while editing. Every other section renders exactly as before.
```

```
DEFECTS FIXED (2026-07-27):
- With no SSN on the application the mask was applied to the literal fallback
  string `'Unknown'`, so the card displayed **`***-**-nown`**. An absent SSN
  now renders the fully-masked `***-**-****`.
- The SSN reveal toggle was an icon-only `<button>` with no accessible name,
  so a screen-reader user was offered an unlabelled control that exposes a
  social security number. It is now a named `IconButton` whose label reflects
  its state.
- The summary/full toggle was two `<button>`s with no pressed state, so
  assistive technology could not tell which view was active — selection was
  carried by background colour alone.
- Card titles were `<h3>`; they now sit at `<h4>` beneath the header's `<h3>`.
- With no application data the tab rendered **nothing at all**, leaving the
  dossier's tab panel blank with no explanation. It now renders an announced
  empty state.
- Summary rows applied `truncate` to the value, so long addresses and names
  were clipped with no tooltip and no way to read them. Values now wrap.
```

```
Toggle Header — the design system's `SegmentedControl` since
2026-08-25. It was a hand-built `role="group"` of `aria-pressed`
buttons, recorded as an exception because "the design system has no
Segmented/ToggleGroup primitive yet"; one shipped on 2026-08-21
naming this call site. The semantics are the same by design — the
primitive is `role="group"` + `aria-pressed`, not a radiogroup — and
the icon size now comes from the control-icon token instead of a
`size={14}` chosen here.
```

## `src/features/company-admin/components/modals/driver-dossier/tabs/DocumentsTab.jsx`

```
Presentation migrated to the approved `Card` / `IconButton` primitives and
`--ds-*` tokens (2026-07-27).
```

```
DEFECTS FIXED (2026-07-27):
- Each document card was a `<div onClick>`: not focusable, not activatable by
  keyboard, no role and no accessible name. The whole gallery was
  mouse-only. Cards are now real buttons that name the document they open.
- The preview lightbox was a hand-rolled overlay with **no `role="dialog"`, no
  focus containment, no focus restoration and no Escape**, layered on top of a
  modal dialog. It now uses the approved accessible `Modal`.
- The document date used `text-[10px]`, below the 12 px interface floor.
- The close and download controls in the lightbox had no accessible names.
- The list was a bare grid of `<div>`s; it is now a real list, so assistive
  technology announces how many documents there are.
- The empty panel was a hand-composed icon-and-copy block (2026-08-25). It is
  the approved `EmptyState`; the frozen copy is unchanged and is now the
  state's heading rather than a loose paragraph.
```

## `src/features/company-admin/components/modals/driver-dossier/tabs/applicationTabCards.jsx`

```
"yes" / "no" as the applicant answered it, or null for a record written before
the Yes/No questions existed (2026-09-02) — those are described by their lists.
```

## `src/features/company-admin/components/modals/pev/FmcsaCarrierPicker.jsx`

```
Presentation migrated to `--ds-*` tokens and the approved `Badge` (2026-07-27).
```

```
EXCEPTION RETIRED 2026-09-05. Each row is a selectable suggestion carrying
multi-line structured content (legal name, USDOT + city/state, and a
contact-availability note), which is why the approved `Button` could never
host it — `Button` takes inline children and owns its own layout. That is the
gap `SelectableCard` was built for, and these rows are one of its four
consumers. `selected` carries the ARIA; the selected state is also stated in
text below, never by colour alone.
```

```
DEFECTS FIXED (2026-07-27):
- Six separate runs of 10 px interface text (the state note, the usage hint,
  the per-row contact note, the "Selected" marker, the no-contact banner and
  the census disclaimer), all below the 12 px floor.
- The loading state was a bare spinner with no live region, so a screen-reader
  user was told nothing while the registry was queried; the error and
  no-results states were equally silent. All three are now announced.
- The suggestion list was not a labelled region, so there was nothing to tell
  assistive technology what the group of rows was for.
```

## `src/features/company-admin/components/profile/ProfileAvatarField.jsx`

```
The picker is the design system's `FileInput` (2026-08-25). It was a hidden
input driven by a `Button` calling `.click()` on it, under a comment saying
"the design system has no approved file-input primitive yet" — untrue from
2026-08-21. That shape works with a keyboard but puts the accessible name on
the trigger rather than the field, and it was one of three different ways this
product opened a picker.

`FileInput` needed `loading` to take it, which is the right place for it: an
upload picker is exactly the control that has to say it is busy AND refuse a
second file while the first is in flight. The `role="status"` region this
component used to own moved there with it and is no longer written here: one
region, in the primitive whose prop `loading` is, announcing "Uploading
Profile photo…" for every picker in the product rather than for the two that
remembered to. It briefly went missing in between — this docblock claimed
`aria-busy` and the label text carried the state, and neither is announced —
which a review on 2026-08-26 caught. `FileInput` owns the focus consequence of
`loading` too, and restores focus only when the picker is what focus was on as
the file arrived — so a keyboard upload gets it back and a dragged-and-dropped
one does not have focus moved for it.
```

## `src/features/company-admin/components/tabs/NotesTab.jsx`

```
Migrated to the design system 2026-07-28. This was one of the four dossier tab
bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
and recorded as residual debt since.
```

```
Defects fixed:
 1. **`alert("Failed to save note.")`** — a blocking dialog for a routine save
    failure. Now an announced in-place message with the wording preserved.
 2. **The note composer had no accessible name.** The `<label>` had no
    `htmlFor` and the `<textarea>` had no `id`, so a screen reader announced an
    unnamed multiline field. `FormField` owns the association, and the
    "Visible only to your team" line is now its accessible description rather
    than unrelated text below it.
 3. **Sub-12px functional text** — `text-[9px]` on the "Shared History" badge
    and `text-[10px]` on every timestamp.
 4. **`text-gray-400` on white = 2.56:1** on the privacy note and all
    timestamps, and `text-gray-300` on the empty-state icon.
 5. **The loading state was an unannounced bare spinner.**
 6. **Duplicate submission was possible** — `sending` is React state, so two
    activations inside one render both passed it.
 7. **A `title` attribute was the only marker on the shared-history avatar**,
    duplicating the visible badge; it is removed rather than relied on.
 8. Legacy palette throughout (purple-50/100/200/600/800, gray-*, blue-600) and
    a hand-rolled inline `<svg>` shield replaced by the approved Lucide icon.
 9. **The loading and empty panels were two different shapes** — a line of
    small text and a dashed bordered block — in the same slot (2026-08-25).
    They are the approved `LoadingState` and `EmptyState`, which is the
    pattern's own rule: the three states of one slot look alike, and the empty
    one is announced when the notes finish loading instead of appearing
    silently.
```

## `src/features/company-admin/components/tabs/PEVTab.jsx`

```
Presentation migrated to the approved `Card`, `MetricCard`, `Badge`, `Button`
and `IconButton` primitives, the approved accessible `Modal`, and `--ds-*`
tokens (2026-07-27).
```

```
DEFECTS FIXED (2026-07-27):
- **The verification-history overlay was not a dialog.** A bare
  `<div class="fixed inset-0">` with no `role="dialog"`, no `aria-modal`, no
  focus containment, no focus restoration and no Escape — opened on top of the
  driver dossier, which *is* a modal dialog. Keyboard users tabbed straight
  through it into the page behind. It now uses the approved accessible `Modal`.
- **Its close control had no accessible name** and was a `Plus` icon rotated
  45° to fake an X, so assistive technology was offered an unlabelled button
  whose icon claimed "add".
- **The history dialog was titled "Not Specified" for legacy employers.** It
  read `employer.companyName` only, while the list uses
  `companyName || name`. The one place that tells you *whose* verification
  trail you are reading got it wrong.
- **The Resend action had no accessible name** — an icon-only `<button>` whose
  only name source was a `title` attribute.
- **Interface text at 10 px and 11 px** in the summary cards, the status
  badges and the FMCSA notes, below the 12 px floor.
- **The employer list was a bare `<div>` grid**, so assistive technology never
  announced how many employers there were. It is now a real list.
- **The in-flight upload and signed-URL fetches were silent.** Both now
  announce through a `role="status"` live region.
- **Status was carried by a coloured strip and a colour-only pill.** The pill
  is now an approved `Badge` whose tone is layered over its own text.
```

```
`[...employers]` from `appData` is a snapshot of whenever the dossier last
read the application, and this writes the WHOLE array back — so anything
that changed on another row in between is lost. That was survivable while
the only thing on a row was what the recruiter typed. It stopped being
survivable on 2026-09-09, when `sendVerificationRequest` began stamping a
stable `employerId` on the rows it resolves: the callable would mint the
identity, the write-back below would erase it a moment later, and the
employer's own answer would then have no row it could safely be filed
against.
```

## `src/features/company-admin/views/DocumentsManager.jsx`

```
BELOW every hook on purpose. Until 2026-09-06 this returned before three
hooks, so a profile arriving with E-Docs off after the first paint changed
the hook count and React threw ("Rendered fewer hooks than expected")
instead of showing the lock. The views test flips the flag on a mounted screen.
```

## `src/features/sandbox/SandboxActionPanel.jsx`

```
Presentation migrated to the approved `Card` / `Button` / `FormField` /
`Select` / `StatusMedallion` primitives and `--ds-*` tokens (2026-07-27).
The `listSandboxTenantCompanies`, `deleteSandboxApplication` and
`transferSandboxApplication` callables, their exact payloads, the Super Admin
claim check, the `/sandbox/transfer-success` navigation state, and the
`onDeletedRestart` / `onTransferComplete` callbacks are unchanged.
```

```
DEFECTS FIXED (2026-07-27): the panel was not a `<main>` landmark and opened
at `<h2>` with no `<h1>`; the transfer `<label>` was not bound to the select;
and the error text was not announced.
```

## `src/features/sandbox/SandboxTransferSuccess.jsx`

```
A hand-built medallion until 2026-09-06: a 56px tinted square holding
a 28px glyph, `aria-hidden`, in a file that already imported from the
design system. The 28 is what flagged it — it is not a step on the
icon scale, and an off-scale size is the signal that a container is
missing rather than that the scale is short.
```

## `src/features/settings/components/profile/BrandingSection.jsx`

```
The picker is the design system's `FileInput` (2026-08-25), which is where the
`loading` state it needed now lives. It was a hidden input driven by a `Button`
calling `.click()` on it, under a comment saying the design system had no
file-input primitive — untrue from 2026-08-21. Same change, and the same
reasoning, as `ProfileAvatarField`: the accessible name belongs on the field
rather than on the trigger, and the `role="status"` region and the
focus-restoring effect this component used to own now live in `FileInput`,
beside the `loading` prop that causes both. The migration first replaced them
with `aria-busy` and the button text, which announce nothing; a review on
2026-08-26 caught that and put the region back in the primitive.
```

## `src/features/super-admin/components/modals/EditCompanyModal.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
`updateCompany(companyDoc.id, companyData, originalSlug)` call and the exact
shape of `companyData` (including `appSlug.toLowerCase().trim()` and
`state.toUpperCase()`), the `uploadCompanyLogo` sequence, the 1500 ms
close delay after a successful save, and every frozen string are unchanged.
The `edit-company-modal` id is preserved for existing selectors.
```

```
The logo upload uses the approved `FileInput` (added 2026-08-21), which
closed the file-input gap this file used to record as an exception. The
picker's keyboard path and accessible name are the primitive's; the accepted
types and what happens to the file stay here.
```

```
Application Rules (2026-09-02): a super admin configures a selected company's
driver-application behaviour from here, with the same panel the company's own
admins see under Settings → Company Profile → Application Rules. The rules are
written only when this editor touched them, so saving a name change leaves a
company's rules — or its absence of rules — exactly as they were.
```

## `src/features/super-admin/components/modals/ViewCompanyAppsModal.jsx`

```
Migrated to the approved accessible `Modal` 2026-07-28. Presentation only — the
`loadApplications(companyId)` call, the multi-shape name/email/phone resolvers,
the client-side filter across name/email/status, the `submittedAt` →
`createdAt` → `'--'` date precedence, and every frozen string are unchanged.
The `view-apps-modal` id is preserved for existing selectors.
```

```
Fixed here:
 - Hand-built overlay replaced by the approved `Modal`. The old one closed on any
   click on the backdrop *and* relied on `stopPropagation` inside the panel —
   which meant a click that started inside the panel and ended on the backdrop
   (a drag while selecting text in the table) closed the dialog and lost the
   view. It also had no dialog role, focus trap, Escape or focus restoration.
 - The filter `<input>` had no label, only a placeholder.
 - The unnamed icon-only close control.
 - Loading and error states were not announced (`role="status"` / `role="alert"`
   now). The empty state still was not, until 2026-08-25: filtering the list to
   nothing replaced the whole table with "No matches found." and announced
   nothing. The error and empty panels are the approved `ErrorState` and
   `EmptyState`, which own that announcement; the brand loader stays, because
   `LoadingState`'s spinner is not it.
 - **Status was communicated by colour alone.** The old markup passed the
   status through `getStatusColor(...).replace('bg-', ...).replace('text-', ...)`,
   a brittle string rewrite that produced a colour-only pill built from legacy
   palette classes. Status is now an approved `Badge` whose text carries the
   meaning, with the domain→tone mapping owned by this feature.
```

## `src/features/super-admin/views/UnifiedDriverList.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the combined
lead/application list, the `sourceType` values, the search across
name/email/phone/company, the sort keys, the 50-per-page client pagination,
the docs-status rule (4 required docs), the 14-day stale rule and the
relative-time buckets are unchanged. The status and driver-type filters offer
the values the loaded records hold (`FILTERS`), and the source filter only the
two sources a record has.
```

```
Bulk actions — REMOVED 2026-09-06. Message, Assign, Move Status and Archive
were placeholders: first they reported a false success, then (2026-07-28) they
sat disabled and labelled unavailable while an owner decision was pending. The
decision, per the bulk-action UX guidance (never show controls that do
nothing): the bar and the row-selection checkboxes that fed it are gone. A
real bulk action returns together with its selection when a recruiter asks for
one — "Export" first, and "Archive" only once an archived state is defined.
`UnifiedDriverList.bulkSafety.test.jsx` pins the absence.
```

## `src/design-system/components/README.md`

```
**The catalog and the baselines those families were waiting on both exist.** The
catalog is Storybook (`src/design-system/stories/`, `npm run storybook`), and 172
pixel baselines are committed under `e2e/visual/__screenshots__/`. `npm run
test:visual` has been **blocking** since 2026-08-25 — it ran advisory before
that, and had never once been green, because the application fetched its
typeface from a third party the runner could not reach. The font is served from
the repository now, so a moved baseline means the pixels moved.
```

```
`switch/` and `file-input/` are **complete**, not open — both landed 2026-08-22
with an implementation, a stylesheet, unit tests, a README and a Storybook entry;
`file-input/` additionally owns drop acceptance, rejection and upload behaviour
and their tests.
```

```
**Dialog is not a remaining candidate.** It moved into the design system on
2026-08-22 and lives in `../patterns/modal/` — `Modal`, `ConfirmDialog` and their
stories — rather than under `components/`, because a dialog is a composition with
focus and dismissal behaviour rather than a single control.
```

## `src/design-system/components/avatar/README.md`

```
**Status: Approved.** Added 2026-09-05, replacing eight hand-built discs.
```

## `src/design-system/components/chip/README.md`

```
**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions across
four files.
```

## `src/design-system/components/selectable-card/README.md`

```
**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions across
four files and closing a gap this roadmap had recorded three times under three
names — Listbox, Combobox, SelectableCard.
```

```
- **not `SegmentedControl`** — that takes a string `label`, so it can express
  none of these rows. The roadmap claimed it covered the FMCSA rows until
  2026-09-04; it never did.
```

## `src/design-system/components/switch/README.md`

```
## Where it came from

Promoted from `features/settings/.../ToggleSwitch` on 2026-08-21. That
implementation was already correct; it was feature-owned only because the design
system had no switch — which meant the Super Admin feature matrix could not
import it and used a `Checkbox` instead, announcing the wrong role for a control
that saved immediately.
```

## `src/design-system/components/card/Card.css`

```
Added 2026-07-28 for the Super Admin dashboard, whose metrics have a real
failure state ("Error") that every other tone misrepresents. The status-danger
tokens already existed and `Card`/`StatusMedallion`/`Badge` already expose a
danger tone; `MetricCard` was the only primitive missing it. The tone is never
the sole signal — the value text still reads "Error".
```

## `src/design-system/components/data-table/DataTable.css`

```
`stable` buys freedom from a 15px reflow when a vertical scrollbar first
appears. Measured across all 84 table renders in the catalog on 2026-08-08,
not one scroll region scrolled vertically: these tables grow with their
content rather than being height-constrained, so it was paying a permanent
visible cost for a reflow that never happens. If a height-constrained table
is introduced later, the space that appears at that edge will be an actual
scrollbar, which is the correct thing to show there.
```

## `src/design-system/components/data-table/nativeTable.css`

```
On 2026-08-25 that was measured. **Seven of the eleven approved native tables
referenced no `--ds-table-*` role at all**, and the four that did referenced
one or two. ("Eleven" throughout this file is the count of approved *files*;
three of them hold more than one `<table>`, for fifteen in total — fourteen
visible, all on this contract, plus one `sr-only` table that has no appearance
and is exempt. `check:ui-contract` counts tables rather than files, so a
three-table file cannot satisfy the rule with one class.) They looked right because `bg-ds-surface-subtle` and
`text-ds-content-secondary` happen to be what the header roles resolve to —
a coincidence, not a contract, and one that a change to either role would
break silently.
```

```
So the density role was a no-op on every body cell from the day this file was
written, and the rows were whatever their content happened to make them. The
`thead` rule above always used `height`, which is why headers matched
`DataTable` at 48px and bodies did not.

Found in review on 2026-08-25 — and worth being blunt about: the guard had
already caught it. `visual-contract.snapshot.json` recorded
`nativeTable.cell` at 60.5px desktop / 63.5px mobile beside `DataTable`'s
body cell at 72px, in the same file, and I read that as "56 measurements
recorded" without noticing the two numbers disagreed. A guard that captures
the defect is only half of one; somebody has to read what it captured.
```

```
The row paints `--ds-table-row-bg`, not the cell. A `position: sticky` cell
stays put while the row scrolls horizontally underneath it — so with a
transparent background the other columns' text paints straight through the
frozen first column. `FeaturesView`'s feature matrix is 20+ columns wide and
freezes the company name; it had `bg-ds-surface` by hand before the contract
arrived, that class was removed with the rest of the hand-picked styling, and a
review on 2026-08-25 caught the consequence.
```

```
## The decision (audit step K, 2026-09-06)
```

## `src/design-system/components/data-table/pinnedColumn.css`

```
## The decision (audit step K, 2026-09-06)
```

## `src/design-system/components/disclosure/Disclosure.jsx`

```
An earlier version of this line also named `AiLogsPanel`. It does not use
this: the roadmap's 2026-08-17 decision put that panel on `DataTable` at
`density="compact"` with its per-run detail in a dialog, because its rows are
read comparatively and collapsing them destroys that. Corrected 2026-08-25 —
a primitive that lists a consumer it does not have is the same defect as a
roadmap that lists a component as missing when it exists.
```

## `src/design-system/components/file-input/dropAcceptance.js`

```
This is pure, and separate from `FileInput.jsx`, for two reasons that arrived
together on 2026-08-26:

- the rules are worth testing directly. `accept` has three syntaxes, case
  folding matters, and the message a rejection produces has more shapes than
  the component has states. Driving all of that through a rendered component
  and a synthetic `DataTransfer` tests the wiring, not the rules;
- the component was 411 lines and this is a whole responsibility — deciding
  *what a drop means* — that has nothing to do with rendering a picker.
```

```
Deliberately not "the files `accept` refused": a single-file field discards
the second acceptable file too, and a caller told "only the first was added"
and handed an empty list has been told two contradictory things. Review on
2026-08-26 caught exactly that. `rejected` means *what you dropped and did
not get*, whichever of the two reasons applies.
```

## `src/design-system/components/form/ChoiceControls.jsx`

```
Hides the label visually while keeping it as the accessible name. Added
2026-07-28 for the Super Admin feature matrix, where each cell is one
checkbox in a grid whose row and column headers already carry the meaning
for sighted users — printing "PEV for Artificial Freight Co" inside every
cell would be unusable. `label` stays required: this changes whether the
name is *shown*, never whether it exists.
```

## `src/design-system/components/form/FormControls.css`

```
`:read-only` is defined as "not `:read-write`", and only inputs, textareas and
contenteditable elements are ever `:read-write`. So a bare
`.ds-form-control:read-only` matches **every `<select>` in the product**, and
this rule — meant for a field the user cannot type into — greyed out every
dropdown SafeHaul has. Found by the 2026-08-25 walkthrough: on the public
driver application, eleven inputs rendered white and four selects rendered
slate-100 beside them, at the same height, on the same form.

A `<select>` can still be genuinely `:disabled`, and that rule below is
unchanged.
```

## `src/design-system/components/notice/Notice.css`

```
The chrome every notice shares, which is the whole reason this exists: the
2026-09-05 audit found 66 hand-built ones, and they had drifted apart in
radius, padding, gap and glyph size while every one of them used correct
`--ds-*` roles. Colour drift a rule can see. This kind it cannot.
```

## `src/design-system/components/notice/Notice.jsx`

```
The single most copy-pasted shape in this application: the 2026-09-05 audit
found **66 of them across 52 files**, every one hand-built, every one using
`--ds-*` roles — which is why no colour rule ever saw them. The full audit,
including how the count was reached and what it deliberately excludes, is in
this directory's README.
```

## `src/design-system/components/switch/Switch.jsx`

```
Promoted from `features/settings/.../ToggleSwitch` on 2026-08-21, which was
already correct — it was feature-owned only because the design system had no
switch, and so could not be imported by the Super Admin feature matrix, which
used a `Checkbox` instead and announced the wrong role.
```

## `src/design-system/icons/README.md`

```
The icon contract. Approved 2026-09-05.
```

```
## The medallion was on that list before it was true

**`StatusMedallion` joined that list on 2026-09-06, and the day it did not
belong on it is worth keeping.** Phase 4 wrote the sentence above as though it
were already true of every container that holds a glyph. Measured against the
CSS, only five carried a `> svg` rule; the medallion set its own diameter and
left the glyph to the call site. So every call site chose: 24 in the catalog and
in both patterns that render one, 28 in the signing room, 40 in the
locked-feature modal, 48 after a bulk upload. `PageState` and `ConfirmDialog`
each carried a comment admitting 24 was not a decision — it was what a bare
lucide glyph rendered before this contract existed.

Phase 7 found it, because a size that is not on the scale is exactly the signal
that a container is missing: sixteen of the thirty-two off-scale glyph sizes in
the whole application are one role — a large glyph announcing a page-level
state — wearing four different numbers.
```

```
Two lines in `glyphs.js`: import it aliased, export it wrapped. The registry
holds every name measured in use on 2026-09-05 and nothing speculative, so a
call site being migrated should never need one — but adding one is not an event.
```

## `src/design-system/icons/glyphs.js`

```
171 names, measured rather than curated: every identifier imported from
`lucide-react` anywhere in the tracked tree on 2026-09-05. Nothing was added
speculatively and nothing in use was left out, so lint can hold the rule
"no file outside the design system imports the package" without a single
call site needing a glyph this file does not have.
```

## `src/design-system/index.css`

```
It imports nothing from outside `src/design-system`. It used to end with

    @import '../shared/styles/designTokens.css';

commented "during the incremental migration". That file declared a second,
un-namespaced scale for colour, type, radius, shadow, spacing, z-index and the
focus ring, in forty-odd raw hexes — and by 2026-08-25 not one of its ~60
variables or six utility classes had a consumer left in `src/`. Its only live
rule was the global `prefers-reduced-motion` reset, which moved to
`utilities.css` where a decision every component inherits belongs.

Two guards now cover the hole it sat in: `tests/architecture.test.js` walks
CSS as well as JavaScript, so "no `shared` inside the design system" finally
covers the `@import` that had been evading it for the whole campaign, and
`check:ui-contract` scans stylesheets for raw colour and sub-12px type instead
of only JSX.
```

## `src/design-system/layouts/workspace/WorkspaceFrame.css`

```
The drawer is a drawer, not a dialog. It rendered at `--ds-z-modal` until
2026-09-05, which put it ABOVE every `<Modal>` — so a dialog opened while
the drawer was out rendered behind it, and nine `z-[60]`/`z-[70]`/
`z-[9999]` workarounds across the tree existed to climb over it.
```

## `src/design-system/patterns/README.md`

```
Still to come: form-field structure beyond `FormSection`, table toolbars and
filter panels, and responsive data presentation. Several are documented by
example in the catalog (`stories/patterns/`) without yet existing as components —
a story that hand-composes primitives with inline `style` is a pattern waiting to
be extracted, not a pattern that exists. `page-state` was exactly that until
2026-08-21.
```

## `src/design-system/patterns/modal/ConfirmDialog.jsx`

```
Added 2026-07-28 by the final-six-confirmations campaign. Before it, every
confirmation in the app was either a blocking `window.confirm` or one of eight
separately hand-written dialogs that each re-derived the same structure
(medallion, heading, description, Cancel/Confirm footer). This owns that
structure once.
```

```
Moved here from `shared/components/modals` on 2026-08-21, together with the
`Modal` it composes. It could not move alone: the design system must not
depend on `shared`, so a `ConfirmDialog` in `patterns/` importing a `Modal`
still in `shared` would have been the exact inversion the migration exists to
remove. `tests/architecture.test.js` now forbids that direction outright,
which was only possible once both had landed.
```

## `src/design-system/patterns/page-state/PageState.jsx`

```
@param {string} [props.className] Goes on the **state** element, never on the
  surface — so with the default `surface="card"` it lands *inside* the card.
  A width or margin belongs on a wrapper `<div>` around `PageState`, which is
  the shape `ErrorBoundary` has always used. Getting this wrong is not
  hypothetical: nine of the fifteen screens migrated on 2026-08-25 first
  passed `className="max-w-md"` here, which constrained the text inside a
  full-width card instead of narrowing the card, and it looks close enough to
  right that only reading the diff caught it. Every remaining prop goes to the
  surface instead (the `Card` for `card`, the state element for `bare` and
  `inverse`), which is where a caller's `id` or `aria-labelledby` belongs.
```

## `src/design-system/patterns/page-state/README.md`

```
Three different things are all called an empty state, and only one of them is
this pattern. Getting the scale wrong in either direction is why four panels in
this product were still hand-composed on 2026-08-25 — the pattern looked too
big for some of them, so nobody used it for any of them.
```

```
Nine of the fifteen screens migrated on 2026-08-25 were written the first way,
and the rendered result is close enough to correct that only reading the diff
caught it. The wrapper shape is the one `ErrorBoundary` has always used.
```

```
Fifteen of them were found in the product on 2026-08-25, several written *after*
this pattern existed. Nine were full-page status screens in the signing room and
the public application, and between them they had two title sizes, two medallion
sizes, icons at 28/32/40/48px and three different gaps under the medallion: five
appearances for one thing. Two more were page-level — a document-load failure and
a permissions boundary. Four were panel-level empties, two of which announced
nothing at all when a filter emptied the list. The guardrail is a review step,
recorded in roadmap §7 — if you are arranging primitives into this shape, use the
pattern.
```

## `src/design-system/stories/FileInput.stories.jsx`

```
The picker enforces `accept` on dropped files itself — the native dialog does
it for a picked one, and a drop inherits none of that — and since 2026-08-26 it
says so instead of returning in silence. The message is a `role="alert"`,
matching this system's rule that errors are assertive and everything else is
polite, and while it stands the input is `aria-invalid` and the message joins
its description. Any later selection clears all three.
```

## `src/design-system/stories/patterns/NativeTable.stories.jsx`

```
A frozen first column, which is the case that needs the contract's sticky rule:
the row paints the surface, not the cell, so a transparent frozen cell lets
the scrolled columns paint through it. Since 2026-09-06 the whole of it is one
attribute — surface, hover tint, stacking and the seam. Scroll this one
sideways.
```

## `src/design-system/stories/README.md`

```
Every story lives here. Four of them — `Modal`, `ConfirmDialog`, and the
modal-form and typed-confirmation patterns built on them — used to sit outside
this directory in `src/shared/components/modals`, colocated with primitives that
could not yet live in the design system. They moved in on 2026-08-21 with
`patterns/modal`, and `.storybook/main.js` lost the second glob it needed for
them.
```

```
**Baselines exist, and the lane blocks.** 172 pixel baselines are committed under
`e2e/visual/__screenshots__/`, and `npm run test:visual` has failed the build
since 2026-08-25 (`scripts/test-ci-plan.mjs` K1 asserts the step carries no
`continue-on-error`, so it cannot quietly go back to advisory). This paragraph
used to say the baselines did not exist, which would have sent the next
contributor to record work that was already done.

**The visible families are owner-approved.** On 2026-09-04 the owner approved the
semantic brand and action colours and confirmed WCAG 2.2 AA as the accessibility
target, which were the two open decisions the per-page statuses were waiting on.
```

## `src/design-system/stories/Introduction.mdx`

```
**The two decisions that held the visible families were answered on 2026-09-04.**
The owner approved the semantic brand and action colours as they stand and
confirmed WCAG 2.2 AA as the permanent standard, which were the last two items
holding the visible families; the roadmap now records both as standing rulings
(sections 1 and 6). A page still marked *Needs review* is now waiting on
something specific to itself, not on a palette or a standard nobody had signed
off.
```

```
**Every file in the application is on this contract** as of 2026-09-06 — the
migration drained 178 files and its backlog file was deleted, so the rule has no
exception list to add to. Where a container's real geometry cannot be expressed on
the scale (a 12px drag handle, a 128px logo frame), the container carries the size
and the arithmetic is recorded at the call site. See **Foundations → Icons**.
```

```
## Recently closed

Closed on 2026-08-21, so the exceptions that cited them are retired:

- **Tabs** (`TabList` / `TabPanel`). Nine screens had hand-rolled the tablist and
  seven had each written the same keyboard handler.
- **Switch** (ARIA `switch`), promoted from a feature-owned implementation that
  was already correct.
- **SegmentedControl**, retiring four `role="group"` / `aria-pressed` exceptions.
- **Disclosure**, for a collapsible section whose trigger sits inside a heading.
- **FileInput**, the picker contract four upload controls were waiting on.
- **Link / ButtonLink / IconButtonLink**. `external` is the reason: every
  external anchor in the product opened a new tab with no announcement. Do not
  hand-write `target="_blank"`.
- **EmptyState / ErrorState / LoadingState** in `@design-system/patterns`. This
  catalog used to document the composition and ask you to copy it, which is a
  component waiting to be written.

Closed on 2026-09-05:

- **Chip / ChipGroup**, the interactive twin of `Badge`: the same pill, the same
  12px semibold text, the same six tints, plus a pointer, a focus ring and a
  pressed state. It closed **two** recorded gaps that turned out to be one
  primitive — the filter chip and the tinted chip link. Six exceptions retired
  across four files, and one screen-reader repair on the way: the candidate
  list's pipeline strip had neither a group name nor `aria-pressed`.
- **`pressed` on Button and IconButton**, for a toggle that must keep its
  variant. It draws a fill and an inset ring at a specificity nothing
  feature-side can beat — which is the point, because the two sort arrows it was
  built for marked the active direction with a text utility that lost to the
  variant's own `color` rule, and lost silently.
- **SelectableCard**, for a block of record content that behaves as one option —
  an FMCSA suggestion row, a lead row, a company row, a page thumbnail. It closed
  a gap this catalog had recorded three times under three names, because the
  audit found one shape behind all of them. `selected` and `current` are two
  different ARIA answers that render identically on purpose, and passing both
  throws.
- **Avatar**, the disc standing for a person or an organisation. Its scale is not
  ours: all five steps are GitHub Primer's, which is also where the responsive
  `{ base, sm }` size and the circle-for-a-person/square-for-an-organisation rule
  come from. It is always `aria-hidden` with no way to opt out — five of the eight
  discs it replaced were announcing a bare initial beside the name it abbreviates.
- **`Input variant="inline"`**, a field inside running content rather than a
  form. It is deliberately *not* the published `InlineEdit` pattern — none of
  its consumers has a read view — and it refuses to render without a name,
  because it has no `FormField` wrapper to give it one.
- **`Disclosure variant="card"`**, a prominent titled section — leading slot,
  `heading-sm` title, a description line, a 24px chevron. It does *not* draw the
  card it is named for: `Card` owns the surface, and the variant only takes off
  the rail chrome that would fight it. `description` and `leading` throw on the
  rail; `meta` throws on a card.
- **`SectionNavigation` as a step rail**, four props from the page rail it
  already was: `currentType="step"` (what ARIA defines for a position in a
  process), a per-item `status` announced as part of the item's name rather
  than shown by colour, an optional `group.label`, and `frame="none"` for a
  rail inside a container that already draws one.
- **Notice**, the tinted message block — the most copy-pasted shape in the
  application, at 66 hand-built copies across 52 files. Every default in it is a
  number from that audit rather than a preference: `announce` is off because only
  26 of the 64 announce themselves today, and each tone's glyph is the one the
  application already reaches for. Six tinted blocks in the tree hold form
  controls instead of a message; those are regions, and this is not for them.
  Its **actions sit under the message**, the order Atlassian's `SectionMessage`
  and Polaris' `Banner` both use and the one the blocks it replaces already used
  2 to 1 — corrected after the first migration slice disagreed with the shipped
  placement, along with `titleAs` for the eight titles that are real headings.
- A raw `<button>` carrying `aria-pressed` or `aria-current`, a round disc
  holding a person's initial, and a `<button aria-expanded>` **inside a
  heading**, are refused from here on. That last scope is the whole rule: ten
  other live `aria-expanded` controls are menus, a combobox, a navigation group,
  a drawer and a filter toggle, and `Disclosure` replaces none of them. `SegmentedControl` and `Chip` are the toggle shapes, a `Button` with
  `pressed` is the third, and `SelectableCard` is the card. A step indicator that
  is read rather than operated has no primitive yet and is recorded as an open
  gap rather than demanded by a rule.

Closed on 2026-08-25:

- **`Button variant="link"`** — an action that reads as inline text. Six screens
  had written it by hand, in two font weights and three sizes between them. It
  is still a `<button>`, because it acts rather than navigates; use `Link` when
  the address bar changes.
- **Named brand colours** (`ds-brand-primary`, `ds-brand-accent`). The mark's own
  two colours were bare hexes in four places. The accent is for the inverse
  surface only — on a light one it is about 1.6:1.

Also closed on 2026-08-25, by **adoption** rather than by building anything:

- Every hand-rolled tab strip, toggle group and file picker in the product now
  uses `TabList`/`TabPanel`, `SegmentedControl` and `FileInput`. The primitives
  above had shipped on 2026-08-21 with zero, zero and two consumers while eleven
  tab strips, five toggle groups and nine raw file inputs stayed in the tree.
- Every status screen, panel-level empty and confirmation dialog uses
  `patterns/page-state` or `ConfirmDialog`. Fifteen states and six dialogs were
  still hand-composed out of the right primitives in the wrong shape, several of
  them written *after* the pattern existed.
- Every approved native `<table>` applies the `ds-native-table` contract, so a
  table that is not `DataTable` still gets `DataTable`'s header, divider, density
  and cell padding from the same `--ds-table-*` roles.

`PageState` gained three capabilities on the way, each because more than one
consumer had hand-written it: `titleId`, `children` and `focusOnMount`. Its
story page documents all three.

As of 2026-08-25 every remaining exception in the product carries a written
reason; none is left marked as migration debt. That does not make the gaps above
less real — an exception with a good reason is still a call site waiting for a
primitive.
```

## `src/design-system/tokens/README.md`

```
The `--ds-*` namespace was originally there to avoid colliding with the legacy
variables in `src/shared/styles/designTokens.css`. That file is **deleted** as of
2026-08-25 — not one of its ~60 variables had a consumer left — so the namespace
now serves only its second purpose: making a design-system token visible as one
at every call site. Tailwind exposes selected semantic tokens with `ds-`-prefixed
utilities.
```

```
**A token nothing references is deleted, not kept.** Fifteen had outlived their
consumers by 2026-09-05 — five palette steps, two duplicates of the brand
colours under an older name, two spacing steps, three type roles, a duration and
a z-index — and nothing noticed, because a token costs nothing to keep. That is
the problem: a vocabulary nobody prunes stops being a vocabulary and becomes a
list, and the next reader cannot tell which entry is live.
`tests/tokens.consumers.test.js` is what stops the next fifteen. It compares
whole names rather than substrings, and it does not count a **test** as a
consumer: a token asserted on only by a test is still dead in the product.
```

## `src/design-system/tokens/foundation.css`

```
iOS Safari zooms the viewport in when a focused input's font-size is under
16px, and does not zoom back out. Every step of the control scale is 13–15px,
so before 2026-08-25 every form in the product did this on an iPhone: the
page jumped on first focus and stayed magnified for the rest of the session.
The driver application felt it worst, being nine steps of fields filled
almost entirely on phones.
```

```
It exists because the corner affordances on a placed PDF field measured
14x14 — a 10px glyph in 2px of padding, well under the minimum. The owner
chose on 2026-09-05 to meet the minimum on the badge itself rather than
rely on 2.5.8's equivalent-control exception, which was available: every
placed field also has a conformant 36x36 Remove control in the field list.
That is a real cost, taken deliberately — on a 28x27 checkbox field a 24px
badge is nearly as wide as the field it sits on.
```

## `src/design-system/tokens/semantic.css`

```
Inverse (dark) surface role.
Added 2026-07-28 for console/log output surfaces, which the product renders
as dark monospace panels. Previously every such panel picked its own raw
`bg-gray-900` / `text-gray-300` pairing, and one of them measured 2.2:1.
The design system owns the role; features decide what text goes in it.
Every pairing below is pinned in `tests/tokens.test.js`.
```

```
The inverse family's hover step, completing the same base / subtle / hover
shape the light surfaces already have. Added 2026-08-25 for the login hero's
feature cards, which were hand-rolling `hover:bg-white/15`.
```

```
Brand.
Added 2026-08-25. The product has carried its two brand colours as bare
hexes since the beginning — in the logo SVG, the loader, the favicon and the
login hero — and the login hero is the one place they are used as *interface*
colour rather than inside artwork: an icon, a stat numeral, a chip. Naming
them stops the next branded surface re-typing `#0BE2A4` and getting it
slightly wrong.
```

```
Migrated on 2026-09-05 only where the value already matched, so this change
moves no pixels. The four sites that diverge — DataTable 0.45 and 0.5,
Switch 0.6, ChoiceControls 0.6 — are a deliberate visual normalisation and
belong in a slice that re-records the baselines they move.
```

## `src/features/company-admin/applicationPrep/ApplicationPrepEditor.jsx`

```
Two schema fields are not offered to the carrier at all (found 2026-10-01). The
Social Security Number is the driver's to give: a draft never holds one, so the
server discarded what a recruiter typed and the driver was asked for it anyway —
a box whose contents silently vanished. And the medical card's upload belongs to
the documents panel below; rendered by the schema it was a second, text-box copy
of the same field, reading "[object Object]".
```

## `src/features/company-admin/applicationPrep/ApplicationPrepWorkspace.jsx`

```
Split out of `StartApplicationPage` on 2026-09-10, when that screen and
`Started (unfinished)` became one workspace. This is the *task*; the worklist
around it is the *place*. `UnfinishedApplicationsPage` mounts one of these with
a `key` per target, which is what makes "one driver never leaks into the next"
structural rather than a reset somebody has to remember: a different driver is a
different component instance, so the answers, the documents and the minted link
cannot survive the move. `onExit` returns to the worklist, which reloads.
```

## `src/features/company-admin/applicationPrep/PreparedEmployersPanel.jsx`

```
## A locked row's identity is read-only HERE too, which it was not

The lock stores a snapshot of the row's identity, and this panel let the carrier
go on editing the very fields that snapshot is taken from. The two drifted, and
four ordinary edits produced an application the driver was blocked on at
submission and could not fix — the sharpest being a corrected NAME on a row
locked by USDOT number, which trips `locked-employer-changed` while the wizard
renders that identity as a record rather than a field, so the driver was blocked
on the one field they are not allowed to touch. Found 2026-09-08.

So the identity is a read-only display while the lock exists, and correcting it
means Unlock → correct → Lock, which mints a lock that matches. That is the same
rule the design system already states for a field its viewer may not change, and
the same shape the driver's wizard uses — the wording differs because the
audience does. The other half of the fix is `reconcileLockedEmployers`, for the
edit that leaves nothing to render: a deleted row.
```

## `src/features/company-admin/applicationPrep/prepActionPreflight.js`

```
Save and "Create the driver's link" were `disabled` whenever their
prerequisites were unmet, and nothing on the screen said what those were. The
link's real precondition was *"save first"* — `canMint` was
`Boolean(prep.applicantKey)`, which only a save sets — and that sentence
appeared nowhere at all. The precise message for the other one already existed
and was unreachable: `functions/companyApplications/prepare.js` says "Enter the
driver's email or phone first — it identifies the application", and the client
guard is what stopped anyone ever seeing it. Found 2026-09-08.
```

## `src/features/company-admin/applicationPrep/unfinishedRowActions.js`

```
`Started (unfinished)` and `Start an application` became one workspace on
2026-09-10, and the whole difficulty of merging them is that a row must NOT
behave the same everywhere. Four cases share one table:
```

```
A **Company Admin** may do all of that, and since 2026-10-06 also open every
row the driver has written to, correct its answers, and delete any row with
everything in it. That is the owner's decision, and the server holds it:
`getApplicationDraft`, `saveApplicationDraftEdits` and `purgeApplicationDraft`
answer only the strict admin check.
```

## `src/features/company-admin/components/CompanyBulkUpload.jsx`

```
Migrated 2026-07-27. Defects fixed, presentation only:

 1. The two assignment tiles were toggle `<button>`s whose selection was
    communicated by colour alone — now a real radio group.
 2. Each team member was a `<div onClick>` with a decorative check icon: no
    role, no accessible name, no checked state, and unreachable by keyboard.
    They are now real checkboxes.
 3. The distribution note used `text-[10px]`, below the 12 px floor.
 4. The repair action used a blocking `window.confirm`, which cannot be
    reached as page content and steals focus. It is now an accessible
    confirmation dialog with the same question, verbatim.
 5. Upload, import and repair failures used blocking `alert()`. They now
    render in place as `role="alert"` messages with the same text.
```

## `src/features/company-admin/components/FeatureDeactivationWarning.jsx`

```
Migrated to the design system 2026-07-28; it was a hand-built overlay found by
the repository-wide dialog scan.
```

## `src/features/company-admin/components/LeadAssignmentModal.jsx`

```
Launched from the company candidate list. Migrated to the design system
2026-07-28; it was a hand-built overlay found by the repository-wide dialog
scan.
```

## `src/features/company-admin/components/modals/VOEDocument.jsx`

```
Labels inside this faded block are text-slate-700, two steps darker than the
text-slate-500 the rest of the form uses, because the block renders at 80%
opacity: slate-500 blends to 3.25:1 here and slate-700 to 5.74:1. WCAG 2.2 SC
1.4.3 (AA, 4.5:1) has no exemption for legal small print — recoloured
2026-09-06 from slate-400 (2.56:1 / 2.07:1 faded), the audit's item 7.
```

## `src/features/company-admin/components/tabs/ActivityHistoryTab.jsx`

```
Migrated to the design system 2026-07-28. This was one of the four dossier tab
bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
and recorded as residual debt since.
```

## `src/features/company-admin/components/tabs/DQFileTab.jsx`

```
Migrated to the design system 2026-07-28. This was one of the four dossier tab
bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
and recorded as residual debt since.
```

```
`FileInput`, added 2026-08-21, closing the gap this call site used to
record as an exception. The picker's keyboard path and accessible
name are the primitive's; which file is selected and what happens to
it stay here.
```

```
The approved `ConfirmDialog` since 2026-08-25; hand-composed before that. The
pattern already wraps a long description in `[overflow-wrap:anywhere]`, which
is what the local `break-words` was for — a DQ file name can be one unbroken
string.
```

## `src/features/company-admin/layout/CompanySidebar.jsx`

```
Without it these twelve links rendered the browser's own
`auto 1px rgb(16, 16, 16)`: a black ring, in a product whose focus
colour is blue, on the most-tabbed element there is. The 2026-08-25
walkthrough fixed seven call sites with this defect and missed the whole
primary navigation of the company workspace; a keyboard walk in
`e2e/a11y.spec.cjs` is what found it, because axe cannot see the
difference between one focus ring and another.
```

## `src/features/company-admin/views/ImportLeadsPage.jsx`

```
Migrated 2026-07-27. Defects fixed, presentation only:

 1. This page has always passed `isEmbedded` to `CompanyBulkUpload`, but the
    prop was never consumed, so a full-screen modal overlay rendered on top of
    the page's own "Import Leads" header — the header was unreachable and the
    page behind the overlay was still in the tab order. The prop is honoured
    now, and the import surface renders in place.
 2. The access-denied state had no `<h1>` (only an `<h2>`), so a keyboard or
    screen-reader user landing on it heard an unnamed page, and its action was
    a raw `<button>`.
 3. Both states used hard-coded palette classes instead of `--ds-*` tokens.
```

```
The approved page-state pattern since 2026-08-25; this was a
hand-composed Card + medallion + heading + action. `announce`
```

## `src/features/company-admin/views/QuickAddLeadPage.jsx`

```
Migrated 2026-07-27. Defects fixed:

 1. **No field had an accessible name.** Every `<label>` was a bare element
    with no `htmlFor`, and no input had an `id`, so nothing was associated —
    a screen reader announced nine unlabelled edit boxes. `FormField` now owns
    the association.
 2. **The application-level required message was unreachable.** The inputs
    carried the native `required` attribute, so the browser blocked submission
    with its own bubble and `handleSubmit` never ran. The frozen message
    "Please fill in required fields (First Name, Last Name, Phone)." was dead
    code in any real browser. The form is now `noValidate` so the app owns
    validation: the same message is shown, the offending fields are marked
    `aria-invalid` with an associated error, and focus moves to the first
    invalid field. `required` / `aria-required` are still exposed for
    semantics, and the rule itself is unchanged.
 3. **Duplicate submission was possible.** `isSaving` is React state, so two
    fast activations inside one render could both pass the guard. A ref guard
    now closes that window.
 4. **No autocomplete tokens**, so browser autofill could not help.
 5. Hard-coded palette classes and a 2-column grid that did not reflow to the
    narrowest supported width are replaced by tokens and `ResponsiveGrid`.
```

## `src/features/company-admin/views/UnfinishedApplicationsPage.jsx`

```
To a recruiter, the answers, unless the carrier wrote them and the driver has
not yet touched them. *Open* appears only on the carrier's own rows, and what
comes back is the server's decision on every load, never this screen's. A
Company Admin may also open every application the driver has written to,
correct its answers (*Edit answers*), and delete any row with everything in it,
the same driver's other unfinished applications included — the owner's
decisions of 2026-10-06 and 2026-10-07, held by the server
(`getApplicationDraft`, `saveApplicationDraftEdits`, `purgeApplicationDraft`).
There is no Social Security Number to withhold — drafts never store one.
```

## `src/features/company-admin/components/tabs/DossierBodies.contract.support.jsx`

```
Contract freeze + a11y proof for the three dossier tab bodies migrated on
2026-07-28: `DQFileTab`, `ActivityHistoryTab` and `NotesTab`.

All three were deliberately left unmigrated by the 2026-07-27 dossier
foundation slice ("DQ, PEV/VOE, Activity and Notes bodies are deliberately not
migrated") and recorded as residual debt since. PEV/VOE was closed separately.
```

## `src/features/company-admin/components/tabs/PEVTab.contract.support.jsx`

```
It was that way because `handleFinalSend` and `handleUploadResult` took a
shallow `[...employers]` copy and then mutated the employer objects inside it —
the very objects handed in through `appData` — so a shared fixture carried one
test's "Sent" status into the next. That in-place mutation of a prop is gone as
of 2026-09-09: `writeVerification` re-reads the document and replaces the row,
so nothing reaches back into the prop. The factory stays, because a fixture
shared between tests is a bad idea whether or not anything mutates it.
```

## `src/features/settings/components/IntegrationsTab.jsx`

```
Migrated to the design system 2026-07-27. This is a PRESENTATION-ONLY
migration: every SDK-load, login, Graph API, and callable contract recorded
in the 2026-07-23 Integrations deep-audit (NO-GO) is unchanged, and no
Cloud Function, rule, or data shape was touched.

The 2026-07-23 audit found a **tenant-binding defect** in
`connectFacebookPage`: it derived the tenant from `request.auth.uid` rather
than the company's Firestore document id, so connected leads ingested to
`companies/{uid}/leads` — a tree belonging to no company. **Fixed 2026-08-25**
in `functions/integrations/facebook.js`: this component now sends `companyId`
and the callable authorizes it against the caller's per-company role. Sending
it is not the same as being trusted with it — the server re-checks, and a
company admin naming a company they do not administer is rejected.

The feature is still **switched off** and the "not production-ready" notice
below stays. The fault is corrected; the workflow has still never run
end-to-end against a real Facebook page in production.
```

```
Still true after `content-muted` moved to slate-600 on
2026-08-21: the token now has more headroom, but `opacity` on an
ancestor composites every descendant toward the background
regardless of how much contrast the token started with.
```

## `src/features/settings/components/NumberAssignmentManager.jsx`

```
Migrated to the design system 2026-07-27, closing the debt recorded by the
2026-07-23 deep-audit ("Company Settings SMS / number-assignment deep-audit
log (NO-GO)"): unlabelled per-row and default-line selects, `text-[9px]`/
`text-[10px]` status text, and color-only status dots. Presentation only —
every Firestore/callable contract that audit froze is unchanged:
`saveSmsLineAssignments`/`verifyLineConnection` payloads, the stable
line-token model (never raw phone values as `<select>` option values), the
`sms_provider` doc shape, the roster resolution, and the one-time legacy
token backfill. `useLineAssignments.js` and `utils/linePhone.js` are
untouched.
```

## `src/features/settings/components/SMSDiagnosticModal.jsx`

```
Migrated to the design system 2026-07-27. The previous overlay was a bare
`fixed inset-0` div with no dialog semantics (no focus move/trap/restore,
no Escape) and its close control was icon-only with no accessible name;
both now come from the approved accessible `Modal`. The sender `<select>`
had a visually adjacent `<label>` with no `htmlFor`/`id` pairing, so it was
never programmatically associated — now a `FormField`. Every
`verifySmsConfig`/`sendTestSMS` payload, guard, and message is unchanged.
```

## `src/features/settings/components/number-assignment/AssignmentRow.jsx`

```
The row stays a real `<tr>` (not the approved `DataTable`): editable
per-row `<select>`s and verify actions are outside `DataTable`'s proven
display-table contract, per the 2026-07-23 deep-audit; see
`NumberAssignmentManager.jsx` for the full rationale.
```

```
Since 2026-09-06 (audit step K) the row is also a card on a phone: every
`<td>` names its column in `data-label`, and the roles are stated explicitly
so the table semantics survive `display: block` — see `AssignmentTable.jsx`.
The hand-written hover tint is gone with it: the contract reserves a hover
for rows that activate, and a matrix of form controls has no row activation.
```

## `src/features/settings/components/number-assignment/AssignmentTable.jsx`

```
Presentation only — row data and callbacks pass straight through to
`AssignmentRow`, unchanged. This stays a real native table rather than the
approved `DataTable`: every cell here is an editable per-row form control
plus a verify action, which is outside `DataTable`'s proven display-table
contract (see the 2026-07-23 deep-audit referenced in
`NumberAssignmentManager.jsx`). It carries `ds-native-table` as of 2026-08-25,
so its header, divider, density and cell padding come from the same
`--ds-table-*` roles `DataTable` reads instead of from three hand-picked
paddings. Column headers carry `scope="col"`, a `<caption>` names the table
for assistive tech, and the table sits in a labelled, keyboard-focusable
scroll region.
```

```
On a phone it is one card per team member (audit step K, 2026-09-06). This
matrix is worked one member at a time — nothing in it is compared across
rows — so under 768px `data-mobile-presentation="cards"` stacks each row
with every value under the label of its column (`data-label`, written here in
the feature's own words), instead of putting a `<select>` and its verify
action 400px apart in a sideways-scrolling form. Above 768px the table is a
table, with its first column pinned (`data-pin-first-column`) for the widths
where it still scrolls. The table roles are stated explicitly on every
element because `display: block` can drop the implicit ones — redundant
while it is a table, load-bearing while it is cards. Same DOM at every width,
so the frozen 15-case suite and the a11y suite cover both.
```

## `src/features/signing/EnvelopeCreator.jsx`

```
The Firebase persistence paths — the "Correct"/"Edit Template" hydration
and the save/send action — live in utils/envelopePersistence.js since the
2026-09-01 source-size split. State stays here; the module gets setters.
```

```
The editing spine split out on 2026-09-01 (SG-1b): history/save state and
the single write path, the field-mutation handlers, and the keyboard
clipboard — see each hook's header for what moved.
```

```
And the SG-1c split: the document/viewport controls, the AI-suggestion
review workflow, and the arrangement itself.
```

```
The placed-field array, the undo/redo stack and the save state — with
`commitFields`, the single write path — live in useEditorHistoryState
since the 2026-09-01 source-size split (SG-1b).
```

```
The PDF itself and how it is shown — file, page count, visible page,
page refs/dimensions, viewport width with wheel zoom and the fit
handlers, and the upload picker with its size ceiling — live in
useEnvelopeDocumentControls since the 2026-09-01 source-size split
(SG-1c).
```

```
The AI-suggestion review workflow — the scan dialog, the panel, the
selected suggestion, the one-level apply undo, and every handler around
useAiFieldAssistant — lives in useAiSuggestionWorkflow since the
2026-09-01 source-size split (SG-1c).
```

```
Ctrl/Cmd undo/redo and field copy/paste live in
useFieldClipboardShortcuts since the 2026-09-01 source-size split
(SG-1b); the listener still registers once and reads through these refs.
```

```
Every field mutation — add/remove/move/resize/label/property plus the
align/match/duplicate/copy-to-pages bulk tools and the visual drag
guides — lives in useEnvelopeFieldEditing since the 2026-09-01
source-size split (SG-1b). All of it still routes through commitFields.
```

```
The arrangement — top bar, three-column desktop layout, compact bottom
bar and sheets, preview/scan dialogs, and the leave-without-saving
confirmation — lives in EnvelopeCreatorLayout since the 2026-09-01
source-size split (SG-1c).
```

## `src/features/signing/SigningRoom.jsx`

```
The document viewport — pdf.js wiring, page stack, painted-page gating,
fit-width math and the load-error/retry state — lives in
SigningDocumentView.jsx since the 2026-09-01 source-size split. This room
keeps the signer interaction handlers and passes them down.
```

## `src/features/signing/components/EnvelopeHistory.jsx`

```
Action hierarchy (2026-07-29 redesign): every row is activatable and opens
the details dialog, and the Actions column holds exactly one status-specific
quick action — Download when signed, Copy Link when sent, Review/View
details otherwise. Correct and Void moved out of the rows into the details
dialog; their callable/Firestore contracts, confirmation dialog, toasts and
per-document busy states are unchanged.
```

## `src/features/signing/components/envelope-creator/AiScanOptionsDialog.jsx`

```
The approved `Input`, since 2026-08-25. It was a
hand-built field with its own border, radius, inline
padding and 44px min-height — a second field contract
that happened to resolve to the same numbers, and one
the contract scanner could not see because its
`className` came after an arrow function.
```

## `src/features/signing/components/envelope-creator/EditorInspector.jsx`

```
The strip is `TabList` from the design system. It used to be a hand-built
WAI-ARIA tablist — roving tabindex, arrow/Home/End arithmetic, `aria-selected`,
`aria-controls` — recorded as a feature-owned exception "because the design
system has no approved Tabs primitive". It has had one since 2026-08-21; the
exception outlived its reason by four days and the whole keyboard model with
it. `fitted` is what reproduces the two half-width tabs.
```

## `src/features/signing/components/envelope-creator/EnvelopeCreatorLayout.jsx`

```
The envelope editor's arrangement, split out of `EnvelopeCreator.jsx` on
2026-09-01 for the source-size standard (SG-1c). JSX verbatim from the
component's return: the top bar, the three-column desktop layout, the
compact bottom bar with its one-sheet-at-a-time presentation, the preview
and scan dialogs, and the leave-without-saving confirmation. Purely
presentation-owned state lives here (which sheet is open, whether preview
or the close confirmation is showing); every document mutation arrives
through props. The compact editor is a different arrangement, not a
different editor — both layouts render the same components with the same
prop bundles the component builds.
```

## `src/features/signing/components/envelope-creator/EnvelopeSidebar.jsx`

```
The design system's `Disclosure` since 2026-08-25. It was a raw `<button>`
inside an `<h3>`, recorded as a temporary exception because "the approved
Button's padding and inline layout cannot express" an edge-to-edge trigger with
a rotating affordance inside a heading — all true, and the reason `Disclosure`
was built on 2026-08-21 naming this component as its consumer. The exception
outlived its own fix by four days.
```

```
The picker below renders only while `!file`, so a mixed drop — a PDF this
accepts plus something it does not — hands `handleFileChange` the PDF, the
branch flips, and `FileInput`'s own rejection alert is unmounted in the
commit that created it. Found in review on 2026-08-26. `onReject` fires
after `onChange`, so this lands last and survives the swap.
```

## `src/features/signing/components/envelope-creator/ResizableDraggableField.jsx`

```
The exception this replaced said retiring it "needs a compact
icon-button size in the design system". It has one: `xs` is 24px,
the WCAG 2.2 SC 2.5.8 minimum, and the badge was 14x14.

That minimum was reachable two ways. Every placed field also has
a conformant 36x36 Remove control in the field list, which is
exactly the equivalent-control exception 2.5.8 allows — so the
badge could have stayed small with that written down. The owner
chose on 2026-09-05 to meet the minimum on the badge itself, and
the cost is real and visible: on a 28x27 checkbox field a 24px
badge is nearly as wide as the field it sits on. The offset moves
from -8px to -12px so the larger disc still straddles the corner
rather than covering the field's contents.
```

```
The HANDLE is a 24x24 pointer target centred on the field's
corner (`-bottom-3 -right-3 h-6 w-6`) — the WCAG 2.2 SC 2.5.8
minimum, met on 2026-09-06 the way the badge on the opposite
corner meets it: half the box over the page, half over the
field, so its footprint inside the field is the 12x12 it
always was. The glyph sits in the box's top-left behind 2px of
padding, which is where it has always drawn. 10px is the
glyph's geometry rather than a size somebody picked: the
scale's smallest step is `xs` = 12 and would outgrow the
corner, so it goes on the container, where resizing the
handle carries it.
```

## `src/features/signing/components/signing-room/SigningDocumentView.jsx`

```
The signing room's document viewport, split out of `SigningRoom.jsx` on
2026-09-01 for the source-size standard. Everything about *showing* the PDF
lives here: the pdf.js wiring and worker setup, per-page aspect tracking,
the painted-page gate that keeps overlays inert on slow connections, the
load-error/retry state, and the fit-width math. The room keeps the signer
interaction handlers (change/focus/advance/signature) and passes them down,
along with `pageRefs`, which its scroll-to-field navigation reads.
```

```
The approved page-state pattern since 2026-08-25; this was
a hand-composed Card + medallion + heading + retry.
```

## `src/features/signing/components/signing-room/StatusScreens.jsx`

```
**2026-08-25: the four status screens are the approved page-state pattern.**
They had been hand-composed `Card` + `StatusMedallion` + heading + body +
actions — which is what `PageState` is, built later and never applied here. The
cost was measured: across these four and the five in `PublicApplyScreens`, one
kind of screen had `heading-sm` and `heading-md` titles, default and `lg`
medallions, icons at 28/32/40/48px, and three different gaps under the
medallion. Five appearances for one thing. The pattern owns all of that now, so
the feature keeps the words, the tone, the icon and the actions — and the
screens cannot drift apart again.
```

## `src/features/signing/hooks/useAiSuggestionWorkflow.js`

```
The envelope editor's AI-suggestion review workflow, split out of
`EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1c).
Wraps `useAiFieldAssistant` and owns the review state around it — the scan
dialog, the panel, the selected suggestion, and the one-level apply undo.
Suggestions live entirely inside the assistant until the reviewer applies
them; nothing here can save a template or send a document, and the ONLY
path from suggestion to real field still appends through `commitFields`.
Bodies verbatim from the component; the inspector tab stays in the
component, which passes its setter in.
```

## `src/features/signing/hooks/useEditorHistoryState.js`

```
The envelope editor's undo/redo spine, split out of `EnvelopeCreator.jsx`
on 2026-09-01 for the source-size standard (SG-1b). This hook owns the
placed-field array, the history stack and the save state, and exposes the
single write path (`commitFields`) every mutation must go through. Bodies
verbatim from the component. Selection stays in the component; `stepHistory`
prunes it through the `setSelectedFieldIds` the component passes in.
```

## `src/features/signing/hooks/useEnvelopeDocumentControls.js`

```
The envelope editor's document and viewport controls, split out of
`EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1c).
This hook owns the PDF itself and how it is shown: the selected file, the
page count, which page is visible (IntersectionObserver), the page refs and
dimensions, the viewport width with its wheel-zoom and fit handlers, and
the upload picker with its size ceiling. Bodies verbatim from the
component; field placement and history stay outside and reach the document
only through the values returned here.
```

## `src/features/signing/hooks/useEnvelopeFieldEditing.js`

```
The envelope editor's field-manipulation handlers, split out of
`EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1b).
Everything here is a mutation of the placed-field array routed through the
history hook's `commitFields`, plus the purely visual drag guides. Bodies
verbatim from the component; `file`, `activePage` and `selectedFieldId` are
hook arguments now, and each useCallback keeps its original dependency list
with those names unchanged.
```

## `src/features/signing/hooks/useFieldClipboardShortcuts.js`

```
The envelope editor's keyboard shortcuts — undo/redo and field copy/paste —
split out of `EnvelopeCreator.jsx` on 2026-09-01 for the source-size
standard (SG-1b). The listener is registered once on mount and reads
everything through the refs the component (and its history hook) passes in,
exactly as it did in place; the clipboard ref lives here because nothing
else reads it. Bodies verbatim.
```

## `src/features/signing/utils/envelopePersistence.js`

```
The envelope editor's Firebase persistence paths, split out of
`EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard. Two
functions, both React-free, bodies verbatim from the component:
```

## `src/features/super-admin/components/BackfillEmployersDialogs.jsx`

```
The approved `ConfirmDialog` since 2026-08-25. Hand-composed before that, and
the odd one out even among the ten hand-composed confirmations: it had no
medallion, putting the warning icon *inside* the heading instead, so the same
kind of question looked different here than anywhere else. It also lost what
the pattern adds — initial focus on Cancel rather than on a live-data rename,
and a synchronous guard against a double activation.

The confirm label drops its `Wrench` icon: no other confirm in the product has
one, and the pattern's `confirmLabel` is words. Backdrop dismissal is off, which
this dialog did not set — a stray click beside a live-data rename should not
decide anything.
```

## `src/features/super-admin/components/CompaniesView.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
`companies/{id}/integrations/sms_provider` enrichment read, the
`updateDoc(companies/{id}, { isActive })` toggle, the name/slug/id search, the
client-side 20/50/100 pagination, the `loadMore('companies')` database
pagination, and every frozen string are unchanged.
```

```
A real button so keyboard users can open a
company at all — and `Button variant="link"`
since 2026-08-25, rather than a seventh
hand-written "action that reads as text".
```

```
The approved `ConfirmDialog` since 2026-08-25; hand-composed before that, with
the warning icon *inside* the heading rather than a medallion. The two tones
reproduce the two confirm variants exactly — the tone map pairs `danger` with a
danger-styled confirm and `info` with a primary one — so deactivating is still
red and re-activating is still blue, and the icon now differs between them
(a warning versus a question) rather than being a warning for both.
```

## `src/features/super-admin/components/CreateView.jsx`

```
Migrated to the design system 2026-07-28. Presentation only. Frozen and
```

## `src/features/super-admin/components/DashboardHeader.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — `setSearchQuery`
still receives the raw input value on every keystroke (the 600 ms debounce and
the >= 2 character rule live in `useSuperAdminData`), the clear control still
sets `''`, and `onBackfillEmployers` / `onLogout` are called with no arguments
exactly as before. The `logout-button-super` id is preserved because existing
selectors depend on it.
```

## `src/features/super-admin/components/DashboardView.jsx`

```
Super Admin landing view: the platform-wide counts — companies, users,
applications and leads, each its own count (`stats.companyCount` / `userCount`
/ `appCount` / `leadCount`). "Total Applications" read the leads' count until
2026-10-14, and a count that failed read 0; each now shows "Error" from its
own flag (`statsError.<field>`), with the "..." placeholder while loading.
```

## `src/features/super-admin/components/FeaturesView.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
`features.{key}` / `featureSchedules.{key}` update shapes, the "clear the
schedule when a feature is toggled manually" rule, the ISO-string schedule
value, the missing-field / invalid / past-date validation order, the
`feature_alerts` aggregation by `userEmail || userId || 'Unknown'`, the five
feature keys and their order, and every toast string are unchanged.
```

```
These cells are `Switch`, not `Checkbox`, as of 2026-08-25. They were
checkboxes only because the design system had no switch when this view was
migrated, and a checkbox announces a value you set and then submit. Toggling
one here writes to Firestore immediately, so "checkbox" was the wrong role for
what the control actually does. `Switch` closed that gap and this is the call
site the roadmap recorded against it.
```

## `src/features/super-admin/components/GlobalSearchResults.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the three
result groups and their order, the per-group counts, the total count, the
`allCompaniesMap.get(app.companyId) || 'Unknown Company'` fallback, the
`app.status || 'New Application'` default, the callback shapes
(`{ id, name }` to `onViewApps`, bare id to `onEditCompany`, `{ id }` to
`onEditUser`, the whole app object to `onAppClick`) and every frozen string
are unchanged. The search query itself is owned by `useSuperAdminData`.
```

## `src/features/super-admin/components/HistoricalMigrationPanel.jsx`

```
The approved pattern since 2026-08-25. This was a hand-composed
`Modal` body reproducing the medallion/heading/description/footer it
owns — one of six in the product, which between them had two
confirm-button variants for the same amber medallion and one dialog
with no medallion at all. The tone map decides that once: `warning`
pairs with a danger-styled confirm, which is the right pairing for an
action that writes permanent, immutable records across every company.
The confirm button therefore changes from primary to danger here.
```

## `src/features/super-admin/components/ScheduleDeactivationDialog.jsx`

```
Split out of `FeaturesView.jsx` on 2026-09-06 (audit step K), when labelling
the alert-stats table's scroll region took that file past the 500-line
maximum. This dialog is the one piece of that file with no table in it, so
moving it changes no design-system inventory: the two approved raw tables
stay where the allowlist records them. Behaviour is unchanged.
```

## `src/features/super-admin/components/StatsBackfillPanel.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
`backfillCompanyStats` and `backfillAllStats` callable names, their
`{ timeout: 540000 }` option, the `{ companyId, dryRun }` and `{ dryRun }`
payloads, the `companyId.trim()` transformation, the "Please enter a Company
ID" guard, the result field precedence and every frozen string are unchanged.
```

```
The approved `ConfirmDialog` since 2026-08-25; this was a hand-composed `Modal`
body reproducing the structure that pattern owns. It gains initial focus on
Cancel rather than on a nine-minute irreversible write, and a synchronous guard
against a double activation of that write.
```

## `src/features/super-admin/components/SuperAdminSidebar.jsx`

```
Migrated to the approved `SectionNavigation` primitive 2026-07-28.
Presentation only — `setActiveView` still receives the exact
`SUPER_ADMIN_VIEWS` value for each item, item order and grouping are
unchanged, and selecting an item still clears the global search first.
```

```
An unrecognised icon name used to resolve to `undefined` and render
nothing, which does not fail — it collapses the row to zero width and
breaks the label one character per line. Caught by the visual gate on
2026-08-29 after a new entry named an icon this map did not import.
Failing loudly here costs nothing and is findable; the silent version
was neither.
```

## `src/features/super-admin/components/SystemHealthView.jsx`

```
The Deep Diagnostic (it created test users and records in the live database
with a fixed password), "Sync Backend Structure" (it wrote schema defaults into
every live record missing a field) and the one-off SMS history backfill were
removed on 2026-10-11, and the server callables behind them on 2026-10-15.
```

## `src/features/super-admin/components/UsersView.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
name/email search, the client-side 20/50/100 pagination, the
Super Admin precedence over memberships (`isSuperAdmin`), the
`mem.role === 'company_admin' ? 'Admin' : 'User'` label rule, the
`allCompaniesMap.get(...) || "Unknown"` fallback, the `{ id }` /
`{ id, name }` callback shapes and every frozen string are unchanged.
```

## `src/features/super-admin/components/driver-list/UnifiedDriverListParts.jsx`

```
The approved `ConfirmDialog` since 2026-08-25. Hand-composed before that, and
it carried the severity **in the heading's colour** — `text-ds-status-danger-fg`
on the title, with no medallion — which is status by colour alone on the most
destructive action in the product. The pattern's danger medallion carries it
instead, the wording is untouched, and initial focus lands on Cancel rather
than on "Permanently delete".
```

## `src/features/super-admin/components/integrations/AddLineModal.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the
`usePerLineCredentials` / `needsCredentials` logic, the initial
`isSandbox: true`, the `testLineConnection` and `addPhoneLine` callable names
and payload shapes (including omitting credentials when not needed and the
`label || phoneNumber` fallback), every validation guard and its wording, and
the success/verify toasts are unchanged (frozen in
`AddLineModal.contract.test.jsx`).
```

## `src/features/super-admin/components/integrations/IntegrationManager.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — every contract
frozen in `IntegrationManager.contract.test.jsx` is unchanged: the
```

## `src/features/super-admin/components/integrations/LineManager.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — the real-time
listener on `companies/{id}/integrations/sms_provider`, the
`inventory`/`hasCredentials`/`defaultPhoneNumber` mapping, the phone number as
the stable line identity used for removal, the `removePhoneLine({ companyId,
phoneNumber })` payload, the success / cleared-assignments / failure toast
wording, and the `hasCredentials` handed to `AddLineModal` are all unchanged
(frozen in `LineManager.contract.test.jsx`).
```

```
The approved `ConfirmDialog` since 2026-08-25; hand-composed before that, and
without a medallion, so this destructive question looked different from the
ones that had one. The pattern also puts initial focus on Cancel rather than on
"Remove line" and guards `onConfirm` against a double activation.
```

## `src/features/super-admin/components/modals/DeleteCompanyModal.jsx`

```
Migrated to the approved accessible `Modal` 2026-07-28. Presentation only — the
`deleteCompany` callable name and its `{ companyId }` payload, the
`onConfirm()` → `onClose()` order, and every frozen string are unchanged.
```

## `src/features/super-admin/components/modals/DeleteUserModal.jsx`

```
Migrated to the approved accessible `Modal` 2026-07-28. Presentation only — the
`deletePortalUser` callable name and its `{ userId }` payload, the
`onConfirm()` → `onClose()` order, and every frozen string are unchanged.
```

## `src/features/super-admin/components/modals/EditUserModal.jsx`

```
Migrated to the approved accessible `Modal` 2026-07-28. Presentation only — the
`users/{userId}` read, the `companyId || Object.keys(allCompaniesMap)[0] || null`
fallback passed to `EditUserNameForm`, and the `onSave` wiring into both
children are unchanged. The `edit-user-modal` and `edit-user-close-btn` ids are
preserved because existing selectors depend on them.
```

## `src/features/super-admin/components/users/EditUserNameForm.jsx`

```
Migrated to the design system 2026-07-28. This file was missed by the Super
Admin dialog pass: `EditUserModal`'s own shell was migrated, but the two
bodies it renders — this form and `UserMembershipsManager` — were still fully
legacy.
```

```
Defects fixed:
 1. **Two blocking `window.confirm` guards** (password reset, delete user) →
    shared accessible dialogs, wording preserved verbatim.
 2. **Four blocking `alert()` calls** carried the reset and delete outcomes →
    announced in-page messages, wording preserved verbatim. A destructive
    delete previously reported success only through a modal alert.
 3. **The save message was colour-only** — red or green text with no role, so
    a screen-reader user got no confirmation that a save succeeded or failed.
    It is now a `FieldMessage` in a live region, and the tone is secondary to
    the text.
 4. Raw inputs with `focus:ring-blue-500`, raw buttons, `bg-orange-50` /
    `bg-red-50` action tints and a hand-built `Loader2` spinner replaced by
    `FormField`/`Input`/`Button` and the primitives' own loading state.
 5. **A local component called `ConfirmDialog`** — the same name as the
    approved pattern, shadowing it in this file (fixed 2026-08-25). It
    reproduced the medallion/heading/description/Cancel-Confirm structure the
    pattern owns, and lost two things that are not cosmetic on "Delete this
    user?": initial focus lands on **Cancel** rather than on the destructive
    action, and `onConfirm` is guarded by a synchronous ref, so two activations
    dispatched inside one React render cannot both fire the callable.
```

## `src/features/super-admin/components/users/UserMembershipsManager.jsx`

```
Migrated to the design system 2026-07-28, alongside `EditUserNameForm`. Both
were missed by the Super Admin dialog pass, which migrated `EditUserModal`'s
shell but not the bodies it renders.
```

```
2026-08-25: this was a hand-composed confirmation inside the approved `Modal`
— the medallion, heading, description and Cancel/Confirm footer that
`ConfirmDialog` owns, rebuilt here. It is the approved pattern now, which also
puts initial focus on Cancel rather than on "Remove access" and guards
`onConfirm` against a double activation. `loading` is not passed: `confirmRemove`
closes the dialog before the delete starts, and the row shows the progress.
```

## `src/features/super-admin/views/AnalyticsView.jsx`

```
Migrated to the design system 2026-07-28. Presentation only — `useAnalytics`
is untouched, the `7d`/`30d`/`90d` range values, the CSV export column order,
header text, filename patterns (`recruiter_performance_{range}.csv` /
`company_performance_{range}.csv`), the top-5 slices, the `callsMade > 20`
High/Low rule, and every frozen string are unchanged.
```

## `src/app/routes/StartApplicationRedirect.jsx`

```
`Started (unfinished)` and `Start an application` became one workspace on
2026-09-10 — see `UnfinishedApplicationsPage` for why they were separate and why
merging them changed no permission. Starting an application is now the primary
action *inside* that workspace, so this path has no screen of its own.
```

## `src/app/routes/companyRouteManifest.js`

```
Its own item rather than a tab on Applications, because an unfinished
application is not a submitted one: nothing is signed, no consent has been
given and no snapshot exists. Mixing them into the ATS funnel would mean
statuses, assignment and exports treating a half-typed form as a candidate
record the applicant never agreed to file. That separation is a rule; the
one below was not.

ONE destination for unfinished work, as of 2026-09-10. This used to sit
beside a second item, `Start an application`, and a carrier-prepared draft
appeared under both — so a recruiter had to know which page answered which
question about the same application. Starting one is now the primary action
inside this workspace. Not `adminOnly`: a recruiter with a driver's
paperwork in hand is exactly who starts one, and nothing it produces is
filed — the driver still completes and signs it — so the bar is
company-workspace access, as it is for the dossier.
```

## `functions/ai/providers/gemini.js`

```text
Measured against the live API on 2026-08-03 with `gemini-3.6-flash`: a
one-word answer consumed 83 thought tokens at the default thinking level and
58 at `thinking_level: low`. A 16-token budget produced 13 thought tokens,
zero output tokens and `status: "incomplete"` — the model never got to
answer. Real prompts reason more than a one-word reply does, so the headroom
is set well above the measured figures rather than at them.
```

```text
An image is a content entry of `type: 'image'` carrying `mime_type` and
base64 `data` as *sibling* fields — not nested, and not a `data:` URL, which
is why the caller's data URL is split. Verified live on 2026-08-03 against
`gemini-3.6-flash`, which read an 8×8 red PNG and answered "Red".
```

```text
This originally read a top-level `output` array, which the API does not
return. Every Gemini call therefore failed as `malformed_response` — the
model answered correctly and the adapter could not see it. Verified against
the live API on 2026-08-03.
```

```text
A plain string, not `{ parts: [{ text }] }`. The Interactions API
rejects the parts form outright:
  400 "The value is invalid for 'system_instruction'.
       Expected string, unexpected character: '{'"
The parts form is the `:generateContent` convention, which is
where this came from. Verified live on 2026-08-03.
```

## `functions/ai/providers/groq.js`

```text
Groq's catalogue is now reasoning-first: `openai/gpt-oss-*` think before
answering and charge that thinking against `max_output_tokens`. Measured
against the live API on 2026-08-03, `openai/gpt-oss-120b` asked for a
one-word answer inside 32 tokens returned `status: "incomplete"`,
`incomplete_details.reason: "max_output_tokens"`, and a single `reasoning`
output item — no answer at all.
```

## `functions/ai/providers/http.js`

```text
Mistral's free plan answers its Medium and Small models with
`x-ratelimit-limit-req-minute: 0`; Gemini's free tier answers its Pro models
with a quota error stating `limit: 0`. Both measured 2026-10-07. The header
must be the literal `0`: a missing header is not a zero, though `Number(null)`
is. The body is read for that one token and nothing leaves this function but
the boolean.
```

```text
Only a row's own `versionRefusalCodes` count, the way only its own
`quotaDetection` decides a quota: Mistral answers a paid-only model with
`403 code: "1910", type: "tier_not_allowed"`, a Labs model with
`403 code: "1913", type: "labs_not_enabled"`, and a model id it no longer
knows with `400 type: "invalid_model"` (2026-10-07). Every other 403 is still
a rejected credential and every other 400 a rejected request. Both fields are
checked, because `extractVendorCode` keeps only the first.
```

## `functions/ai/registry/modelCandidates.js`

```text
Mistral says which models read images. Dated names only; the Ministral
family first, because a free key can call it (Medium and Small had a
limit of zero on the free plan on 2026-10-07).
```

## `functions/ai/registry/modelVersions.js`

```text
Every text entry verified against the live Groq API on 2026-08-03 for
both plain text *and* `json_schema` structured output.

The previous values were wrong, behind a comment claiming they were
"pinned to the models the production CDL and E-Doc paths already use".
That was true only of the two vision models, and both had since been
withdrawn. The text models were never used in production by anything.

`llama-3.3-70b-versatile` and `llama-3.1-8b-instant` are rejected
outright for structured output:

  400 "This model does not support response format `json_schema`."

Groq's health check sends plain text with no schema, so it passed while
every schema-using task — article generation, topic selection, CDL
extraction, E-Doc placement — failed. That is what produced
`failed_generation (all_providers_failed)` in production.

`qwen/qwen3.6-27b` was rejected the same way. `openai/gpt-oss-20b`
answered both shapes correctly and leads every text lane.

`openai/gpt-oss-120b` is its spare. In August it burned so much
reasoning budget that a small plain text request came back
`status: incomplete`; on 2026-10-07 it answered the 16-token text
probe, the JSON probe and the claim check, and wrote a 390-word
article in 5s on the same request `openai/gpt-oss-20b` failed with
`400 json_validate_failed`. It has its own per-minute allowance, so a
rate-limited 20b does not take it down too.
```

```text
Groq's only multimodal model, one lane among several rather than
anything SafeHaul depends on: 131k context, three images per
request, and about 1,800 input tokens a photo against the free
tier's 7,000 input tokens a minute. Verified 2026-10-07. No spare:
Groq offers no other model that reads images.
```

```text
`gemini-3.5-flash-lite` is the spare for photos and structured text: on
2026-10-07, while the Flash versions answered 503 "high demand", it read
the fake licence in full on one and two photos and answered the claim
check, in about 2s — though 13-16s an hour earlier, which is why an
overloaded vendor's spares are left to work that has the time. It is not an article spare — it rejects the article
request with `400 invalid_request` — so articles keep one version.
`gemini-3.5-flash` answered 503 to every check that day, so it is not
listed until it can be verified.
```

```text
Was `@cf/meta/llama-3.1-8b-instruct`, which the Workers AI
catalogue now marks deprecated. Folded into the same model as the
other lanes rather than pinning a second one to keep current.
Verified 2026-08-17.
```

```text
Mistral's free plan moved under us twice. `mistral-large-*` is paid
only (`403 tier_not_allowed`, 2026-09-03), and on 2026-10-07 the free
plan gave `mistral-medium-*` and `mistral-small-*` a limit of zero
requests a minute (`429`, `x-ratelimit-limit-req-minute: 0`), so every
Mistral lane failed on a key that authenticates.

`ministral-14b-2512` read a CDL photo, two and five photos at once, and
answered the claim check, verified that day on a free key. It took
33-48s to write an article against the row's 45s timeout, so articles
go to `ministral-8b-2512`, which wrote one in 9-11s.

`ministral-8b-2512` is the spare everywhere else: it read the licence
in full on one and two photos and answered the claim check, the same
day. `mistral-medium-latest` comes last, for a paid plan: it was this
row's pin until 2026-10-07, and on a free key it answers with a limit
of zero, which the router reads as "not on this plan" and rests for a
day.
```

```text
Every previous pin was gone. `llama-3.3-70b` and `llama3.1-8b` are
both absent from Cerebras' public catalogue, which now offers
`gpt-oss-120b` (production), `gemma-4-31b` and `zai-glm-4.7`
(preview) — so Cerebras was contributing nothing to the fallback
order but a wasted round trip. Verified 2026-08-17.
```

```text
Was `Meta-Llama-3.1-8B-Instruct`, which no longer appears among
SambaNova Cloud's supported models. Verified 2026-08-17.
```

```text
The slug was `meta-llama/llama-4-scout-17b-16e-instruct` — Groq's
naming for the same weights, not OpenRouter's. OpenRouter does
not list it, so every OpenRouter image request 404'd on a model
that was in fact available under a different name. Confirmed
against OpenRouter's live catalogue (414 models) 2026-08-17.
```

## `functions/ai/registry/providerTable.js`

```text
Needed because Groq's schema support is per *model*, not per vendor. Only
`openai/gpt-oss-20b`, `openai/gpt-oss-120b` and
`openai/gpt-oss-safeguard-20b` accept `json_schema`; every other model,
including the only vision-capable one, answers a schema request with a
400. Verified against Groq's structured-outputs documentation 2026-08-17.
```

```text
Position 2, not 1. The brief specified Groq first, and the owner
reversed it on 2026-08-03 after measurement: on the free tiers
`openai/gpt-oss-20b` writes 175-213 word articles while Gemini writes
311-417 from the same or thinner sources. Groq stays as the fallback
because it is the more *available* of the two — Gemini's free tier caps
at 20 requests — so a short article beats no article.
```

```text
Groq withdrew both llama-4 vision models in 2026 (Maverick 03-09,
Scout 07-17), and on 2026-10-07 the Qwen pinned in their place,
`qwen/qwen3.6-27b`, answered 404 `model_not_found`: every photo
request to Groq failed. `qwen/qwen3.8-27b` replaced it, verified that
day on the live API: it read a CDL photo, and two photos at once.

Groq's schema support is per *model*. `qwen/qwen3.6-27b` answered
`json_schema` with a 400 and was asked in JSON object mode through
`structuredModeByCapability`; `qwen/qwen3.8-27b` accepts it with
images (CDL, medical card, PSP, MVR and E-Doc schemas, 2026-10-07),
so every Groq lane now asks in schema mode and Groq enforces the shape.

`maxImages` is the model's per-request cap, and the router enforces
it. `qwen/qwen3.8-27b` takes three (`400 "This model supports up to 3
images"`, 2026-10-07), so a four- or five-page E-Doc goes to the next
provider instead of spending a request that cannot succeed.
```

```text
The refusals that are about one model rather than the key or the
request: a paid-only model on a free plan (403), a Labs model nobody
enabled (403), and a model id Mistral no longer knows, which it
answers with a 400 rather than a 404. Read by `providers/http.js`, so
they cost a version, not the provider. Verified live 2026-10-07.
```

## `functions/ai/registry/providers.js`

```text
The **default** fallback order, and since 2026-08-08 only the default.
```

## `functions/ai/router/versionPolicy.js`

```text
A vendor withdraws, overloads or re-tiers one version far more often than it
goes down whole, and on 2026-10-07 all three happened at once: Groq answered
404 for its vision model, Mistral's free plan gave two versions a limit of
zero requests a minute, and Gemini's Flash versions were overloaded. With one
version per lane, each of those took the whole provider out of the lane.
```

## `functions/ai/tasks/healthCheck.js`

```text
Measured on 2026-08-18: a two-image probe against Groq's free tier
returned `429 … tokens per minute (TPM): Limit 8000, Used 3051, Requested
5023`. A vision probe costs roughly 2.5k of that budget and the
multi-image one roughly 5k, so six serial probes cannot all fit inside one
minute — and the connection test was spending the allowance and then
reporting the resulting 429 as "this provider cannot read images".
```

## `functions/ai/tasks/healthProbes.js`

```text
They were 8x8, on the reasoning that a probe should cost a rounding error.
That was measured against the live vendors on 2026-08-18 and it made the
probes lie — in the *pessimistic* direction, which is the harder kind to
notice, because a false failure looks like diligence:

  Mistral  multi-image, 8x8   -> {"answer":"unknown"}   FAILED
  Mistral  multi-image, 256px -> {"answer":"blue"}      passed
  Gemini   multi-image, 8x8   -> HTTP 504 Deadline expired before operation
  Gemini   multi-image, 256px -> {"answer":"blue"}      passed

Vision models tokenise an image into patches. An 8x8 image is under a single
patch, so it carries almost no signal and vendors handle the degenerate case
inconsistently — Mistral spent 15 prompt tokens on one and declined to answer.
Reporting "this provider cannot read images" on that basis was wrong, and it
is what put two working vision providers on the console as broken while CDL
auto-fill had nothing to fall back to.

256x256 is still flat colour, still generated, still ~570 bytes, and still
costs a rounding error — it is simply large enough for the question to be a
fair one. **If these are ever shrunk again, the probes stop testing the
vendors and start testing their tolerance of degenerate input.**
```

```text
They used to be hand-rolled minimal PNGs pasted in as base64. Mistral's newer
models (`mistral-small`, `mistral-medium`) reject those outright with `400
invalid_request_file` while reading a standard, properly zlib-compressed PNG
of the exact same pixels perfectly (measured 2026-09-03 on a free key). A
false "vision failed" is the pessimistic lie this file already exists to
prevent, so the images are now emitted by `solidColorPng` below: a conformant
encoding is the most compatible one, and generating it means the bytes can
never rot into a form a strict decoder refuses.
```

## `functions/ai/tasks/modelPins.js`

```text
A registry pin is a claim about the world, and the world moves. On 2026-08-17
an audit found six pins naming models their vendors had retired — two of them
the entire Mistral vision lane, retired 2025-12-31 and 2026-05-31, and one an
OpenRouter slug that had never been OpenRouter's naming at all. Every CDL and
E-Doc image request routed to those providers had been failing for months.

Nothing in the repository could have noticed. Unit tests use fixtures by
design, the connection test never resolved the vision model, and a pin is
just a string until a request is made with it. So the only thing that can
catch this class of drift is asking the vendor — which means real
credentials, and therefore not CI.
```

## `functions/ai/tasks/reportExtraction.js`

```text
Read the whole value, then take the number — the same lesson as the state code
below. Cutting to twelve characters first turned "USDOT 1234567" into "123456"
(found 2026-10-01): seven digits is the ordinary length now, and the wrong number
became the identity a carrier then LOCKED, so the driver was held to an employer
nobody had. A labelled number wins over an unlabelled one ("MC 765432 USDOT …").
```

## `functions/blog/pipeline/candidates.js`

```text
That is not a hypothetical. On 2026-08-03 the twelve top candidates for the
industry-news slot were, in order: high-speed train noise standards, three VHF
omnidirectional range amendments, Class D/E airspace over Morgantown WV, a TVA
categorical exclusion, an unleaded aviation gasoline transition plan,
locomotive engineer certification, and Jet Route J-24. Not one concerned
trucking. A trucking publication that runs an article about jet routes is
worse than one that runs nothing, so this gate is deliberately applied before
anything reaches an editor or a model.
```

## `functions/blog/pipeline/generate.js`

```text
A 7-day window looked like editorial rigour and was actually a
guarantee of thin articles: FMCSA does not publish substantive
rules weekly. Measured on 2026-08-03, the only primary documents
inside 7 days were one-to-three page exemption notices, and an
honest article from a three-page notice runs ~355 words against a
450-word floor. Widening to 21 days surfaced a ten-page rule —
real regulatory substance to write about.
```

## `functions/blog/pipeline/themes.js`

```text
One article publishes every calendar day. The day's theme rotates through the
three, so each comes round every third day; when the day's theme has nothing
it may publish (no current sources, only repeats, a refused draft), the next
run offers the day to the next theme. It was three a day, one per theme, until
the owner chose fewer articles in October 2026.
```

## `functions/blog/pipeline/validation.js`

```text
**150, down from 450 in three owner decisions** on 2026-08-03. The trade-off was
put to them each time: the free tiers of both AI providers cannot sustain a longer
article, and the alternative was a paid tier. This is recorded at length because
it is a deliberate reduction in article substance below the 700-1,200 words
originally specified — not a constant that drifted.

350, then 200, then 150 — each step measured against what the providers actually
produce rather than chosen. Groq's observed drafts were 165, 175 and 213 words,
so a 200 floor discarded two of three sound articles and published nothing. 150
is set below the measured floor of Groq's output so that a day never passes with
nothing published.
```

## `functions/companyApplications/aiExtract.js`

```text
The licence reader keeps dates "exactly as printed" — its own prompt
asks for that — so they are normalised here, as every other reader's
already were. Passed through, "03/11/1988" filled the carrier's date
of birth as a value no date control can show, and the expiration was
dropped by the fill plan as not being a date at all (2026-10-01).
```

## `functions/companyApplications/invite.js`

```text
The token algebra those two questions are asked with — which hashes open a
draft, and until when — lives in `./inviteTokens.js`, together with the account
of the defect that made composing them independently a revival rather than a
retirement.
```

```text
Once the driver has saved — `driver_in_progress` — the answers are theirs, and
`shared/companyPreparedDraft.js` says the carrier stops being able to read them.
That cutoff was enforced at only one of the two doors: `companyApplications/read.js`
consulted `companyMayReadAnswers`, while this file consulted `isCompanyPrepared`,
which tests `origin` — a field recording who *created* the draft, which
deliberately never changes. So a carrier could mint a link, exchange it itself,
and recover exactly the answers the cutoff had just withheld, plus a resume token
that could rewrite them. The driver's first save does not clear
`inviteTokenHash` either, so the ORIGINAL link already did this — gating the mint
would not have closed it. Found and fixed 2026-09-08.

So the link is **tiered**, and since 2026-09-09 the tier is decided by
`companyMayReadAnswers` — the very predicate the other door has always used.
Two questions composed into one boundary is the shape of every defect this file
records, so there is now one question.
```

```text
**The claim is checked against the draft this link names**, in `./inviteIdentity.js`.
The original plan delegated that to `findResumableApplication`, and neither half
of the delegation worked: the client had no screen for `requiresIdentity` at all,
so the driver was dropped into the fresh-application chooser, and the lookup
queries `identityKey ==` — which autosave was erasing on every save issued
without an SSN in memory. Both measured in production on 2026-09-09 against the
reported application. A link that already resolved the document has no business
asking "does any draft here match this identity"; it asks "is this that
applicant".
```

```text
Both of these were missing until 2026-09-08, which made this the only one of
the five prepared-application callables with neither.
```

```text
Where the driver actually was. Withheld until 2026-09-09, which was
survivable only because a carrier-prepared draft is always on page
one: a driver confirming their identity to continue their own
application would otherwise be handed their answers and dropped back
at the start of the wizard.
```

## `functions/companyApplications/inviteIdentity.js`

```text
## Why this file exists, and what was actually broken

`invite.js` describes a **tiered** link: while the answers are the carrier's own
the exchange hands over everything, and once they are the driver's it hands over
nothing and answers `requiresIdentity`. The second tier was a sentence, not a
mechanism. Three things were missing, all measured in production on 2026-09-09:

1. **Nothing rendered it.** `requires_identity` reached
   `resolveApplyStatusScreen`, matched no branch, and fell through to the intake
   chooser — so the driver was shown "How would you like to start your driver
   application?" with no indication that their own half-finished application was
   sitting behind the link they had just opened. That is the reported symptom.

2. **The verification it delegated to could not run.** The plan was
   `findResumableApplication`, which queries `identityKey ==`. But autosave wrote
   `identityKey: identityKey || null` on every save and the HMAC needs a Social
   Security Number, which a draft deliberately never stores — so the first save
   after a page reload erased it. `[name redacted]`, the reported application, held
   `identityKey: null` at the consent step. The lookup could never have matched
   it. Fixed in `drafts/identity.js` (`identityKeyForSave`); this file is what
   covers the drafts already in that state.

3. **A global lookup is the wrong question.** The link already names the draft —
   `exchangeApplicationInvite` resolved it from the token before deciding
   anything. Asking "does any draft at this company match this identity" throws
   that away, needs a composite index, needs the applicant to guess which contact
   detail the carrier used, and cannot answer at all for a draft whose stored
   identity was lost. So the claim is checked **against the one draft the token
   opened**, and nothing else.
```

```text
  Both of those answers, and the tier refuses rather than checking whichever it
  has: the date of birth is the one compared fact the carrier is never shown, so
  waiving it when the draft does not hold one leaves a check made entirely of
  things the carrier already knows. Review found that on 2026-09-09.
```

```text
Honest about its own limit: in the `answers` tier the SSN is *required* and not
*verified* — any nine digits pass — so the tier is exactly as strong as the date
of birth the carrier is never shown. That holds only for a draft the driver
started. On one the carrier **prepared**, the carrier typed the last name, the
date of birth and the contact detail itself, so the tier compared nothing it did
not already know and a recruiter could pass it and be handed the driver's
answers and a resume token. Since 2026-10-02 a prepared draft with no HMAC is
refused as `unverifiable` instead: the driver continues on the device that holds
their resume token, which asks nothing, or starts a new application. The proper
fix for a driver who has lost that device is out-of-band delivery (App Brief §12).
```

## `functions/companyApplications/inviteTokens.js`

```text
Split out of `invite.js` on 2026-09-09 for the source-size standard, and it is
the right seam: everything here is a pure function of a stored document and a
presented token, with no Firestore, no callable and no policy. `invite.js` is
the two callables and the decisions they make.
```

```text
This is the shape of a defect found on 2026-09-08, and the reason the code below
looks the way it does. Matching accepted the current hash *or* any prior hash,
while validity read a single document-level `inviteTokenExpiresAt` that every
mint rewrote unconditionally — two independent questions composed into one
answer. So regenerating did not retire the old link, it **revived** it: a link
that had been dead for a week opened again, with a fresh resume token, for
another fourteen days. The panel meanwhile told the recruiter that "creating a
new one retires this one".

So each accepted hash now carries its own expiry, and `liveInviteFor` asks both
questions of one entry — which is what makes the old composition impossible to
write again. The prior hash is kept for the reason it always claimed: a driver
who opened the old link a moment ago should not find it dead mid-page. That is a
minutes-scale concern, so it is a minutes-scale grace.
```

## `functions/drafts/admin.js`

```text
Nobody at the carrier could, before 2026-10-06. `getCompanyPreparedDraft`
answers only for the carrier's own prepared work, and only until the driver
writes (`companyMayReadAnswers`). The owner decided that a Company Admin sees
every unfinished application: the driver typed those answers into this
carrier's own form, to apply to this carrier, and a recruiter following up
should start from what is there. Recruiters and HR users keep the old rule.
Only the strict admin check `deleteApplication` uses opens these two doors.
```

## `functions/drafts/identity.js`

```text
**A save must never be able to erase one.** `identityKey` used to be written as
`identityKey || null` on every save, and the HMAC needs the Social Security
Number — which a draft deliberately never stores. So the SSN lives only in the
browser's form state, and any save issued after a reload (or after a restore
from the server copy, which has no SSN either) recomputed the key as null and
wiped it. `findResumableApplication` queries `identityKey ==`, so the applicant
silently lost cross-device resume, and a carrier-prepared application lost the
only thing that could ever prove the driver owns it.

Measured in production on 2026-09-09: three of six live drafts held
`identityKey: null`, including one at the consent step whose `resumeApplicationDraft`
restore was followed 46 seconds later by the save that erased it.
```

```text
`supersedeOtherDrafts` above cannot reach it, and that is not an oversight in
this function — it is a consequence of what it queries. It sweeps by
`identityKey`, and a carrier-prepared draft has none: the HMAC is built from the
driver's own last name, date of birth and SSN digits, and the carrier does not
know the SSN, so `prepare.js` writes `identityKey: null` and says so. A driver
who corrects their email before their first save has landed therefore left the
prepared document alive — with its invite token hash intact — which contradicts
what `shared/companyPreparedDraft.js` says the non-travel of those hashes is
for: "two live drafts answering one link is a worse problem than a claimed link
that has to be sent again". Found 2026-09-08.
```

## `functions/drafts/list.js`

```text
## Why this is the ONLY list, as of 2026-09-10

There used to be two. This one reads the whole collection; the narrower
`listCompanyPreparedApplications` reads `origin == 'company'` — so a draft the
carrier prepared was returned by BOTH, and the product showed it on two
different screens with two different sets of columns and actions. That was never
a security boundary: both callables return contact-and-progress and neither has
ever returned an answer. The read rule lives in `getCompanyPreparedDraft`
(`companyMayReadAnswers`, plus an outright refusal of any draft the carrier did
not author), which is unchanged and unaffected by who lists what.

So the unified workspace reads this one, and every row it shows is one document
from one query. **Deduplication is structural rather than a merge step somebody
has to keep correct** — there is no union of two result sets to reconcile, and no
key to match them on wrongly. `toCompanySummary` supplies the shape, because it
was already the answer-free summary and already resolved `origin` for
driver-authored drafts.
```

## `functions/drafts/purge.js`

```text
The owner asked for this on 2026-10-07: deleting an unfinished application
deletes its answers, its uploaded photos and documents, every link sent for it,
and the same driver's other unfinished application at this company. Submitted
applications and hired drivers are never touched.
```

## `functions/drafts/related.js`

```text
A driver who typed a different email or phone on a second visit has a second
draft, at a second key. The owner decided that deleting one deletes the other
as well (2026-10-07), with the Company Admin shown each one first and free to
keep any that is somebody else's, since a shared phone looks the same.
```

## `functions/employmentVerification/requests.js`

```text
`withEmployerIds` mints an id for every row that lacks one and the write
is the whole array, so two recruiters sending requests for two different
employers on the same unstamped application at the same time each mint a
*different* set of ids and each write all of them. The second write wins,
and the first request is left recording an `employerId` that is no longer
on the document — which `recordVerificationResponse` then cannot resolve,
so the answer that comes back has nowhere to go. Exactly the orphaning the
identity was introduced to prevent, arriving by a different door. Review
found it on 2026-09-09.
```

## `functions/employmentVerification/signature.js`

```text
The respondent signs the §391.23 response either by drawing on the canvas
(a PNG data URL) or, since 2026-09-06 (audit step J), by typing their full
name — stored as `TEXT_SIGNATURE:<name>`, the convention the driver
application already uses for typed marks. Under the ESIGN Act
(15 U.S.C. §7006(5)) and UETA a name typed with intent to sign is an
electronic signature, so both forms are stored with equal standing and the
method is recorded beside the mark.
```

## `functions/eslint.config.js`

```text
Migrated from `.eslintrc.js` on 2026-09-08 for ESLint 10, which reads only
this format — `ESLINT_USE_FLAT_CONFIG=false` and `--ext` are gone. The
policy is unchanged: `eslint:recommended`, then eslint-config-google's
rules, then the local overrides, in that order, so a severity-only override
keeps the options of the layer beneath it exactly as the eslintrc cascade
did (`no-unused-vars: 'error'` still carries google's `{ args: 'none' }`).
```

```text
Measured before the switch: 0 errors, 0 warnings under ESLint 8 and the
legacy file. The same after it, under ESLint 10 and this file.
```

```text
ESLint 10's `recommended` adds rules ESLint 8's did not have. Adopting
them is a change to the functions code, measured on 2026-09-08 at 24
sites: no-useless-assignment 12, preserve-caught-error 6, and
no-unused-vars on `catch (e)` bindings 6 — ESLint 9 changed that rule's
`caughtErrors` default from "none" to "all". This migration keeps the
policy ESLint 8 enforced; those three are the follow-up, deliberately.
```

## `functions/shared/applicationLockedFields.js`

```text
A lock is a snapshot of an employer's identity taken at the moment the carrier
pressed Lock, and the carrier goes on editing the rows afterwards. Nothing kept
the two in step, so four ordinary carrier actions produced an application the
driver was blocked on and could not fix (found 2026-09-08):

  - deleting a locked row left the lock behind as an invisible requirement,
    with the row's own Unlock button gone along with the row;
  - correcting the NAME on a row locked by USDOT number tripped
    `locked-employer-changed`, and the wizard renders a locked row's identity
    as a record rather than a field — so the driver was blocked on the one
    field they are not allowed to touch;
  - correcting the name on a row locked by name moved its signature, and
  - adding a USDOT number to a row locked by name moved it too, both landing on
    `locked-employer-missing` for a row that is sitting right there.

Two things fix that together, and this is the second. The carrier's editor now
renders a locked row's identity read-only, so a signature cannot drift while
the lock exists — the carrier unlocks, corrects, and locks again, which mints a
lock that matches. This handles the case that leaves no trace to render: a
deleted row.
```

## `functions/shared/applicationStorage.js`

```text
A custom file question keeps its upload inside `customAnswers` (since
2026-10-02). Those values are whatever the applicant's browser sent, so only a
path in the namespace `getSignedUploadUrl` issues application uploads into is
taken from there — `companies/{companyId}/applications/guest_uploads/`. The
company prefix alone was not enough: a crafted answer could name one of the
same company's DQ or PEV files, and this deletion runs with the Admin SDK.
```

## `functions/shared/buildApplicationDoc.js`

```text
The wizard checks "the last seven days" of the Hours of Service statement and
whether a card has "expired" against the applicant's calendar, and this process
runs on UTC. Judged on our day, every submission sent between 00:00 UTC and the
applicant's own midnight — each US evening — failed a statement the wizard had
just accepted, and one whose card expires that day failed an expiry it had just
passed (found 2026-10-01). The browser sends its day; it is believed only within
a day of ours, which every real timezone is, so it cannot carry a week-old
statement through or backdate an expiry by more than the clock already allows.
```

## `functions/shared/companyPreparedDraft.js`

```text
The contact-and-progress shape — and since 2026-09-10, the ONLY list shape.
```

## `functions/shared/publicProfileDto.js`

```text
The shape version of this projection. Version 3 (2026-09-02) added
`applicationRules` and `applicationIntegrations`.
```

## `functions/test/unit/aiHealthCheck.pins.test.js`

```text
Measured against the live vendors on 2026-08-18: a two-image probe against
Groq's free tier returned `429 ... tokens per minute (TPM): Limit 8000, Used
3051, Requested 5023`. One vision probe costs roughly 2.5k of an 8k/minute
budget and the multi-image one roughly 5k, so six serial probes cannot fit --
the connection test was spending the allowance and then reporting the
resulting 429 as "this provider cannot read images". Groq's preview vision
model separately returned `503 ... currently over capacity`. Neither says
anything about the capability.
```

## `functions/test/unit/aiProviders.failures.test.js`

```text
Measured live on 2026-08-18: the Gemini free tier allows 20 requests per
minute and states the wait in the error BODY, not a header —
"Please retry in 44.26781542s". Nothing read that sentence, so a
45-second cap earned the flat 30-minute quota cooldown and removed the
highest-priority provider from every lane.
```

```text
A version this account cannot use at all is not a spent allowance and not a
bad key. Both shapes measured on the live vendors, 2026-10-07.
```

## `functions/test/unit/aiProviders.groq.test.js`

```text
`qwen/qwen3.6-27b` rejected `json_schema` with a 400 and was asked in
JSON object mode. Its successor accepts the schema with images
(verified live 2026-10-07 on every photo-reading schema), so Groq now
enforces the shape itself rather than only being told it in the prompt.
```

```text
These are assertions about the *vendor*, not about our code, and they exist
because getting them wrong silently broke every schema-using AI feature in
production while the health check stayed green.

Verified against the live Groq API on 2026-08-03 with a real key.
```

```text
Groq rejects the others outright:
  400 "This model does not support response format `json_schema`."
Groq's structured-outputs documentation lists exactly the gpt-oss
models as schema-capable (verified 2026-08-17).

`qwen/qwen3.8-27b` joined them (verified live with images, 2026-10-07).
```

```text
Vision was withdrawn on 2026-08-03 when Groq retired both llama-4
vision models, came back on `qwen/qwen3.6-27b` (2026-08-17), and moved
to `qwen/qwen3.8-27b` when Groq retired that one too (2026-10-07).
```

```text
`qwen/qwen3.8-27b` accepts at most three images per request and
answers a fourth with `400 "This model supports up to 3 images"`
(2026-10-07). E-Doc sends up to five pages, so the registry states the
cap and the router sends a four- or five-page document elsewhere.
```

## `functions/test/unit/aiProviders.registry.test.js`

```text
A registry pin is a claim about the world, and the world moves. Every
entry below was live in the registry and dead at the vendor — silently,
because the connection test sent plain text and never touched the model
a real task would have resolved.

These assertions are cheap insurance against the same drift returning by
copy-paste. They cannot detect *new* drift; `diagnoseAiModelPins`
reconciles the pins against the vendors' live catalogues for that.

All verified against vendor documentation and live catalogues 2026-08-17.
```

```text
Distinct from a retired pin: `mistral-large-latest` is a live, working
model — it is simply *paid-tier only*. A free key gets `403
tier_not_allowed` and Large is not even in its catalogue, so pinning it
meant every Mistral lane 403'd and the connection test reported six
failures on a key that authenticates and does inference. On 2026-10-07
the free plan also gave Medium and Small a limit of zero requests a
minute, and the Ministral models serve every lane — text, structured JSON
and vision — on the free entitlement (verified against the live API).
```

## `functions/test/unit/aiProviders.support.js`

```text
Gemini fixtures **captured verbatim from the live API** on 2026-08-03 against
`gemini-3.6-flash`, trimmed of ids and timings.

This matters more than it looks. The original version of this group invented
its fixtures from the adapter's own assumptions — it asserted an `output_text`
field and a `parts`/`inline_data` request shape. The API returns neither. So
the tests passed, the adapter shipped, and *every* Gemini call failed in
production: text, structured JSON and vision alike. A test that asserts the
code's beliefs back to it cannot catch the code being wrong about the world.
```

## `functions/test/unit/aiRouter.routing.test.js`

```text
Gemini leads and Groq is the fallback. The brief specified Groq first;
the owner reversed it on 2026-08-03 after measurement — on the free
tiers Groq's model writes 175-213 word articles against Gemini's
311-417, while Gemini's request cap makes it the less available of the
two. Gemini for quality, Groq for availability.
```

## `functions/test/unit/applicationDocument.test.js`

```text
The MVR authorization joined the set on 2026-09-02; it is answered on
the driving-record step and preserved with the same rigour.
```

## `functions/test/unit/applicationDraftIndexes.test.js`

```text
The carrier-prepared surface reads the same collection, so an equality query
there needs its index declared too: on 2026-09-03 review found `origin ==
'company'` ordered by `updatedAt` with no index declared, which would have failed
with `FAILED_PRECONDITION` in a deployed project while every test here passed.
None of these files queries by equality now; a new query must bring its index.
```

## `functions/test/unit/applicationDrafts.guards.test.js`

```text
Until 2026-09-10 a carrier-prepared draft was returned by this callable AND
by the narrower `listCompanyPreparedApplications`, and the product listed it
on two separate screens. One query over one collection means one row per
document — there is no union to reconcile and no key to match wrongly — so
the property below is structural, not a merge step to keep correct.
```

## `functions/test/unit/applicationDrafts.saving.test.js`

```text
## The defect, measured in production on 2026-09-09

`identityKey` was written as `identityKey || null` on **every** save. The HMAC
needs a Social Security Number, and a draft deliberately never stores one — so
the SSN lives only in the page's own state, and the first autosave issued after
a reload (or after a restore from the server copy, which has none either)
recomputed the key as null and erased it.

`findResumableApplication` queries `identityKey ==`, so what the applicant
silently lost was cross-device resume — and, for a carrier-prepared
application, the only thing that could ever prove the driver owns it. Three of
six live drafts held `identityKey: null`, one of them at the consent step, its
`resumeApplicationDraft` restore followed 46 seconds later by the save that
erased it.
```

## `functions/test/unit/applicationDrafts.support.js`

```text
`resetDraftState` calls `jest.resetAllMocks()`, which drops a queued `*Once`
value that its test never consumed; `clearAllMocks` left it queued, and one
leaked for real on 2026-09-08 (a `mockCheckRateLimit.mockResolvedValueOnce(false)`
surfaced in the NEXT test's `prepare()`). Jest 30's reset leaves every double
returning `undefined`, so `resetDraftState` puts the four doubles' defaults
back, and a suite with doubles of its own sets theirs after calling it
(`.claude/rules/testing.md`).
```

```text
A real `DocumentReference` carries its own id, and code that compares
"is the document I read the one I am writing?" reads it. Missing here
until 2026-09-08, it made every such comparison see `undefined` and
answer "different" — so a correct guard looked like a bug, and an
incorrect one would have passed. Same reasoning as the `ref` note above.
```

## `functions/test/unit/blogPipeline.content.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

## `functions/test/unit/blogPipeline.ledger.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

## `functions/test/unit/blogPipeline.rendering.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

## `functions/test/unit/blogPipeline.scheduling.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

## `functions/test/unit/blogPipeline.sourcing.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

## `functions/test/unit/blogPipeline.topics.test.js`

```text
Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
because Jest hoists them per file and they cannot register from a helper.
```

```text
Titles taken verbatim from the live `federal-register-dot` feed on
2026-08-03. Every one arrived tagged `regulation, compliance,
freight-market` — the *source's* topics — and every one passed the theme
filter. They were the top candidates for the industry-news slot.
```

## `functions/test/unit/companyApplications.aiExtract.test.js`

```text
The licence reader keeps dates "exactly as printed". Passed through, the
carrier's date of birth held "03/11/1988" — a value no date control can
show — and the expiration was dropped by the fill plan (2026-10-01).
```

## `functions/test/unit/companyApplications.identity-move.test.js`

```text
The draft's id is `sha256(company:email:phone)`, so those two fields are not
contact details — they are the address. A driver who fixes a typo on page one
is therefore writing to a DIFFERENT document than the one the carrier prepared,
and before this was fixed that document was an ordinary `in_progress` draft
with no `origin`, no `inviteClaimedAt` and no `lockedEmployers`.

That is not a lost record, it is a lost rule. `submitGuestApplication` reads the
locks from the key it computes off the *submitted* contact details, so the
employers the carrier locked from a PSP report could be renamed or deleted by
anyone who corrected a typo — the one thing the lock exists to prevent, undone
without touching a locked field.

Found in review on 2026-09-03. These tests pin both halves: the carrier's facts
travel with the applicant, and nothing about a driver-authored draft changes.
```

```text
Leaving the invite hash behind is only half a promise: the document it
is on has to go too, or the carrier's link still opens a live draft
holding the pre-correction answers while the driver fills in another —
exactly the "two live drafts answering one link" the non-travel of those
hashes exists to avoid. `supersedeOtherDrafts` cannot do it: it sweeps
by `identityKey`, and a prepared draft has none, because the carrier
does not know the SSN the HMAC is built from. Found 2026-09-08.
```

## `functions/test/unit/companyApplications.invite.continuation.test.js`

```text
## The production failure this file is built from

`companies/[company id]/application_drafts/[draft id]`, read
on 2026-09-09: `origin: 'company'`, `status: 'driver_in_progress'`,
`lastSemanticStep: 'consent'`, `clientSeq: 10`, `inviteClaimedAt` at 16:02 —
and **`identityKey: null`**. The recruiter minted a replacement link at 16:41,
the driver opened it twice (both exchanges returned 200), and both times the
page rendered the fresh-application chooser.

Two independent defects, and the suite covers both:

1. `requiresIdentity` had no verification path that could run. It delegated to
   `findResumableApplication`, which queries `identityKey ==`, and that field was
   null — erased by the first autosave issued after a page reload, because the
   HMAC needs an SSN and a draft never stores one.
2. Nothing rendered `requires_identity`, which is the client half
   (`PublicApplyScreens`).

Every fixture here is synthetic. `driverStartedWithoutIdentity` reproduces the
*shape* of that record — a taken-over prepared draft with no identity HMAC — and
`driverStartedWithIdentity` the shape every draft written from now on has.

**Since 2026-10-02 the first shape is refused.** On a prepared draft the carrier
typed the last name, the date of birth and the contact detail itself, and with
no HMAC the SSN cannot be checked, so the claim that rescued the reported record
was one a recruiter could make too — and be handed the driver's answers. It is
now `unverifiable`, the driver's own device still resumes with its token, and the
`answers` tier survives for a draft the driver started, whose date of birth the
carrier has never seen. `driverStartedOwnWithoutIdentity` is that shape.
```

```text
Where they actually were. Withheld entirely until 2026-09-09, which would
have dropped a confirmed driver back onto page one of their own form.
```

```text
The hole closed on 2026-10-02. Every fact in this claim is one the carrier
typed into its own prepared application, and with no HMAC on file the SSN
cannot be checked — so a match proves nothing about who is asking.
```

```text
The hole review found on 2026-09-09, and the reason the `answers` tier wants
BOTH stored facts rather than whichever it happens to have.
```

## `functions/test/unit/companyApplications.invite.expiry.test.js`

```text
## The defect this file exists for

Found 2026-09-08. Validity was modelled per DOCUMENT while matching was
modelled per GENERATION: `inviteNamesDraft` accepted the current hash or any
prior hash, `inviteStillValid` read one document-level `inviteTokenExpiresAt`,
and the mint rewrote that field unconditionally. Composing the two
independently meant an expired token could ride on a newer token's expiry —
so "Create a new link" did not retire the old link, it **revived** it, for a
further fourteen days, even when it had been dead for a week.

`companyApplications.invite.test.js` could not see it: it calls
`setInviteExpiry` *after* both mints, which forces a live expiry and makes the
reset invisible. The sequence that matters is expire → regenerate → present
the old token, and it is the first case below.
```

## `functions/test/unit/companyApplications.invite.privacy.test.js`

```text
## The defect this file exists for

Found 2026-09-08. `shared/companyPreparedDraft.js` states the boundary: a
carrier may read the answers of its own prepared draft until the driver's first
save, and from then on sees contact and progress only. It was enforced at one of
the two doors that read those answers. `companyApplications/read.js` consulted
`companyMayReadAnswers`, which tests `status`; `companyApplications/invite.js`
consulted `isCompanyPrepared`, which tests `origin` — the field that records who
*created* the draft and deliberately never changes.

So a carrier could mint a link, exchange it itself from anything (the exchange is
unauthenticated by necessity — the driver has no account), and recover exactly the
answers the cutoff had just withheld, plus a resume token that could rewrite them.
`StartApplicationPage` rendered the mint button on the very screen that tells the
recruiter the answers are the driver's now.

**Gating the mint would not have closed it.** The driver's first save leaves
`inviteTokenHash` untouched, so the link the carrier had already copied kept
working. The fix is at the exchange, which is what these cases pin.
```

## `functions/test/unit/companyApplications.invite.test.js`

```text
Opening alone is deliberately NOT the fact (moved 2026-09-08). The
carrier holds this link too, and stamping the claim on the exchange let
it arm locked-employer enforcement for a driver who had never been shown
the rows — the exact refusal the field exists to prevent.
```

## `functions/test/unit/connectFacebookPage.authz.test.js`

```text
Until 2026-08-25 this callable did:

    const companyId = request.auth.uid; // Assumes 1:1 user-company mapping

SafeHaul has never worked that way. Companies carry generated ids and users
join them through `memberships`; a user can belong to several, which is why
there is a company chooser. So every page connected through this callable
wrote `integrations_index/{pageId}.companyId = <a user id>`, and every lead
the webhook later ingested went to `companies/{uid}/leads` — a tree belonging
to no company, which no screen reads. The leads were not delivered to the
wrong tenant; they were silently dropped into nowhere.

The caller now names the company and the server authorizes it. These tests
cover the full matrix, because the failure mode of getting this wrong the
*other* way — trusting a client-supplied id — is worse than the bug being
fixed: it would plant one company's leads in another's tenant.
```

## `functions/test/unit/deleteApplication.test.js`

```text
A custom file question keeps its upload inside `customAnswers` (2026-10-02).
```

## `functions/test/unit/employmentVerification.responses.test.js`

```text
Split from the single 525-line suite on 2026-09-09 for the source-size standard;
`employmentVerification.support.js` holds the harness, and every `describe`
keeps its original title so full test names are unchanged.
```

```text
Step J (2026-09-06): the signature arrives as a drawn PNG or a typed
name and is validated by employmentVerification/signature.js before
anything is stored. These three pin what submitVerificationResponse
does with each outcome; the normaliser's own rules live in
pevSignature.test.js.
```

## `functions/test/unit/employmentVerification.support.js`

```text
Split out of the single 525-line file on 2026-09-09 for the source-size
standard, when the request suite grew the cases that pin employer identity —
a Previous Employment Verification must never be able to land on the wrong
employer, and proving that takes more than one case.
```

## `functions/test/unit/employmentVerification.test.js`

```text
The identity's own lost-update race, found in review on 2026-09-09.
```

## `functions/test/unit/guestApplication.test.js`

```text
The wizard checks "the last seven days" against the applicant's calendar, and
this process runs on UTC, so every submission sent between 00:00 UTC and the
applicant's own midnight — each US evening — failed an Hours of Service
statement the wizard had just accepted (proven 2026-10-01 against these very
modules). Built from the process's OWN calendar, so the scenario "the
applicant is a day behind us" holds in whatever timezone the suite runs.
```

## `functions/test/unit/pevSignature.test.js`

```text
Until 2026-09-06 the server accepted any string that started with
`data:image`, decoded whatever followed and wrote it to Cloud Storage as a
PNG. Every refusal below is a shape that would have reached Storage, the
response record or the DQ-file PDF under that rule.
```

## `functions/test/unit/reportExtraction.test.js`

```text
Seven digits is the ordinary length now. The value used to be cut to twelve
characters BEFORE the digits were taken, so these became 123456 and 3 —
and the wrong number became the identity a carrier locked (2026-10-01).
```

## `functions/test/unit/secretBindingGenerations.test.js`

```text
On 2026-08-19 a green pull request merged and `main` shipped nothing. Four new
**1st-generation** callables declared `secrets: ['SMS_ENCRYPTION_KEY']`, and
every previous consumer of that secret was **2nd generation**. The two
generations default to different runtime service accounts — App Engine for v1,
Compute Engine for v2 — so the Firebase CLI tried to add a binding the secret's
IAM policy did not have:

    i functions: ensuring truckerapp-system@appspot.gserviceaccount.com
                 access to secret SMS_ENCRYPTION_KEY.
    Error: ... Permission 'secretmanager.secrets.setIamPolicy' denied

The CI deploy account can deploy functions but cannot rewrite secret IAM. So
`deploy-functions` aborted — for **every** function, not only the new ones —
and the shared backend that Production also runs on stayed on the previous
revision. `verify-shipped` caught it, which is the only reason anybody knew.

Nothing in the test suite could have caught it: the functions load fine, the
unit tests pass, and a pull request never deploys. This test is the guard.
```

## `e2e/a11y.spec.cjs`

```text
Tagged @a11y for grouping only. These specs run inside the BLOCKING
`frontend-e2e` lane as of 2026-08-25.

They used to be excluded from it with `--grep-invert "@a11y"` and run in a
separate `continue-on-error` job, because when they were written the browser
could not be downloaded in the sandbox and they had never been proven. They
have been green in CI ever since — 11/11 on every run of the campaign that
wrote the "flip to blocking once green" note. An accessibility gate nobody has
to pass is a report, not a gate. `scripts/test-ci-plan.mjs` (K2) asserts no
workflow step excludes them again.
```

```text
A public, mobile-first, single-task form asking for four things, one of
them a Social Security Number — so its labelling, its error announcement
and its focus order are exactly what this lane is for. It did not exist
before 2026-09-09; the outcome behind it fell through to the intake
chooser.
```

```text
The surfaces that changed hands on 2026-08-25, and the keyboard behaviour axe
cannot see.

axe is a static check on a rendered tree: it can tell you a tab has no
accessible name, and it cannot tell you the arrow keys do nothing. Eleven tab
strips, four toggle groups and nine file pickers moved onto design-system
primitives in that campaign; these assert the parts of that move a screenshot
and an axe scan both miss.
```

```text
The carrier's prep editor. Its select and checkbox fields were text boxes
until 2026-10-01, and the controls that replaced them are the design
system's own. What this checks is that the editor gives them names and that
a keyboard reaches them, not the browser's own handling of a select.
```

```text
The 2026-08-25 walkthrough found seven call sites rendering the
browser's black UA outline instead of the product's blue ring, because
`focus-visible:shadow-ds-focus` draws a box-shadow and does not replace
`outline`. `utilities.css` fixes that globally; this proves it on a real
screen, by tabbing and asserting SOMETHING visible marks focus.
```

```text
A focusable DataTable row draws its ring on its CELLS — a
`<tr>` cannot carry a box-shadow reliably, so DataTable.css
puts the inset ring on `tr:focus-visible > *` and resets the
row's own outline. Read the ring where the row paints it. On a
412px screen the collapsed navigation lets Tab reach the rows
within twenty presses, which is how the mobile lane found
this heuristic reading the wrong element (2026-09-07).
```

## `e2e/campaign-audience-builder.spec.cjs`

```text
The picker is the approved `FileInput` dropzone as of 2026-08-25, so the
trigger is a `<label>` and not a button: one focusable file input, named by
its field, with "Choose file" as the label's visible words. "One trigger"
is still the point of this test — a hidden input driven by a separate
button was two things claiming to be the control.
```

## `e2e/company-prepared-application.spec.cjs`

```text
This used to fall through in silence, and that behaviour was pinned here
as correct on the grounds that a driver following a stale link should
land on the ordinary application rather than a diagnostic. Two things
were wrong with it. The driver could not tell a dead link from a working
one — and worse, the fall-through never claims the invitation, so the
carrier's locked employers go unenforced and it receives a second,
unprepared application, losing the 49 CFR 391.21 employment history it
had prepared. Changed 2026-09-08.
```

```text
## The reported failure, and why only a browser could show it

A carrier-prepared application for a driver who had reached the consent step.
The recruiter pressed "Create a replacement link"; the driver opened it and the
page rendered the fresh-application chooser — "How would you like to start your
driver application?" — with their own half-finished application sitting behind
the link. Measured in production on 2026-09-09.

`exchangeApplicationInvite` answered correctly the whole time: `requiresIdentity`,
with no answers and no token. The defect was that the outcome matched no branch
in `resolveApplyStatusScreen`, and the chooser sits at the bottom of it. Nothing
short of rendering the page could see that, which is why it is here rather than
only in the contract suite.
```

```text
Reached from the unified unfinished-applications workspace since 2026-09-10,
where starting an application is the primary action. `e2eUnfinished=mock` puts
```

```text
Measured 2026-10-01: every one of these was a free-text box, so a carrier's
"TX" reached the driver's state picker — which lists names — as "Alabama",
the medical card read "[object Object]", and a Social Security Number box
took input the server then silently discarded.
```

```text
The owner's decision of 2026-10-06: an admin reads what the driver wrote
too. A recruiter still cannot, which the unit suites pin; this harness
signs in only as an admin.
```

## `e2e/company-profile-security.spec.cjs`

```text
The avatar assertions were rewritten on 2026-08-25 for the approved
`FileInput`. The control used to be a `Button` driving a hidden input, so they
looked for a *button* and asserted the input was NOT inside a label. The
picker contract is the opposite by design: a real focusable input inside a
`<label>` styled as the visible control, with the accessible name on the field.
Same intent, the contract's shape. See `design-system/components/file-input`.
```

## `e2e/company-settings-branding.spec.cjs`

```text
Rewritten 2026-08-25 for the approved `FileInput`. The control used to be a
`Button` driving a hidden input, so these tests looked for a *button* and
asserted the input was NOT inside a label. The design system's picker contract
is the opposite by design: a real `<input type="file">`, visually hidden but
focusable, inside a `<label>` styled as the visible control — which is what
makes the whole label a click and drag-and-drop target with no handler, and
puts the accessible name on the field rather than on the trigger. The tests
keep their intent (named, keyboard-reachable, visibly focused, no *button*
nesting, accepted types announced) and follow that shape.
```

## `e2e/company-settings-integrations.spec.cjs`

```text
The real Facebook SDK is not reachable from this environment. Until
2026-09-06 that left the "Connect Facebook" control in whichever state the
network produced, and the keyboard test skipped on every CI run. The SDK is
now stubbed at the network edge (`page.route` on connect.facebook.net), the
same way the product code loads it — `window.fbAsyncInit` fires, `FB.init`
runs, the button enables — so the enabled state is deterministic here and
the "SDK Loading..." state stays covered by IntegrationsTab.contract.test.jsx.
```

## `e2e/company-settings-questions.spec.cjs`

```text
A `tab`, not a `button`, since 2026-08-25: this strip had tab *behaviour*
with no ARIA at all and is the approved `TabList` now, so the control
announces as a tab in a tablist and the panel it shows is a `tabpanel`.
That is the point of the migration — the old markup told assistive
technology nothing about the relationship this test is here to check.
```

## `e2e/confirmation-dialogs.spec.cjs`

```text
Real-browser verification for the shared `ConfirmDialog` that replaced the last
blocking `window.confirm` / `confirm()` guards (2026-07-28).
```

## `e2e/dialog-layering.spec.cjs`

```text
`WorkspaceFrame`'s mobile navigation drawer read `--ds-z-modal` (60) until
2026-09-05, which is the dialog layer — so in the CSS the drawer outranked
every `<Modal>`, and nine hand-written `z-[60]`, `z-[70]` and `z-[9999]`
overlays across the tree existed because each new thing that had to sit on
top picked a number bigger than whatever it had lost to.

**What this does NOT claim.** The drawer-over-dialog conflict is not
reachable through the company workspace UI today: while the drawer is open
its backdrop covers every page control, and nothing rendered inside the
drawer opens a dialog — both verified while writing this. So the ordering was
wrong rather than visibly broken, and what is fixed is a trap: any future
"open a dialog from the navigation" would have fallen into it, and the
escalation war above shows what that costs. Saying so is better than claiming
a user-visible bug that cannot be demonstrated.
```

## `e2e/driver-dossier.spec.cjs`

```text
Both hidden utilities: they emit the same clip rule, and a hidden control
clips to 1x1 rather than 0x0, so naming only one flagged a control nobody
can see. Made consistent with `lead-intake.spec.cjs` on 2026-08-25.
```

## `e2e/edoc-documents-workspace.spec.cjs`

```text
Rewritten 2026-08-25 with the approved `TabList`, and the change is
deliberate rather than incidental.

This workspace renders **one** panel — the selected tab's — so the three
unselected tabs have no panel in the document to control. The old markup
pointed all four at the single panel's id, which is three references to
something that is not theirs; the primitive sets `aria-controls` on the
selected tab only, because an `aria-controls` naming an element that does
not exist is worse than its absence (the APG says as much for a lazily
rendered panel).
```

## `e2e/edoc-editor-mobile.spec.cjs`

```text
Selected by the CHROME CONTRACT rather than by a radius utility. This read
`.include('.rounded-t-ds-xl')` until 2026-09-05, when the bottom-sheet
radius moved from the call site's class list into `Modal.css` — at which
point the selector matched nothing and the scope silently became "the
editor nav only". A sibling spec caught the same shape by throwing; this
one would just have quietly stopped checking the sheet.
```

## `e2e/edoc-envelope-creator-shell.spec.cjs`

```text
This read `.include('.z-30')` until 2026-09-05, when the raw stacking
numbers were replaced by named layers and the selector silently matched
nothing — axe then threw rather than passing vacuously, which is the only
reason it was noticed. A test that targets a utility class is coupled to
how the thing looks, and the whole point of the design-system work is
that how a thing looks is free to change.
```

## `e2e/edoc-envelope-sidebar.spec.cjs`

```text
The picker is the approved `FileInput` dropzone since 2026-08-25, so its
accessible name is the FIELD ("Choose a PDF file") and "Choose File" is the
label's visible words. A file input maps to the `button` role, which is how
assistive technology sees it and why the name has to be the field rather
than the trigger's text. The frozen copy on screen is unchanged.
```

## `e2e/edoc-recruiter-send-and-sign.spec.cjs`

```text
Until 2026-09-06 this asked CDP for `Input.synthesizePinchGesture`, which
headless CI Chromium refuses, so the test skipped on every run. The hook
(`usePdfZoomGestures`) listens for touchstart/touchmove/touchend on the
scroller and reads `e.touches`, so the gesture is driven with exactly
those events: two fingers 80px apart, spread to 160px over six moves, then
lifted — the same ×2 the CDP call asked for. `hasTouch: true` on this
describe gives the page the Touch and TouchEvent constructors.
```

## `e2e/guest-cdl-autofill.spec.cjs`

```text
It had no browser test at all, and the one defect it carried only a browser
shows: a licence prints its state as a postal code ("TX"), the auto-fill wrote
that code into both state pickers, and the pickers list names. Given a value
with no option, Chromium selected the first one it could, so a driver with an
Austin address saw "Alabama" twice while the form held "TX" — and the step's
validation passed, because the field was not empty (found 2026-10-01, in a real
browser against the real Cloud Functions).
```

```text
The photo is the application's CDL front (2026-10-06), so the License step must
show it attached whether or not the licence could be read: the driver never
photographs it a second time.
```

```text
The District of Columbia joined the state list on 2026-10-02. Before that a DC
licence left both pickers empty, because "DC" had no name to become.
```

## `e2e/guest-custom-file-question.spec.cjs`

```text
Until 2026-10-02 the question recorded the chosen file's NAME the moment a file
was picked — before the upload had finished, and whether or not it ever did —
and threw away the storage path the upload returned. So the company saw a
filename that nothing referenced, and a failed upload still read as answered.
The answer is the uploaded file now, recorded only once it has landed.
```

## `e2e/helpers/verificationPortalHelpers.cjs`

```text
Extracted on 2026-09-06 when the typed-signature tests (audit step J) pushed
the closeout spec past the 500-line maximum. Everything here is a *page
gesture*, not an assertion about the product: how to load the mock form, how
to put ink on the canvas the way a mouse or a finger does, how to read that
ink back, how to fill the shortest valid response. The specs own what is
asserted about each of those.
```

## `e2e/helpers/wizardHelpers.cjs`

```text
DETERMINISM CONTRACT (2026-07-27) — read before editing.

Every step transition and every asynchronous side effect is waited for by
*state*, never by a sleep and never by leaning on Playwright's per-action
auto-wait to paper over a missing barrier. Two concrete flakes were traced to
violations of that rule:

1. `setInputFiles` × 3 followed immediately by clicking Continue. The three
   guest uploads are independent async writes, and `isUploading` briefly drops
   to false between them — so the "Continue" label reappears, Playwright clicks
   it, and `Step3_License.handleContinue` runs while the third upload has not
   yet reached `formData`. It sets "Please upload required documents: Medical
   Card." and refuses to advance. The arriving upload then *clears* that
   message, leaving a page that looks completely valid but is still on step 3.
   The run then times out on `label[for="consent-mvr-yes"]` — the reported
   symptom, three steps away from the cause. Fixed by
   `waitForUploads()`, which waits for each field's own committed
   `data-upload-state="uploaded"`.

2. Chained `Continue` clicks with no assertion between them. React commits the
   step change asynchronously, so the *same* still-mounted button can be
   clicked twice and one step is silently skipped. Fixed by `continueToStep()`,
   which asserts the new `#step-title` after every advance.

Neither fix hides an application defect: the missing-upload message is now a
focused `role="alert"`, and the wizard now moves focus to each new step's
heading instead of running two competing scroll animations.
```

## `e2e/public-application-responsive.spec.cjs`

```text
so naming only one of them made this guard flag a control nobody can see.
`lead-intake.spec.cjs` already skipped both; the three sweeps that named
one were the inconsistency, found 2026-08-25.
```

## `e2e/super-admin-views.spec.cjs`

```text
Added 2026-07-28 with the final three views of the Super Admin row.
```

```text
same settled state every other view here is asserted in. Wait for it.
Until 2026-09-06 this sampled `isVisible()` once, during "Loading
analytics...", and skipped on every CI run (audit step H).
```

```text
---- The final three views of the Super Admin row (2026-07-28) ----
```

```text
Removed on 2026-10-11: they wrote test accounts and schema defaults into
the live database.
```

## `e2e/unfinished-applications-admin.spec.cjs`

```text
The owner decided on 2026-10-06 that a Company Admin reads every unfinished
application, corrects the ones the driver owns, and may delete any of them. The worklist comes from its `e2eUnfinished=mock` fixture; the
```

## `e2e/verification-portal-closeout.spec.cjs`

```text
reading the ink back) are shared with
`verification-portal-typed-signature.spec.cjs` through
`helpers/verificationPortalHelpers.cjs`; that spec owns the Draw | Type
choice added on 2026-09-06 (audit step J).
```

## `e2e/verification-portal-typed-signature.spec.cjs`

```text
The Draw | Type signature choice on the public verification portal
(audit step J, 2026-09-06).

A canvas has no keyboard path, so until this change a respondent who could
not use a mouse or a finger had no way to produce the legally operative mark
on a 49 CFR §391.23 response — and axe could not see it, because axe cannot
detect a missing input modality. `SignatureInput` now offers "Type": the name
is stored as `TEXT_SIGNATURE:<name>` with the method recorded, never drawn
into a PNG, so the record says which kind of mark it was.
```

## `e2e/voe-print-export.spec.cjs`

```text
The generated document is INCLUDED since 2026-09-06. Until then its grey
legal small print (slate-400: 2.56:1 on white, 2.45:1 on the slate-50 box,
2.07:1 inside the 80%-opacity questionnaire) was excluded as an open owner
decision; the audit resolved it by recolouring to the nearest AA greys —
WCAG 1.4.3 has no exemption for legal small print. A failure here now
means the document itself regressed.
```

## `e2e/visual/app.spec.cjs`

```text
Blocking in CI, as of 2026-08-25. All twenty baselines that existed then used
to fail on GitHub's runners, on every run, invisibly: the application fetched
Inter from rsms.me and the runner never received it, so each screenshot was a
whole page of substituted glyphs. The font is served from the repository now
(`design-system/tokens/typeface.css`), which is what makes these comparable
across machines. See the header of `catalog.spec.cjs`.
```

```text
`<h1>Super Admin</h1>` is in the banner and present on first paint, so
the old predicate let the screenshot race the three metric cards. The
committed baseline had caught them mid-load showing `•••`; a run on
2026-08-25 caught them resolved showing `0`, and the lane failed on a
diff of three glyphs with nothing wrong in the product. That is exactly
the failure a blocking lane cannot have: one flake teaches everyone to
disbelieve the next real regression.
```

```text
answer, fails. The cards say "Error", not the 0 they once showed for a
count that failed.
```

```text
Added 2026-08-25. The ten screens above were the ones the lane started
with; these five are the rest of the areas a user actually spends time in,
and every one of them was unmeasured while the lane was advisory:

 - the signing room is where a legally operative signature is made;
 - the change-review portal is a public token route with no navigation
   around it, so nothing else on the screen would reveal a broken state;
 - Unfinished applications and the two lead lists are three more tables, and
   tables are where this campaign found most of its geometry defects;
 - Import Leads carries the `FileInput` dropzone that four uploads
   migrated onto, so its appearance is now a shared contract rather than
   one screen's decision.
```

```text
`e2eUnfinished=mock`, added 2026-08-25 because this screen was the one
in this list whose content came from a real callable. With no
credentials the call fails, and *how* it fails decides what renders:
the committed baseline was a loading skeleton captured in one
environment, and CI captured something 30% different. Every other
route here already uses a fixture harness; this one now does too.
```

## `e2e/visual/catalog.spec.cjs`

```text
## Why this lane is blocking, as of 2026-08-25

It was `continue-on-error` before, on the stated grounds that the catalog did
not load Inter so text rasterised with whatever the runner's `sans-serif`
resolved to. The CI record contradicted that diagnosis in both directions: all
130 catalog baselines passed on GitHub's runners, and all 20 *application*
baselines failed — because the application fetched Inter from rsms.me and the
runner never got it. The lane had never been green, and nobody could see that,
because the step swallowed its own failure.

The font is served from `design-system/fonts/` now, by the application and by
this catalog, so there is no machine-dependent input left and the lane is
enforced. The first test below is still the tripwire and matters more than
ever: it asserts Inter actually loaded, so a font problem is one legible
failure instead of 150 pixel diffs.

`scripts/test-ci-plan.mjs` (K1) asserts the workflow step carries no
`continue-on-error`, so this cannot quietly become advisory again.
```

```text
The chrome contract, added 2026-09-05. Five shots rather than one because
the axes are independent and a single composite would hide which moved.
```

```text
Added 2026-08-25 to close an asymmetry: `DataTable`'s empty state has had a
baseline since the lane was written, and the native-table contract — which
eleven feature files now read — had none for either state worth seeing.
```

```text
Audit step K, 2026-09-06: the same matrix as a table at 1440px and as one
card per row at 412px, so both halves of the phone rule have a picture.
```

```text
It was serial until 2026-08-25, and serial mode has one consequence that
matters more than anything it was buying: **when a test in a serial group
fails, Playwright skips every remaining test in the group.** With 142 of
this lane's 174 tests in this one group, a change touching several
components reported exactly one failure and silently skipped the rest — so
a re-record looked like "one baseline moved", and a genuinely broken
catalog produced a diff artifact holding a single image. Measured: a
one-line CSS change moved several subjects, and the run reported
`1 failed / 81 did not run` at every worker count, including `--workers=1`
and `--max-failures=0`.

That is also why the twenty `app.spec.cjs` font failures were all visible
in CI while this file's were not: that describe was never serial.

Nothing here needed serial. `beforeAll` runs once per worker, so each
```

## `src/app/routes/StartApplicationRedirect.test.jsx`

```text
That screen became the primary action inside the unified unfinished-applications
workspace on 2026-09-10, so the path has no component of its own. A recruiter
may still have it bookmarked, and internal links may still point at it.
```

## `src/app/routes/companyRouteManifest.test.js`

```text
`Started (unfinished)` and `Start an application` were two sidebar items over
one collection of drafts — `listApplicationDrafts` filters by nothing, so a
carrier-prepared draft appeared under both. They became one workspace on
2026-09-10, and this is what stops the second item drifting back in.
```

## `src/config/applicationSchema.js`

```text
The 49 CFR 40.25(j) question, and the broader one it replaced on
2026-10-06, which the Production frontend asks until it is promoted. Each
shows only on an application that answered it.
```

```text
49 CFR 391.21(b)(7): appended after the original keys (2026-09-02) so
stored rows keep their order; absent on records written before then.
```

```text
49 CFR 391.21(b)(10)(iv), asked of a job of the past three years since
2026-10-06; absent on older rows and older jobs.
```

## `src/design-system/components/badge/Badge.test.jsx`

```text
Found by the desktop and mobile visual review on 2026-08-21: a "Removed"
badge inside a `Stack` rendered as a full-width pill, because a column flex
container stretches its items across the cross axis — which for a column is
the width. jsdom has no layout engine, so this asserts the declaration rather
than the measured box; `check:table-layout` and the catalog screenshots cover
the rendered result.
```

## `src/design-system/components/file-input/FileInput.drop.test.jsx`

```text
A `<label>` forwards a click to the control it names and never a drop, so the
panel ignored what was dropped on it until 2026-08-25. What replaced that is
an explicit handler that assigns the files and dispatches a real `change`, and
these are the mechanics of it: what gets through, what `accept` refuses, and
what a disabled panel still owes the page.
```

```text
The native picker filters by `accept` in its own dialog, so a call site that
passes `accept="image/*"` has never had to check what it received. Assigning
`files` programmatically inherits none of that — so before 2026-08-25 a PDF
dropped on the company-logo control was uploaded and persisted as the logo,
leaving a broken image. `BrandingSection` passes `image/*`,
`CompanyProfileTab` uploads whatever arrives, and Storage permits PDFs in
`company_assets`; nothing else in that chain would have stopped it.
```

## `src/design-system/components/file-input/FileInput.rejection.test.jsx`

```text
Found in review on 2026-08-26 and reproduced before it was fixed.

`EnvelopeSidebar` renders `{!file ? <FileInput/> : …}` and `UploadField`
renders the picker only in its idle state, so a MIXED drop hands them a
file, they re-render, and the component's own alert is unmounted in the
commit that created it. The all-refused case was never affected: no file
arrives, so nothing unmounts.
```

## `src/design-system/components/file-input/FileInput.test.jsx`

```text
The three shapes the product actually uses.

This component shipped on 2026-08-21 and four days later had two consumers,
while nine raw `<input type="file">` controls were still in the tree — every
one carrying a comment that said no file-input contract existed. Migrating them
is what showed why: the contract existed, and its API covered one of the three
shapes. A primitive that fits a third of its call sites does not get adopted.
```

```text
Disabling the element that has focus drops focus to `<body>`, so an upload
started from the keyboard used to end with the user at the top of the
document. The two pickers this component replaced each had their own
focus-return effect; a review on 2026-08-25 caught that deleting them left
nothing here.
```

```text
The behaviour the docblocks claimed for months and did not have.

A `<label>` forwards *activation* to the control it labels, which is a click
and not a drop, and the input is clipped to 1x1 — so before 2026-08-25 a file
dropped on the dashed panel landed on the label and was discarded. Four
upload panels advertised a dropzone that ignored drops.
```

## `src/design-system/components/file-input/dropAcceptance.test.js`

```text
These ran through a rendered component and a synthetic `DataTransfer` before
2026-08-26, which tested the wiring and left the rules themselves covered only
where a component test happened to reach them. `accept` has three syntaxes and
the message has more shapes than the component has states.
```

```text
Found in review on 2026-08-26: the message said "only one.png was added"
while `rejected` was empty, which tells a caller two contradictory
things. `rejected` means what you dropped and did not get, whichever of
the two reasons applies.
```

## `src/design-system/patterns/modal/ConfirmDialog.test.jsx`

```text
Contract for the approved `ConfirmDialog` (2026-07-28).

This component replaced the last six blocking `window.confirm` guards in the
app, so its behaviour is the guarantee every one of those flows now rests on:
nothing happens until Confirm, nothing happens on Cancel/Escape/backdrop, a
confirmed action cannot fire twice, and a failure is announced without closing
the dialog.
```

## `src/design-system/tests/architecture.test.js`

```text
`shared` is a compatibility layer that imports *from* the design system, so
a dependency in this direction is a cycle. It was not enforceable until
2026-08-21: `ConfirmDialog` composes `Modal`, `Modal` lived in
`shared/components/modals`, and the pair could only move together. They now
live in `patterns/modal`, so the rule can finally be a rule.
```

```text
The JavaScript half of this rule shipped on 2026-08-21 and the README said
the boundary was enforced. It was not: the walker only looked at
`.js/.jsx/.ts/.tsx`, and `design-system/index.css` ended with

    @import '../shared/styles/designTokens.css';

for the whole campaign. A stylesheet crossing the boundary is the same cycle
as a module crossing it, and it is worse in one way — a token file loaded
from `shared` is a second source of truth for the thing this directory
exists to own, and nothing above would ever have said so.
```

## `src/design-system/tests/tokens.consumers.test.js`

```text
A 2026-09-04 audit found **fourteen** tokens that nothing used: five palette
steps, two duplicates of the brand colours under an older name, two spacing
steps, three type roles and a duration. None of them was wrong; they had
simply outlived their consumer, and nothing noticed because a token costs
nothing to keep.

That is the problem. A vocabulary nobody prunes stops being a vocabulary and
becomes a list — the next person reads `--ds-color-teal-500` beside
`--ds-color-brand-mint`, cannot tell which is live, and picks one. Thirteen
were deleted on 2026-09-05; this is what stops the next thirteen.
```

## `src/design-system/tests/tokens.test.js`

```text
`content-muted` moved from slate-500 to slate-600 on 2026-08-21 so it is
safe wherever it lands, replacing a rule that said "approved on `surface`
only" — a rule three real axe violations proved was too easy to forget.
```

```text
Every gap the 2026-08 audit found. Feature code reached for a raw palette
class in each of these places because the role had no utility to reach for,
so an unbridged role is a cause of the inconsistency, not a cosmetic
omission.
```

## `src/features/applications/components/PreservedApplicationView.jsx`

```text
A hand-composed `EmptyState` until 2026-09-06: a bordered box with
`role="status"`, a large decorative glyph, a bold line and a
supporting line. That is the pattern exactly, and roadmap §7 records
this shape as the drift no rule can see — every piece is an approved
primitive, so nothing complains.

The 40px glyph is what surfaced it. It is not a step on the icon
scale, snapping it to 32 would have been a visible change made for no
reason, and the honest answer to "which container owns this size" is
the one that owns the whole block.

The live region moves rather than doubling: `EmptyState` announces
politely and renders the `role="status"` itself, so the hand-written
one goes with the `div` that carried it. And the bold paragraph
becomes the state's heading, which puts an empty state's message in
the document outline where it belongs — `headingLevel={3}` because
this renders inside a tab under an `h2`.
```

## `src/features/applications/components/PreservedApplicationView.test.jsx`

```text
A custom file question's answer, since 2026-10-02. It used to be a filename
nothing referenced; it is the upload itself now, and the company can open it.
```

## `src/features/applications/components/SubmissionRecordNotice.test.jsx`

```text
Until 2026-09-06 this file hand-built its block and carried its own tone
map, so the check was "is `ds-status-warning` in the wrapper's class
list". It renders a `Notice` now: the tone is an attribute and the colours
live in `Notice.css`, so the class assertion is `data-tone`. The half that
matters is unchanged — no raw palette colour, in any spelling.
```

## `src/features/campaigns/CampaignsDashboard.jsx`

```text
The ids are the frozen `activeTab` contract ('drafts' | 'history'); labels and
icons are presentation only. The strip itself is the design system's `TabList`
since 2026-08-25 — it was a hand-rolled tablist with a comment saying "the
design system has no tab primitive yet", which stopped being true on
2026-08-21. It also stops being the product's fourth tab appearance: a
page-level view switcher looks like every other page-level view switcher.
```

## `src/features/campaigns/components/AudienceBuilder.test.jsx`

```text
The picker is the design system's `FileInput variant="dropzone"` since
2026-08-25. The accept list is byte-for-byte the same; what changed is that
the visible affordance is the `<label>` wrapping the input rather than a
sibling `Button` calling `.click()` on it, and `FileInput`'s `onDrop`
makes the whole panel a real drop target.
```

```text
This was the one `useBulkImport` consumer that passed no `onError`, so the
hook fell back to a blocking `alert()` and every CSV/Sheet import failure
froze the tab with a native prompt. Fixed 2026-07-28.
```

## `src/features/campaigns/components/DetailedReportModal.test.jsx`

```text
The requirement is unchanged — a tall report must never clip Close or
Retry — but the mechanism moved on 2026-09-05, and this test was
written against the mechanism.

It used to scroll the OVERLAY (`overflow-y-auto` on the backdrop) with
an auto-margin panel that could grow past the viewport. The chrome
contract scrolls the PANEL instead, capped at `--ds-dialog-max-height`
— same guarantee, and the cap is what makes it a guarantee rather than
a consequence of the page being tall enough.
```

## `src/features/companies/components/DashboardToolbar.jsx`

```text
Migrated 2026-08-21. Presentation only — the filter keys, the driver-type
option list, the `setFilters` shape, `clearFilters`, the assignment action and
the my-assignments toggle are unchanged.

This screen was the campaign's exemplar, and it is worth recording what it
looked like: four hand-built buttons with four *different* paddings
(`px-4 py-1.5`, `px-3 py-2`, `p-2`, `px-4 p-2`), a search input at `py-2` and
three filter selects at `p-2` — so no two controls in one toolbar were the
same height — plus `text-gray-900`, `bg-blue-600` and `border-gray-200`
throughout, and hand-built `text-xs font-bold uppercase` labels.

Every control now comes from the shared scale, so the row lines up without
anything being set here. The filter labels are real `FormField` labels, which
also fixes the accessibility defect underneath the styling: the filter
controls were labelled by an adjacent `<label>` with no `htmlFor` and had no
`id`, so each announced as an anonymous combobox.
```

## `src/features/companies/hooks/dashboardQueries.js`

```text
The dashboard's Firestore side, split out of `useCompanyDashboard.js` on
2026-09-01 for the source-size standard. Everything here is React-free:
```

## `src/features/companies/hooks/useCompanyDashboard.js`

```text
lives in `dashboardQueries.js` since the 2026-09-01 source-size split. This
```

## `src/features/companies/services/companyService.js`

```text
Application Rules and optional integrations (2026-09-02). Written only when
the company has them, so a company that never opened those tabs keeps the
platform defaults and its document is untouched.
```

## `src/features/company-admin/applicationPrep/ApplicationPrepEditor.test.jsx`

```text
Measured in a real browser on 2026-10-01 against the real callables: the editor
rendered "Upload Medical Card" as a text box reading "[object Object]", offered
a Social Security Number box whose contents the server silently discarded, and
took the state, licence state, endorsements and "known by other name" as free
text — so a carrier's "TX" reached the driver's state picker, which lists
names, and showed as "Alabama" while the application went on holding "TX".
```

## `src/features/company-admin/applicationPrep/PreparedEmployersPanel.test.jsx`

```text
A lock stores a snapshot of an employer's identity, and this panel used to let
the carrier go on editing the very fields that snapshot is taken from. The two
drifted, and four ordinary edits produced an application the driver was blocked
on at submission and could not fix. The sharpest: a corrected NAME on a row
locked by USDOT number trips `locked-employer-changed`, while the driver's
wizard renders that identity as a record rather than a field — so they were
blocked on the one field they are not allowed to touch. Found 2026-09-08.
```

## `src/features/company-admin/applicationPrep/applyExtractedFields.test.js`

```text
The licence prints 'TX'; the driver's state pickers hold names and
rendered the code as "Alabama" (2026-10-01), so both are filled as one.
```

```text
The reader matches a report's carrier to a row already on the application by
USDOT number or by name. It used to lock the REPORT's spelling, so a row the
recruiter typed as "Acme Trucking LLC" was locked as "ACME TRUCKING": every
carrier save kept the lock (same USDOT signature), and the driver was then
refused at submission with `locked-employer-changed` on a name the wizard shows
them as a record they cannot edit (2026-10-01). Driven here through the same
functions the save and the submission use.
```

## `src/features/company-admin/applicationPrep/mergeExtractionResults.test.js`

```text
The bug this pins was a shallow spread. The second call answers only for the
documents the model reported as unreadable, so it returns a complete shape that
is mostly empty — and spread over the first pass, `carriers: []` and an empty
`license` erased everything a readable PSP report and a readable licence had
already produced. One unreadable medical card cost the recruiter every other
field, silently, with a success message on screen.

Found in review on 2026-09-03.
```

## `src/features/company-admin/applicationPrep/unfinishedRowActions.test.js`

```text
`Started (unfinished)` and `Start an application` became one workspace on
2026-09-10, and the risk in that move is uniformity: a driver-started row
offered the same actions as a carrier-prepared one would hand a recruiter a
read they must not have. These drive the decision directly, so it is pinned
whatever any table later renders.
```

```text
The owner's decision of 2026-10-06: a Company Admin opens every row and may
delete any of them. Recruiters keep everything above.
```

## `src/features/company-admin/components/CompanyBulkUpload.a11y.test.jsx`

```text
Two polite regions in this tree since 2026-08-26: the upload picker's
own, which `FileInput` renders present-and-empty until an upload
starts, and this notice. The claim under test is that the message is
announced *politely* rather than as an alert, so it is asserted across
the polite regions rather than against a single match.
```

## `src/features/company-admin/components/modals/PEVRequestModal.a11y.test.jsx`

```text
`PEVRequestModal.test.jsx` covers the FMCSA lookup, the contact seeding and
the validation *behaviour*. This file covers what the 2026-07-27 migration is
responsible for and what nothing previously asserted: that this is a real
dialog with real focus handling, and that the delivery method is a real radio
group rather than three buttons that look like one.
```

## `src/features/company-admin/components/modals/VOEPreviewModal.a11y.test.jsx`

```text
axe cannot measure colour contrast in happy-dom, so the AA floor of the
document's small print is pinned by class instead. Real-browser axe found
slate-400 at 2.56:1 (white), 2.45:1 (the slate-50 box) and ~2:1 inside the
80%-opacity questionnaire; recoloured 2026-09-06 (audit step G) to slate-500
outside that block and slate-700 inside it, where 500 blends to 3.25:1.
```

## `src/features/company-admin/components/modals/VOEPreviewModal.export.test.jsx`

```text
## The reason, corrected 2026-09-04

This header used to say the two export paths carry no SafeHaul stylesheet, so
a `--ds-*` colour would resolve to nothing. **That is false on both paths, and
saying so was worse than saying nothing** — it invited someone to check it,
find it wrong, and conclude the whole exception was unfounded:

  1. `handleDownloadPDF` rasterises with html2canvas, which reads **computed**
     style. `var()` is already resolved before the rasteriser sees it.
  2. `handlePrint` does not write `innerHTML` into a CDN-Tailwind window. The
     pipeline was rebuilt on 2026-07-27: it clones the node as a DOM tree and
     inlines the application's own stylesheets through `collectPrintStyles`,
     which copies every readable sheet — `tokens/foundation.css` and
     `semantic.css` included. Those properties *are* there.
```

## `src/features/company-admin/components/modals/VOEPreviewModal.print.test.jsx`

```text
The print pipeline was **rebuilt** on 2026-07-27. The previous version of this
block froze the broken behaviour: five `document.write` payloads, a
`sanitizeUserContent` step and a 1 s timer. That pipeline emitted an unsigned,
unstyled text dump, because `sanitizeUserContent` is the *user-content* policy
— no `div`, no `class`, no `img` — and the document is trusted structure. See
`@shared/utils/printDocument`.

What is frozen now: the pop-up feature string, the `Print VOE` title, the
20 px body padding, and that the on-screen document node is never mutated.
What changed on purpose: the document is cloned as a DOM tree instead of
serialised and re-parsed; the application's own CSS is inlined instead of
fetched from the Tailwind CDN; and print waits on the new document's
resources instead of a flat timer.
```

## `src/features/company-admin/components/modals/driver-dossier/DossierSidebar.contract.test.jsx`

```text
The strip is the design system's `TabList` since 2026-08-25, so the ids come
from one `idBase` shared with `DriverProfileModal` (which renders the panel)
rather than from two id-builder functions passed across the prop boundary.
```

```text
the attribute optional in exactly that case. Pointing every tab at a panel
id that does not exist, which is what this used to assert, is a dangling
IDREF.
```

## `src/features/company-admin/components/modals/driver-dossier/tabs/ApplicationTab.employers.contract.test.jsx`

```text
## What could not be done before 2026-09-09

`SchemaSection` renders an `array` section as read-only `FieldDisplay` rows
whatever `isEditing` says. So a company admin could edit every scalar field on
a submitted application and **none** of the employment history — the section a
recruiter most often has to correct, since 49 CFR 391.21(b)(10) wants three
years accounted for and a driver who left an employer out or mistyped a date is
the ordinary case.
```

## `src/features/company-admin/components/modals/driver-dossier/tabs/DocumentsTab.contract.test.jsx`

```text
It is the approved `EmptyState` as of 2026-08-25, not a hand-composed
icon-and-copy block. The frozen copy is the state's heading, which is what
makes it reachable by heading navigation as well as announced.
```

## `src/features/company-admin/components/profile/ProfileAvatarField.test.jsx`

```text
The picker is the design system's `FileInput` since 2026-08-25. It was a
hidden input driven by a `Button` calling `.click()` on it — which works
with a keyboard, but names the trigger rather than the field and was one of
three ways this product opened a picker.

So the assertions move with it: the input is named by its FIELD (as every
other control in the system is), and the visible affordance is the
`<label>` that wraps it rather than a separate button. That is the
structural rule the primitive exists to enforce — a real focusable input
behind a real label, which also makes the label the browser's own
drag-and-drop target.
```

```text
This test used to assert that `aria-busy` and the button text had replaced
the `role="status"` region this component owned before the `FileInput`
migration. That was the wrong assertion to write: neither of those is
announced — `aria-busy` sits on an input the upload has just disabled and
taken focus from, and the button text is ordinary content. Rewriting the
test to match the new markup is what let a real regression through, and a
review on 2026-08-26 caught it. The region lives in `FileInput` now, so it
is asserted here as behaviour this screen still has rather than as markup
this file owns.
```

## `src/features/company-admin/components/tabs/DossierBodies.notes.test.jsx`

```text
The loading line and the empty block used to be two different shapes in
the same slot — small centred text, then a dashed bordered panel — and the
empty one announced nothing when the notes resolved. Both are the approved
page-state pattern as of 2026-08-25, which is where "the three states of
one slot look alike" is a rule rather than a habit.
```

## `src/features/company-admin/components/tabs/PEVTab.flow.test.jsx`

```text
`sendVerificationRequest` stamps a stable identity on the row it resolves —
that identity is what the employer's own answer is later filed against — and
this write used to put a snapshot of `appData.employers` back over the whole
array, erasing it a moment later. The completion write-back would then find
no row it could safely mirror onto. Found in self-review on 2026-09-09,
before it shipped.
```

## `src/features/company-admin/views/DocumentsManager.views.test.jsx`

```text
The strip is the design system's `TabList` since 2026-08-25.

`aria-controls` is on the SELECTED tab only. One panel is rendered, so
pointing all four tabs at it was fine here but is not the primitive's
contract — it renders a panel per selected tab, and an unselected tab
pointing at an id that does not exist is a dangling IDREF. The ARIA tab
pattern makes the attribute optional in exactly that case.
```

```text
The transition, not the state. Until 2026-09-06 the locked check returned
BEFORE `useEffect`, `useTemplateSendFlow` and `usePostSubmitForms`, so a
company whose profile arrived (or was edited) with E-Docs off after the
first paint changed the hook count between renders — the one thing React
forbids — and the screen threw instead of showing the lock. The static test
above renders locked from the start and can never see that; this one flips
the flag on a mounted screen, which is what the audit's lint warnings were
pointing at (three `react-hooks/rules-of-hooks` sites, all in this file).
```

## `src/features/company-admin/views/UnfinishedApplicationsPage.admin.test.jsx`

```text
The owner decided on 2026-10-06 that a Company Admin opens every unfinished
application — read-only where the driver has written — and may delete any of
them. Recruiters keep what `UnfinishedApplicationsPage.contract.test.jsx`
pins; these drive the same screen with an admin's claims, and once with a
recruiter's to show the two do not bleed into each other.
```

## `src/features/company-admin/views/UnfinishedApplicationsPage.contract.test.jsx`

```text
## And, since 2026-09-10, that a merged screen did not merge the rules

`Started (unfinished)` and `Start an application` became one place. Both
origins now share one table, so the cases below pin the three things that could
go wrong in exactly that move: a draft appearing twice, a driver-started row
offering a read it must not offer, and a link landing on the wrong applicant.
```

```text
Until 2026-09-09 this screen had one control — Refresh — because
`mintApplicationInvite` refused any draft the carrier had not itself prepared.
So a recruiter watching somebody stop at the licence page could only ask them
to start again, which throws away every answer the draft feature exists to
keep. The cases below are the workflow and the restraint that goes with it.
```

```text
The one failure that used to produce nothing at all, found in review on
2026-09-09.

`useInviteLink` records a refused mint in its `error`, and this screen never
read it — so an ended session or a spent rate limit stopped the button
spinning and left the recruiter with no link and no explanation. Exactly the
silence the clipboard case above already fixed, one step earlier: a lost link
this time, not a lost convenience.
```

## `src/features/company-admin/views/UnfinishedApplicationsPage.prep.test.jsx`

```text
Retargeted on 2026-09-10 from `StartApplicationPage`, which no longer exists as
a screen: starting an application is the primary action inside
`UnfinishedApplicationsPage`, and the wizard itself moved to
`ApplicationPrepWorkspace`. These cases deliberately still drive the whole
company flow through the page rather than the extracted component — the flow is
what a recruiter performs, and the split is an internal one.

What is pinned here is the flow this page owns — the Manual/AI choice, the AI
upload step, and that per-application state (identity, answers, documents, the
invite link) never leaks from one driver to the next — plus the two findings the
earlier review caught, now under the new flow:
```

```text
resolves, the staleness guard rejects it, and the notice never appears. The
plain-render case above passes throughout, so this is the case that has to
exist — it is the one the recruiter actually meets in a dev build, and it is
the SECOND guard in this effect to fail this way (the first cancelled its own
in-flight load). Found in review on 2026-09-10.
```

```text
This used to assert the opposite: Save was `disabled` until an email or
phone existed, and nothing on the screen said so. The precise sentence
was already written on the server and was unreachable, because the
client guard stopped the request ever being made. Changed 2026-09-08 —
`UnfinishedApplicationsPage.prepActions.contract.test.jsx` drives the same rule
through the real editor and the real fields.
```

## `src/features/company-admin/views/UnfinishedApplicationsPage.purge.test.jsx`

```text
The owner decided on 2026-10-07 that deleting one deletes the same driver's
other unfinished application too, shown first. The server's side of it is
`functions/test/unit/applicationDrafts.purge.test.js`.
```

## `src/features/driver-app/components/application/PublicApplyHandler.continuation.contract.test.jsx`

```text
The reported bug, as a test: a replacement link must not open a fresh application.

## What was measured in production on 2026-09-09

A carrier-prepared application for a driver who had reached the consent step. The
recruiter pressed "Create a replacement link"; the driver opened it; the page
rendered **"How would you like to start your driver application?"** with
"Upload CDL for Auto-Fill" and "Fill Out Manually" — the fresh-application
chooser — and no mention of the application they had spent an hour on. The
exchange returned 200 both times they tried.

The cause was on this side of the wire: `exchangeApplicationInvite` answers
`requiresIdentity` once the answers behind a link are the driver's own, that
outcome matched no branch in `resolveApplyStatusScreen`, and the chooser is what
sits at the bottom of that function. The code comment standing in for the missing
screen claimed the driver "is asked for their details by the ordinary resume flow
underneath" — a flow that only triggers on the first Next of page one, inside the
blank application the chooser had just started.

So the first case here is written as the negative the report describes, and the
rest are the outcomes a driver actually needs: their answers back, their step
back, and a way forward when the details genuinely do not match.
```

## `src/features/driver-app/components/application/PublicApplyHandler.discardIdentity.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

## `src/features/driver-app/components/application/PublicApplyHandler.discardReset.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

## `src/features/driver-app/components/application/PublicApplyHandler.discardTabs.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

## `src/features/driver-app/components/application/PublicApplyHandler.loadAndPostSubmit.contract.test.jsx`

```text
Added 2026-09-02 by the `PA-0` coverage audit, which found these two paths
characterised nowhere in the browser. The error strings were asserted only as
a prop handed to `ApplyLinkErrorScreen`, never as the container's routing;
and the production open-document path (`createPostApplicationSigningRequest`)
was pinned on the server and driven in the E2E journey's mock branch, while
the browser's payload, return path, session snapshot and navigation were not.
Same harness as the other suites; the registrations delegate to the support
module (see its header for the `CA-3` deadlock rule that shapes them).
```

```text
re-render lands a tick later. Waiting on the spy and then reading the DOM
synchronously is two different moments, and on a loaded CI runner the gap
opens: this failed there on 2026-09-05 while passing locally every time,
alone and in a full run, which is exactly the signature the repository's
own notes record for the `EditUserBodies` leak.
```

## `src/features/driver-app/components/application/PublicApplyHandler.progressResume.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

## `src/features/driver-app/components/application/PublicApplyHandler.reconcile.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

## `src/features/driver-app/components/application/PublicApplyHandler.submit.contract.test.jsx`

```text
Split from the 2203-line original on 2026-09-01 for the source-size
standard (PA-2); the shared harness lives in
PublicApplyHandler.contract.support.jsx, and every describe keeps its
original title so full test names are unchanged.
```

```text
The applicant's own calendar day, which the server judges "the last seven
days" and "expired" against when it is within a day of its own (2026-10-01).
```

```text
The day the applicant pressed Submit, so a replay is judged on the day the
page was, as the direct attempt is (found in review, 2026-10-01).
```

```text
A refusal used to be retried three times and then shown as "Application
Saved … No data will be lost", while the replay sent the same payload into the
same refusal and gave up silently: an application the driver believed sent
and the carrier never received (found 2026-10-01).
```

## `src/features/driver-app/components/application/PublicApplyScreens.gate.test.jsx`

```text
The precedence is the point. Before 2026-09-08 an unopenable, expired,
rate-limited or temporarily unavailable link resolved to `null`, was
indistinguishable from having followed no link at all, and dropped the driver
into the ordinary application — possibly pre-filled from a different
applicant's saved draft — with nothing said. Two positions in the chain are
therefore load-bearing, and both are asserted here: below a submitted
```

## `src/features/driver-app/components/application/UploadField.preview.test.jsx`

```text
An upload used to leave a signed read URL in the form data, and that signature
lives FIFTEEN MINUTES. It was persisted into the draft and handed to the driver
by the invite exchange, so a document a recruiter attached on Tuesday was a
broken image and a Storage error page by the time the driver opened their link
— and the same for the recruiter reopening their own draft an hour later. The
durable identifier was sitting beside it, unused. Found 2026-09-08.
```

## `src/features/driver-app/components/application/UploadField.test.jsx`

```text
jsdom does not implement window.confirm, so it is stubbed by assignment
rather than spied on. It is asserted *unused*: the removal prompt was a bare
`confirm(...)` until 2026-07-28 and must not come back.
```

```text
`FileInput` renders its own rejection alert, but this field renders the picker
only while there is nothing to show — so the accepted file unmounts the alert
in the commit that created it, and the applicant never learns that a second
file was turned away. Found in review on 2026-08-26.
```

```text
The picker is the design system's `FileInput variant="dropzone"` since
2026-08-25. It was a `Button` driving a `tabIndex={-1}` hidden input; it is
now a real focusable input behind a real `<label>`, which is the primitive's
one structural rule; `FileInput`'s `onDrop` is what makes the panel a real
drop target.

So the trigger is not a `<button>` any more, the input IS in the tab order,
and the visible copy is unchanged. The accessible name moved from "the frozen
visible copy plus a hidden disambiguating suffix" to the field's own label,
which is what every other control in the system announces as.
```

## `src/features/driver-app/components/application/applicationDraftStorage.identity.test.js`

```text
Half of the original `applicationDraftStorage.test.js`, split on 2026-09-01
for the source-size standard. This file keeps the identity-and-lifecycle
```

## `src/features/driver-app/components/application/applicationDraftStorage.sync.test.js`

```text
Half of the original `applicationDraftStorage.test.js`, split on 2026-09-01
for the source-size standard. This file keeps the storage-and-sync suites —
```

## `src/features/driver-app/components/application/publicApplyBootstrap.invite.test.js`

```text
 - the exchange runs BEFORE the post-apply session restore, and a successful one
   clears that session — which is what stops a 24-hour-old confirmation screen
   for this carrier hiding a live invitation (found 2026-09-08);
```

```text
Review found this on 2026-09-09, and it is the foreign-slot rule reaching one
step further than it did.

`requires_identity` used to fall through to the local-draft restore
unconditionally, so a shared or kiosk browser loaded the PREVIOUS applicant's
answers into `formData` — behind the confirmation screen, where the driver
cannot see them. They do not stay invisible: `adoptOpenedApplication` merges
the real answers over `prev` and every key the target application does not
itself hold survives, so the next autosave writes a stranger's employer rows
and upload descriptors onto this driver's DOT application. The reconciliation
effect already withheld the same slot for the same reason; this is the other
reader of it.
```

```text
The second route to the reported symptom, found in review on 2026-09-09.

A live invitation waiting on "Confirm it's you" used to fall through to the
post-apply restore, which sets `submissionStatus = 'success'` — and success
renders ABOVE the confirmation screen. So a driver who submitted an
application to this carrier in this tab within the last 24 hours, and then
opened a continuation link for a DIFFERENT unfinished one, saw the old
confirmation screen and no question at all: the intake chooser bug wearing a
different mask, and permanent, because the session is rewritten on every
load.
```

## `src/features/driver-app/components/application/publicApplyDraftSync.test.js`

```text
It runs on load and again after a continuation link's identity check, and it is
a round trip — a cold-startable callable, on a phone. Until 2026-10-01 it applied
`Math.max(current, saved)` when it landed, so a driver who went back a page in
that window was put straight back where they had been: reproduced in a real
browser against the real callables by delaying `resumeApplicationDraft` 1.5s.
```

## `src/features/driver-app/components/application/publicApplyPreflight.test.js`

```text
Both used to be refused with a toast and no routing, which left the applicant
on the signature page with no idea which page held the field (2026-10-01).
```

## `src/features/driver-app/components/application/reportSuggestions.test.js`

```text
'tx' is filled as 'Texas': the licence-state picker holds names, and given
the code it rendered "Alabama" (2026-10-01).
```

## `src/features/driver-app/components/application/steps/DynamicQuestionsStep.test.jsx`

```text
Until 2026-10-02 this recorded `file.name` the moment a file was chosen and
threw away the storage path the upload returned, so the company saw a filename
nothing referenced — and a failed upload still read as answered.
```

## `src/features/driver-changes/ReviewChangePortal.test.jsx`

```text
Before 2026-09-09 employers could not be edited at all, so this change never
appeared here. It does now, and the generic array preview renders "N item(s)" —
which asked a driver to approve **"2 item(s) → 1 item(s)"** with no way to tell
which employer had gone.
```

## `src/features/driver-changes/employerChangeSummary.js`

```text
Employers became editable on 2026-09-09, which is what turned a cosmetic gap
into a real one: before that, `employers` could not appear in a pending change
at all.
```

## `src/features/settings/components/CompanyProfileTab.test.jsx`

```text
The picker is `FileInput` since 2026-08-25: a label, not a button.
```

## `src/features/settings/components/EmailSettingsTab.test.jsx`

```text
`Link external` since 2026-08-25, instead of a hand-written
`target="_blank"`. The announcement is the whole reason the primitive
exists — target plus rel written by hand gets the new tab and the
tabnabbing fix and silently drops the WCAG 3.2.5 announcement — so the
assertion now requires it rather than just the attributes.
```

## `src/features/settings/components/IntegrationsTab.a11y.test.jsx`

```text
`IntegrationsTab.contract.test.jsx` freezes the SDK/login/Graph/callable
contracts frozen by the 2026-07-23 deep-audit. This file proves the
concrete presentation defects recorded there are fixed, without touching
(or implying a fix to) the unrelated, unfixed tenant-binding security
defect in `connectFacebookPage` — that stays out of scope.
```

## `src/features/settings/components/IntegrationsTab.contract.test.jsx`

```text
Contract freeze for `IntegrationsTab`, written before its design-system
migration. This file had zero test coverage before this campaign. It pins
the exact contracts recorded in the 2026-07-23 Integrations deep-audit
(NO-GO) so a presentation-only migration cannot silently change them:
```

```text
This freeze does NOT change, endorse, or attempt to fix the tenant-binding
defect recorded in that audit (the backend derives the tenant from
`request.auth.uid` rather than the real company id) — that remains a
separate, security-reviewed backend project. No backend file is touched
here or by the presentation migration that follows.
```

```text
`companyId` joined this payload on 2026-08-25. Before it, the callable
derived the tenant from `request.auth.uid`, which is not a company id
in this application, so every connected page wrote its leads to a tree
no screen reads. It is part of the frozen contract now.
```

## `src/features/settings/components/NumberAssignmentManager.a11y.test.jsx`

```text
`NumberAssignmentManager.test.jsx` freezes the SMS/token business logic
(cases A–O). This file proves what the 2026-07-23 deep-audit recorded as
known debt is now fixed: unlabelled per-row and default-line selects,
sub-12px status text, and color-only status indicators.
```

## `src/features/settings/components/profile/BrandingSection.test.jsx`

```text
The picker is the design system's `FileInput` since 2026-08-25, so the
input is named by its FIELD and the visible affordance is the `<label>`
wrapping it rather than a `Button` that calls `.click()` on it. Same
migration, same reasoning, as `ProfileAvatarField`.
```

```text
This test used to assert that `aria-busy` plus the button text had replaced
this component's own `role="status"` region. Neither of those is announced,
so what it really asserted was that the announcement had gone — the
migration's markup, not the screen's behaviour. Found in review on
2026-08-26. The region is `FileInput`'s now; the behaviour is still this
screen's, so this is where it is checked.
```

## `src/features/settings/components/questions/CustomQuestionsBuilder.test.jsx`

```text
The empty panel was a hand-composed dashed block with its copy in a `<p>`;
it is the approved `EmptyState` as of 2026-08-25, with the "add your first
question" control as the state's action rather than a `<div>` under the
text. The copy and the control's behaviour are unchanged — the test above
still clicks the same button and asserts the same frozen defaults.
```

## `src/features/settings/components/rules/ApplicationRulesPanel.test.jsx`

```text
`EXPERIENCE_OPTIONS` carries "0-6 months"; interpolated raw, that made an
invalid id, and axe hung on the selector happy-dom 20.4+ refuses (2026-09-06).
```

## `src/features/signing/components/envelope-creator/EnvelopeSidebar.drop.test.jsx`

```text
The picker here renders only while `!file`, so a mixed drop hands
`handleFileChange` the PDF, the branch flips, and anything the picker rendered
about the file it refused goes with it. Found in review on 2026-08-26.
```

## `src/features/signing/components/envelope-creator/EnvelopeSidebar.test.jsx`

```text
The rail sections are the design system's `Disclosure` since 2026-08-25,
which UNMOUNTS a closed panel where this component used `hidden`. Both take
it out of the accessibility tree; unmounting also takes it out of
find-in-page and screen-reader browse mode, which is the primitive's stated
reason. Safe here because the recipient fields are lifted state, so
collapsing a section loses no typed value.
```

```text
The picker is the design system's `FileInput variant="dropzone"` since
2026-08-25 — a real focusable input behind a real `<label>`, instead of a
hidden `tabIndex={-1}` input clicked by a `Button`. The frozen copy and the
accept list are unchanged; what changed is that the panel itself is the
control, and `FileInput`'s `onDrop` accepts a PDF dropped onto it.
```

```text
The delivery toggle is the design system's `SegmentedControl` since
2026-08-25 — one of the four call sites the primitive was built for. It was
a `role="group"` of `Button variant={selected ? 'primary' : 'secondary'}`,
which meant the selected state was a *button variant*: the same tokens as a
primary action, on a control that is not an action.
```

## `src/features/signing/components/envelope-creator/ResizableDraggableField.appearance.test.jsx`

```text
12x12 until 2026-09-06. Neither exception applied: the handle sits on the
field, itself a target, so Spacing fails; Alt+arrows is keyboard-only, so
Equivalent does not reach a pointer user. Half the box lies over the page
and half over the field, so the footprint inside the field is unchanged.
```

## `src/features/super-admin/components/CompaniesView.test.jsx`

```text
Two defects in one row, found 2026-08-25.

The loading and error rows put their live-region role on the `<td>`, which
REPLACES the cell role: a row whose only child is not a cell is a row
assistive technology may drop from the table altogether. And the empty row
carried no role at all, so filtering the list down to nothing replaced the
whole table and announced nothing.

`ModernDriverTable` and `DataTable` both already put the role in a wrapper
inside the cell. This asserts the same shape here, in both directions —
the role is on the wrapper, and it is not on the cell.
```

## `src/features/super-admin/components/CreateView.contract.test.jsx`

```text
Contract freeze + a11y proof for `CreateView`, written with its design-system
migration (2026-07-28).
```

## `src/features/super-admin/components/FeaturesView.test.jsx`

```text
Filtering the matrix down to nothing replaced the whole table body and
announced nothing (2026-08-25). The role goes in a wrapper inside the
cell, never on the `<td>` — on the cell it replaces the cell role.
```

## `src/features/super-admin/components/SuperAdminSidebar.icons.test.jsx`

```text
resolves them through an explicit `ICONS` map. A name the map does not have
used to resolve to `undefined`, and `undefined` does not throw — it renders
nothing, the row collapses to zero width, and the label wraps **one character
per line**, adding a hundred-odd pixels of broken navigation.

That happened on 2026-08-29: a new entry named `Inbox`, which was not
imported. Nothing failed. The unit suites passed, lint passed, the build
passed; only the visual-regression gate caught it, and only because a full-page
screenshot got taller. **A defect that is invisible to every check but a pixel
diff is one worth a cheap direct test**, which is this file.
```

## `src/features/super-admin/components/SystemHealthView.contract.test.jsx`

```text
The Deep Diagnostic, "Sync Backend Structure" and the one-off SMS history
backfill were removed (2026-10-11): the first wrote test users and records into
the live database, the second wrote schema defaults into every live record. What
stays is frozen here: the Public Profiles action and its labels, its announced
outcome, the output log, and the heading structure.
```

## `src/features/super-admin/components/modals/superAdminModals.dialog.test.jsx`

```text
Before the 2026-07-28 migration every one of these was a hand-built
`fixed inset-0` overlay: no `role="dialog"`, no focus trap, no Escape, no
focus restoration, and unnamed icon-only close controls. This file proves each
of those is fixed and freezes the callable payloads the modals own, so the
presentation change cannot quietly alter a destructive action.
```

```text
Filtering to nothing replaced the whole table with a hand-composed
icon-and-copy block that carried no live-region role, so a screen-reader
user typing in the filter got silence (found 2026-08-25). It is the approved
`EmptyState` now, which owns the announcement, and it keeps the two distinct
strings — "nothing matches your filter" must not read as "nothing exists".
```

## `src/features/super-admin/components/users/EditUserBodies.contract.test.jsx`

```text
These were missed by the 2026-07-28 Super Admin dialog pass — `EditUserModal`'s
shell was migrated while both bodies stayed fully legacy (blocking
`window.confirm`/`alert`, `title`-only icon-button names, an unlabelled per-row
role select, a 2.56:1 grey, an unnamed scroll region). Migrated 2026-07-28.
```

```text
That cost a `frontend-quality` failure on 2026-09-06, on a change that touched
only documentation and tooling. Reproduced by resolving the memberships one
macrotask later: three tests fail with the exact CI messages.
```

```text
That is what failed on 2026-08-26: "offers only companies the user is not
already in" relies on the default membership in `co-1` being filtered out
of the select, got a leaked `{ docs: [] }` instead, and reported
`['', 'co-1', 'co-2', 'co-3']`. It passed in isolation and passed a full
local run of all 4470 tests, because the leak needs the timing to slip.
```

```text
The first paint after the memberships promise resolves competes with the
whole 4,500-test CI run for the event loop; the default 1 s findBy
timeout expired once on a loaded runner (2026-09-01) with the load
itself already confirmed. The generous timeout is on the initial-load
assertions only — the same family, fixed together.
```

```text
Locally the load almost always resolves inside `findBy`'s own polling and
this passes. On a loaded CI runner the gap opens, and it did: this exact
message, on 2026-08-26 and again on 2026-09-06.
```

## `src/features/super-admin/views/UnifiedDriverList.bulkSafety.test.jsx`

```text
Operator-safety regression guard for the Unified Driver Database's bulk
actions — third and final shape (2026-09-06).

The history this file guards against, in order:

 1. Message / Assign / Move Status / Archive were placeholders that fired a
    **success** toast and did nothing. Archive also asked
    `window.confirm("Are you sure you want to archive N records?")`, so an
    operator could confirm a destructive-sounding action on real driver records
    and be told it had succeeded.
 2. From 2026-07-28 the four controls stayed visible but disabled and labelled
    unavailable, so the owner decision stayed visible too.
 3. The decision (2026-09-06): controls that do nothing are not shown. The bar
    and the row-selection checkboxes that existed only to feed it are removed.
    A real bulk action returns together with its selection when a recruiter
    asks for one.

This file fails if any earlier shape comes back: no selection checkboxes, no
```

## `src/features/verification/VerificationPortal.closeout.test.jsx`

```text
`VerificationPortal.test.jsx` (2026-07-23) froze the token load, the
conditional reveals, the submit payload and the status screens, and it mocks
`SignaturePad` away. This file covers what that slice left open and what this
campaign changed:
```

## `src/features/verification/VerificationPortal.typedSignature.test.jsx`

```text
The typed signature path through the real form (audit step J, 2026-09-06):
a respondent who cannot use a pointer can still sign — by choosing "Type" and
typing their name — and what reaches the callable says so.
```

## `src/hooks/useSubmissionQueue.test.js`

```text
Left out, a replay was judged on the server's UTC day: after 8 p.m. Eastern
that is tomorrow, and an Hours of Service statement the page accepted is the
wrong week (found in review, 2026-10-01).
```

## `src/main.jsx`

```text
The pdf.js worker wiring that used to sit here moved to `@lib/pdf/pdfWorker`,
imported by the PDF features themselves, so the 117 kB pdfjs chunk no longer
ships to every route (2026-09-06, audit step I).
```

## `src/shared/components/admin/BulkUploadLayout.a11y.test.jsx`

```text
The picker is `FileInput variant="dropzone"` since 2026-08-25, so the
clipping class is the design system's own rather than Tailwind's `sr-only`.
The property under test is unchanged and is the whole point of the rule:
`display: none` and `visibility: hidden` both take the input out of the tab
order, and the picker with it.
```

```text
Two polite regions in this tree since 2026-08-26: the upload picker's
own, which `FileInput` renders present-and-empty until an upload
starts, and this notice. The claim under test is that the message is
announced *politely* rather than as an alert, so it is asserted across
the polite regions rather than against a single match.
```

## `src/shared/components/feedback/CrashAndQueueSurfaces.contract.test.jsx`

```text
Written on 2026-09-06, after the icon migration shipped `<Icon icon={X} />`
into all three of them while the import line still read
`import { Home, RefreshCw } from '@design-system/icons'` — no `Icon`. Every
one of those files throws `ReferenceError: Icon is not defined` the moment it
renders, and `QueueStatusIndicator` mounts at the App root, so going offline
took the whole application down.

Nothing caught it. Not the 5170 unit tests, because these three render only on
a crash or an offline queue and no test had ever rendered them. Not lint,
because plain `no-undef` does not resolve JSX identifiers — that is what
`react/jsx-no-undef` is for, and it was off. Not the icon check, which looked
for `lucide-react` imports and is blind to what a file renders. Only the
`@a11y` end-to-end lane failed, at a 180-second timeout whose message named a
checkbox rather than the error.

The general fix is the lint rule, now on and pinned by
`scripts/test-lint-rules.mjs` M1. This file is the specific one: it renders each of these surfaces at
least once, so a crash screen can never again be shipped in a state where it
crashes.
```

## `src/shared/components/feedback/ToastProvider.contract.test.jsx`

```text
Contract freeze + a11y proof for `ToastProvider`, written with its visual
migration (2026-07-28) — the roadmap's "Toast/notification" row.
```

```text
The migration changes only presentation (semantic status tokens instead of nine
legacy palette classes, an approved `IconButton` instead of a hand-rolled 28 px
box, a viewport-safe stack) plus one additive accessibility fix: the severity
is now announced before the message.
```

## `src/shared/components/form/RadioGroup.test.jsx`

```text
`EXPERIENCE_OPTIONS` really carries "0-6 months". Interpolated raw, the id
was invalid HTML (no ASCII whitespace allowed) and axe hung on the selector
it built from it under happy-dom 20.4+ (found 2026-09-06).
```

## `src/shared/components/schema/SchemaRenderer.test.jsx`

```text
Edit mode is used by exactly two screens — the carrier's prep editor and the
dossier's Edit Application — and until 2026-10-01 every type fell through to a
text box. These pin what each type is now, in the format the driver's wizard
reads, because a value the wizard cannot show is a value the driver never saw.
```

## `src/shared/components/signature/SignaturePad.contract.test.jsx`

```text
`SignaturePad` collects the legally operative mark on an FMCSA 49 CFR §391.23
employer verification. The 2026-07-23 portal migration deliberately left it
untouched, so it went into this campaign as the last unmigrated surface — with
raw palette classes, no accessible name, an unassociated error, and a bare
`<button>` clear action.
```

## `src/shared/components/table/ModernDriverTable.contract.test.jsx`

```text
Contract freeze + a11y proof for `ModernDriverTable`, written with its
design-system migration (2026-07-28) — the roadmap's oldest open table row.
```

## `src/shared/services/fmcsaEmployerSocrata.test.js`

```text
DC joined the shared state list on 2026-10-02, so a DC carrier's state fills in.
```

## `src/shared/utils/usStates.test.js`

```text
Listed since 2026-10-02; before that a DC licence or address had nowhere to go.
```

```text
The territories, listed since 2026-10-09; their licences print these codes.
```

## `src/tests/auth.test.jsx`

```text
The first version mocked the sign-in to resolve after a 100 ms `setTimeout`,
asserted the button was disabled, and returned. The timer then fired while
the file's environment was tearing down; `loginUser` threw on
`undefined.user`, `LoginScreen`'s catch called `console.error`, and Vitest
failed the whole run with `EnvironmentTeardownError: Closing rpc while
"onUserConsoleLog" was pending` — 5210 tests passed, exit code 1. Twice in a
row in CI on 2026-09-08, on a change that touched only `functions/`.
```

## `src/tests/brandAssets.test.jsx`

```text
A FIFTH literal copy of a brand value lives in the same file, three lines
above the favicon, and nothing compared it until 2026-09-06:
```

```text
attribute is outside what that guard claims to check, by design. It was
therefore guarded by nothing at all, which is the exact condition this file
opens by describing: a copy nothing compares is a copy that diverges.
```

```text
...and the colours have to survive the render, which is a different claim
from "the source names a token" and turned out to be the one that mattered.

When the raw hexes were replaced with `style={{ fill: 'var(--ds-…)' }}` on
2026-09-05, three of `SafeHaulLoader`'s paths ended up with TWO `style`
attributes — the new fill, and the animation delay that was already there.
JSX keeps the last one, so the fill was dropped and three quarters of the
loading mark rendered unfilled. Every existing check passed: the source
contains the token, contains no hex, and draws the right paths.

Vite printed a warning about it, and a warning in a build log is not a
guard. This renders both marks and reads what actually reached the DOM.
```

## `src/tests/mockResetHygiene.test.js`

```text
queues one its component never consumes leaks it into the next test. That
cost a real CI failure on 2026-08-26, and the 2026-09-06 audit found the same
pairing in 23 more files. All were converted to `vi.resetAllMocks()` in one
change; this test keeps the family closed by refusing any test file under
`src/` that pairs the two again.
```

## `src/tests/noBlockingBrowserDialogs.test.js`

```text
Added 2026-07-28 when the last of them was replaced. Blocking browser dialogs
came back three separate times during the design-system migration, each time
because a *bare* `confirm(...)` slipped past a scan that only looked for
`window.confirm`. This test looks for both forms so that cannot happen again.
```

## `src/tests/pageShell.test.js`

```text
It carried Tailwind's raw `bg-gray-50` for the entire design-system campaign
and was fixed to `bg-ds-canvas` on 2026-09-06. **Neither guard that looks at
this file can see it go wrong again**, and both limits were measured rather
than assumed:

- `check:ui-contract` reaches `index.html` (since 2026-09-05) but its
```

```text
So the swap was invisible to every automated check the repository has, in
both directions. That is precisely the shape of thing that needs a test
naming the intended value.
```

## `src/tests/pdfWorkerWiring.test.js`

```text
    imports `react-pdf`, or the 399 kB pdfjs chunk ships to every route again
    (audit step I, 2026-09-06: it was preloaded on `/apply` and `/login`).
```

## `src/tests/uiContract.ratchet.test.js`

```text
The two shapes the rule could not see until 2026-09-05. Every raw
colour still in this tree is spelled one of these ways: the brand
marks used SVG attributes, and the signature pads assign to a canvas
context. Widening the rule to cover them found four unrecorded sites.
```

```text
This asserted 0 until 2026-09-05, and the exemption was correct at the
time: `overlayClassName` was the approved way to position a dialog, its
values legitimately contain `fixed inset-0`, and counting them would
have fired on 20 correct call sites. `Modal` removed the prop once
every call site moved to the chrome contract, so the exemption's whole
premise is gone — and the rule now means what the roadmap always
claimed it did.
```
