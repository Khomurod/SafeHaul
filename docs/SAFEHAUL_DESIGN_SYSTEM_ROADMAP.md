# SafeHaul design-system standard and roadmap

**Mandatory reading before any UI, UX, styling, responsive, accessibility or
visual-component change.** Read it together with
[`src/design-system/README.md`](../src/design-system/README.md) and the relevant
component/pattern docs.

This file holds the **permanent rules, the approved exceptions, the automated
guardrails and the decisions that are still open**. It is not a history of the
migration — that lives in Git. Record here only what a future change could get
wrong.

---

## Status legend

- `[ ]` Not started · `[~]` In progress · `[x]` Completed and verified ·
  `[!]` Blocked or requires an owner decision

`[~]` and `[!]` are project conventions. If a renderer shows them as ordinary
unchecked boxes, the text status is authoritative.

---

## 1. Non-negotiable architecture

- The design system controls reusable visual appearance and interaction.
- Feature folders control feature content, available actions, and
  domain-to-UI mapping.
- Hooks and services control data, state, integrations, and business logic.
- `src/app` controls composition, routes, guards, and providers.
- Feature screens stay with their features and consume approved design-system
  components.
- **The design system must never know what a driver, recruiter, application,
  lead, campaign or company is.**
- No UI work may change Firebase rules, database structures, backend behaviour,
  integrations, permissions, routes, feature flags or business workflows merely
  to simplify UI code.
- Legacy styles are removed only after all known consumers migrate and the
  replacement is functionally, visually, responsively and accessibly verified.

### What UI work must not change

- route URLs, authorization, role checks, and feature flags;
- Firebase rules, indexes, data shape, Cloud Functions, or integrations;
- submission, campaign, recruiting, verification, signing or document workflows;
- PDF field geometry, signing coordinates, upload semantics, or offline queues;
- domain status vocabulary, without a separate product decision;
- feature ownership of screens and actions;
- branded artwork, unless accessibility or consistency requires an approved
  adjustment.

---

## 2. Target architecture

```text
src/
├── design-system/
│   ├── tokens/       # Primitive scales, semantic roles, Tailwind bridge
│   ├── components/   # Business-neutral accessible primitives
│   ├── patterns/     # Reusable compositions and UI states
│   ├── layouts/      # Page/region geometry, no route or domain knowledge
│   ├── icons/        # Approved icon contract and branded exceptions
│   ├── stories/      # Component catalog and supported-state examples
│   └── tests/        # Boundary, contrast, a11y, interaction tests
├── features/         # Screens, feature components, domain adapters/actions
├── shared/           # Compatibility UI plus cross-feature non-domain utilities
├── hooks/            # Cross-feature state/data hooks
├── lib/              # Integrations and infrastructure
└── app/              # Routes, guards, providers, composition
```

### Layer contracts

| Layer | Owns | Never |
|---|---|---|
| `tokens` | Primitive scales and semantic roles (content, surface, action, status tone, table role) | Palette names in feature code |
| `components` | Button, IconButton, Field primitives, Card, Badge, Progress, StatusMedallion, table building blocks. Generic props only | Domain vocabulary |
| `patterns` | PageState, EmptyState, FormField, dialog sections, DataTable toolbar/pagination, responsive presentation | Data fetching, feature permissions |
| `layouts` | AppFrame regions, PageContainer, PageHeader, Stack, Inline, split panels | Route knowledge. `CompanyAppShell` stays in its feature because it knows company navigation and deactivation |
| `features` | Domain language, screens, available actions, adapters such as `applicationStatus -> { tone, icon, label }` | Reusable visual primitives |
| `shared` | Existing compatibility components and non-visual cross-feature utilities | New long-term visual primitives — those go to `design-system` |
| hooks / services | Data, mutations, subscriptions, integration calls, validation, business state | Presentation |
| `app` | Routing, guards, providers, error boundaries, feature registration | Becoming a component dumping ground |

A component is **approved** only once it ships with documented states,
interaction tests, accessibility tests and catalog examples.

### Dependency direction

```text
app -> features -> design-system
       features -> hooks/services/lib
       features -> shared (temporary or non-visual)
shared compatibility UI -> design-system (during migration)
design-system -> React/presentation libraries only
```

The reverse directions are prohibited and enforced by
`src/design-system/tests/architecture.test.js`.

---

## 3. Rules for writing UI

- **Reuse approved components and semantic `--ds-*` tokens.** Do not create a
  local button, modal, form control, table, status treatment, arbitrary colour,
  unsupported font size or competing visual primitive unless this file records
  the missing capability **and** the code documents the temporary exception.
- **No 9px or 10px body text.** The floor is 12px for interface text.
- **One control scale, and the default is the aligned case.**
  `--ds-control-height-{sm,md,lg}` is 36 / 44 / 52px and is read by `Button`,
  `IconButton`, `Input`, `Select` and `Textarea`, all defaulting to `md`. Do not
  set a size to make a control match its neighbour — the default already does.
  `lg` is for the primary action of a public, mobile-first, single-task screen.
  A thing that is not a control must not read a control height.
- **Icon size inside a control belongs to the design system, and so does the
  space beside it.** `Button` sizes any contained `svg` from the step's icon
  token, which outranks the width/height attributes an icon library renders —
  passing `size={24}` to a glyph in a button does nothing, deliberately. The gap
  between that glyph and its label is `--ds-space-2` on `.ds-button`, inherited by
  `.ds-button__content`, so a call site does not set it either.
  `check:visual-contract` measures both halves at all three sizes; until
  2026-08-25 it measured only the icon.
- **Status is never colour alone** — always text or icon plus tone.
- **A state must announce itself.** Loading and empty are `role="status"`
  (polite); errors are `role="alert"`. Use `EmptyState` / `ErrorState` /
  `LoadingState` from `@design-system/patterns`, which choose for you. A polite
  error is silent until the user happens to navigate to it; an assertive empty
  state interrupts them to say there is nothing.
- **A busy control is a state too, and `aria-busy` is not an announcement.**
  Nothing reads `aria-busy` off a control that `loading` has just disabled and
  taken focus from, and a button label that changed from "Upload logo" to
  "Uploading…" is ordinary content, not a live region. The primitive that owns
  the `loading` prop owns the region that goes with it — `FileInput` renders one
  polite `role="status"`, always present and empty when idle, because a live
  region has to exist before it fills for the fill to be announced. Recorded
  2026-08-26: the `FileInput` migration deleted the two regions the avatar and
  logo pickers had and put `aria-busy` plus a label change in their place, and
  the feature tests were rewritten to assert the replacement — so both screens
  went silent with their tests green.
- **Restoring focus is a claim about where focus was.** A component that disables
  itself may put focus back where the disabling took it from, and it must decide
  by asking what was focused — never by which event delivered the data.
  `FileInput` armed its restore on any `change`, and its own drop handler
  dispatches one from the input, so a dragged-and-dropped upload ended with focus
  inside a clipped 1×1 file input the user had never touched (2026-08-26).
  `document.activeElement === theControl` at the moment the data arrives is the
  whole question; `<body>` afterwards means "there is nothing to steal from", and
  never "this focus was mine".
- **A link navigates; a button acts.** Use `Link` / `ButtonLink` /
  `IconButtonLink`, never a styled `<a>` and never a `<button>` dressed as a
  link. Pass `external` instead of hand-writing `target="_blank"`, so the new
  tab is announced and `rel` closes the reverse-tabnabbing hole.
- **`--ds-color-content-muted` is safe on every surface.** It is slate-600 as of
  2026-08-21 (8.6:1 on `surface`, 7.0:1 on `surface-subtle`, 6.4:1 on
  `status-warning-bg`). It was slate-500 and approved on `surface` *only*, which
  three real axe findings proved was a rule too easy to forget. There is no
  per-surface rule left; `tokens.test.js` asserts AA on every pairing including
  the two that used to fail. Existing `content-secondary` call sites that were
  working around the old limit are correct and need no change.
- **Every overlay goes through `Modal`** (`@design-system/patterns`). No
  hand-built `fixed inset-0` dialog. A repository-wide scan should return only
  `Modal` itself and callers passing it an `overlayClassName`.
- **No blocking browser dialogs.** `confirm()` and `alert()`, with or without a
  `window.` prefix, are rejected by a ratchet test — use `ConfirmDialog`.
- **Scroll regions must be keyboard-reachable and named**, and every row action
  needs a record-specific accessible name.

---

## 4. Verification matrix

Apply checks proportionally, and **never claim an unrun check**:

| Change type | Minimum required checks |
|---|---|
| Documentation only | Markdown/link review, diff inspection |
| Tokens/Tailwind | Token tests, contrast tests, build, lint, generated CSS/diff review; consumer visual/mobile review when used |
| Primitive component | Unit/interaction, axe, build, lint, desktop and mobile visual, keyboard |
| Table | Unit/interaction, axe, desktop/mobile Playwright, alignment screenshots, data extremes, feature behavior, `npm run check:table-layout` |
| Dialog/form | Unit/interaction, axe, keyboard/focus, desktop/mobile visual, feature save/cancel/error behavior |
| Feature migration | Existing feature tests, relevant backend contract tests if touched, desktop/mobile E2E, visual regression, axe |
| Rules/backend (normally out of scope) | Explicit approval, backend tests, rules emulator, contract tests, security review |

**Definition of done** for any item in this file — all applicable checks pass:

1. implementation is complete;
2. existing behavior is preserved;
3. relevant tests pass;
4. desktop visual behavior is reviewed;
5. mobile behavior is reviewed where applicable;
6. keyboard and accessibility behavior is reviewed;
7. documentation and catalog examples are updated;
8. the final diff contains no unrelated changes.

If a check cannot run, say so, and leave the item open or `[!]`. **Never mark
work complete because code exists.**

---

## 5. Approved, evidenced exceptions — these are not debt

Do not "fix" these without reading why they exist. Each is recorded in the
component itself as well.

- **`ModernDriverTable` does not adopt `DataTable`.** It combines consumer-owned
  `render()` columns with per-cell `stopPropagation`, row activation, per-row
  selection *and* a footer pager, plus a caller `getRowClassName` with no
  `getRowTone` equivalent. `DataTable` is a display-table contract and that
  combination is unproven on the highest-row-count surface in the product. 33
  contract tests assert everything `DataTable` would have supplied, so no
  accessibility debt hides behind the exception. One consumer remains:
  `UnifiedDriverList`.
