# SafeHaul design-system standard and roadmap

**Mandatory reading before any UI, UX, styling, responsive, accessibility or
visual-component change**, together with
[`src/design-system/README.md`](../src/design-system/README.md) and the relevant
component/pattern docs. It states the **current standard only**: the permanent
rules, the approved exceptions, the automated guardrails and the open decisions.

**Status legend:** `[ ]` Not started · `[~]` In progress · `[x]` Completed and
verified · `[!]` Blocked or requires an owner decision. `[~]` and `[!]` are
project conventions; if a renderer shows plain boxes, the text status is
authoritative.

## 1. Non-negotiable architecture

- The design system controls reusable visual appearance and interaction; feature
  folders control feature content, available actions and domain-to-UI mapping.
- Hooks and services control data, state, integrations and business logic;
  `src/app` controls composition, routes, guards and providers.
- Feature screens stay with their features and consume approved design-system
  components.
- **The design system must never know what a driver, recruiter, application,
  lead, campaign or company is.**
- No UI work may change Firebase rules, database structures, backend behaviour,
  integrations, permissions, routes, feature flags or business workflows merely
  to simplify UI code.
- Legacy styles are removed only after all known consumers migrate and the
  replacement is functionally, visually, responsively and accessibly verified.
- **WCAG 2.2 AA is the permanent standard** for every primitive, pattern and
  screen (owner, 2026-09-04).

### What UI work must not change

- route URLs, authorization, role checks and feature flags;
- Firebase rules, indexes, data shape, Cloud Functions or integrations;
- submission, campaign, recruiting, verification, signing or document workflows;
- PDF field geometry, signing coordinates, upload semantics or offline queues;
- domain status vocabulary, without a separate product decision;
- feature ownership of screens and actions;
- branded artwork, unless accessibility or consistency requires an approved
  adjustment.

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

The reverse directions are prohibited — including any `@shared` import inside
`src/design-system`, in stylesheets as well as modules — and enforced by
`src/design-system/tests/architecture.test.js`.

## 3. Rules for writing UI

**Components, colour and type**
- **Reuse approved components and semantic `--ds-*` tokens.** Do not create a
  local button, modal, form control, table, status treatment, arbitrary colour,
  unsupported font size or competing visual primitive unless this file records
  the missing capability (§5) **and** the code documents the temporary
  exception.
- **No 9px or 10px body text.** The floor is 12px for interface text.
- **Status is never colour alone** — always text or icon plus tone; a `Badge`'s
  label carries the meaning.
- **`--ds-color-content-muted` is safe on every surface** (slate-600: AA on
  `surface`, `surface-subtle`, `canvas` and all six status backgrounds, asserted
  by `tokens.test.js`). Call sites already on `content-secondary` need no
  change.
- **Dark surfaces use the inverse roles**: `--ds-color-surface-inverse`,
  `-inverse-subtle` and `-inverse-hover`, `--ds-color-border-inverse`, text in
  `--ds-color-content-on-inverse` / `-on-inverse-muted`, and status text in
  `--ds-color-status-*-fg-on-inverse`; never invent a dark header or console
  colour (`--ds-color-content-inverse` is a separate white token). Headers that
  moved to the app surface while those roles were missing (`PEVRequestModal`,
  `VOEPreviewModal`, `VerificationPortal`) are correct and need no change.
