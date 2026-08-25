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
- **Icon size inside a control belongs to the design system.** `Button` sizes any
  contained `svg` from the step's icon token, which outranks the width/height
  attributes an icon library renders. Passing `size={24}` to a glyph in a button
  does nothing, deliberately.
- **Status is never colour alone** — always text or icon plus tone.
- **A state must announce itself.** Loading and empty are `role="status"`
  (polite); errors are `role="alert"`. Use `EmptyState` / `ErrorState` /
  `LoadingState` from `@design-system/patterns`, which choose for you. A polite
  error is silent until the user happens to navigate to it; an assertive empty
  state interrupts them to say there is nothing.
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

  **A native table is not a licence to style a table by hand.** Each of these
  uses `--ds-table-header-bg`, `--ds-table-header-fg` and the density roles, and
  `check:ui-contract` records each with the reason above rather than exempting
  the file wholesale.
- **`CallOutcomeModalUI`'s outcome grid stays a `role="group"` of raw
  `<button aria-pressed>` cards** until it migrates to the `SegmentedControl`
  built on 2026-08-21 — which keeps exactly that semantic, deliberately, rather
  than becoming a radiogroup. Same for the dossier summary toggle and the PEV
  FMCSA rows. All their colours are approved tokens.
- **File inputs stay local** in `DQFileTab`, `BulkUploadLayout`, the public
  application and the PEV result upload — **until each migrates to the
  `FileInput` primitive built on 2026-08-21.** The contract now exists, so a
  *new* hand-built picker is a violation rather than an exception.
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

### Missing primitives that live code is waiting on

These are the gaps that source comments say are "tracked in the roadmap". Each
one keeps a feature-owned control in the tree with a documented exception, and
each exception retires when the primitive lands. **Do not delete an entry here
while its call site still cites it.**

**Five of these closed on 2026-08-21.** The primitives now exist; the call sites
listed against them are migrated family by family in the PRs that follow, and
until a call site moves, its exception still stands. Delete a row only when its
last consumer has migrated.

| Primitive | Status | Cited by |
|---|---|---|
| **Tabs** (`components/tabs`) | **Built.** `TabList` / `TabPanel`, plus `tabIds` so a strip and a panel living in different components cannot drift apart | Nine hand-rolled tablists — `DocumentsManager`, `AnalyticsView`, `CreateView`, `AiIntegrationsView`, `CampaignsDashboard`, `AudienceBuilder` (x2), `DossierSidebar`, `EditorInspector`, `NotificationBell`. Seven had each written the same `handleTabKeyDown` |
| **Disclosure** (`components/disclosure`) | **Built.** Trigger inside a heading; content unmounted when closed, not hidden | `EnvelopeSidebar`'s `RailSection`. `AiLogsPanel` never needed it — a log row's detail opens in the approved `Modal` via `DataTable`'s `onRowActivate`, so no inline expander was hand-rolled |
| **Segmented control** (`components/segmented`) | **Built** as `role="group"` + `aria-pressed`, deliberately *not* a radiogroup — the README says why | `CallOutcomeModalUI`'s outcome grid, the dossier summary/full toggle, the PEV FMCSA rows, `EnvelopeSidebar`'s delivery-method toggle |
| **Switch** (`components/switch`) | **Built**, promoted from Company Settings' `ToggleSwitch`, which was already correct | `FeaturesView`, which used a `Checkbox` and so announced the wrong role for a control that saves immediately |
| **File input** (`components/file-input`) | **Built.** A real focusable `<input type="file">` behind a `<label>` | `DQFileTab`, `BulkUploadLayout`, the public application's upload, the PEV result upload. Two of the four were a `<div onClick>` driving a `display: none` input, which has no keyboard path to the picker at all |
| **Toned `Button` variant** | **Still open** | `EnvelopeSidebar.jsx`'s eight field-palette buttons. `Button` exposes only primary/secondary/ghost/danger and has no semantic status tone; the tone is load-bearing because `ResizableDraggableField` colour-codes each placed overlay by field type, so these buttons are the legend for what appears on the PDF. They already use `--ds-*` status tokens, a 44px activation height, a focus ring and unique names |
| **Inline editable value** | **Open**, found 2026-08-21 | `ManageTeamModal`'s two per-member goal editors — a borderless numeric field inside a labelled chip. `Input` is a 44px bordered full-width control and would destroy the chip; overriding it back would be worse. Both are tokenised, labelled and carry the shared focus ring |
| **Tinted chip link** | **Open**, found 2026-08-21 | `CallOutcomeModalUI`'s phone chip — a status-tinted pill that is also a `tel:` link. `Link` is underlined text and `ButtonLink` is button-shaped; neither is an inline tinted chip. `Badge` is the right shape but is not interactive |
| **Menu / overflow menu** | **Not being built** | `TemplateLibraryPanel.jsx`, where every template action is a visible button. At that size that is a better answer than an overflow menu, not a workaround — so the primitive is not being written speculatively |