- **`DataTable` is not adopted for editable matrices or per-row interactive
  rows.** `FeaturesView`, `AssignmentTable`, `LineManager`, `CompaniesView`,
  `CampaignResultsTable` and `DetailedReportModal` use the approved native-table
  pattern with `--ds-*` tokens instead. The approved `DataTable` is proven only
  for display tables.

  Four more were confirmed against this rule on 2026-08-21 and now read the
  `--ds-table-*` roles explicitly rather than resolving to the same values by
  coincidence: `AnalyticsView` (three linked tables sharing one scroll region,
  each with per-row actions), `ViewCompanyAppsModal` (a per-row filter control
  inside a dialog), `StatsBackfillPanel` (an operator console with six per-row
  actions and live progress) and `UsersView` — the last because it sits inside a
  virtualised scroll region, and `DataTable` owns its own scroll container, so
  adopting it would nest two and reproduce the dead-gutter defect
  `check:table-layout` exists to catch.

  **A native table is not a licence to style a table by hand.** That sentence has
  been here since the pattern was approved, and on 2026-08-25 it was measured for
  the first time: **seven of the eleven referenced no `--ds-table-*` role at
  all**, and the four that did referenced one or two. They looked right because
  `bg-ds-surface-subtle` happens to be what the header role resolves to — a
  coincidence a re-tuned role would have broken in silence — and their inline cell
  padding had already drifted to three values (24px, 20px, 16px) against a
  contract of 20px.

  **"Eleven" is a count of files, and it is worth being exact about, because the
  guard is not.** Eleven feature files carry an approved `raw-table` exception,
  and between them they hold **fifteen** `<table>` elements, because three files
  carry more than one: `FeaturesView` ×2, `ModernDriverTable` ×2 and
  `AnalyticsView` ×3. **All fifteen apply `ds-native-table`, the invisible one
  included** (`AnalyticsView.jsx:128`, `className="sr-only ds-native-table"`).

  That is a correction, and the reasoning behind it is the useful part. There used
  to be a carve-out for a table nobody sees — the text equivalent of the chart
  above it has no appearance to put on contract, which is true. The *inference*
  was the problem: deciding "is this hidden?" from a class list means deciding it
  across Tailwind's whole variant space, and `sr-only xl:not-sr-only` is hidden on
  a phone and visible on a desktop. That pattern is already in this repository
  (`DossierHeader.jsx`), so it was not hypothetical. Rather than guard an
  open-ended axis, the axis is gone. Measured in a real browser first: `sr-only`
  keeps `position:absolute` and `clip:rect(0,0,0,0)`, so the element stays
  invisible whatever the contract does to its box.

  Counting **tables rather than files** mattered on 2026-08-25 for a separate
  reason: the first version of the tether check asked whether the *file* mentioned
  the class, which a three-table file satisfies with one. See the guardrail table
  in section 7.

  `ds-native-table` (`components/data-table/nativeTable.css`) is that contract — using `height` on body cells rather than `min-height`, which CSS leaves undefined on a table-cell box and browsers ignore, so the density role was a no-op until 2026-08-25:
  header surface and foreground, divider, row background, hover, cell padding and
  row height from the same roles `DataTable` reads, including the narrower inline
  padding under 768px that `DataTable` has always had. All eleven apply it,
  `check:ui-contract` fails any approved `raw-table` file that does not, and
  `check:table-layout` measures native tables in a real browser — until then **no
  native table was measured anywhere**, so the guard written because a Delete
  button rendered as "Dele" on a phone had been looking only at the catalog's four
  `DataTable`s.
- ~~**`CallOutcomeModalUI`'s outcome grid stays a `role="group"` of raw
  `<button aria-pressed>` cards.**~~ **RETIRED 2026-08-25.** It is
  `SegmentedControl`, as are the dossier summary toggle, the e-doc
  delivery-method toggle and the change-review decision group. The primitive
  keeps exactly that semantic — `role="group"` + `aria-pressed`, deliberately not
  a radiogroup — so nothing about how these announce changed.

  **The PEV FMCSA rows were listed here and do not fit, which was an error in
  this file.** An FMCSA suggestion row is a three-line record summary — legal
  name, USDOT and location, then whether FMCSA listed contact details — and
  `SegmentedControl` takes a string `label`. It cannot express one, however well
  the semantics match. That is the SelectableCard/Listbox gap below, and the
  allowlist entry says so.
- ~~**File inputs stay local.**~~ **RETIRED 2026-08-25.** Seven of the nine
  migrated to `FileInput`: `BulkUploadLayout`, the driver application's
  `UploadField`, the dynamic-questions upload, `BrandingSection`,
  `ProfileAvatarField`, the campaign recipient import and the e-doc envelope
  creator. `DQFileTab` and `EditCompanyModal` were already on it.

  Migrating them is what revealed why the primitive had two consumers rather than
  nine: it covered **one of the product's three shapes**. `variant="dropzone"`,
  `loading` and `labelHidden` exist now, and the roadmap's lesson is the general
  one — *a primitive that fits a third of its call sites does not get adopted.*

  Two remain, and both are **programmatic** pickers rather than under-served
  ones: `PEVTab`'s per-employer result upload (the affordance is a table row
  action) and `IntakeChooser`'s CDL scan (the affordance is one of two intake
  choice cards). `FileInput` is a visible control by contract, so neither is a
  gap in it.
- ~~**Styled `<a>` navigations stay local.**~~ **RETIRED 2026-08-21.**
  `Link`, `ButtonLink` and `IconButtonLink` exist
  (`components/link`). The remaining feature-owned anchors are being migrated to
  them; a new styled `<a>` is a violation, not an exception. Pass `external`
  rather than hand-writing `target="_blank"` — every external anchor in the
  product opened a new tab with no announcement, which is a WCAG 3.2.5 failure,
  and the primitive exists mainly to fix that.
- **`VOEPreviewModal`'s generated 49 CFR §391.23 document keeps its raw palette
  and its sub-12px type.** It is rasterised by html2canvas into a bare print
  window with no `--ds-*` custom properties, so a token would resolve to
  nothing. Enforced in both directions by `VOEPreviewModal.export.test.jsx`.
- **`DeviceMockup` keeps literal greys and `text-[10px]` — it is artwork, not
  interface.** The component draws a picture of a physical phone. The status-bar
  time is that small because a real one is, and the bezel, side buttons and
  battery pips are moulded plastic, not a surface of the SafeHaul interface.
  Mapping the bezel onto `--ds-color-surface-inverse-subtle` would look
  identical today and would mean that re-tuning the console surface silently
  restyles a picture of a phone. Migrated 2026-08-24 to declare that palette
  once, in a named `DEVICE` constant at the top of the file, so it is four
  reviewable literals rather than ten anonymous classes. The *screen* is the
  other way round: what renders on it is SafeHaul's own preview content, so it
  takes `--ds-color-surface` like any other drawn surface.

  Two real defects were fixed in passing. Its `dark:` variants were the only
  ones in the application, so under an OS dark preference the phone half-inverted
  while every screen around it stayed light; they are gone. And the simulated
  status bar was in the accessibility tree, so a screen reader announced a fake
  clock before the message — it is now `aria-hidden`, while the message itself
  stays readable.

- **`SignerField`, `ResizableDraggableField` and `AiSuggestionOverlay` keep
  hand-built controls, because the PDF owns their geometry.** These overlay
  author-placed field boxes whose size comes from the document's own
  coordinates and can be as small as 8px. Every approved control carries the
  shared 36/44/52px control height and inline padding, which would break
  alignment with the PDF underneath. All of them keep an accessible name, a
  focus-visible ring and `--ds-*` tones. Retiring them needs a compact
  icon-button step and a geometry-free field in the design system.
- ~~**Hand-rolled tab strips.**~~ **RETIRED 2026-08-25.** All eleven adopted
  `TabList` / `TabPanel`. `check:ui-contract`'s `hand-rolled-tablist` rule is what
  keeps the twelfth from being written — the primitive shipped on 2026-08-21 and
  had **zero** consumers four days later, which is what a roadmap line buys
  without a guard.

  Two shapes were added so the primitive could fit its call sites rather than
  half of them: `variant="pill"` for a secondary strip inside a panel, and
  `fitted` for a strip that must span a narrow popover. Two defects in the
  primitive itself were fixed on the way: `aria-controls` pointed every tab at a
  panel that does not exist, and selection was appended to the accessible *name*
  as a hidden "(selected)" — now a `forced-colors` rule, which is where a
  colour-only concern belongs.

  One deliberate behaviour change: the dossier's vertical rail answered both
  arrow axes and now answers only the one its `aria-orientation` announces. That
  is the ARIA pattern, and the primitive's reason is specific — a vertical strip
  that also ate Left/Right would take the horizontal scroll keys from the region
  around it.
- ~~**`EnvelopeSidebar`'s `RailSection` disclosure header.**~~ **RETIRED
  2026-08-25.** It is `Disclosure`, the consumer that primitive was built for.
- **`EnvelopeSidebar`'s field-palette tiles stay raw `<button>`s.** They are
  colour-coded per field type — domain-to-visual mapping the feature owns, and
  `Button` has no API for it. Same family as the PEV FMCSA rows: there is no
  approved SelectableCard/Listbox primitive.
- **`LoginScreen`'s hero wash and `IntegrationsTab`'s Facebook tile keep raw
  hexes.** The hero's three blobs are artwork: blurred over 256–384px,
  `aria-hidden`, no information in them. Everything on that panel that carries
  meaning now uses the named brand roles. `#1877F2` is Facebook's mark, not a
  SafeHaul role, and must not move when this product's palette does.

- **The `web/` public site is out of scope, and deliberately so.** The
  marketing site that used to live in `landing/` has been removed; what remains
  is hand-written CSS with no build step, no framework and no Tailwind, dressing
  the server-rendered blog and a standalone privacy page. It keeps its own
  approved visual specification in `DESIGN.md` — a paper/graphite/ink language
  with Archivo display type, quite different from the application's on purpose.
  "Public pages" in this campaign means the public *application* routes
  (`/apply/:slug`, `/verify/:token`, `/review-change/:token`, `/sign/...`,
  `/login`), all of which are migrated. A future audit should not read `web/` as
  unmigrated product.

### Missing primitives that live code is waiting on

These are the gaps that source comments say are "tracked in the roadmap". Each
one keeps a feature-owned control in the tree with a documented exception, and
each exception retires when the primitive lands. **Do not delete an entry here
while its call site still cites it.**

**The five that closed on 2026-08-21 have all of their call sites migrated as of
2026-08-25**, so their rows are gone from this table rather than sitting here
"built" with nothing using them. That gap between building and adopting is the
lesson worth keeping:

> `TabList`, `SegmentedControl`, `Disclosure` and `FileInput` shipped on
> 2026-08-21 with **zero, zero, zero and two** consumers, and eleven tab strips,
> four toggle groups and nine raw file inputs still in the tree — every one under
> a comment saying "the design system has no such primitive yet". Four days
> later nothing had moved, because **a roadmap line saying "these will migrate" is
> not a guard.** `check:ui-contract` has a rule per family now.

And a second lesson, from doing the migrations: `FileInput` covered **one of the
product's three shapes**, `TabList` one of its three, and `SegmentedControl`
could not express a multi-line row at all. *A primitive that fits a third of its
call sites does not get adopted, and the missing third looks like neglect from
the outside.* Check the shapes before declaring a family closed.

A third, found the same day and worse than either: **`PageState` and
`ConfirmDialog` had consumers, and duplicates kept being written anyway.**
Fifteen hand-composed states and ten hand-composed confirmations, several of
them added *after* the pattern existed, one of them a local component with the
same name as the approved export. Neither family had a `check:ui-contract` rule,
because a hand-composed pattern is not a raw HTML element — it is correct
primitives in a shape the design system already owns, which no class-list or
tag-name rule can see. What closed it was reading the tree for the *composition*
rather than for the element: every file outside the design system that used
`StatusMedallion`, and every local component whose name ends in `Dialog`. That
search is written into the guardrail table in §7 as a **review** step, honestly
labelled, because it is not automated and pretending otherwise is how the gap
opened.

**The first version of that search was too narrow, which is worth recording
because it is the same mistake one level up.** It looked for a local
`*Confirm*Dialog*`, found six, and missed four more named after what they delete
— `RemoveLineDialog`, `DeleteRecordDialog`, `DeleteFileDialog`,
`ToggleActiveDialog`. A search for the *word* "confirm" finds the dialogs that
call themselves confirmations; a search for the *shape* finds the rest. The
procedure in §7 is the broad one.

