# Archive: dated notes moved out of code comments (2026-10)

> **History, not instructions.** These are the dated defect and review notes that
> lived in code comments, copied here verbatim and grouped by file, with only the
> comment markers removed. The code now states each rule in a line or two. Read
> this only to learn *why* a rule exists: the defects, measurements and review
> rounds behind it. Do not follow it as current guidance where the code differs.

---

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

## `src/features/driver-app/components/application/publicApplyDraftSync.js`

```text
`Math.max`: never move an applicant *backwards* from where they already
are in this session — and never *forwards* past a Back they pressed while
this was in flight. That press is their answer to "where am I", and the
fetch is a cold-startable round trip: until 2026-10-01 a driver who
confirmed their identity on a continuation link, or reloaded, and went back
a page inside that window was put straight back where they had been.
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

## `src/features/driver-app/components/application/steps/Step2_Qualifications.jsx`

```text
Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
primitives and the shared `RadioGroup` adapter (2026-07-27). Field keys,
`YES_NO_OPTIONS` / `EXPERIENCE_OPTIONS`, the conditional drug-test
explanation, the DOT question wording (except as noted below), and the VAL-1
`form.checkValidity()` gate are unchanged.
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

## `src/features/driver-app/components/application/steps/components/BusinessInfoSection.jsx`

```text
Owner-operator business details. Presentation migrated to the approved
`FormSection` primitive and the shared field adapters (2026-07-27); every
field key (`ein`, `driverInitials`, `businessName`, `businessStreet`,
`businessCity`, `businessState`, `businessZip`), element id and required flag
is unchanged — `business-state` stays optional.
```

## `src/features/driver-app/components/application/steps/components/EmergencyContactsSection.jsx`

```text
Two emergency contacts. Presentation migrated to the approved `FormSection`
primitive and the shared field adapter (2026-07-27); the `ec1*` / `ec2*` field
keys and element ids are unchanged.
```

## `src/features/driver-app/components/application/steps/components/VehicleExperienceSection.jsx`

```text
DEFECT FIXED (2026-09-02): the selects fell back to `'0'` and `'<6 months'`,
neither of which is in its option list, so the control silently displayed the
FIRST option ("Student / Recent Grad") while nothing was saved. An unanswered
select now shows a placeholder, and a stored value the current options do not
contain is rendered as its own option so it stays visible and unchanged.
```

## `src/features/driver-app/hooks/useInviteIdentityCheck.js`

```text
Dismissed by the same flag as the link-problem screen, because it offers
the same explicit way out: starting a fresh application is a choice the
driver makes and never a fallback that happens to them. Until 2026-09-09
this outcome had no screen at all, and that fall-through to the intake
chooser is the reported bug.
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

## `src/shared/components/signature/SignatureInput.jsx`

```text
Until 2026-09-06 the verification portal offered only `SignaturePad`, a
canvas — which has no keyboard or assistive-technology path at all, and which
the roadmap carried as an open decision because a typed mark rendered into
the same PNG as a drawn one would be indistinguishable in the record.
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

## `src/shared/services/fmcsaEmployerSocrata.js`

```text
Separate queries rather than `$order` on the status, which would have Socrata
sort every match; each of these answered in about 0.3 s (2026-10-07).
```

## `src/shared/utils/dateFormHelpers.js`

```text
@param {string} value — YYYY-MM, legacy mm/yyyy or MM/YYYY, or a full
  YYYY-MM-DD (its month and year: employment and school dates were stored
  with a day until 2026-10-06, and a row saved then still shows its month)
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
