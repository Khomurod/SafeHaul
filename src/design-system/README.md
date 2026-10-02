# SafeHaul design system

This directory is the business-neutral visual contract for SafeHaul. It owns how
reusable interface elements look and behave; it does not decide what driver,
recruiter, application, lead, campaign or company data is shown.

Before changing UI code, read:

1. `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`
2. This file
3. The component or pattern documentation relevant to the change

## Layer responsibilities

- `tokens/` — primitive and semantic design decisions and the Tailwind bridge.
  Feature code prefers semantic tokens over palette values.
- `components/` — small, accessible, business-neutral controls and display
  primitives.
- `patterns/` — components composed into repeatable UI states such as data
  presentation, forms, empty states and dialog structure. `patterns/modal` holds
  `Modal`, the accessible dialog every overlay goes through, and
  `ConfirmDialog`, the one confirmation shape. `patterns/page-state` holds
  `EmptyState`, `ErrorState` and `LoadingState`, which own the announcement each
  state needs as well as its appearance.
- `layouts/` — business-neutral page and region composition.
- `icons/` — the icon contract: `Icon`, a seven-step size scale, the
  accessible-name rule and a registry of **glyph tokens** that render only
  through `Icon`, so a call site cannot pass its own pixel number.
  `npm run check:icon-contract` refuses a `lucide-react` import anywhere under
  `src/` outside this directory, with nothing recorded and nothing exempt.
  `Icon` still accepts a bare component, which is how a design-system container
  resolves an `icon` prop. One file opens a glyph by hand — `VOEDocument.jsx`,
  through `glyphComponent`, because the exported §391.23 document must carry no
  `ds-*` class and `Icon` stamps one; the reason is written above the calls. See
  `icons/README.md`.
- `fonts/` — Inter's two variable faces (SIL OFL 1.1), served from this
  repository rather than a CDN (roadmap §6).
- `stories/` — the component catalog, built with Storybook 10 and configured in
  `.storybook/`. `npm run storybook` runs it; `npm run test:stories` renders
  every story and runs axe over it. See `stories/README.md`.
- `tests/` — token, contrast, stacking-layer and dependency boundaries.

Feature screens remain in `src/features`. Features own content, available
actions, domain-to-visual mapping and orchestration. Hooks and services own
data, state and business logic. `src/app` owns routing and application
composition. `src/shared` remains a compatibility and cross-feature utility
layer.

## Dependency rule

Code in this directory may depend on React, approved presentation libraries and
other design-system modules. It must not import feature modules, Firebase,
application context, domain services, business vocabulary **or `shared`** —
`shared` imports *from* here, so a dependency in that direction is a cycle.
`tests/architecture.test.js` enforces all of it, in stylesheets as well as
modules: it walks `.css` too and resolves every `@import` and `url()` against
this directory.

Do not move a feature screen here. Do not add a local alternative to an approved
component without recording the gap and the migration decision in the roadmap
(§5).

## There is no compatibility layer left

The old un-namespaced second scale, `src/shared/styles/designTokens.css`, is
deleted; its only live rule, the global `prefers-reduced-motion` reset, lives in
`utilities.css`. This directory imports nothing from outside itself, in
JavaScript **or CSS**.

## Component catalog

`npm run storybook` opens the catalog. Read `Foundations/Control scale` first:
it shows an input and its adjacent button at each of the three steps, and proves
that icon size comes from the design system rather than the call site. Every
page records an explicit **Approved** / **Needs review** / **Temporary** status
and names what is unresolved — read it before reusing something. Import from the
barrels: `@design-system/components`, `/patterns`, `/layouts` and `/icons`.