---

## 6. Open decisions and blockers

These do not block compatibility-first migrations that preserve the current
identity and record evidence. They **do** block declaring the affected families
fully approved, publishing durable visual baselines, or making the related CI
enforcement permanently blocking.

- `[x]` **Approve a `content-muted` value that is safe on `surface-subtle`.
  RESOLVED 2026-08-21 — owner approved.** `content-muted` is slate-600. It clears
  AA on `surface`, `surface-subtle`, `canvas` and all six status backgrounds, so
  the surface-only rule is gone and `tokens.test.js` asserts the whole matrix,
  including the two pairings (`surface-subtle` 4.34:1, `status-warning-bg`
  4.27:1) that used to fail. Every muted label in the product is slightly darker.
  Call sites that had moved to `content-secondary` to work around the old limit
  were not moved back and do not need to be.
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
- `[!]` **Correct the Facebook Integrations tenant binding before any
  Integrations presentation migration.** `connectFacebookPage` uses
  `companyId = request.auth.uid`, which is incompatible with SafeHaul's auto-id
  + membership multi-tenant model, so connected leads ingest to
  `companies/{uid}/leads` instead of the real company. This is a backend
  correctness/security defect for a separate, security-reviewed project — not a
  design-system slice. The Integrations presentation stays unmigrated so the UI
  does not imply the workflow is production-ready.
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
- `[!]` **Select visual-baseline hosting and review ownership.** The catalog
  tool is decided — Storybook (see §7). What remains open is who hosts the built
  catalog, who approves a baseline change, and which service stores baselines.
  Chromatic was excluded by scope, not evaluated and rejected.
- `[!]` **Approve semantic brand/action colours** before declaring visible
  component families fully approved. Compatibility-first consumers preserve the
  current blue-led UI and the SafeHaul navy/mint brand assets; product/design
  review is still required.
- `[!]` Confirm WCAG 2.2 AA as the permanent standard.
- `[!]` Decide whether Inter remains externally hosted.
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
| `src/design-system/tests/architecture.test.js` | No imports from features, application context, Firebase **or `shared`** into `src/design-system`. The `shared` half became enforceable on 2026-08-21, when `Modal`/`ConfirmDialog` moved out of it |
| `src/design-system/tests/tokens.test.js` | The semantic token contract and its contrast pairings, in both directions |
| `src/tests/noBlockingBrowserDialogs.test.js` | No `confirm(` / `alert(` anywhere under `src/`, with or without a `window.` prefix. It walks every non-test file, strips comments and string literals, and is proven to catch a real call rather than passing vacuously |
| `npm run test:stories` (`src/tests/designSystemStories.a11y.test.jsx`) | Every catalog story renders and passes axe |
| `npm run check:table-layout` (`scripts/check-table-layout.mjs`) | Measures the built catalog in a real browser at 412px and 1440px: a cell must contain its content (`scrollWidth > clientWidth` is a violation unless the column opts into `truncate`), and no region may reserve a gutter it never scrolls into. Honours `PW_CHROMIUM_EXECUTABLE`, so it runs in a sandbox whose Chromium is not the pinned build — a guard that cannot run gets skipped |
| `npm run check:ui-contract` (`scripts/check-ui-contract.mjs`) | The design-system ratchet. Raw palette classes, raw hex, sub-12px text, off-scale type, hand-built overlays, raw tables and hand-styled buttons/fields/anchors, measured against `src/design-system/ui-contract.baseline.json`. New violations fail; so does a *decrease*, which forces the inventory to record shrinkage rather than silently permit a regression back up to the old number |
| `npm run check:visual-contract` (`scripts/check-visual-contract.mjs`) | Computed geometry in a real browser at both widths — control heights, cell padding, radii, resolved token colours — against a committed snapshot. This is the blocking visual guard, because the numbers are portable across machines and a failure names what moved (`button[md].height: 44px -> 40px`) |
| `npm run test:visual` (`e2e/visual/`) | Pixel baselines for 29 catalog subjects and 10 application screens, at 1440px and 412px, committed to the repository. **Reported, not enforced** — see below |

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
part of that gap — it screenshots ten real screens at both widths — but it
checks appearance, not overflow, and it is advisory. A feature that changes a
column's content still needs measuring on its own screen.

