# Archive: dated notes moved out of code comments (2026-10)

> **History, not instructions.** These are the dated defect, migration and review
> notes that lived in code comments, copied here verbatim and grouped by file,
> with only the comment markers removed. The code now states each rule in a line
> or two. Read this only to learn *why* a rule exists: the defects, measurements
> and review rounds behind it. Do not follow it as current guidance where the
> code differs.

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