| Family | Directory | Contract notes |
|---|---|---|
| `Button`, `IconButton` | `components/button` | Heights 36 / 44 / 52 (`sm` / `md` / `lg`), default `md`; `IconButton` alone has `xs` (24px) and `shape="round"`. `variant="link"` stays a `<button>` off the height scale, and `IconButton` refuses it. `tone` (`default` / `neutral` / `info` / `success` / `warning` / `danger` / `accent`): on `primary` it fills and only `success` is allowed; on `secondary` / `ghost` it is the status tint; `danger` and `link` refuse a tone. `pressed` sets `aria-pressed` and `data-pressed` for a toggle that keeps its variant (a bare `aria-pressed` with a variant swap is also fine). `loading`; `aria-disabled="true"` is styled like `disabled` |
| `Link`, `ButtonLink`, `IconButtonLink` | `components/link` | `external` announces the new tab and sets `rel` |
| `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `ChoiceGroup`, `FormField`, `FormSection`, `FieldDisplay`, `FieldMessage`, `Label` | `components/form` | `Input variant="inline"` is borderless and only as wide as it needs, with `size` owning the height; it refuses to render without an `aria-label`, an `aria-labelledby` or an `id` a `<label>` points at, and is always editable — not a read/edit-swap "InlineEdit". `FieldMessage tone="error"` is its own `role="alert"` |
| `Switch` | `components/switch` | For a control that saves immediately |
| `FileInput` | `components/file-input` | A visible control by contract: `variant="dropzone"`, `loading` (owns a polite status region and the focus restore), `labelHidden`. A dropped file reaches the real input, which dispatches `change`; a refused drop is announced (`role="alert"`) and reported through `onReject`, after `onChange` (rules in `dropAcceptance.js`) |
| `TabList`, `TabPanel` | `components/tabs` | `variant="pill"` for a secondary strip inside a panel, `fitted` for a narrow popover; a strip answers only the arrow axis its `aria-orientation` announces |
| `SegmentedControl` | `components/segmented` | `role="group"` + `aria-pressed`, deliberately not a radiogroup; string `label`s only |
| `Disclosure` | `components/disclosure` | Rail and `variant="card"`; the card variant draws no card (`Card` owns the surface). `description` and `leading` throw on the rail, `meta` throws on a card |
| `Chip`, `ChipGroup` | `components/chip` | The interactive twin of `Badge`. `xs` (24px) and `sm` (36px); `href` renders an `<a>`, otherwise a `<button>`, and `href` with `pressed` is refused; `pressed` draws a check as well as setting `aria-pressed`; `ChipGroup` refuses to render unnamed |
| `SelectableCard` | `components/selectable-card` | A card with multi-line content that a person picks: `selected` → `aria-pressed`, `current` → `aria-current`, or neither; both throws. `as="div"` is non-interactive and refuses a state |
| `SectionNavigation` | `components/section-navigation` | A page or step rail: `currentType='page'\|'step'`, `item.status` (`complete` / `incomplete`), optional `group.label`, `frame='card'\|'none'`; Arrow / Home / End roving focus |
| `Notice` | `components/notice` | A tinted message block with its tone's glyph by default (`icon={null}` hides it). `announce` defaults off; `titleAs` keeps a real heading; actions sit under the message; the component owns its focus ring; `className` is margin and width only. `accent` and `neutral` tones exist, but their glyph defaults are recorded guesses. Full record in `components/notice/README.md` |
| `Badge` | `components/badge` | A status chip; it sizes a glyph passed through its `icon` prop only |
| `StatusMedallion` | `components/status-medallion` | A status-tinted circle around a glyph; it holds 24px at `md` and 32px at `lg` |
| `Avatar` | `components/avatar` | A person's or organisation's initial, on five fixed steps (a responsive size is allowed); `circle` for a person, `square` for an organisation; always `aria-hidden`, with no prop to un-hide it |
| `Card`, `MetricCard` | `components/card` | `MetricCard`'s icon chip reads `--ds-metric-icon-size`, not a control height |
| `ProgressBar` | `components/progress` | |
| `DataTable` and `ds-native-table` | `components/data-table` | `DataTable` for display tables, first column pinned by default; `ds-native-table` (`nativeTable.css`, `pinnedColumn.css`) is the contract every approved native table applies. Phones: "Tables on phones" in its README |
| `Modal`, `ConfirmDialog` | `patterns/modal` | Chrome is props only (`patterns/modal/README.md`); `className` / `overlayClassName` throw. `ConfirmDialog` puts initial focus on Cancel, guards against double activation, and disables Escape / backdrop dismissal while `loading`; Escape routes to `onCancel` |
| `PageState`, `EmptyState`, `ErrorState`, `LoadingState` | `patterns/page-state` | `surface="inverse"` (the medallion stays light); `titleId` (a full-page state names its `<main>`, where `role="status"` is invalid); `children` (a reference, a checklist); `focusOnMount`. Anything that needs its own structure is a page, not a state |
| `PageContainer`, `PageHeader`, `Section`, `Stack`, `Inline`, `ResponsiveGrid`; `WorkspaceFrame` | `layouts/page`, `layouts/workspace` | `PageHeader` renders the page-level `<h1>`; inside Super Admin the masthead owns it, so views use an `<h2>` composition |
| `Icon` and glyph tokens | `icons/` | Sizes and naming: roadmap §3 |

Rules that go with the catalog:

- **The list of what is missing lives in one place:** roadmap §5, "Missing
  primitives that live code is waiting on", with the call sites citing each gap
  and why the nearest primitive does not fit. Do not hand-roll a missing
  primitive; record the need there.
- Every family above has its consumers. Do not hand-roll any of them.
- **A hand-composed pattern** — `Card` + `StatusMedallion` + heading + body +
  actions, or a `Modal` with its own Cancel/Confirm footer — is made entirely of
  approved primitives, so it passes every automated rule while being a second
  implementation of something the design system owns. If your arrangement looks
  like `PageState` or `ConfirmDialog`, use the pattern (roadmap §7).
- Catalog stories may not import features, Firebase, application context or
  domain services, and may not use domain vocabulary.
  `tests/architecture.test.js` enforces the import half, and `storybook-build`
  in CI builds the catalog with no credentials.

## Current approved consumers

Every area of the application consumes the design system (roadmap §8). To find
the consumers of a primitive, search for its import, e.g.
`git grep -n "SelectableCard" -- src/features src/shared`. Every consumer
follows one split: the design system supplies appearance and interaction; the
feature keeps its domain-to-tone/icon mapping, tab state, labels, flags,
permissions, payloads, callable contracts, workflows and every frozen
user-facing string. Boundaries worth knowing:

- The driver dossier's tab bodies own DOT-compliance data; their paths, payloads
  and audit-log calls are frozen by the `tabs/DossierBodies.*.test.jsx` suites.
  Its tab rail is `TabList` — vertical on a desktop, horizontal on a phone, with
  the panel in `DriverProfileModal` deriving its ids from the same `idBase`.
- `VOEPreviewModal` uses `Modal`, `Button` and `IconButton` for its **chrome
  only**; the generated 49 CFR §391.23 document inside is deliberately not
  tokenised (roadmap §5). Treat any exported document as immutable content, not
  themeable chrome, and prove export parity before changing it.
- `PaywallMessage` takes a `headingLevel` so it does not collide with its host's
  section heading.
- The campaigns audience preview is an inverse console surface in the
  `--ds-color-surface-inverse` roles — the same ones `SystemHealthView`'s log
  panel uses — and uses `PageState surface="inverse"` for its states.
- Toasts go through the single `ToastProvider`, which still lives in
  `src/shared` (roadmap §5, "Toast promotion").

## Guardrails

Every guard is blocking, and CI runs all of them. Before a UI pull request run
`npm test`, `npm run check:ui-contract`, `npm run check:icon-contract`,
`npm run test:stories` and `npm run test:e2e -- --grep "@a11y"`; when
components, tokens, styles or tables change, also run
`npm run check:visual-contract`, `npm run check:table-layout` and
`npm run test:visual` (each after `npm run build-storybook`).

Roadmap §7 has the full table — what each guard refuses and which CI job runs it
— plus the allowlist's rules (an entry needs a reason and a violation the base
commit already carried; `--update` only shrinks) and the one review step that is
a person. `.github/pull_request_template.md` is the checklist, and it asks you
never to tick a check you did not run.