| Primitive | Status | Cited by |
|---|---|---|
| **Toned `Button` variant** | **Still open** | `EnvelopeSidebar.jsx`'s eight field-palette buttons. `Button` exposes only primary/secondary/ghost/danger/link and has no semantic status tone; the tone is load-bearing because `ResizableDraggableField` colour-codes each placed overlay by field type, so these buttons are the legend for what appears on the PDF. They already use `--ds-*` status tokens, a 44px activation height, a focus ring and unique names |
| **Inline editable value** | **Open**, found 2026-08-21 | `ManageTeamModal`'s two per-member goal editors and `InlineLeaderboard`'s two date-range fields — a borderless field inside a labelled chip. `Input` is a 44px bordered full-width control and would destroy the chip; overriding it back would be worse. All four are tokenised, labelled and carry the shared focus ring |
| **Tinted chip link** | **Open**, found 2026-08-21 | `CallOutcomeModalUI`'s phone chip and the candidate list's per-row call chip — a status-tinted pill that is also a `tel:` link. `Link` is underlined text and `ButtonLink` is button-shaped; neither is an inline tinted chip. `Badge` is the right shape but is not interactive |
| **SelectableCard / Listbox / Combobox** | **Open**, widened 2026-08-25, widened again 2026-09-04 | A row of *record content* that behaves as a single-select option: the PEV FMCSA suggestion rows (three lines each), `EnvelopeSidebar`'s field-palette tiles, `VirtualLeadList`'s exclusion rows, `CompanyChooserModal`'s company rows, `PageThumbnailRail`'s page thumbnails. `SegmentedControl` takes a string label and cannot express any of them, which is why it did not retire the FMCSA rows as this file previously claimed. The **combobox** half is the same gap one step further: `EmployerNameAutocomplete.jsx` hand-builds the full ARIA combobox — `role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant` over a `role="listbox"` — because there is no primitive for a text input that filters a list. It is written correctly, which is exactly why it is worth promoting rather than leaving as one feature's private achievement |
| **Filter chip** | **Open**, first consumer named 2026-08-25 | `AudienceBuilder`'s application-status chips are **multi**-select over a `status` array, and 12px rather than the 44px control height; `SegmentedControl` is single-select by contract and would triple their height inside a filter panel. `CompanyCandidatesListPage`'s pipeline strip is the single-select sibling |
| **Compact icon-button step** | **Open** | Below `sm` (36px). The candidate list's 24px column-sort toggles, the corner badges on a PDF field box whose minimum size is 8px, `AiSuggestionOverlay`'s accept/reject pair |
| **Card-section disclosure** | **Open**, found 2026-08-25 | `Disclosure` has exactly one appearance — a rail-section header at 12px, bold, uppercase — because that is the shape its consumer needed. `EmailSettingsTab`'s SMTP setup guide is a `heading-sm` card section with a description line, and one consumer does not justify a second variant |
| **Section rail with per-item status** | **Open**, found 2026-08-25 | `CampaignEditor`'s section rail. `SectionNavigation` is the near miss: it hardcodes `aria-current="page"` where this is a wizard step, and has no trailing slot for the complete/incomplete indicator that is the rail's whole purpose |
| **Bottom app bar** | **Not being built** | `EditorMobileBar`'s items are equal-width stacked icon-over-label targets at 56px, the platform convention for a bottom bar and deliberately taller than the 44px control step. One consumer |
| **Status notice / callout** | **Open**, measured 2026-08-25 | *The largest remaining composition gap, and the one to do next.* A tinted bordered block with an icon and a sentence — "your application was submitted but these documents are outstanding", "this company will be blocked from logging in", a queue error. There is no primitive: `FieldMessage` is scoped to a form field, `Badge` is a chip, `PageState` is a whole slot. So the shape is rebuilt each time. Searching for its token signature (`bg-ds-status-*-bg` beside `border-ds-status-*-border`) returns **109 lines across 87 files**, and that number is honest about what it includes: some are separately recorded exceptions — the PDF field overlays in `SignerField`, the field-type colour legend in `fieldDefinitions`, the badge-tone maps in the candidate list — so the true count of notices is lower and was not enumerated one by one. Every one uses `--ds-*` roles, so this is *composition* drift rather than palette drift, which is why no rule sees it. Deliberately **not** attempted on 2026-08-25: a primitive for it must be built against a shape audit of the real call sites, and building it without migrating them is the mistake §8 records |
| **Avatar / initial disc** | **Open**, measured 2026-08-25 | A circular tinted disc holding an initial, an index number or a count — `aria-hidden` and decorative in every case. Eight of them across the dossier sidebar, the notes and activity tabs, the Super Admin user list, Analytics, the candidate list and the login hero, at **five different diameters** (20, 32, 36, 48/64 and 64px). `StatusMedallion` is the near miss: it is a status disc sized sm/md/lg holding an *icon*, and its tone carries meaning, where these carry a character |
| **Toast promotion** | **Open**, recorded 2026-09-04 | Not a missing shape — a missing *home*. `ToastProvider` at `src/shared/components/feedback/ToastProvider.jsx` is the single owner and every consumer uses it, which is why §8 lists the family as complete; but it lives outside `design-system/` and has no story, no baseline and no entry in the catalog. Promoting it is a move plus a catalog entry, not a build |
| **Menu / overflow menu** | **Not being built** | `TemplateLibraryPanel.jsx`, where every template action is a visible button. At that size that is a better answer than an overflow menu, not a workaround. `CampaignCard`'s card menu is the other candidate, and its entries are `role="menuitem"`, which `Button` cannot be |

---

## 6. Open decisions and blockers

These do not block compatibility-first migrations that preserve the current
identity and record evidence.

**All three of the things this section used to gate have happened, so read the
preamble as history rather than as a live constraint.** Baselines are published —
172 of them, committed beside the specs that record them. The visible component
families are **fully approved**, since the last two decisions holding them (the
semantic brand and action colours, and WCAG 2.2 AA) were answered by the owner on
2026-09-04, below. And the enforcement is permanent: `npm run test:visual`,
`check:visual-contract`, `check:ui-contract`, `npm run test:stories`,
`check:table-layout` and the `@a11y` specs all fail the build today, and nothing
in `main.yml` makes any of them advisory.

Be exact about which of those are *pinned* against becoming advisory again,
because the difference is the whole reason this file records lessons rather than
intentions:

| Gate | Held by |
|---|---|
| `npm run test:visual` | `scripts/test-ci-plan.mjs` K1 — the step must exist and carry no `continue-on-error` |
| the `@a11y` specs | K2 and K2b — they may not be grep-inverted out, nor run advisory |
| `npm run check:ui-contract` | `scripts/test-ui-contract-ci.mjs` W13/W14, plus W1/W2, which also pin that it runs in a job no lane selection can skip |
| `check:visual-contract`, `npm run test:stories`, `check:table-layout` | K1b — added 2026-09-04, when writing this table found that these three were blocking only because nobody had added `continue-on-error` to them, which is not the same as being unable to. Each is pinned by name *and* asserted to exist, because renaming a step makes an assertion about it vacuously true |

The remaining items below are **product, legal and copy** decisions, not
design-system blockers: none of them gates a primitive, a token or a baseline.

- `[x]` **Approve a `content-muted` value that is safe on `surface-subtle`.
  RESOLVED 2026-08-21 — owner approved.** `content-muted` is slate-600. It clears
  AA on `surface`, `surface-subtle`, `canvas` and all six status backgrounds, so
  the surface-only rule is gone and `tokens.test.js` asserts the whole matrix,
  including the two pairings (`surface-subtle` 4.34:1, `status-warning-bg`
  4.27:1) that used to fail. Every muted label in the product is slightly darker.
  Call sites that had moved to `content-secondary` to work around the old limit
  were not moved back and do not need to be.
- `[x]` **Every input in the product zoomed the viewport on an iPhone. FIXED
  2026-08-25.** iOS Safari zooms in when a focused input's `font-size` is under
  16px and does not zoom back out; the control scale is 13–15px, so every form in
  the product did it. `--ds-font-size-control-mobile: 16px` now applies to
  `.ds-form-control` under `max-width: 639px`.

  Two things make this safer than it sounds. **Heights do not move** — 16px at
  the body line-height is a 24px content box, which fits inside all three
  min-heights, so the type grows and the control stays put; verified in a real
  browser by `check:visual-contract`, which recorded a `fontSize` change and no
  `height` change. And **the blast radius was exactly what it should be**: 19
  pixel baselines moved and every one of them was `-mobile`.

  Selects are included even though iOS only zooms for text entry, because
  excluding them would put a 14px select beside a 16px input — the divergence the
  input/select probe added the same week forbids.

  `SignerField` is not covered and keeps its local workaround: its inputs are not
  `.ds-form-control` (they overlay PDF coordinate boxes), so the rule cannot
  reach them. Its allowlist entry says so.
- `[x]` **The onboarding tour's dialog semantics. RETIRED 2026-08-25 — the tour
  was removed.** The question was real: the tour was a coach mark on a
  `pointer-events-none` layer, correctly not using `Modal`, but its centred first
  step dimmed the page with a blocking backdrop and had no `role="dialog"`, no
  focus move and no Escape. The owner's answer was to delete the tour rather than
  give it modal semantics, so this closes by removal rather than by decision. If
  a guided tour is ever reintroduced, this is the question it has to answer, and
  the two accessibility fixes made to it on the way out — an accessible name on
  the close control, and step progress announced in text rather than by a
  coloured dot — are the baseline to start from.
- `[!]` **Decide what the Unified Driver Database bulk actions should do.**
  Message, Assign, Move Status and Archive were placeholders that fired a
  *success* toast and did nothing. The false success is removed (controls are
  disabled and labelled unavailable), which is the safe end state but not the
  intended one. A real implementation **cannot be inferred from the
  repository**: `LeadAssignmentModal` does bulk assignment but only within one
  company's `leads`, and this view spans every company and mixes applications
  with leads; campaigns own bulk SMS with their own consent and throttling
  rules; nothing anywhere defines an "archived" state, so Archive is not delete.
  Each needs an owner decision on cross-tenant policy and audit-log shape.
- `[x]` **Move `Modal` and `ConfirmDialog` into `design-system/patterns`.
  RESOLVED 2026-08-21.** Both moved together, as required, to
  `design-system/patterns/modal`, with their tests and their four catalog
  stories. Import them from `@design-system/patterns`; the `shared` barrel
  deliberately does not re-export them, so there is one place to import each.
  The domain modals (`CallOutcomeModal`, `CompanyChooserModal`,
  `FeatureLockedModal`, `ManageTeamModal`) stay in `shared` and import from the
  design system.

  The point of the move is the rule it unlocked:
  `tests/architecture.test.js` now forbids `@shared` imports inside
  `src/design-system` outright. That rule could not be written before, because
  these two files were the counterexample.
- `[x]` **Promote a `Switch` primitive. RESOLVED 2026-08-21.**
  `components/switch` is Company Settings' `ToggleSwitch`, which was already
  correct — it was feature-owned only because the design system had no switch,
  so `FeaturesView` could not import it and used a `Checkbox` instead,
  announcing the wrong role for a control that saves immediately. Both call
  sites migrate with their feature families.
- `[!]` **Decide how an employer signs the verification portal without a
  mouse.** A canvas cannot be drawn on with a keyboard, so `SignaturePad` — the
  legally operative mark on a 49 CFR §391.23 response — has **no keyboard or
  assistive-technology path to producing a signature**. Everything around it is
  accessible and axe reports zero serious/critical violations, because axe
  cannot detect a missing input modality. A typed fallback is the obvious remedy
  and the product already has the concept (`TEXT_SIGNATURE:` on the VOE side),
  but a typed mark that is indistinguishable in the stored PNG from a drawn one
  is a **legal-semantics decision, not a styling one**.