### Why the pixel lane is reported and not enforced

The catalog deliberately does not load Inter — the application imports it from
`rsms.me` and the catalog omits it — so text rasterises with whatever the
runner's `sans-serif` resolves to. A baseline recorded on one machine can differ
on another for reasons that have nothing to do with the design system, and a
lane that cries wolf gets ignored or switched off.

So the pixel lane runs, uploads its diff artifact and raises a warning
annotation, in the same shape the repository already uses for `typecheck` and
the axe lane. The **first test in `catalog.spec.cjs` is the tripwire**: it
measures the rendered width of a pangram, not `fontFamily` (which still names
Inter whether or not Inter loaded), so a font substitution is one legible
failure instead of 78 mystery diffs.

**To make it blocking:** watch that metrics test stay green on the CI runner for
a few weeks, then remove `continue-on-error` from the step and record the date
here. Do not weaken `check:visual-contract` to compensate for pixel noise — the
geometry guard is the portable one and is the reason the pixel lane can afford
to be advisory.

Both visual lanes freeze the clock at a fixed instant. Without that the company
dashboard's date range stamps today's date into its baseline, and it would have
failed the morning after it was recorded.

### Still open

- `[x]` **Ratcheting rules for arbitrary colours and unsupported type sizes.**
  Done 2026-08-21 — `check:ui-contract`.
- `[x]` **Ratcheting rules for raw tables, duplicate buttons, local modals and
  local form controls, with machine-readable approved locations.** Done
  2026-08-21. The machine-readable locations are
  `src/design-system/ui-contract.baseline.json`, where every tolerated violation
  carries either a `reasons` entry naming the exception that justifies it or a
  `debt` note naming the slice that clears it.
- `[x]` **A design-system PR checklist.** Done 2026-08-21 —
  `.github/pull_request_template.md`, with an explicit "never tick an unrun
  check" instruction and a section confirming no backend, permission, route or
  workflow behaviour changed.
- `[ ]` Make the pixel lane blocking once its font tripwire has held on CI.
- `[ ]` Drive `ui-contract.baseline.json` to zero and delete it, leaving only
  the `reasons` entries. 660 violations across 59 files at the time of writing;
  **268 across 34 files after the campaigns slice (2026-08-24)**, of which 179
  are approved exceptions carrying a `reasons` entry and 89 are migration debt,
  every one of them assigned to the settings / driver-flows / signing /
  onboarding / auth slice.

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
Company → Drivers → Started (unfinished). No new visual primitive was introduced
for any of them.

One design decision in that set is worth recording because it is a safety
property, not a preference: **the resume dialog uses two sequential
`ConfirmDialog`s rather than one dialog with two destructive choices.**
`ConfirmDialog` routes Escape to `onCancel`, so a single dialog whose cancel
action discarded the draft would delete a driver's saved application on a stray
keypress. Discarding is therefore its own explicit `tone="danger"` confirmation,
and Escape at either stage deletes nothing.

Two areas are deliberately **NO-GO** and remain unmigrated, each blocked on an
owner decision in §6:

| Area | Blocked on |
|---|---|
| Company Settings → SMS / number assignment | Editable-matrix responsive strategy; entanglement with the out-of-scope secret-entry `LineManager` |
| Company Settings → Integrations (Facebook) | The `request.auth.uid` tenant-binding defect |

Component families that are **complete**: dialogs (every active overlay uses
`Modal`, which now lives in `design-system/patterns/modal`), toast/notification,
and — as of 2026-08-21 — the **empty/error/loading states**
(`patterns/page-state`) and **navigation links** (`components/link`). Families
still in progress — inputs, select/textarea, icons, loading primitives beyond
`ProgressBar` — are tracked by the guardrail work in §7 rather than by a list of
screens, because the screens are done and what remains is preventing regression.

The state and link primitives exist but their **consumers are not all migrated
yet**: feature-owned empty/error states and styled `<a>` elements remain in the
tree and are being replaced family by family. A primitive existing is not the
same as the exception being gone.

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

### Catalog

The component catalog is Storybook (`npm run storybook`,
`npm run build-storybook`). Stories render only hand-written fixture data from
`src/design-system/stories/fixtures.js`; **no production data may appear in a
story.** Approved visual-regression baselines are still open — see §6.

---

## 9. Keeping this file useful

Update this file in the **same task** that changes what it describes. Add an
entry only when it is a rule, an approved exception, a guardrail or an open
decision. Completion narratives, dated verification tables, test counts and
implementation logs belong in the pull request and in Git history, not here — a
document that agents must read before every UI change earns its length back in
accuracy, not in completeness.