- **Brand colours are named.** `--ds-color-brand-primary` (#004C68) and
  `--ds-color-brand-accent` (#0BE2A4) alias the primitives
  `--ds-color-brand-deep` and `--ds-color-brand-mint`; with
  `--ds-color-brand-mint-gradient-start` and `-end` they are the four brand
  values, and every literal copy is compared by a test (§7). The accent is a
  foreground on the inverse surface only (about 1.6:1 on a light one). The
  gradient start sits one unit off `-mint` on purpose: the artwork as authored.
- **Convert radius and shadow by value, never by name.** Tailwind's names sit
  one step off the `--ds-*` scale: `rounded` 4px = `rounded-ds-sm`, `rounded-lg`
  8px = `rounded-ds-md`, `rounded-xl` 12px = `rounded-ds-lg`, `rounded-2xl`
  16px = `rounded-ds-xl`, `rounded-full` = `rounded-ds-full`; `shadow-sm` is the
  `shadow-ds-xs` step, and Tailwind shadows are pure black where the `--ds-*`
  ones are slate-tinted.
- **`sr-only` and `.ds-visually-hidden` are the same rule, and both stay.**
  Anything that decides "is this hidden?" (an E2E sweep, a guard exemption)
  names both; a hidden control is 1×1, not 0×0.

**Controls**
- **One control scale, and the default is the aligned case.**
  `--ds-control-height-{sm,md,lg}` is 36 / 44 / 52px, read by `Button`,
  `IconButton`, `Input`, `Select` and `Textarea`, all defaulting to `md`. Never
  set a size to match a neighbour or use `size="lg"` to line a button up with an
  input: `lg` is for the primary action of a public, mobile-first, single-task
  screen (`StepNavigation`, `Step9_Consent`, `EmploymentCoveragePrompt`,
  `UploadField`, `LoginScreen`, `VerificationPortal`, `SignatureSheet`,
  `ReviewChangePortal`, `ApplyIdentityCheckScreen`). A thing that is not a
  control must not read a control height (`--ds-metric-icon-size`,
  `--ds-table-selection-control-size`).
- **`xs` is 24px — the WCAG 2.2 SC 2.5.8 minimum — and icon-only**:
  `IconButton size="xs"` reaches it, `Button` refuses it, `shape="round"` cuts a
  disc for a control on another element's corner. On the PDF overlays a pointer
  target meets 24×24 on the target itself rather than leaning on 2.5.8's
  equivalent-control exception (owner decision for the corner badges,
  2026-09-05; the resize handles follow because neither exception fits them).
- **`Button variant="link"`** is an action that reads as inline text: still a
  `<button>`, the one variant off the height scale, with a pseudo-element taking
  its hit area to about 26px; `IconButton` refuses it.
- **Form controls are 16px under 639px** (`--ds-font-size-control-mobile` on
  `.ds-form-control`, selects too): no iOS zoom.
- **A control that saves immediately is a `Switch`**; a `Checkbox` announces a
  value you set and then submit.
- **A `Select` bound to stored data offers a stored value its options lack as
  its own option**, rather than letting the browser show the first option.
- **Explain rather than prevent.** A field the viewer may not change is a
  read-only display with a `Badge`, never a disabled input; enforcement lives in
  logic (e.g. `applicationLockedFields.js`). Do not disable an action because a
  prerequisite is unmet: let it validate on press, say why in
  `FieldMessage tone="error"` and focus the offending field. `disabled` is for
  an operation in flight (`Button`'s `loading`); `aria-disabled="true"` looks
  the same but stays in the tab order, so the caller refuses the activation
  itself. A control that cannot work is not rendered.

**Icons**
- **Every glyph comes from `@design-system/icons`, at a step on the scale.**
  `--ds-icon-size-{xs,sm,md,lg,xl,2xl,3xl}` is 12 / 14 / 16 / 18 / 20 / 24 /
  32px (`--ds-control-icon-{sm,md,lg}` are aliases); nothing below 12px. A glyph
  is a **token**, rendered only through `<Icon icon={…}>`:
  `<Trash2 size={13} />` throws by name, as does a token rendered from a local
  binding (`<Glyph />`, `<item.icon />`). Never name a local binding `Icon` — it
  shadows the imported one.
- **A container sizes the glyph it holds, and owns the gap beside it.**
  `Button`, `IconButton`, `Tabs`, `Chip`, `SegmentedControl`, `FileInput` and
  `StatusMedallion` size any contained `svg` (`size={24}` in a button does
  nothing, deliberately; `Icon.css` sizes through a zero-specificity
  `:where()`), so a glyph inside one states no size. The gap is `--ds-space-2`
  on `.ds-button`, inherited by `.ds-button__content`. `StatusMedallion` holds
  24 at `md` and 32 at `lg`; `Badge` sizes only a glyph passed via its `icon`
  prop (§5).
- **An off-scale size means a missing container, not a short scale.** Snap a
  1–4px delta to the step. A glyph in a **fixed** frame with real geometry (a
  128px logo frame, a 12px PDF handle) takes its size from the frame, with the
  arithmetic at the call site; in a **fluid** container it snaps, and a
  page-level state glyph is `3xl` (32).
- **Decorative glyphs are `aria-hidden`; a glyph that *is* the control takes
  `label`** and becomes `role="img"` with that name. A blank `label` throws.

**States, announcements and focus**
- **A state must announce itself.** Loading and empty are `role="status"`
  (polite); errors are `role="alert"`. Use `EmptyState` / `ErrorState` /
  `LoadingState` from `@design-system/patterns`.
- **Never nest live regions.** Inside a caller's always-mounted
  `role="status"`/`role="alert"` wrapper a `Notice` takes `announce="off"` (two
  regions announce twice; moving the role onto a conditional child silences it);
  `FieldMessage tone="error"` is its own `role="alert"`. A polite region must
  exist, empty and not `display: none`, before it fills.
- **A busy control is a state too, and `aria-busy` is not an announcement.** The
  primitive that owns `loading` owns its region: `FileInput` renders one polite
  `role="status"`, always present and empty when idle. A changing label is
  content, not an announcement, and moves the accessible name — keep "Save" and
  put "Saving…" in a `role="status"`.
- **Restoring focus is a claim about where focus was.** Ask what was focused
  when the data arrived (`document.activeElement === theControl`), never which
  event delivered it; `<body>` afterwards means "nothing to steal from", never
  "this focus was mine". A state replacing the control just activated moves
  focus (`PageState focusOnMount`).
- **A drop target always cancels the drop** (`preventDefault` first, even when
  disabled or loading) — the browser's default for a dropped file is to navigate
  to it. A call site that unmounts `FileInput` once a file is chosen shows
  `onReject`'s message in a region that outlives the picker, only while it is
  gone.

**Links, dialogs and layers**
- **A link navigates; a button acts.** Use `Link` / `ButtonLink` /
  `IconButtonLink`, never a styled `<a>` or a `<button>` dressed as a link. Pass
  `external`, not `target="_blank"`, so the new tab is announced and `rel`
  closes reverse-tabnabbing; a button that acts, then opens a tab, ends its name
  in `ds-visually-hidden` "(opens in a new tab)", opens the tab inside the press
  and points it at the URL once it arrives (closing it on failure), so a popup
  blocker does not swallow it.
- **Every overlay goes through `Modal`** (`@design-system/patterns`); no
  hand-built `fixed inset-0` dialog. Its chrome is `size` / `scroll` / `fill` /
  `mobile` / `placement` / `tone`, not a class list: surface, border, radius,
  shadow, overlay colour, blur and stacking layer have no prop, an unsupported
  value throws, and so do the removed `className` / `overlayClassName`. A new
  shape is a case in `Modal.css` with the row here that justifies it.
- **Confirmations are `ConfirmDialog`**, which routes Escape to `onCancel` — so
  a cancel never destroys anything; a destructive choice gets its own
  `tone="danger"` confirmation.
- **No blocking browser dialogs.** `confirm()` and `alert()`, with or without
  `window.`, are rejected.
- **A stacking layer has a name.** The application scale is `z-ds-raised` (10) /
  `sticky` (20) / `dropdown` (30) / `drawer-backdrop` (40) / `drawer` (50) /
  `modal` (60) / `toast` (100). `z-ds-layer-1..4` only orders siblings inside
  one `isolate` container (outside one it loses to everything), and a dialog
  never renders inside an isolated container. Application chrome is `sticky`,
  page chrome scrolling beneath it `raised`, a real dropdown `dropdown`; no
  `<thead>` sits on `sticky` or above. The one recorded bare number is
  `VOEDocument`'s `-z-10` watermark.

**Tables**
- **Display tables are `DataTable`.** A native `<table>` is approved only per
  §5, and every one — a visually hidden one included — carries `ds-native-table`
  and reads the `--ds-table-*` roles. A native table is not a licence to style a
  table by hand: the contract (`pinnedColumn.css`) paints a frozen cell's
  surface and hover tint, never a hand-picked `bg-*`.
- **Tables on phones follow one rule.** Rows that are *compared* keep the table:
  a labelled, focusable horizontal-scroll region, a sticky header, the first
  column pinned (`DataTable` by default — `pinFirstColumn={false}` opts out, and
  with a selection the checkbox and identifying column pin together;
  `data-pin-first-column` on a native table). A matrix of per-row controls
  worked one record at a time becomes one card per row under 768px
  (`data-mobile-presentation="cards"`, labels from `data-label`, the same DOM at
  every width, and the table roles stated explicitly — `role="table"`,
  `"rowgroup"`, `"row"`, `"columnheader"`, `"cell"` — because `display: block`
  drops the implicit ones). The Super Admin feature matrix is the one
  specialized grid. Source: `components/data-table/README.md` ("Tables on
  phones"), `pinnedColumn.css`, the `Patterns/Native table` story.
- **Scroll regions are keyboard-reachable and named**; every row action has a
  record-specific accessible name. Prefer deciding which actions a row offers in
  a pure, tested module (as `unfinishedRowActions.js` does) over a `render`
  callback.

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
4. desktop visual behavior is reviewed (1440px);
5. mobile behavior is reviewed where applicable (412px);
6. keyboard and accessibility behavior is reviewed;
7. documentation and catalog examples are updated;
8. the final diff contains no unrelated changes.

If a check cannot run, say so, and leave the item open or `[!]`. **Never mark
work complete because code exists.** The PR checklist is
`.github/pull_request_template.md`. Running the visual checks honestly:
- `check:visual-contract`, `check:table-layout` and `test:visual` need
  `npm run build-storybook`.
- A pixel baseline is a claim about one browser build: record or compare it only
  under the pinned Chromium (`npx playwright install chromium`);
  `PW_CHROMIUM_EXECUTABLE` is for the functional lanes only. A shell change
  moves every screen inside it; untouched screens moving too means the wrong
  build, not a result for `--update`.
- The same holds for `check:visual-contract`: sub-pixel moves on primitives the
  change did not touch mean the wrong Chromium build. Compare with what the base
  commit reports; never `-- --update` from it.
- Every pixel-lane route reaches a settled state from fixture data, and a
  subject's `ready` names the last thing to arrive. Remove a non-deterministic
  input; never widen `maxDiffPixels` or weaken `check:visual-contract` to absorb
  it.
- `check:table-layout` measures the catalog only: a feature table that changes
  shape needs a human look on mobile.
- A test must not find a region by a styling utility (`.z-30`,
  `.rounded-t-ds-xl`): use a `data-testid` or the chrome contract
  (`.ds-modal[data-placement="bottom"]`), and assert an axe `include` matched
  before running axe.

## 5. Approved, evidenced exceptions — these are not debt

Do not "fix" these without reading why they exist. Each is recorded in the
component too, and every allowlist entry tolerated for one of them cites this
section. (Other entries: the design system's own `DataTable`, `FileInput` and
`TabList`, where the rules send feature code; two test doubles; the two
pre-existing `rounded-full` status dots in `VOEPreviewModal`'s sub-header;
tinted blocks `hand-composed-notice` tolerates — §7.)

| Exception | Where | Why it is allowed | Retires when |
|---|---|---|---|
| `ModernDriverTable` does not adopt `DataTable` | `src/shared/components/table/ModernDriverTable.jsx`; one consumer, `UnifiedDriverList` | Consumer-owned `render()` columns with per-cell `stopPropagation`, row activation, per-row selection *and* a footer pager, plus a caller `getRowClassName` with no `getRowTone` equivalent — unproven for `DataTable` on the highest-row-count surface. Its contract tests assert everything `DataTable` would supply | — |
| Native tables for editable matrices and per-row interactive rows | `FeaturesView` (×2), `AssignmentTable`, `LineManager`, `CompaniesView`, `CampaignResultsTable`, `DetailedReportModal`, `ModernDriverTable` (×2), `AnalyticsView` (×3: linked tables in one scroll region with per-row actions, plus the chart's `sr-only` text equivalent), `ViewCompanyAppsModal` (per-row filter in a dialog), `StatsBackfillPanel` (six per-row actions, live progress), `UsersView` (in a virtualised scroll region: `DataTable` owns its own, and nesting two reproduces the dead-gutter defect) | `DataTable` is proven only for display tables. Every `<table>` applies `ds-native-table` (`components/data-table/nativeTable.css`) and so reads the `--ds-table-*` roles; `check:ui-contract` checks it per `<table>`, `check:table-layout` measures it | — |
| The generated 49 CFR §391.23 document | `VOEDocument.jsx`, shown by `VOEPreviewModal`: raw palette, sub-12px and off-scale type, Tailwind radii/shadow, the `-z-10` watermark, three glyphs opened through `glyphComponent` | Immutable legal content that must render the same next year: a `--ds-*` role is themeable by design, and a palette change must never restyle a signed, exported regulatory artefact. Its class list is the rasteriser's capture surface. (Not because tokens would fail to resolve — `html2canvas` reads computed style and `collectPrintStyles` inlines the app's stylesheets.) Its raw shades still meet AA, and the `voe-print-export` axe scan includes it. `VOEPreviewModal.export.test.jsx` enforces the boundary both ways | Export parity is re-proved — a real captured PDF and a real printed page, not a unit test. Treat any exported document as immutable content |
| White paper in the print safety net | `src/shared/utils/printDocument.js` (`PRINT_DOCUMENT_STYLES`) | `background: #ffffff` is a fact about paper, not a surface role; these rules are injected as a string for the case where `collectPrintStyles` could not read a sheet | — |
| Signature ink | `SignatureSheet.jsx`, `SignaturePad.jsx`, `lib/signature.js` (×2, which must agree) | The canvas is rasterised to a PNG stored in a signed document; re-theming must never retint a signature already given | Never |
| `DeviceMockup` artwork | `campaigns/components/DeviceMockup.jsx` | A picture of a physical phone: bezel, buttons and battery pips are moulded plastic, declared once in the `DEVICE` constant; the status-bar time is `text-[10px]` because a real one is that small. The *screen* takes `--ds-color-surface`; the fake status bar is `aria-hidden` | Never |
| Login hero wash | `LoginScreen.jsx` (raw hexes, `bg-white/5`) | Artwork: three blobs blurred over 256–384px, `aria-hidden`, no information; an opacity modifier cannot apply to a `var()` colour. Everything meaningful on the panel uses the brand roles | — |
| Facebook's brand blue | `IntegrationsTab.jsx` (`#1877F2`) | A third-party mark, not a SafeHaul role; it must not move when this palette does | — |
| Audience preview scrim `bg-black/20` | `AudienceBuilder.jsx` | No role matches: `--ds-color-overlay` is slate-900 at 60%, so a swap would lighten and re-tint the backdrop | A semantic scrim role is named (§6) |
| PDF-geometry controls | `SignerField` (signature button, three inputs, and their own 16px `text-base` because they are not `.ds-form-control`); `ResizableDraggableField`'s inline label editor | They overlay author-placed field boxes as small as 8px, which the shared 36/44/52 heights and padding would break. Each keeps an accessible name, a focus-visible ring and `--ds-*` tones | A geometry-free field exists in the design system |
| Programmatic file pickers | `PEVTab` (per-employer result upload opened by a row action; `hidden` and named), `IntakeChooser` (CDL scan behind one of two choice cards; the card is the `Button`, the input is `aria-hidden`) | `FileInput` is a visible control by contract, and here the affordance is something else | — |
| Roles `Button` cannot carry | `EmployerNameAutocomplete` (`role="option"` in the combobox listbox); `CampaignCard` (two `role="menuitem"` overflow entries and one chrome-less stat trigger) | `Button` renders `role="button"`, which breaks the option and menuitem contracts; the stat trigger is a chrome-less text-and-icon cell trigger. All are tokenised with the shared focus ring | The Combobox / Listbox and Menu rows below |
| Bottom app bar | `EditorMobileBar` | Equal-width 56px icon-over-label targets — the platform convention, deliberately taller than 44px; each named "Open <section>" | Not being built (one consumer) |
| Raw Tailwind spacing | Tree-wide (`p-4`, `gap-3`, `mb-6`…) | `--ds-space-1..12` and Tailwind's `1..12` are the same 4–48px values, so nothing diverges; `p-7`, `p-9`, `p-11`, `p-20` have no `ds-` step | If `--ds-space-*` is ever re-tuned: a one-to-one sweep |
| The `web/` public site | `web/` | Hand-written CSS with no build step for the blog and privacy page, with its own spec in `DESIGN.md`. "Public pages" here means the application routes `/apply/:slug`, `/verify/:token`, `/review-change/:token`, `/sign/...` and `/login`, all migrated | Out of scope |

### Missing primitives that live code is waiting on

Each gap keeps a feature-owned control in the tree with a documented exception
that retires when the primitive lands. **Do not delete an entry while its call
site still cites it.** Before declaring a family closed, check the primitive
against every shape its call sites have (one that fits a third of them does not
get adopted), cite only consumers that really have the shape, and ship it with
its consumers and a `check:ui-contract` rule — a roadmap line is not a guard. A
rule must not demand a component that does not exist: record the gap here
instead.

| Gap | Status | Call sites, and why the nearest primitive does not fit |
|---|---|---|
| **Tinted icon tile** | Open — the largest un-owned shape | A rounded **square** carrying a brand or domain glyph on a brand or status tint: about two dozen sites, 32–80px, e.g. `ReviewChangePortal` (a shield on `bg-ds-action-primary`), `PaywallMessage`, `BrandingSection` (frame-sized glyph), `PersonalProfileTab`. Every rule misses it because each uses correct roles. A status-tinted **circle** around a glyph is `StatusMedallion` today — migrate those. It is also why `Notice`'s `accent`/`neutral` glyph defaults stay recorded guesses |
| **Combobox / Listbox** | Open | `EmployerNameAutocomplete.jsx` hand-builds the full ARIA combobox (`role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant` over a `role="listbox"`), correctly; nothing owns a text input that filters a list. Worth promoting |
| **Step indicator (read, not operated)** | Open | `BulkUploadLayout.jsx` (`<li>`) and `SendTemplateWizard.jsx` (`<span>`) carry `aria-current="step"` on a progress display a person reads. `SelectableCard` is for picking and `SectionNavigation` is a navigation rail; `hand-rolled-current` is scoped to `<button>`, so it leaves them alone |
| **"Badge does not size its glyph"** | Open | `Badge` sizes a glyph passed through its `icon` prop but has no rule for one passed as a child, so `EnvelopeHistory` keeps `size="xs"`; `DataTable` and `SectionNavigation` carry no `> svg` rule either |
| **Notice as a named landmark** | Open (one consumer) | `StatusScreens` (ESIGN consent) is a `<section aria-labelledby>` region a reader can jump back to; `Notice` cannot be a landmark, and one caller is not enough to design a prop around |
| **Toast promotion** | Open — a missing home, not a missing shape | `ToastProvider` (`src/shared/components/feedback/ToastProvider.jsx`) is the single owner and every consumer uses it, but it sits outside `design-system/` with no story, baseline or catalog entry. Promoting it is a move plus a catalog entry |
| **Bottom app bar** | Not being built | `EditorMobileBar` (exception above); one consumer |
| **Menu / overflow menu** | Not being built | `TemplateLibraryPanel.jsx` shows every template action as a visible button, which at that size is the better answer; `CampaignCard`'s card menu keeps `role="menuitem"` entries, which `Button` cannot be |

Closed gaps are listed with their families in §8.

## 6. Open decisions and blockers

Nothing open here gates a primitive, a token or a baseline: the visible families
are fully approved, §7 is permanent.

| Decision | Blocked on | Decided by |
|---|---|---|
| `[!]` Replacement wording for the customer named in operator copy: `StatsBackfillPanel`'s All-Companies help text reads "Only run after verifying Ray Star LLC results.", preserved verbatim | The repository establishes no generic replacement | Owner (product/copy) |
| `[ ]` A semantic scrim role, retiring the audience preview's `bg-black/20` (§5) | Naming a new role is a design-system decision, not a mechanical swap | Design-system decision |
| `[ ]` Whether `Notice` may carry positioning and elevation, so `QueueStatusIndicator`'s fixed floating banner (`fixed bottom-4 right-4 z-ds-toast`, `shadow-ds-lg`, its local `QueueNotice`) can be absorbed | `Notice`'s `className` contract is margin and width only, so this is a component change, not a migration | Design-system decision |
| `[ ]` `rem` instead of `px` for the `--ds-*` contract | Zoom scales both (WCAG 2.2 SC 1.4.4 is met), but `px` ignores a user's default font-size preference; it would be its own campaign with its own visual review | Recorded, not scheduled |
| `[!]` **NO-GO beyond presentation:** Company Settings → SMS. Number assignment is migrated for presentation only, and its contracts are frozen: the `saveSmsLineAssignments` and `verifyLineConnection` payloads, the line-token model, the `sms_provider` document. `LineManager` (the Phone Line Wallet, secret entry) stays unmigrated and out of scope | Entanglement with `LineManager` | Owner |

| Settled ruling that still binds | What it requires |
|---|---|
| Brand and action colours approved (owner, 2026-09-04) | The palette as it stands — the blue-led action colours beside the navy (`#004C68`) and mint (`#0BE2A4`) brand assets. No recolouring is pending |
| Inter is served from this repository | `src/design-system/fonts/` holds the two variable faces (SIL OFL 1.1); no stylesheet may `@import` a remote font (`test-ci-plan.mjs` K3) |
| Visual baselines live in this repository | `playwright.config.cjs` sets `snapshotPathTemplate` so each sits beside its spec; a baseline change is reviewed and approved with its pull request. No external service |
| Unified Driver Database bulk actions removed | A control that does nothing is not shown; `UnifiedDriverList.bulkSafety.test.jsx` pins the absence. A real action returns with its selection when a recruiter asks — "Export" first, "Archive" only once an archived state is defined (Archive is not delete). `LeadAssignmentModal` is single-company and campaigns own bulk SMS with their own consent rules; both bind the first real action |
| Employers sign the verification portal by drawing or typing | `SignatureInput` (`shared/components/signature`) wraps the pad in a `SegmentedControl` Draw \| Type choice, Draw by default; a typed name is stored as `TEXT_SIGNATURE:<name>` and never rasterised; the method travels with the response and the server refuses a mislabelled one; the DQ-file PDF prints a typed name in an oblique face under "(typed)"; switching method clears the mark |
| Editable matrices and tables on phones | The §3 table rule; the SMS recruiter matrix is one card per row under 768px and a table with its name column pinned above it |
| AI Integrations → Logs (`AiLogsPanel.jsx`) | `DataTable` at `density="compact"`, `minWidth="wide"`, default labelled horizontal scroll; nothing hidden at any width, full detail in a dialog reached by activating the row; status column `xl` (a non-wrapping `Badge` plus detail text) |
| Guided tour removed (owner) | A reintroduced tour must first answer the dialog question — a blocking backdrop needs `role="dialog"`, a focus move and Escape — starting from a named close control and step progress announced in text |
| Facebook Integrations flag stays off (owner) | The visible "not production-ready" notice stays with it; `scripts/audit-facebook-lead-tenancy.mjs` is a read-only report |
| `Modal` and `ConfirmDialog` live in `design-system/patterns/modal` | Import them from `@design-system/patterns`; the `shared` barrel does not re-export them. The domain modals (`CallOutcomeModal`, `CompanyChooserModal`, `FeatureLockedModal`, `ManageTeamModal`) stay in `shared` |

## 7. Permanent automated guardrails

These exist because a human review missed what they now catch. Do not weaken or
delete one without replacing the guarantee. All are blocking, and none may carry
`continue-on-error`.

| Guard | What it refuses | CI job · pinned by |
|---|---|---|
| `src/design-system/tests/architecture.test.js` | An import from features, application context, Firebase or `shared` into `src/design-system`, in modules and stylesheets (every `@import` and `url()` is resolved); a story importing features, Firebase, context or domain services | `frontend-quality` |
| `src/design-system/tests/tokens.test.js`, `src/design-system/tests/tokens.consumers.test.js` | A broken semantic token contract or a contrast pairing below AA (both directions); an unbridged Tailwind utility; a control sizing itself in pixels; stacking layers out of order or without a utility; a removed hand-placed `isolate` (`PdfFieldWorkbench`'s page wrapper, the feature matrix's scroll region); a token nothing reads | `frontend-quality` |
| `src/design-system/tests/stackingLayers.test.js` | A `<thead>` on `sticky` or above; the topbar, notifications panel and candidate toolbar layers are pinned individually | `frontend-quality` |
| `src/tests/noBlockingBrowserDialogs.test.js` | `confirm(` / `alert(` anywhere under `src/`, with or without `window.` (comments and strings stripped) | `frontend-quality` |
| `src/tests/pageShell.test.js` — *the one class no guard could hold* — and `src/tests/brandAssets.test.jsx` | `index.html`'s `<body>` without exactly one background utility, `bg-ds-canvas`, on a declared role (`raw-palette-class` cannot hold it — a swap to another role passes — and the pixel lane cannot see it); a favicon or `theme-color` literal differing from the brand tokens, favicon paths or gradient geometry differing from the logo's, a hex in `Logo.jsx` or `SafeHaulLoader.jsx` | `frontend-quality` |
| `VOEPreviewModal.export.test.jsx` | A `ds-*` class inside the exported §391.23 document, or a missing token outside it | `frontend-quality` |
| `src/tests/uiContract.ratchet.test.js` | `check:ui-contract`'s rules missing their defects or firing on correct code | `frontend-quality` |
| `npm run check:ui-contract` (`scripts/check-ui-contract.mjs`) | Zero-tolerance against the allowlist: raw palette classes; raw hex (`raw-hex-colour`: classes, CSS, SVG presentation attributes, JS assignments — not anchors, gradient references, id selectors or hex-like placeholders); sub-12px and off-scale type; Tailwind and bare radii/shadows (`tailwind-radius`, `tailwind-shadow`); `@apply`; bare stacking numbers (`raw-z-index`, `css-raw-z-index`); hand-built overlays (`hand-built-overlay`); raw tables (`raw-table`); hand-styled controls (`hand-styled-button`, `hand-styled-field`, `hand-styled-anchor` — a class list hoisted into a variable is resolved, `scripts/ui-contract/bindings.mjs`); hand-rolled `role="tablist"` strips (`hand-rolled-tablist`), toggles (`hand-rolled-toggle`, a raw `<button aria-pressed>`), current-item controls (`hand-rolled-current`, a raw `<button aria-current>`), avatar discs (`hand-rolled-avatar`, a round disc holding a person's initial) and disclosures (`hand-rolled-disclosure`, a `<button aria-expanded>` inside a heading); hand-composed notices (a `bg-ds-status-*-bg` tint with its matching border on an element whose own body holds words and no control, table or `Card` — `src/design-system/` included); raw file inputs; hand-written `target="_blank"`; a JSX-element `label` on a primitive that throws on a non-string one (`jsx-label-on-throwing-primitive`); an approved native table without `ds-native-table`, counted per `<table>`. It scans what Tailwind's `content` compiles — `src/` and `index.html` (class-list rules only there and in stories) | `callable-contract`, with `--require-baseline` · `scripts/test-ui-contract-ci.mjs` W1/W2, W13/W14 |
| `src/design-system/ui-contract.allowlist.json` (read by `check:ui-contract`) | Anything unlisted, a count higher or lower than recorded, an entry whose rule has no `reasons` text — there is no `debt` option. Compared against git (`scripts/ui-contract/baseline.mjs`, sharing `SOURCE_SIZE_BASE`): an entry may record only a violation the base commit already carried, so a recorded exception is a frozen ceiling and a file the change creates can never carry one; a moved or split file keeps its entries through git's rename and copy attribution, never a violation the move introduced; a change that widens a rule may record what the base already held. `--update` only shrinks — write an addition by hand, with a reason. Keys are repo-relative. The design system is exempt from `hand-rolled-toggle` and `hand-rolled-current` only (`SegmentedControl`, `SectionNavigation` are those shapes), as a named list, not a path skip | `callable-contract` · `scripts/test-ui-contract-baseline.mjs` |
| `npm run test:ui-contract` (five suites) | Wrong decisions on fixtures (`scripts/test-ui-contract.mjs`; §H keeps stylesheets and HTML out of the JSX parser); the state rules (`scripts/test-ui-contract-state.mjs`, §P, with §P6/§P7 asserting exemptions as a set); lost coverage — per-format floors, every Tailwind `content` root scanned (`scripts/test-ui-contract-scope.mjs`, §S2f); an inventory the branch could edit (`scripts/test-ui-contract-baseline.mjs`); CI not running it unskippably (`scripts/test-ui-contract-ci.mjs`, W6 reading the suite list off disk) | `callable-contract` |
| `npm run check:icon-contract` (`scripts/check-icon-contract.mjs`) | A `lucide-react` import anywhere under `src/` outside `src/design-system/icons/`. There is no backlog, and the checker refuses an empty one | `callable-contract`, with `--require-baseline` · `scripts/test-icon-contract-ci.mjs` X1–X18 (X17 refuses an empty backlog) |
| `react/jsx-no-undef` and `react-hooks/rules-of-hooks` = `error` (`eslint.config.js`) | A JSX name that was never imported, such as `<Icon>`; a hook called conditionally | `frontend-quality` · X15/X16, X18 |
| `npm run test:stories` (`src/tests/designSystemStories.a11y.test.jsx`) | A catalog story that fails to render or fails axe | `storybook-build` · `test-ci-plan.mjs` K1b |
| `npm run check:table-layout` (`scripts/check-table-layout.mjs`) | In a real browser at 412px and 1440px, over `DataTable` and `ds-native-table`: a cell whose content overflows unless its column opts into `truncate`, and a region reserving a gutter it never scrolls into. It must stay a real-browser check (jsdom has no layout engine); it waits on `document.fonts.ready` plus two painted frames, fails if it measures zero tables, and honours `PW_CHROMIUM_EXECUTABLE` | `storybook-build` · K1b |
| `npm run check:visual-contract` (`scripts/check-visual-contract.mjs`) | Computed geometry at both widths against `src/design-system/tests/visual-contract.snapshot.json` — control heights, cell padding, radii, resolved colours, glyph sizes and the glyph–label gap, frozen-column backgrounds, `SelectableCard`'s states, `SectionNavigation`'s grid templates. A failure names what moved | `storybook-build` · K1b |
| `npm run test:visual` (`e2e/visual/`) | A pixel change to a catalog subject or application screen at 1440px or 412px, against baselines committed beside the specs. It reports every failure (the catalog describe is never `mode: 'serial'`); its first test is a font tripwire (`document.fonts.check('400 16px Inter')` plus pangram metrics, never `getComputedStyle().fontFamily`); both lanes freeze the clock (`e2e/visual/settle.cjs`), and `playwright.visual.config.cjs` pins `locale: 'en-US'` and `timezoneId: 'UTC'`. A failing run uploads the `visual-regression-diff` artifact | `storybook-build` · K1 |
| `npm run test:e2e -- --grep "@a11y"` (`e2e/a11y.spec.cjs` and friends) | Real-browser axe failures on the mobile-critical journeys, plus what axe cannot see: roving `tabIndex`, arrow/Home/End on a tab strip, `aria-pressed` on a segmented group, a file input named by its field, the product's focus ring on every Tab stop | `frontend-e2e` · K2/K2b |
| `npm run check:ci-plan` (`scripts/test-ci-plan.mjs`) | Any step above made advisory, renamed away or grep-inverted (K1, K1b, K2, K2b); a remote `@import` in `src/index.css` or `.storybook/preview.css` (K3), or a missing font file or licence (K3b) | `callable-contract` |

### The one guard that is a person

A **hand-composed pattern** — correct primitives in a shape the design system
owns: a status screen from `Card` + `StatusMedallion` + heading + body +
actions, a `Modal` with its own Cancel/Confirm footer, a tinted message block —
passes every rule. Review every UI change with these searches, plus
`bg-ds-status-\w+-bg` outside `src/design-system/`:

```
grep -rl StatusMedallion src/features src/shared     # a medallion outside the DS
grep -rnE '(function|const)\s+\w*Dialog\w*\s*[=(]' src --include=*.jsx
```

Search by shape, not by word: a confirmation is often named after what it
deletes. Known-good hits: `StatusMedallion` in `StatusScreens`
(`EsignConsentScreen`), `FeatureLockedModal` (a marketing interstitial),
`FeatureDeactivationWarning` (a notice with one action) and inside ordinary
content in `SandboxActionPanel`, `NumberAssignmentManager`, `DQFileTab`,
`BulkUploadLayout`; `*Dialog` wrappers around `ConfirmDialog`
(`ReleaseConfirmDialog`, `RemoveMembershipDialog`, `RunAllConfirmDialog`). Each
tinted block `hand-composed-notice` tolerates is a judgement that can be wrong —
read them.

### Rules for changing a guard

- Prove a guard fails on the broken input before trusting it passing — run the
  mutation. A guard that cannot fail is not a guard, and a red guard must report
  every failure it knows of.
- A guard that measures nothing fails: zero tables, zero files or a vanished
  subject is a broken check, not a pass.
- Read JSX through `scripts/ui-contract/jsx.mjs` (`lastClassSetter`,
  `certainlyText`, `parseModule`); never copy them into a new rule.
- Ask "does this element carry this attribute?", never "does this text appear?".
  When a check needs a third fix, change what it asks rather than how carefully
  it looks, and sweep the sibling rules for the same shape.
- The native-table tether accepts only the provable on the last attribute that
  sets the class list (a string literal, a conditional or `||`/`??` with the
  token on both sides, a bounded template-literal token; `&&`, calls, arrays,
  concatenation, objects, bare identifiers fail). One more bypass reverts it to
  a per-table check, recorded as open.
- A styled-control rule may under-report but must never fire on a control it
  cannot prove is styled (one binding, no reassignment or shadow, styling text
  on every path); `className={props.className}` is a pass-through.
- A guard must not take its scope from something narrower than its claim, and
  one that refuses the wrong kind of value has not pinned the right one — pin it
  with a test. A copy nothing compares is a copy that diverges.

### Still open

- Most `check:ui-contract` rules still match text; only the native-table tether
  and the styled-control rules parse.
- `hand-composed-notice` reads literal classes, so a tint arriving through a
  lookup (`const { wrapper } = TONES[tone]`) is invisible to it.
- `check:table-layout` measures the catalog, not the application — a feature
  screen with no story is not measured (`test:visual`'s screens check
  appearance, not overflow); some screens have no baseline at all, e.g. the
  campaign editor and the schema editors' edit mode.
- In `index.html` the scan runs only the class-list rules; values in attributes
  there are pinned by tests, not a rule.
- Tailwind's extractor compiles class names found in prose (`.bg-gray-50` ships
  from comments that name it — the hazard `tailwind.config.js` documents for
  stories). Recorded, not fixed.

## 8. Migration state

**The programme is closed.** All 19 screen areas are migrated — the company
workspace and settings, login/auth, the public driver application, the driver
dossier, PEV/VOE, e-docs and signing, lead intake and Super Admin — plus the
Environment & Integrations vault, AI Integrations, Blog Posts and AI provider
priority; newer screens use approved components and `--ds-*` tokens from the
start. Every remaining exception rests on a true reason recorded at the call
site and in the allowlist (`npm run check:ui-contract` prints the count). One
area is NO-GO beyond presentation (§6).

**Complete families** — the primitive exists *and* every consumer that can use
it does:

| Family | Owned by |
|---|---|
| Dialog shell and chrome (`size` / `scroll` / `fill` / `mobile` / `placement` / `tone`); confirmation dialog | `patterns/modal` → `Modal`, `Modal.css`, `ConfirmDialog` |
| Empty / error / loading state | `patterns/page-state` |
| Stacking layers | `tokens/foundation.css` → `--ds-z-*`; entitlement in `tests/stackingLayers.test.js` |
| Icons | `icons/` (`Icon` + glyph tokens); one recorded exception, `VOEDocument.jsx` (§5) |
| Table (display and native) | `components/data-table` + `ds-native-table` |
| Pressed state; toned button; compact icon-button step | `components/button` → `pressed`, `tone`, `IconButton size="xs"` (pressed also `components/chip`) |
| Navigation and external links; tab strip; single-select toggle group; file picker | `components/link`, `components/tabs`, `components/segmented`, `components/file-input` |
| Interactive pill / chip; person or organisation disc; selectable record card | `components/chip` (`Chip` + `ChipGroup`), `components/avatar`, `components/selectable-card` |
| Editable-in-place value; collapsible section | `components/form` → `Input variant="inline"`; `components/disclosure` (rail and `variant="card"`) |
| Section rail (page and step); status notice / callout | `components/section-navigation`; `components/notice` |
| Toast / notification | `shared/components/feedback/ToastProvider` — consumers complete, **not in the design system** (§5) |

Families still in progress — inputs, select/textarea, loading primitives beyond
`ProgressBar` — are tracked by the guardrails in §7 rather than by a list of
screens. Open shapes are in §5.

### Catalog

Storybook (`npm run storybook`, `npm run build-storybook`), built in CI by
`storybook-build` with no credentials. Stories render only hand-written fixtures
from `src/design-system/stories/fixtures.js` — **no production data may appear
in a story** — use no domain vocabulary, and state **Approved**, **Needs
review** or **Temporary**. The catalog is what people copy, so stories meet
`check:ui-contract`'s class-list rules; the markup-shaped rules are off, as a
story legitimately demonstrates a native table and discusses the patterns the
rules forbid.

## 9. Keeping this file useful

This file states the current standard only; history lives in
`docs/archive/design-system-docs-2026-10-02.md`. When you finish design-system
work, update the relevant row here in the same change. Add an entry only when it
is a rule, an approved exception, a guardrail or an open decision; completion
narratives, dated verification tables, test counts and implementation logs
belong in the pull request and in Git history. `npm run check:agent-docs` caps
this file's length.