- `[x]` **Align control heights across the primitives. RESOLVED 2026-08-21.**
  One scale — `--ds-control-height-sm/md/lg` = 36 / 44 / 52px — read by `Button`,
  `IconButton`, `Input`, `Select` and `Textarea`, all defaulting to `md`.
  `.ds-form-control`'s hardcoded `min-height: 44px` now reads the token, so the
  rendered height of a form control did not change; what changed is that the
  default button grew 40 → 44px to meet it. 44px is WCAG 2.2 SC 2.5.5 (Enhanced)
  and is now the default rather than something a screen opts into.

  The consequence that matters for future work: `lg` used to mean "44px, so it
  matches an input", and 25 internal call sites — Settings forms, dialog footers,
  Super Admin panels — had used it that way. They were moved to the default, so
  their height is unchanged and their type is no longer one step oversized.
  `lg` now means what its name says, and the public driver/employer flows that
  genuinely want the largest target (`StepNavigation`, `Step9_Consent`,
  `EmploymentCoveragePrompt`, `UploadField`, `LoginScreen`, `VerificationPortal`,
  `SignatureSheet`, `ReviewChangePortal`) keep it. **Do not reintroduce
  `size="lg"` to line a button up with an input.**

  Two non-controls were following `--ds-control-height-md` and would have grown
  with it: `MetricCard`'s icon chip and the table's selection hit area. They have
  their own roles now (`--ds-metric-icon-size`,
  `--ds-table-selection-control-size`). `SectionNavigation` moved from `lg` to
  `md`, preserving its rendered 44px.
- `[x]` **Add an inverse surface to the semantic token contract. RESOLVED.**
  `--ds-color-surface-inverse` and `--ds-color-surface-inverse-subtle` now exist
  in `src/design-system/tokens/semantic.css` alongside
  `--ds-color-content-inverse`. A dark dialog header or banner is expressible in
  approved tokens; there is no longer a reason to invent a colour for one.
  (Call sites that moved to `surface-subtle` while this was blocked — such as
  `PEVRequestModal`'s header — were not migrated back, and do not need to be.)
- `[!]` **Decide whether the VOE document's small print may be recoloured.**
  Real-browser axe reports 4 serious `color-contrast` nodes inside the generated
  document (2.56:1, 1.95:1, two at 2.45:1). They are conventional grey legal
  small print on a printed-form facsimile; changing them changes every exported
  PDF and needs approval plus a re-proof of export parity.
- `[x]` **The Facebook Integrations tenant binding. FIXED 2026-08-25.**
  `connectFacebookPage` derived the tenant from `request.auth.uid` under a
  comment assuming a 1:1 user-to-company mapping, which this application has
  never had. The caller now names the company and the server authorizes it
  against `roles[companyId]` — the same default-deny check `addUserToCompany`
  makes. Fifteen tests cover the matrix, including the case that matters most: a
  company admin naming a company they do not administer is rejected, so the fix
  cannot become a worse bug than the one it closes.

  Binding the page to a real company also made a second-order problem worth
  closing. The callable read the page's existing binding, made two Facebook API
  round-trips, and only then wrote — so two admins of two different companies
  connecting the same unclaimed page concurrently both read "unclaimed" and the
  later write took the page. The check and the claim are now one transaction that
  runs before Facebook is contacted; a connect that fails afterwards releases the
  claim, and a failed token refresh restores the connection the company already
  had. Three mutations of the production code (claim not written early, rollback
  made unconditional, stale token left in place on a reclaim) each fail a
  different test.

  The presentation migration this item was blocking is therefore unblocked, but
  the feature flag stays **off** by owner decision, and the visible
  "not production-ready" notice stays with it. `scripts/audit-facebook-lead-tenancy.mjs`
  is a read-only report on whether any leads were stranded under a uid while the
  fault was live; no migration was written, because whether stranded records are
  real drivers or test noise is not something the code can tell.
- `[!]` **Decide the responsive/interaction strategy for editable matrices**
  (per-row form controls), starting with the SMS number-assignment recruiter
  matrix. Converting an editable matrix to a scroll table or stacked cards needs
  an owner decision and a proof of behavior parity. This is why that slice is
  NO-GO.
- `[!]` **Decide table responsive behavior per remaining use case** (horizontal
  scroll, priority columns, stacked cards, or a specialized interactive grid).
  There is no safe universal conversion. The candidate list settled on a dense
  native table with labelled horizontal overflow so no field or action
  disappears; other tables still need individual decisions.
  - **Decided 2026-08-17 — AI Integrations → Logs (`AiLogsPanel.jsx`):**
    `DataTable` at `density="compact"`, `minWidth="wide"`, with the default
    labelled horizontal scroll on mobile. Chosen over stacked cards because the
    columns are read *comparatively* — an operator scans a run of rows for the
    one that failed, and stacking destroys that. Nothing is hidden at any width:
    the full provider-by-provider detail lives in a dialog reached by activating
    the row, so the table itself carries only what fits. The status column is
    `xl` rather than `md` because it holds a `Badge` (which does not wrap) plus
    trailing detail text; `DataTable.stories.jsx` covers that arrangement so
    `check:table-layout` measures it in a real browser.
- `[x]` **Select visual-baseline hosting. RESOLVED — the baselines live in this
  repository.** `playwright.config.cjs` sets `snapshotPathTemplate` so each
  baseline sits beside the spec that records it, committed and reviewed as part of
  the diff. No external service, no credentials, and a baseline change shows up in
  code review like any other change. Chromatic was excluded by scope, not
  evaluated and rejected — and it is not needed for this. Who *approves* a
  baseline change is the same person who approves the pull request it arrives in;
  the lane is blocking as of 2026-08-25, so there is always one.
- `[x]` **Approve semantic brand/action colours. RESOLVED 2026-09-04 — owner
  approved.** The palette as it stands is the approved one: the blue-led action
  colours the compatibility-first consumers preserved, alongside the SafeHaul
  brand assets in navy (`#004C68`) and mint (`#0BE2A4`). No recolouring is
  pending, and no consumer is waiting on this to be settled.
- `[x]` **Confirm WCAG 2.2 AA as the permanent standard. CONFIRMED 2026-09-04 —
  owner approved.** It is the target for every primitive, pattern and screen, and
  it is what the `@a11y` lane and `npm run test:stories` are measuring against.

  **Together these two close the gate this whole section describes.** The
  preamble above says the open decisions block "declaring the affected families
  fully approved, publishing durable visual baselines, or making the related CI
  enforcement permanently blocking" — these were the last two holding the visible
  families, so **the visible component families are fully approved** as of
  2026-09-04. The enforcement is already permanent and is not advisory anywhere:
  `npm run test:visual`, `check:visual-contract`, `check:ui-contract`,
  `npm run test:stories`, `check:table-layout` and the `@a11y` grep all fail the
  build, and `scripts/test-ci-plan.mjs` K1 asserts none of them carries a
  `continue-on-error`.

  What is still open in this section is **product, legal and copy** — not a
  design-system blocker: the Unified Driver Database bulk actions, how an
  employer signs the verification portal without an account, whether the VOE
  document's small print may be recoloured, the SMS/number-assignment strategy,
  and the replacement wording for the customer named in operator copy. None of
  them gates a primitive, a token or a baseline.
- `[x]` **Decide whether Inter remains externally hosted. RESOLVED 2026-08-25 —
  it is served from this repository.** Not a preference in the end. The
  application opened with `@import url('https://rsms.me/inter/inter.css')`, and
  GitHub's runners did not get it: every one of the twenty application visual
  baselines failed on every CI run, invisibly, behind `continue-on-error`. The
  recorded diff was every glyph offset with every box unchanged.

  Two consequences reached past CI. Anyone whose network cannot reach that host
  saw the whole product in a fallback font, and every user's IP was disclosed to a
  third party in order to render text.

  `src/design-system/fonts/` holds the two variable faces under SIL OFL 1.1.
  This sends **fewer** bytes than the CDN did — the name `Inter` mapped to the
  *static* faces there, one file per weight, and this product uses four — in two
  requests rather than eight. `scripts/test-ci-plan.mjs` K3 fails on a remote
  `@import` in either stylesheet.
- `[!]` **Approve replacement wording for the customer named in operator copy.**
  `StatsBackfillPanel`'s All-Companies help text reads "Only run after verifying
  Ray Star LLC results." Preserved verbatim; the repository establishes no
  generic replacement.

---

## 7. Permanent automated guardrails

These exist because a human review missed the thing they now catch. Do not
weaken or delete one without replacing the guarantee.

| Guard | What it enforces |
|---|---|
| `src/design-system/tests/architecture.test.js` | No imports from features, application context, Firebase **or `shared`** into `src/design-system` — in stylesheets as well as modules. The `shared` half became enforceable on 2026-08-21, when `Modal`/`ConfirmDialog` moved out of it; the CSS half was added on 2026-08-25, after `index.css` had spent the whole campaign importing a token file from `shared` while this table claimed the rule was enforced |
| `src/design-system/tests/tokens.test.js` | The semantic token contract and its contrast pairings, in both directions |
| `src/tests/noBlockingBrowserDialogs.test.js` | No `confirm(` / `alert(` anywhere under `src/`, with or without a `window.` prefix. It walks every non-test file, strips comments and string literals, and is proven to catch a real call rather than passing vacuously |
| `npm run test:stories` (`src/tests/designSystemStories.a11y.test.jsx`) | Every catalog story renders and passes axe |
| `npm run check:table-layout` (`scripts/check-table-layout.mjs`) | Measures the built catalog in a real browser at 412px and 1440px: a cell must contain its content (`scrollWidth > clientWidth` is a violation unless the column opts into `truncate`), and no region may reserve a gutter it never scrolls into. Covers `DataTable` **and** the `ds-native-table` contract — until 2026-08-25 no native table was measured anywhere, so the fifteen tables across eleven files that are not `DataTable` had no layout guard at all. Honours `PW_CHROMIUM_EXECUTABLE`, so it runs in a sandbox whose Chromium is not the pinned build — a guard that cannot run gets skipped |
| `npm run check:ui-contract` (`scripts/check-ui-contract.mjs`) | The design-system contract, zero-tolerance. Raw palette classes, raw hex, sub-12px text, off-scale type, **Tailwind radii and shadows** (whose names collide with the `--ds-*` ones one step off), hand-built overlays, raw tables, hand-styled buttons/fields/anchors, **hand-rolled tablists, raw file inputs and hand-written `target="_blank"`** — in JSX, in stories and in CSS. Measured against `src/design-system/ui-contract.allowlist.json`: anything unlisted fails, so does a count *lower* than recorded, so does an entry that does not say why it is allowed, and so does an approved native table that does not apply `ds-native-table` — counted **per `<table>`**, not per file, because the first version of that rule was satisfied by one class in a file with three tables, and one of the eleven approved files has exactly that. There is no exemption for an invisible table: that carve-out was removed after review round eight, because deciding "is this hidden?" from a class list means deciding it across Tailwind's whole variant space. **Since 2026-09-04 the allowlist is itself compared against the base commit** (`scripts/ui-contract/baseline.mjs`, sharing the size guard's `SOURCE_SIZE_BASE`): an entry may only record a violation the base already carried, `--update` refuses to write an addition, and CI passes `--require-baseline` from `callable-contract`, which no lane selection can skip |
| `npm run check:visual-contract` (`scripts/check-visual-contract.mjs`) | Computed geometry in a real browser at both widths — control heights, cell padding, radii, resolved token colours — against a committed snapshot. This is the blocking visual guard, because the numbers are portable across machines and a failure names what moved (`button[md].height: 44px -> 40px`). 62 measurements as of 2026-08-25. Four of the recent ones are a frozen table column's background — a `sticky` cell that loses its own surface lets the scrolled columns paint through it, and that regression is now `rgb(255, 255, 255) -> rgba(0, 0, 0, 0)` in a diff rather than something found on a screen. The last six are the **gap between a glyph and its label**, which the design system owns (`.ds-button` sets `gap: var(--ds-space-2)`, `.ds-button__content` inherits it) and nothing measured: the icon *size* had a probe and the spacing beside it did not, so a re-tuned gap would have surfaced as a pixel diff on `button-with-icons` — a screenshot changed — instead of `columnGap: 8px -> 12px`, which says what moved. Mutation-proven with exactly that diff |
| `npm run test:visual` (`e2e/visual/`) | Pixel baselines for **71 catalog subjects and 15 application screens**, at 1440px and 412px, committed to the repository. **Blocking as of 2026-08-25** — see below. The catalog describe is deliberately **not** `mode: 'serial'`: it was until 2026-08-25, and a serial group stops at its first failure, so 142 of the lane's 174 tests could report one regression and skip the rest |
| `npm run test:e2e -- --grep "@a11y"` (`e2e/a11y.spec.cjs` and friends) | Real-browser axe on the mobile-critical journeys, plus the keyboard behaviour axe cannot see: roving `tabIndex`, arrow/Home/End on a tab strip, `aria-pressed` on a segmented group, a focusable file input named by its field, and that every control a Tab press reaches shows the product's focus ring rather than the browser's black one. **Blocking as of 2026-08-25**, inside the `frontend-e2e` lane |
| **A review step, not automated** — see below | A *hand-composed pattern*: correct primitives arranged into a shape the design system already owns. No class-list or tag-name rule can see one, and this is how fifteen page states and ten confirmation dialogs accumulated beside the patterns that own them. The two searches that find them are `StatusMedallion` used outside `src/design-system`, and a locally declared component whose name ends in `Dialog` — and the second search has to be that broad, because the first pass of it looked for `*Confirm*Dialog*` and missed four confirmations named after what they delete |

### A guard that reports one failure out of eight

Four defects came out of the review of the final head on 2026-08-25, and the
worst of them was in a guard rather than in the product. They are recorded
together because they share one shape: **a check that runs, goes red, and tells
you less than the truth.**

**`mode: 'serial'` on the catalog lane hid every failure after the first.**
`catalog.spec.cjs` held 142 of the pixel lane's 174 tests in one serial
`describe`, and Playwright skips the remainder of a serial group once a test in
it fails. A one-line CSS change moved eight subjects; the run reported
`1 failed / 81 did not run`, at every worker count, with `--max-failures=0`, and
after two full re-runs producing identical numbers. Removing serial mode turned
the same tree into `8 failed` — seven regressions had been invisible. Nothing
needed serial: `beforeAll` runs once per worker, each worker gets its own catalog
server on its own random port, and the subjects are independent screenshots. This
is also why the twenty `app.spec.cjs` font failures were all visible in CI while
this file's never would have been — that describe was never serial.

The lesson is not "serial mode is bad". It is that **a red guard has to be
readable**, and one nobody had yet seen fail in anger was reporting an eighth of
what it knew. The font failure that started this campaign was invisible because
`continue-on-error` swallowed it; this one would have been visible and wrong.

**The native-table row height was a no-op, and the guard had already said so.**
`ds-native-table` set `min-height` on its body cells. CSS 2.1 leaves `min-height`
on a `table-cell` box undefined and browsers ignore it, so the density role never
applied and rows were whatever their content made them — while `thead` used
`height` and therefore matched `DataTable` at 48px. `height` on a table cell is
treated as a *minimum*, which is the wanted behaviour: short rows get the
contract height, two-line rows still grow.

Worth being blunt about the discovery: `visual-contract.snapshot.json` had
recorded `nativeTable.cell` at 60.5px desktop / 63.5px mobile directly beside
`DataTable`'s body cell at 72px, in the same committed file, and it was read as
"56 measurements recorded" without anyone noticing the two numbers disagreed. The
probe is literally named *a native table is the same table as DataTable*. **A
guard that captures the defect is half a guard; somebody has to read what it
captured.** Both now measure 72px.

**The dropzone ignored dropped files, and eight comments said otherwise.** The
`FileInput` docblock, its CSS, its story and five call sites all claimed the
`<label>` made the panel "the browser's own drag-and-drop target ... without a
single event handler". A label forwards *activation* — a click — to the control it
labels, never a drop, and the input is clipped to 1×1, so a file dropped on any of
the four dashed upload panels landed on the label and was discarded. Not a
regression: none of them had a drop handler before the migration either. The false
claim was new, though, and an affordance that looks droppable and is not is worse
than one that does not.

`FileInput` has an explicit `onDrop` now, and the implementation detail is the
point: it assigns the dropped `FileList` to the real input and dispatches `change`
from it, rather than calling `onChange` with a hand-made object — so every call
site keeps reading `event.target.files` and none of them changed. Both browser
behaviours it depends on were measured in Chromium before being relied on, after a
first attempt to verify by synthetic `DragEvent` proved that a scripted drop
cannot populate a file input at all and was therefore the wrong instrument. Two
tests, mutation-proven three ways — removing the handler, substituting a hand-made
event (which fails with `{ files: [...] }` is not the input, so the test guards the
contract rather than the call count), and dropping the loading guard.

**The tether matched substrings, not class tokens.** One commit after
`check:ui-contract` learned not to match a tag with `[^>]*`, its new native-table
check was matching classes with `includes()` — so `not-sr-only` counted as hidden
and `ds-native-table-broken` counted as compliant, and neither would have failed
anything. Both bypasses were reproduced before the fix and are part of a six-case
mutation matrix now.

### Three rounds on one check, and the same mistake each time

The review of `31b14db` returned three more findings, and two of them were the
previous round's fixes being incomplete. Recorded together because the pattern is
the lesson.

**The native-table tether took three rounds.** Round one matched the tag with
`<table\b[^>]*>`, which stops at the `>` inside `=>`. Round two matched the class
with `includes()`, so `ds-native-table-broken` counted as compliant and
`not-sr-only` counted as hidden. Round three searched the whole attribute slice,
so `<table data-testid="ds-native-table" className="other">` counted as compliant
and `<table aria-label="sr-only" className="other">` counted as hidden. Each
version was reproduced before being fixed, and the matrix is nine cases now.

**The shape of the mistake never changed.** Every version asked *"does this text
appear somewhere?"* when the question is *"does this element carry this class?"* A
guard built on substring presence will keep finding new ways to be wrong, because
the thing it is checking is not the thing it is asking about. That is worth more
than the three fixes: **when a check fails review twice, the next fix should
change what it asks, not how carefully it looks.**

**The same `[^>]*` was still in the rule that guards a runtime crash.**
`jsx-label-on-throwing-primitive` catches a JSX `label={...}` on a primitive that
*throws* on a non-string label — a crash the moment the branch renders, which is
how `DashboardToolbar`'s filter panel carried one for ten migration slices. It was
still a regex, so:

    <FormField label={<span>Date</span>} onClick={() => go()}>   -> caught
    <FormField onClick={() => go()} label={<span>Date</span>}>   -> INVISIBLE

Prop ordering decided whether a crashing branch passed CI, and the second form is
the ordinary React one. It reads open tags through `openTagAttributes` now, like
the styled-control rules and the tether. The lesson recorded when that scanner was
written — that `[^>]*` had hidden three quarters of the violations — was true of
more rules than the ones fixed that day, and nobody swept the file for the rest.
There are none left; `grep '\[^>\]\*'` over the script returns only prose.

**A disabled drop target still owes the page a `preventDefault`.** `FileInput`'s
new drop handlers returned early when `inert || loading` — before cancelling the
event. That handed the drop back to the browser, whose default action for a
dropped file is to navigate to it, so dropping a second file onto a panel that was
mid-upload could replace the page and take a half-filled application with it. On
the public driver application that is somebody's work gone.

Refusing the file and cancelling the event are separate obligations. Both handlers
cancel first now, unconditionally, and only the assignment and the `change`
dispatch are conditional. Three tests — uploading, disabled, idle — assert on
`fireEvent`'s return value, which is `false` exactly when a handler called
`preventDefault`, so the guarantee is asserted rather than read off the source.

### `check:ui-contract` reads JSX as text — the root cause, and the one rule that no longer does

Recorded on 2026-08-25 after this class of defect produced **eight** findings in
seven review rounds, so the next person working on this file has the reason in
front of them rather than rediscovering it.

The first five were the same root cause — a rule reasoning about JSX by matching
characters in it. The last two are the more interesting ones: they are in the AST
walk that replaced the matching, and both were the *walk* claiming to know the
semantics of an expression form it had only guessed at:

| Defect | How it failed |
|---|---|
| `hand-styled-button\|field\|anchor` matched `<(button)\b([^>]*)>` | `[^>]*` stops at the `>` in `=>`; hid **49 violations in 32 files**, showing 12 in 8 |
| the native-table tether matched `<table\b[^>]*>` | same truncation, this time producing false *failures* |
| the tether matched classes with `includes()` | `ds-native-table-broken` counted as compliant, `not-sr-only` as hidden |
| the tether searched the whole attribute slice | a `data-testid` naming the contract counted as the contract |
| `jsx-label-on-throwing-primitive` matched `[^>]*?` | prop ordering decided whether a **runtime crash** reached CI |
| the tether's own AST walk trusted a quasi beside an interpolation | `` `ds-native-table${'-broken'}` `` counted as compliant |
| the same walk trusted every `CallExpression` | `selectClass('ds-native-table', 'other')` counted as compliant |
| the walk read the FIRST `className` and ignored what followed | `<table className="ds-native-table" {...props}>` counted as compliant, though a later spread overrides it |
| the hidden-table carve-out inferred "invisible" from a class list | `className="sr-only xl:not-sr-only"` is hidden on a phone and visible on a desktop — a pattern already in `DossierHeader.jsx` |

Four different fixes, one unchanged question. Each version asked *"does this text
appear somewhere?"* when the question is *"does this element carry this
attribute?"* `openTagAttributes` plus the `className` extractor is a decent
hand-rolled parser for an open tag and the nine-case matrix says it handles what
we have thrown at it — but it is still a parser written by accident, one review
finding at a time, and the honest expectation is that a sixth case exists that
nobody has thought of.

**The native-table tether now parses. Done 2026-08-25, on the fourth finding.**
The paragraph above originally said the parse was deferred; a fourth review round
then found the bypass no string match can close:

    <table className={enabled ? 'ds-native-table' : 'other'}>

The token **is** in that text. The rendered table is off-contract half the time.
The question is not "does this text appear" but "is this true on every branch",
and that is a question about structure — so `tablesOffContract` asks
`@babel/parser` for the `<table>` nodes and walks the `className` expression,
requiring the token on every path a render can take. Anything unprovable is a
violation, a bare `className={x}` included: a guard that assumes the best about an
identifier is the guard that let four bypasses through.

**And then the walk itself was wrong, twice — rounds five and six.** Worth
recording, because it is the more interesting failure:

    className={`ds-native-table${enabled ? '' : '-broken'}`}
    className={selectClass('ds-native-table', 'other')}

The first passed because a quasi splitting to `['ds-native-table']` looks
certain while an interpolation sitting against it can extend the token. The
second passed because the walk trusted every `CallExpression` on the reasoning
that a call's arguments are all joined — which was *my* reasoning, not
JavaScript's. `selectClass` returns one of them.

Both had the same cause: **every permissive branch was a guess at an expression
form's semantics, and each guess accommodated a form that does not exist here.**
This repository contains no `clsx`, `classnames` or `cx`, and all fifteen real
`<table>` classNames are plain string literals. The branches were added to avoid
hypothetical false failures and produced real false passes instead.

So the accepted set shrank to what is unambiguous: a string literal, a
conditional where **both** branches carry it, `||`/`??` where both sides do, and
a template literal where the token is **bounded** — followed or preceded by
whitespace inside its own chunk, or against the edge of the whole template rather
than an interpolation. `&&` can never be certain. Calls, arrays, concatenation,
the object form and a bare identifier are all *not provable, therefore not
allowed*, and they fail loudly. Extending the set now means adding a branch with
a test rather than an assumption.

Eighteen cases, all mutation-verified: **all six proven bypasses fail**; five
further unprovable forms fail by construction; and seven legitimate forms pass —
a plain class, a class among others, a conditional carrying the token in both
branches, a template literal with the token before *or* after a space, an
arrow-function attribute ahead of the class, and a genuine `sr-only`. The
allowlist counts came out identical at 235 across 40 files, which is the check
that swapping the engine changed nothing it should not have.

**Round seven, and why it was fixed rather than reverted.** I had committed on the
pull request that a seventh finding on this rule would mean reverting it rather
than patching again — the reasoning being that six failures on one guard is
evidence of bad scoping, not of a good next patch. The seventh arrived:
`<table className="ds-native-table" {...props}>` passed, because the walk read the
first `className` and ignored a later spread that overrides it at runtime.

It was fixed, and the departure from that commitment is deliberate rather than
convenient. **The attribute axis is closed in a way the expression axis is not.**
An opening element's attributes are exactly `JSXAttribute | JSXSpreadAttribute` —
two node types, no third way to set a prop — so "find the last thing that can set
the class list and require it to be provable" is complete over the grammar. That
is a different kind of statement from the expression fixes, each of which was a
guess about one form among an open-ended set. Reverting would also have knowingly
restored four already-demonstrated bypasses, which is worse for the repository
than the commitment was worth.

**Round eight removed an axis instead of guarding it.** The hidden-table carve-out
— `AnalyticsView`'s `sr-only` chart-equivalent was exempt, on the sound reasoning
that something invisible has no appearance to get wrong — turned out to rest on an
undecidable inference. Deciding "is this hidden?" from a class list means deciding
it across Tailwind's whole variant space, and `sr-only xl:not-sr-only` is hidden on
a phone and visible on a desktop. That combination is already in this repository,
so it was never hypothetical.

The fix was not to guard the variant space. **The carve-out is gone: every approved
`<table>` carries `ds-native-table`, the invisible one included.** Measured in a
real browser against the built stylesheet before doing it, because the obvious
worry is that the contract would un-hide it — `sr-only` keeps `position:absolute`
and `clip:rect(0,0,0,0)`, so the box grows from 10×20 to 47×39 and stays
`visible: false` either way. An invisible table carrying a visual contract costs
nothing; inferring invisibility from classes cost a review round.

That is the pattern across all eight: **every fix that held removed a judgement
the guard was making, and every fix that failed added one.** The expression set
shrank, the attribute axis was closed by enumeration, and the hidden axis was
deleted. What remains asks one question with no discretion in it — does the last
attribute that can set the class list provably contain `ds-native-table`.

The commitment still stands for the *expression* axis: a further bypass there
means the walk is the wrong shape, and the rule goes back to the simple per-table
class check with the problem recorded as open.

**The rest of the file still matches text**, and that is the remaining debt. It
was not converted wholesale because this script gates every other check in the
repository and each rule's counts would have to be re-proven one at a time; the
tether was converted because a bypass had been demonstrated in it four times, and
a fourth patch would have been the wrong answer to the same question.

The rule for anyone touching this file: **if a check needs a third fix, change
what it asks rather than how carefully it looks** — and check whether the same
shape exists in the sibling rules, because twice now it did and nobody swept for
it.

### The one guard that is a person, and why it is not a script

Every other row in that table is a command. One is not, and saying so plainly is
better than a rule that looks automated and is not.

A **hand-composed pattern** is a dialog or a page state built out of the right
primitives — `Modal`, `Card`, `StatusMedallion`, `Button`, `--ds-*` tokens
throughout — arranged into a composition that `patterns/modal` or
`patterns/page-state` already owns. Every static rule in `check:ui-contract`
looks for the *wrong ingredient*: a raw palette class, a hex, a bare `<table>`, a
`<button>` with a class list. A hand-composed pattern has no wrong ingredient. It
passes every rule, and on 2026-08-25 twenty-five of them did.

Two searches find them, and both belong in a review of any UI change:

```
grep -rl StatusMedallion src/features src/shared     # a medallion outside the DS
grep -rnE '(function|const)\s+\w*Dialog\w*\s*[=(]' src --include=*.jsx
```

Neither is a clean automated rule, and after 2026-08-25 both are mostly
legitimate hits. `StatusMedallion` is used in eight files outside this directory,
and every one is a composition the patterns genuinely do not cover:

| File | Why it is not a page state or a confirmation |
|---|---|
| `signing-room/StatusScreens.jsx` | `EsignConsentScreen` — a consent *form* with a nested `<h2>` disclosure region, a bulleted legal notice and a two-way decision |
| `modals/FeatureLockedModal.jsx` | A marketing interstitial: a *badged* medallion, a "Coming Soon" `Badge` between heading and body, and two CTAs one of which leaves the product |
| `FeatureDeactivationWarning.jsx` | An interstitial notice listing scheduled deactivations, with one action and a dismiss — no confirm/cancel pair guarding anything |
| `SandboxActionPanel.jsx`, `NumberAssignmentManager.jsx`, `DQFileTab.jsx`, `BulkUploadLayout.jsx` | A medallion inside ordinary page content, not in a dialog or a state at all |

A local `*Dialog` component is likewise often a correct wrapper around
`ConfirmDialog` — `ReleaseConfirmDialog`, `RemoveMembershipDialog` and
`RunAllConfirmDialog` are all wrappers now. A check that fires on correct code
gets switched off; that lesson is already recorded twice in this file. So this
stays a review step with a written procedure and a list of known-good hits,
rather than becoming a rule nobody trusts.

### Why `check:table-layout` is a browser check, and must stay one

**jsdom has no layout engine** — `scrollWidth` and `offsetWidth` are always `0`
there — so contract tests and `npm run test:stories` are *structurally*
incapable of detecting a cell overflowing its column, however many are written.
The E2E overflow assertion measures `document.documentElement`, so a gap *inside*
a card never reaches it. Every check was green while a Delete button was
rendering as "Dele" on a real phone.

Two construction rules the guard learned the hard way: it waits on observable
state (`document.fonts.ready` plus two painted frames) rather than a flat delay,
and it fails if it measures zero tables, because that is a broken check rather
than a clean result. **A guard that cannot fail on the broken input is not a
guard** — prove any replacement fails before you trust it passing.

**Honest limitation:** the guard covers the catalog, not the application. A
feature screen with no story is not measured. `e2e/visual/app.spec.cjs` closes
part of that gap — it screenshots 15 real screens at both widths, and since
2026-08-25 it is blocking — but it checks appearance, not overflow. A feature
that changes a column's content still needs measuring on its own screen.

### The pixel lane is blocking, and why it was not

This section used to say the lane could not be enforced because "the catalog
deliberately does not load Inter, so text rasterises with whatever the runner's
`sans-serif` resolves to", and prescribed watching the font tripwire "for a few
weeks" before flipping it.

**The CI record contradicted that in both directions.** On 2026-08-25 someone
finally read it: every run reported `20 failed / 132 passed`. All **130 catalog**
baselines passed on GitHub's runners — the machine-portability fear never
materialised — and all **20 application** baselines failed, every time, because
the *application* fetched Inter from `rsms.me` and the runner did not get it. The
half with the tripwire was the half that was fine. The half that was broken had
no tripwire at all.

So the lane had never once been green. It uploaded a 52MB diff artifact nobody
opened and raised its "a pixel baseline changed" annotation on every single run.
**A lane that always fails teaches everyone to ignore it, which is worse than no
lane** — and it is why "make it blocking after a few weeks of green" was never
going to happen: there was no green to wait for.

The fix was to remove the machine-dependent input rather than to tolerate it. The
typeface is served from `src/design-system/fonts/` (§6), the catalog loads the
same file as the application, `continue-on-error` is gone, and
`scripts/test-ci-plan.mjs` K1/K3 assert both halves of that so neither can drift
back.

The tripwire is still the first test in `catalog.spec.cjs` and it asserts
something real now: `document.fonts.check('400 16px Inter')`, so a missing font is
one sentence rather than 150 diffs, plus the pangram metrics to catch a different
*build* of Inter. Deliberately **not** `getComputedStyle().fontFamily`, which
names Inter whether or not Inter loaded — that is exactly how this hid.

Do not weaken `check:visual-contract` to compensate for pixel noise. The geometry
guard is the one that says *what* changed (`button[md].height: 44px -> 40px`), and
the two answer different questions.

Both visual lanes freeze the clock at a fixed instant. Without that the company
dashboard's date range stamps today's date into its baseline, and it would have
failed the morning after it was recorded.

**A review of this campaign's own diff found the one thing the contract had not
said**, which is worth recording next to the guards it prompted. `ds-native-table`
paints the row surface on the `<tr>`, and the Super Admin feature matrix freezes
its first column with `sticky left-0`. Its hand-picked `bg-ds-surface` was removed
in favour of the contract — and the contract had no rule for a sticky cell, so the
frozen company names became transparent and the twenty scrolled columns painted
through them. The contract owns it now (header surface, row surface, and the hover
tint so a frozen cell does not stay unhighlighted in a hovered row), a
`StickyFirstColumn` story puts it in the catalog, and `check:visual-contract`
measures its background at both widths. Verified by removing the rule and watching
the guard report `rgb(255, 255, 255) -> rgba(0, 0, 0, 0)`.

**Making a lane blocking is what finds its flakes, and one of them surfaced the
same day.** The `super-admin` subject waited on `<h1>Super Admin</h1>`, which is
in the banner and painted immediately — so the screenshot raced the three
dashboard metric cards. The committed baseline had caught them mid-load showing
`•••`; the first run after the lane went blocking caught them resolved showing
`0`, and the lane failed on a three-glyph diff with nothing wrong in the product.

The fix is the same principle as the font: **remove the non-deterministic input,
do not widen the tolerance.** `DashboardView` announces "Platform totals loaded.",
so the subject waits for that and the screenshot is pinned to the settled state.
Re-recorded, then run three more times to prove it. Raising `maxDiffPixels`
would have hidden it — and hidden the next real regression in those cards too.

The general rule for a subject in either lane: **`ready` must name the last thing
that arrives on the screen, not the first.** A `<h1>` in a banner is almost never
that.

**And the same lane found a worse one on the first CI run where it was allowed to
finish.** `Started (unfinished)` was the one screen in the list whose content came
from a *real* `listApplicationDrafts` callable rather than a fixture harness. With
no credentials the call fails — and *how* it fails decides what renders, so the
committed baseline was a loading skeleton captured in one environment while CI
captured something 30% different. A screenshot of a screen whose content depends
on a network failure is not a baseline. It has a `?e2eUnfinished=mock` harness
now, like every other route in the lane, and the baseline shows three fixture
drafts: a complete contact, one with no name typed yet, one with no contact
details.

Two rules follow from it, both cheap and both now in place:

- **Every route in the pixel lane must reach a settled state from fixture data.**
  The lane's own header already said so; one screen did not, and nothing checked.
- **`playwright.visual.config.cjs` pins `locale: 'en-US'` and
  `timezoneId: 'UTC'`.** That screen writes a timestamp through
  `toLocaleString()` with no arguments, which takes the *runtime's* locale and
  zone: "6/14/2026, 4:45:00 PM" on one machine, "14/06/2026, 21:45" on another —
  a different column width and a reflowed table. `settle.cjs` already freezes the
  clock; this freezes how it is written.

### Two scales, the same names, one step apart

The final audit's most useful finding, 2026-08-25, and the reason
`tailwind-radius` and `tailwind-shadow` exist as rules.

Tailwind's radius scale and the `--ds-*` one share their names and are offset by
one step:

| class | Tailwind | the `--ds-*` step with the same **value** |
|---|---|---|
| `rounded` | 4px | `rounded-ds-sm` |
| `rounded-lg` | **8px** | `rounded-ds-md` |
| `rounded-xl` | **12px** | `rounded-ds-lg` |
| `rounded-2xl` | 16px | `rounded-ds-xl` |
| `rounded-full` | 9999px | `rounded-ds-full` |

So `rounded-lg` and `rounded-ds-lg` sat in the same product, on adjacent
surfaces, sharing a name and rendering different corners — for the whole of
2026, without anyone noticing. Shadows have the identical problem: Tailwind's
`shadow-sm` is the `--ds-shadow-xs` step, and every Tailwind shadow is pure
black where the `--ds-*` ones are tinted with the same slate as the rest of the
product.

This is worse than an arbitrary value, because the name actively misleads: a
developer reaching for `rounded-lg` and meaning the design system's `lg` gets
8px and has no reason to look twice. **Convert by value, never by name.**

The sweep that closed it found 55 occurrences in 26 files. Fifty of them were
`rounded-full`, which is 9999px in both scales — a naming inconsistency with no
visual divergence. Only four actually rendered differently from their
`--ds-*` namesake, and they are fixed. Nineteen remain, all in the two files
that were already fully exempt: the VOE export document and the `DeviceMockup`
artwork.

### Raw Tailwind spacing is left alone, deliberately

The final audit also counted **512 raw Tailwind spacing utilities** (`p-4`,
`gap-3`, `mb-6`…) across 100 files, and decided against converting them. The
reasoning, so the next audit does not rediscover it as an open item:

**The two spacing scales are numerically identical.** `--ds-space-1..12` are
4/8/12/16/20/24/32/40/48px, and Tailwind's `1..12` are the same nine values. So
unlike radius and shadow above, there is no divergence to see and none to fix:
`p-4` and `p-ds-4` render the same 16px today. Converting 512 call sites would
be a large mechanical diff with real regression risk and no visual change, at
the end of a campaign — and several of the values in use (`p-7`, `p-9`, `p-11`,
`p-20`) have no `ds-` equivalent at all, so a blanket rewrite would not even be
possible without inventing scale steps.

The residual risk is real but narrow: if `--ds-space-*` is ever re-tuned, raw
utilities will not follow. If that day comes, this is the sweep to do, and it is
mechanical because the mapping is one-to-one.

**One genuine difference is worth knowing.** Tailwind's spacing is in `rem`;
`--ds-space-*` is in `px`. Browser *zoom* scales both, so WCAG 2.2 SC 1.4.4
(Resize Text) is unaffected — that criterion is satisfied through zoom. What `px`
does not follow is a user's **default font size** preference. The whole
`--ds-*` contract is px-based, type included, so this is a property of the design
system rather than of these 512 call sites, and moving it to `rem` would be its
own campaign with its own visual review. Recorded, not scheduled.

### `sr-only` and `ds-visually-hidden` are the same rule, and both stay

The final audit of 2026-08-25 found two ways to hide text from sight while
leaving it to a screen reader: Tailwind's `sr-only` (34 files) and the design
system's `.ds-visually-hidden` (35 files). Same decision as the spacing scales
above, for the same reason and with one consequence that was **not** harmless.

`.ds-visually-hidden` in `utilities.css` is the classic clip rule —
`position:absolute; width:1px; height:1px; padding:0; margin:-1px;
overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0` — which is
byte-for-byte what Tailwind's `sr-only` emits. Neither is ever seen, both
compute identically, so there is no appearance to diverge and nothing for a
visual guard to catch. Rewriting 34 files to rename a class nobody can see is
diff for its own sake.

**What was not harmless: the guards disagreed about which name means hidden.**
`lead-intake.spec.cjs` skipped both. `driver-dossier.spec.cjs` and both sweeps in
`public-application-responsive.spec.cjs` named only `ds-visually-hidden` — so the
*same* hidden control was exempt on one screen and a failure on another,
depending on which of two identical utilities the feature happened to use. It
matters because a hidden control clips to **1×1, not 0×0**, so the
zero-size `continue` above does not catch it and the target-size sweep would have
reported a 1×1 control as undersized. No screen was failing on the day this was
found; the two that could have been were one `sr-only` control away from a false
failure that looks exactly like a real one. All four sites name both utilities
now, and `check:ui-contract`'s native-table exemption is written the same way.

The lesson is the one this file keeps relearning at a smaller scale: two spellings
of one idea are tolerable in *appearance* and dangerous in a *rule*, because a
rule has to decide.

### Still open

- `[x]` **Ratcheting rules for arbitrary colours and unsupported type sizes.**
  Done 2026-08-21 — `check:ui-contract`.
- `[x]` **Ratcheting rules for raw tables, duplicate buttons, local modals and
  local form controls, with machine-readable approved locations.** Done
  2026-08-21, with one honest limit found on 2026-08-25: "local modals" is
  enforced as *hand-built overlay construction*, which is what `fixed inset-0`
  catches. A **hand-composed confirmation inside the approved `Modal`** — the
  medallion, heading, description and Cancel/Confirm footer that `ConfirmDialog`
  owns — has no wrong ingredient and passes every rule. Six of those had
  accumulated. That gap is a review step now, written down in the guardrail table
  above rather than left implied. The machine-readable locations are
  `src/design-system/ui-contract.allowlist.json`, where every tolerated
  violation carries a `reasons` entry naming the exception that justifies it.
  The `debt` alternative was removed on 2026-08-25 when the last of it cleared.
- `[x]` **A design-system PR checklist.** Done 2026-08-21 —
  `.github/pull_request_template.md`, with an explicit "never tick an unrun
  check" instruction and a section confirming no backend, permission, route or
  workflow behaviour changed.
- `[x]` **Make the pixel lane blocking. DONE 2026-08-25.** The prescription in
  this line — watch the font tripwire for a few weeks, then flip it — could never
  have worked, because the tripwire guards the *catalog* and the catalog half was
  already green. What was red was the twenty application-screen baselines, every
  run, hidden by `continue-on-error: true`. See "The pixel lane is blocking, and
  why it was not" above: the cause was the externally-hosted typeface, and the
  lane went blocking the day that was fixed rather than after a waiting period
  that was measuring the wrong thing.
- `[x]` **Drive the tolerated-violation inventory to zero debt and make the
  check zero-tolerance. DONE 2026-08-25.** 660 violations across 59 files at the
  start, every one of them carrying a `debt` tag naming the slice that owed the
  work. The file is now `src/design-system/ui-contract.allowlist.json`, every
  entry carries a `reasons` entry, and the `debt` escape hatch is gone. The check
  fails on anything unlisted, on a count higher *or lower* than recorded, and on
  an entry whose rule has no reason — the last of those is what stops "add it to
  the allowlist" from being a way to make any failure go away.

  **For the current number, run the check** — `npm run check:ui-contract` prints
  it, and this file is not where a number that moves every slice should live. It
  read 236 violations across 43 files on 2026-09-04, quoted as a dated
  observation rather than a figure to keep in step. Section 8 records the final
  set when the campaign closes.

  Since 2026-09-04 the inventory is also compared against the base commit
  (`scripts/ui-contract/baseline.mjs`): an entry may only record a violation the
  base already carried, `--update` refuses to write an addition, and the check
  runs from `callable-contract`, which no lane selection can skip. A written
  reason answers "is it written down"; only git answers "was it already there".

  **The recorded count has gone up twice, and both times that was the guard
  improving rather than the tree getting worse.** 193 → 213 when two new rules
  caught Tailwind radii and shadows, and the twenty they found were all in files
  that were already fully exempt. 213 across 26 files → **235 across 40** when the
  scanner was fixed on 2026-08-25: its open-tag regex terminated at the `>` inside
  `=>`, so any control whose `className` followed an arrow-function attribute — the
  common React ordering — was invisible to it. 49 hand-styled controls existed
  where it reported 12. The larger number is the honest one.
- `[x]` **A dropped file the `accept` list refuses is rejected silently.**
  **Closed 2026-08-26.** `FileInput.handleDrop` filtered dropped files by
  `accept` (2026-08-25, after a PDF dropped on the company-logo control was saved
  as the logo) and returned without telling anyone — no message, no announcement,
  and the panel looked exactly as it did. The native picker never had this
  problem because its own dialog will not offer a file it cannot accept.

  The three questions this item was holding open were answered as follows.

  - **Polite or assertive: assertive.** `FormControls`' `FieldMessage` renders an
    error as `role="alert"` and everything else politely, and this system has one
    rule for errors. A rejection is the direct answer to something the user just
    did, with nothing competing to be heard. The `loading` region stays polite,
    because an upload starting is information rather than a correction.
  - **A mixed drop says so.** `resolveDroppedFiles` names what was refused and,
    on a single-file field, says that only the first was taken — the other way a
    drop could quietly swallow a file, and one the picker never had either.
  - **The copy** names files while there are three or fewer and counts them after
    that, because a screen reader reading nine filenames is worse than being told
    there were nine.

  Two things were measured rather than assumed. `role="alert"` is mounted only
  while it has something to say: the always-mounted-and-hidden shape was written
  first, and `display: none` takes a live region out of the accessibility tree
  altogether, so the region a screen reader was meant to be watching is not there
  to watch. And the message is recorded *after* the accepted files dispatch their
  `change`, because that handler clears any standing rejection — the other order
  let a mixed drop erase the message it had just earned.

  A third question arrived with the review of the fix, and it is the one that
  mattered most: **the component cannot promise its own message survives.**
  `EnvelopeSidebar` renders the picker only while `!file`, `UploadField` only in
  its idle state — so a *mixed* drop hands them the accepted file, they
  re-render, and the alert is unmounted in the commit that created it. Reproduced
  before it was fixed. `onReject` fires after `onChange` (so a call site clearing
  stale state does not wipe the message that just arrived), and both call sites
  surface it in a region that outlives the picker.

  **Who shows it is derived, not decided**, and that took three review rounds to
  get right. `FileInput` shows its own message whenever it is mounted; a call
  site that removes the picker shows the message only while the picker is *gone*.
  Exact complements, so there is never a second copy and never a render where the
  visible text disagrees with the input's `aria-invalid`. The three attempts
  before it each failed the same way: an ownership flag left the mounted input
  with no invalid state, then clearing the message on each transition that
  remounts the picker meant enumerating them — and a review found a missed one
  every time (a failed upload, the success reset, `confirmClear`). There is
  nothing to enumerate now, because a mounted picker showing its own state cannot
  disagree with itself.

  The rules live in `dropAcceptance.js` (`matchesAccept`, `resolveDroppedFiles`),
  pure and directly tested. The component's suite was split by behaviour in the
  same change, because adding this took it past the 500-line standard:

  | file | tests | pins |
  | --- | ---: | --- |
  | `dropAcceptance.test.js` | 27 | `accept`'s three syntaxes, case folding both ways, every message shape, and that `accepted`/`rejected` account for each dropped file exactly once |
  | `FileInput.test.jsx` | 19 | the core contract: label, variants, description, aria |
  | `FileInput.drop.test.jsx` | 9 | how a dropped file reaches the input at all, and what a disabled panel still owes the page |
  | `FileInput.rejection.test.jsx` | 24 | the message, the `role="alert"` choice, `aria-invalid`, clearing, the `onReject` ownership rule and an axe check |
  | `FileInput.upload.test.jsx` | 6 | the polite upload region and focus restoration |
  | `UploadField.test.jsx` | 8 | the transition: message kept while uploading and after the parent takes the value, dropped whenever the picker comes back |
  | `EnvelopeSidebar.drop.test.jsx` | 4 | the same transition where the parent re-renders with the chosen file |

---

## 8. Migration state

**The screen inventory is complete: 19 of 19 areas migrated, closed 2026-07-28**,
covering the company workspace and settings, login/auth, the public driver
application, the driver dossier, PEV/VOE, e-docs and the signing experience,
lead intake, and Super Admin. Later campaigns extended it to the Environment &
Integrations vault, AI Integrations and Blog Posts, and operator-controlled AI
provider priority.

Screens added since, built on approved components and `--ds-*` tokens from the
start rather than migrated: AI Integrations → credential-access diagnostic and the
per-lane health badges, Blog Posts → Publication runs, the driver application's
two-stage resume dialog (the approved `ConfirmDialog`, twice — see below), and
Company → Drivers → Started (unfinished), and — 2026-09-02 — the Application
Rules, Agreements and Integrations tabs of Company → Company Profile, the same
rules panel inside Super Admin → Edit Company, and in the driver application the
step-level issue alerts (`StepIssues`), the Hours of Service section, the
Yes/No violations and accidents questions and the PSP/MVR report-import panel
(`FormSection` + `FileInput` + `Badge` + `Button`), and — 2026-09-03 — Company →
Applications → Start an application, where a carrier fills in a driver's
application and sends them a link: the worklist (`DataTable` + `Badge`), the
editor screen (`SchemaSection` for the scalar sections, including the email and
phone that key the draft, and the wizard's own `DynamicRow` for employers and
violations), the document panel (`UploadField`), the reader panel and the link
panel (`Card` + `Button` + `Badge` + `FieldMessage`). Updated 2026-09-03: the
flow now opens with a **mode chooser** (two `Card`s — read the documents, or fill
in manually) and, on the AI path, a dedicated **upload step** before the editor;
the separate identity screen was removed, because the email and phone are
ordinary schema fields of the editor. No new visual primitive was introduced for
any of them (`ApplicationModeChooser` is `Card` + `Button` content).

One choice there is a rule rather than a preference, and it is the same one the
driver wizard's locked employer rows follow: **a field the viewer may not change
is a read-only display with a badge, never a disabled input.** A disabled input
reads as broken, leaves the tab order and takes its label with it; enforcement
lives in `applicationLockedFields.js` regardless, so the markup's job is to
explain rather than to prevent.

One design decision in that set is worth recording because it is a safety
property, not a preference: **the resume dialog uses two sequential
`ConfirmDialog`s rather than one dialog with two destructive choices.**
`ConfirmDialog` routes Escape to `onCancel`, so a single dialog whose cancel
action discarded the draft would delete a driver's saved application on a stray
keypress. Discarding is therefore its own explicit `tone="danger"` confirmation,
and Escape at either stage deletes nothing.

One area is deliberately **NO-GO** and remains unmigrated, blocked on an owner
decision in §6:

| Area | Blocked on |
|---|---|
| Company Settings → SMS / number assignment | Editable-matrix responsive strategy; entanglement with the out-of-scope secret-entry `LineManager` |

**Integrations (Facebook) is no longer on that list**, and both halves of its
entry are out of date. The `request.auth.uid` tenant-binding defect that blocked
it was fixed on 2026-08-25 (see §6), and `IntegrationsTab.jsx` is migrated: it
renders through `Badge`, `Button`, `Card`, `FieldMessage`, `PageHeader`,
`ResponsiveGrid` and `Stack`, and its only recorded exception is Facebook's own
brand blue on the connection tile — a third-party mark, which is not a SafeHaul
role and must not be re-tuned by a change to this product's palette.

Component families that are **complete** — meaning the primitive exists *and*
every consumer that can use it does:

| Family | Owned by | Closed |
|---|---|---|
| Dialog shell | `patterns/modal` | 2026-08-22 |
| Confirmation dialog | `patterns/modal` → `ConfirmDialog` | 2026-08-25 |
| Toast / notification | `shared/components/feedback/ToastProvider` — **not in the design system** | consumers complete; primitive not promoted |
| Empty / error / loading state | `patterns/page-state` | 2026-08-25 |
| Navigation and external links | `components/link` | 2026-08-25 |
| Tab strip | `components/tabs` | 2026-08-25 |
| Single-select toggle group | `components/segmented` | 2026-08-25 |
| File picker | `components/file-input` | 2026-08-25 |
| Table (display and native) | `components/data-table` + `ds-native-table` | 2026-08-25 |

Families still in progress — inputs, select/textarea, icons, loading primitives
beyond `ProgressBar` — are tracked by the guardrail work in §7 rather than by a
list of screens, because the screens are done and what remains is preventing
regression.

**"A primitive existing is not the same as the exception being gone."** That
sentence sat in this section for four days while being untrue of five of the
families above, and on 2026-08-25 it was measured rather than repeated:

- `TabList`/`TabPanel` had **0 consumers** and 11 hand-rolled `role="tablist"`
  strips, in at least three visual treatments, two of them with no ARIA at all.
- `SegmentedControl` had **0 consumers** and five hand-rolled toggle groups, one
  of them 40px tall — off the 36/44/52 control scale entirely.
- `FileInput` had 2 consumers and **9 raw `<input type="file">`**, none of them
  recorded as exceptions.
- `PageState` had 5 consumers and **15 hand-composed states**: nine full-page
  status screens in the signing room and the public application (between them two
  title sizes, two medallion sizes, icons at 28/32/40/48px and three different
  gaps under the medallion — five appearances for one thing), two more page-level
  states (a document-load failure and a permissions boundary), and four
  panel-level empties, two of which announced nothing when a filter emptied the
  list. Three native-table empty rows announced nothing either, while `DataTable`
  and `ModernDriverTable` both announced their own — and two of those three put
  the live-region role on the `<td>`, which replaces the cell role.
- `ConfirmDialog` had consumers *and* **ten hand-composed duplicates**, one of
  them a local component with the same name shadowing the import, three with no
  medallion at all, and one — the permanent record delete in the Unified Driver
  Database, the most destructive action in the product — carrying its severity in
  the *heading's colour* with no medallion, which is status by colour alone. Each had lost the same three capabilities: initial focus on
  Cancel rather than on the destructive action, the synchronous double-activation
  guard, and Escape/backdrop dismissal disabled while the action is in flight. The
  first two apply at every one of the six — on "Delete this user?" they are not
  cosmetic. The third does not, and the migrated files say so rather than
  implying it: all six close the dialog before starting the work and report
  progress on the page behind it, so `loading` is deliberately not passed.

Every one of those is migrated. The lesson is recorded in §5: **building a
primitive and adopting it are two pieces of work, and only the first one is
visible in a diff.** A campaign that ships a primitive with no consumers has
added a fourth way to do the thing, not removed three.

**Campaigns, migrated 2026-08-24.** `AudienceBuilder`, `VirtualLeadList`,
`ContentComposer` and `DeviceMockup` carried 55 raw palette classes between them
and now carry four, all of them the `DeviceMockup` artwork exception above.

The interesting part was the audience preview panel, because the reason it was
never migrated turned out to be a stale comment. `VirtualLeadList` said the
design system "has no approved dark-surface tokens yet"; `AudienceBuilder` said
the dark treatment was temporary and would be *removed* when the list migrated.
Both were written after `--ds-color-surface-inverse` and its on-inverse content,
border and status roles had already landed (§6, resolved), and the two comments
contradicted each other about what the outcome should be. The panel is a
console surface, the token contract expresses console surfaces, and
`SystemHealthView`'s log panel was already using the same three roles. So the
panel stays dark and now says so in tokens.

That migration added one capability to the design system: **`PageState` takes
`surface="inverse"`**. Its three states previously had to be hand-composed on
that panel, because the default title colour is `--ds-color-content` — near
black, and therefore invisible on `--ds-color-surface-inverse`. The medallion is
deliberately *not* inverted: its tinted backgrounds are light, so it reads as a
light chip exactly as `Badge` already does on those surfaces. Both text
pairings are covered by the AA assertions in `tests/tokens.test.js`.

Two behavioural details were corrected with it, neither of them cosmetic. The
failure state used to shrink the panel from 500px to 400px, moving everything
below it up the page at the moment the user was reading an error; it now reuses
the panel's own class. And the two hand-built tinted count chips in the preview
header are `Badge`s — they are counts with a status meaning, on a surface whose
list rows were already using `Badge` for the same job.

**Settings, driver flows, signing, onboarding and auth, migrated 2026-08-25.**
This is the slice that took migration debt to zero: every violation the ratchet
still tolerates now names the exception that justifies it, and nothing is left
marked as debt.

Two capabilities were added to the design system on the way, both because live
code had already written them by hand more than once.

**Brand colours are named.** `--ds-color-brand-primary` (#004C68) and
`--ds-color-brand-accent` (#0BE2A4) are the mark's own two colours, and the
product had carried them as bare hexes since the beginning — in the logo SVG, the
loader, the favicon, and the login hero, which is the one place they are used as
*interface* colour rather than inside artwork. `tokens.test.js` pins the resolved
values, so a brand change is now a deliberate edit rather than a drift between
four copies of a hex. The accent is blessed as a foreground on the inverse
surface only: on a light surface the same colour is about 1.6:1, which is exactly
the mistake a named token invites if nobody writes it down.

**`Button variant="link"`.** Six screens had hand-written "an action that reads
as inline text" — all of them using the correct tokens, and between them using
two font weights and three font sizes. It stays a `<button>` because it performs
an action rather than navigating, and it is the one variant that leaves the
control-height scale: a 44px-tall link inside a form row pushes the text around
it apart. Its hit area is not its text — a pseudo-element takes the pointer
region to about 26px without changing the layout box, so it clears WCAG 2.5.8
rather than leaning on the "inline in a sentence" exemption for the uses that are
not in a sentence. `IconButton` refuses the variant outright, because there the
same rule would produce a 44×16px target.

Two other things were put right, neither of them cosmetic:

- **The Super Admin feature matrix announced the wrong role.** Its cells were
  `Checkbox`, which announces a value you set and then submit; toggling one
  writes to Firestore immediately. They are `Switch` now. This was the call site
  the roadmap recorded when `Switch` was promoted, and the local
  `settings/questions/ToggleSwitch` it was promoted from is deleted, with its two
  call sites moved across.
- **The login hero used five text opacities**, one of which (`text-white/50`)
  measured roughly 3.6:1 on its background, below AA for body text. They are now
  the two on-inverse content roles, which are AA-asserted.

### Catalog

The component catalog is Storybook (`npm run storybook`,
`npm run build-storybook`). Stories render only hand-written fixture data from
`src/design-system/stories/fixtures.js`; **no production data may appear in a
story.** Visual-regression baselines live in this repository beside the spec that
records them, and the lane is blocking — §6 and §7.

Stories are scanned by `check:ui-contract` as of 2026-08-25, for the rules that
read a class list. They used to be skipped as "catalog furniture already covered
by `test:stories`", which does not hold: that runs axe, not this, and a story is
the design system's own published example of how to build something. The
markup-shaped rules are left off deliberately — a story legitimately
*demonstrates* a native table, and a story's prose *discusses* the patterns the
rules forbid.

---

## 9. Keeping this file useful

Update this file in the **same task** that changes what it describes. Add an
entry only when it is a rule, an approved exception, a guardrail or an open
decision. Completion narratives, dated verification tables, test counts and
implementation logs belong in the pull request and in Git history, not here — a
document that agents must read before every UI change earns its length back in
accuracy, not in completeness.
