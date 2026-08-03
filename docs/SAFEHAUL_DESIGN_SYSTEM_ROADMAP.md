# SafeHaul design-system roadmap

> Permanent migration record for SafeHaul UI/UX standardization
> Baseline reviewed: `main` / `origin/main` at `9c56feb6463fb6e1a2291449ab982e865be9ce13`
> Baseline date: 2026-07-22
> Roadmap created: 2026-07-23

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Completed and verified
- `[!]` Blocked or requires a decision

`[~]` and `[!]` are intentional project conventions. If a renderer treats them
as ordinary unchecked boxes, the text status remains authoritative.

## Non-negotiable architecture

- The design system controls reusable visual appearance and interaction.
- Feature folders control feature content, available actions, and domain-to-UI
  mapping.
- Hooks and services control data, state, integrations, and business logic.
- `src/app` controls application composition, routes, guards, and providers.
- Feature screens stay with their features and consume approved design-system
  components.
- The design system must never know what a driver, recruiter, application,
  lead, campaign, or company is.
- No phase may change Firebase rules, database structures, backend behavior,
  integrations, or business workflows merely to simplify UI code.
- Legacy styles are removed only after all known consumers migrate and the
  replacement is functionally, visually, responsively, and accessibly verified.

## How to use this roadmap

Before UI work, read this file and `src/design-system/README.md`. Update the
relevant item as soon as verified work changes its status. A completed item
must include date, files, verification evidence, and a commit or PR reference
when one exists. Never mark work complete because code exists.

For every implementation item below, **complete means all applicable checks
pass**:

1. implementation is complete;
2. existing behavior is preserved;
3. relevant tests pass;
4. desktop visual behavior is reviewed;
5. mobile behavior is reviewed where applicable;
6. keyboard and accessibility behavior is reviewed;
7. documentation and catalog examples are updated;
8. the final diff contains no unrelated changes.

If a check cannot run, leave the item open or mark it `[!]`, and record why.

---

## 1. Current-state assessment

### 1.1 Repository and frontend structure

SafeHaul is a React 19, Vite 7, Tailwind CSS 3.4 JavaScript application. The
frontend contains 351 JavaScript/CSS source files in `src`, with 14 feature
areas. Route-mounted screens are registered through
`src/app/routes/featureRegistry.jsx`, public/protected route manifests, and the
company route manifest. This is a sound basis for keeping screens in features.

The code graph shows the existing broad layers:

- `features` owns most product screens and feature behavior;
- `shared` is a high-fan-in layer used by features;
- `lib`, `hooks`, `config`, and `context` own substantial data and application
  logic;
- `app` and `App.jsx` own routing and composition.

The graph also shows 12 shared-to-feature calls. The clearest inversions are:

- `src/shared/components/layout/Stepper.jsx` imports all driver-application
  steps and signature behavior;
- `src/shared/components/modals/CompanyChooserModal.jsx` imports the companies
  feature service.

These are migration candidates, not permission to rewrite behavior.

### 1.2 What already exists and can be reused

- `src/shared/styles/designTokens.css` defines color, status, spacing,
  typography, elevation, radius, motion, z-index, focus, reduced-motion,
  high-contrast, and responsive values.
- `src/shared/components/form/InputField.jsx`, `DateTripletField.jsx`,
  `MonthYearField.jsx`, `RadioGroup.jsx`, `AgreementBox.jsx`, and
  `DynamicRow.jsx` provide reusable form foundations.
- `src/shared/components/modals/Modal.jsx` already implements dialog semantics,
  initial focus, focus trapping, Escape handling, backdrop handling, and focus
  restoration.
- `src/shared/components/badges/StatusBadge.jsx` pairs status color with an icon,
  avoiding color-only communication.
- `src/shared/components/table/ModernDriverTable.jsx` centralizes one table's
  header/cell spacing, loading skeleton, empty state, selection, sticky header,
  and pagination.
- Shared loading, error, toast, notification, paywall, and queue feedback
  components exist.
- `src/shared/hooks/useIsMobile.js` centralizes the Tailwind `md` breakpoint.
- Vitest/Testing Library, `vitest-axe`, Playwright, `@axe-core/playwright`, and
  desktop/mobile Playwright projects already exist.
- CI already runs frontend lint, unit/coverage, Chromium E2E, backend tests,
  callable-contract validation, and Firebase rule emulator tests. Type checking
  and browser accessibility are present as non-blocking lanes.
- Lucide is the dominant icon library; branded SafeHaul SVG artwork exists and
  should remain explicit.

These assets should be promoted, adapted, or wrapped rather than duplicated.

### 1.3 Inconsistency and adoption findings

Audit counts are exact `rg` line/tag matches at the baseline, not estimates of
unique user journeys:

| Finding | Baseline |
|---|---:|
| Raw `<button>` occurrences | 398 |
| Raw `<input>` occurrences | 155 |
| Raw `<select>` occurrences | 60 |
| Raw `<textarea>` occurrences | 23 |
| Raw `<table>` occurrences | 18 across 15 files |
| `fixed inset-0` overlay matches | 30 |
| `text-[9px]` matches | 22 |
| `text-[10px]` matches | 129 |
| Raw hexadecimal color matches | 73 across 10 files |
| Responsive/mobile code matches | 206 |

Important interpretation:

- The existing token stylesheet is imported globally, but its variables have
  no consumers outside that stylesheet. Most UI styling uses direct Tailwind
  palette, size, radius, and shadow utilities.
- `tailwind.config.js` previously had an empty `theme.extend`, so the CSS token
  layer and Tailwind layer were disconnected.
- Both `gray` and `slate` palettes are heavily used, creating subtle surface and
  typography drift.
- There is no approved shared Button or Card. Button treatment is repeated
  hundreds of times.
- Shared `InputField` has limited adoption relative to 238 raw
  input/select/textarea occurrences.
- `ModernDriverTable` is used by the company candidate list, while the remaining
  active data tables implement local spacing, density, alignment, empty/loading
  states, and mobile overflow.
- The accessible `Modal` has low direct adoption; most overlay files still
  construct backdrops and panels locally.
- Status styling is split across `StatusBadge.jsx`,
  `shared/utils/statusStyles.js`, and feature-local conditional classes.
- StatusBadge itself contains SafeHaul workflow labels. Its accessible behavior
  is reusable, but the future design-system Badge must accept a generic tone;
  features must map domain status to tone/icon/label.
- Many feature JSX files combine dense Tailwind markup with direct Firebase or
  callable access. The highest-risk examples include DocumentsManager,
  EnvelopeCreator, SigningRoom, PEVTab, UserProfilePage, CampaignDetails,
  FeaturesView, CompaniesView, and UnifiedDriverList.
- Some large components are legitimately feature-specific. Separation should
  happen only when an extraction preserves behavior and reduces coupling.

### 1.4 Tables: priority assessment

The current tables use at least three spacing families (`px-3`, `px-4`, and
`px-6`), multiple header sizes (10px, 11px, 12px, and 14px), mixed
capitalization/weight, and locally specified left/center/right alignment.
Headers and cells usually align within an individual hand-written table, but
there is no single contract preventing future header/cell drift.

`ModernDriverTable` is the best starting point, but it is not yet an approved
general DataTable:

- row click is mouse-only because the `<tr>` is not keyboard actionable;
- selection uses icon buttons instead of native checkboxes and lacks explicit
  accessible labels;
- header and cell class overrides can independently change alignment;
- no column schema owns alignment, width, numeric formatting, responsive
  priority, or truncation;
- no caption/accessible name contract exists;
- mobile behavior is overflow-only and not documented per use case;
- loading and empty states are embedded rather than composed from shared
  feedback patterns.

The migration must introduce one column schema that applies alignment and width
to both `<th>` and `<td>`, plus documented density and responsive modes.

### 1.5 Accessibility assessment

Strengths:

- Modal and InputField have structural accessibility tests.
- Modal focus management substantially follows the WAI-ARIA dialog pattern.
- Reduced-motion and high-contrast media support exist.
- Most form markup has labels; the audit found 204 `<label>` matches.
- Desktop and mobile browser projects are configured.

Risks:

- the browser axe job is non-blocking;
- component axe tests disable color contrast because happy-dom cannot calculate
  layout;
- no `focus-visible` usage was found, while focus-ring utilities are locally
  repeated;
- many icon-only and table-selection buttons need accessible-name review;
- clickable table rows need keyboard-equivalent behavior;
- locally implemented modals may lack focus trap, focus return, accessible
  naming, inert background behavior, or scroll locking;
- 9px and 10px interface text is widespread and risks readability;
- custom colors and muted text require real-browser contrast review;
- native semantics versus interactive ARIA grid behavior are not decided for
  complex tables;
- responsive layouts can visually hide context without an equivalent accessible
  label or relationship.

The target is WCAG 2.2 AA unless the owner explicitly chooses another documented
standard.

### 1.6 Mobile and responsive assessment

- Tailwind breakpoints and `useIsMobile` are present and used.
- Playwright defines Desktop Chrome, Mobile Safari emulation, and Mobile Chrome
  emulation.
- Signing has dedicated mobile/document-first coverage and must be treated as a
  high-risk specialized workflow.
- Many tables rely on horizontal scrolling; some pages use card/grid
  alternatives; no shared rule decides which strategy is appropriate.
- Fixed shells, nested overflow regions, sticky headers, and overlays require
  targeted small-screen review.
- Touch target size is not centralized despite a legacy 72px mobile-row token.

### 1.7 Risks

#### Main UI/UX risks

- visual drift accelerates because every feature can choose raw utilities;
- table density and alignment vary between otherwise similar admin workflows;
- modal, form, status, and feedback behavior is inconsistent by feature;
- tiny text and subtle muted colors reduce readability;
- two competing systems could emerge if new primitives are added without
  compatibility/migration plans.

#### Main accessibility risks

- non-blocking browser accessibility enforcement;
- local modal implementations;
- mouse-only row behavior and unlabeled icon controls;
- incomplete contrast evidence;
- unsupported small text;
- inconsistent focus treatment and mobile reading order.

#### Main maintainability risks

- UI markup and data mutations coexist in large feature components;
- shared-to-feature dependency inversions blur ownership;
- no catalog documents supported component states;
- no visual baseline catches accidental regressions;
- no ratcheting rule prevents new raw controls, tables, arbitrary colors, or
  unsupported font sizes.

### 1.8 What must not be changed by this initiative

- route URLs, authorization, role checks, and feature flags;
- Firebase rules, indexes, data shape, Cloud Functions, or integrations;
- submission, campaign, recruiting, verification, signing, or document
  workflows;
- PDF field geometry, signing coordinates, upload semantics, or offline queues;
- domain status vocabulary without a separate product decision;
- feature ownership of screens and actions;
- branded artwork unless accessibility or consistency requires an approved
  adjustment.

---

## 2. Professional design-system comparison

The target follows practices demonstrated by mature systems without copying
their visual identity:

- [Atlassian Foundations](https://atlassian.design/foundations) treats tokens
  as the source of truth and separates foundations, components, and patterns.
- [Atlassian Components](https://atlassian.design/components) demonstrates
  token-backed primitives and automated styling guardrails.
- [Carbon data-table guidance](https://carbondesignsystem.com/components/data-table/usage/)
  centralizes row sizes, toolbar relationships, alignment, variants, and table
  states.
- [Carbon data-table accessibility](https://carbondesignsystem.com/components/data-table/accessibility/)
  treats keyboard behavior, sortable headers, and in-cell controls as part of
  the component contract.
- [WAI-ARIA dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  defines focus containment, Escape, focus restoration, naming, and inert
  background expectations.
- [WAI-ARIA table/grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
  distinguishes a semantic HTML table from an interactive keyboard-managed
  grid; SafeHaul must choose per use case rather than applying `role="grid"`
  cosmetically.
- [Storybook documentation](https://storybook.js.org/docs/writing-docs) and
  [visual testing guidance](https://storybook.js.org/tutorials/visual-testing-handbook/)
  support a state catalog and screenshot-based review.
- [Tailwind CSS v3 theme guidance](https://v3.tailwindcss.com/docs/adding-custom-styles)
  supports exposing design decisions through `theme.extend` and CSS variables.

SafeHaul is behind mature systems in token adoption, catalog coverage,
component enforcement, and visual regression. It already has stronger-than-zero
accessibility foundations, feature separation, route manifests, test
infrastructure, and several reusable primitives. The safest strategy is a
compatibility-backed, component-family migration with a ratcheting baseline.

---

## 3. Target architecture

```text
src/
├── design-system/
│   ├── tokens/       # Primitive scales, semantic roles, Tailwind bridge
│   ├── components/   # Business-neutral accessible primitives
│   ├── patterns/     # Reusable compositions and UI states
│   ├── layouts/      # Page/region geometry without route or domain knowledge
│   ├── icons/        # Approved icon contract and branded exceptions
│   ├── stories/      # Component catalog and supported-state examples
│   ├── tests/        # Boundary, contrast, a11y, interaction, visual tests
│   ├── README.md
│   └── index.css
├── features/         # Screens, feature components, domain adapters/actions
├── shared/           # Compatibility UI plus cross-feature non-domain utilities
├── hooks/            # Existing cross-feature state/data hooks
├── lib/              # Integrations and infrastructure
└── app/              # Routes, guards, providers, composition
```

### Layer contracts

#### `design-system/tokens`

Owns primitive scales and semantic roles. It may preserve compatibility imports
or aliases temporarily. Feature code should prefer semantic roles such as
content, surface, action, status tone, and table role rather than palette
names.

#### `design-system/components`

Owns Button, IconButton, Field primitives, Card, Badge, Dialog, and table
building blocks. APIs use generic props. A component must ship with documented
states, interaction tests, accessibility tests, and catalog examples before it
is considered approved.

#### `design-system/patterns`

Owns compositions such as PageState, EmptyState, FormField, Dialog sections,
DataTable toolbar/pagination, and responsive presentation patterns. Patterns
accept content and callbacks; they never fetch data or encode feature
permissions.

#### `design-system/layouts`

Owns visual geometry such as AppFrame regions, PageContainer, PageHeader,
Stack, Inline, and split panels. `CompanyAppShell` stays in its feature because
it knows company navigation and deactivation behavior; it may later consume
business-neutral layout primitives.

#### `features`

Own domain language, feature screens, feature-specific composition, available
actions, and adapters such as `applicationStatus -> { tone, icon, label }`.
Feature-specific screens remain here.

#### `shared`

During migration, owns existing compatibility components and cross-feature
utilities. New long-term visual primitives go to `design-system`; existing
shared components move or wrap the new components only after consumer and
behavior review. Non-visual helpers may remain shared.

#### hooks and services

Own data fetching, mutation, subscriptions, integration calls, validation, and
business state. Logic extraction is optional and behavior-preserving, not a
prerequisite for visual migration.

#### `app`

Owns routing, authentication/role guards, providers, error boundaries, and
feature registration. It must not become a component dumping ground.

### Dependency direction

```text
app -> features -> design-system
       features -> hooks/services/lib
       features -> shared (temporary or non-visual)
shared compatibility UI -> design-system (during migration)
design-system -> React/presentation libraries only
```

The reverse directions are prohibited.

---

## 4. Phased migration plan

### Phase 0 — governance, audit, and baseline

- [x] Audit the latest `main` UI architecture and establish the permanent
  roadmap.
  - Complete when: routes, component families, style adoption, tables, mobile,
    accessibility, mixed logic, risks, target layers, and migration inventory
    are documented against an exact commit.
  - Completed: 2026-07-23
  - Files: `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`
  - Verification: `git fetch origin main --prune`; local and remote `main`
    both resolved to `9c56feb6463fb6e1a2291449ab982e865be9ce13`;
    codebase knowledge-graph architecture review; source/tag/style/test/CI
    inventory; official design-system and accessibility research.
  - Visual/mobile/a11y: assessment only; no runtime change.
  - Commit/PR: checkpoint `d993804`.

- [x] Define permanent layer ownership and the no-business-knowledge boundary.
  - Complete when: the target tree, allowed dependencies, feature ownership,
    compatibility policy, and prohibited changes are documented and backed by
    an automated design-system dependency test.
  - Completed: 2026-07-23
  - Files: `src/design-system/README.md`,
    `src/design-system/tests/architecture.test.js`, this roadmap.
  - Verification: architecture test passed (1 test); final full-suite evidence
    is recorded in the completion log.
  - Visual/mobile/a11y: not applicable; no rendered output.
  - Commit/PR: checkpoint `d993804`.

### Phase 1 — design-system foundation and token v2 bridge

- [x] Establish the tracked `src/design-system` folder structure.
  - Complete when: tokens, components, patterns, layouts, icons, stories, and
    tests have documented responsibilities and aliases resolve in Vite and
    editor tooling.
  - Completed: 2026-07-23
  - Files: `src/design-system/**/README.md`, `vite.config.js`, `jsconfig.json`.
  - Verification: build, lint, typecheck, token tests, architecture test, and
    diff review; exact results are in the completion log.
  - Visual/mobile/a11y: not applicable; documentation and resolver-only change.
  - Commit/PR: checkpoint `d993804`.

- [x] Add a namespaced primitive/semantic token contract and Tailwind bridge
  without changing existing screens.
  - Complete when: `--ds-*` foundation and semantic tokens cover surfaces,
    content, actions, borders, states, typography, spacing, radius, elevation,
    motion, layering, and table roles; Tailwind exposes namespaced utilities;
    existing legacy CSS remains in the same cascade position; token tests prove
    supported type size and contrast.
  - Completed: 2026-07-23
  - Files: `src/design-system/tokens/foundation.css`,
    `src/design-system/tokens/semantic.css`,
    `src/design-system/tokens/index.css`, `src/design-system/index.css`,
    `src/index.css`, `tailwind.config.js`,
    `src/design-system/tests/tokens.test.js`.
  - Verification: 13 token tests passed, including 11 WCAG AA contrast pairs;
    production build passed; generated CSS reviewed; no feature uses the new
    tokens yet, so current visual output is intentionally unchanged.
  - Visual/mobile/a11y: no consumer migration; contrast is automated, runtime
    visual/mobile review becomes mandatory with the first consumer.
  - Notes: `src/shared/styles/designTokens.css` remains loaded as a temporary
    compatibility layer. Blue 600, rather than Blue 500, is the new primary
    semantic action color because white text meets normal-text AA contrast.
  - Commit/PR: checkpoint `d993804`.

- [ ] Reconcile legacy token names and values into explicit compatibility
  aliases.
  - Complete when: every legacy variable is mapped, changed values have visual
    approval, high-contrast/reduced-motion utilities have a permanent home, all
    consumers/build/tests pass, and removal criteria are recorded.

- [ ] Inventory and approve the complete semantic token vocabulary.
  - Complete when: design/product owners review brand, surface, text, action,
    status, chart, focus, and data-visualization roles in desktop/mobile/high
    contrast; automated contrast covers every foreground/background pair.

### Phase 2 — typography and content standards

- [ ] Define type roles and migrate unsupported 9px/10px interface text.
  - Complete when: heading/body/label/helper/table roles are documented; no new
    9px/10px body text is permitted; all 151 baseline tiny-text matches are
    resolved or explicitly exempted; desktop/mobile/zoom review and contrast
    pass.

- [!] Decide whether to self-host Inter or retain the external stylesheet.
  - Complete when: privacy, performance, offline behavior, licensing, and
    fallback metrics are reviewed; the chosen delivery passes build and visual
    regression at loading and loaded states.

### Phase 3 — buttons and controls

- [~] In progress — build and approve Button and IconButton.
  - Complete when: variants, sizes, loading, disabled, destructive, link-like,
    icon-only accessible naming, focus-visible, touch target, interaction tests,
    axe tests, stories, and desktop/mobile visuals pass.
  - Progress: business-neutral Button and IconButton primitives now cover the
    required variants, sizes, native disabled/loading behavior, accessible
    icon naming, focus visibility, and touch targets. Unit/axe tests and the
    Company shell desktop/mobile consumer review pass. This item remains open
    until the component catalog and durable visual baselines are approved.
  - Files: `src/design-system/components/button/*`,
    `src/features/company-admin/layout/CompanySidebar.jsx`,
    `src/features/company-admin/layout/CompanyTopbar.jsx`,
    `src/features/company-admin/components/NotificationDropdown.jsx`.

- [ ] Ratchet raw-button creation.
  - Complete when: a documented baseline allowlist prevents the 398 raw-button
    count from increasing; exceptions require a comment/roadmap entry; CI is
    blocking after the baseline is stable.

### Phase 4 — forms

- [~] In progress — Define Field, Label, HelpText, FieldError, Input, Select, Textarea,
  Checkbox, Radio, and file-input contracts.
  - Complete when: accessible names/descriptions/errors, required semantics,
    disabled/read-only states, focus, autofill, validation timing, touch size,
    stories, unit/axe tests, and mobile keyboard behavior pass.
  - Progress: the native-event `FormField`, `Label`, `FieldMessage`, `Input`,
    `Textarea`, `Select`, `FieldDisplay`, and `FormSection` contract is
    implemented and proven by the Company Settings Personal Profile and
    Company Profile information compatibility slices. **Checkbox, Radio and
    `ChoiceGroup` were implemented on 2026-07-27** for the public driver
    application — native-first controls with mandatory per-option labels, real
    `<fieldset>`/`<legend>` group naming, a `requiredMark` split so a group's
    legend carries the marker instead of every option, and the row-scoping
    pattern that repeating rows need (12 unit tests). Switch, file input,
    autofill policy, component-catalog examples, and durable visual baselines
    remain open, so the family is not complete.
  - Known gap recorded 2026-07-27: `.ds-form-control` is 44 px tall while
    `.ds-button[data-size='md']` is 40 px (`--ds-control-height-md`) and `sm` is
    36 px. 40 px clears WCAG 2.2 AA SC 2.5.8 (Target Size Minimum, 24 px) but not
    the 44 px the form controls promise, so a form row mixes two heights. The
    public application works around it by using the approved `size="lg"` for the
    controls a driver taps repeatedly; aligning the primitives is a global visual
    change that needs owner approval.
  - [x] Establish the native-event form foundation required by the first
    compatibility slice.
    - Completed: 2026-07-23.
    - Files: `src/design-system/components/form/**`,
      `src/design-system/components/index.js`,
      `src/design-system/components/README.md`,
      `src/design-system/README.md`.
    - Verification: 5 form primitive tests passed, including native events,
      label/description/error/required relationships, disabled/read-only
      behavior, Select/Textarea parity, labelled read-only display,
      FormSection semantics, and axe.
    - Visual/mobile/a11y: 44 px controls, semantic token styling, focus ring,
      invalid/read-only/disabled states, wrapping, and mobile single-column
      layout were reviewed through the first consumer at 1440×900, 1024×768,
      and 412×915.
    - Notes: these components emit native events and contain no Firebase,
      Company, user, recruiter, validation, or save logic. Existing shared
      callback/file controls remain compatibility adapters.
    - Commit/PR: checkpoint `0d22a0d`.

- [ ] Adapt existing shared form controls without changing data contracts.
  - Complete when: existing `(name, value)` callbacks, file behavior, date
    clamping, validation, and feature tests remain intact; consumers migrate
    incrementally; compatibility wrappers and removal criteria are documented.

### Phase 5 — feedback, status, and page states

- [~] In progress — build business-neutral Badge/StatusIndicator and feature-owned status
  adapters.
  - Complete when: the design system accepts generic tone/icon/label only,
    domain vocabulary remains in features, all visual states meet contrast and
    non-color communication requirements, and status vocabulary tests pass.
  - Progress: the generic Badge accepts tone and feature-provided content only;
    the Company leaderboard owns rank/MVP language. Badge unit/axe tests and
    desktop/mobile consumer review pass. StatusIndicator and remaining
    feature-owned adapters are not yet implemented, so this item remains open.
  - Files: `src/design-system/components/badge/*`,
    `src/features/company-admin/components/InlineLeaderboard.jsx`.

- [~] In progress — standardize LoadingState, EmptyState, ErrorState, InlineAlert,
  Skeleton, and Progress.
  - Complete when: supported sizes/layouts and live-region behavior are
    documented; shared feedback implementations are reused; async transitions
    have unit/axe/visual/mobile coverage; no workflow messaging changes.
  - Progress: **`ProgressBar` was implemented on 2026-07-27** (determinate only)
    for the public driver application's step meter, which previously communicated
    progress with a styled `<div>`'s width and was invisible to assistive
    technology. It owns the track/fill/tone and the `progressbar` semantics,
    requires an accessible name, clamps `value` into `[0, max]`, accepts a
    non-percentage `max` so `aria-valuenow` can read "4 of 9", and disables its
    transition under `prefers-reduced-motion`. 6 unit tests plus real-browser
    assertions in `e2e/public-application.spec.cjs`.
  - Files: `src/design-system/components/progress/*`.
  - Remaining: indeterminate/buffered/circular progress, and the LoadingState,
    EmptyState, ErrorState, InlineAlert and Skeleton members.

### Phase 6 — dialogs and overlays

- [ ] Promote the accessible Modal foundation into an approved Dialog family.
  - Complete when: Dialog, AlertDialog, header/body/footer/close patterns,
    initial focus, trap, Escape, focus restoration, scroll lock, background
    inertness, nested dialog policy, mobile full-screen behavior, tests, and
    stories pass.

- [ ] Migrate local overlay implementations.
  - Complete when: all 30 baseline backdrop matches are migrated or explicitly
    exempted; destructive flows focus the least destructive action where
    appropriate; functional tests prove no save/cancel/delete behavior changed.

### Phase 7 — tables and data presentation

- [x] Specify the DataTable column schema and visual contract.
  - Complete when: one column definition controls header and cell alignment,
    width/min-width, numeric/date formatting, truncation, responsive priority,
    and accessible label; density, toolbar, pagination, selection, loading,
    empty, and error states are documented.
  - Completed: 2026-07-23.
  - Files: `src/design-system/components/data-table/tableColumnContract.js`,
    `src/design-system/components/data-table/tableColumnContract.test.js`,
    `src/design-system/components/data-table/README.md`.
  - Verification: 7 contract tests passed; the candidate pilot verified that
    the same column attributes control header/cell alignment, width, priority,
    truncation, row headers, and accessible labels.
  - Visual/mobile/a11y: the contract's comfortable and compact density,
    selection, page states, pagination, and horizontal-overflow behavior were
    reviewed through the candidate consumer on desktop and Mobile Chrome.
  - Notes: feature renderers retain feature-specific formatting and actions;
    the contract remains business-neutral.
  - Commit/PR: checkpoint `d993804`.

- [~] In progress — build approved semantic Table/DataTable primitives.
  - Complete when: native-table versus interactive-grid behavior is explicit;
    keyboard selection/sorting, captions, header scopes, icon labels, row
    actions, sticky behavior, overflow, stories, unit/axe/Playwright tests, and
    desktop/mobile visual baselines pass.
  - Progress: the native-table DataTable, candidate fixtures, unit tests,
    scoped axe checks, keyboard/selection E2E, and desktop/mobile review are
    complete. This item remains open until the component-catalog decision is
    resolved and approved stories plus durable visual baselines exist.
  - Files: `src/design-system/components/data-table/*`,
    `src/design-system/components/index.js`,
    `src/design-system/components/README.md`.

- [~] In progress — migrate each table in the dedicated inventory below.
  - Complete when: every row is individually verified, header/cell alignment is
    reviewed at representative data lengths, behavior is preserved, and the raw
    table guardrail reaches zero outside approved locations/exemptions.
  - Progress: the Company candidate-list consumer is complete and verified.
    The Company leaderboard is also complete and verified. The legacy
    `ModernDriverTable` still serves Super Admin and remains in the inventory;
    all other table consumers remain unchecked.

### Phase 8 — cards and page structure

- [~] In progress — approve Card, PageContainer, PageHeader, Section, Stack, Inline, and
  responsive grid/layout primitives.
  - Complete when: spacing, surface, elevation, heading order, actions, loading,
    narrow/wide widths, stories, visual tests, and mobile behavior pass.
  - Progress: Card, MetricCard, PageContainer, PageHeader, Section, Stack,
    Inline, and ResponsiveGrid are implemented, documented, unit/axe tested,
    and verified in the Company dashboard at 1440 px, 1024 px, and 412 px.
    Approval stories and durable visual baselines remain unresolved.
  - Files: `src/design-system/components/card/*`,
    `src/design-system/layouts/page/*`.

- [~] In progress — compose feature shells from layout primitives without moving feature
  ownership.
  - Complete when: Company and Super Admin navigation/permissions/flags remain
    in features, scroll/focus behavior is preserved, and route E2E tests pass.
  - Progress: the Company shell now consumes the business-neutral
    WorkspaceFrame while Company navigation, route visibility, permissions,
    feature flags, labels, and persistence remain feature-owned. Company route,
    access-control, keyboard, desktop, laptop, and Mobile Chrome checks pass.
    Super Admin remains unmigrated.
  - Files: `src/design-system/layouts/workspace/*`,
    `src/features/company-admin/layout/*`.

### Phase 9 — responsive and mobile behavior

- [~] In progress — document responsive strategies by pattern.
  - Complete when: breakpoints, container widths, touch targets, dialogs,
    navigation, forms, cards, tables (scroll/card/column-priority), and
    document/signing exceptions are defined and reviewed on Mobile Chrome,
    Mobile Safari emulation, and desktop.
  - Progress: the workspace off-canvas navigation, responsive metric grid, and
    native-table horizontal-overflow strategy are documented and verified in
    Chromium/Mobile Chrome. Forms, dialogs, documents/signing, Mobile Safari
    emulation, and the remaining feature strategies are still open.

- [ ] Add representative mobile visual and interaction coverage.
  - Complete when: public application, company dashboard/candidate list,
    settings forms, dialogs, super-admin data, and signing have stable mobile
    assertions and screenshot baselines with an owner-approved review workflow.

### Phase 10 — accessibility

- [!] Confirm WCAG 2.2 AA as the permanent product target.
  - Complete when: owner approval is recorded, exceptions have accountable
    remediation plans, and the standard appears in the UI standard and PR
    checklist.

- [ ] Make browser accessibility tests blocking.
  - Complete when: serious/critical baseline violations are resolved, the axe
    lane is stable in CI, false positives are documented narrowly, and
    `continue-on-error` is removed.

- [ ] Establish keyboard, zoom/reflow, contrast, reduced-motion, and
  high-contrast manual test matrices.
  - Complete when: each approved component and migrated screen records results
    against the matrix and automated checks cover enforceable portions.

### Phase 11 — component catalog and visual regression

- [x] Select the component catalog tool and stand up its foundation.
  - Complete when: dependency/security/maintenance cost, Firebase
    compatibility, hosting, CI time, and private data mocking are decided and
    the tool actually builds in CI.
  - Completed: 2026-07-29. **Storybook 10.5.5** with `@storybook/react-vite`,
    `@storybook/addon-docs` and `@storybook/addon-a11y`.
  - Decision record:
    - *Tool*: Storybook, on the React/Vite framework, because it is the only
      option that already supports the repo's React 19 + Vite 7 + Tailwind 3 +
      ESM setup without a second build pipeline. It reuses `vite.config.js`
      (hence the app's aliases) and the root `postcss.config.js` and
      `tailwind.config.js`, so a component cannot render differently in the
      catalog than in the product.
    - *Firebase compatibility*: not applicable by construction. The catalog
      loads design-system and business-neutral pattern stories only, so nothing
      it imports reaches Firebase, Storage, Cloud Functions, application
      context or domain services.
    - *Private data*: every value comes from
      `src/design-system/stories/fixtures.js`, which is entirely hand-written
      literals — no `Math.random`, no `Date.now()`, no generated data, no
      network. Stories render identically on every run.
    - *Secrets*: the CI job blanks the workflow-level `VITE_*` secrets rather
      than inheriting them, so the build provably needs none.
    - *CI time*: ~2 minutes (`npm ci` + story tests + `storybook build`), added
      as its own job so it does not lengthen `frontend-quality`.
    - *Cost*: 1345 packages added to `devDependencies` only; nothing ships to
      the application bundle.
  - Files: `.storybook/main.js`, `.storybook/preview.jsx`,
    `.storybook/preview.css`, `.storybook/catalog.css`, `package.json`
    (`storybook`, `build-storybook`, `test:stories`), `.github/workflows/main.yml`
    (`storybook-build`, required by both deploy jobs), `.gitignore`.
  - Verification: production `storybook build` green; `npm run test:stories`
    renders all 151 stories and runs axe over each.
  - **Not decided, still open below**: baseline-review service ownership.
    Chromatic was explicitly excluded from this campaign.

- [ ] Catalog every approved component and pattern.
  - Complete when: default, variant, state, error, long-content, empty,
    loading, reduced-motion, and narrow viewport examples exist with usage and
    anti-pattern documentation.
  - **In progress (2026-07-29).** 151 stories across 16 documented subjects now
    exist, each with intended use, supported variants, accessibility
    expectations, common mistakes, the feature-composition boundary, and an
    explicit Approved / Needs review status.
    - Components: Button, IconButton, Input, Select, Textarea,
      Checkbox/Radio/ChoiceGroup, Badge, Card/MetricCard, DataTable, page layout
      (`PageContainer`/`PageHeader`/`Section`/`Stack`/`Inline`/`ResponsiveGrid`),
      ProgressBar, StatusMedallion, SectionNavigation, form structure
      (`FormSection`/`FormField`/`Label`/`FieldMessage`/`FieldDisplay`), Modal,
      ConfirmDialog.
    - Patterns: back navigation + page header, section navigation + content,
      filter panel, compact `DataTable` with a correctly sized action column,
      page states (loading/empty/error), modal form.
  - **Remains open because**: `WorkspaceFrame` has no story; reduced-motion is
    documented but has no dedicated story; and the Approved/Needs-review status
    recorded on each page is this campaign's honest reading, not an
    owner-approved sign-off.

- [ ] Add blocking visual screenshot regression.
  - Complete when: deterministic fonts/data/animations are configured, desktop
    and mobile baselines are approved, intentional-update workflow is
    documented, and CI uploads useful diffs.
  - **Partial groundwork (2026-07-29), still open.** Determinism prerequisites
    are now met: fixtures are static literals, the catalog does not load the
    externally hosted Inter webfont (it uses the local fallback stack, so a
    build cannot depend on whether a network font arrived), the only animation
    is the `DataTable` skeleton pulse which is disabled under
    `prefers-reduced-motion`, and CI uploads `storybook-static` as an artifact.
    No baselines exist, nothing is blocking, and Chromatic was excluded from
    this campaign by scope.

### Phase 12 — permanent automated guardrails

- [x] Add a business-neutral design-system dependency test.
  - Complete when: CI-visible tests reject imports from features, application
    context, or Firebase into `src/design-system`.
  - Completed: 2026-07-23
  - Files: `src/design-system/tests/architecture.test.js`.
  - Verification: focused test passed; full frontend suite result is recorded
    in the completion log.
  - Visual/mobile/a11y: not applicable.
  - Commit/PR: checkpoint `d993804`.

- [ ] Add ratcheting rules for arbitrary colors and unsupported type sizes.
  - Complete when: the baseline cannot increase; design-system internals and
    branded/visualization exceptions are explicit; all new violations fail CI.

- [ ] Add ratcheting rules for raw tables, duplicate buttons, local modals, and
  local form controls.
  - Complete when: approved locations are machine-readable, baseline counts
    decrease with migrations, and CI rejects new unapproved implementations.

- [ ] Add a design-system PR checklist.
  - Complete when: behavior, desktop/mobile visual, keyboard, a11y, tests,
    roadmap, catalog, diff, and migration/compatibility evidence are required
    for UI PRs.

- [x] Add permanent AI-agent instructions.
  - Complete when: `AGENTS.md` and `CLAUDE.md` require roadmap/UI-standard
    reading, approved reuse, documented exceptions, roadmap evidence, relevant
    tests, and honest status.
  - Completed: 2026-07-23
  - Files: `AGENTS.md`, `CLAUDE.md`.
  - Verification: instruction diff reviewed; no runtime behavior.
  - Visual/mobile/a11y: not applicable.
  - Commit/PR: checkpoint `d993804`.

### Phase 13 — feature-by-feature migration order

- [x] Pilot: migrate the Company candidate list from `ModernDriverTable` to the
  approved DataTable.
  - Complete when: DataTable primitives prove alignment, selection, pagination,
    loading/empty/error, keyboard, desktop, and mobile contracts without
    changing filters, bulk actions, row actions, data, or dossier behavior.
  - Completed: 2026-07-23.
  - Files: `src/features/company-admin/views/CompanyCandidatesListPage.jsx`,
    `src/features/companies/components/DashboardToolbar.jsx`,
    `src/design-system/components/data-table/*`,
    `src/design-system/components/index.js`,
    `src/design-system/components/README.md`,
    `src/design-system/tokens/semantic.css`, `tailwind.config.js`,
    `src/features/company-admin/components/modals/driver-dossier/DriverProfileModal.jsx`,
    `src/shared/components/modals/CallOutcomeModalUI.jsx`,
    `e2e/company-candidate-table.spec.cjs`.
  - Verification: 15 focused DataTable tests passed; the full frontend suite
    and coverage gate passed; build, lint, and typecheck passed; 8 candidate
    desktop/mobile Playwright checks passed with 2 intentional
    viewport-specific skips; 8 existing candidate filter tests passed.
  - Visual/mobile/a11y: desktop alignment was measured at under 1 px
    header/cell center variance; Mobile Chrome verified labeled horizontal
    overflow, visible touch actions, and dossier access; scoped axe found no
    serious or critical violations.
  - Notes: filters, sorting, loading, pagination, calls, bulk assignment,
    permissions, selection scope, and dossier workflows remain feature-owned.
    `ModernDriverTable` was not deleted or globally rewritten because Super
    Admin still consumes it. The mobile review exposed the existing Company
    shell/sidebar width defect; the Company workspace shell/dashboard phase
    resolved and verified it on 2026-07-23.
  - Commit/PR: checkpoint `d993804`.

- [x] Company workspace shell and dashboard.
  - Complete when: layout/card/button/status primitives are adopted and route,
    permissions, onboarding, stats, upload, leaderboard, and mobile tests pass.
  - Completed: 2026-07-23.
  - Files: `src/design-system/components/button/*`,
    `src/design-system/components/card/*`,
    `src/design-system/components/badge/*`,
    `src/design-system/layouts/workspace/*`,
    `src/design-system/layouts/page/*`,
    `src/design-system/layouts/index.js`,
    `src/design-system/components/data-table/*`,
    `src/design-system/components/index.js`,
    `src/design-system/components/README.md`,
    `src/design-system/README.md`,
    `src/design-system/tokens/semantic.css`,
    `src/features/companies/components/StatCard.jsx`,
    `src/features/company-admin/layout/CompanyAppShell.jsx`,
    `src/features/company-admin/layout/CompanySidebar.jsx`,
    `src/features/company-admin/layout/CompanySidebar.test.jsx`,
    `src/features/company-admin/layout/CompanyTopbar.jsx`,
    `src/features/company-admin/components/CompanyAdminDashboard.jsx`,
    `src/features/company-admin/components/InlineLeaderboard.jsx`,
    `src/features/company-admin/components/InlineLeaderboard.test.jsx`,
    `src/features/company-admin/components/NotificationDropdown.jsx`,
    `src/tests/dashboard.test.jsx`,
    `e2e/company-shell-dashboard.spec.cjs`, `tailwind.config.js`.
  - Verification: 10 focused files / 36 tests passed; final full coverage
    gate passed with 80 files / 518 tests and 2 files / 48
    emulator-dependent rules tests skipped by their existing environment guard;
    frontend/backend lint passed with 0 errors and 169 existing frontend
    warnings; typecheck and production build passed; the shell/dashboard
    Playwright spec passed 5 checks with 3 intentional viewport-specific skips
    across Chromium and Mobile Chrome; combined route, authorization,
    candidate-table, and filtering regression run passed 23 checks with 5
    intentional viewport-specific skips.
  - Visual/mobile/a11y: manually reviewed at 1440×900, 1024×768, and 412×915;
    the page has no document-level horizontal overflow, metrics reflow, the
    leaderboard contains its horizontal overflow with aligned numeric columns,
    and the 412 px shell keeps full-width content. Mobile navigation is
    off-canvas with a touch close action, inert/hidden closed state, focus trap,
    Escape/route close, and focus return. Scoped real-browser axe found no
    serious or critical violations.
  - Notes: Company route labels, feature flags, permissions, local persistence,
    dashboard hooks, onboarding, stats, uploads, navigation actions, and the
    Firestore leaderboard query remain feature-owned. No backend, Firebase
    rules, database, integration, or workflow behavior changed. Component
    families remain in progress until catalog/visual-baseline approval.
  - Commit/PR: checkpoint `d993804`.

- [~] In progress — Company settings and profile.
  - Complete when: form/table/dialog primitives are adopted and all save,
    integration, phone assignment, question, role, and validation behavior
    remains covered.
  - [x] Audit the active settings/profile controls and select the first
    compatibility slice.
    - Completed: 2026-07-23.
    - Files: `src/features/settings/components/**`,
      `src/features/settings/hooks/useLineAssignments.js`,
      `src/features/company-admin/views/UserProfilePage.jsx`, this roadmap.
    - Verification: codebase graph architecture/dependency review; exact
      inventory of inputs, selects, textareas, checkboxes, button-based
      switches, uploads, labels, direct Firebase/Auth/Storage/callable access,
      tiny text, and existing tests.
    - Visual/mobile/a11y: source audit identified missing label associations,
      locally repeated focus/disabled/read-only states, button-based switches
      without switch semantics, 10 px settings navigation labels, and the
      keyboard-inaccessible avatar upload surface. Runtime review is required
      per migrated slice.
    - Notes: Personal Profile inside Company Settings is the first low-risk
      compatibility slice. The separate `/company/profile` account-security
      screen remains higher risk because it combines avatar upload,
      Authentication reauthentication/email/password changes, uniqueness
      lookup, and Firestore writes.
    - Commit/PR: checkpoint `0d22a0d`.
  - [x] Migrate the Company Settings Personal Profile tab as the first
    compatibility slice.
    - Complete when: name load/edit/save, read-only email, recruiting-link
      generation/copy, loading/success/error behavior, field relationships,
      keyboard order, desktop/mobile layout, axe, existing data contracts, and
      final diff are verified without changing Firebase behavior.
    - Completed: 2026-07-23.
    - Files: `src/features/settings/components/PersonalProfileTab.jsx`,
      `src/features/settings/components/PersonalProfileTab.test.jsx`,
      `src/features/settings/components/CompanySettings.jsx`,
      `src/design-system/components/form/**`,
      `src/design-system/components/index.js`,
      `src/design-system/components/README.md`,
      `src/design-system/README.md`,
      `e2e/company-settings-profile.spec.cjs`, this roadmap.
    - Verification: 2 focused files / 9 tests passed; full frontend coverage
      passed with 82 files / 527 tests and the existing 2 files / 48
      emulator-dependent rules tests skipped; lint passed with 0 errors and
      169 existing frontend warnings; backend lint, typecheck, production
      build, and `git diff --check` passed. Chromium and Mobile Chrome
      regression passed 5 checks with 3 intentional viewport-specific skips.
    - Visual/mobile/a11y: manually reviewed at 1440×900, 1024×768, and 412×915.
      Labels and fields align, controls are 44 px high, read-only email is
      distinct and described, focus is visible, text wraps, mobile is
      single-column, and document/workspace horizontal overflow is absent.
      Unit axe reported no violations; scoped real-browser axe reported no
      serious or critical violations in the migrated content.
    - Notes: the original user-document read, generated recruiting-code
      payloads, recruiter-link mapping, name-only `{ name }` write, clipboard
      URL, success/error messages, routes, and admin gate are unchanged. The
      only shell-adjacent change is `min-w-0` on the existing settings content
      flex item to remove verified 1024 px nested overflow. No backend,
      Firebase rules, storage, database, permissions, or data-format changes.
      The legacy 10 px settings navigation headings identified by this slice
      were subsequently migrated in the bounded shell checkpoint `334b5c6`.
    - Commit/PR: checkpoint `0d22a0d`.
  - [x] Migrate the Company Settings shell and grouped navigation presentation.
    - Complete when: group headings use supported typography and semantic
      tokens; navigation/current-item semantics, keyboard focus movement,
      visible focus, tab switching, feature-flag visibility, admin redirect,
      desktop/tablet/mobile layouts, overflow, axe, and final diff are verified
      without changing settings state or behavior.
    - Completed: 2026-07-23.
    - Files: `src/design-system/components/section-navigation/**`,
      `src/design-system/components/index.js`,
      `src/design-system/components/README.md`,
      `src/design-system/README.md`,
      `src/features/settings/components/CompanySettings.jsx`,
      `src/features/settings/components/CompanySettings.test.jsx`,
      `src/features/settings/components/CompanyProfileTab.jsx`,
      `e2e/company-settings-navigation.spec.cjs`,
      `e2e/company-settings-profile.spec.cjs`, this roadmap.
    - Verification: 2 shell-focused unit files / 9 tests passed; final
      design-system gate passed with 11 files / 46 tests; final full frontend
      gate passed with 84 files / 536 tests and the existing 2 files / 48
      emulator-dependent rules tests skipped; frontend lint passed with 0
      errors and 169 existing warnings; typecheck, production build, and
      `git diff --check` passed. Combined settings Chromium/Mobile Chrome
      regression passed 10 checks with 6 intentional viewport-specific skips;
      the shell/navigation spec contributed 5 passes and 3 skips.
    - Visual/mobile/a11y: manually reviewed at 1440×900, 1024×768, and
      412×915. Desktop retains the side navigation; tablet uses a four-group
      grid above content; mobile uses a two-column grid. Group headings are
      12 px, targets are at least 44 px, long labels wrap, the current section
      is visually and semantically identified, focus remains visible and is
      retained through selection, and document/workspace/nested horizontal
      overflow is absent. Unit axe reported no violations; scoped real-browser
      axe reported no serious or critical violations.
    - Notes: `SectionNavigation` is business-neutral and owns only generic
      grouped navigation appearance, current-item semantics, responsive
      presentation, disabled state, and Arrow/Home/End focus movement.
      Company Settings still owns labels, feature-flag visibility, the existing
      `activeTab` state, tab content, admin gate, Manage Team behavior, and
      success feedback. The Company Profile tab strip now stacks on mobile only
      to remove its verified nested scroller; its tab identifiers and content
      switching are unchanged. No routes, data loading, uploads, saves,
      permissions, Firebase code, backend code, rules, or data formats changed.
    - Commit/PR: checkpoint `334b5c6`.
  - [x] Migrate Company Profile information as a bounded form compatibility
    slice.
    - Complete when: all nine existing values load and remain editable; the
      exact nested save payload, cancel behavior, permission gate, and
      success/error behavior are preserved; labels, keyboard order, focus,
      control sizing, desktop/mobile layout, overflow, axe, and final diff are
      verified without changing branding upload or application questions.
    - Completed: 2026-07-23.
    - Files: `src/design-system/components/form/**`,
      `src/design-system/components/index.js`,
      `src/features/settings/components/CompanyProfileTab.jsx`,
      `src/features/settings/components/CompanyProfileTab.test.jsx`,
      `src/features/settings/components/profile/CompanyInfoSection.jsx`,
      `e2e/company-settings-company-info.spec.cjs`, this roadmap.
    - Verification: 3 focused files / 17 tests passed; design-system gate
      passed with 11 files / 47 tests; full frontend gate passed with 85 files /
      544 tests and the existing 2 files / 48 emulator-dependent rules tests
      skipped; frontend lint passed with 0 errors and 169 existing warnings;
      typecheck, production build, and `git diff --check` passed. Combined
      settings Chromium/Mobile Chrome regression passed 15 checks with 9
      intentional viewport-specific skips; the Company information spec
      contributed 5 passes and 3 skips.
    - Visual/mobile/a11y: manually reviewed display and edit states at
      1440×900, 1024×768, and 412×915. All nine labels align with 44 px
      controls, the address becomes one column on mobile, long values wrap,
      actions remain at least 44 px, focus is visible and returns to Edit
      Profile after cancel/save, and document/content/nested horizontal
      overflow is absent. Unit axe reported no violations; scoped real-browser
      axe reported no serious or critical violations.
    - Notes: added the business-neutral `FieldDisplay` primitive and reused
      `Card`, `FormSection`, `FormField`, `Input`, and `Button`. Existing field
      keys, local state, defaults, admin edit gate, `saveCompanySettings`
      target, nested contact/address/legal/application payload, cancel
      behavior, and success/error messages are unchanged. Branding upload and
      application questions remain untouched. No backend, Firebase rules,
      storage, database, permissions, route, or data-format change was made.
    - Commit/PR: checkpoint `a0cefc3`.
  - [x] Migrate the Company Settings Billing informational card.
    - Complete when: the plan calculation, plan names, and support message are
      preserved exactly; heading, labelled plan value, plan-status treatment,
      and guidance move to approved card/typography/layout treatment; plan
      variants, missing-plan fallback, semantics, axe, and desktop/tablet/mobile
      layout are verified without adding upgrade/cancel/external actions or any
      Firebase behavior.
    - Completed: 2026-07-23.
    - Files: `src/features/settings/components/BillingTab.jsx`,
      `src/features/settings/components/BillingTab.test.jsx`,
      `src/features/settings/components/CompanySettings.jsx`,
      `e2e/company-settings-billing.spec.cjs`, this roadmap.
    - Verification: 7 focused BillingTab tests passed; the CompanySettings
      shell test (5) and design-system gate (11 files / 47 tests) still pass;
      full frontend gate passed with 85 files / 550 tests plus the existing 2
      files / 48 emulator-dependent rules tests skipped by their environment
      guard (the pre-existing `playwrightConfig` resource-contention flake timed
      out under load and then passed 4/4 in isolation); frontend lint passed
      with 0 errors on the changed files; typecheck, production build, and
      `git diff --check` passed. Combined Billing Chromium/Mobile Chrome
      regression passed 5 checks with 3 intentional viewport-specific skips.
    - Visual/mobile/a11y: manually reviewed at 1440×900, 1024×768, and 412×915.
      The heading is a 16 px `<h2>`, the plan label is 13 px, the plan badge and
      support message are 12 px, and no 9/10 px text was introduced. The plan is
      a labelled `FieldDisplay` whose value is a tone-carrying `Badge`
      (success for Pro, neutral for Free) so status is not communicated by
      color alone. No document, content, or nested horizontal overflow exists at
      any reviewed width. Unit axe reported no violations; scoped Chromium/Mobile
      Chrome axe reported no serious or critical violations.
    - Notes: the informational card added no interactive controls — the existing
      copy still directs users to contact support and there is no upgrade,
      cancel, or external billing action. The plan mapping
      (`planType === 'paid' ? 'Pro Plan' : 'Free Plan'`) and support copy are
      unchanged and remain feature-owned; the design system stays business
      neutral. The billing card was extracted into a feature-owned `BillingTab`
      to match the sibling tabs and enable focused tests; the previously inline
      local `SectionHeader` (used only by billing) was removed. No backend,
      Firebase rules, storage, database, permissions, route, or data-format
      change was made.
    - Commit/PR: checkpoint `a98954d`.
  - [x] Migrate the Company Settings Automated SMS templates form.
    - Complete when: the three-template Firestore read/write contract is frozen
      and preserved exactly; the three textareas, their labels, guidance, and the
      save action move to approved form/section/button primitives with
      programmatic label association, an announced loading state, an accessible
      saving state, and correct error/help semantics; template round-trip, empty
      fallbacks, save contract, save states, all three messages, missing-company
      behavior, keyboard order, axe, and desktop/tablet/mobile layout are verified.
    - Completed: 2026-07-23.
    - Files: `src/features/settings/components/AutomatedSmsTab.jsx`,
      `src/features/settings/components/AutomatedSmsTab.test.jsx`,
      `e2e/company-settings-automated-sms.spec.cjs`, this roadmap.
    - Firestore behavior preserved (frozen before migration): read
      `getDoc(doc(db, 'companies', companyId, 'settings', 'automated_sms'))`
      with an `snap.exists()` guard, `templateContactAttempt1/2/3` each falling
      back to `''`, and the `cancelled` unmount guard; write
      `setDoc(<same path>, { templateContactAttempt1, templateContactAttempt2,
      templateContactAttempt3, updatedAt: serverTimestamp() }, { merge: true })`.
      The load-error (`Could not load automated SMS templates.`), save-success
      (`Automated SMS templates saved.`), and save-error
      (`Failed to save templates.`) messages, the `{driver name}`/`{user name}`
      placeholders, the SMS-integration/duplicate-send guidance, the `saving`
      disable, the toast behavior, the `automated_sms` tab id, the admin gate,
      and routes are unchanged.
    - Verification: 12 focused AutomatedSmsTab tests passed (path, all-three-load,
      missing-doc and missing-field empty fallbacks, unique associated ids,
      independent editing, exact save path/payload/`serverTimestamp`/`{merge:true}`,
      save-disabled-while-saving with `aria-busy`, save-success, save-error,
      load-error, missing-`companyId` no-read/no-write, unmount guard, and axe);
      the CompanySettings shell test (5) and design-system gate (11 files /
      47 tests) still pass; full frontend gate passed with 87 files / 563 tests
      and the existing 2 files / 48 emulator-dependent rules tests skipped by
      their environment guard (no flaky failure this run); coverage gate
      completed; frontend lint passed with 0 errors on the changed files;
      typecheck, production build, and `git diff --check` passed. Chromium and
      Mobile Chrome Playwright passed 7 checks with 3 intentional
      viewport-specific skips, including loaded-form axe on both projects.
    - Visual/mobile/a11y: manually reviewed the loaded form at 1440×900,
      1024×768, and 412×915. Each of the three textareas is programmatically
      associated with its label (`.labels.length === 1`), is 112 px tall with
      14 px body text, and wraps long content; the heading is 16 px, the
      description and inline `{variable}` code and labels are 13 px, and the
      guidance help text is 12 px, so no 9/10 px text was introduced. The save
      button is the approved 44 px `Button`, communicates saving via `aria-busy`
      and disablement, and keyboard order runs template 1 → 2 → 3 → save. No
      document, content, or nested horizontal overflow exists at any width. The
      loading state is an announced `role="status"`. Unit axe reported no
      violations; scoped Chromium/Mobile Chrome axe reported no serious or
      critical violations.
    - Notes: template names, template state, Firestore reads/writes, placeholder
      meaning, SMS guidance, and all messages remain feature-owned; the design
      system gained no Firebase, SMS, template, or Company knowledge. The three
      fields were kept as three independent textareas (not merged or turned into
      a dynamic list). Documented behavior concern: when `companyId` is absent
      the existing guard performs no read and leaves the tab in its loading
      state; this pre-existing behavior was preserved unchanged, not altered by
      this visual slice. No backend, Firebase rules, storage, database,
      permissions, route, or data-format change was made.
    - Commit/PR: checkpoint `00fd311`.
  - [x] Migrate the Company Settings Email Settings form.
    - Complete when: the three callable contracts and every secret-handling rule
      are frozen and preserved exactly; the status banner, SMTP fields, password
      field, distinct Test/Save actions, signature, and setup-guide disclosure
      move to approved primitives with associated labels, a connected password
      helper, announced states, and status/alert semantics; metadata load, secret
      isolation, existing-password behavior, first-time requirement, test-vs-save
      payloads, all messages, and desktop/tablet/mobile layout are verified with
      no backend or Cloud Function change.
    - Completed: 2026-07-23.
    - Files: `src/features/settings/components/EmailSettingsTab.jsx`,
      `src/features/settings/components/EmailSettingsTab.test.jsx`,
      `e2e/company-settings-email.spec.cjs`, this roadmap.
    - Secret-handling contract preserved (frozen before migration): the saved
      SMTP password is never loaded into state (`emailSettings` has no
      `smtpPass`); `smtpPassInput` starts empty and is never hydrated;
      `getEmailSettingsMeta` returns only sanitized fields plus a `hasPassword`
      flag; an empty password field never overwrites the stored secret; the
      manual-save payload includes `smtpPass` only when the user types a new
      value; the password is required for first-time setup and optional once
      saved; Test Connection requires a freshly entered plaintext password; and
      the saved-password placeholder/helpers never imply the secret can be
      retrieved. No real secret appears in code, tests, or evidence — tests use
      the obviously-artificial value `NOT_A_REAL_PASSWORD_test_value`.
    - Callable contracts preserved: `getEmailSettingsMeta({ companyId })` →
      `{ smtpHost, smtpPort, smtpUser, signature, isVerified, hasPassword }`
      (never `smtpPass`); `testEmailConnection({ smtpHost, smtpPort, smtpUser,
      smtpPass })`; on test success an auto-save via `saveEmailSettings({
      companyId, smtpHost, smtpPort, smtpUser, smtpPass, signature })`; and the
      manual `saveEmailSettings` payload `{ companyId, smtpHost, smtpPort,
      smtpUser, signature }` plus `smtpPass` only when newly entered. Test and
      Save remain separate actions. Verified-state invalidation on host/port/
      user/password edits (and not on signature edits), the port `parseInt`
      conversion, the graceful metadata-load failure (`console.warn`, no toast),
      and the missing-`companyId` early return (settings load ends, form renders)
      are unchanged. Load/test/save success and error messages are unchanged.
    - Verification: 24 focused EmailSettingsTab render tests passed (metadata
      load incl. exact callable + `{ companyId }` request, sanitized hydration,
      empty password input, hasPassword true/false, load failure, missing
      company id; manual save incl. host/username/first-time-password gating,
      existing-password save without `smtpPass`, rotation save with `smtpPass`,
      exact payload, success/error, aria-busy disabled state; test connection
      incl. disabled-until-password, exact test payload, success auto-save
      payload with the new password, failure response, thrown exception,
      auto-save failure, verified + saved-password indicator updates;
      presentation incl. distinct action names, guide disclosure + safe external
      links, password-helper association, axe). The 12 existing email logic
      tests, the CompanySettings shell test (5), and the design-system gate
      (11 files / 47 tests) still pass. Full frontend gate passed with 88 files /
      587 tests and the existing 2 files / 48 emulator-dependent rules tests
      skipped by their environment guard; coverage gate completed; frontend lint
      passed with 0 errors on the changed files; typecheck, production build, and
      `git diff --check` passed. Chromium and Mobile Chrome Playwright passed 7
      checks with 3 intentional viewport-specific skips, including loaded-form
      axe on both projects and an accessible-loading-status assertion.
    - Visual/mobile/a11y: reviewed the loaded form at 1440×900, 1024×768, and
      412×915. Five labelled controls are 44 px tall; the tab heading is 20 px,
      section headings 16 px, labels/banner 13 px, and help/badge text 12 px, so
      no 9/10 px text was introduced. Every SMTP field has an associated label,
      the password helper is connected via `aria-describedby`, Test and Save have
      distinct accessible names with `aria-busy` progress, the connection status
      and test result use Badge tone plus text (not color alone) with
      `role="status"`/`role="alert"`, the setup-guide toggle exposes
      `aria-expanded`/`aria-controls`, external guide links keep
      `rel="noopener noreferrer"`, keyboard order runs host → port → user →
      password, and no document, content, or nested horizontal overflow exists.
      Unit axe reported no violations; scoped Chromium/Mobile Chrome axe reported
      no serious or critical violations.
    - Notes: the three handlers (`loadSettings`, `handleTestConnection`,
      `handleSaveEmailSettings`) are byte-for-byte unchanged; only presentation
      changed (the `disabled` conditions moved `testing`/`loading` into the
      Button `loading` prop, which is behavior-equivalent). Provider SMTP
      instructions remain feature-owned; the design system gained no SMTP,
      email-provider, secret, Firebase, or Company knowledge. Minor presentation
      changes: the Test button adopts the approved secondary variant (was
      purple) and both action buttons keep a stable label with a spinner instead
      of swapping to "Testing Connection…" micro-copy. The literal `**E-Docs**`/
      `**PEV**` banner text was preserved as-is (a pre-existing content quirk not
      corrected here). No backend, Cloud Function, Firebase rules, storage,
      database, permissions, route, or data-format change was made.
    - Commit/PR: checkpoint `9c05f9e`.
  - [x] Migrate the `/company/profile` account profile & security screen
    (`UserProfilePage`).
    - Complete when: the initial data preference/fallback, avatar type/size
      validation and exact Storage upload sequence, profile validation and
      username query (including the permission-denied skip), the email
      reauthentication/update sequence with all mapped errors and cancel/reset,
      and the password validation/reauthentication/update/reset are preserved;
      the avatar upload becomes keyboard-accessible with no nested interactive
      elements; passwords are never exposed; correct autocomplete is applied;
      labels, focus, control sizing, desktop/tablet/mobile layout, overflow,
      axe, and final diff are verified without any backend or rules change.
    - Completed: 2026-07-24.
    - Files: `src/features/company-admin/views/UserProfilePage.jsx`,
      `src/features/company-admin/views/UserProfilePage.test.jsx`,
      `src/features/company-admin/components/profile/ProfileAvatarField.jsx`,
      `src/features/company-admin/components/profile/ProfileAvatarField.test.jsx`,
      `e2e/company-profile-security.spec.cjs`, this roadmap.
    - Verification: 2 focused files / 38 tests passed; full frontend coverage
      gate passed with 98 files / 730 tests and the existing 2 files / 48
      emulator-dependent rules tests skipped; frontend lint passed with 0 errors
      and 166 existing warnings; typecheck, production build, and
      `git diff --check` passed. `company-profile-security.spec.cjs` passed 9
      Chromium/Mobile Chrome checks with 3 intentional viewport-specific skips.
      Backend/callable/rules checks were not run and are not applicable: this
      diff changes no Cloud Function, callable, or rule (`functions/node_modules`
      is not installed here, so backend lint was not run — recorded honestly).
    - Visual/mobile/a11y: manually reviewed at 1440×900, 1024×768, and 412×915
      plus the desktop email-edit state. No document-level horizontal overflow at
      any width; single-column mobile; 44 px controls; visible focus; labelled
      fields; a single keyboard-accessible avatar trigger with a visually hidden
      labelled input and a `role="status"` upload announcement. Unit axe reported
      no violations; scoped real-browser axe reported no serious or critical
      violations. Full GO completion log is in section 6.
    - Notes: the avatar handler, profile/email/password handlers, Storage path,
      Auth calls, Firestore writes, and all toast messages are behavior-identical;
      only presentation and accessibility changed. Username uniqueness remains
      not server-enforced. Passwords stay in transient state only. No backend,
      Cloud Function, Firebase rules, storage, database, permissions, route, or
      data-format change was made.
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - [x] Migrate the Company Profile Application Form Questions interface.
    - Complete when: standard-field required/hidden exclusivity, all standard
      ids/labels/defaults, the exact `applicationConfig`/`customQuestions` save
      payload, custom-question UUID creation and `INITIAL_QUESTION_STATE`
      defaults, all question types, option add/remove/edit, type-change option
      initialization, preview/edit mode, ordering (mouse drag + a new
      keyboard method with the same array format), DOT deletion protection and
      the exact alert, and the inverse compliance-field mappings are preserved;
      every editor field has an associated label; standard toggles have unique
      accessible names with programmatic (non-color) state; desktop/tablet/mobile
      layout, overflow, axe, and final diff are verified without any backend,
      rules, or public-application-schema change.
    - Completed: 2026-07-24.
    - Files: `src/features/settings/components/questions/StandardQuestionsConfig.jsx`,
      `src/features/settings/components/questions/CustomQuestionsBuilder.jsx`,
      `src/features/settings/components/questions/QuestionEditor.jsx`,
      `src/features/settings/components/questions/ToggleSwitch.jsx`,
      `src/features/settings/components/profile/OperationalSettingsSection.jsx`,
      plus co-located tests and `e2e/company-settings-questions.spec.cjs`,
      this roadmap.
    - Verification: 5 focused files / 47 tests passed (4 new question files / 35
      tests + the unchanged CompanyProfileTab 12); full frontend coverage gate
      passed with 102 files / 766 tests and the existing 2 files / 48
      emulator-dependent rules tests skipped; public-application regression
      (`Step3_License`, `PublicApplyHandler`) passed; frontend lint 0 errors
      (163 existing warnings); typecheck, production build, and
      `git diff --check` passed. `company-settings-questions.spec.cjs` passed 9
      Chromium/Mobile Chrome checks with 3 intentional viewport-specific skips.
      Backend/callable/rules checks are not applicable — no Cloud Function,
      callable, or rule changed (`functions/node_modules` absent, so backend
      lint/`publicProfileDto` Jest were not run — recorded honestly; the
      frontend-side public consumers are covered).
    - Visual/mobile/a11y: reviewed at 1440×900, 1024×768, and 412×915 (standard
      config + a custom question with the options editor). No document-level
      horizontal overflow; standard rows stack with inline Required/Hidden
      captions on mobile; toggles are ARIA switches with `aria-checked`; reorder
      and delete are named IconButtons; every editor field is labelled. Unit axe
      clean; scoped real-browser axe found no serious or critical violations.
    - Notes: the `applicationConfig` `{[fieldId]:{required,hidden}}` shape, the
      `customQuestions` item fields (`id/key/type/label/options/required/
      dotRequired/helpText/min/max`), the `crypto.randomUUID()` id creation, the
      exact DOT-delete `alert()` text, and the inverse Lock/Protect mappings are
      unchanged; only presentation and accessibility changed. A keyboard
      move-up/down reorder was added alongside the preserved native drag; both
      mutate the same array order, so the saved format is identical. Because the
      design system still has no approved Switch/Checkbox primitive, the
      accessible `ToggleSwitch` and the native compliance checkboxes are
      documented feature-level compositions (see the Radio/checkbox item).
      Pre-existing latent behavior left unchanged and noted: the public
      `publicProfileDto` allowlist strips `addressHistory`/`employmentHistory`/
      `referralSource`/`mvrConsent` config so those toggles do not currently take
      effect publicly — a separate backend concern, not this UI slice.
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - Notes: Company Profile branding, Team & Users, and the account-security and
    application-questions screens are migrated (GO). SMS/number assignment and
    Integrations remain separate NO-GO slices and must not be migrated together
    with anything else.

- [~] In progress — Campaigns.
  - Complete when: campaign cards/editor/results/report dialogs migrate without
    changing targeting, sending, reporting, or status behavior.
  - [x] Migrate the campaign list card (`CampaignCard`) and its status/menu
    presentation.
    - Complete when: the card consumes approved primitives; status is a
      feature-mapped Badge tone/label; the options menu is an accessible popover
      with the exact Cancel-vs-Delete conditions; progress/leads/failed/method/
      date/View Report/Details are preserved; desktop/tablet/mobile layout,
      overflow, keyboard, and scoped axe pass without touching listeners,
      callables, permissions, or data shapes.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/CampaignCard.jsx`,
      `src/features/campaigns/components/CampaignCard.test.jsx`,
      `e2e/campaign-card.spec.cjs`, this roadmap.
    - Verification: 22 focused card tests passed; full frontend coverage gate
      passed with 102 files / 780 tests and the existing 2 files / 48
      emulator-dependent rules tests skipped; frontend lint 0 errors (163
      existing warnings); typecheck, production build, and `git diff --check`
      passed. `campaign-card.spec.cjs` passed 9 Chromium/Mobile Chrome checks
      with 3 intentional viewport-specific skips.
    - Visual/mobile/a11y: reviewed at 1440×900 and 412×915 (tablet overflow
      checked in E2E). No document-level horizontal overflow; the options menu
      is an accessible popover (`aria-haspopup`/`aria-expanded`, `role="menu"`/
      `menuitem`, Escape-to-close, click-outside preserved); the card opens from
      a keyboard-focusable Details button as well as the mouse whole-card click.
      Card-scoped real-browser axe found no serious or critical violations.
    - Notes: `CampaignCard` is presentation-only — the `CampaignsDashboard` keeps
      both Firestore listeners (`campaign_drafts`, `bulk_sessions`), the
      `cancelBulkSession` callable, the `window.confirm` messages, and the
      draft/session delete logic unchanged. Status tones preserve the prior
      appearance (active=success, completed=info, scheduled=warning, everything
      else neutral); `isCancellableSessionStatus` still decides Cancel vs Delete.
      No approved DS menu primitive exists, so the popover is a documented
      feature-level composition. 10 px card text was replaced with the supported
      `--ds-*` xs size. The dashboard shell (header, stat cards, tabs) remains
      legacy and out of this slice — its pre-existing 10 px stat-label contrast
      findings are tracked for a later dashboard slice.
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - [x] Migrate the campaigns dashboard shell (`CampaignsDashboard`) — header,
    Create action, stat cards, tabs, loading/empty states, card grid.
    - Complete when: the shell consumes approved layout/components
      (`PageContainer`/`PageHeader`/`Section`/`ResponsiveGrid`, `Button`,
      `MetricCard`); the former 10 px stat labels and their contrast are fixed;
      the Drafts/Past Sequences tabs are an accessible tablist (programmatic
      selection + keyboard); loading is announced; empty states carry a clear
      heading and action; and no listeners, callables, calculations, tab values,
      `CampaignCard` props, or report-modal behavior change.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/CampaignsDashboard.jsx`,
      `src/features/campaigns/CampaignsDashboard.test.jsx`,
      `e2e/campaigns-dashboard.spec.cjs`, `e2e/campaign-card.spec.cjs`
      (tab selector updated to `role="tab"`), this roadmap.
    - Verification: 16 focused dashboard tests passed (paywall + no-listeners,
      exact drafts/sessions listeners + unmount cleanup, live/outreach stats,
      accessible header/tablist/action, tab switch + arrow-key navigation, exact
      new-draft write + editor open, announced loading, per-tab empty states,
      frozen `CampaignCard` props, container axe). Full frontend suite 102 files
      / 790 tests passed (2 files / 48 emulator rules tests skipped); migrated
      file coverage 80% lines / 80% branches (uncovered lines are the frozen
      cancel/delete error branches and e2e-seed paths); frontend lint 0 errors;
      typecheck, production build, and `git diff --check` passed. Playwright
      passed 20 Chromium/Mobile Chrome checks across
      `campaigns-dashboard`/`campaign-card`/`campaign-launch-and-control` (6
      intentional viewport-specific skips).
    - Visual/mobile/a11y: reviewed at 1440×900, 1024×900, and 412×915 for both
      Drafts and Past Sequences tabs. No document-level horizontal overflow; the
      header stacks and the primary action goes full-width on mobile; stat cards
      collapse to one column. Stat labels now use the supported `--ds-*` xs size
      with `content-secondary` color (10 px + low-contrast defect fixed). The
      tablist exposes `role="tab"`/`aria-selected`, roving `tabindex`, and
      Arrow/Home/End activation with a visible focus ring; loading is a
      `role="status"` region. Shell-scoped real-browser axe found no serious or
      critical and no color-contrast violations.
    - Notes: presentation only — the paywall (`campaignsEnabled !== false`), both
      Firestore listeners (`campaign_drafts`, `bulk_sessions`) and their unsubs,
      the E2E mock seeds, session→card mapping, live/outreach calculations, the
      exact new-draft `setDoc` payload/path, `cancelBulkSession`, the
      `window.confirm` messages, delete logic, the `'drafts'`/`'history'` tab
      values, `CampaignCard` props, and `DetailedReportModal` wiring are all
      unchanged. No approved DS tab primitive exists yet, so the tablist is a
      documented feature-level composition following the WAI-ARIA tabs pattern.
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Migrate the campaign results table (`CampaignResultsTable`) — recipient
    delivery log with search, status, and per-row error.
    - Complete when: the log consumes approved primitives (`Card`, `Input`,
      `Label`, `Badge`); the former 10 px low-contrast headers are fixed; search
      is labelled; loading is announced; statuses are text + icon (never
      colour-only); per-row errors are readable; the scrollable results area and
      sticky header are preserved; and no query, mapping, search logic, or
      messages change.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/CampaignResultsTable.jsx`,
      `src/features/campaigns/components/CampaignResultsTable.test.jsx`,
      `e2e/campaign-results-table.spec.cjs`, this roadmap.
    - Verification: 11 focused tests passed (exact `getDocs` query — path,
      `orderBy('timestamp','desc')`, `limit(200)`, one read; no-query on missing
      IDs; announced loading; empty state; case-insensitive name / substring
      identity filtering; `delivered`→Delivered, all else→Failed mapping; per-row
      error; timestamp + `Pending` fallback; labelled search + column headers;
      container axe). Full frontend suite 102 files / 799 tests passed (2 files /
      48 emulator rules tests skipped); migrated file coverage 88% lines / 91%
      branches (uncovered are the fetch-catch and E2E-seed branches); lint 0
      errors; typecheck, production build, and `git diff --check` passed.
      `campaign-results-table.spec.cjs` passed 8 Chromium/Mobile Chrome checks
      (2 viewport-specific skips); the campaign-card/dashboard/launch specs stay
      green.
    - Visual/mobile/a11y: reviewed populated at 1440 and 412; no document-level
      horizontal overflow at 1440/1024/412 (wide content scrolls inside the
      results region). Headers now use the supported `--ds-*` xs size with
      `content-secondary` colour; statuses are `Badge` success/danger with a
      check/alert icon plus text; per-row errors use the readable danger token;
      the search field has a programmatic label; the scroll region is a labelled,
      keyboard-focusable region with the sticky header preserved. Real-browser
      axe scoped to the table found no serious/critical and no color-contrast
      violations.
    - Notes: presentation only — props (`companyId`, `campaignId`), the
      no-query-on-missing-IDs guard, the one-time `getDocs` on
      `companies/{companyId}/bulk_sessions/{campaignId}/logs` with
      `orderBy('timestamp','desc')` + `limit(200)`, the id-preserving log
      mapping, the `recipientName`/`recipientIdentity` search, the exact loading
      and empty strings, the `delivered`→Delivered / else→Failed rule, the
      console-only fetch-error handling, and the timestamp/`Pending` formatting
      are all unchanged. `DataTable` was intentionally not adopted here: it owns a
      horizontal column-scroll region and requires a definite-height ancestor for
      its vertical sticky scroll, which would replace the log's `max-height`
      grow-to-content behavior, and its skeleton loading would change the exact
      loading string — so `Card`/`Input`/`Badge` plus a semantic DS-token table
      are the safe fit (recorded as a primitive-fit exception). Recipient identity
      is sensitive: it is never logged, snapshotted, or seeded with real data
      (E2E uses artificial names + fictional 555-01xx contacts, guarded by
      `isE2ETestMode`).
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Migrate the detailed delivery-report dialog (`DetailedReportModal`).
    - Complete when: the dialog adopts the shared accessible `Modal` plus
      `Button`/`IconButton`/`Badge` and `--ds-*` tokens; backdrop close is kept
      while Escape, focus trap, and focus restoration are added; loading is
      announced; statuses are not colour-only; error text wraps; the results
      table scrolls internally without document overflow; and every fetch/retry
      contract, guard, message, and toast is preserved without any backend or
      rules change.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/DetailedReportModal.jsx`,
      `src/features/campaigns/components/DetailedReportModal.test.jsx`,
      `e2e/campaign-report-modal.spec.cjs`, this roadmap.
    - Verification: 17 focused tests passed (open/closed + missing-ID no-fetch
      guards; exact `companies/{id}/bulk_sessions/{id}/logs` query with
      `orderBy('timestamp','desc')` + `limit(200)` and id-preserving mapping;
      exact loading/empty/fetch-error strings; delivered = `status==='delivered'`
      or truthy `isSuccess`, else Failed; `hasFailures` = `failed` or
      `isSuccess===false`; retry confirm text, `retryFailedAttempts({companyId,
      originalSessionId})` payload, success toast + close-after-success, the
      `success:false`/generic/thrown failure branches; dialog focus-in, Escape,
      backdrop, header/footer close, focus restoration; container axe). Full
      frontend suite 102 files / 816 tests (2 files / 48 emulator rules tests
      skipped); frontend lint 0 errors; typecheck, production build, and
      `git diff --check` passed. `campaign-report-modal.spec.cjs` passed 9
      Chromium/Mobile Chrome checks with 1 viewport-specific skip; campaign
      card/results/dashboard specs stay green.
    - Visual/mobile/a11y: reviewed at 1440×900 and 412×915. The dialog is
      centered with a dimmed backdrop; the header/footer close and X are named
      controls; statuses are `Badge` success/danger with text (not colour-only);
      error cells wrap (`overflow-wrap: anywhere`); the results table is a
      labelled, keyboard-focusable scroll region (`scrollable-region-focusable`
      resolved) with a sticky header, so wide content scrolls inside the dialog
      with no document overflow at any width; on short viewports (landscape phone,
      zoom) the overlay scrolls vertically and the panel is auto-margin centered,
      so the Retry/Close controls are never clipped; loading is announced via a
      `role="status"` live region. Unit axe clean; dialog-scoped real-browser axe
      found no serious/critical violations.
    - Notes: presentation only — the props (`companyId`, `sessionId`, `isOpen`,
      `onClose`), the no-fetch-unless-open-with-both-IDs guard, the one-time
      `getDocs` and mapping, the exact strings, `hasFailures`, the delivered/failed
      rule, the retry confirmation/callable/toasts/close-after-success, and the
      `CampaignsDashboard` wiring are unchanged. `retryFailedAttempts` and all
      backend/rules are untouched. Recipient identity is sensitive and is never
      logged, snapshotted, or tested with real data (tests use synthetic names +
      `redacted-*` placeholders).
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - [x] Migrate the campaign detail view (`CampaignDetails`).
    - Complete when: the full-screen detail view adopts `Card`/`Button`/
      `IconButton`/`Badge`/`FieldMessage` and layout tokens; the progress bar is
      a programmatic `progressbar`; status/actions are not colour-only; loading
      is announced; failure text wraps; actions stay reachable (wrap) on mobile;
      no document overflow; and every tenant/company guard, formatting, progress
      calc, action-visibility rule, exact callable payload, confirmation, toast,
      loading flag, and `onClose` is preserved with no backend or rules change.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/CampaignDetails.jsx`,
      `src/features/campaigns/components/CampaignDetails.test.jsx`,
      `e2e/campaign-details.spec.cjs`, this roadmap.
    - Verification: 25 focused tests passed (null/tenant-mismatch/missing-company
      guards; `effectiveCompanyId` fallback + exact `CampaignResultsTable` props;
      capitalized status, progress calc + accessible `progressbar`, audience/sent/
      failed from progress and the matchCount/zero fallbacks; failure reason and
      message/method/id rendering; the active/queued/scheduled→Pause,
      paused→Resume, active|paused→Cancel, failures-on-non-active→Retry visibility
      rules; the exact `pause/resume/cancel/retry` callable names + payloads;
      resume `success:false` keeps the view open; confirm-cancellation for
      cancel/retry; success/failure/thrown branches; accessible back-close; axe).
      Full frontend suite 102 files / 839 tests (2 files / 48 emulator rules tests
      skipped); frontend lint 0 errors; typecheck, production build, and
      `git diff --check` passed. `campaign-details.spec.cjs` passed 8
      Chromium/Mobile Chrome checks; campaign card/results/report/dashboard specs
      stay green.
    - Visual/mobile/a11y: reviewed at 1440×900 and 412×915 (tablet overflow in
      E2E). No document overflow; the header + action buttons wrap on mobile so
      they stay reachable; status is a `Badge` with text (not colour-only); the
      progress bar exposes `role="progressbar"` + `aria-valuenow/min/max`; the
      failure reason uses a danger `FieldMessage` that wraps; action loading uses
      the `Button` busy state. Full-page real-browser axe (view + migrated shell)
      found no serious/critical violations.
    - Notes: presentation only — `effectiveCompanyId`
      (`campaign.companyId || currentCompanyProfile.id`), the tenant-mismatch and
      missing-company states and their exact copy, `formatDate`, the progress/
      audience/sent/failed calculations, the failure-reason source
      (`error || failureReason`), the message/method/id/date rendering, the
      `CampaignResultsTable` props, all four action-visibility rules, the exact
      `pauseBulkSession`/`resumeBulkSession`/`cancelBulkSession`
      (`{companyId: effectiveCompanyId, sessionId: campaign.id}`) and
      `retryFailedAttempts` (`{companyId, originalSessionId}`) payloads, both
      confirmations, all toasts, the per-action loading flags, and every `onClose`
      path are unchanged. `MetricCard` was not used for the stat cards because its
      tone set has no danger treatment for the red "Failed" count, so `Card` with
      status tokens is the fit (recorded exception). Status label casing is
      capitalized to match the already-migrated `CampaignCard`. No `CampaignEditor`
      or backend/rules change.
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - [x] Migrate the `CampaignEditor` shell (wizard chrome only).
    - Complete when: the shell adopts `Input`/`Button`/`FormField` + layout
      tokens; section navigation is keyboard-accessible with programmatic
      selected (`aria-current="step"`) and completed states; the Campaign Name is
      labelled; the save status and Suspense fallback are announced; the editor is
      responsive with no document overflow; and every listener/autosave/merge/
      guard/child-prop contract is preserved without touching `AudienceBuilder`,
      `ContentComposer`, `LaunchPad`, backend, or rules.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/CampaignEditor.jsx`,
      `src/features/campaigns/CampaignEditor.test.jsx`,
      `e2e/campaign-editor.spec.cjs`, this roadmap.
    - Verification: 12 focused tests passed (exact draft-doc listener + unsubscribe
      on unmount; no-subscribe on missing IDs; deep filter merge preserving
      in-memory `rawData`; no autosave on mount; the 2-second debounce with
      `rawData` stripped from the save payload; section navigation, `aria-current`,
      and audience/content completion rules; the exact `AudienceBuilder`/
      `ContentComposer`/`LaunchPad` props incl. `onLaunchSuccess === onClose`;
      the E2E-mock path skipping the listener; labelled name, announced save
      status, Exit; the Suspense fallback; axe). Full frontend suite 104 files /
      851 tests (2 files / 48 emulator rules tests skipped); frontend lint 0
      errors; typecheck, production build, and `git diff --check` passed.
      `campaign-editor.spec.cjs` passed 9 Chromium/Mobile Chrome checks with 1
      viewport-specific skip; all other campaign specs stay green.
    - Visual/mobile/a11y: reviewed at 1440×900 and 412×915 (tablet overflow in
      E2E). Desktop keeps the left sidebar; mobile stacks the shell (Exit,
      labelled name, section nav, save status) above the content with no document
      overflow. The nav is a labelled `<nav>` of buttons with `aria-current` and
      sr-only completed/incomplete text; the save status and Suspense fallback are
      `role="status"`/live regions. Unit axe clean; shell-scoped real-browser axe
      found no serious/critical violations.
    - Notes: shell/chrome only. Preserved verbatim: props (`companyId`,
      `campaignId`, `onClose`); the `audience`/`content`/`launch` `SECTIONS`;
      the initial `campaignData`; the E2E-mock behavior; the `onSnapshot`
      `campaign_drafts/{campaignId}` listener + unsub; the deep filter merge and
      in-memory `rawData` preservation; the `isDirty` + `isInitializedRef`
      init guards; the exact 2-second autosave debounce; the `rawData` strip
      before `saveDraft`; `isSectionComplete`; all lazy child props;
      `onLaunchSuccess={onClose}`; and the Saving/Auto-Saved status (the
      `useCampaignDraft` hook returns `isSaving: false`, so it reads "Auto-Saved").
      `AudienceBuilder`, `ContentComposer`, and `LaunchPad` were intentionally
      not touched.
    - Commit/PR: feature + docs commits on
      `claude/company-profile-security-migration-mjdbm1`; PR into `main`.
  - [x] Migrate the content composer (`ContentComposer`) — the editor's message
    Content section (channel toggle, subject/message fields, variable insertion,
    device preview, tips).
    - Complete when: the composer consumes approved primitives (`Card`,
      `FormField`, `Input`, `Textarea`, `Button`); the SMS/Email choice is a
      keyboard-accessible toggle exposing selected state; Subject/Message have
      associated labels; variable buttons identify what they insert; focus
      returns to the edited field; the character count is accessible; the toolbar
      is in normal flow (no overlapping absolute bar) and reachable on mobile;
      there is no document overflow at 1440/1024/412; and no message limit,
      validation, sending rule, or preserved behavior changes.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/ContentComposer.jsx`,
      `src/features/campaigns/components/ContentComposer.test.jsx`,
      `e2e/campaign-content-composer.spec.cjs`, this roadmap.
    - Verification: 18 focused tests passed (exact `{ ...messageConfig, [key]: value }`
      method updates; conditional Subject; message/subject merge updates;
      active-field tracking; every variable value with surrounding spaces; caret
      insertion; selection replacement; subject-vs-message targeting; append
      fallback when the selection API is unavailable; `requestAnimationFrame`
      focus + caret restoration; accessible character count; exact `DeviceMockup`
      `type`/preview content; placeholders; Pro Tips copy; axe). Full frontend
      suite 105 files / 869 tests passed (2 files / 48 emulator rules tests
      skipped); migrated file coverage 100% lines / 96.7% branches; lint 0 errors;
      typecheck, production build, and `git diff --check` passed.
      `campaign-content-composer.spec.cjs` passed 8 Chromium/Mobile Chrome checks
      (2 viewport-specific skips); the editor/card/dashboard/results/launch specs
      stay green.
    - Visual/mobile/a11y: no document-level horizontal overflow at 1440/1024/412
      (measured in-browser). The channel toggle is a labelled `role="group"` of
      `aria-pressed` buttons (keyboard-operable, selected state exposed); Subject
      and Message use `FormField` label association; variable buttons carry
      `Insert <name> placeholder` labels with a "inserts at your cursor in the
      active field" hint; the character count is an `aria-live="polite"` region
      with an sr-only "Message length:" prefix; the variable toolbar sits in
      normal flow below the field (the former absolute overlapping bar is gone).
      The intro subtitle was moved from `content-muted` to `content-secondary`
      because the editor's `#f1f5f9` content background dropped muted text to
      4.34:1; real-browser axe scoped to the composer then found no
      serious/critical and no color-contrast violations.
    - Notes: presentation only — props (`messageConfig`, `onChange`); the
      `handleChange` spread; the exact `sms`/`email` methods; email-only Subject;
      the `activeField` default (`message`) + focus tracking; the variable labels
      and values; caret/selection insertion with surrounding spaces;
      subject-only-when-email-and-active vs message targeting; the
      `requestAnimationFrame` focus/caret restore; the append fallback; the
      placeholders; the character count; and the `DeviceMockup` `type` + preview
      content are all unchanged. `DeviceMockup` was not redesigned. No message
      limit, validation, or sending rule changed.
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Migrate the audience builder (`AudienceBuilder`) — the editor's Audience
    section (source tabs, CRM filters, list import, recipient preview header).
    - Complete when: the builder consumes approved primitives (`Card`,
      `FormField`, `Select`, `Input`, `Button`); both tab groups are accessible
      and expose selected state; every filter and the file/sheet inputs are
      labelled; status stays a multi-select with a non-colour-only selected
      state; the count loading is announced and exclusion counts are readable;
      the upload surface uses one accessible file-input trigger with no nested
      interactive controls; the virtual list stays functional, internally
      scrollable and mobile-reachable; unsupported 10 px text is removed; and no
      targeting, counting, import parsing, exclusion rule, or saved filter shape
      changes.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/AudienceBuilder.jsx`,
      `src/features/campaigns/components/AudienceBuilder.test.jsx`,
      `e2e/campaign-audience-builder.spec.cjs`, this roadmap.
    - Verification: 22 focused tests passed (initial defaults + upload-tab
      restoration from `filters.leadType`; campaign-scope exclusion reset; upload
      fingerprint reset vs. preserved skips; CRM↔upload transitions with
      `rawData` added and stripped; the exact source/owner/exclusion option
      values; CRM `off` vs upload `7` defaults; labelled filter updates; status
      multi-select with `aria-pressed`; manual exclusions and
      `finalCount = matchCount − manualExcluded`; the exact file `accept` list +
      `handleFileChange`; sheet URL/import wiring and the processing state; the
      frozen `VirtualLeadList` props in both modes; announced count; arrow-key
      tab operation; axe in both modes). Full frontend suite 105 files / 887
      tests passed (2 files / 48 emulator rules tests skipped); migrated file
      coverage 93% lines / 84% branches; lint 0 errors; typecheck, production
      build, and `git diff --check` passed. `campaign-audience-builder.spec.cjs`
      passed 11 Chromium/Mobile Chrome checks (3 viewport-specific skips) and the
      29-check campaign regression sweep stayed green.
    - Visual/mobile/a11y: no document-level horizontal overflow at 1440/1024/412
      (measured in-browser). Source and import tabs are WAI-ARIA tablists with
      roving `tabindex`, Arrow/Home/End activation, `aria-selected`, and a visible
      focus ring; filters use `FormField` label association; status pills are
      `aria-pressed` buttons with a check icon so selection is never colour-only;
      a `role="status"` region announces the recipient count and its loading
      state; the exclusion chips were lightened to readable tones; the former
      10 px hint text now uses the supported `--ds-*` xs size via `FieldMessage`.
      Heading order was corrected (the upload panel's `h4` became `h3`) after
      axe flagged it. Real-browser axe scoped to the builder found no
      serious/critical violations.
    - Notes: presentation only — props (`companyId`, `filters`, `onChange`,
      `campaignScopeKey`); the initial tab selection and filter defaults; the
      `useCompanyTeam`/`useCampaignTargeting`/`useBulkImport` calls; the upload
      fingerprint helper; the campaign-scope and fingerprint exclusion resets;
      the CRM/upload effects and `rawData` handling; `onChange(localFilters,
      matchCount)` parent sync; manual exclusion toggling; `finalCount`; all
      filter and option values; the file `accept` list; the sheet URL/import
      behavior; every `VirtualLeadList` prop; and the exact
      `onChange(localFilters, finalCount)` Confirm Audience call are unchanged.
      **Documented temporary exception:** the recipient-preview panel keeps its
      dark surface (literal slate colours, not `--ds-*`) because the unmigrated
      `VirtualLeadList` — explicitly out of scope for this slice — renders its own
      hard-coded dark list chrome. (Resolved by the `VirtualLeadList` slice below:
      that list's 10 px status pills and low-contrast "Scanning Database..." label
      are now fixed and the builder's scoped axe scan no longer excludes it. The
      dark surface itself remains a deliberate, documented product treatment — see
      the dark-surface note in that slice.)
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Migrate the recipient preview list (`VirtualLeadList`) — virtualized lead
    rows, selection, pagination, and load states.
    - Complete when: the inaccessible clickable row containers become
      keyboard-operable selection controls that keep whole-row usability;
      selected / manually excluded / already-messaged states are text and icon
      based rather than colour-only; already-messaged rows stay non-toggleable;
      loading and pagination are announced; retry is an approved `Button`; error
      and empty states are accessible; the 10 px status pills are gone;
      "Scanning Database…" meets contrast; contact data is never logged or
      snapshotted; virtualization and internal scrolling stay intact; and no
      targeting, pagination, recipient data or exclusion behavior changes.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/VirtualLeadList.jsx`,
      `src/features/campaigns/components/VirtualLeadList.test.jsx`,
      `e2e/campaign-lead-preview.spec.cjs`,
      `e2e/campaign-audience-builder.spec.cjs` (its axe scan no longer excludes
      the preview), this roadmap.
    - Verification: 20 focused tests passed (exact `getFilteredLeadsPage` payload
      with `pageSize: 50`, the `excludeRecentDays` `off`→`null` and
      `campaignLimit` `parseInt` mapping, and `lastDocId`; append-with-cursor
      pagination and the `hasMore` rule including the empty-page case; reset on
      filter change; the in-flight fetch guard; local-data mode with no backend
      call; `import_<index>` fallback ids; name/contact fallbacks; toggle rows
      with `aria-pressed` and exact `onToggleExclusion(safeId)` values;
      non-toggleable already-messaged rows; phone-exclusion only when a Set is
      supplied; Badge status tones and no 10 px text; announced loading, empty and
      pagination states; alert + retry; the frozen Virtuoso props; axe with mixed
      row states). Full frontend suite 106 files / 907 tests passed (2 files / 48
      emulator rules tests skipped); migrated file coverage 100% lines / 93%
      branches; lint 0 errors; typecheck, production build, and
      `git diff --check` passed. `campaign-lead-preview.spec.cjs` passed 11
      Chromium/Mobile Chrome checks (3 viewport-specific skips) and the 35-check
      campaign regression sweep stayed green.
    - Visual/mobile/a11y: rows are now native `<button aria-pressed>` controls, so
      Enter/Space work from the platform and the whole row stays clickable; an
      `ds-visually-hidden` state sentence ("Included in this campaign" /
      "Excluded from this campaign" / "Already messaged — cannot be selected")
      pairs with the check/cross icon so state is never colour-only;
      already-messaged rows are not exposed as controls at all. Status pills are
      approved `Badge`s (12 px, replacing the 10 px spans); "Scanning Database…"
      moved to `slate-300` (≈9.5:1 on the panel, up from 4.23:1); loading, empty
      and pagination regions are `role="status"`; the failure state is a
      `role="alert"` with an approved `Button` retry. `Virtuoso` still owns the
      internal scrolling, and there is no document-level overflow at
      1440/1024/412. Real-browser axe over the **populated** preview (rows
      injected by intercepting the callable) found no serious/critical and no
      color-contrast violations.
    - Notes: presentation only — all props and defaults, local-vs-remote
      behavior, the StrictMode double-fetch guard, the `getFilteredLeadsPage`
      callable, the backend filter mapping, `pageSize: 50`, pagination/reset/
      append/`lastDocId`, the `hasMore` calculation, error handling and retry,
      imported-row fallback ids, name/contact fallbacks, the manual and
      phone-based exclusion rules, every exclusion callback value, the `Virtuoso`
      `data`/`endReached`/`itemContent`/Footer wiring, and all existing status and
      empty/loading/error copy are unchanged. Recipient contact data is never
      logged (only the failure reason is) and never snapshotted; all fixtures use
      artificial names and fictional 555-01xx numbers. **Documented feature-level
      exception (smallest scope):** the panel keeps its dark surface using literal
      slate colours instead of `--ds-*`, because the editor presents it as an
      inverted "console" panel and the design system has no approved dark-surface
      tokens; rather than expand the token set for one surface, the exception is
      confined to this container and every piece of text on it is contrast-checked
      in a real browser.
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Migrate the launch pad (`LaunchPad`) — the editor's Launch section:
    pre-flight checks, estimate, launch action and confirmation dialog.
    - Complete when: the pad consumes approved primitives (`Card`, `Button`,
      `Badge`, the shared `Modal`, status tokens); validation and success states
      are non-colour-only; the launching state is announced; the confirmation
      dialog has Escape dismissal, focus trap and focus restoration with
      mobile-safe actions; and no launch payload, validation message, toast,
      guard, estimate or preview behavior changes.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/LaunchPad.jsx`,
      `src/features/campaigns/components/LaunchPad.test.jsx`,
      `e2e/campaign-launchpad.spec.cjs`, this roadmap.
    - Verification: 33 focused tests passed (both validation messages and the
      combined case; the disabled launch action; the "Company ID missing" guard
      with no backend call; the estimate and its rounding; the accessible dialog
      name/description; Escape and Cancel without launching plus focus
      restoration; the 280-character preview truncation with and without the
      ellipsis; the exact `initBulkSession` payload with `rawData` stripped from
      `filters`, `null` rawData, and absent filters; every result branch
      (success, success with `filteredCount`, `success: false` with and without a
      message) and every error mapping (`bulk-actions-queue`,
      `PROCESS_BULK_BATCH_URL`, passthrough, empty); the duplicate-launch guard;
      the announced launching state; the finally-state resets and lock release;
      E2E mock short-circuit and the non-mock path; axe in the ready, blocked and
      dialog-open states). The real launch callable is never invoked — every test
      drives a stub — and all fixtures are artificial. Full frontend suite 106
      files / 938 tests passed (2 files / 48 emulator rules tests skipped);
      migrated file coverage 100% lines / 93.5% branches; lint 0 errors;
      typecheck, production build, and `git diff --check` passed.
      `campaign-launchpad.spec.cjs` passed 10 Chromium/Mobile Chrome checks.
    - Visual/mobile/a11y: the pre-flight result is an icon + heading text
      (`role="alert"` for failures, `role="status"` for the all-clear with a
      `Badge` carrying the estimate), so state is never colour-only; a
      visually hidden `role="status"` announces "Launching campaign…" while the
      request is in flight; the confirmation dialog is now the shared accessible
      `Modal` (adds Escape, focus trap and focus restoration, keeping backdrop
      dismissal) and its actions stack on narrow viewports; the launch action is
      an approved `Button` whose `disabled`/`loading` composition reproduces the
      previous `!isValid || isLaunching` rule exactly. No document-level
      horizontal overflow at 1440/1024/412; real-browser axe found no
      serious/critical and no color-contrast violations.
    - Notes: presentation only — props (`companyId`, `campaign`,
      `onLaunchSuccess`), the company-id validation, the `launchLockRef` +
      `isLaunching` duplicate-launch protection, the E2E mock behavior, the
      `initBulkSession` callable, the `rawData` extraction from filters, the exact
      payload (`companyId`, `sessionName`, `filters`, `rawData || null`, `config`,
      `scheduledFor: null`), every success/error toast and friendly error
      mapping, `onLaunchSuccess`, all finally-state resets, the validation
      messages, the estimated-duration calculation, the confirmation
      recipient/method/message preview with its 280-character truncation and
      ellipsis, and the button disabled/loading behavior are unchanged.
      `FieldMessage` was considered but not used: this screen has no form fields,
      and its error-tone variant renders its own `role="alert"`, which would have
      nested duplicate alerts inside the pre-flight summary.
    - Commit/PR: feature + docs commits on
      `claude/safehaul-design-system-g1vr3a`; PR into `main`.
  - [x] Close out Campaigns: resolve the two non-interactive leftovers.
    - Owner decision (2026-07-24): **split** — `DeviceMockup` is an approved
      documented exception; the `CompanyCampaignsPage` fallback is fixed.
    - Completed: 2026-07-24.
    - Files: `src/features/campaigns/components/DeviceMockup.jsx` (exception
      recorded in-code), `src/features/campaigns/pages/CompanyCampaignsPage.jsx`,
      `src/features/campaigns/pages/CompanyCampaignsPage.test.jsx`, this roadmap.
    - **Approved exception — `components/DeviceMockup.jsx`:** the simulated
      "9:41" device status time keeps `text-[10px]`. This is a *simulation of
      phone chrome*, not SafeHaul interface text: a real status bar is that
      small, and promoting it to the supported `--ds-*` xs size would make the
      mockup read as oversized UI rather than as a phone. The 9px/10px ban
      targets real interface text; nothing in the frame conveys product
      information. The rationale is also recorded in a file-level comment so the
      exception travels with the code. The bezel geometry keeps its literal
      sizes for the same reason. This exception is **scoped to this decorative
      component only** and must not be cited for interface text.
    - **Fixed — `pages/CompanyCampaignsPage.jsx`:** the "Please select a
      company." fallback moved off legacy `text-gray-700` onto
      `text-ds-content-secondary` (a defined Tailwind key — emission verified in
      the production CSS, per the lesson from the editor-nav token finding).
      Presentation only: the `useData` company resolution, the guard condition,
      the exact fallback string, and the `CampaignsDashboard companyId` handoff
      are unchanged. A test locks the DS token and asserts no `text-gray-*`
      class remains.
    - Verification: 3 `CompanyCampaignsPage` tests pass (guard message, token,
      dashboard handoff); full frontend suite, lint, typecheck, build, and
      `git diff --check` recorded in the closing-slice completion evidence below.
  - [x] **Campaigns is complete.** All ten interactive components are migrated
    and verified, the decorative `DeviceMockup` carries an approved documented
    exception, and the `CompanyCampaignsPage` fallback is tokenized. No Campaigns
    file remains on legacy interface styling.

- [~] In progress — E-docs is **complete**; the driver dossier **foundation** is
  complete (2026-07-27); the dossier's PEV/VOE, DQ and complex-editing workflows
  and the verification workflows remain.
  - Complete when: dialogs/tables/forms/states migrate and document generation,
    employment verification, uploads, previews, and audit behavior pass.
  - [x] Migrate the E-Docs envelope history table (`EnvelopeHistory`) — the
    Documents Center document/recipient/status/date/actions log.
    - Complete when: the `signing_requests` real-time subscription and ordering,
      the void write, both signing-link and signed-document callables, every
      toast and error mapping, and the per-status action-visibility rules are
      preserved while presentation adopts the approved `DataTable` with a
      feature-owned status adapter.
    - Completed: 2026-07-24 (GO).
    - Files: `src/features/signing/components/EnvelopeHistory.jsx`,
      `src/features/signing/components/EnvelopeHistory.test.jsx`,
      `e2e/edoc-envelope-history.spec.cjs`, this roadmap.
    - Verification: 46 focused unit tests, 10 Chromium + Mobile Chrome E2E
      checks, the 20 existing E-Doc send/sign regressions, the full frontend
      suite and coverage gate, lint, typecheck, production build,
      `git diff --check`, built-CSS token-emission check, unit and scoped
      real-browser axe, and review at 1440×900, 1024×768, and 412×915.
      Detailed evidence is in the completion log.
    - Notes: the 9 px delivery pills are gone and per-row action names are now
      unique; a snapshot failure raises a visible `role="alert"` instead of an
      empty table. `DocumentsManager`, `EnvelopeCreator`, backend functions and
      rules were untouched and stay open as separate slices.
  - [x] Refine the Sent Documents table — compact rows, single status-specific
    quick action, row-activated details, display-only pagination.
    - Complete when: ordinary desktop rows sit in the 64–76 px band with no
      four-button vertical stack; each row offers exactly one quick action
      (signed→Download, sent→Copy Link, delivery/sealing failure→Review,
      otherwise→View details); activating the row (mouse, Enter, Space) opens
      the existing details dialog, which remains the complete home for Copy
      Link/Correct/Void/Download; and the `signing_requests` subscription,
      `getSigningLink`/`getSignedDocumentUrl` payloads, void confirmation and
      Firestore update, clipboard behaviour, every toast, and the per-status
      action eligibility (table+dialog combined) are byte-identical.
    - Completed: 2026-07-29 (GO).
    - Files: `src/features/signing/components/EnvelopeHistory.jsx`,
      `src/features/signing/components/EnvelopeHistory.test.jsx`,
      `src/features/company-admin/components/documents/SentDocumentDetailsDialog.test.jsx`
      (new — the dialog's status→action contract now has its own coverage),
      this roadmap.
    - Verification: 66 EnvelopeHistory + 16 SentDocumentDetailsDialog focused
      tests (row activation, focus restoration, quick-action isolation, exact
      callable payloads, void-once semantics, pagination range/clamping, jsdom
      axe with and without the dialog open); the documents-workspace suites;
      the full frontend suite and coverage gate; lint; typecheck; production
      build; `git diff --check`; Chromium + Mobile Chrome E-Doc E2E including
      the scoped real-browser axe checks; and a measured live review with 110
      fixture documents at 1440/1024/768/412 (ordinary rows 74 px, one-line
      quick actions, 44 px `lg` touch controls below 768 px via `useIsMobile`,
      zero document-level horizontal overflow).
    - Notes: the old 64 px `actions` column width is what forced the vertical
      Details/Link/Correct/Void stack; the quick-action column now uses `lg`
      and the title/recipient columns share the flexible width. Pagination is
      a display-only slice over the live list (25/page, clamped when the list
      shrinks) using the DataTable pagination contract. Recipient contact
      fallback text replaces the bare em dash with "No email or phone". The
      delivery-failure row keeps its one-line truncated error; the full safe
      detail stays in the details dialog. Stored titles/recipients are never
      mutated — long values clamp visually with the full text on the cell
      tooltip and in the dialog.
    - Alignment polish (2026-07-29, PR #134): two token-based local offsets,
      no behaviour change. (1) The Back to Dashboard ghost button gets
      `-ml-ds-3`, cancelling its own `ds-space-3` inline padding so the
      visible arrow/label sits flush with the Documents heading while the
      padded hit area and focus ring stay full size. (2) The Actions heading
      and quick-action wrapper both get `-mr-ds-4`: the scroll region's
      reserved scrollbar gutter plus the shared `ds-space-5` cell padding
      left the right-aligned actions ~36px from the table border versus
      ~21px on the left; the offset restores symmetry (~20px) without
      touching the DataTable padding/scrollbar-gutter contracts other
      tables rely on. Verified: 203 focused unit tests (two new
      class-contract regressions), 36 Chromium + Mobile Chrome E2E checks
      incl. real-browser axe and the column contract, lint, typecheck,
      production build, `git diff --check`, and measured in-browser review
      at 1440/1024/768/412 (rows 74px, single-line quick actions, 44px
      touch controls below 768px, no horizontal overflow). Before/after
      screenshots: `docs/screenshots/sent-documents-table/polish-*.png`.
  - [x] Migrate the Documents Center page header (`DocumentsManager` header area
    only) — page canvas, Back to Dashboard, Create Template, Send One-off.
    - Complete when: back navigation and both creator transitions keep their
      exact call order while the canvas, heading, icon and three actions adopt
      `PageContainer`/`Stack`/`PageHeader` and approved `Button`s that wrap on
      mobile.
    - Completed: 2026-07-24 (GO) — PR #100, merged as `bfe4563`.
    - Files: `src/features/company-admin/views/DocumentsManager.jsx`,
      `src/features/company-admin/views/DocumentsManager.test.jsx`.
    - Verification: 9 focused tests, three E-Doc E2E specs (26 Chromium +
      Mobile Chrome checks), lint, production build, `git diff --check`, and a
      built-CSS emission check for `bg-ds-canvas`, `flex-wrap`, `self-start`
      and `text-ds-action-primary`.
    - Notes: the tabs and content blocks moved one indent level because their
      wrapper changed; no tab logic, class or prop was altered in that slice.
  - [x] Migrate the Documents Center navigation and template-management surface
    — the History/Templates tab interface in `DocumentsManager` plus the whole
    of `TemplatesPanel`.
    - Complete when: the `'list'`/`'templates'` state values (with `'list'`
      initial), the exact `EnvelopeHistory` props, every `TemplatesPanel` prop,
      the post-application ordering/required rules and persistence callbacks,
      and every template use/edit/delete argument shape are preserved while the
      tabs become a WAI-ARIA tab interface and the panel adopts
      `Card`/`Button`/`IconButton`/`Badge`/`Stack`/`ResponsiveGrid`.
    - Completed: 2026-07-24 (GO).
    - Files: `src/features/company-admin/views/DocumentsManager.jsx`,
      `src/features/company-admin/views/DocumentsManager.test.jsx`,
      `src/features/company-admin/components/documents/TemplatesPanel.jsx`,
      `src/features/company-admin/components/documents/TemplatesPanel.test.jsx`,
      `e2e/edoc-documents-tabs-and-templates.spec.cjs`,
      `e2e/edoc-recruiter-send-flow.spec.cjs` (selectors only), this roadmap.
    - Verification: 22 DocumentsManager + 35 TemplatesPanel focused tests, 12
      new Chromium + Mobile Chrome E2E checks, the existing E-Doc send/sign and
      envelope-history regressions, the full frontend suite and coverage gate,
      lint, typecheck, production build, `git diff --check`, built-CSS token
      emission, unit and scoped real-browser axe, and a measured review at
      1440×900, 1024×768 and 412×915. Detailed evidence is in the completion
      log.
    - Notes: the design system has no approved Tabs or Checkbox primitive, so
      both stay feature-owned documented compositions. `SendTemplateModal`,
      `EnvelopeCreator`, the prefill utilities, backend functions and rules were
      untouched.

- [x] Public application and change-review portals.
  - Complete when: field/progress/state primitives migrate stepwise with draft,
    submission, validation, upload, offline, consent, and mobile behavior
    preserved.
  - Completed: change review 2026-07-23; public application 2026-07-27.
  - Files (public application slice): `src/design-system/components/form/ChoiceControls.jsx`,
    `src/design-system/components/form/ChoiceControls.css`,
    `src/design-system/components/form/ChoiceControls.test.jsx`,
    `src/design-system/components/form/index.js`,
    `src/design-system/components/form/README.md`,
    `src/design-system/components/progress/*`,
    `src/design-system/components/index.js`,
    `src/design-system/components/README.md`,
    `src/design-system/README.md`,
    `src/design-system/tests/tokens.test.js`,
    `src/features/driver-app/components/application/PublicApplyHandler.jsx`,
    `src/features/driver-app/components/application/PublicApplyHandler.contract.test.jsx`,
    `src/features/driver-app/components/application/PublicApplyScreens.jsx` (+ test),
    `src/features/driver-app/components/application/IntakeChooser.jsx`,
    `src/features/driver-app/components/application/RequiredDocumentsChecklist.jsx` (+ test),
    `src/features/driver-app/components/application/UploadField.jsx` (+ test),
    `src/features/driver-app/components/application/steps/Step1_Contact.jsx` … `Step9_Consent.jsx`,
    `src/features/driver-app/components/application/steps/DynamicQuestionsStep.jsx` (+ test),
    `src/features/driver-app/components/application/steps/Step8_Review.test.jsx`,
    `src/features/driver-app/components/application/steps/components/{StepNavigation,StateSelectField,BusinessInfoSection,VehicleExperienceSection,EmergencyContactsSection,EmployerNameAutocomplete}.jsx`,
    `src/shared/components/layout/Stepper.jsx` (+ new `Stepper.test.jsx`),
    `src/shared/components/form/{InputField,RadioGroup,MonthYearField,DynamicRow,AgreementBox}.jsx`
    (+ new `RadioGroup.test.jsx`, `MonthYearField.test.jsx`, `AgreementBox.test.jsx`),
    `src/shared/components/feedback/ToastProvider.jsx`,
    `src/features/sandbox/SandboxActionPanel.jsx`, `src/index.css`,
    `e2e/helpers/wizardHelpers.cjs`, `e2e/public-application.spec.cjs`,
    `e2e/public-application-responsive.spec.cjs`, `e2e/a11y.spec.cjs`,
    `e2e/guest-application-intake.spec.cjs`, `e2e/guest-offline-queue.spec.cjs`,
    `e2e/guest-post-application-edoc.spec.cjs`, `e2e/wizard-double-submit.spec.cjs`,
    this roadmap.
  - Verification: full evidence in the completion log in section 6.
  - Notes: the design system gained the `Checkbox` / `Radio` / `ChoiceGroup` and
    `ProgressBar` primitives this surface needed, closing two recorded Phase 4/5
    gaps. Firebase, rules, indexes, routes, permissions, feature flags,
    application field keys, saved payload shapes, validation meaning, draft /
    offline-queue / retry semantics, upload paths and limits, step ordering and
    conditional-step logic, consent wording, and the post-application
    template/signing contracts are all unchanged.

- [x] Signing and envelope creation.
  - Complete when: specialized document-first behavior, coordinates, zoom,
    gestures, signatures, and send/sign workflows pass all existing and added
    desktop/mobile tests. This is high risk and must not be an early pilot.
  - Completed: envelope creation and E-Docs 2026-07-25 (see the E-Docs final
    audit); the public signing room 2026-07-25 (slices 1–4 plus the final audit
    in section 6).
  - Verification: recorded in the E-Docs and signing completion logs and their
    two final audits in section 6 — 46 history + 22 DocumentsManager + 35
    TemplatesPanel + 51 SendTemplateModal + 21 creator-shell + 30
    field-properties + 42 sidebar + 31 date-triplet unit tests, the signing
    slice suites, 52 Chromium/Mobile Chrome E2E checks, existing send/sign
    regressions, 1440/1024/412 px, scoped real-browser axe (zero serious or
    critical in the signing room), built-CSS token emission, `git diff --check`.
  - Notes: this item was still `[ ]` on 2026-07-27 even though every sub-slice
    had shipped — corrected then, together with the stale "Not started" signing
    row in section 5.1. Coordinates, zoom, gesture handling, the PDF canvas and
    `SIGNATURE_INK` remain feature-owned with recorded exceptions.
    `src/shared/components/signature/SignaturePad.jsx` is a *different* legacy
    control used only by the verification respondent flow and stays open under
    its own item.

- [ ] Super Admin.
  - Complete when: tables, cards, controls, modals, integrations, analytics,
    and system states migrate without changing elevated permissions or
    maintenance actions.

- [x] Auth, sandbox, and remaining edge screens.
  - Complete when: visual primitives migrate and login/redirect/test-only
    behavior remains unchanged.
  - Completed: Login and Sandbox Transfer Success 2026-07-23; the verification and
    change-review token screens 2026-07-23; the sandbox application and its
    post-submit action panel 2026-07-27.
  - [x] Migrate the Login `/login` screen to approved form/button/card
    primitives and the shared accessible dialog.
    - Complete when: email/password login, password visibility, authentication
      errors and loading, smart role-based and requested-route redirects, and
      the full password-reset workflow are preserved while presentation adopts
      FormField/Input/Button/IconButton/Card and the shared Modal.
    - Completed: 2026-07-23.
    - Files: `src/features/auth/components/LoginScreen.jsx`,
      `src/features/auth/components/LoginScreen.test.jsx`,
      `e2e/login.spec.cjs`, `src/design-system/README.md`, this roadmap.
    - Verification: 16 focused Login tests plus the 5 existing auth tests, the
      full frontend suite, design-system/route/modal-adoption gates, lint,
      typecheck, production build, `git diff --check`, Chromium and Mobile
      Chrome E2E (login spec + access-control regression), unit and scoped
      real-browser axe, and rendered review at 1440×900, 1024×768, and 412×915.
      Detailed evidence is in the completion log.
    - Notes: the reset modal was migrated to the shared accessible Modal;
      sandbox and remaining edge screens stay open.
  - [x] Migrate the Sandbox Transfer Success status screen
    (`/sandbox/transfer-success`) to approved Card/Button/Badge and layout
    primitives.
    - Complete when: the `companyName || companyId || 'the selected company'`
      fallback, the `New Application` status wording, and the Super Admin (`/super-admin`)
      and Home (`/`) navigations are preserved while presentation adopts
      Card/Badge/Button/Stack/Inline with a single `<h1>`/`<main>`.
    - Completed: 2026-07-23.
    - Files: `src/features/sandbox/SandboxTransferSuccess.jsx`,
      `src/features/sandbox/SandboxTransferSuccess.test.jsx`,
      `e2e/sandbox-transfer-success.spec.cjs`, this roadmap.
    - Verification: 9 focused tests, the route-manifest and design-system gates,
      full frontend suite, coverage, lint, typecheck, production build,
      `git diff --check`, Chromium and Mobile Chrome E2E, unit and scoped
      real-browser axe, and rendered review at 1440×900, 1024×768, and 412×915.
      Detailed evidence is in the completion log.
    - Notes: route paths, navigation, status wording, and the state fallback are
      unchanged; the route-manifest entry was untouched.
  - [x] Migrate the sandbox application screen (`/sandbox/apply`) and its
    post-submit `SandboxActionPanel`.
    - Complete when: the sandbox wizard keeps reusing `PublicApplyHandler`
      verbatim, the sandbox-only banner and Magic Fill control stay
      sandbox-gated, and the delete/transfer callables, Super Admin gate and
      `/sandbox/transfer-success` navigation state are unchanged.
    - Completed: 2026-07-27, as part of the public-application campaign.
    - Files: `src/features/sandbox/SandboxActionPanel.jsx`,
      `src/shared/components/layout/Stepper.jsx` (Magic Fill exception), and
      everything the shared wizard slice touched.
    - Verification: recorded in the public driver application completion log in
      section 6.
    - Notes: the Magic Fill control remains a documented raw-button exception —
      it must stay visually distinct from every production action, and the
      approved `Button` has no warning tone yet.
  - Remaining: nothing in this group. The verification and change-review token
    screens were completed on 2026-07-23; the sandbox application and its action
    panel on 2026-07-27.

### Phase 14 — cleanup and durable documentation

- [ ] Publish `docs/SAFEHAUL_UI_DESIGN_STANDARD.md`.
  - Complete when: foundations, components, patterns, content, accessibility,
    responsive, tables, exceptions, contribution workflow, and catalog links
    reflect implemented reality and have owner approval.

- [ ] Remove legacy styles and compatibility wrappers.
  - Complete when: repository searches show no consumers, visual and functional
    suites pass, migration notes identify replacements, and the deletion diff
    is reviewed separately.

- [ ] Close the initiative.
  - Complete when: every roadmap item is complete or an owner-approved,
    separately tracked exception; all active screens use approved primitives;
    guardrails are blocking; the catalog and visual baselines are current; and
    a final repository-wide audit confirms no competing design system remains.

---

## 5. Migration inventory

### 5.1 Active route and feature-screen inventory

Status `Not started` means audited but not migrated.

**Progress, counted from the Status column (2026-07-28): 19 of 19 rows complete
— 100% of the screen inventory.** The Super Admin row closed with the
true-100% closeout campaign (see its completion log in section 6).

> **Repository-wide 100% reached 2026-07-28** by the final-six-confirmations
> campaign, which closed the last item section 5.5 had left open. This table counts
> *screen/area rows*; the true-100% closeout before it audited the whole repository
> and fixed everything except six blocking `window.confirm` guards, and that
> campaign removed those — plus three bare `confirm(...)` calls and three live
> `alert()` calls that the `window.confirm`-only scan had missed.
>
> The claim is now **machine-checked, not narrative**:
> `src/tests/noBlockingBrowserDialogs.test.js` fails the build if any reachable
> `confirm(` / `alert(` returns. Keep section 5.5 — it records what was found and
> the approved exceptions that are *not* debt. Three campaigns in a row each found
> a stale claim that overstated progress; the ratchet exists so a fourth cannot.

> **Super Admin closeout — COMPLETE 2026-07-28.** Migrated across three passes:
> the shell, navigation and all five dialogs; then seven views (`DashboardView`,
> `AnalyticsView`, `CompaniesView`, `UsersView`, `GlobalSearchResults`,
> `FeaturesView`, `StatsBackfillPanel`, `UnifiedDriverList`); then the SMS
> integration group (`IntegrationManager`, `LineManager`, `AddLineModal`) and
> `GlobalQuestionsManager`. The final campaign closed the last three views
> (`SystemHealthView`, `CreateView`) **plus two sub-surfaces the dialog pass had
> missed entirely** — `EditUserNameForm` and `UserMembershipsManager`, the two
> bodies rendered inside the already-"migrated" `EditUserModal`, which were still
> fully legacy with three `window.confirm`s, six `alert()`s, three `title`-only
> icon controls and an unlabelled per-row select. All ten rail views now carry
> real-browser axe on Chromium **and** Mobile Chrome with zero serious/critical.

> **Reconciliation flag from 2026-07-27 — resolved 2026-07-28.** The flag
> below recorded that the **Company settings** row read `Not started` while
> section 8's narrative already described Company info, branding, Team &
> Users, Billing, Automated SMS, Email Settings, account security and
> application questions as migrated (GO). The Company Settings closeout
> campaign audited every one of those sections against the current
> design-system contract (not just the roadmap's claim) and found the
> narrative was **mostly right, with two real gaps**: `ManageTeamModal`
> (Team & Users) still used a blocking `window.confirm`/`alert()`, and
> `CustomQuestionsBuilder` (application questions) still used a blocking
> `alert()` for its DOT-required delete guard — both are now fixed (see the
> Company Settings completion log in section 6). `CompanyProfileTab`'s own
> header/tab-strip and part of `EmailSettingsTab`'s SMTP setup guide also still
> had hardcoded Tailwind classes alongside their otherwise-migrated markup;
> both are now tokenized. Everything else the narrative described as GO was
> re-verified and found genuinely compliant, unchanged. The two areas the
> narrative and the row agreed were still open — **SMS number assignment** and
> **Integrations** — are migrated now too. The original flag's suspicion was
> correct: the true figure was higher than 78.9% throughout, and it is 94.7%
> as of this closeout.

| Screen / area | Current implementation | Target component or pattern | Priority | Risk | Dependencies | Status | Verification needed |
|---|---|---|---|---|---|---|---|
| Login `/login` | `features/auth/components/LoginScreen.jsx` now consumes `FormField`, `Input`, `Button`, `IconButton`, `Card`, and the shared accessible `Modal`; branded marketing panel preserved | Field, Button, Card, shared Modal | Medium | Medium | Tokens, controls, forms, cards | Compatibility slice completed 2026-07-23 | Verified: 16 focused + 5 existing auth tests, login/requested-route/super-admin/company/root redirects, password visibility, loading/errors, reset open/submit/success/failure/close, focus, autofill, Chromium/Mobile Chrome, 1440/1024/412 px, axe, overflow |
| Company workspace shell | `company-admin/layout/*`; feature-owned sidebar/topbar consuming WorkspaceFrame and approved controls | Layout primitives consumed by feature-owned shell | High | Medium | Tokens, controls, layouts | Completed 2026-07-23 | Verified: routes, roles, flags, persisted desktop collapse, overflow, keyboard/focus, 1440/1024/412 px, Mobile Chrome, scoped axe |
| Company dashboard | `CompanyAdminDashboard`, MetricCard compatibility adapter, DataTable leaderboard | PageHeader, Card, Metric, DataTable, Dialog, PageState | High | Medium | Controls, cards, table, dialog | Completed 2026-07-23 | Verified: dashboard/onboarding tests, stats/actions, leaderboard loading/empty/error/retry, import/lead routes, numeric alignment, desktop/mobile, scoped axe; Dialog/PageState family migration remains a separate shared phase |
| Applications / company leads / my leads | `CompanyCandidatesListPage` now consumes the approved DataTable; feature owns toolbar, filters, actions, and status mapping | Approved DataTable pilot, toolbar, filters, page states | Critical | High | Table spec/primitives, controls, badge | Completed 2026-07-23 | Verified: measured alignment, keyboard row/selection, filters/sorting, pagination contract, bulk actions, calls, dossier, desktop/mobile, scoped axe |
| Campaigns | All interactive components migrated — `CampaignCard`, `CampaignsDashboard` shell, `CampaignResultsTable`, `DetailedReportModal`, `CampaignDetails`, `CampaignEditor` shell, `ContentComposer`, `AudienceBuilder`, `VirtualLeadList`, and `LaunchPad`; only the decorative `DeviceMockup` illustration and the `CompanyCampaignsPage` fallback string remain unmigrated | Presentation-only throughout; the dashboard keeps both listeners + cleanup, stats, new-draft write, `cancelBulkSession`, confirmations, delete logic, and wiring; `CampaignDetails` keeps `effectiveCompanyId`, guards, and the pause/resume/cancel/retry payloads; the `CampaignEditor` shell keeps the draft listener, deep merge + `rawData` preservation, 2s autosave debounce, and all lazy child props; `ContentComposer` keeps the `messageConfig` spread and variable insertion; `AudienceBuilder` keeps the targeting/import hooks, exclusion resets and `finalCount`; `VirtualLeadList` keeps the `getFilteredLeadsPage` callable, mapping, pagination and exclusion rules; `LaunchPad` keeps the `initBulkSession` payload, launch guards, toasts, error mapping, estimate and preview truncation | Status presentation, action-visibility rules, exact callables, autosave/merge/guards, variable insertion targeting, targeting/counting/import parsing, pagination and exclusion behavior, launch payload and guards | Medium | High | **Complete** 2026-07-24 — all ten interactive components migrated; `CompanyCampaignsPage` fallback tokenized; decorative `DeviceMockup` status-bar text carries an approved documented exception | 22 card + 16 dashboard + 11 results + 18 report-modal + 25 details + 12 editor + 18 composer + 22 audience + 20 preview + 33 launch unit tests, full suite/coverage, Chromium/Mobile Chrome, 1440/1024/412 px, scoped axe, overflow, git diff --check passed |
| E-Docs | `EnvelopeHistory` (approved `DataTable`), the `DocumentsManager` page header/canvas, its History/Templates tab navigation (feature-owned WAI-ARIA tab interface), and the whole `TemplatesPanel` are migrated; `SendTemplateModal`'s own surface (shared accessible Modal, labelled fields, pressed delivery group, approved Button rows) is migrated — with a recorded exception for the nested legacy `DateTripletField` it renders for date-triplet prefill groups; the `EnvelopeCreator` shell (sub-slice A), its `FieldPropertiesPanel` rail (sub-slice B), the `EnvelopeSidebar` (sub-slice C) and the shared `DateTripletField` (sub-slice D — which closed the nested-control exception, so the send dialog is migrated without qualification) are migrated; every E-Docs component is migrated | Presentation-only throughout: the history table keeps the `signing_requests` `onSnapshot` subscription and ordering, the `voided` + `serverTimestamp` write, the `getSigningLink`/`getSignedDocumentUrl` callables, `gs://` path cleaning, `window.confirm` and every toast; the header keeps back navigation and both creator transitions; the tabs keep the exact `'list'`/`'templates'` values with `'list'` initial; `TemplatesPanel` keeps every prop, the `postSubmitRequiredById = {}` default, the `!== false` required rule, `templates.find` lookup with null for missing ids, the id order, the move directions and first/last disabling, and all callback argument shapes | Real-time status updates, per-status action visibility, signing-link confidentiality, tab state values, post-application ordering/required persistence, template use/edit/delete argument shapes | High | High | **Complete** 2026-07-25 — `EnvelopeHistory`, the header, the tab navigation, `TemplatesPanel` and `SendTemplateModal` (GO 2026-07-24); `EnvelopeCreator` sub-slices A–F (GO 2026-07-25); final audit closed the signing-surface axe findings | 46 history + 22 DocumentsManager + 35 TemplatesPanel + 51 SendTemplateModal + 21 creator-shell + 30 field-properties + 42 sidebar + 31 date-triplet unit tests, 52 new Chromium/Mobile Chrome E2E checks, existing E-Doc send/sign regressions, full suite/coverage, 1440/1024/412 px, scoped axe, overflow, built-CSS token emission, git diff --check passed |
| Import leads | `ImportLeadsPage` (shell, header, access-denied, feature-locked), `CompanyBulkUpload` (assignment mode, team-member selection, repair action) and the shared `BulkUploadLayout` (step meter, upload methods, preview table, progress, success) now consume the shared accessible `Modal`, `Button`/`IconButton`, `ChoiceGroup`/`Radio`/`Checkbox`, `FormField`/`Input`, the approved `DataTable` for the preview, `ProgressBar`, `StatusMedallion`, `FieldMessage` and `PageHeader`/`PageContainer`/`Stack` | Upload pattern, DataTable preview, shared Modal, PageState | Medium | High | Forms, table, dialog, feedback | **Complete (GO)** 2026-07-27 | Verified: 91 focused unit tests (26 `BulkUploadLayout` contract freeze + 31 `BulkUploadLayout` a11y/defect + 20 `CompanyBulkUpload` contract freeze + 16 `CompanyBulkUpload` a11y/defect + 10 `ImportLeadsPage` contract freeze + 5 `ImportLeadsPage` a11y, plus 11 `useBulkImport` + 19 `useCompanyLeadUpload` hook contract freezes), full suite/coverage, lint, typecheck, production build, callable-contract, 25 new Chromium + 19 Mobile Chrome E2E (real Web Worker CSV parse, Google Sheet error path, assignment/recipient selection, data-repair dialog, large-preview row cap and bounded scroll, keyboard walkthrough, axe on every state), regression E2E on the other `BulkUploadLayout`/`useBulkImport` consumers (`AudienceBuilder`, company dashboard shell), 1440/1024/412 px, `git diff --check` |
| Quick add lead | `QuickAddLeadPage` now consumes `FormSection`, `FormField`, `Input`, `Select`, `Textarea`, `Button`, `Card`, `PageHeader`/`PageContainer`/`Stack`/`ResponsiveGrid`. `QuickLeadModal` (a separate dashboard-launched modal with its own phone-or-email rule and `LEAD_DEFAULT_STATUS`) was out of this campaign's scope and remains unmigrated | Form layout, Field controls, Button | Medium | Medium | Controls, forms | **Complete (GO)** 2026-07-27 — `QuickAddLeadPage` only; `QuickLeadModal` open | Verified: 36 focused unit tests (14 contract freeze + 22 a11y/defect), full suite/coverage, lint, typecheck, production build, 12 new Chromium + 2 Mobile Chrome E2E (labelling, app-level validation with focus management, duplicate-submit lock, CDL options, keyboard completion, axe), 1440/1024/412 px, `git diff --check` |
| User profile | `UserProfilePage` now consumes `FormSection`, `FormField`, `Input`, `Button`, `FieldDisplay`, `FieldMessage`, `PageHeader`, `Stack`; avatar upload moved to keyboard-accessible `ProfileAvatarField` (no nested interactives) | PageHeader, Card, Field, Button, FieldMessage | Medium | High | Forms, controls, cards, feedback | Completed 2026-07-24 (GO) | Verified: 38 focused tests (load prefs/fallback, avatar type/size + Storage sequence, profile validation/username query + permission skip, email reauth/errors/cancel, password branches/reset, password non-exposure, autocomplete, keyboard avatar, axe), full suite/coverage, route manifest, Chromium/Mobile Chrome, 1440/1024/412 px, git diff --check |
| Company settings | `CompanySettings` shell now names the page with a `PageHeader` `<h1>` (suppressed only on the one tab that already supplies its own) and drops a dead, never-invoked local success-toast mechanism. Every tab is migrated: Company info/branding/questions, Team & Users, Billing, Automated SMS, Email Settings and account security were re-verified as already-compliant (two real gaps fixed in place: `ManageTeamModal`'s `window.confirm`/`alert()` and `CustomQuestionsBuilder`'s DOT-delete `alert()`, both replaced with accessible non-blocking equivalents). **SMS number assignment** (`NumberAssignmentManager` + `DefaultLineSection`/`AssignmentTable`/`AssignmentRow`/`SMSDiagnosticModal`) and **Integrations** (`IntegrationsTab`) — the two areas the 2026-07-23 deep-audits left NO-GO — are now migrated (presentation only) | Tabs, PageHeader, Field family, native-table pattern, shared Modal, Field/Button/Card/Badge/StatusMedallion | High | High | Controls, forms, table, dialog, status | **Complete (GO)** 2026-07-28 — full row closeout; see the Company Settings closeout completion log | Verified: 190 focused unit tests across the two newly-migrated areas and the fixed defects (99 contract-freeze incl. the pre-existing frozen 15-case SMS suite + 91 a11y/defect), full suite/coverage (2129 passed, 0 regressions), lint, typecheck, production build, callable-contract, 25 new Chromium + 19 Mobile Chrome E2E on the two new areas, full 12-spec Company Settings regression E2E on Chromium (51 passed, 1 pre-existing unrelated flake in `AutomatedSmsTab` — untouched by this campaign, reproduced in isolation) and Mobile Chrome (38 passed, 0 failed), a real Chromium axe scan catching and fixing a genuine color-contrast regression from an `opacity-70` decorative wrapper, 1440/1024/412 px, `git diff --check` |
| Super Admin `/super-admin/*` | **Complete.** Shell (`SuperAdminDashboard`, `DashboardHeader`, `SuperAdminSidebar`), all five dialogs (`EditCompanyModal`, `DeleteCompanyModal`, `EditUserModal`, `DeleteUserModal`, `ViewCompanyAppsModal`) **and both `EditUserModal` bodies** (`EditUserNameForm`, `UserMembershipsManager`), plus every view behind the rail: `DashboardView`, `AnalyticsView`, `CompaniesView`, `UsersView`, `UnifiedDriverList`, `GlobalSearchResults`, `FeaturesView`, `IntegrationManager`/`LineManager`/`AddLineModal`, `GlobalQuestionsManager`, `StatsBackfillPanel`, `SystemHealthView`, `CreateView` | Feature-owned router using layout/card/table/dialog/form system | High | High | All core families | **Complete (GO)** 2026-07-28 — see the true-100% closeout completion log | Verified: 15 shell + 45 dialog + 167 view unit tests, plus 96 new in the final campaign (37 `SystemHealthView`, 29 `CreateView`, 30 Edit User bodies) and 10 bulk-action safety tests; `vitest run src/features/super-admin` **321 passed**; `e2e/super-admin-views.spec.cjs` + `super-admin-shell.spec.cjs` — **31 passed on Chromium, 38 passed on Mobile Chrome**, real-browser axe with zero serious/critical on **all ten** rail views (System Health, Form Builder and Create New added in the final campaign), one `<h1>` per view, 1440/1024/412 px overflow clean, keyboard tab-strip walkthroughs, no native `confirm`/`alert` reachable; full suite/coverage, lint, typecheck, production build, callable-contract, `git diff --check` |
| Public application `/apply/:slug` | `PublicApplyHandler` shell, the shared `Stepper` frame, all nine steps, the custom-questions step, the four status screens, the intake chooser, the post-application `RequiredDocumentsChecklist`, `UploadField`, and the shared `InputField` / `RadioGroup` / `MonthYearField` / `DynamicRow` / `AgreementBox` adapters now consume `Card`, `Button`, `IconButton`, `Badge`, `FormSection`, `FormField`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `ChoiceGroup`, `FieldDisplay`, `FieldMessage`, `Label`, `StatusMedallion` and the new `ProgressBar` | Feature-owned wizard on approved Progress/Field/Button/Card/status primitives | Critical | Very high | Forms, feedback, layout, compatibility plan | **Migrated (GO)** 2026-07-27 | Verified: 89 new focused unit tests (submission contract, wizard frame, choice/date/upload/agreement controls, checklist, status screens, custom questions, review) + full suite/coverage, lint, typecheck, production build, callable-contract, 6 guest E2E specs serially and at 4× under worker contention, new responsive spec at 1440/1024/412 px, extended real-browser axe across every step and both status screens on Chromium and Mobile Chrome, keyboard walkthrough, `git diff --check`, grep audit |
| Signing room `/sign/...` | Status screens, room shell, signer field layer and signature capture sheet all consume approved `Card`/`Button`/`StatusMedallion` and `--ds-*` tokens; the PDF canvas, coordinates and zoom stay feature-owned | Approved controls/states around feature-owned document canvas | Medium | Very high | Controls, dialog, feedback; signing QA | **Complete** 2026-07-25 (slices 1–4 + final audit) | Verified: per-slice completion logs in section 6, the 2026-07-25 final audit (zero serious/critical axe in the room, no legacy palette classes, documented `SIGNATURE_INK` and three raw-button exceptions), existing signing unit/E2E, coordinates, zoom/touch/signature, mobile |
| Verification portal `/verify/:token` | `VerificationPortal` + status screens + 4 sections consume `Card`, `FormSection`, `FormField`, `Input`, `Select`, `Textarea`, `FieldDisplay`, `FieldMessage`, `Badge`, `Button`, `Stack`; feature-local `RadioGroup` accessibility-hardened; **closed out 2026-07-27** — the page header is tokenised, the validation summary names fields by their on-page label, submission is guarded against implicit re-submit, and the shared `SignaturePad` is migrated (tokens, named `role="img"` surface, associated instructions/error, design-system Clear button, pointer/pen support, corrected coordinate scaling) with the **resize/orientation divergence defect fixed** | Card, form primitives, Badge, Button, layout | Medium | High | Forms, cards, feedback | **Complete (GO)** 2026-07-27 | Verified: 73 focused tests (24 `SignaturePad` contract freeze + 20 portal closeout + 10 hook + 14 portal + 5 pre-existing pad), 29 new Chromium / 28 Mobile Chrome E2E (pixel-level signing, resize/orientation invariant, full employed walkthrough, duplicate submit, axe on all six states, 1440/1024/412 px), existing PEV portal E2E, full suite/coverage, lint, typecheck, production build, callable-contract, `git diff --check` |
| Change review `/review-change/:token` | `ReviewChangePortal` now consumes `Card`, `Button`, `Input`, and `Stack`/tokens with one `<h1>`, `role="status"`/`role="alert"` states, and a tokenized feature-owned approve/reject/edit toggle group; load/validation/payload/callables unchanged | Card, Button, Input, layout | Medium | High | Forms, cards, feedback | Compatibility slice completed 2026-07-23 | Verified: 16 focused tests (token load/cancellation/errors, scalar/array/object/empty previews, no-pending/completed, action default/reject/edit/exclusivity/edit-hidden-for-nonscalar, exact approve/reject/edit payloads + order, submitting/disabled, success/error fallbacks, single h1, applicant-name non-disclosure, axe) + existing 3, full suite, coverage, callable-contract, Chromium/Mobile Chrome, 1440/1024/412 px, axe, overflow |
| Sandbox application | `SandboxApplyHandler` renders `PublicApplyHandler sandbox` verbatim, so it inherited the whole migration; `SandboxActionPanel` now consumes `Card`, `Button`, `FormField`, `Select` and `StatusMedallion` with a `<main>`/single-`<h1>`; the Magic Fill control stays a documented raw-button exception so the sandbox reads as a test surface | Production primitives with feature-owned sandbox controls | Low | Medium | Public-application migration | **Migrated (GO)** 2026-07-27 | Verified: the sandbox banner/Magic Fill render only when `sandbox` is true (unit-asserted), `listSandboxTenantCompanies` / `deleteSandboxApplication` / `transferSandboxApplication` payloads and the `/sandbox/transfer-success` navigation state unchanged, Super Admin gate unchanged, error announced, transfer select labelled |
| Sandbox transfer success | `SandboxTransferSuccess` now consumes `Card`, `Button`, `Badge`, `Stack`, and `Inline` with a single `<h1>`/`<main>` | Card, Button, Badge, layout primitives | Low | Low | Feedback, controls | Compatibility slice completed 2026-07-23 | Verified: name/id/final fallback, `New Application` status, Super Admin + Home navigation, single h1, keyboard actions, Chromium/Mobile Chrome, 1440/1024/412 px, axe, overflow |
| Driver dossier modal | `DriverProfileModal` shell, `DossierHeader`, `DossierSidebar`, `DossierContent`, the read-only `ApplicationTab` summary and `DocumentsTab` now consume the shared accessible `Modal`, `Button`, `IconButton`, `Select`, `Badge`, `Card` and `--ds-*` tokens; the section navigation is a feature-owned WAI-ARIA tablist; `useCompactViewport` keeps `aria-orientation` in step with the layout | Dialog family, feature-owned Tabs, Card, Field display, PageState | High | High | Dialog, controls, feedback, layout | **Foundation migrated (GO)** 2026-07-27 — shell, header, navigation, read-only application summary and documents complete; DQ, PEV/VOE, Activity and Notes bodies deliberately **not** migrated and remain reachable and unchanged inside the shell | Verified: 136 focused unit tests, 19 new Chromium + Mobile Chrome E2E checks (focus containment/restoration, Arrow/Home/End walkthrough, nested delete + preview dialogs, page states, 1440/1024/412 px clipping, real-browser axe), existing candidate-table/a11y/access-control E2E, full suite/coverage, lint, typecheck, production build, `git diff --check` |
| PEV/VOE workflows | **Initiation and tracking migrated**: `PEVTab` (summary `MetricCard`s, employer list, status `Badge`s, Initiate/View Result/Copy Link/Upload Result/History/Resend actions, paywall and no-employer states, verification-history dialog on the shared accessible `Modal`), `PEVRequestModal` (shared `Modal`, native `ChoiceGroup`/`Radio` delivery choice, `FormField`/`Input` contact fields, `Button`/`IconButton`), `FmcsaCarrierPicker` and the shared `PaywallMessage`. `VOEPreviewModal`'s **chrome** is migrated too (shared accessible `Modal`, header, recipient/applicant summary, Print/Download PDF/Edit Request/Transmit actions, and the loading, export-failure and missing-data states); its **generated legal document is deliberately left untokenised** and guarded by an export-parity test. Its **Print pipeline was repaired 2026-07-27** — it no longer routes trusted document structure through the user-content sanitiser, so printing preserves the layout, borders and applicant signature; covered by a real-browser E2E gate. The **external employer response portal** (`/verify/:token`) was **closed out 2026-07-27** — see the verification-portal closeout log. With it, every PEV/VOE surface is migrated. | Dialog, Field, Button, Status, document layout | High | Very high | Dialog, forms, status | **Complete (GO)** 2026-07-27 — initiation, tracking, VOE preview chrome, VOE Print repair and the respondent portal | Verified: 107 focused unit tests (34 new PEVTab contract freezes covering the callable payload, activity log, Firestore write, Storage path, signed-URL and clipboard behaviour; 13 PEVTab a11y/structure; 22 request-modal dialog/radio/validation; 38 pre-existing FMCSA/lookup/modal), real-axe checks on every PEV surface and state, real-browser measurement at 1440/1024/412 px, dossier + candidate-table + campaigns E2E regressions, full suite/coverage, lint, typecheck, production build, `git diff --check`. **Limitation:** the PEV tab is unreachable in Playwright under `VITE_E2E_TEST_MODE=1` — see the completion log |

### 5.2 Shared component-family inventory

| Family | Current implementation | Target | Priority | Risk | Dependencies | Status | Verification needed |
|---|---|---|---|---|---|---|---|
| Tokens | `shared/styles/designTokens.css`, direct Tailwind utilities | `design-system/tokens` semantic contract + temporary compatibility | Critical | Medium | Owner visual approval | Foundation complete; adoption not started | Contrast, build, desktop/mobile consumer visuals, legacy parity |
| Buttons | Button/IconButton primitives adopted by the Company shell; legacy raw buttons remain elsewhere | Button + IconButton | Critical | Medium | Tokens | In progress — primitive and Company consumer verified; catalog/ratchet remain | Variants/states, names, focus, touch, remaining consumers, approved visual baselines |
| Inputs | Shared InputField plus 155 raw inputs | Field/Input and compatibility adapter | Critical | High | Tokens, controls | Not started | Existing callbacks/files/errors/autofill/mobile keyboard |
| Select/textarea | 60 selects, 23 textareas, local styling | Select/Textarea under Field | High | Medium | Forms | Not started | Labels/errors/disabled/long content/mobile |
| Radio/checkbox | Approved native-first `Checkbox`, `Radio` and `ChoiceGroup` primitives (2026-07-27); the shared `RadioGroup` is now a thin compatibility adapter over them and the public application, agreements and custom questions all consume them | Native-first Radio/Checkbox groups | High | High | Forms, table | In progress — primitive implemented and proven by the public driver application; `ToggleSwitch` (ARIA switch) and indeterminate selection remain feature-owned/open | Verified: 12 primitive tests (label/description/error association, native change events, label-click, group legend naming, `requiredMark` split, orientation, input validation), 8 adapter tests including the duplicate-id regression, real-browser axe on every application step, native arrow-key selection asserted in `e2e/public-application-responsive.spec.cjs`. Still needed: indeterminate state, Switch, catalog examples, durable baselines |
| Cards | Card/MetricCard primitives adopted by Company dashboard; compatibility StatCard retained | Card/Section/Metric | High | Low | Tokens, layouts | In progress — Company dashboard verified; catalog and remaining consumers open | Spacing/elevation/heading/actions/mobile/approved visual baselines |
| Dialogs | Every active overlay in the repository now goes through the shared accessible `Modal`. The true-100% closeout migrated the last five hand-built `fixed inset-0` overlays: `QuickLeadModal`, `LeadAssignmentModal`, `CompanyChooserModal`, `FeatureDeactivationWarning` and `CallOutcomeModalUI`. `Modal`'s own default overlay/panel classes were also moved off raw `bg-slate-900/60` / `bg-white rounded-2xl shadow-2xl` onto `--ds-*` tokens, so callers that do not override them no longer inherit an unapproved surface | Dialog/AlertDialog family | Critical | High | Controls, layouts | **Complete (GO)** 2026-07-28 — no active hand-built dialog remains | Verified: a repository-wide `fixed inset-0` scan returns only `Modal` itself and callers passing it an `overlayClassName`; focus move/trap/restore, Escape and named close controls asserted per dialog in the focused suites; `OnboardingTour`'s `pointer-events-none` spotlight is not a dialog and is correctly excluded |
| Status badges | Generic Badge adopted by Company leaderboard; StatusBadge/statusStyles/local maps remain | Generic Badge/StatusIndicator + feature adapters | High | Medium | Tokens | In progress — generic Badge verified; StatusIndicator and remaining adapters open | Vocabulary, contrast, icons, non-color communication |
| Loading | SafeHaulLoader, GlobalLoadingState, skeletons, local spinners; approved determinate `ProgressBar` added 2026-07-27 | Spinner/Skeleton/LoadingState/Progress | Medium | Medium | Tokens, feedback | In progress — `ProgressBar` implemented and consumed by the public application wizard and its upload fields; Spinner/Skeleton/LoadingState not started | ProgressBar verified (6 unit tests, real-browser `aria-valuenow`, reduced-motion transition). Still needed for the rest: live regions, reduced motion, async transition visuals |
| Empty/error | Error boundaries and many table-local messages | EmptyState/ErrorState/InlineAlert/PageState | High | Medium | Controls, cards | Not started | Recovery actions, announcements, long text, mobile |
| Toast/notification | `ToastProvider`, `NotificationBell` and `NotificationItem` all migrated to `--ds-*` tokens and approved primitives. The two 2026-07-27 dismiss-control fixes (missing accessible name — axe `button-name` **critical**; 16×16 px hit area) are superseded by the approved `IconButton`, which owns both | Retain behavior; normalize visuals through tokens/components | Medium | High | Feedback, controls | **Complete (GO)** 2026-07-28 | Verified: 15 `ToastProvider` contract tests (four `show*` helpers and their severity values, the 4000 ms auto-dismiss, per-toast manual dismissal, stacking order, the frozen dismiss-control name, a no-legacy-palette assertion, and jsdom axe with all four severities plus a 300-character unbroken message). Defects fixed beyond the palette: severity was **inaudible** (the icon was `aria-hidden` and the message never says what kind of notification it is — now announced); the stack could push a long message off-screen at 412 px (now inset from both edges, width-capped and wrapping); an unbounded stack could exceed the viewport height. In `NotificationItem`: the row was a click-only `<li>` (the title is now a real button, so opening a notification has a keyboard path at all), both actions were hover-only *and* `title`-named, `text-[10px]` twice, `text-gray-400` at 2.56:1, and unread was a coloured dot with no text equivalent. In `NotificationBell`: the bell had **no accessible name**, the tab strip was colour-only with no `role="tab"`/`aria-selected`/arrow keys (now a real WAI-ARIA tab interface with roving focus), `animate-pulse` ran indefinitely with no reduced-motion guard, and `text-[10px]` on the count badge |
| Layout | WorkspaceFrame and page primitives adopted by the feature-owned Company shell/dashboard; the public `Stepper` wizard frame migrated 2026-07-27 (approved `ProgressBar`, `--ds-*` tokens, single `<h1>` step title, focus moved to the new step heading, one deterministic scroll owner) | Business-neutral layouts/progress; feature owns orchestration | High | Very high | Controls, forms, feedback | In progress — Company shell/dashboard 2026-07-23; public application Stepper 2026-07-27; driver-dossier shell 2026-07-27 (full-screen sheet below `sm`, three-pane from `sm`, wrapping header, `useCompactViewport` keeping `aria-orientation` in step with the CSS) | Remaining: route/workflow parity for the Super Admin shell and the PEV surfaces |
| Icons | Lucide + branded SVGs + icon-only buttons | Icon contract and accessible IconButton | Medium | Medium | Controls | Not started | Sizes/strokes/names, branded exceptions |

### 5.3 Raw table migration inventory

All table migrations depend on the Phase 7 table schema and primitives. No row
may be marked complete until header-to-cell alignment is visually reviewed with
short, long, empty, loading, error, and representative numeric/date data.

| Current table | Target | Priority | Risk | Additional dependencies | Status | Verification needed |
|---|---|---|---|---|---|---|
| `shared/components/table/ModernDriverTable.jsx` | Fully tokenised native table + `Checkbox`/`IconButton`, with **a recorded approved compatibility exception against `DataTable`** (documented in the component itself): it combines consumer-owned `render()` columns with per-cell `stopPropagation`, row activation, per-row selection *and* a footer pager, plus a caller `getRowClassName` with no `getRowTone` equivalent. `DataTable` is a display-table contract and that combination is unproven on the highest-row-count surface in the product. **It has exactly one consumer left** (`UnifiedDriverList`) — the company candidate list moved to the approved `DataTable` in the 2026-07-23 pilot | Critical | High | Selection, pagination, Badge | **Migrated (GO)** 2026-07-28 with an approved, evidenced exception | Verified: 33 new contract tests asserting **everything `DataTable` would have supplied**, so no debt hides behind the exception — table accessible name via `<caption>`, named focusable scroll region, `columnheader` roles, `aria-selected` rows, native checkboxes replacing the `aria-pressed` icon-button hack, record-specific selection names via the new `getRowLabel`, Enter/Space row activation with the `event.target !== event.currentTarget` guard, an announced loading state, a named pager, a no-legacy-palette assertion, and jsdom axe across six states. Plus the Unified Driver DB real-browser axe run on Chromium and Mobile Chrome |
| `campaigns/components/CampaignResultsTable.jsx` | Card + Input + Badge + semantic DS-token table (DataTable not a fit — see Phase 13 note) | High | Medium | Status adapter | Migrated 2026-07-24 (GO) | 10px/contrast headers fixed, labelled search, text+icon status, readable errors, preserved max-height scroll + sticky header |
| `campaigns/components/DetailedReportModal.jsx` | Shared accessible `Modal` + `Button`/`IconButton`/`Badge` + semantic DS-token table in a labelled keyboard-focusable scroll region (DataTable not adopted — same primitive-fit exception as the results table) | Medium | High | Dialog, status | Migrated 2026-07-24 (GO) | Focus trap/Escape/restore added, backdrop preserved, text+badge status, wrapping errors, internal scroll with no doc overflow, 17 unit + Chromium/Mobile Chrome + dialog-scoped axe |
| `company-admin/components/InlineLeaderboard.jsx` | Numeric compact DataTable | High | Medium | Metric formatting | Completed 2026-07-23 | Verified: representative/empty/error/retry unit states, header/cell end alignment under 1 px, compact density, long names, labeled mobile overflow, desktop/mobile axe |
| `settings/number-assignment/AssignmentTable.jsx` | Approved native-table pattern + `Select`/`Badge` (DataTable not adopted — every row carries an editable control, the same recorded exception as `FeaturesView`) | High | High | Select/Checkbox | **Migrated (GO)** 2026-07-28 by the Company Settings closeout; this row read `Not started` until the true-100% closeout reconciled it | **Stale row corrected 2026-07-28.** The file was verified at that date to contain 30 `ds-*` references, zero legacy palette matches and zero raw controls; it is covered by the pre-existing frozen 15-case SMS safety suite plus the `NumberAssignmentManager` tests |
| `settings/questions/StandardQuestionsConfig.jsx` | `Card` + accessible `ToggleSwitch` (ARIA switch) rows with unique "Require X"/"Hide X" names | Medium | High | Checkbox/Switch | **Migrated (GO)** 2026-07-24 by the Company Profile questions slice; this row read `Not started` until the true-100% closeout reconciled it | **Stale row corrected 2026-07-28.** Verified at that date: 29 `ds-*` references, zero legacy palette matches, zero raw controls. Covered by the 47 focused application-questions tests. It is **not** dead code — it is reachable from Company Settings → Application Questions |
| `signing/components/EnvelopeHistory.jsx` | Approved `DataTable` (adopted — no max-height/sticky-header constraint and no exact loading string to preserve, so the results-table primitive-fit exception does not apply here) + `Badge`/`Button` with a feature-owned status adapter | Medium | High | Status, IconButton | Migrated 2026-07-24 (GO) | 5-column contract, row header + accessible per-row action names, text+icon status (never colour alone), announced loading/empty/error, labelled keyboard-focusable scroll region, 46 unit + 10 Chromium/Mobile Chrome E2E, 1440/1024/412 px, scoped axe |
| `super-admin/components/CompaniesView.jsx` | Approved native-table pattern + `Card`/`Badge`/`Button`/`IconButton`/`Input`/`Select` (DataTable not adopted — per-row interactive controls plus a row-level click target sit outside its display-table contract; same exception as `CampaignResultsTable`) | High | High | Badge, actions | **Migrated 2026-07-28 (GO)** | Verified: 20 unit tests incl. the stale-enrichment regression guard, real-browser axe on Chromium + Mobile Chrome, named row actions, keyboard-reachable company name, accessible activate/deactivate dialog, 1440/1024/412 px |
| `super-admin/components/FeaturesView.jsx` | Approved native-table matrix + `Checkbox`/`IconButton`/`Modal` (DataTable not adopted — every cell is an editable control) | High | Very high | Switch/Checkbox, responsive matrix | **Migrated 2026-07-28 (GO)** | Verified: 18 unit tests, toggles now named + stateful (were unnamed bare buttons), sticky first column, both overlays on the shared `Modal`, named focusable scroll region, real-browser axe both lanes |
| `super-admin/integrations/LineManager.jsx` | Approved native-table pattern + `Card`/`Badge`/`Button`/`IconButton` in a named focusable scroll region (DataTable not adopted — per-row destructive action, same recorded exception) | Medium | High | Badge, actions | **Migrated (GO)** 2026-07-28 by the SMS integration group; this row read `Not started` until the true-100% closeout reconciled it | **Stale row corrected 2026-07-28.** Covered by `LineManager.contract.test.jsx` (11 contract + remove-flow + 2 jsdom axe): phone/label/status/default alignment, text+icon status never colour alone, record-specific remove name, keyboard-reachable scroll region |
| `super-admin/modals/ViewCompanyAppsModal.jsx` | Shared accessible `Modal` + native table + `Badge` (DataTable unproven inside a dialog with its own scroll container and sticky header) | Medium | High | Dialog, status | **Migrated 2026-07-28 (GO)** | Verified in the Super Admin modals suite: focus containment/restoration, Escape, named close, `Badge` status (was colour-only), header contrast corrected |
| `super-admin/components/StatsBackfillPanel.jsx` | `Card`/`FormField`/`Button` + compact numeric native table | Medium | High | Feedback/progress | **Migrated 2026-07-28 (GO)** | Verified: 16 unit tests incl. the previously-absent confirmation on the platform-wide writing run, announced error/result/in-flight states, real-browser axe |
| `super-admin/components/UsersView.jsx` | Approved native-table pattern + `Badge`/`IconButton` | High | High | Badge/actions | **Migrated 2026-07-28 (GO)** | Verified: role/membership mapping frozen, named row actions, announced loading/error, named focusable scroll region, real-browser axe both lanes |
| `super-admin/views/AnalyticsView.jsx` | `Card`/`MetricCard`/`Badge` + WAI-ARIA tab interface + native data tables; SVG chart geometry stays feature-owned | High | High | Charts/number/date format | **Migrated 2026-07-28 (GO)** | Verified: 13 unit tests incl. the frozen CSV export contract, tabs/date-range no longer colour-only, chart given `role="img"` + hidden data table, header contrast corrected |
| `shared/components/admin/BulkUploadLayout.jsx` | Approved `DataTable` preview + shared `Modal`, `ProgressBar`, `StatusMedallion`, `ChoiceGroup`/`Radio`/`Checkbox`, `FormField`/`Input`, `PageHeader` | Medium | High | Upload/feedback | **Migrated (GO)** 2026-07-27 by the Import-leads campaign; this row read `Not started` while section 5.1's Import-leads row read `Complete` — **the exact contradiction the true-100% closeout was asked to resolve** | **Stale row corrected 2026-07-28.** Verified at that date: 77 `ds-*` references, zero legacy palette matches, and exactly two raw controls — both the file input, which is the already-recorded no-approved-file-input-contract exception. Covered by 57 focused `BulkUploadLayout` tests plus the large-preview row cap and bounded-scroll E2E. Re-verified live in the true-100% closeout: `e2e/lead-intake.spec.cjs` **49 passed** on Chromium including the real Web Worker CSV parse |

### 5.4 Company settings/profile form migration inventory

This inventory records the 2026-07-23 bounded audit. Counts describe raw native
controls in the named presentation files; nested components are listed in their
own rows. Data and workflow ownership stays in the feature.

| Screen / slice | Current controls and presentation | Data / behavior coupling | Main risks | Priority / risk | Status | Verification needed |
|---|---|---|---|---|---|---|
| Company Settings shell | Approved `SectionNavigation`, semantic shell tokens, feature-owned grouped item definitions, existing local success toast and billing card | Admin role redirect, feature-flag visibility, tab state, Manage Team dialog remain feature-owned | Live success announcement remains for a later feedback slice | High / Medium | Shell/navigation compatibility slice completed 2026-07-23 | 9 focused unit tests, full suite, Chromium/Mobile Chrome, 1440/1024/412 px, keyboard/focus/current state, admin redirect, feature flag, axe, overflow passed |
| Company Profile — info | Approved `FormField`, `Input`, `FieldDisplay`, `FormSection`, `Card`, and `Button` replace local information-field/card/action styling | `saveCompanySettings`, nested contact/address/legal/application payload remain feature-owned and unchanged | Branding upload and application questions remain separate higher-risk slices | High / High | Compatibility slice completed 2026-07-23 | 17 focused tests, full suite, Chromium/Mobile Chrome, 1440/1024/412 px, payload parity, keyboard/focus, labels, axe, overflow passed |
| Company Profile — branding | Approved `Button` + `FieldMessage` and a labelled, keyboard-triggered file input replace the local `<label>`-wrapped hidden input and raw preview in `BrandingSection`; preview/fallback tokenized | `uploadCompanyLogo` Storage path `company_assets/{companyId}/logo.{ext}` and the `companies/{companyId}.companyLogoUrl` Firestore field via `saveCompanySettings` remain feature-owned and unchanged | Keyboard trigger, no nesting, alt text, uploading announcement, focus return, no client size/type validation (preserved) | High / High | Compatibility slice completed 2026-07-23 | 18 focused tests (9 UI/a11y, 5 upload integration, 4 Storage contract), full suite, coverage, Chromium/Mobile Chrome, 1440/1024/412 px, exact Storage/Firestore contracts, keyboard/focus, axe, overflow passed |
| Company Profile — questions | Standard config uses accessible `ToggleSwitch` (ARIA switch) rows in a `Card` with unique "Require X"/"Hide X" names; custom builder/editor use `Card`/`FormField`/`Input`/`Select`/`Button`/`IconButton`/`Badge` with labelled fields, named delete/option-remove/reorder controls, and a keyboard move-up/down alongside preserved native drag | `applicationConfig` `{required,hidden}` shape, `customQuestions` item fields, `crypto.randomUUID()`, DOT-delete `alert()`, inverse Lock/Protect mappings, and the `saveCompanySettings` pass-through remain feature-owned and unchanged | Switch semantics, required/hidden exclusivity, DOT-required protections, destructive actions | High / Very high | Migrated (GO) 2026-07-24 | 47 focused tests (standard defaults/exclusivity/payload, every custom type, UUID/defaults, label/help/options edit, type-change option init, add/remove, preview/edit, reorder, DOT delete + exact alert, compliance mappings), full suite/coverage, public-app regression, Chromium/Mobile Chrome, 1440/1024/412 px, axe, overflow, git diff --check passed |
| Team & Users | Add New User form now uses `FormSection`/`FormField`/`Input`/`Select`/`Button`; `ManageTeamModal` moved to the shared accessible `Modal` with `Card`/`Button`/`IconButton` and labelled goal inputs; `CompanySettings` permission gate and backend `hrAdmin.js` unchanged | `createPortalUser`/`deletePortalUser` callables, membership `onSnapshot` subscription, user/goal Firestore reads, `setDoc` goal-write, tracking-link construction, and clipboard/toast remain feature-owned and unchanged | Native-required create-user validation, password never logged/stored (`autocomplete=new-password`), admin gate, live subscription cleanup, goal `value||default` compatibility, fire-and-forget clipboard, destructive delete | High / Very high | Compatibility slice completed 2026-07-23 (both surfaces) | 25 focused tests (9 Add-User, 16 Manage-Team) + shell suite, full suite, coverage, callable-contract, Chromium/Mobile Chrome, 1440/1024/412 px, exact create/delete/goal/link contracts, permission gate, dialog name/close/Escape/backdrop/focus-restore, axe, overflow passed |
| Personal Profile in Company Settings | `FormField`, `Input`, `FormSection`, `Card`, and `Button` now replace local form/card/button styling | Direct user/recruiter-link Firestore reads/writes and clipboard copy remain feature-owned and unchanged | Broader settings forms remain locally styled | High / Low | First compatibility slice completed 2026-07-23 | 4 feature tests, 4 primitive tests, full suite, Chromium/Mobile Chrome, keyboard/focus, 1440/1024/412 px, axe passed |
| Email Settings | Approved `FormSection`, `FormField`, `Input`, `Textarea`, `Button`, `Badge`, `Card`, and `FieldMessage` replace the local status banner, SMTP fields, test/save buttons, and setup-guide chrome (provider instructions stay feature-owned) | `getEmailSettingsMeta`/`testEmailConnection`/`saveEmailSettings` callables, sanitized metadata load, and password-isolation rules remain feature-owned and unchanged | Secret/autofill handling, required validation, test/save distinction, long errors | High / Very high | Compatibility slice completed 2026-07-23 | 24 focused render + 12 existing logic tests, full suite, Chromium/Mobile Chrome, 1440/1024/412 px, secret-payload contract, label association, guide disclosure, axe, overflow passed |
| SMS / number assignment | Default-line select + editable recruiter matrix (`<select>` per row), verify buttons, diagnostic modal, save; renders alongside the shared secret-entry `LineManager` (out of scope) | `useLineAssignments` owns the `sms_provider` listener, roster join, one-time token backfill, `verifyLineConnection`, and token-based `saveSmsLineAssignments`; correctness depends on server-side token→phone resolution | Editable matrix (not a display table), DLP token redaction, markup-coupled 15-case safety suite, color-only status, 9/10 px status text, secret-entry entanglement | High / Very high | Deep-audited 2026-07-23; **not migrated (NO-GO)** — blocked on the editable-matrix responsive/interaction owner decision and unproven DataTable-for-form-controls fit | Owner decision on editable-matrix strategy; then per-row select labels, token-redaction save contract, verify/backfill/diagnostic callables, status text+tone, DataTable-with-controls parity, keyboard/mobile |
| Automated SMS | Approved `FormSection`, `FormField`, `Textarea`, `Button`, and `FieldMessage` replace the local heading/labels/textareas/save styling for three SMS-template textareas (`templateContactAttempt1/2/3`) and one save action | Three SMS-template textareas and one save action backed by a single Firestore document `companies/{companyId}/settings/automated_sms`; read/write remain feature-owned and unchanged | Template preservation, loading/error state, textarea description/limits | Medium / High | Compatibility slice completed 2026-07-23 | 12 focused contract tests, full suite, Chromium/Mobile Chrome, 1440/1024/412 px, label association, loading announce, save states, axe, overflow passed |
| Integrations | Facebook Lead Ads connection card: dynamic FB SDK load, `FB.login` popup, browser Graph API page lookup + first-page auto-select, `connectFacebookPage` callable; local-only Connected state | `connectFacebookPage` callable, `functions/integrations/facebook.js` token exchange/`integrations_index` write/webhook, feature-flag visibility | External SDK state, sensitive short-lived token, **tenant binding `companyId = request.auth.uid`**, non-persistent Connected state, no disconnect/reconnect | Medium / Very high | Deep-audited 2026-07-23; **not migrated (NO-GO)** — blocked on a tenant-binding correctness/security defect (`request.auth.uid` used as the company id, incompatible with the auto-id + membership multi-tenant model); presentation withheld so the UI does not imply the workflow is production-ready | Separate integration-correctness/security project to fix tenant binding; then SDK-load/login-scope/graph/first-page/callable mocks, token-safety, feature-flag/permission, connected-state, keyboard/mobile |
| Billing | Approved `FormSection`, `FieldDisplay`, `Badge`, and `FieldMessage` replace the local heading/card/plan/support styling | Plan value display only; `planType` read from the loaded profile, unchanged | Empty/long plan content and support messaging | Low / Low | Compatibility slice completed 2026-07-23 | 7 focused tests, full suite, Chromium/Mobile Chrome, 1440/1024/412 px, labelled plan/badge status, support copy, axe, overflow passed |
| `/company/profile` account profile/security | Approved `FormSection`, `FormField`, `Input`, `Button`, `FieldDisplay`, `FieldMessage`, `PageHeader`, `Stack` replace the local form/card/button styling; avatar upload moved to the keyboard-accessible `ProfileAvatarField` (visually hidden labelled input, `role="status"`, focus return, no nested interactives); autocomplete added | Firebase Auth profile/email/password, reauthentication, Storage `avatars/{uid}/{file.name}` upload, Firestore user writes/query all remain feature-owned and byte-for-byte unchanged | Passwords kept in transient state only; validation/error association; upload and reauth regressions | High / Very high | **Migrated (GO)** 2026-07-24 | 38 focused tests (load prefs/fallback, avatar type/size + exact Storage sequence, profile validation/username query + permission skip, email reauth/errors/cancel, password branches/reset, password non-exposure, autocomplete, keyboard avatar, axe), full suite/coverage, route manifest, Chromium/Mobile Chrome, 1440/1024/412 px, git diff --check passed; backend/callable/rules not applicable (no backend change) |

### 5.5 Remaining active debt (repository-wide, 2026-07-28)

This section is the honest counterweight to "19 of 19" in section 5.1. The
true-100% closeout campaign scanned **all** active production code, not just the
19 screen rows, and everything it found was fixed **except the following**. This
list is exhaustive as of the scan date; keep it that way.

#### CLOSED 2026-07-28 — all blocking browser dialogs removed

The six `window.confirm` guards recorded here are gone, **and so are three bare
`confirm(...)` calls and three live `alert()` calls that the original
`window.confirm`-only scan had missed.** See the final-six-confirmations completion
log in section 6 for the full list and evidence.

A permanent ratchet now prevents regression:
`src/tests/noBlockingBrowserDialogs.test.js` walks every non-test file under
`src/`, strips comments and string literals, and fails on `confirm(` / `alert(`
with or without a `window.` prefix. It is proven to catch a real call, not just
pass vacuously. **This is what makes the repository-wide claim checkable rather
than narrative** — the earlier scans missed the bare form three separate times.

**Nothing is open.**

#### Approved, evidenced exceptions (not debt)

- `ModernDriverTable` does not adopt `DataTable` — see its 5.3 row and the
  rationale in the component. 33 tests prove no a11y debt hides behind it.
- The `CallOutcomeModalUI` outcome grid stays a `role="group"` of raw
  `<button aria-pressed>` cards: no approved Segmented/ToggleGroup or
  SelectableCard primitive exists (same exception as the dossier summary toggle
  and the PEV FMCSA rows). All its colours are now approved tokens.
- File inputs in `DQFileTab`, `BulkUploadLayout`, the public application and the
  PEV result upload: no approved file-input contract yet.
- Styled `<a>` navigations (`tel:`, `mailto:`, download, CDL photos, the DQ file
  download): no Link/ButtonLink primitive yet. All now carry real accessible
  names — `DQFileTab`'s download was `title`-only before this campaign.
- `VOEPreviewModal`'s generated 49 CFR §391.23 document keeps its raw palette and
  its sub-12px type: it is rasterised by html2canvas into a bare print window with
  no `--ds-*` custom properties, so a token would resolve to nothing. Enforced in
  both directions by `VOEPreviewModal.export.test.jsx`.
- `DeviceMockup`'s phone status-bar time keeps `text-[10px]` — decorative
  illustration of a real device, not interface text.

#### Retired / deleted

- `company-admin/components/application/ApplicationUI.jsx` — **deleted**. It held
  a local `Card` reimplementation (`Section`) plus `InfoGrid`/`InfoItem`, which had
  an unlabelled input, an unlabelled select and `text-gray-300` "N/A" text. Its
  only consumer was `DQFileTab`'s `Section` import; `InfoGrid`/`InfoItem` had no
  consumers at all. Proven by import scan before removal.

#### Known intermittent test (not a code defect)

`DriverProfileModal.behavior.test.jsx > leaves focus on a real element after a
successful delete` failed twice under heavy full-suite CPU contention and passed
in every isolated run and in the final full-suite run. It asserts focus after two
`Modal`s unmount in the same commit, which is inherently ordering-sensitive. It
was **not** introduced by this campaign (the pre-change baseline full suite is
green, and so is the post-change one). Left alone rather than papered over.

`src/tests/playwrightConfig.test.js` **was** hardened: its first case pays a cold
`require('@playwright/test')` — 330 ms idle, measured at 12.9 s under contention,
past the 5 s default. It asserts config *shape* and has no timing behaviour, so
the file now carries an explicit 60 s budget with that reasoning recorded inline.

---

## 6. Verification matrix

Apply checks proportionally, but never claim an unrun check:

| Change type | Minimum required checks |
|---|---|
| Documentation only | Markdown/link review, diff inspection |
| Tokens/Tailwind | Token tests, contrast tests, build, lint, generated CSS/diff review; consumer visual/mobile review when used |
| Primitive component | Unit/interaction, axe, build, lint, desktop and mobile visual, keyboard |
| Table | Unit/interaction, axe, desktop/mobile Playwright, alignment screenshots, data extremes, feature behavior |
| Dialog/form | Unit/interaction, axe, keyboard/focus, desktop/mobile visual, feature save/cancel/error behavior |
| Feature migration | Existing feature tests, relevant backend contract tests if touched, desktop/mobile E2E, visual regression, axe |
| Rules/backend (normally out of scope) | Explicit approval, backend tests, rules emulator, contract tests, security review |

### Foundation-pass completion log

- Date: 2026-07-23
- Baseline: `9c56feb6463fb6e1a2291449ab982e865be9ce13`
- Focused design-system tests: 2 files passed, 14 tests passed.
- Full frontend unit tests: 71 files passed, 486 tests passed; 2 rule-test
  files / 48 emulator-dependent tests skipped by their existing environment
  guard. An initial resource-contended run timed out in one existing
  Playwright-config test before its assertion; that file then passed 4/4 alone
  and the complete suite passed when rerun serially.
- CI-equivalent frontend coverage gate: passed (`vitest run --coverage`).
- Frontend lint: passed with 0 errors and 178 pre-existing warnings.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,610 modules. Existing warnings
  remain for stale Browserslist data and chunks over 500 kB.
- Backend tests: not applicable; no backend file changed.
- Firebase rules tests: not applicable; no rules/data/backend file changed.
- Playwright desktop/mobile: not required for the non-rendering scaffold and
  unused token contract; the first consumer migration must run both.
- Visual review: generated token/Tailwind contract and CSS cascade review only;
  no feature consumes the new utilities, so rendered screens are unchanged by
  design.
- Accessibility: 11 normal-text contrast pairs plus minimum type-size contract
  passed; architecture boundary passed.
- Compiled CSS review: both the new `--ds-color-canvas` contract and the legacy
  `--bg-page` compatibility token are present.
- Diff review: `git diff --check` passed; changed-file and focused source diffs
  contained no unrelated application/backend changes.
- Commit/PR: checkpoint `d993804`.

### Company candidate-list/DataTable pilot completion log

- Date: 2026-07-23.
- Baseline: `9c56feb6463fb6e1a2291449ab982e865be9ce13`.
- Focused DataTable tests: 2 files passed, 15 tests passed.
- Full frontend coverage gate: 73 files passed, 2 files skipped; 501 tests
  passed and 48 emulator-dependent rules tests skipped by their existing
  environment guard. Coverage was 25.18% statements, 22.17% branches, 23.24%
  functions, and 25.72% lines.
- Frontend and backend lint: passed. Frontend reported 0 errors and 176
  existing warnings; backend lint reported no error.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,615 modules. Existing warnings
  remain for stale Browserslist data and chunks over 500 kB.
- Candidate Playwright, Chromium + Mobile Chrome: 8 passed, 2 intentionally
  skipped because each alignment/mobile-presentation assertion only applies to
  its matching viewport.
- Existing candidate search/filter Playwright, Chromium + Mobile Chrome:
  8 passed.
- Functional coverage: search, filters, latest sorting, scope, page-scoped
  selection, mixed selection, filter-reset selection, assignment count, call
  action isolation, keyboard dossier opening, and row dossier opening passed.
- Accessibility: native table semantics, caption/header scopes, named
  checkboxes and actions, Enter/Space row activation, nested-control isolation,
  focus visibility, dialog naming, and scoped real-browser axe checks passed;
  axe reported no serious or critical violations.
- Desktop visual review: representative headers and cells used the same
  contract attributes; measured center alignment variance was under 1 px.
  Column widths, comfortable 72 px rows, 48 px headers, spacing, selected state,
  and action reveal were reviewed.
- Mobile visual review: DataTable uses a labeled, keyboard-focusable horizontal
  scroll region, keeps actions visible, displays an overflow hint, and preserves
  dossier access. At 412 px the existing Company sidebar remains 255 px wide,
  leaving only 100 px for content; this pre-existing shell defect is explicitly
  assigned to the next migration phase and is not hidden inside the table.
- Loading, empty, and error states: component unit tests cover all three,
  including the stale-row inline-error case.
- Backend tests and Firebase rules tests: not applicable; no backend, rules,
  database, integration, or Firebase behavior changed.
- Diff review: final whitespace and changed-file review required no unrelated
  application/backend changes.
- Commit/PR: checkpoint `d993804`.

### Company workspace shell/dashboard completion log

- Date: 2026-07-23.
- Baseline: `9c56feb6463fb6e1a2291449ab982e865be9ce13`.
- Previous-phase audit: candidate DataTable contract and consumer were
  independently rechecked before this phase; 2 files / 15 focused tests and
  16 candidate/filter checks passed with 2 intentional viewport-specific
  skips. The roadmap's contract-test note was corrected from 6 to the actual
  7 tests; no completed checkbox required reversal.
- Focused component/feature tests: 10 files passed, 36 tests passed. The final
  closed-navigation accessibility hardening test passed 2/2 after the focused
  aggregate.
- Full frontend coverage gate: 80 files passed, 2 files skipped; 518 tests
  passed and 48 emulator-dependent rules tests skipped by their existing
  environment guard. Coverage was 25.06% statements, 22.98% branches, 24.01%
  functions, and 25.53% lines.
- Frontend and backend lint: passed. Frontend reported 0 errors and 169
  existing warnings; backend lint reported no error.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,631 modules. Existing warnings
  remain for stale Browserslist data and the main chunk over 500 kB.
- Shell/dashboard Playwright, Chromium + Mobile Chrome: 5 passed, 3
  intentionally skipped because desktop/laptop/mobile assertions run only at
  matching viewports.
- Combined Company regression, Chromium + Mobile Chrome: 23 passed, 5
  intentional viewport-specific skips across shell/dashboard, access control,
  candidate DataTable, and application search/filter specifications.
- Functional coverage: dashboard metric navigation, sidebar group/route
  visibility, persisted desktop collapse, import route, unauthorized redirect,
  onboarding rendering, leaderboard refresh/retry, and the prior candidate
  filtering/selection/dossier workflows passed.
- Accessibility: Button/IconButton, Badge, Card/MetricCard, WorkspaceFrame,
  page layout, DataTable, Sidebar, and leaderboard unit/axe checks passed;
  Mobile Chrome verified focus entry, trap, Escape, focus return, route close,
  explicit touch close, and inert/hidden closed navigation. Scoped
  real-browser axe found no serious or critical violations.
- Desktop/laptop/mobile visual review: reviewed at 1440×900, 1024×768, and
  412×915. Header/content alignment, metric spacing/reflow, leaderboard column
  widths/end alignment, compact row density, long-name truncation, date-control
  wrapping, contained horizontal overflow, mobile hint, and full-width mobile
  content passed review. Laptop document width remained 1024 px at a 1024 px
  viewport; leaderboard overflow stayed inside its labeled scroll region.
- Loading/empty/error: leaderboard unit tests cover representative, empty, and
  error/retry states; DataTable retains its standardized loading/empty/error
  contract.
- Backend tests and Firebase rules tests: not applicable; no backend, rules,
  database, integration, or Firebase behavior changed.
- Visual regression: no durable screenshot baseline was claimed because the
  catalog/baseline owner decision remains open; manual rendered review and
  deterministic geometry assertions were completed instead.
- Diff review: `git diff --check` passed; added UI source was checked for new
  arbitrary colors and 9px/10px/11px text; the design-system architecture test
  passed; no unrelated backend or Firebase files changed.
- Commit/PR: checkpoint `d993804`.

### Company Settings Personal Profile compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: prior verified design-system, DataTable, Company
  shell/dashboard, and leaderboard work was reviewed, cleaned, and committed
  separately as `d993804` (`feat: establish design system and migrate company
  workspace`) before this slice began.
- Audit: all active Company Settings tabs plus `/company/profile` were
  inventoried for native controls, uploads, labels/messages, presentation/data
  coupling, direct Firebase/Auth/Storage/callable access, tests, mobile, and
  accessibility risk. The inventory is in section 5.4.
- Selected slice: Company Settings Personal Profile; it has one editable name,
  one read-only email, recruiting-link generation/copy, and no upload,
  password, role, integration, or question workflow.
- Focused tests: 2 files passed, 9 tests passed (4 form primitive and 5 feature
  compatibility tests).
- Full frontend coverage gate: 82 files passed, 2 files skipped; 527 tests
  passed and 48 emulator-dependent rules tests skipped by their existing
  environment guard. Coverage was 25.61% statements, 23.61% branches, 24.53%
  functions, and 26.13% lines.
- Frontend and backend lint: passed. Frontend reported 0 errors and 169
  existing warnings, including the pre-existing Personal Profile effect
  dependency warning; backend lint reported no error.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,634 modules. Existing warnings
  remain for stale Browserslist data and chunks over 500 kB.
- Chromium and Mobile Chrome regression: 5 passed, 3 intentionally skipped
  because desktop/laptop/mobile assertions run only in their matching
  viewport project.
- Behavior: existing name load/edit/name-only write, generated recruiter-link
  mapping and user-code write, clipboard URL, read-only email, and success and
  error feedback passed focused tests. No new validation or business rule was
  introduced.
- Accessibility: labels, descriptions, read-only state, native keyboard order,
  44 px controls, visible focus, and FormSection landmarks passed. Unit axe
  reported no violations; scoped real-browser axe reported no serious or
  critical violations in the migrated content.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  passed for alignment, spacing, wrapping, read-only contrast, control density,
  single-column mobile layout, and document/workspace overflow. The initial
  1024 px review found nested settings overflow; `min-w-0` on the existing
  flex content slot fixed it and a regression assertion now covers both client
  and scroll width.
- Visual regression: no durable screenshot baseline was claimed because the
  catalog/baseline ownership decision remains open; deterministic Chromium and
  Mobile Chrome geometry plus manual rendered review were completed instead.
- Backend/Firebase rules tests: not applicable; no backend, rules, database,
  storage, callable, integration, or Firebase contract changed.
- Diff review: `git diff --check` passed; generated `coverage/`, `dist/`, and
  `test-results/` artifacts were removed; no unrelated source or backend file
  is present.
- Commit/PR: checkpoint `0d22a0d`.

### Company Settings shell/navigation compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: Personal Profile and the native-event form foundation
  were committed separately as `0d22a0d` before this slice began.
- Selected slice: only the Company Settings shell, grouped navigation, and the
  directly observed Company Profile mobile tab-strip overflow were changed.
- Component contract: added business-neutral `SectionNavigation` with labelled
  navigation/groups, current-item and content-region semantics, 44 px targets,
  semantic token styling, disabled state, visible focus, Arrow Up/Down,
  Home/End focus movement, and stack/grid responsive modes. Settings labels,
  feature flags, permissions, tab state, and content remain feature-owned.
- Focused tests: 2 shell-focused files passed, 9 tests passed. The broader
  focused settings regression including Personal Profile passed 3 files /
  14 tests.
- Design-system tests: 11 files passed, 46 tests passed.
- Full frontend gate: 84 files passed, 2 files skipped; 536 tests passed and 48
  emulator-dependent rules tests skipped by their existing environment guard.
- Frontend lint: passed with 0 errors and 169 existing warnings. No warning was
  added by this slice.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,637 modules. Existing stale
  Browserslist-data and chunk-size warnings remain.
- Chromium and Mobile Chrome regression: the combined navigation and Personal
  Profile run passed 10 checks with 6 intentional viewport-specific skips; the
  navigation spec contributed 5 passes and 3 skips.
- Behavior: active-tab identifiers and `setActiveTab` ownership, Company
  Profile/Team/Email/SMS/Automated SMS/Integrations/Billing/Personal content,
  `callTracking` visibility, company-admin redirect, routes, Manage Team,
  success feedback, data loading, saves, uploads, permissions, and Firebase
  behavior are unchanged.
- Desktop/laptop/mobile: manual rendered review passed at 1440×900, 1024×768,
  and 412×915. Desktop is side-by-side; tablet is a four-group navigation grid;
  mobile is a two-column grid. All eight items remain reachable, long labels
  wrap, selection remains obvious, focus is visible, touch targets are at least
  44 px, and no document, workspace, shell, or nested horizontal scroller
  remains.
- Accessibility: unit axe reported no violations; scoped Chromium/Mobile Chrome
  axe reported no serious or critical violations. `aria-current="page"`,
  `aria-controls`, labelled groups, native buttons, logical Tab order, and
  Arrow/Home/End focus movement were verified.
- Visual regression: no durable screenshot baseline was claimed because the
  catalog/baseline ownership decision remains open; manual screenshots and
  deterministic geometry assertions were completed instead.
- Backend/Firebase rules tests: not applicable; no backend, rules, database,
  storage, callable, integration, or Firebase contract changed.
- Diff review: `git diff --check` passed; generated `playwright-report/` and
  `test-results/` artifacts were removed; no unrelated source or backend file
  was included.
- Commit/PR: checkpoint `334b5c6`.

### Company Profile information compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: the Company Settings shell/navigation implementation was
  committed as `334b5c6` and its roadmap evidence as `d4e308b` before this
  slice began.
- Selected slice: only the nine Company information values and the shared
  edit/cancel/save presentation were migrated. Branding upload and application
  questions were excluded and remain unchanged.
- Component contract: added business-neutral `FieldDisplay` for labelled
  read-only values and reused `Card`, `FormSection`, `FormField`, `Input`, and
  `Button`. The design system contains no Company, Firebase, permission, save,
  validation, or upload behavior.
- Focused tests: 3 files passed, 17 tests passed, including the exact save
  payload, all nine field keys/values, cancel behavior, error behavior,
  company-admin permission, native label relationships, focus return, and axe.
- Design-system tests: 11 files passed, 47 tests passed.
- Full frontend gate: 85 files passed, 2 files skipped; 544 tests passed and 48
  emulator-dependent rules tests skipped by their existing environment guard.
- Frontend lint: passed with 0 errors and 169 existing warnings. No warning was
  added by this slice.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed; Vite transformed 2,637 modules. Existing stale
  Browserslist-data and chunk-size warnings remain.
- Chromium and Mobile Chrome regression: the combined Company information,
  settings navigation, and Personal Profile run passed 15 checks with 9
  intentional viewport-specific skips; the Company information spec
  contributed 5 passes and 3 skips.
- Behavior: existing data initialization, field names, state updates, admin
  edit permission, `saveCompanySettings(companyId, payload)`, nested
  contact/address/legal/application values, custom questions, logo URL, cancel
  behavior, and success/error messages are unchanged. Save payload parity is
  asserted directly.
- Desktop/laptop/mobile: manual rendered review passed at 1440×900, 1024×768,
  and 412×915 in display and edit states. Labels align, controls and actions
  are at least 44 px, long content wraps, address fields collapse to one mobile
  column, and no document, content, or nested horizontal overflow remains.
- Accessibility: Company Name receives visible focus on edit; native Tab order
  reaches all fields and actions; focus returns to Edit Profile after cancel or
  successful save. Unit axe reported no violations; scoped Chromium/Mobile
  Chrome axe reported no serious or critical violations.
- Visual regression: no durable screenshot baseline was claimed because the
  catalog/baseline ownership decision remains open; manual rendered review and
  deterministic Chromium/Mobile Chrome geometry assertions were completed.
- Backend/Firebase rules tests: not applicable; no backend, rules, database,
  storage, callable, integration, or Firebase contract changed.
- Diff review: `git diff --check` passed; generated `dist/`,
  `playwright-report/`, `test-results/`, and `firestore-debug.log` artifacts
  were removed; no unrelated source or backend file was included.
- Commit/PR: checkpoint `a0cefc3`.

### Company Settings Billing informational-card compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: the Company Profile information slice was committed as
  `a0cefc3` and its roadmap evidence as `2a06fa3` before this slice began.
- Audit: the Billing tab was informational only. It displayed a section
  heading, subtitle, a decorative credit-card glyph, the derived plan name
  (`planType === 'paid' ? 'Pro Plan' : 'Free Plan'`), and static
  contact-support guidance. It had no upgrade, cancel, or external billing
  action, no billing-specific permission or feature flag, no direct Firebase or
  callable read (it read the already-loaded `currentCompanyProfile.planType`),
  and no separate loading, empty, or error state.
- Selected slice: only the Billing informational card was migrated. The plan
  calculation, plan names, and support copy were frozen before presentation
  changed.
- Component contract: reused the business-neutral `FormSection`, `FieldDisplay`,
  `Badge`, and `FieldMessage`. No new design-system component was added. The
  card was extracted into a feature-owned `BillingTab`, matching the sibling
  tabs and enabling focused tests; the previously inline `SectionHeader`
  (used only by billing) was removed. The design system gained no Company,
  Firebase, plan, permission, or billing knowledge.
- Focused tests: 1 file passed, 7 tests passed, covering the paid Pro plan, a
  non-paid free plan, a missing `planType` fallback, a null profile, the
  labelled plan value, the preserved support message, and axe.
- Shell/design-system regression: the CompanySettings shell test (5) and the
  design-system gate (11 files / 47 tests) still pass unchanged.
- Full frontend gate: 85 files passed, 2 files skipped; 550 tests passed and 48
  emulator-dependent rules tests skipped by their environment guard. The
  pre-existing `playwrightConfig` resource-contention flake timed out once under
  parallel load and then passed 4/4 in isolation; no assertion in it changed.
- Frontend lint: passed with 0 errors on the changed files. Typecheck,
  production build, and `git diff --check` passed. The build emitted only the
  existing stale-Browserslist and chunk-size warnings.
- Chromium and Mobile Chrome regression: the Billing spec passed 5 checks with 3
  intentional viewport-specific skips.
- Behavior: the plan mapping, plan names, informational-only nature, contact
  support copy, tab identifier, settings shell, admin gate, routes, and all data
  behavior are unchanged. No new interactive control, validation, or business
  rule was introduced.
- Accessibility: the section is a labelled landmark with an `<h2>` heading; the
  plan value is a labelled `FieldDisplay` whose value is a tone-carrying `Badge`
  (success for Pro, neutral for Free), so plan status is communicated by text
  and tone rather than color alone. The heading is 16 px, the label 13 px, and
  the badge and support message 12 px, so no 9/10 px text was introduced. Unit
  axe reported no violations; scoped Chromium/Mobile Chrome axe reported no
  serious or critical violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed the labelled plan, subtitle, and guidance render, the card stays
  within the viewport, and no document, content, or nested horizontal overflow
  exists at any width.
- Visual regression: no durable screenshot baseline was claimed because the
  catalog/baseline ownership decision remains open; manual rendered review and
  deterministic Chromium/Mobile Chrome geometry assertions were completed.
- Backend/Firebase rules tests: not applicable; no backend, rules, database,
  storage, callable, integration, or Firebase contract changed.
- Diff review: `git diff --check` passed; generated `dist/` and `test-results/`
  artifacts remain gitignored and were not staged; no unrelated source or
  backend file was included.
- Commit/PR: checkpoint `a98954d`.

### Company Settings Automated SMS compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: the Billing card was committed as `a98954d` and its
  roadmap evidence as `00fd366` before this slice began.
- Roadmap correction: the section 5.4 inventory and section 8 previously
  described Automated SMS as a single-textarea screen. The screen actually
  edits three independent templates (`templateContactAttempt1`,
  `templateContactAttempt2`, `templateContactAttempt3`) through three textareas
  stored together in one Firestore document. The wording was corrected to
  "three SMS-template textareas and one save action backed by a single Firestore
  document" without changing any status merely for the correction.
- Audit / frozen contract: read
  `getDoc(doc(db, 'companies', companyId, 'settings', 'automated_sms'))` behind
  a `snap.exists()` guard, with each of the three templates falling back to `''`
  and a `cancelled` flag preventing post-unmount state updates; write
  `setDoc(<same path>, { templateContactAttempt1, templateContactAttempt2,
  templateContactAttempt3, updatedAt: serverTimestamp() }, { merge: true })`.
  Load-error, save-success, and save-error messages, the `{driver name}` and
  `{user name}` placeholders, and the SMS-integration/duplicate-send guidance
  were frozen before presentation changed.
- Component contract: reused the business-neutral `FormSection`, `FormField`,
  `Textarea`, `Button`, and `FieldMessage`. No new design-system component was
  added; no Firebase, SMS, template, or Company knowledge entered the design
  system. The three fields remain three independent textareas.
- Focused tests: 1 file passed, 12 tests passed, asserting the exact read path,
  all-three load, missing-document and missing-field empty fallbacks, unique
  programmatically associated ids, independent editing, the exact save
  path/payload/`serverTimestamp`/`{ merge: true }` contract, save disabled with
  `aria-busy` while saving, the save-success/save-error/load-error messages, the
  missing-`companyId` no-read/no-write guard, the unmount cancellation guard,
  and axe.
- Shell/design-system regression: the CompanySettings shell test (5) and the
  design-system gate (11 files / 47 tests) still pass unchanged.
- Full frontend gate: 87 files passed, 2 files skipped; 563 tests passed and 48
  emulator-dependent rules tests skipped by their environment guard. The
  `playwrightConfig` flake did not recur this run.
- Coverage gate: `vitest run --coverage` completed (26.64% statements, 24.70%
  branches, 25.72% functions, 27.24% lines); no threshold regressed.
- Frontend lint: passed with 0 errors on the changed files. Typecheck,
  production build, and `git diff --check` passed. The build emitted only the
  existing stale-Browserslist and chunk-size warnings.
- Chromium and Mobile Chrome regression: the Automated SMS spec passed 7 checks
  with 3 intentional viewport-specific skips, including loaded-form axe on both
  projects and an accessible-loading-status assertion. Because the offline E2E
  project has no emulator, the gating Firestore read rejects with `unavailable`
  only after the SDK's offline-detection delay (~20s), so the loaded-form waits
  are intentionally generous; this gating is the existing, preserved behavior.
- Behavior: the three template names, per-field state, Firestore read/write, the
  `automated_sms` tab id, admin gate, routes, toast behavior, and all messages
  are unchanged. No new interactive control, validation, or business rule was
  introduced.
- Accessibility: each textarea is programmatically associated with a stable
  unique label id; the heading is 16 px, description/inline-code/labels 13 px,
  and help text 12 px, so no 9/10 px text was introduced. The save button is the
  approved 44 px `Button` communicating saving via `aria-busy` and disablement;
  keyboard order runs template 1 → 2 → 3 → save; the loading state is an
  announced `role="status"`. Unit axe reported no violations; scoped
  Chromium/Mobile Chrome axe reported no serious or critical violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed three full-width labelled textareas, aligned labels, 44 px controls,
  wrapping, and no document, content, or nested horizontal overflow at any width.
- Documented behavior concern: when `companyId` is absent the existing guard
  performs no read and leaves the tab in its loading state; this pre-existing
  behavior was preserved unchanged and asserted, not altered by the visual slice.
- Backend/Firebase rules tests: the mocked Firestore contract is asserted in the
  focused unit tests; no emulator rules test was applicable because no rules,
  data shape, or backend behavior changed.
- Diff review: `git diff --check` passed; generated `dist/`, `test-results/`,
  and `playwright-report/` artifacts remain gitignored and were not staged; no
  unrelated source or backend file was included.
- Commit/PR: checkpoint `00fd311`.

### Company Settings Email Settings compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: the Automated SMS slice (`00fd311` feat, `171eecc` docs)
  was verified — both commits are linear descendants of `00fd366`, the working
  tree is clean, `git diff --check` is clean, and the Firestore contract matches
  the report — before this slice began. `origin/main` still ends at `00fd366`;
  the Automated SMS commits remain on local `main`, fast-forwardable, unpushed.
- Audit / frozen contract: the tab was audited in full — loading state, connection
  status banner, SMTP host/port/user/password, Test Connection, test-result
  display, signature textarea, and the expandable Gmail/Outlook/SendGrid guide.
  All three callables, the secret-isolation rules, validation, port conversion,
  verified-state invalidation, messages, and the graceful load-failure and
  missing-`companyId` behaviors were frozen before presentation changed.
- Go/no-go decision: the slice was judged safe to migrate whole because every
  callable is mockable, secret handling is verifiable, existing-password behavior
  is assertable, Test and Save are independently testable, and no backend or
  Cloud Function change is required. The three handlers were preserved
  byte-for-byte; only presentation changed.
- Component contract: reused `FormSection`, `FormField`, `Input`, `Textarea`,
  `Button`, `Badge`, `Card`, and `FieldMessage`. No new design-system component
  was added; no SMTP, email-provider, secret, Firebase, or Company knowledge
  entered the design system. Provider setup instructions remain feature-owned.
- Secret safety: no real secret exists anywhere in the change; the tests use the
  obviously-artificial `NOT_A_REAL_PASSWORD_test_value`. The component contains
  no hardcoded credential, the password input binds only to the always-empty
  `smtpPassInput`, and the saved password is never rendered or logged.
- Focused tests: 1 file passed, 24 tests passed (7 metadata-load, 8 manual-save,
  6 test-connection, 3 presentation/a11y — plus axe). The 12 existing email
  logic tests still pass.
- Shell/design-system regression: the CompanySettings shell test (5) and the
  design-system gate (11 files / 47 tests) still pass unchanged.
- Full frontend gate: 88 files passed, 2 files skipped; 587 tests passed and 48
  emulator-dependent rules tests skipped by their environment guard. No flake
  this run.
- Coverage gate: `vitest run --coverage` completed (27.26% statements, 25.42%
  branches, 26.13% functions, 27.89% lines); no threshold regressed.
- Frontend lint: passed with 0 errors on the changed files. Typecheck,
  production build, and `git diff --check` passed. The build emitted only the
  existing stale-Browserslist and chunk-size warnings.
- Chromium and Mobile Chrome regression: the Email spec passed 7 checks with 3
  intentional viewport-specific skips, including loaded-form axe on both projects
  and an accessible-loading-status assertion. Unlike the Firestore-gated
  Automated SMS tab, the metadata callable rejects quickly offline, so the form
  renders without a long wait.
- Server hygiene: the browser/Playwright checks ran against the live `vite dev`
  server on port 5000 (PID 9708), confirmed to be a dev server (not `vite
  preview`) in E2E test mode serving the current working tree — the `getEmailSettingsMeta`
  callable was invoked and the migrated form rendered. No unknown process was
  terminated.
- Accessibility: every SMTP field has an associated label; the password helper is
  connected via `aria-describedby`; Test and Save have distinct accessible names
  with `aria-busy`; the status banner and test result use Badge tone plus text
  (not color alone) with `role="status"`/`role="alert"`; the setup-guide toggle
  exposes `aria-expanded`/`aria-controls`; external links keep
  `rel="noopener noreferrer"`; keyboard order runs host → port → user → password;
  and all rendered text is ≥12 px. Unit axe reported no violations; scoped
  Chromium/Mobile Chrome axe reported no serious or critical violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed five labelled 44 px controls, distinct 44 px action buttons, a
  single-column mobile layout, wrapping, and no document, content, or nested
  horizontal overflow.
- Backend/Cloud Function tests: not applicable; no callable implementation,
  rules, data shape, or backend behavior changed. The callable request/response
  contracts are asserted in the focused render tests via mocks.
- Diff review: `git diff --check` passed; generated `dist/`, `coverage/`,
  `test-results/`, and `playwright-report/` artifacts were removed and remain
  gitignored; no unrelated source or backend file was included; no secret value
  entered any artifact.
- Commit/PR: checkpoint `9c05f9e`.

### Company Settings SMS / number-assignment deep-audit log (NO-GO)

- Date: 2026-07-23.
- Checkpoint boundary: verified before this audit — the four prior slice commits
  (`00fd311`, `171eecc`, `9c05f9e`, `d9839b1`) are a clean linear chain on
  `00fd366`, working tree clean, no tracked artifacts, `git diff --check` clean,
  and a repository secret scan of source/tests/docs found only the artificial
  `NOT_A_REAL_PASSWORD_test_value` and env placeholders. The four commits remain
  on local `main`, unpushed.
- Scope audited: `SmsSettingsTab` (composes the shared secret-entry `LineManager`
  plus `NumberAssignmentManager`), `useLineAssignments`, `NumberAssignmentManager`,
  `number-assignment/DefaultLineSection`, `number-assignment/AssignmentTable`,
  `number-assignment/AssignmentRow`, `SMSDiagnosticModal`, `utils/linePhone`, and
  the existing tests.
- Baseline: the existing suite passed unchanged — `NumberAssignmentManager.test.jsx`
  15 cases (A–O) + `SmsSettingsTab.test.jsx` 3 cases = 18 tests. No source was
  modified during the audit.
- Frozen Firestore contract (must be preserved by any future migration):
  live `onSnapshot(doc(db,'companies',{companyId},'integrations','sms_provider'))`;
  fields `isActive`, `inventory[]` ({ phoneNumber, lineId|id, label, usageType,
  hasDedicatedCredentials }), `assignments{uid→phone}`, `assignmentLineTokens{uid→token}`,
  `defaultPhoneNumber`, `defaultLineToken`, `config.defaultPhoneNumber`; roster from
  `memberships` where `companyId ==` then `users` by `documentId() in` batches of 30;
  and a second resolve pass for assignment-owner uids missing from the roster.
- Frozen callable contracts: `saveSmsLineAssignments({ companyId, assignmentTokens,
  [defaultToken] })` (empty `assignmentTokens` and no `defaultToken` = the one-time
  non-destructive token backfill); `verifyLineConnection({ companyId, phoneNumber })`
  → `{ identity, timestamp }`; diagnostic-modal `verifySmsConfig({ companyId })` →
  `{ message }` and `sendTestSMS({ companyId, testPhoneNumber, fromNumber|null })`.
  Save sends stable line **tokens**, never raw phone values.
- Frozen sensitive-value/redaction contract: `<select>` option VALUES are stable
  line tokens (lineId), never phone numbers, so selection survives browser/DLP
  layers that strip phone-like text; `MISSING_TOKEN='__missing__'` surfaces a
  configured-but-unsynced line; phone display is label-first; the save path maps
  tokens→phones server-side. No provider token/JWT/secret is handled by
  `NumberAssignmentManager` (that lives in the out-of-scope `LineManager` and is
  encrypted server-side, never echoed). Any tests must use artificial numbers
  such as `+15550000001` (the existing suite already does).
- Go/no-go: NO-GO for a single bounded migration now. Conditions largely met
  (callables/Firestore mockable, no backend/rule change, permissions/`isActive`
  gate preservable), but blocked by: (1) an **open owner decision** on the
  responsive/interaction strategy for an *editable* matrix — the approved
  DataTable is proven only for display tables, and §7 leaves per-table strategy
  undecided with "no safe universal conversion"; (2) unproven DataTable fit for
  per-row form controls + `MISSING_TOKEN` resilience options + verify actions
  (would need heavy feature-owned custom cells, minimal schema reuse);
  (3) a safety-critical, markup-coupled 15-case suite encoding SMS-sending
  correctness (E.164 normalization, token-vs-raw-phone under redaction, legacy
  `lnN` migration, roster-missing resolution, one-time backfill) that a
  presentation change would force rewriting; and (4) entanglement with the
  out-of-scope shared secret-entry `LineManager`. Per policy, no partial table
  conversion was forced. Known non-migration UI/a11y debt recorded for the future
  slice: unlabelled per-row and default-line selects, `text-[9px]`/`text-[10px]`
  status text, and color-only status dots.
- Outcome: marked audited-but-not-migrated; no source changed; this is a
  documentation-only checkpoint.

### Login/Auth compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: local `main` and `origin/main` both resolved to
  `9e9da5e` (the SMS number-assignment NO-GO checkpoint) with a clean working
  tree before this slice began. Work was done on the designated
  `claude/safehaul-design-system-g1vr3a` branch, which started at `9e9da5e`.
- Audit / frozen contract: `LoginScreen.jsx` was audited in full before any
  presentation change. The frozen behavior is: `loginUser(email, password)`;
  the `location.state?.from` requested-route redirect with `{ replace: true }`;
  the smart redirect using `getPortalUser`, `getMembershipsForUser`, and
  `user.getIdTokenResult()` — Super Admin via `claims.super_admin === true` or
  the `userDoc.role === 'super_admin'` Firestore fallback to `/super-admin`,
  company membership to `/company/dashboard`, and the no-membership fallback to
  `/`; authentication error mapping and the loading state; password visibility
  toggling; and the full reset workflow (login-email pre-fill,
  `resetPassword(resetEmail)`, empty-email validation, reset loading, success,
  error, and close/reset).
- Go/no-go decision: safe to migrate whole. The screen has no secrets, no
  destructive actions, and no editable table; the services are mockable at the
  feature boundary; every redirect branch and the reset workflow are assertable;
  and no route, role name, claim, permission, Firebase, or Cloud Function
  change is required. The two handlers (`handleSubmit`, `handleForgotPassword`)
  and all open/close/reset helpers were preserved logic-for-logic; only
  presentation and imports changed.
- Component contract: reused `FormField`, `Input`, `Button`, `IconButton`, and
  `Card` from the design system and migrated the password-reset overlay from a
  local `fixed inset-0` panel to the shared accessible `Modal`
  (`@shared/components/modals/Modal`). No new design-system component was added;
  no auth, redirect, role, or Firebase knowledge entered the design system.
- Reset modal migration: the local overlay was replaced by the shared Modal,
  which adds focus trap, Escape and backdrop dismissal, and focus restoration to
  the trigger while preserving the reset business logic and messages. Initial
  focus is placed on the reset email field; the dialog is named via
  `aria-labelledby` on the current heading. This removes one of the baseline
  local `fixed inset-0` overlays.
- Documented exceptions: the trailing password-reveal control is a feature-level
  `IconButton` positioned over the design-system `Input` (with inline
  `padding-inline-end`) because the form family has no input-adornment slot yet;
  the "Forgot password?", "Contact SafeHaul", and "Back to login" text links
  remain feature-level controls pending the Phase 3 link-style Button variant.
  Both are recorded here as temporary, bounded exceptions, not new primitives.
- Preserved presentation: the branded desktop marketing panel (SafeHaul
  navy/mint artwork, stats, DOT/FMCSA) is unchanged; the "Welcome Back" heading,
  "Sign In" label, and `you@example.com` / `Enter your password` placeholders
  that existing auth and access-control tests depend on are retained.
- Focused tests: 1 new file, 16 tests passed — labelled/autofill controls plus
  unit axe, the login service call, the requested-route/super-admin(claims)/
  super-admin(Firestore fallback)/company/root redirects, error + re-enable,
  the loading-disabled state, password visibility with an accessible pressed
  toggle, and reset open/pre-fill/focus, empty validation, success, failure, and
  both close paths. The 5 existing `src/tests/auth.test.jsx` tests still pass.
- Full frontend gate: 89 files passed, 2 files skipped; 603 tests passed and 48
  emulator-dependent rules tests skipped by their environment guard. The
  design-system, route (`app/routes`), and `modalAdoption` gates pass unchanged.
- Frontend lint: passed with 0 errors; warnings dropped from the 169 baseline to
  168 (the unused `Link` import was removed and none were added). Typecheck,
  production build, and `git diff --check` passed with only the pre-existing
  stale-Browserslist and chunk-size build warnings.
- Chromium and Mobile Chrome regression: the new `e2e/login.spec.cjs` passed 12
  checks with 4 intentional viewport-specific skips across both projects
  (autofill attributes, desktop keyboard order + visible focus + label/control
  alignment, password reveal/hide, reset dialog initial focus + Escape close +
  focus restoration, desktop marketing-panel visibility, tablet and mobile
  overflow, and scoped axe on the page and with the reset dialog open). The
  existing `e2e/access-control.spec.cjs` redirect-to-login regression passed on
  both projects.
- Server hygiene: the browser/Playwright checks ran against the live `vite dev`
  server on port 5000 in E2E test mode serving the current working tree; the
  pre-installed system Chromium was used via `PW_CHROMIUM_EXECUTABLE`. No
  unknown process was terminated.
- Accessibility: email and password have associated labels (via `FormField` and
  `Label`); required fields expose `aria-required`; the reveal control is a
  labelled `IconButton` with `aria-pressed`; the authentication error is a
  token-styled `role="alert"` banner (not color alone); the reset dialog uses
  the shared Modal's dialog semantics, focus trap, and restoration; keyboard
  order runs email → password → reveal → forgot → sign-in; and all interface
  text is ≥12 px. Unit axe reported no violations; scoped Chromium/Mobile Chrome
  axe reported no serious or critical violations on the page or with the reset
  dialog open.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed 44 px controls, a visible focus ring, the trailing reveal control
  clear of the masked value, a single-column mobile layout with the marketing
  panel hidden below `lg`, and no document, content, or nested horizontal
  overflow. The reset dialog is centered and constrained at all three widths.
- Backend/Cloud Function tests: not applicable; no callable implementation,
  rules, data shape, route, permission, or backend behavior changed.
- Diff review: `git diff --check` passed; only `LoginScreen.jsx` (feature),
  `LoginScreen.test.jsx`, `e2e/login.spec.cjs`, `src/design-system/README.md`,
  and this roadmap changed; generated artifacts were not committed; no secret
  value entered any artifact.
- Remaining Login/Auth work: adopt the Phase 3 link-style Button variant for the
  text links, add an input-adornment slot to the form family (to retire the
  feature-level reveal exception), and migrate the sandbox and verification/
  change-review edge screens.

### Company Profile branding-upload compatibility-slice completion log

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `db1d785` (the merged Login/Auth PR #78)
  with a clean working tree before this slice began. Work was done on the
  designated `claude/safehaul-design-system-g1vr3a` branch, restarted from
  `origin/main`.
- Audit findings: the logo control is a two-part feature composition.
  `BrandingSection.jsx` (presentation) received `companyLogoUrl`, `isEditing`,
  `logoUploading`, and `onLogoUpload`; the parent `CompanyProfileTab.jsx`
  (unchanged) owns `handleLogoUpload`. The pre-migration markup was a raw
  128 px preview (`<img alt="Logo">` or a `Building` fallback) plus, only in
  edit mode, a `<label>`-wrapped **`display:none`** `<input type="file"
  accept="image/*">`. Findings: (a) the file input was keyboard-**inaccessible**
  because `display:none` removed it from the tab order and the `<label>` is not
  focusable; (b) there is **no client-side file-type or file-size validation**
  anywhere (neither the component nor the `uploadCompanyLogo` helper) — the
  `accept="image/*"` attribute is the only filter; (c) clicking the preview does
  **not** open the picker; (d) the markup had **no nested buttons** (a label
  wrapping an input is valid); (e) uploading was not announced; accepted types
  and current/replacement state were not surfaced; the `alt` text was the
  generic "Logo".
- Exact Storage contract (frozen): `uploadCompanyLogo(companyId, file)` in
  `src/lib/firebase/storage.js` writes to
  **`company_assets/{companyId}/logo.{ext}`** where `ext` is
  `file.name.split('.').pop()`, then returns `getDownloadURL`. On failure it
  throws `File upload failed. Please try again.`; missing id/file throws
  `Company ID and file are required for upload.`. This helper is **shared** with
  Super Admin's `EditCompanyModal`, so it was not modified.
- Exact Firestore contract (frozen): the logo upload calls
  `saveCompanySettings(companyId, { companyLogoUrl: downloadURL })`, which does
  `updateDoc(doc(db,'companies',companyId), { companyLogoUrl })` — the single
  field **`companyLogoUrl`** on `companies/{companyId}`. Messages: success
  `Logo uploaded successfully!`; failure `Logo upload failed: {message}` via the
  feature toast (`role="alert"`). Permissions: the upload control shows only in
  edit mode, and edit is gated by `isCompanyAdmin` (company_admin claim or
  super_admin global role).
- Go/no-go decision: **GO**. Both contracts are fully understood and mockable,
  file behavior is preserved unchanged (no new validation), permissions are
  untouched, and no Storage-rule, Firestore-rule, or backend change is required.
  The Storage destination, Firestore field, upload payload, accepted formats
  (`image/*`), replacement behavior, and messages are all preserved.
- Presentation changes (only `BrandingSection.jsx`): the edit-mode trigger is
  now an approved keyboard-accessible `Button` (`variant="secondary"`,
  `loading={logoUploading}`) that opens a visually hidden but labelled native
  `<input type="file">` via a ref (`onClick`), so the input is no longer
  `display:none` and there are no nested interactive elements. Added: an
  `aria-label="Upload company logo"` on the input; a `FieldMessage` help line
  explaining current/replacement state and accepted types, associated via
  `aria-describedby`; a `role="status"` region announcing "Uploading company
  logo…"; focus return to the trigger after an upload settles; a meaningful
  `alt="Company logo"` and a `role="img"` "No company logo set" fallback; and
  `--ds-*` tokens replacing the gray/blue palette. Trigger text is
  "Upload logo" / "Change logo" / "Uploading…".
- Behavior preserved: the `onLogoUpload` change event is forwarded verbatim; the
  parent handler, `uploadCompanyLogo`, `saveCompanySettings`, the Storage path,
  the `companyLogoUrl` field, the toast messages, the admin gate, and the
  no-client-validation behavior are all unchanged. The prop interface is
  identical, so `CompanyProfileTab.jsx` and `CompanyInfoSection.jsx` were not
  modified.
- Documented exception: the design system has no approved file-input primitive
  yet (the forms family lists it as open), so this remains a feature-level
  composition using approved `Button`/`FieldMessage`. Recorded as a temporary,
  bounded exception, not a new primitive.
- Focused tests: 18 new — `BrandingSection.test.jsx` (9: existing-image render +
  alt, no-image fallback, labelled input + accepted types + described trigger,
  upload-vs-change label, keyboard trigger with no nesting, verbatim change
  forwarding, uploading announce + disabled, focus return, axe in both modes);
  `CompanyProfileTab.test.jsx` (5 added: exact Storage call + exact
  `{ companyLogoUrl }` Firestore payload + success + preview replacement,
  no-file no-op, failure message + previous-logo retention, disabled-in-flight,
  permission-gated absence); `storage.test.js` (4: exact
  `company_assets/company-1/logo.png` path, extension derivation, id/file guard,
  stable failure message). All pass.
- Full frontend gate: 91 files passed, 2 skipped; **621 tests passed** and 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate `vitest run --coverage` passed at 27.74% statements / 25.74% branches /
  26.34% functions / 28.41% lines — no threshold regressed.
- Lint (0 errors, 168 pre-existing warnings), typecheck, production build, and
  `git diff --check` passed with only the pre-existing stale-Browserslist and
  chunk-size build warnings.
- Chromium and Mobile Chrome regression: the new
  `e2e/company-settings-branding.spec.cjs` passed 12 checks with 6 intentional
  viewport-specific skips across both projects (labelled input + visible
  accepted types, keyboard-focusable trigger with visible focus and no nesting,
  desktop/tablet and mobile overflow, and scoped edit-mode axe). The existing
  `e2e/company-settings-company-info.spec.cjs` regression passed on both
  projects. The real upload was not triggered in E2E (it needs Firebase
  Storage); the exact contracts are locked by the vitest suite.
- Server hygiene: the browser checks ran against the live `vite dev` server on
  port 5000 in E2E test mode serving the current working tree; the pre-installed
  system Chromium was used via `PW_CHROMIUM_EXECUTABLE`. No unknown process was
  terminated.
- Accessibility: the file input is labelled and keyboard-operable via the
  Button; there are no nested interactive elements; the preview has meaningful
  alt / labelled fallback; accepted types and current/replacement state are
  visible and associated; uploading is announced via `role="status"`; errors and
  success use the existing `role="alert"` toast (text + not color-only); focus is
  visible and returns to the trigger after upload; the Button meets the standard
  control height. Unit axe reported no violations; scoped Chromium/Mobile Chrome
  axe reported no serious or critical violations in edit mode.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed the tokenized preview, a clear "Upload logo"/"Change logo" trigger,
  the visible accepted-types help, a single-column mobile identity card, and no
  document or nested horizontal overflow.
- Backend/Storage tests: no Storage rule, Firestore rule, data shape, or backend
  behavior changed. The Storage path and Firestore field contracts are asserted
  in the focused tests via mocks.
- Diff review: only `BrandingSection.jsx` (feature) plus the three test files and
  `e2e/company-settings-branding.spec.cjs` and this roadmap changed; the shared
  `uploadCompanyLogo` helper, `CompanyProfileTab.jsx`, and `CompanyInfoSection.jsx`
  were not touched; no generated artifact, real logo, credential, or production
  Storage URL entered any artifact (tests use `cdn.example.test`).
- Remaining Settings/Profile work: Company Profile application questions
  (switch semantics, required/hidden exclusivity, DOT protections, destructive
  actions), Team & Users, Integrations, and the `/company/profile`
  account-security screen — each a separate audited slice. A design-system
  file-input primitive would retire this slice's feature-level exception.

### Sandbox Transfer Success status-screen completion log

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `9d836b4` (the merged branding-upload
  PR #79) with a clean working tree before this slice began. Work was done on
  the designated `claude/safehaul-design-system-g1vr3a` branch, restarted from
  `origin/main`.
- Audit findings: `SandboxTransferSuccess.jsx` is a small public status screen
  on the public route `/sandbox/transfer-success` (`sandboxTransferSuccess` in
  `PUBLIC_FEATURE_ROUTE_MANIFEST`). It reads `useLocation().state` and derives
  `companyName = state?.companyName || state?.companyId || 'the selected company'`,
  shows an `<h1>` "Transfer complete", a sentence ending in the `New Application`
  status, and two actions — "Super Admin" → `navigate('/super-admin')` and
  "Home" → `navigate('/')`. The pre-migration markup used raw slate/green
  utilities, a monospace status pill, and two text-link `<button>`s below any
  reasonable touch-target size.
- Go/no-go decision: **GO**. Pure presentation with no data, callables,
  permissions, or backend; the fallback chain, status wording, and both
  navigations are trivially preservable and testable.
- Presentation changes (only `SandboxTransferSuccess.jsx`): the outer surface is
  a `Card as="main"` (single `<main>` landmark; public routes add no wrapping
  landmark) with a `Stack`/`Inline` layout; the icon is the same `Building2`
  presented in a success-tinted token badge (`bg-ds-status-success-bg` /
  `text-ds-status-success-fg`, aria-hidden); the status is now a neutral `Badge`
  (same "New Application" words); the two actions are approved `Button`s
  (primary "Super Admin", secondary "Home") at the standard control height; all
  colour/spacing/type use `--ds-*` tokens. The `<h1>` "Transfer complete" and
  the sentence copy are unchanged.
- Behavior preserved: the exact `companyName || companyId || 'the selected
  company'` fallback, the `New Application` status wording, both `navigate`
  destinations, the route path, and the screen copy. The route-manifest entry
  and `featureRegistry` named export were not touched.
- Components reused: `Card`, `Button`, `Badge`, `Stack`, `Inline` — no new or
  Sandbox-specific design-system component was added, and no business logic
  entered the design system. No documented exception was required.
- Focused tests: 1 new file, 9 tests passed — company name from state, company
  id fallback, final fallback text, `New Application` status, Super Admin
  navigation, Home navigation, a single level-1 heading, both actions as
  keyboard-operable typed buttons with focusability, and unit axe. The
  route-manifest contract tests (3) and design-system gates pass unchanged.
- Full frontend gate: 92 files passed, 2 skipped; **630 tests passed** and 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate `vitest run --coverage` passed at 27.8% statements / 25.81% branches /
  26.49% functions / 28.47% lines — no threshold regressed.
- Lint (0 errors, 168 pre-existing warnings), typecheck, production build, and
  `git diff --check` passed with only the pre-existing stale-Browserslist and
  chunk-size build warnings.
- Chromium and Mobile Chrome regression: the new
  `e2e/sandbox-transfer-success.spec.cjs` passed 7 checks with 3 intentional
  viewport-specific skips across both projects (heading/status/actions,
  keyboard-operable actions with visible focus, desktop/tablet and mobile
  overflow, and scoped axe).
- Server hygiene: the browser checks ran against the live `vite dev` server on
  port 5000 in E2E test mode serving the current working tree; the pre-installed
  system Chromium was used via `PW_CHROMIUM_EXECUTABLE`. No unknown process was
  terminated.
- Accessibility: exactly one `<h1>`; success is conveyed by the "Transfer
  complete" heading text (not colour alone); the company name uses
  `break-words`; both actions are real keyboard-operable buttons with a visible
  focus ring at the standard control height; reading order is main → icon
  (hidden) → heading → status sentence → actions; all text is ≥12 px. Unit axe
  reported no violations; scoped Chromium/Mobile Chrome axe reported no serious
  or critical violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed a centered card, the tokenized success icon badge, the neutral
  status badge inline in the wrapped sentence, side-by-side actions, and no
  document or horizontal overflow.
- Backend tests: not applicable; no data, route, permission, or backend behavior
  changed.
- Diff review: only `SandboxTransferSuccess.jsx` (feature) plus its test and
  `e2e/sandbox-transfer-success.spec.cjs` and this roadmap changed; no generated
  artifact, credential, or production URL entered any artifact (tests use
  `Acme Freight` / `cmp-12345`).
- Remaining edge screens: the sandbox application screen and the verification /
  change-review token result cards are still unmigrated.

### Public Verification Portal completion log

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `93aa651` (the merged Sandbox Transfer
  Success PR #80) with a clean working tree before this slice began. Work was
  done on the designated `claude/safehaul-design-system-g1vr3a` branch, restarted
  from `origin/main`.
- Audit findings: `/verify/:token` (public, token-based, no login) is an
  FMCSA 49 CFR §391.23 employer-verification form. Logic lives entirely in
  `hooks/useVerificationPortal.js`; the token comes from `useParams()`. Page
  states: loading, error, expired, already-completed, completed, and the main
  form. The main form has four sections (Employment, conditional Safety,
  Additional, Respondent + signature) with conditional sub-fields
  (`wasEmployed`, `subjectToDotTesting`, `hadDrugAlcoholViolations`,
  `hadAccidents`). Pre-migration a11y gaps: sibling `<label>`s not associated
  with controls, a custom `RadioGroup` with `sr-only` inputs and no
  fieldset/legend, no visible radio focus, no error association, and no
  validation focus move. There is no retry mechanism (load runs once on mount)
  and no separate duplicate-submit guard beyond the `submitting` flag + the
  completed transition.
- Exact token-load contract (frozen, unchanged): `httpsCallable(functions,
  'getVerificationRequest')({ token })` → `result.data`; `data.status ===
  'completed'` → already-completed, else stored as `verificationData`. Errors:
  `functions/deadline-exceeded` → expired; `functions/not-found` → "This
  verification link is invalid or has been removed."; otherwise `err.message ||
  'Failed to load verification request.'`. No token → "No verification token
  provided." An `?e2eVerify=mock` E2E path returns fixture data.
- Exact submission contract (frozen, unchanged): `httpsCallable(functions,
  'submitVerificationResponse')({ token, response: formData })` on a passing
  custom `validate()`; success → completed + scroll to top; failure →
  `err.message || 'Failed to submit response. Please try again.'`. The hook's
  boolean (`true`/`false`/`null`), string (`'yes'`/`'no'`/`'in_progress'`,
  select values), and empty-string field representations and the full 19-field
  `response` shape are asserted verbatim in tests.
- Go/no-go decision: **GO**. Both callables are mockable; every page and
  conditional state is testable; the custom validation and the shared
  `SignaturePad` are preserved unchanged; no backend, callable, or Firebase-rules
  change is required; and the whole workflow stays feature-owned.
- Presentation changes: `VerificationPortal.jsx` (tokenized page, `role="alert"`
  error summary that receives focus on a fresh validation failure, `Button`
  submit), `PortalStatusScreens.jsx` (each state is a `Card as="main"` with one
  `<h1>`, tinted status icon, and an inner `role="status"`/`role="alert"` live
  region), `ApplicantDetailsCard.jsx` (`Card` + `FieldDisplay`), the four
  sections (`FormSection` + `FormField` + `Input`/`Select`/`Textarea`, which now
  associate labels and errors), and `RadioGroup.jsx` (a11y-hardened in place).
- Behavior preserved: `useVerificationPortal.js` and `SignaturePad` were **not**
  changed; every `updateField(field, value)` call, `formData`/`formErrors` read,
  option value, placeholder, conditional guard, the `validate()` rules, the token
  footer display, and all user-visible messages are identical. Native `required`
  was deliberately **not** added (it would bypass the custom error summary and
  break the flow); required state is exposed via `aria-required` + a visual
  asterisk instead.
- Radio decision: no approved design-system radio primitive exists (Phase 4
  Radio/Checkbox is not started), so the feature-local `RadioGroup` was hardened
  in place — `<fieldset>`/`<legend>` grouping, native radios grouped by `name`
  (arrow-key nav preserved), a `focus-within` visible focus ring, and
  `aria-describedby` error/description association — and remains feature-owned.
  No competing design-system RadioGroup was created.
- Privacy/security: the route token is not logged, stored, or sent to analytics;
  no hidden backend fields were added; the public route stays unauthenticated and
  token validation is unchanged. All tests use artificial names, employers,
  phones, and tokens (`token-abc`/`token-xyz`, "Artificial Applicant",
  `555-000-1111`); no real data or token appears in any artifact.
- Focused tests: 24 new across 2 files. `useVerificationPortal.test.js` (10):
  exact token request, loading, valid/completed/not-found/expired/generic-failure
  loads, no-token guard, validation-blocked submit with exact `formErrors`, and
  the exact `{ token, response }` submit payload + completion + submit failure.
  `VerificationPortal.test.jsx` (14): token-from-route, single `<h1>` + applicant
  display, grouped radios with legend + preserved labels, conditional employment
  and drug/alcohol reveals, validation error summary receiving focus without
  submitting, full submit-to-success, the invalid-link error screen, loaded-form
  axe, and one-h1 + axe for all five status screens.
- Full frontend gate: 94 files passed, 2 skipped; **654 tests passed** and 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate `vitest run --coverage` passed at 28.68% statements / 26.62% branches /
  27.62% functions / 29.34% lines — no threshold regressed. The
  callable-contract check passed (`OK | mapped 101 | raw 101`); no backend
  changed.
- Lint (0 errors, 168 pre-existing warnings), typecheck, production build, and
  `git diff --check` passed with only the pre-existing build warnings.
- Chromium and Mobile Chrome regression: the extended
  `e2e/pev-request-and-portal-response.spec.cjs` passed 7 checks with 3
  intentional viewport-specific skips across both projects — the original
  mock-mode complete-response flow, a grouped keyboard-focusable employment
  question with visible focus, desktop/tablet and mobile overflow, and scoped
  loaded-form axe on both projects.
- Server hygiene: port 5000 was confirmed free before use; the browser checks
  ran against a fresh `vite dev` server in E2E test mode serving the current
  working tree via the pre-installed system Chromium (`PW_CHROMIUM_EXECUTABLE`).
  No unknown process was terminated.
- Accessibility: one `<h1>` per state; section `<h2>`s under it; radios grouped
  by `<fieldset>`/`<legend>` with visible focus and associated errors; text/date/
  select/textarea labels associated via `FormField`; `aria-required` on required
  controls; a focused `role="alert"` error summary on validation failure; status
  screens use `role="status"`/`role="alert"`; success and errors read as text,
  not colour alone; all interface text is ≥12 px. Unit axe reported no
  violations; scoped Chromium/Mobile Chrome axe reported no serious or critical
  violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed the branded header, the FMCSA banner + `FieldDisplay` applicant grid,
  tokenized sections, the untouched SignaturePad, a single-column mobile layout,
  and no document or horizontal overflow.
- Backend tests: not applicable; no callable implementation, Firestore/Storage
  rule, data shape, route, or token behavior changed. The callable request/
  response contracts are asserted in the focused tests via mocks.
- Diff review: only the nine verification presentation files (portal, status
  screens, applicant card, RadioGroup, four sections), the two new test files,
  and the PEV e2e spec changed; the hook and `SignaturePad` were untouched; no
  generated artifact, real token, or personal data entered any artifact.
- Remaining Verification work: adopting a design-system Radio/Checkbox primitive
  would retire the feature-local RadioGroup; the Change Review Portal
  (`/review-change/:token`) remains a separate, not-yet-migrated slice.

### Public Change Review Portal completion log

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `8a7fb70` (the merged Public Verification
  Portal PR #81) with a clean working tree before this slice began. Work was
  done on the designated `claude/safehaul-design-system-g1vr3a` branch, restarted
  from `origin/main`; the verification hook and shared `SignaturePad` were
  confirmed unchanged.
- Audit findings: `/review-change/:token` (public, token-based, no login) lets a
  driver approve/reject/edit recruiter-proposed changes. `ReviewChangePortal.jsx`
  reads the token from `useParams()`, supports `?e2eReview=mock`, loads via
  `getChangeReview({ token })`, initializes each pending change to `approve`, and
  submits via `submitChangeResolution({ token, resolutions })`. Render states:
  loading, load error, loaded review, no-pending, submitting, submission error,
  success. A backend `status: 'completed'` review surfaces as the no-pending
  state (the frontend derives no-work from `pending.length === 0`), which the
  migration preserves. There is no retry or expired-specific screen, and the
  frontend adds no missing-token guard (a missing token flows to the backend
  "Missing token." error) — both preserved. The persistent header `<h1>` is
  shown in every state. `applicantName` is returned by the callable but is **not
  rendered** by the UI; the migration preserves this non-disclosure on the public
  link.
- Exact load contract (frozen, unchanged): `httpsCallable(functions,
  'getChangeReview')({ token })` → `r.data` = `{ applicantName, status,
  changes[] }`; each change is `{ fieldKey, fieldLabel, originalValue,
  proposedValue, status, resolvedValue }`. The cancellation guard
  (`let cancelled = false; … if (cancelled) return; … return () => { cancelled =
  true; }`), the `String(proposedValue ?? '')` scalar init, the `isScalar`
  (null/undefined/non-object) and `previewValue` (`—` / `{n} item(s)` /
  `(updated)` / `String`) rules, and the `'This review link is invalid or has
  expired.'` frontend fallback are all unchanged. Backend-mapped messages
  ("Missing token.", "Too many requests. Please wait a moment.", "This review
  link is invalid.", "This review link has expired.") are surfaced verbatim and
  were not altered.
- Exact resolution/submission contract (frozen, unchanged): one resolution per
  pending change, in pending order — approve `{ fieldKey, action: 'approve' }`,
  reject `{ fieldKey, action: 'reject' }`, edit `{ fieldKey, action: 'edit',
  value }` (scalar → edited local value; non-scalar → proposedValue, which the UI
  prevents). `submitChangeResolution({ token, resolutions })`; success →
  `Thank you!` / `Your responses have been recorded.`; failure fallback →
  `Could not submit your review. Please try again.`. Duplicate submission is
  resisted by the existing `submitting` flag disabling the button.
- Go/no-go decision: **GO**. Load/submit contracts understood and mockable;
  scalar/non-scalar, all action values/payloads, and every status state are
  testable; validation and payload construction are preserved; no backend or
  Firebase-rules change is required; token privacy is intact.
- Presentation changes (only `ReviewChangePortal.jsx`): the page is a
  `Card as="main"` with a branded dark header (`<h1>`); loading is a
  `role="status"` region, load/submit errors a `role="alert"` box, and success /
  no-pending are `role="status"` regions; before/after now show visible
  `Current:`/`Proposed:` labels (understandable without relying only on
  strikethrough + arrow); the approve/reject/edit control stays a **feature-owned
  segmented toggle group** with `aria-pressed`, per-field `role="group"`
  labelling, icon + text (not colour alone), semantic status-token active tones,
  a `focus-visible` ring, and a ≥40 px touch target; the corrected-value control
  is the design-system `Input` (label association preserved via `aria-label`);
  the submit is a design-system `Button`; and the footer note moved from a raw
  `text-[11px]` to a supported ≥12 px token.
- Behavior preserved: all load/cancellation/init/`setAction`/`setValue`/`pending`
  filtering/`handleSubmit` logic, every action value, the exact payload shape and
  order, the callables, the token handling, the render-state precedence
  (loading → error → done → no-pending → form), and every user-visible message
  are identical. `functions/applicationChanges.js` was not modified.
- Decision-control decision: no approved design-system segmented/toggle-group
  primitive exists, and an approve/reject/edit control is domain-specific, so it
  remains feature-owned per the slice brief (no business-specific design-system
  component was created). A future design-system Radio/Checkbox or generic
  segmented-control primitive could inform a later refactor.
- Privacy/security: the route token is not logged, stored in local/session
  storage, or sent to analytics; no hidden backend fields were added; object- and
  array-valued changes are shown only as `(updated)` / `{n} item(s)` (contents
  never revealed); `applicantName` is not rendered; the route stays
  unauthenticated and token validation/expiration/rate-limiting are unchanged.
  All tests use artificial data (`tok-1`, "John Doe" asserted **not** rendered,
  `555…` mock numbers, `Jonathan`/`Sparks`).
- Focused tests: 16 (up from 3) — token-from-route + exact `getChangeReview`
  request + loading, single `<h1>`, applicant-name non-disclosure, pending-only
  display, empty/array/object previews without exposing contents + edit hidden
  for non-scalar, completed→no-pending state, approve-default + mutual exclusion,
  labelled corrected-value input, exact approve-default and edit/reject payloads
  in order, submitting-disabled + announcement, backend error message, generic
  load-error fallback, generic submission-error fallback, cancellation guard, and
  loaded-form axe. The existing PEV/route-manifest/design-system gates pass
  unchanged.
- Full frontend gate: 94 files passed, 2 skipped; **667 tests passed** and 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate `vitest run --coverage` passed at 28.71% statements / 26.72% branches /
  27.62% functions / 29.35% lines — no threshold regressed. The
  callable-contract check passed (`OK | mapped 101 | raw 101`); no backend
  changed, so backend unit tests were not required.
- Lint (0 errors, 168 pre-existing warnings), typecheck, production build, and
  `git diff --check` passed with only the pre-existing build warnings.
- Chromium and Mobile Chrome regression: the new
  `e2e/change-review-portal.spec.cjs` passed 7 checks with 3 intentional
  viewport-specific skips across both projects — the default-approve complete
  flow, a grouped keyboard-focusable decision control with visible focus,
  desktop/tablet and mobile overflow, and scoped axe on both projects.
- Server hygiene: port 5000 was confirmed free before use; the browser checks
  ran against a fresh `vite dev` server in E2E test mode serving the current
  working tree via the pre-installed system Chromium (`PW_CHROMIUM_EXECUTABLE`).
  No unknown process was terminated.
- Accessibility: one persistent `<h1>` across states; loading/success/no-pending
  use `role="status"`, errors use `role="alert"`; each change has a `role="group"`
  label; decision buttons expose `aria-pressed`, are keyboard operable with a
  visible focus ring and a ≥40 px target, and convey state by icon + text, not
  colour alone; before/after read via `Current:`/`Proposed:` labels; the
  corrected-value input is labelled; submit is disabled + announced while
  processing; long labels/values wrap; all interface text is ≥12 px. Unit axe
  reported no violations; scoped Chromium/Mobile Chrome axe reported no serious or
  critical violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed the branded header, the token-styled change cards with visible
  before/after labels and tinted active decisions, the corrected-value input, and
  a single-column mobile layout with no document or horizontal overflow.
- Backend tests: not applicable; no callable implementation, Firestore/Storage
  rule, data shape, route, or token behavior changed. The callable request/
  response contracts are asserted in the focused tests via mocks.
- Diff review: only `ReviewChangePortal.jsx` (feature), its test, and
  `e2e/change-review-portal.spec.cjs` changed; the backend
  `functions/applicationChanges.js` was untouched; no generated artifact, real
  token, or personal data entered any artifact.
- Remaining token/public-screen work: all three public token screens
  (`/verify/:token`, `/review-change/:token`, `/sandbox/transfer-success`) are
  now migrated. A design-system Radio/Checkbox or generic segmented-control
  primitive would let the verification RadioGroup and this decision control move
  out of feature ownership.

### Company Settings Team & Users completion log

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `c79a172` (the merged Change Review PR
  #82) with a clean working tree before this slice began; the Change Review
  backend was confirmed unchanged. Work was done on the designated
  `claude/safehaul-design-system-g1vr3a` branch, restarted from `origin/main`.
- Scope: one audited workflow with two presentation surfaces — the Add New User
  form (`TeamManagementTab.jsx`) and the Manage Team & Links modal
  (`ManageTeamModal.jsx`). Both migrated together (full GO). `CompanySettings.jsx`
  (permission gate + modal wiring) and `functions/hrAdmin.js` were not changed.
- Permission contract (frozen, unchanged): `CompanySettings` gates the route on
  `currentUserClaims?.roles?.[currentCompanyProfile?.id] === 'company_admin' ||
  currentUserClaims?.roles?.globalRole === 'super_admin'`, redirecting non-admins
  to `/company/dashboard`; `TeamManagementTab` keeps its own "Access Denied. Only
  Admins can manage the team." fallback. Neither was weakened or broadened.
- Exact create-user contract (frozen): `httpsCallable(functions,
  'createPortalUser')({ fullName, email, password, companyId:
  currentCompanyProfile.id, role })`. Role options unchanged (`hr_user` →
  "Recruiter (Standard)", `company_admin` → "Company Admin (Full Access)"); the
  backend-recognized `recruiter` is still not exposed. Success toast `User
  {fullName} created successfully!` + reset to `{ fullName:'', email:'',
  password:'', role:'hr_user' }`; failure `Failed to create user:
  {error.message}`. **Native `required`** is the form's validation (unlike the
  verification form) and was preserved via `FormField required`.
- Password-security contract (frozen + hardened): the password lives only in
  controlled component state for the callable; it is never logged (the catch
  logs the error object, not the password — asserted by test), never written to
  Firestore by the frontend, never in local/session storage or analytics, and is
  cleared on reset. Added `autocomplete="new-password"` on the password field and
  `autocomplete="off"` on name/email so the admin's own credentials are not
  autofilled into a create-other-user form. Tests use
  `NOT_A_REAL_PASSWORD_test_123`.
- Exact team-loading contract (frozen): reads `companies/{companyId}` →
  `companySlug = appSlug || companyId` (load failure warns, keeps fallback);
  `onSnapshot(query(collection(db,'memberships'), where('companyId','==',
  companyId)))` with unsubscribe on unmount; per membership reads
  `users/{userId}` (fallback `{ name:'Unknown', email:'No Email' }`) and
  `companies/{companyId}/team/{userId}` (defaults `callGoal:150`,
  `contactGoal:50` via `value || default`, so a stored zero still falls back —
  preserved).
- Exact goal-write contract (frozen): save-on-blur
  `setDoc(doc(db,'companies',companyId,'team',userId), { [field]: Number(value),
  updatedAt: new Date() }, { merge: true })`; failure → `alert('Error saving
  goal')`. No debounce/autosave introduced.
- Exact tracking-link contract (frozen): base `import.meta.env.VITE_DRIVER_APP_URL
  || window.location.origin`, trailing slash trimmed; link
  `{base}/apply/{companySlug}?recruiter={userId}`;
  `navigator.clipboard.writeText(link)` (fire-and-forget, not awaited) with
  `showSuccess('Custom recruiter link copied!')` always shown — the current
  clipboard-failure behavior (toast regardless) is preserved and locked by a
  rejection test.
- Exact delete-user contract (frozen): `window.confirm('Are you sure you want to
  remove {name || 'this user'} from the team?')`; `httpsCallable(functions,
  'deletePortalUser')({ userId, companyId })`; success `{name || 'User'} has been
  removed from the team.`; failure `Failed to remove user: {message}`;
  row-specific `deleteLoading`. Backend membership/claims/SMS-assignment/orphan
  cleanup is unchanged (callable not replaced with client-side deletion).
- Go/no-go decision: **GO for both surfaces**. Both callables and all Firestore
  reads/writes/subscription are mockable; password handling stays safe; the admin
  gate is untouched; goal-save, clipboard, and destructive delete are testable;
  the shared accessible `Modal` preserves title/description/close/Escape/backdrop/
  focus-trap/focus-restore; no backend or Firebase-rules change is required.
- Presentation changes: **Add New User** → `FormSection` + `FormField` +
  `Input`/`Select` + `Button`, associating labels/errors and keeping native
  required + the two role options; the denied state is tokenized. **Manage Team**
  → the local `fixed inset-0` overlay replaced by the shared `Modal` (named/
  described by its header, `IconButton` close, Escape + backdrop dismissal, focus
  trap, and focus restoration to "View All Team Members & Goals"); member rows are
  tokenized `Card`-like list items with truncating name/email, compact goal
  inputs now carrying member-specific `aria-label`s ("Daily dial/contact goal for
  {name}") and a visible focus ring, a `Button` copy control named "Copy tracking
  link for {name}", and a danger `IconButton` named "Remove {name} from the team"
  with row-specific loading. The former **8 px** "Dials"/"Contacts" labels are now
  a supported 12 px token.
- Behavior preserved: every callable/Firestore/subscription/clipboard/confirm
  operation, field names, payloads, defaults, messages, and the permission gate
  are identical; `CompanySettings.jsx` and `hrAdmin.js` were not modified.
- Components reused: `FormSection`, `FormField`, `Input`, `Select`, `Button`,
  `IconButton`, and the shared accessible `Modal`. No business concept
  (recruiter, membership, company role, Firebase) entered the design system, and
  no competing modal or form primitive was created.
- Focused tests: 25 new — `TeamManagementTab.test.jsx` (9: non-admin denial,
  initial values + exact two role options + default role, required/typed inputs +
  autocomplete, exact `createPortalUser` request, success toast + full reset with
  password cleared, disabled-while-creating, failure message + password absent
  from console/storage, Manage-Team open, axe) and `ManageTeamModal.test.jsx`
  (16: loading + memberships query + list, user/goal fallbacks, stored goals with
  unique labels, empty state, snapshot unsubscribe on unmount, goal save-on-blur
  exact path/`Number`/`updatedAt`/merge, goal-save alert, exact tracking link with
  env base + trailing-slash trim + origin/slug fallback, clipboard-rejection
  still-toasts, delete confirm/cancel/exact request/failure/row-loading/other-rows-
  operable, dialog name+description+close+Escape+backdrop, axe). The existing
  `CompanySettings.test.jsx` shell suite (which mocks the tab/modal) still passes.
- Full frontend gate: 96 files passed, 2 skipped; **692 tests passed** and 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate `vitest run --coverage` passed at 29.4% statements / 27% branches / 28.34%
  functions / 30.1% lines — no threshold regressed. The callable-contract check
  passed (`OK | mapped 101 | raw 101`).
- Backend tests: the `functions/test/unit/createPortalUser.test.js` jest suite
  could **not run** in this environment (jest is not installed under `functions/`);
  recorded honestly. No backend code was changed, so `hrAdmin.js` behavior is
  unchanged and the callable-contract check covers the export mapping.
- Lint (0 errors, 168 pre-existing warnings), typecheck, production build, and
  `git diff --check` passed with only the pre-existing build warnings.
- Chromium and Mobile Chrome regression: the new
  `e2e/company-settings-team.spec.cjs` passed 9 checks with 3 intentional
  viewport-specific skips across both projects — labelled/required form with safe
  autocomplete, desktop keyboard order + visible focus, the Manage Team dialog
  opening with an accessible name/description and restoring focus to the trigger
  on Escape, desktop/tablet and mobile overflow, and scoped axe on both projects.
- Server hygiene: port 5000 was confirmed free before use; the browser checks ran
  against a fresh `vite dev` server in E2E test mode serving the current working
  tree via the pre-installed system Chromium (`PW_CHROMIUM_EXECUTABLE`). No
  unknown process was terminated.
- Accessibility: each surface has a clear heading; all create-user inputs are
  labelled with programmatic required state and correct autocomplete; the password
  is never surfaced in helper text; goal inputs carry unique member+type labels
  and stay keyboard editable with visible focus; copy/delete controls have
  member-specific accessible names; status/actions use icon + text, not colour
  alone; the modal is a named/described focus-trapped dialog; touch targets meet
  the control minimum; the 8 px goal labels are now ≥12 px. Unit axe reported no
  violations; scoped Chromium/Mobile Chrome axe reported no serious or critical
  violations.
- Visual/mobile review: rendered review at 1440×900, 1024×768, and 412×915
  confirmed the tokenized Add New User form (labelled 2×2 grid, required markers,
  primary action), the shared-Modal Manage Team dialog (named header, close,
  scrollable body, empty state), a single-column mobile layout, and no document or
  horizontal overflow.
- Diff review: only `TeamManagementTab.jsx`, `ManageTeamModal.jsx`, their two new
  tests, and `e2e/company-settings-team.spec.cjs` changed; `CompanySettings.jsx`
  and `functions/hrAdmin.js` were untouched; no generated artifact, real password
  (only the artificial `NOT_A_REAL_PASSWORD_test_123`), email, token, or personal
  data entered any artifact.
- Remaining Team & Users work: none for these two surfaces — the area is complete.
  Broader Settings/Profile work (Integrations, Company Profile application
  questions, `/company/profile` account security) remains separate.

### Company Settings Integrations deep-audit log (NO-GO)

- Date: 2026-07-23.
- Checkpoint boundary: `origin/main` at `3bb5f9c` (the merged Team & Users PR
  #83) with a clean working tree; the Team & Users slice was confirmed not to
  have touched `CompanySettings.jsx` or `functions/hrAdmin.js`. This is an
  audit/documentation-only checkpoint — **no source or presentation file was
  changed**.
- Scope audited: `src/features/settings/components/IntegrationsTab.jsx`,
  `CompanySettings.jsx` (feature-flag visibility + admin gate),
  `functions/integrations/facebook.js` (`connectFacebookPage`,
  `facebookWebhook`/`facebookWebhookV1`, `processLead`), `functions/index.js`
  export mapping, `docs/callable-frontend-map.md`, and the company/membership/
  lead architecture.
- Settings-visibility contract (frozen): the Integrations nav item shows only
  when `currentCompanyProfile?.features?.callTracking !== false`
  (`CompanySettings.jsx`); the standard admin gate + `/company/dashboard`
  redirect apply. Unchanged.
- SDK-loading contract (frozen): on mount, if `window.FB` exists →
  `setIsSdkLoaded(true)` and no script insertion; otherwise assign
  `window.fbAsyncInit` calling `window.FB.init({ appId:
  import.meta.env.VITE_FACEBOOK_APP_ID, cookie: true, xfbml: true, version:
  'v19.0' })` then `setIsSdkLoaded(true)`, and inject a `<script
  id="facebook-jssdk" src="https://connect.facebook.net/en_US/sdk.js">` before
  the first `<script>` (skipped when the id already exists). Audit notes (not to
  be "fixed" in a presentation slice): if no first `<script>` exists,
  `fjs.parentNode` throws; if the script tag exists but `window.FB` never
  initialized, `isSdkLoaded` stays false with no retry; unmount before
  `fbAsyncInit` fires can call `setIsSdkLoaded` after unmount; and the effect
  overwrites any pre-existing `window.fbAsyncInit` (no coordination with other
  consumers).
- Login/scopes contract (frozen): not-ready → `showError('Facebook SDK not
  loaded yet. Please refresh.')`; otherwise `setConnecting(true)` then
  `window.FB.login(cb, { scope: 'pages_show_list,pages_read_engagement,
  leads_retrieval,pages_manage_metadata,pages_manage_ads' })`. On
  `response.authResponse` → pass `response.authResponse.accessToken` onward; else
  `setConnecting(false)` and, when `response.status !== 'unknown'`,
  `showError('Facebook login failed or was cancelled.')` ('unknown' = silent
  popup close).
- Graph-API/page-selection contract (frozen): the browser fetches
  `https://graph.facebook.com/v19.0/me/accounts?access_token={shortLivedUserToken}`,
  parses JSON, expects `data[]`, throws `No Facebook Pages found for this user.`
  when empty, and **auto-selects `pagesResp.data[0]`** (no picker, no sort/filter
  — a first-page-only behavior recorded here explicitly).
- Callable contract (frozen): `httpsCallable(functions, 'connectFacebookPage')({
  shortLivedUserToken, pageId: pageToConnect.id, pageName: pageToConnect.name })`;
  success → `setConnectedPage(pageToConnect.name)` +
  `showSuccess('Successfully connected Facebook Page: {pageName}')`; failure →
  `console.error(error)` + `showError(error.message || 'Failed to connect
  Facebook Page.')`; `connecting` resets in the `finally`.
- Token-security contract: the frontend uses only the public
  `VITE_FACEBOOK_APP_ID`; no `FACEBOOK_APP_SECRET`/`FACEBOOK_VERIFY_TOKEN`, no
  token exchange, and no long-lived/page tokens exist in the browser (verified by
  `grep`). The short-lived token flows into the Graph fetch and the callable and
  must never reach console/toast/tests/screenshots/logs — a constraint any future
  GO slice must keep.
- Connected-state limitation (frozen, must not be masked): `connectedPage` lives
  only in local React state — it is not loaded from Firestore or a callable, is
  lost on refresh, has no disconnect/reconnect flow, and renders a disabled
  "Connected" button after success. A presentation migration must not imply
  persistence.
- **Tenant-binding audit (the blocker):** `connectFacebookPage` derives
  `const companyId = request.auth.uid;` (the backend comment itself says
  "Assumes 1:1 user-company mapping for simplicity"). It then writes
  `integrations_index/{pageId}` with `companyId = uid`, and the webhook
  `processLead` ingests each lead to `companies/{companyId}/leads` with that same
  `uid`. But SafeHaul is explicitly multi-tenant: companies are created via
  `addDoc(collection(db,'companies'), { ownerId: user.uid, … })` so the company
  **document id is an auto-generated Firestore id, not the owner's uid**; users
  are linked to companies through the `memberships` collection and
  `roles[companyId]` custom claims; and every lead consumer reads
  `companies/{realCompanyId}/leads` (e.g. `useCompanyDashboard.js`,
  `QuickLeadModal`, `LeadAssignmentModal`, `useSystemHealth`). The
  `IntegrationsTab` receives **no** `companyId` prop and the callable payload
  carries none, so the binding is entirely `uid`-derived. Consequence: connected
  Facebook leads would be written to `companies/{uid}/leads` — a path that is not
  the user's real company doc — so they would never reach the intended company's
  dashboard, and a page-to-tenant mapping keyed on `uid` breaks for any
  membership/multi-company user. `request.auth.uid` is therefore an incompatible
  (legacy one-user/one-company) assumption, not the intended company identifier.
- Go/no-go decision: **NO-GO.** Per the tenant-binding rule, the tenant binding
  is incompatible with the multi-tenant company model, so: no backend change is
  made here; the presentation is **not** migrated (polishing the card would imply
  a production-ready workflow it is not); and this defect is handed off to a
  separate integration-correctness/security project with its own scope, tests,
  and security review. The SDK-load edge cases and the non-persistent
  connected-state are secondary reasons the card should not be presented as
  finished.
- Verification performed for this audit: full frontend suite passed unchanged
  (96 files / 692 tests, 48 emulator-gated rules skipped); frontend lint 0
  errors; the callable-contract check passed (`OK | mapped 101 | raw 101`) and
  `connectFacebookPage` is exported from `functions/index.js`; no Facebook secret
  appears in `src/`; no real Facebook login/Graph request was made. No Facebook
  backend unit test exists under `functions/test`, and the `functions` jest
  runner is not installed in this environment — recorded honestly. Working tree
  contained only this roadmap documentation change.
- Outcome: Integrations marked deep-audited-but-not-migrated (NO-GO); no source
  changed; contracts frozen above for a future slice once the tenant binding is
  corrected under a separate security-reviewed project.

### Company account profile & security completion log (GO)

- Date: 2026-07-24.
- Starting baseline: `main` at `b47874b` (Merge PR #84 — Integrations
  deep-audit NO-GO). Local branch started clean at that commit.
- Scope: `/company/profile` → `UserProfilePage`. Application questions and
  Integrations were explicitly excluded from this diff.
- Go/no-go decision: **GO.** Every Auth, Storage, and Firestore contract is
  mockable and testable without any backend or rules change. No callable, rule,
  route, permission, or data-shape change was needed or made.
- Audited contracts, all preserved verbatim:
  - Initial load: Auth `currentUser` base values, `getPortalUser(uid)`,
    Firestore `name || displayName` preference, Firestore `photoURL`
    preference, username load, and `newEmail` initialized to `currentUser.email`.
  - Avatar: size `< 2 MB` check first, then `image/*` type check, both with
    their exact messages; Storage path `avatars/{uid}/{file.name}`;
    `uploadBytes` → `getDownloadURL` → Auth `updateProfile({ photoURL })` →
    Firestore `users/{uid}.photoURL`; existing success/failure toasts.
  - Profile save: empty display-name validation; best-effort username
    uniqueness query; permission-denied uniqueness check skipped (not blocking)
    with the SEC-002 comment retained; Auth display-name update only when the
    value changed; Firestore `{ name, username }` write; existing messages.
    Username uniqueness remains **not** server-enforced (unchanged).
  - Email change: new-email + current-password requirement; same-email
    cancellation; `EmailAuthProvider.credential(currentUser.email, password)`;
    `reauthenticateWithCredential`; `updateEmail`; Firestore
    `users/{uid}.email`; the four error mappings (wrong password, email in use,
    requires recent login, generic); cancel/reset restoring the current email
    and clearing the password.
  - Password change: current+new requirement; confirmation match; six-character
    minimum; reauthentication with current email+password; `updatePassword`;
    full field reset on success; existing messages and loading states.
- Presentation changes: the screen now consumes `FormSection`, `FormField`,
  `Input`, `Button`, `FieldDisplay`, `FieldMessage`, `PageHeader`, and `Stack`
  with `--ds-*` tokens. The nested/clickable avatar surface (clickable wrapper +
  hover overlay + nested corner `<button>` + hidden input) was replaced by a
  single keyboard-accessible `ProfileAvatarField` trigger with a visually hidden
  labelled input, a `role="status"` upload announcement, and focus return; no
  nested interactive elements remain. Correct autocomplete was added: email
  `email`, all current-password fields `current-password`, and the new/confirm
  password fields `new-password`.
- Sensitive-data handling: passwords stay only in transient component state and
  are never written to logs, Firestore, Storage, analytics, or browser storage;
  a test asserts non-exposure. All test/E2E credentials are artificial.
- Focused tests: 2 files passed, 38 tests
  (`UserProfilePage.test.jsx` 29, `ProfileAvatarField.test.jsx` 9).
- Full frontend coverage gate: 98 files passed, 730 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their existing environment guard.
  Coverage was 30.6% statements, 27.75% branches, 29.1% functions, 31.37% lines.
- Route-manifest tests: `appRouteManifest.test.js` passed within the suite.
- Frontend lint: passed with 0 errors and 166 pre-existing warnings.
- Typecheck: passed (`tsc -p jsconfig.json --noEmit`).
- Production build: passed.
- Playwright, Chromium + Mobile Chrome (`company-profile-security.spec.cjs`):
  9 passed, 3 intentionally skipped because each keyboard/geometry assertion
  only applies to its matching viewport.
- Accessibility: unit `vitest-axe` reported no violations on the page and the
  avatar component; scoped real-browser axe reported no serious or critical
  violations.
- Visual review at 1440×900, 1024×768, and 412×915 (plus the desktop email-edit
  state): no document-level horizontal overflow at any width; single-column
  mobile layout; 44 px controls; visible focus; labelled fields.
- Backend/callable/rules checks: not run and not applicable — this diff changes
  no Cloud Function, callable payload, or rule; `functions/node_modules` is not
  installed in this environment, so backend lint was not run (recorded honestly).
- Diff review: `git diff --check` passed; the changed file plus the two new test
  files, the new avatar component, and the new E2E spec contain no unrelated
  application/backend changes.
- Avatar initials robustness: because the initials prop is evaluated eagerly
  (regardless of whether a photo exists), `getInitials` was made trim-safe so a
  whitespace-only name cannot throw. This restores the original property that a
  photo-backed account always renders its image and never crashes; normal-name
  output ("John Doe" → "JD") is unchanged. Locked by a regression test.
- Commit/PR: feature commit + docs commit on
  `claude/company-profile-security-migration-mjdbm1`; PR into `main`.

### Company Profile application-questions completion log (GO)

- Date: 2026-07-24.
- Starting baseline: `main` at `e470318` (Merge PR #85 — account profile/security).
- Scope: the Company Profile → "Application Form Questions" tab only
  (`StandardQuestionsConfig`, `CustomQuestionsBuilder`, `QuestionEditor`,
  `OperationalSettingsSection`). No other feature touched.
- Go/no-go decision: **GO.** The migration is presentation/accessibility only
  and preserves the saved data shape exactly, so it needs no backend, rules, or
  public-application-schema change. Consumer audit confirmed the frozen shape:
  `applicationConfig` `{[fieldId]:{required,hidden}}` (read by 5 driver-app steps
  and `buildApplicationDoc`, gated by the `publicProfileDto` allowlist) and
  `customQuestions` items (`id/key/type/label/options/required/dotRequired/
  helpText/min/max`, consumed by the Stepper merge, `DynamicQuestionsStep`, and
  the PDF generator via `customAnswers`).
- Reordering: **partial-to-full GO.** Native mouse drag is preserved verbatim; a
  keyboard-accessible move-up/down was added. Both mutate the same array-order
  format `onChange` already emits, so the saved `customQuestions` order format is
  provably unchanged (locked by tests). No NO-GO was required.
- Preserved contracts: standard required/hidden exclusivity and the exact
  `{required,hidden}` payload; all standard ids/labels/defaults; custom-question
  `crypto.randomUUID()` creation and `INITIAL_QUESTION_STATE` defaults; every
  question type; option add/remove/edit and the `Option N` naming;
  `hasOptions`-driven `['Option 1']` initialization on type change; preview/edit
  mode; DOT-required deletion protection with the exact alert text; the inverse
  `canCompanyHide`/`canCompanyModify` checkbox mappings; and the
  `applicationConfig`/`customQuestions` pass-through via `saveCompanySettings`.
- Accessibility: standard toggles are ARIA switches with unique "Require X"/
  "Hide X" names and `aria-checked` (state not by color alone); every editor
  field has an associated label; delete, option-remove, and reorder are named
  IconButtons; the preview mock inputs are `aria-hidden`. No approved DS
  Switch/Checkbox primitive exists, so the `ToggleSwitch` and native compliance
  checkboxes are documented feature-level compositions (Radio/checkbox item).
- Focused tests: 5 files / 47 tests (4 new question files / 35 + the unchanged
  CompanyProfileTab 12).
- Full frontend coverage gate: 102 files / 766 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  31.39% statements / 28.63% branches / 30.65% functions / 32.2% lines.
- Public-application regression: `Step3_License` and `PublicApplyHandler` tests
  passed (they exercise `applicationConfig` gating and profile projection).
- Frontend lint: 0 errors (163 pre-existing warnings); typecheck, production
  build, and `git diff --check` passed.
- Playwright (`company-settings-questions.spec.cjs`), Chromium + Mobile Chrome:
  9 passed, 3 intentional viewport-specific skips.
- Accessibility checks: unit `vitest-axe` clean; scoped real-browser axe found no
  serious or critical violations (one real contrast finding was fixed by moving
  the compliance note off the subtle background onto the card surface).
- Visual review at 1440×900, 1024×768, and 412×915 (standard config + a custom
  question with the options editor): no document-level horizontal overflow;
  standard rows stack with inline Required/Hidden captions on mobile.
- Backend/callable/rules checks: not applicable and not run — no Cloud Function,
  callable, or rule changed; `functions/node_modules` is not installed here, so
  the `publicProfileDto` Jest guard and backend lint were not run (recorded
  honestly). The frontend-side public consumers are covered by the regression
  above.
- Pre-existing latent behavior left unchanged (documented, not fixed here): the
  `publicProfileDto` allowlist strips `addressHistory`/`employmentHistory`/
  `referralSource`/`mvrConsent` config, so those standard toggles do not
  currently take effect in the public application (`mvrConsent` is unused). This
  is a separate backend/allowlist concern; the data-shape-preserving UI does not
  introduce or change it.
- Commit/PR: feature commit + docs commit on
  `claude/company-profile-security-migration-mjdbm1`; PR into `main`.

### E-Docs envelope history completion log (GO)

- Date: 2026-07-24.
- Starting baseline: `main` at `e8f5cb1` (Merge PR #98 — LaunchPad dismissal
  hardening). PR #98's final head `19d6df7` had all 8 CI lanes green, so nothing
  needed resolving before starting.
- Scope: `src/features/signing/components/EnvelopeHistory.jsx` only.
  `DocumentsManager`, `EnvelopeCreator`, `TemplatesPanel`, `SendTemplateModal`,
  backend functions, Firestore rules and Storage rules were not touched.
- Go/no-go decision: **GO.** The full data and action contract was frozen before
  any presentation change: a `signing_requests` `onSnapshot` subscription ordered
  by `createdAt desc`, a direct `updateDoc` void write, and two callables
  (`getSigningLink`, `getSignedDocumentUrl`). All three are mockable, the change
  is presentation-only, no permission or rule is involved, and the component's
  single consumer (`DocumentsManager`) passes exactly `companyId` + `onCorrect`,
  which is unchanged.
- `DataTable` adoption is a genuine fit here, explicitly unlike
  `CampaignResultsTable`/`DetailedReportModal`: this table has no max-height
  vertical scroll and no sticky header needing a definite-height ancestor, and no
  exact loading string had to be preserved (the old loading state was a bare
  unannounced spinner). So `DataTable`'s built-in `isLoading`, `empty`, `error`
  and horizontal scroll region cover every state — note that the design system
  has no `PageState` primitive, contrary to the older Phase 13 column text.
- Preserved contracts: the exact `companies/{companyId}/signing_requests` query
  and `orderBy('createdAt','desc')`; the unsubscribe on unmount; the
  `if (!companyId) return` guard placed *before* `setLoading(true)` (so with no
  company the table stays in its loading state, exactly as before); the
  `{status:'voided', voidedAt: serverTimestamp()}` write and its document path;
  the verbatim `window.confirm` text including the `"this document"` fallback;
  `getSigningLink({companyId, requestId})` and the clipboard write;
  `getSignedDocumentUrl({storagePath})` with the `gs://` bucket-prefix stripping,
  the `signedPdfUrl || storagePath` source, and `window.open(url,'_blank')`;
  every toast string and the `functions/not-found` mapping; the locally-obtained
  `getFunctions()` in both handlers; the case-sensitive `status === 'signed' |
  'voided' | 'sent'` action-visibility rules (deliberately left case-sensitive
  while the badge lowercases — pre-existing behavior, not changed here); the
  `emailStatus === 'failed'` override with its 80-character truncation and
  `'Email delivery failed'` fallback; the delivery-method rules
  (`sendEmail === false && sendSms !== true` → Manual); and the
  `Untitled` / `—` / `--` fallbacks.
- Accessibility fixes: the 9 px delivery-method pills are gone (approved 12 px
  `Badge`s); status is text + icon in a toned `Badge`, never colour alone;
  per-row action names are unique and start with their visible text
  (`Download <title>`, `Link for <title>`, `Correct <title>`, `Void <title>`,
  satisfying WCAG 2.5.3), replacing four repeated `Link`/`Void` names per table;
  the document title is the row header; loading and empty are announced
  (`role="status"`); the horizontal scroll region is labelled and
  keyboard-focusable.
- Behavior improvement (the one intentional non-presentation change, requested as
  part of the slice): a snapshot error previously left the operator staring at an
  empty history. The `onSnapshot` error callback now also sets a visible
  `role="alert"` state ("Could not load document history. Please try again."),
  while the subscription, the `console.error`, and every other code path stay
  byte-for-byte the same.
- Focused tests: 46 unit tests in
  `src/features/signing/components/EnvelopeHistory.test.jsx` (subscription/query/
  unsubscribe/guard, all six status mappings + unknown fallback, email-failure
  override and truncation boundaries at 80/120 chars, delivery-method
  combinations, every fallback, action visibility per status and with/without
  `onCorrect`, the exact void write + confirmation + failure, per-row busy states,
  copy-link payload/clipboard/error-message fallback, download raw-path/`gs://`/
  `storagePath`-fallback/`functions/not-found`/generic error, keyboard action
  activation, no 9 px or 10 px text, `vitest-axe` across mixed row states, and an
  explicit assertion that the signing link never enters the DOM).
- E2E: `e2e/edoc-envelope-history.spec.cjs`, 10 passed across Chromium and Mobile
  Chrome (labelled keyboard-reachable scroll region, the five-column contract,
  the announced data state, no document overflow at 1440/1024/412, scoped
  real-browser axe with no serious/critical or contrast violations). The
  `e2eEdoc=mock` harness stubs templates but not `signing_requests`, and seeding
  it would mean editing `DocumentsManager` (out of scope), so the browser layer
  asserts the shell and the vitest suite owns row/action behavior — recorded
  honestly rather than papered over.
- Existing E-Doc regressions: `edoc-recruiter-send-and-sign.spec.cjs`,
  `edoc-recruiter-send-flow.spec.cjs` and `guest-post-application-edoc.spec.cjs`
  — 20 passed on Chromium + Mobile Chrome.
- Full frontend suite: 107 files / 991 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate passed at 34.58% statements / 32.34% branches / 34.2% functions / 35.37%
  lines.
- Frontend lint: 0 errors (158 pre-existing warnings); typecheck and production
  build passed; `git diff --check` clean. Every `--ds-*` utility used by the
  component was verified as an emitted selector in `dist/assets/main-*.css`
  (the Phase 13 lesson about CSS-variable-only tokens being dropped from the
  build).
- Privacy: recipient names, emails, phone numbers, signing links and document
  URLs are treated as sensitive. All fixtures are artificial — RFC 2606 reserved
  `example.test` domains and a fictional `555-0142` number — no real signing link
  or document URL is asserted, logged or snapshotted, and no screenshot of
  populated history data was taken.
- Backend/callable/rules checks: not applicable and not run — no Cloud Function,
  callable or rule changed. `functions/node_modules` is not installed in this
  environment, so `npm run lint:backend` cannot run here (pre-existing; CI covers
  it).
- Remaining E-Docs slices: `DocumentsManager` (page shell, tabs, post-application
  template configuration) and `EnvelopeCreator` (PDF field placement) stay open as
  separate audited slices.

---

### Documents Center header completion log (GO)

- Date: 2026-07-24. PR #100, merged as `bfe4563`.
- Starting baseline: `main` at `3e61a30` (Merge PR #99 — envelope history).
- Scope: the page header area of
  `src/features/company-admin/views/DocumentsManager.jsx` only.
- Go/no-go decision: **GO.** The header holds no data contract: back navigation
  is a single `navigate('/company/dashboard')` call and the two create actions
  are pure local state transitions, so nothing needed freezing beyond their call
  order.
- Migrated: the legacy `min-h-screen bg-gray-50 p-6 sm:p-8` canvas plus its
  `max-w-6xl mx-auto space-y-6` wrapper became `bg-ds-canvas` +
  `PageContainer width="standard"` + `Stack gap="lg"`; Back to Dashboard,
  Create Template and Send One-off became approved `Button`s (ghost / secondary /
  primary) with their icons inheriting the button's content colour; the heading
  moved into `PageHeader` with the `FileSignature` icon on
  `text-ds-action-primary` and `aria-hidden`, so the accessible name stayed
  exactly "Documents Center"; the actions sit in a wrapping `Inline` and the
  header is allowed to wrap, so they drop to their own line instead of
  overflowing at narrow widths.
- Preserved contracts: `navigate('/company/dashboard')`, and both create actions'
  exact call order — `setEditRequestId(null)`, `setEditTemplateId(null)`,
  `setCreatorInitialMode('template' | 'request')`, `setViewMode('create')`.
- Verification: 9 focused tests; `edoc-recruiter-send-flow`,
  `edoc-recruiter-send-and-sign` and `edoc-envelope-history` passed with 26
  Chromium + Mobile Chrome checks; frontend lint 0 errors; production build and
  `git diff --check` passed; `bg-ds-canvas`, `flex-wrap`, `self-start` and
  `text-ds-action-primary` were each confirmed as emitted selectors in
  `dist/assets/main-*.css`.
- Notes: the tab and content blocks moved one indent level because their wrapper
  changed; their markup, classes, logic and props were byte-identical otherwise.
  The roadmap was deliberately not touched in that slice at the owner's request,
  and is recorded here instead.

---

### Documents Center navigation and template-management completion log (GO)

- Date: 2026-07-24.
- Starting baseline: `main` at `bfe4563` (Merge PR #100 — Documents Center
  header). All eight PR #100 lanes completed green on head `e5d1e08` before the
  merge, and local `main` was confirmed equal to `origin/main` with a clean tree.
- Scope: the History/Templates tab navigation inside
  `src/features/company-admin/views/DocumentsManager.jsx` and the complete
  presentation of
  `src/features/company-admin/components/documents/TemplatesPanel.jsx` — one
  cohesive navigation and template-management surface.
- Go/no-go decision: **GO**, taken after auditing every prop and callback.
  `activeTab` is pure local state with two values and no side effect, so the tab
  interface is presentation-only. `TemplatesPanel` is already a props-only
  component: all thirteen props arrive from `DocumentsManager`, every callback
  has a fixed argument shape (`handleSavePostSubmitTemplates()` with no
  arguments, `togglePostSubmitRequired?.(templateId)`,
  `movePostSubmitTemplate(templateId, 'up' | 'down')`,
  `isTemplateEnabledPostSubmit(tmp.id)`, `togglePostSubmitTemplate(tmp.id)`,
  `handleUseTemplate(tmp)`, `handleEditTemplate(tmp)`,
  `handleDeleteTemplate(tmp.id)`), and all of them are mockable, so the entire
  behaviour could be frozen in tests before any markup changed. No Firestore
  read/write, callable, send path or rule is involved.
- Tab contract preserved exactly: initial value `'list'`; only `'list'` and
  `'templates'` exist; History selects `'list'` and Templates selects
  `'templates'`; History still renders
  `<EnvelopeHistory companyId={currentCompanyProfile.id} onCorrect={handleCorrect} />`
  and nothing else (a test asserts the prop set is exactly those two); and
  `TemplatesPanel` still receives all thirteen props (a test asserts the exact
  key set). `handleCorrect`, the creator transitions, `showDriverPicker`, the
  `SendTemplateModal` wiring, the subscriptions, queries, writes, callable names
  and payloads, and the E2E mock behaviour are unchanged; a test proves that
  switching tabs performs no Firestore write, no callable and no navigation.
- Accessible tab interface (feature-owned — the design system has no approved
  Tabs primitive, and `SectionNavigation` is a vertical `nav` with Up/Down keys,
  so it does not fit a horizontal tab interface): `role="tablist"` labelled
  "Document Center views", `role="tab"` with stable per-instance ids,
  `aria-selected`, `aria-controls` pointing at the single always-present
  `role="tabpanel"`, the panel's `aria-labelledby` tracking the selected tab,
  roving `tabIndex` (only the selected tab is in the tab order), ArrowLeft /
  ArrowRight with wrap-around, Home / End, automatic activation so focus follows
  selection, a `focus-visible:shadow-ds-focus` ring, a 44 px-tall activation
  area, decorative icons `aria-hidden`, and a visually hidden "(selected)"
  suffix so selection is never carried by the underline colour alone.
- `TemplatesPanel` contracts preserved: the `postSubmitRequiredById = {}`
  default; the exact heading "Post-Application Success Page Forms" and its
  explanatory copy and meaning; `handleSavePostSubmitTemplates` on Save Forms
  with `savingPostSubmitTemplates` driving the disabled/loading state; the exact
  empty messages "No follow-up forms enabled yet." and "No templates saved
  yet."; the `postSubmitTemplateIds` order; the
  `templates.find((item) => item.id === templateId)` lookup returning `null` for
  a missing template; `postSubmitRequiredById[templateId] !== false` as the
  required rule; `togglePostSubmitRequired?.(templateId)` including the optional
  call; `movePostSubmitTemplate(templateId, 'up' | 'down')` with move-up
  disabled on the first row and move-down on the last; the
  `template.title || 'Complete Form'` fallback; `templatesLoading` behaviour;
  the original `templates` array order; `tmp.fields?.length || 0`; and the exact
  delete/use/edit/post-submit callback arguments.
- `TemplatesPanel` presentation: approved `Card` for the post-application
  section and for every template; approved `Button` for Save Forms, Use and
  Edit; approved `IconButton` for the two move controls and for Delete; an
  approved `Badge` for the field count, which replaces the unsupported 10 px
  uppercase text without changing its value; `Stack` and `ResponsiveGrid`
  instead of the hand-rolled grid; and the hover-only Delete control is now
  always rendered, keyboard-reachable and left at the default 40 px size so its
  touch target matches the card's other actions.
- Accessible names: every card action is unique and starts with its visible text
  where it has any — `Delete <title>`, `Use <title>`, `Edit <title>` (WCAG
  2.5.3) — and the ordering controls are `Move <title> up` / `Move <title> down`.
  A disabled ordering control keeps a tooltip explaining why ("<title> is
  already first"/"already last"), because a disabled button is skipped by
  keyboard focus. The post-application Required checkbox is named "Required for
  <title>" so rows are distinguishable; the card checkbox keeps exactly "Show on
  post-submit success page", since the card's own heading supplies the template
  and repeating the title would put a second copy of it in the card's text.
- Checkboxes: the design system still has no approved Checkbox primitive, so
  both native checkboxes stay feature-owned documented compositions with a
  programmatic label, `accent-ds-action-primary`, a visible
  `focus-visible:shadow-ds-focus` ring, a measured 44 px activation row and no
  nested interactive controls.
- Focused tests: 22 in `DocumentsManager.test.jsx` (default History selection,
  switching both ways, roles and ARIA relationships, roving tabIndex,
  ArrowLeft/ArrowRight with wrap, Home/End, focus following selection, ignored
  keys, the exact `EnvelopeHistory` prop set, `onCorrect` opening the creator in
  request mode, the exact `TemplatesPanel` prop set, no Firebase write/callable/
  send on tab switches, and axe on both tabs) and 35 in
  `TemplatesPanel.test.jsx` (all props and defaults, loading state, both exact
  empty messages, save callback and saving state, required default true and
  explicit optional, the exact Required callback value, the optional-callback
  guard, missing-template null handling, id ordering, move directions and
  disabled boundaries, the field-count value including the missing-array
  default, the exact post-submit checkbox values and callback, the exact delete
  id, whole-object Use/Edit arguments, unique accessible names, keyboard
  activation, native checkbox labels, no 9 px/10 px classes, no raw hex colours,
  long-title wrapping, row wrapping, and axe across loading/empty/populated).
- E2E: `e2e/edoc-documents-tabs-and-templates.spec.cjs`, 12 passed across
  Chromium and Mobile Chrome (default History, switching both ways, keyboard
  ArrowRight/Home/End with focus following selection, tab-to-panel wiring,
  card actions visible without hover, no document overflow at 1440/1024/412, and
  a scoped real-browser axe pass with no serious/critical or contrast
  violations).
- Existing regressions: `edoc-recruiter-send-and-sign` (14),
  `edoc-envelope-history` (10) and `guest-post-application-edoc` passed on
  Chromium + Mobile Chrome. `edoc-recruiter-send-flow` needed two **selector**
  updates and no behaviour change: the Templates control is now `role="tab"`
  rather than `role="button"`, and the template's Use action is now
  `Use E2E Test Document` rather than a bare `Use`. The flow it asserts —
  Templates → Use → Send Document → signer handoff route — is unchanged and
  passes.
- Full frontend suite: 109 files / 1048 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate passed at 35.55% statements / 32.85% branches / 35.22% functions / 36.31%
  lines.
- Frontend lint 0 errors (158 pre-existing warnings); typecheck, production build
  and `git diff --check` passed. Every new `--ds-*` utility was verified as an
  emitted selector in `dist/assets/main-*.css` (`rounded-t-ds-xl`,
  `border-ds-action-primary`, `min-h-11`, `accent-ds-action-primary`,
  `bg-ds-status-accent-bg`, `text-ds-status-accent-fg`, `bg-ds-status-info-bg`,
  `border-ds-status-info-border`, `px-ds-5`, `py-ds-4`).
- Measured responsive review at 1440×900, 1024×768 and 412×915 on the Templates
  tab: `document.documentElement.scrollWidth` equalled the viewport at every
  width (no document-level horizontal overflow); both tabs stayed visible and
  operable at 54 px tall; the checkbox activation row measured 44 px; and Use,
  Edit, Delete and Save Forms were all visible without hover (Use/Edit 335 px
  wide at 1024 and 165 px at 412, Delete 40 px square, Save Forms full-width at
  412).
- Retained motion: the only animations left are the panel's `animate-in`
  transition and the loading spinner, both already neutralised by the global
  `prefers-reduced-motion: reduce` rule in `src/shared/styles/designTokens.css`.
- No raw hexadecimal colours and no 9 px or 10 px interface text remain in either
  file (asserted in tests and re-checked by grep).
- Privacy: every fixture is an artificial template ("Artificial Offer Letter",
  "Artificial Policy Acknowledgement", "Artificial Equipment Checklist") or the
  existing `E2E Test Document` mock. No real document, recipient or signing
  information appears, nothing is snapshotted, and no send is triggered.
- Backend/callable/rules checks: not applicable and not run — no Cloud Function,
  callable or rule changed. `functions/node_modules` is not installed here, so
  `npm run lint:backend` could not run locally (pre-existing; CI covers it).
- Pre-existing failure recorded honestly, not introduced here: the non-blocking
  `@a11y` **public signing room** journey in `e2e/a11y.spec.cjs` reports
  `color-contrast x1` and `label x3`. This was reproduced on clean `main` with
  this slice's changes stashed, is inside the signing room (`EnvelopeCreator` /
  signer surface) which is explicitly out of this slice's scope, and belongs to
  the still-open signing slice. The CI `e2e-a11y` lane is
  `continue-on-error: true`, which is why it has not blocked.
### `EnvelopeCreator` audit and sub-slice plan (2026-07-25)

The creator was audited before any edit. It is already split into a shell plus
five child modules, which gives clean seams. Risk was measured by counting
geometry/gesture/PDF concerns (`onMouseDown|onMouseMove|clientX|clientY|
getBoundingClientRect|xPercent|yPercent|zoom|scale|Document|Page`) per file:

| Module | Risky concerns | Planned sub-slice |
| --- | --- | --- |
| `EnvelopeCreator.jsx` shell (top bar, hydrating screen, layout wrapper) | 0 in the shell region | **A — done 2026-07-25** |
| `FieldPropertiesPanel.jsx` | 0 | **B — done 2026-07-25** |
| `fieldDefinitions.jsx` | 0 | definitions/icons only; its palette-`color` strings are consumed solely by the sidebar and moved with **C — done 2026-07-25** |
| `EnvelopeSidebar.jsx` | 3 | **C — done 2026-07-25** |
| `DateTripletField.jsx` (shared) | 0 geometry, but legacy selects + raw palette | **D — done 2026-07-25**; closes the gap recorded on PR #102 |
| `ResizableDraggableField.jsx` | 7 (drag/resize) | **E — done 2026-07-25** |
| `PdfFieldWorkbench.jsx` | 12 (PDF render, zoom, page refs, coordinates) | **F — done 2026-07-25** |

Each sub-slice gets its own audit, tests, E2E and PR, ordered safest first. No
sub-slice may share a diff with another. Field geometry, zoom, drag/drop,
upload, Firebase, template, routing and permission contracts are frozen across
all of them; sub-slices A–D must not touch any of that logic at all.

### Sub-slice A — creator shell — completed 2026-07-25 (GO)

- **Scope:** the top bar only (heading matrix, creator-mode toggle, Cancel, save
  action), the hydrating screen and the layout/rail wrapper. **36 insertions /
  23 deletions**, verified to touch zero lines containing `handleSave`,
  `addField`, `updateFieldPosition`, `updateFieldSize`, `uploadBytes`,
  `writeBatch`, `storagePath`, `xPercent`, `pdfViewportWidth` or `accessToken`.
- **Frozen and verified unchanged:** props (`companyId`, `onClose`,
  `initialMode`, `editRequestId`, `editTemplateId`, `companyName`); the
  `creatorMode` initialiser (`editTemplateId ? 'template' : initialMode`) and its
  `'request'`/`'template'` values; the four-case heading matrix (Edit Template /
  Correct Document / Create Template / New Envelope); the toggle visibility rule
  (`!isEditingRequest && !isEditingTemplate`) and its exact `setCreatorMode`
  arguments; `onClose` on Cancel; `handleSave` with `disabled={loading}`; the
  four-case save-label matrix (Save Template Changes / Save Correction / Save
  Template / Send Document); the `Loading document for editing...` copy; the
  `w-80`/`w-0` properties-rail rule; and every prop handed to `EnvelopeSidebar`,
  `PdfFieldWorkbench` and `FieldPropertiesPanel`.
- **Presentation/accessibility:** approved `Button` for Cancel, the save action
  and both toggle options; the mode toggle is an `aria-label`led group exposing
  `aria-pressed` so selection is never colour-only; the hydrating screen and an
  in-flight save both announce through `role="status"`; `--ds-*` tokens replace
  the raw gray/white/blue/purple palette; the rail transition respects
  `motion-reduce`. The save button no longer changes hue by mode — the label
  already distinguishes the action, and both are the approved primary variant.
- **Evidence:** 21 focused shell tests (heading matrix ×4, toggle visibility in
  both editing modes, `aria-pressed` both ways, keyboard reachability, save-label
  matrix ×4, `onClose`, the preserved "Please upload a file and place at least
  one field." guard proving `handleSave` is still wired, the announced hydrating
  screen, the rail collapse rule, the full frozen prop sets for all three
  children, 9/10 px guardrail and two `vitest-axe` passes). Whole-file coverage
  is 33% statements — expected and reported honestly: this sub-slice covers the
  shell only, and the save/hydration/field logic it deliberately does not touch
  is left for sub-slices B–F. Full frontend suite 1120 tests passed; lint 0
  errors; typecheck, build and `git diff --check` passed. Playwright ran one
  suite at a time: the new `edoc-envelope-creator-shell.spec.cjs` passed 7 on
  Chromium and 6 on Mobile Chrome, then the full E-Docs sweep of **36 Chromium
  checks**. Real-browser axe scoped to the top bar found no serious/critical and
  no color-contrast violations. The spec never activates the save action, so no
  Firestore or Storage write is attempted.
- **Remaining E-Docs work:** sub-slices B–F above.

### Sub-slice B — field properties panel — completed 2026-07-25 (GO)

- **Decision: GO.** `FieldPropertiesPanel.jsx` takes three props
  (`activeField`, `updateActiveField`, `getIcon`), is wrapped in `React.memo`,
  holds no state and performs no I/O. It contains zero geometry, gesture, PDF,
  upload, Firebase or permission concerns, so it is presentation-only by
  construction. `EnvelopeSidebar`, `DateTripletField`,
  `ResizableDraggableField`, `PdfFieldWorkbench`, Firebase, Storage and rules
  were not touched.
- **Frozen and verified unchanged:** the `if (!activeField) return null` guard;
  the `"<type> Field"` heading and its `getIcon(activeField.type)` delegation;
  the label input (`activeField.label || ''` → `updateActiveField('label', …)`,
  placeholder `Field Label`); the Required toggle
  (`updateActiveField('required', !activeField.required)`); the Read Only
  toggle's **two paired writes** — `updateActiveField('readOnly', next)` then
  `updateActiveField('prefillPolicy', next ? 'locked' : 'editable')`, in that
  order; the Prefill Behavior value derivation
  (`prefillPolicy || (readOnly ? 'locked' : 'editable')`), its exact
  `editable`/`locked` options and labels, and its own paired writes in the
  reverse order; the default-value textarea (`rows={3}`, placeholder
  `Enter default value...`); the four documented tokens `{{full_name}}`,
  `{{email}}`, `{{phone}}`, `{{current_date}}`; the font-size options
  `Auto`/`10`/`12`/`14`/`18` with the `Auto (fit to box)`/`10pt`…`18pt` labels
  and the `Auto` fallback; and the rule that `signature`, `initial` and
  `checkbox` fields expose no prefill, default-value or formatting section.
- **Presentation/accessibility:** the two option toggles were previously
  icon-only `<button>`s nested **inside** `<label>` elements — they had no
  accessible name at all, put an interactive control inside a label, and
  conveyed state by icon colour alone. They are now native checkboxes with
  visible associated text, reusing the pattern already approved in
  `TemplatesPanel`: keyboard-operable by construction, state carried by the
  control itself. Every text control moved to `FormField` + `Input`/`Select`/
  `Textarea`, so each one has a real programmatic label. All four `text-[10px]`
  blocks became `text-ds-xs` (12px), and the raw gray palette became `--ds-*`
  tokens.
- **Evidence:** 30 focused unit tests covering the null guard, the heading and
  icon delegation, the label value/placeholder/fallback/update, both toggles in
  both directions with `toHaveBeenNthCalledWith` on the paired writes, the
  prefill derivation matrix, the exact option value/label lists, the
  default-value contract, all four tokens, the font-size matrix and fallback,
  the content-less-type rule across `signature`/`initial`/`checkbox` and the
  `text`/`date` counter-cases, the 9/10 px guardrail and two `vitest-axe`
  passes. Migrated-file coverage is **100% statements / 100% branches / 100%
  functions / 100% lines**. Lint 0 errors; the `src/features/signing` suite is
  170/170 green. Playwright ran one suite at a time: the new
  `edoc-field-properties-panel.spec.cjs` passed **9 on Chromium and 1 on Mobile
  Chrome**, then the full E-Docs sweep passed **76 checks** across Chromium and
  Mobile Chrome. Real-browser axe scoped to the rail found no serious/critical
  and no color-contrast violations on either lane. The spec attaches an
  artificial PDF and never activates the save action, so no Firestore or
  Storage write is attempted and no real document, recipient or signing link is
  used.
- **Open gap recorded, not fixed here:** the creator keeps a fixed three-column
  layout (256 px palette + workbench + 320 px rail) inside an
  `overflow-hidden` row, so below roughly 600 px the properties rail is
  horizontally clipped — measured at a Pixel 7 width of 412 px the rail starts
  at x=320 and only 146 px of it is on screen. This predates the migration and
  lives in the shell layout, not in `FieldPropertiesPanel`, and the `w-80`/`w-0`
  rail rule is frozen by sub-slice A. The mobile E2E lane therefore asserts only
  what clipping cannot affect (control names, values and contrast), and the
  desktop interaction tests skip that lane with an explicit reason. **This
  responsive gap must be resolved as part of sub-slice C/F, where the sidebar
  and workbench columns are owned.**
- **Remaining E-Docs work:** sub-slices E and F above. C and D completed 2026-07-25.

### Send-template dialog (`SendTemplateModal`) — completed 2026-07-24 (GO)

- **Decision: GO.** The audit froze the contract before any edit. All 20 props
  are pure pass-through, the component holds no state, performs no I/O and adds
  no validation: recipient-name and delivery-specific validation stay in
  `executeTemplateSend`, and quick-select filtering stays in `filteredDrivers` —
  both owned by `DocumentsManager`. A presentation migration therefore cannot
  change behaviour provided every value, setter, order, key, id and string is
  preserved, which the focused tests assert individually.
- **Frozen and verified unchanged:** `selectedTemplate`, `onClose`,
  `manualName`/`setManualName`, `manualEmail`/`setManualEmail`,
  `manualPhone`/`setManualPhone`, `deliveryMethod`/`setDeliveryMethod`,
  `editablePrefillPartition`, `prefillValues`/`setPrefillValues`,
  `prefillValuesByGroupKey`/`setPrefillValuesByGroupKey`, `sending`,
  `executeTemplateSend`, `filteredDrivers`, `searchQuery`/`setSearchQuery`,
  `handleQuickSelect`. Also frozen: `slugPrefillGroupId` (string coercion,
  `[^a-zA-Z0-9_-]` → `_`, 96-char truncation); the delivery order/keys/labels
  `email→Email, sms→SMS, both→Both, copy→Copy Link`; the section-visibility rule;
  group then plain-field order; the `group.members` tooltip; the
  `— applies to N places` copy shown only above 1; every `DateTripletField` prop
  (`label=""`, `idPrefix`, `name`, `|| ''` value, `required={false}`,
  `maxToday`, `minYear={1920}`) and its functional merge; the grouped and plain
  functional merges; all placeholders and ids; the
  `sending || !manualName.trim()` disabled expression; the
  `Copy Signing Link` / `Send Document` texts; `filteredDrivers.slice(0, 20)`;
  the `No email` / `No phone` fallbacks with the visible `|` separator; and the
  `Or Quick-Select a Lead` / `No leads found.` copy.
- **The one documented behavioural hardening:** the legacy overlay had no
  backdrop dismissal *and no Escape handler at all*. Adopting the shared
  accessible `Modal` adds a focus trap, focus restoration and Escape dismissal,
  so dismissal is deliberately gated — `closeOnBackdrop={false}` preserves the
  previous "backdrop never closes" behaviour, `closeOnEscape={!sending}` keeps an
  in-flight send visible, and the explicit Close control is disabled while
  `sending`. No send operation, callback or parent state is touched.
- **Accessibility/presentation:** dialog named by its `Send Document` heading and
  described by the `Sending: <title>` subtitle; initial focus on Recipient name;
  all three recipient fields and the lead search use `FormField` + `Input` with
  visible labels (placeholders retained, so existing selectors keep working);
  delivery options are an `aria-labelledby` group of approved `Button`s with
  `aria-pressed` plus icon *and* text; the submit is an approved `Button` with an
  `aria-busy` loading state and a `role="status"` "Sending document…"
  announcement; quick-select rows stay native buttons whose accessible name
  starts with the driver name; the 10 px prefill labels became `--ds-*` xs; the
  panel is capped at `90vh` with one internal scroll region so the submit stays
  reachable at 412×915 without document scrolling; prefill and lead lists keep
  their internal scrolling; no raw hex colours and no animation were added.
  `FormField` takes a plain-string label, so grouped prefill labels — which carry
  the member tooltip and the applies-count fragment — compose the approved
  `Label` + `Input` pair directly instead; noted rather than worked around.
- **Documented temporary exception — nested `DateTripletField` (open gap).**
  Raised in review on PR #102 and accepted: templates whose prefill contains a
  `useDateTriplet` group render the shared `DateTripletField`, which is still on
  legacy local `<select>` controls and raw `gray`/`blue` palette classes rather
  than the approved `Select` and `--ds-*` tokens. That component is shared by
  several features (its date parsing/clamping is reused), so it was explicitly
  out of this slice's scope and its props are passed through untouched. The
  dialog's own surface is fully migrated; **this nested control is not**, so the
  slice is recorded as complete *with this stated exception* rather than as a
  blanket "SendTemplateModal is migrated" claim. Migrating `DateTripletField` to
  the approved `Select`/token contract is tracked here as its own small slice and
  should be scheduled alongside or before the remaining `EnvelopeCreator` work.
  **Closed 2026-07-25 by sub-slice D** (completion log below): `DateTripletField`
  now consumes the approved `Select` and `FieldMessage` with `--ds-*` tokens, so
  the nested control inside `SendTemplateModal` is no longer an exception and the
  dialog is migrated without qualification.
- **Review follow-up — quick-select rows now use the approved `Button`.** The
  first published revision composed each lead row as a local `<button>` owning
  its own sizing, focus and hover styling. Review flagged that as a competing
  button primitive inside a modal declared migrated; it was replaced with the
  approved `Button` (`variant="ghost"`, `fullWidth`, `justify="start"`), which
  carries two-line row content because the primitive uses `min-height` rather
  than a fixed height. No local button primitive remains in this file.
- **Evidence:** 51 focused unit tests (dialog name/close/backdrop/Escape both
  ways/disabled close/initial focus/trap/restore/busy; recipient values,
  placeholders, labels and exact setter arguments; delivery order, four keys,
  labels, setter argument per option, `aria-pressed`, keyboard; prefill
  visibility, ordering, slug transformation including special characters and a
  120-char key, tooltip fallback to member id, applies-count condition, every
  `DateTripletField` prop and all three merge paths preserving other keys;
  disabled expression, both button texts, busy state, exactly one
  `executeTemplateSend` per admitted activation and none while sending;
  quick-select search setter, empty message, 20-row slice, order, exact driver
  object, fallbacks, unique names, keyboard; plus 9/10 px and internal-scroll
  guardrails and two `vitest-axe` passes). Migrated-file coverage **100%
  statements/branches/functions/lines**. Sibling E-Docs units stay green
  (`DocumentsManager` 22, `TemplatesPanel` 35, `EnvelopeHistory` 46). Full
  frontend suite 110 files / 1099 tests passed (2 files / 48 emulator-gated rules
  skipped); lint 0 errors; typecheck, production build and `git diff --check`
  passed. Playwright ran one suite at a time:
  `edoc-send-template-modal.spec.cjs` 8 passed on Chromium and 7 on Mobile Chrome
  (viewport-specific skips), then the full E-Docs sweep of 29 Chromium checks
  including the untouched `edoc-recruiter-send-flow` regression — its heading,
  placeholder and button selectors still resolve, so **no E2E selector
  compatibility edits were needed**. Real-browser axe scoped to the dialog found
  no serious/critical and no color-contrast violations. Privacy: fixtures use
  only reserved `example.test` addresses and fictional `555-01xx` numbers, with
  no real recipient data, signing links or document URLs.

---

### Envelope creator sidebar completion log (GO)

- Date: 2026-07-25. Slice C of the owner-sequenced E-Docs close-out (C
  `EnvelopeSidebar` → D `DateTripletField` → E `ResizableDraggableField` → F
  `PdfFieldWorkbench` + final `EnvelopeCreator` close-out).
- Starting baseline: `main` at `4e0375c` (Merge PR #101 — Documents Center tabs
  and TemplatesPanel), all eight lanes green, local equal to `origin/main`, clean
  tree.
- Scope: `src/features/signing/components/envelope-creator/EnvelopeSidebar.jsx`,
  plus the `color` strings in the sibling `fieldDefinitions.jsx` — those strings
  are consumed **only** by this sidebar (verified by grep), so they are part of
  its presentation.
- Go/no-go decision: **GO.** The sidebar is a pure props-only component: it owns
  no state, no effect, no Firestore call and no upload logic. Every callback has
  a fixed argument shape — `setRecipientName/Email/Phone(e.target.value)`,
  `setDeliveryMethod(opt.key)`, `handleFileChange(event)`,
  `addField(item.templateId)`, `setSelectedFieldId(f.id)`, `removeField(f.id)`,
  `getIcon(f.type)` — and no external module references any of its internals
  (`#pdf-upload`, "Choose File", "Placed (" all had zero references outside the
  file). Upload validation, the 20 MB ceiling that must match `storage.rules`,
  and all field geometry stay in `EnvelopeCreator`.
- Preserved contracts: the recipient block still renders only when
  `creatorMode === 'request' && !isEditingTemplate`; the three inputs keep their
  `text`/`email`/`tel` types and report the raw input value; the four delivery
  options keep their exact keys and order (`email`, `sms`, `both`, `copy`) and
  labels (Email, SMS, Both, Link); the palette heading is still `Fields` in
  request mode and `Setup Fields` otherwise; the shortcut hint still appears only
  once a file exists; the file input keeps `accept="application/pdf"` and its
  `onChange`; the palette still renders `FIELD_CATEGORIES` in order and calls
  `addField` with the exact `templateId`; the placed list still appears only when
  `fields.length > 0`, keeps the `Placed (n)` count, the `P{page}` marker and the
  array order, and removal still stops propagation so it never also selects.
- Accessibility fixes: every 9 px and 10 px class is gone; the three recipient
  inputs have real programmatic labels instead of placeholder-only names; the
  delivery group is a labelled `role="group"` whose selection is carried by
  `aria-pressed` plus a check icon rather than colour; the placed rows were
  clickable `div`s containing a nested button — they are now a real row button
  plus a sibling named `IconButton` (`Remove <label> on page <n>`), so nothing
  nests interactive controls and both actions are keyboard reachable; palette
  buttons gained `Add <label> field` names and a 44 px activation height; and the
  file input moved from `display:none` (unreachable) to the approved
  visually-hidden input + `Button` trigger already used by the branding upload.
- Palette tones: the hard-coded Tailwind palette moved to semantic tokens. Only
  adjacent hues were merged (yellow+orange → warning, indigo+purple → accent), so
  the four visual groups — signature-style, date, signer info and data fields —
  stay distinct.
- Focused tests: 38 in `EnvelopeSidebar.test.jsx` (mode-dependent visibility,
  input types/values/required marking and the exact change payloads, all four
  delivery keys and the pressed state, the pre-upload state with a reachable
  input and a button that opens it, `handleFileChange` forwarding, the hint
  gating, the mode-specific palette heading, every category/item in order with
  exact `templateId`s, no legacy palette classes, the placed-list count/label/
  page/selection/removal contracts, no nested interactive controls, no 9–10 px
  text, no raw hex, the retained `w-64` and scroll behaviour, and `vitest-axe`
  across the pre-upload, populated and template-mode states).
- E2E: `e2e/edoc-envelope-sidebar.spec.cjs`, 10 passed on Chromium + Mobile
  Chrome (labelled complementary region, labelled inputs accepting typed text,
  delivery `aria-pressed` switching, a keyboard-focusable upload trigger, no
  document overflow at 1440/1024/412, scoped real-browser axe with no
  serious/critical or contrast violations). The creator is reached through the
  Documents Center "Send One-off" action under the e2eEdoc mock and the spec
  stops before any upload or send.
- Existing regressions: 42 E-Doc checks passed on Chromium + Mobile Chrome
  (`edoc-recruiter-send-and-sign`, `edoc-recruiter-send-flow`,
  `edoc-documents-tabs-and-templates`, `edoc-envelope-history`,
  `guest-post-application-edoc`).
- Full frontend suite: 110 files / 1086 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their environment guard. Coverage
  gate passed at 35.75% statements / 33.01% branches / 35.71% functions / 36.52%
  lines. Frontend lint 0 errors, typecheck, production build and
  `git diff --check` passed, and every new token utility was confirmed emitted in
  `dist/assets/main-*.css`.
- Measured responsive check: the creator's document width equalled the viewport
  at 1440×900, 1024×768 and 412×915, with the 256 px sidebar and its upload
  trigger visible at every width.
- Privacy: all fixtures are artificial — `pat@example.test`, `alex@example.test`
  and fictional `555-0142`/`555-0175` numbers. No real recipient, document or
  signing information appears, and nothing is snapshotted.
- Backend/rules: untouched. No Cloud Function, callable, Firestore rule or
  Storage rule changed, and the 20 MB upload ceiling that must stay in lock-step
  with `isValidFile` in `storage.rules` was not moved.
- **Reconciliation follow-up (2026-07-25).** Two items were closed after the
  slice merged:
  1. *Raw-button audit.* Every `<button>` in the sidebar was re-checked against
     `AGENTS.md`. The delivery toggle group moved to the approved `Button`
     (`primary` when selected, `secondary` otherwise, with `aria-pressed` and the
     check icon carrying state non-visually), matching the creator shell's mode
     toggle; each placed-field row moved to the approved `Button`
     (`ghost`/`fullWidth`/`justify="start"`), matching the precedent review set
     for the send dialog's quick-select rows. The eight field-palette buttons
     remain the **single documented exception**, recorded in-code and in the
     gap list above, because no approved `Button` variant carries a semantic
     status tone and that tone is the legend for the PDF overlay colours. Tests
     assert the exception is exactly those eight controls and nothing else.
  2. *CI break caused by this slice.* Sub-slice C renamed the palette buttons'
     accessible names to `Add <label> field`, and
     `e2e/edoc-field-properties-panel.spec.cjs` (added by sub-slice B) clicked
     them by the bare field label, so nine Chromium checks failed on `main`. The
     spec's two sidebar-dependent selectors were updated — the palette button by
     its new name, and the placed-field row by its `<label> P<page>` button
     instead of the page-badge text its own comment flagged as temporary. No
     behaviour changed. The gap in the original verification was running only the
     E-Doc specs already known to this session after merging the parallel
     session's work in, instead of the whole Chromium lane.

---

### Shared date-triplet field completion log (GO)

- Date: 2026-07-25. Sub-slice D of the E-Docs close-out.
- Starting baseline: `main` at `f9bfcf4` (Merge PR #105 — envelope creator
  sidebar), local equal to `origin/main`, clean tree.
- Scope: `src/shared/components/form/DateTripletField.jsx` only. The sibling
  `MonthYearField.jsx` shares the same legacy pattern but was **not** in this
  slice and stays open — it is not an E-Docs surface.
- Go/no-go decision: **GO**, after auditing all seven consumers (six
  driver-application steps — `Step1_Contact`, `Step3_License`, `Step4_Violations`,
  `Step5_Accidents`, `Step6_Employment`, `DynamicQuestionsStep` — plus
  `SendTemplateModal`) and every prop. The component's public surface is
  `label`, `idPrefix`, `name`, `value`, `onChange(name, isoOrEmpty)`, `required`,
  `helpText`, `minYear`, `maxYear`, `maxToday`; the date logic is
  self-contained and fully testable, and no consumer reaches inside it. One hard
  constraint was found and honoured: `e2e/public-application.spec.cjs` selects
  `#${idPrefix}-month`, `#${idPrefix}-day` and `#${idPrefix}-year` directly, so
  those element ids are a frozen contract rather than incidental markup.
- Preserved contracts (logic untouched, line for line): partial selections stay
  local so parts can be chosen in any order; the parent is emitted only once all
  three parts exist; walking a complete date back to incomplete clears the parent;
  the all-empty branch reports `''`; `buildIsoDate` zero-pads; day values clamp to
  the month length (including leap February); `maxToday` caps the year list, hides
  later months in the current year, limits days to today in the current month, and
  pulls a stored later date back to the cap when the year becomes the current year;
  the default year range is `minYear` through fifteen years ahead; `required` still
  reaches all three selects.
- Presentation and accessibility: the three `<select>`s became approved `Select`
  controls (`ds-form-control`), `helpText` became a `FieldMessage` associated to
  the group through `aria-describedby`, and every legacy class
  (`border-gray-300`, `text-gray-700`, `text-gray-500`, `focus:ring-blue-500`,
  `text-red-500`) is gone. The three dropdowns are now wrapped in a
  `role="group"` labelled by the field name, so the name is announced once
  instead of three times, and each control's own name is composed from it
  ("Date of Birth month") rather than a bare "Month". The required marker pairs
  its asterisk with an sr-only "required" instead of relying on red text, and the
  label-less variant keeps its "Required date" group name.
- Focused tests: 31 in `DateTripletField.test.jsx` — the frozen element ids, the
  group and composed control names, the label-less fallback, the required marker,
  help-text association, all six emit rules, hydration from and clearing by the
  parent, day clamping for 30-day and leap/non-leap February months, the day
  option count, the three year-range variants, all five `maxToday` behaviours,
  the approved control class with no legacy palette or raw hex, no 9–10 px text,
  and `vitest-axe` in three states. Time is frozen with fake timers so the
  `maxToday` assertions are deterministic.
- Consumer regressions: `public-application` (both guest submission paths),
  `guest-application-intake` and `edoc-send-template-modal` — 23 passed on
  Chromium + Mobile Chrome with 3 intentional viewport-specific skips. The
  public-application spec exercises the frozen ids directly, so it is the
  strongest evidence the id contract held.
- Full frontend suite: 114 files / 1219 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their guard. Coverage gate passed at
  37.38% statements / 38.18% lines. Frontend lint 0 errors, typecheck, production
  build and `git diff --check` passed.
- No E2E spec was added for this slice: the component has no route of its own, and
  its browser behaviour is already covered end-to-end by the public-application
  wizard specs that drive the real selects. Recorded rather than papered over.
- Privacy: all fixtures are artificial dates; no applicant, recipient or document
  data appears and nothing is snapshotted.
- Backend/rules: untouched.

---

### Placed-field overlay completion log (GO)

- Date: 2026-07-25. Sub-slice E of the E-Docs close-out.
- Starting baseline: `main` at `8540624` (Merge PR #109 — reconciliation), all
  eight lanes green, local equal to `origin/main`, clean tree.
- Scope: `ResizableDraggableField.jsx` only. `PdfFieldWorkbench`,
  `EnvelopeCreator`, the zoom hook and the field utilities were not touched.
- Go/no-go decision: **GO**, after freezing the whole geometry contract in tests
  *before* editing. The component takes eleven props from `PdfFieldWorkbench`
  (`field`, `pageNum`, `pageWidth`, `pageHeight`, `onStop`, `onResize`,
  `onRemove`, `getIcon`, `onLabelChange`, `isSelected`, `onSelect`), holds only
  derived size state, and performs no I/O — so the mathematics is fully testable
  in isolation with `react-draggable` stubbed.
- Frozen and verified unchanged: `(field.width / 100) * pageWidth` and the three
  sibling conversions; the `pageHeight || 800` fallback (a zero height counts as
  absent); the `useEffect` re-sync when the size props change; the 8 px minimum
  floor in both dimensions; the window-level `mousemove`/`mouseup` listener
  lifecycle including removal on `mouseup`; `onResize(id, (w / pageWidth) * 100,
  (h / safePageHeight) * 100)`; `onStop(id, pageNum, (x / pageWidth) * 100,
  (y / safePageHeight) * 100)`; `bounds="parent"`; the
  `cancel=".resize-handle, .label-input"` selectors and therefore both class
  names; the `size.width > 40` label-visibility threshold; `onSelect(field.id)`
  with `stopPropagation`; `onLabelChange(field.id, value)`; and `onRemove` firing
  on `mouseDown` so a drag never starts.
- Presentation and accessibility: field-type tones moved from the raw palette to
  `--ds-*` status tokens, merged only where hues were adjacent (signature +
  initial → warning), so the four groups still match the palette buttons
  one-for-one; the selection ring uses `ring-ds-focus`; the remove control gained
  `Remove <label> from page <n>` with an `Untitled field` fallback and a
  focus-visible ring; the label editor gained
  `Label for <type> field on page <n>`; the 9 px label text became `text-ds-xs`;
  and the resize affordance is no longer `opacity-0` until hover, so touch and
  low-vision users can see it.
- Focused tests: 31 in `ResizableDraggableField.test.jsx` with `react-draggable`
  replaced by a harness that records its props — position/size conversions, both
  page-height fallbacks, the size re-sync, the drag bounds and cancel selectors,
  the drop payload including a non-default page number, the resize payload, the
  8 px floor, live growth during the gesture, listener teardown after `mouseup`,
  selection with `stopPropagation`, the ring only when selected, label editing,
  both sides of the 40 px threshold, removal on `mousedown`, all five tone
  mappings, the retained cancel class names, the non-hover-only handle, no legacy
  palette/hex/9–10 px text, and `vitest-axe`.
- E2E: `e2e/edoc-placed-field-overlay.spec.cjs`, 6 passed on Chromium (6 skipped
  on the mobile lane with an explicit reason — the workbench is a desktop surface
  and its responsive gap is owned by sub-slice F). It places a field on an
  artificial inline PDF and asserts the named controls, the visible resize
  affordance, **a real pointer resize gesture** that grows the box and leaves the
  field inside its page, in-place label editing reflected in the sidebar's placed
  list, no document overflow at 1440/1024, and a scoped real-browser axe pass.
- Regressions: `edoc-field-properties-panel`, `edoc-envelope-sidebar`,
  `edoc-envelope-creator-shell` and the full `edoc-recruiter-send-and-sign`
  (including the document-first mobile signing gestures) — 47 passed on Chromium
  + Mobile Chrome.
- Full frontend suite: 115 files / 1254 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their guard. Lint 0 errors, typecheck,
  production build and `git diff --check` passed, and the new tokens
  (`bg-ds-status-warning-bg`, `border-ds-status-info-border`,
  `bg-ds-action-danger`, `ring-ds-focus`, `shadow-ds-md`) were each confirmed
  emitted in `dist/assets/main-*.css`.
- **Open item carried to sub-slice F:** placement is still pointer-only. The
  overlay cannot be moved or resized from the keyboard, and the resize affordance
  is deliberately `aria-hidden` because it has no keyboard behaviour to expose.
  Adding keyboard placement would change interaction behaviour rather than
  presentation, so it is recorded here for the F accessibility close-out instead
  of being smuggled into this slice.
- Privacy: all fixtures are artificial; the E2E PDF is generated inline and no
  real document, recipient or signing data is used or snapshotted.
- Backend/rules: untouched.

---

### PDF workbench and creator close-out completion log (GO)

- Date: 2026-07-25. Sub-slice F of the E-Docs close-out.
- Starting baseline: `main` at `c36beea` (Merge PR #110 — placed-field overlay),
  all eight lanes green, clean tree.
- Scope: `PdfFieldWorkbench.jsx`, the properties-rail layout in
  `EnvelopeCreator.jsx`, and keyboard placement in `ResizableDraggableField.jsx`.
- Go/no-go decision: **GO.** The workbench is props-only and holds no state; every
  contract the rest of the creator depends on was enumerated and frozen before
  editing.
- Frozen and verified unchanged: the `workbenchRef` the Ctrl/⌘+wheel listener
  tests with `el.contains(e.target)`; the canvas `onClick` that deselects; the
  toolbar's `stopPropagation` so its own clicks do not deselect; the exact
  `clampPdfViewportWidth(w ± 48)` steps; the `PDF_VIEWPORT_WIDTH_DEFAULT` reset;
  `zoomPercentLabel`; `onLoadSuccess({ numPages })`; the
  `pageRefs.current[pageNum]` registration; `data-page-num`; the
  `Page {n} / {total}` badge text; `renderAnnotationLayer`/`renderTextLayer`
  false; the `absolute inset-0 z-10 pointer-events-none` overlay layer; the
  `f.page === pageNum` filter; and `pageHeight={dims ? dims.height : 900}`.
- Workbench presentation and accessibility: canvas, page frames, active-page
  border and page badge moved to `--ds-*` tokens; the three zoom controls became
  approved `IconButton`/`Button` with real names (`Zoom out`, `Zoom in`, and
  `Reset zoom to 100 percent, currently N percent`) where before they carried only
  a `title` and were nameless to assistive technology; the toolbar is a labelled
  `role="group"`; a `role="status"` announces the level; and the 11 px toolbar and
  10 px badge text are now `text-ds-xs`.
- **Debt 1 closed — mobile rail clipping.** `EnvelopeCreator` rendered a fixed
  `w-64` sidebar, the workbench and a `w-80` rail in one non-wrapping row inside
  `overflow-hidden`, so below roughly 600 px the rail was pushed off-screen and
  its controls were unreachable. Below `md` it is now a full-width sheet
  (`fixed inset-y-0 right-0 max-w-sm`) with its own **Close field properties**
  control — necessary because the usual dismissal (clicking the canvas) is covered
  by the sheet. At `md` and above the markup is byte-identical to before
  (`md:static md:w-80 md:shrink-0`), and the dismiss control is `md:hidden`.
- **Debt 2 closed — pointer-only placement.** The overlay is now focusable
  (`tabIndex={0}`), selects on focus, carries the name
  `<label>, <type> field on page <n>` and an `aria-describedby` hint, and accepts
  arrow keys to move by 1 % (Shift: 5 %) and Alt+arrows to resize. This is purely
  additive: the pointer path is untouched, and the handlers emit the *same*
  `onStop`/`onResize` percentage payloads, clamped to the page as the keyboard
  equivalent of `bounds="parent"` — including re-clamping the other axis, so a
  field already past an edge is pulled back rather than left hanging.
- Focused tests: 114 across the three envelope-creator suites, of which 10 new
  keyboard-placement tests (focus selects, the name and hint, all four arrow
  directions, the Shift step, clamping at both edges, Alt resize in both
  dimensions, the 1 % resize floor, and ignored keys) plus two rewritten shell
  assertions for the responsive rail and its mobile-only dismiss control.
- E2E: `e2e/edoc-workbench-closeout.spec.cjs`, **14 passed** on Chromium +
  Mobile Chrome — named zoom controls with the announced level, zoom out/in/reset
  driven from the keyboard, keyboard move and Alt-resize of a placed field, **the
  rail on-screen and dismissible at 412 px** (the case that used to be clipped),
  the desktop rail staying inline with no document overflow, and a scoped
  real-browser axe pass.
- Regressions: `edoc-field-properties-panel`, `edoc-placed-field-overlay`,
  `edoc-envelope-creator-shell`, `edoc-envelope-sidebar` and the full
  `edoc-recruiter-send-and-sign` — **53 passed** on Chromium + Mobile Chrome.
- Full frontend suite: 115 files / 1266 tests passed; 2 files / 48
  emulator-dependent rules tests skipped by their guard. Lint 0 errors, typecheck,
  production build and `git diff --check` passed; new tokens confirmed emitted in
  `dist/assets/main-*.css`. No 9/10/11 px interface text and no raw hex remain
  anywhere in the envelope-creator tree or `EnvelopeCreator.jsx`.
- **Debt 3 still open — signing-surface axe findings.** The non-blocking `@a11y`
  public signing room journey reports `color-contrast x1` and `label x3`. Those
  are in `SigningRoom`/`SignerField`, a *different* surface from the creator, so
  they are deliberately **not** claimed by this slice; they are the subject of the
  final E-Docs audit rather than being folded into a workbench diff.
- Privacy: all fixtures artificial; the E2E PDF is generated inline. No real
  document, recipient or signing data is used or snapshotted, and no send occurs.
- Backend/rules: untouched.

---

### E-Docs final audit — area complete (2026-07-25)

- Baseline: `main` at `954976b` (Merge PR #111 — PDF workbench close-out), all
  eight lanes green, clean tree.
- **Debt 3 closed — signing-surface axe findings.** The non-blocking `@a11y`
  public signing room journey reported `color-contrast x1` and `label x3`. Both
  were reproduced directly against the running app and fixed:
  - *Contrast.* The "Finish & Submit" CTA used `bg-green-600` with white 14 px
    bold text, measured at **3.29:1** against a 4.5:1 requirement. Both the
    desktop and mobile instances now use `bg-ds-status-success-fg`
    (green-800, ≈6.5:1), which fixes the ratio while keeping the button's green
    identity rather than restyling the signer's primary action.
  - *Missing names.* The signer's date input and both checkbox overlays had **no
    accessible name at all** — they are absolutely positioned over the PDF, so
    there is nowhere to put a visible label, and a signer using assistive
    technology could not tell which box they were ticking. All three (plus the
    text input, for consistency) now take `aria-label` from the field's own
    label, with a `<type> field` fallback so the name is never empty.
  - Re-measured against the running signing room: **zero serious or critical
    violations**, down from four.
- **Repository-wide E-Docs sweep.** Across all eleven E-Docs surfaces —
  `DocumentsManager`, `TemplatesPanel`, `SendTemplateModal`, `EnvelopeCreator`,
  `EnvelopeHistory`, `EnvelopeSidebar`, `FieldPropertiesPanel`,
  `PdfFieldWorkbench`, `ResizableDraggableField`, `fieldDefinitions` and the
  shared `DateTripletField`: **no 9/10/11 px interface text, no raw hexadecimal
  colours, and no legacy Tailwind palette classes remain** (verified by grep, not
  by inspection).
- **Control audit.** Exactly three raw `<button>` groups remain in E-Docs, each
  now carrying a precise in-code exception *and* a tracked design-system gap:
  1. the Documents Center tablist (no approved Tabs primitive);
  2. the envelope creator's eight field-palette buttons (no toned `Button`
     variant, and the tone is the legend for the PDF overlay colours);
  3. the overlay's ~14 px corner remove badge (no compact icon-button size; the
     approved primitive's min-height would overflow a field whose minimum size is
     8 px).
  Four native checkboxes remain under the previously recorded Checkbox gap. A
  test asserts the palette exception covers exactly eight controls and nothing
  else, so a new raw button cannot appear unnoticed.
- **E-Docs is complete.** Every interactive surface consumes approved primitives
  and semantic tokens; every remaining exception is documented in code, recorded
  as a design-system gap, and retires when the missing primitive lands.
- Verification: full frontend suite green, signing suites 255 tests passing, the
  E-Doc Chromium/Mobile Chrome specs green, lint, typecheck, production build and
  `git diff --check` clean.
- Not claimed: the signing room's wider presentation is still legacy — this audit
  fixed its accessibility defects, not its styling. `SigningRoom` remains an
  unmigrated surface tracked under Phase 13's signing item, and no part of this
  entry claims otherwise.

---

### Public signing experience — campaign audit and plan (2026-07-25)

The public signing room is the last unmigrated E-Doc-adjacent surface. Audited in
full at `main` `991966e` and divided into the fewest reviewable slices:

| Surface | Lines | Slice |
| --- | --- | --- |
| `StatusScreens.jsx` — loading, error, voided, success, ESIGN consent | 144 | **1 — done 2026-07-25** |
| `SigningRoom.jsx` — shell, header, progress, zoom, PDF surface, navigation, submission | 632 | **2 — done 2026-07-25** |
| `SignerField.jsx` — the five field types + accessible naming | 147 | **3 — done 2026-07-25** |
| `SignatureSheet.jsx` — signature/initial capture sheet | 135 | **4 — done 2026-07-25** |
| Final audit, roadmap, grep sweep | — | **4 — done 2026-07-25** |

- `MonthYearField` is **not** part of this campaign: grep confirms its only
  consumers are `Step1_Contact` and `Step6_Employment` in the driver application,
  not any signing flow. It stays open under the shared-form-controls item.
- Frozen across the whole campaign: the `sign/:companyId/:requestId` route and its
  `token` query contract, `useSigningEnvelope`, the `submitSignature` callable,
  the draft read/write helpers, `markRequestSigned`/`readSigningReturnPath`, the
  percentage field geometry in `signerFieldStyle`, the flow helpers
  (`sortFieldsForFlow`, `isFieldComplete`, `findFirstIncompleteField`,
  `findNextField`), `ensureFieldVisible`, the pinch/zoom mathematics in
  `envelopePdfZoom` + `usePdfZoomGestures`, and the ESIGN consent gate that must
  precede document display.

### Signing status screens completion log (GO) — slice 1

- Date: 2026-07-25. Baseline `main` `991966e`, verified equal to `origin/main`
  with a clean tree; PR #112 confirmed merged with all eight lanes green.
- Scope: `src/features/signing/components/signing-room/StatusScreens.jsx`.
- Go/no-go: **GO.** All five screens are presentational: their only inputs are
  `error`, `recipientName`, `title`, `onAgree` and `onReturnToDocuments`, and
  their only side effect is `window.close()`.
- Frozen strings (several asserted by E2E and the `@a11y` journey):
  "Loading secure document...", "Access Denied", "Document Voided", the voided
  body copy, "Document Signed!", the sealed-and-sent sentence,
  "Return to Required Documents", "Close Window", "Decline",
  "Electronic Signature Consent", "Required before signing", the `a document`
  title fallback, all five disclosure clauses, and
  **"I Agree - Proceed to Sign"**. `window.close()` still backs every
  Close/Decline control and both callbacks fire unchanged.
- Accessibility: each screen is now a `<main>` landmark with exactly one `<h1>`,
  where previously the pages had no landmark and no heading level 1 at all — a
  signer landing on an expired or voided link heard an unlabelled page. The error
  and voided screens are `role="alert"`; the loading screen announces through an
  inner `role="status"` (not on `<main>`, which axe correctly rejects as an
  invalid role for that element — caught by the new unit axe pass); the ESIGN
  disclosure is a labelled `<section>` so its terms can be found and re-read; and
  every control is an approved `Button` where the Close/Decline actions were bare
  `<button>`s styled as text links.
- The success screen's entrance animation is now `motion-safe:`-gated, asserted
  by a test.
- Focused tests: 23 in `StatusScreens.test.jsx` — every frozen string, both
  success variants and their action order, `window.close()` wiring for all three
  Close/Decline controls, the disclosure region and all five clauses, the title
  fallback, approved-primitive assertions, one `<h1>` per screen, no legacy
  palette/hex/small text, reduced motion, and `vitest-axe` on all five screens.
- New approved primitive: **`StatusMedallion`** (`design-system/components/
  status-medallion`) — the toned circular icon disc above a status heading, with
  `neutral|info|success|warning|danger|accent` tones and `md|lg` sizes, always
  `aria-hidden` because the heading carries the meaning. Added in response to a P1
  review finding on PR #113: the first revision owned that reusable treatment in a
  feature-local `StatusIcon` (and a second inline copy on the consent screen),
  which the design-system policy prohibits without a recorded gap. The feature now
  keeps only the domain → tone/icon decision. 6 primitive tests.
- **Desktop/tablet/mobile visual review (measured, 2026-07-25).** Recorded in
  response to a second P1 review finding on PR #113, which correctly noted the
  first log claimed completion without this evidence:
  - 1440×900 — consent card 512 px centred; Decline and Agree side by side at
    225 px each; `scrollWidth` 1440 = viewport and `scrollHeight` 900 = viewport,
    so no overflow in either axis.
  - 1024×768 — identical side-by-side layout, card 512 px, no overflow.
  - 412×915 — the action row **stacks**: Decline and Agree each 330 px full-width,
    card 380 px inside the 412 px viewport, no horizontal or vertical overflow.
  - One `<h1>` and one `StatusMedallion` present at every width.
- **Keyboard review (measured, 2026-07-25).** Tab order on the consent screen is
  Decline → "I Agree - Proceed to Sign", matching DOM and visual order; both
  actions are reachable; the focused control carries a visible solid focus
  outline; and pressing Enter on the agree action proceeds to the document
  surface, so the ESIGN gate is fully operable without a pointer.
- Verification: signing suites 278 tests passing plus 6 new primitive tests; full
  suite, lint, typecheck, production build and `git diff --check` green.
- Also in this slice: the roadmap's E-Docs status was **self-contradictory** after
  PR #112 — a completion log declared the area done while the §5.1 inventory row
  still read "In progress" and claimed `ResizableDraggableField` and
  `PdfFieldWorkbench` were legacy. Raised as P2 in review on #112 and reconciled
  here so the permanent record states one status.

---

### Signing room shell completion log (GO) — slice 2

- Date: 2026-07-25. Baseline `main` `2d32aa9` (Merge PR #113 — status screens),
  all eight lanes green, clean tree.
- Scope: the presentation of `src/features/signing/SigningRoom.jsx`. The field
  overlays and the signature sheet remain legacy and are slice 3.
- Go/no-go: **GO.** The risky behaviour is concentrated in helpers and hooks that
  this slice does not touch, so the migration is confined to classes, control
  primitives and announcements.
- Frozen and verified unchanged: the fit-width computation and its
  `MAX_FIT_WIDTH`/`MIN_FIT_WIDTH` caps; `renderedWidth`; the pinch-zoom hook and
  `clampSignerZoom`; the `pageAspects` map and the explicit per-page
  width/height that keep overlay anchors stable while canvases re-render after a
  zoom commit; the `renderedPages` gate that keeps overlays inert until a page has
  painted; `ensureFieldVisible` and `scrollToField`; the auto-zoom bump for small
  focused fields (`MIN_COMFORTABLE_FIELD_PX`, `AUTO_ZOOM_MAX`); the `docReloadKey`
  retry that clears `numPages`/`renderedPages`; `100dvh` with the `h-screen`
  fallback and both safe-area insets; the draft write/clear helpers; and the
  submission path with `markRequestSigned`/`readSigningReturnPath`.
- Migrated: shell, header and scroller to `--ds-*` tokens; the progress chip to a
  `role="status"` so the remaining-field count is **announced** rather than only
  colour-coded; the zoom controls to a labelled `role="group"` of approved
  `IconButton`s; both submit CTAs, the desktop jump pill, the mobile "Next field"
  action and the document-error retry to approved `Button`s; the document-error
  card to `Card` + `StatusMedallion` + `role="alert"`; and the page-render and
  document-loading placeholders to announced `role="status"` regions. The bouncing
  jump pill is now `motion-safe:` gated.
- **Exception withdrawn; the gap was closed instead.** The first revision kept
  `className="bg-ds-status-success-fg"` over `variant="primary"` on both submit
  CTAs and recorded it as a documented exception. Review on PR #114 (P2) showed
  that override never took effect: a single-class utility is specificity
  `(0,1,0)` and `Button`'s own `.ds-button[data-variant='primary']` rule is
  `(0,2,0)`, so the shipped CSS kept the blue background **and** the blue hover
  state. The "exception" was dead code and the visual-verification claim for it
  was wrong. Corrected by closing the recorded toned-`Button` gap for real: the
  design system now owns `tone` (`default` | `success`) with
  `--ds-color-action-success{,-hover}` semantic tokens, and both CTAs use
  `tone="success"`. Two of the added `Button` tests assert the tone rule
  outranks the variant rule for background *and* hover, so the same class of
  silent-override mistake fails loudly next time; the shipped
  `dist/assets/main-*.css` was re-checked to confirm both rules and both tokens
  survive the production build. `Button`'s README now forbids feature-side
  background overrides on a `Button` and says to add a tone instead.
- Focused tests: 7 added to `SigningRoom.test.jsx` (header naming, the announced
  progress status, the labelled zoom group with named buttons, approved submit
  primitives, keyboard-reachable zoom, no legacy palette/hex/small text **scoped
  to the shell**, and the reduced-motion gate). The scope matters: the first
  revision asserted against the whole rendered tree and failed correctly, because
  the field overlays and signature sheet are still legacy — that is slice 3's
  work, so the assertion was scoped rather than weakened.
- Verification: 285 signing tests; full suite, lint, typecheck, production build
  and `git diff --check` green; `a11y.spec.cjs`,
  `edoc-recruiter-send-and-sign` and `guest-post-application-edoc` — 22 passed on
  Chromium + Mobile Chrome.
- Remaining: slice 3 (field layer, including the generic signer-name defect
  raised as P1 in review on PR #112) and slice 4 (final audit).

---

### Signer field layer completion log (GO) — slice 3

- Date: 2026-07-25. Baseline `main` `2d32aa9`; slice 2 open as PR #114.
- Scope: `src/features/signing/components/signing-room/SignerField.jsx` and the
  one line in `SigningRoom.jsx` that passes each field's position down.
  `SignerFieldOverlay` needed no change — it already carries only geometry and the
  44 px touch target. `SignatureSheet` moves to slice 4.
- **Closes P1 from review on PR #112.** The earlier accessibility fix gave every
  signer control an `aria-label` from its field label, which made axe's `label`
  rule pass — but the palette defaults label every checkbox "Checkbox", so an
  envelope with several of them still presented *indistinguishable* controls, and
  a generic name never identified the statement being accepted. The reviewer was
  right that the reported defect survived. Names now append stable contextual
  information: `"<label>, field <n> of <m> on page <p>"`, falling back to
  `"<type> field, …"` when the author supplied nothing and to `"<label>, page <p>"`
  when no position is available. Two identically labelled checkboxes are now
  "Checkbox, field 2 of 5 on page 1" and "Checkbox, field 4 of 5 on page 1".
  Position comes from `orderedFields` — the flow-sorted list the signing order
  already uses — so it is stable rather than DOM-order dependent.
- Frozen and verified unchanged: the `signed` short-circuit; the `isFieldLocked`
  rule and the static locked rendering for text and date; every
  `handleFieldChange` payload (string for text/date, boolean for checkbox); the
  focus and Enter-advance wiring; the signature-tap flow and its four aria-label
  variants; the rendered ink `<img>` with its alt text; and the
  `data-signer-input` hooks the E2E specs drive.
- Presentation: field tones moved to the same `--ds-*` status tokens the creator
  palette and placed-field overlays use, so the whole E-Doc family shares one
  colour legend; the attention pulse is `motion-safe:` gated; and the signature
  placeholder gained a visible focus treatment.
- Focused tests: 17 in `SignerField.test.jsx` — the two-identical-checkboxes case
  that motivated the fix, the type fallback, whitespace-only labels, date/text
  naming, the no-position fallback, the signed short-circuit, both change payload
  shapes, the `data-signer-input` hook, locked rendering, the signature sheet
  opening, the redraw wording with ink present, no legacy palette/hex/small text
  across all five types, the reduced-motion gate, the focus treatment, and
  `vitest-axe` for every field type.
- Verification: 302 signing tests; full suite, lint, typecheck, production build
  and `git diff --check` green; the three signing E2E specs — 22 passed on
  Chromium + Mobile Chrome.

### Signature capture sheet completion log (GO) — slice 4

- Scope: `src/features/signing/components/SignatureSheet.jsx` (135 lines), the
  last legacy component in the signing surface.
- Frozen: the accessible dialog name (`Draw your signature` / `Draw your
  initials`, which `SigningRoom.test.jsx` queries) · the Cancel / Clear /
  `Adopt & continue` controls and their `onCancel` / `clear` / `adopt` handlers ·
  the trimmed-PNG `onAdopt` payload and its `getTrimmedCanvas` → `toDataURL`
  fallback · `data-testid="signature-sheet-canvas"` · `touchAction: 'none'` ·
  `minWidth={1.2}`, `maxWidth={2.6}`, `velocityFilterWeight={0.7}` · the
  wrapper-measured canvas size with its resize/orientation re-measure · both
  safe-area insets.
- Migrated: every legacy palette class to `--ds-*` tokens; the three controls to
  approved `Button`s; `text-[11px]` legal text to `text-ds-xs` (12 px) on
  `content-secondary` rather than `gray-500`; the overlay to a new
  `bg-ds-overlay` Tailwind bridge for the `--ds-color-overlay` token that
  already existed but was unreachable from a utility class.
- **The dialog now delegates to the shared accessible `Modal`.** The hand-rolled
  overlay had `role="dialog"` and `aria-modal` but none of the behaviour those
  promise: no focus move-in, no focus restore, no Tab trap, and no Escape. All
  four now come from the shared primitive. The accessible name moves from a
  duplicated `aria-label` to `aria-labelledby` on the visible `<h2>` (identical
  string, so the frozen name is unchanged), and the legal consent paragraph
  becomes the dialog's `aria-describedby`. Backdrop dismissal is explicitly
  **off**: a stray tap outside the pad must not discard a half-drawn signature,
  which matches the behaviour this surface already had.
- Fixed a dead control: adopting an empty pad returned silently, with no
  explanation and nothing announced. The no-op contract is unchanged — `onAdopt`
  is still not called — but the reason is now announced through a `role="status"`
  region that is mounted before it has content, so the message is announced when
  it appears instead of the region arriving whole.
- **Documented non-migration.** `penColor` stays the literal `#0f172a` rather
  than a token reference. This is document *content*, not interface chrome: the
  PNG is stamped into a sealed, legally binding PDF, so re-theming the app must
  never be able to retint a document somebody has already signed. The value
  equals `--ds-color-slate-900`; the duplication is deliberate and explained at
  the constant.
- Focused tests: 18 in a new `SignatureSheet.test.jsx` — the frozen dialog name
  in both variants, all three handlers, the trimmed-PNG payload, the canvas hook
  and ink colour, all four empty-pad cases, Escape-cancels, backdrop-does-**not**
  cancel, focus move-in, the `aria-describedby` wiring, no legacy palette or
  small text, approved `Button`s on all three controls, and `vitest-axe` per
  variant. The safe-area assertion reads the source, not the DOM: happy-dom
  cannot parse `max(0.75rem, env(safe-area-inset-top))` and drops the
  declaration, so a DOM assertion would test happy-dom rather than the code.
- Added an `@a11y` E2E scan of the **open** capture dialog. The existing signing
  room scan can never reach it, because the pad only exists while the dialog is
  raised — and that is the step that actually binds the signer. 0 serious or
  critical violations.

### Public signing experience — final audit (2026-07-25)

Grep sweep across `src/features/signing` after slice 4:

- Legacy palette classes in non-test source: **none remaining.** The sweep found
  one that every prior slice missed — `ring-blue-500` in `SigningRoom`'s
  scroll-to-field flash — because it is applied imperatively via
  `classList.add`, so the slice 2 JSX-scoped assertion could not see it. Now a
  named `FIELD_FLASH_CLASSES` constant using `ring-ds-focus`, verified present in
  the built CSS. **Lesson recorded: a JSX-only legacy-class assertion does not
  cover classes added through the DOM API.**
- Raw hex in non-test source: only `SIGNATURE_INK`, documented above as document
  content. The other grep hits are `PR #112`/`#114` references in comments.
- 9/10/11 px interface text: none in source; the only matches are the assertions
  that forbid it.
- Raw `<button>` elements: three, each a documented feature-owned composition
  tied to a recorded gap — the creator's eight field-palette buttons (remaining
  toned-`Button` tones), the creator's ~14 px corner remove badge (compact
  icon-button size), and the signer's signature/initial placeholder. The last of
  these had **no** recorded exception until this audit; it is now documented at
  the call site. It must fill an author-placed box that can be as small as 8 px
  while carrying the dashed placeholder treatment and the stamped ink `img` at
  the box's own aspect, and the approved `Button`'s min-height, inline padding
  and background would break alignment with the PDF coordinates.

Not part of this campaign, and still open under their own items:

- `src/shared/components/signature/SignaturePad.jsx` is a **different** legacy
  signature control (`text-gray-400`); grep confirms its consumer is the
  verification respondent flow, not any signing route.
- `MonthYearField` remains untouched — its only consumers are `Step1_Contact`
  and `Step6_Employment` in the driver application. *(Closed 2026-07-27 by the
  public driver application campaign.)*

---

### Public driver application completion log (GO) — 2026-07-27

Scope: the whole production `/apply/:slug` experience plus the sandbox
application that reuses it verbatim — route status/error/loading screens, the
application shell, the shared `Stepper` frame and its progress/step navigation,
all nine active steps, the custom-questions step, the shared legacy form controls
this workflow uses, dynamic rows, radios, agreements and consent controls,
document uploads and upload feedback, validation and error focus, draft
restoration and persistence feedback, offline-queue behaviour, duplicate-submit
protection, final submission and success states, the post-application
required-document / E-Doc flow, and the sandbox controls that wrap the same
production wizard.

#### Enabling design-system work

Two recorded gaps blocked a clean migration, so both primitives were built first
rather than scattering local alternatives across ten files:

- `Checkbox`, `Radio`, `ChoiceGroup` (Phase 4 "Checkbox, Radio" gap). Native-first
  so the browser keeps owning the radio roving-focus model, required-group
  validation and autofill. Per-option `label` is mandatory. `requiredMark` splits
  the native `required` attribute from the visible/announced marker so a group's
  legend carries it once instead of every option announcing "Yes required".
- `ProgressBar` (Phase 5 "Progress"). Determinate only; mandatory accessible
  name; clamps `value`; accepts a non-percentage `max`; `prefers-reduced-motion`
  aware.

#### Defects found and fixed

1. **Repeated-row radio groups shared one id and one grouping name.** Inside
   `DynamicRow`, `Step5_Accidents` (`commercial`, `preventable`) and
   `Step6_Employment` (`mayContact`, `branch`, `heavyEq`, `honorable`) passed the
   bare field name, so every row rendered `id="commercial-yes"`. Ids must be
   unique: `label[for="commercial-yes"]` resolved to **row 1**, so clicking row
   2's "Yes" toggled row 1, and the browser treated all rows as a single radio
   group. Fixed with `idPrefix` / `groupName` row scoping while the saved field
   key is unchanged. Frozen by 4 regression tests.
2. **Every custom-question control was unlabelled.** In `DynamicQuestionsStep`
   the question text lived in a `<label>` that closed *before* the control was
   rendered, so no input, textarea, select, radio group, scale or file control
   had an accessible name — the step was unusable with a screen reader. Each type
   now gets a real label or a `ChoiceGroup` legend (13 labelling tests).
3. **The upload drop zone was a `<div onClick>`** — no role, no name, not
   reachable by keyboard. Now an approved `Button` that names its field.
4. **Upload progress, success and failure were silent.** Now `role="status"` /
   `role="alert"` live regions, plus a real `ProgressBar`.
5. **`Step3_License`'s missing-document message was a silent `<div>`.** Pressing
   Continue with a document missing announced nothing and focused nothing, and an
   unrelated upload completing then cleared the message — leaving a page that
   looked valid but would not advance. Now a focused `role="alert"`.
6. **Every step re-rendered a hard-coded "Step N of 9" heading** below the
   Stepper's own title: duplicated text, and *wrong* whenever custom questions
   made it ten steps. Removed; the Stepper title is now the page's single `<h1>`.
7. **Focus was dropped on every step change** (the Continue button that caused it
   unmounts), so keyboard and screen-reader users were never told the step
   changed. Focus now moves to the new step heading.
8. **Two competing scrolls per transition** — `PublicApplyHandler` scrolled
   instantly and `Stepper` smoothly. Now one owner, no animation to race.
9. **Progress was communicated by a `<div>`'s width alone.** Now `ProgressBar`.
10. **10 px / 11 px interface text** in the post-application checklist status
    pills and progress line, below the 12 px floor. Removed.
11. **The checklist row action wrapped its own status pill**, so its accessible
    name was "<title> Not started" and the retry control sat *inside* another
    control's hit area. Now a named `Button` beside the status.
12. **Eight review-step Edit controls were all named just "Edit".** Each now
    names its section.
13. **`Step9_Consent` injected a Google Fonts `@import`** for "Dancing Script" on
    every render of the most sensitive page in the product. Nothing used that
    family — a third-party request for no visual effect. Removed.
14. **The submit button was `type="submit"` inside `#driver-form`**, so Enter
    anywhere on the consent step could fire it. Now an explicit action button.
15. **`DynamicQuestionsStep`'s Back button had no `type`**, defaulting to
    `submit` inside the form and triggering native validation instead of
    navigating back.
16. **The legal disclosure boxes were mouse-wheel-only scroll regions** — a
    keyboard user could not read past the fold of text they must agree to. Now
    focusable, named regions.
17. **`Step4_Violations` had a `<label>` with no control** ("Motor Vehicle Record
    (MVR) Check"); same copy, now a real sub-heading. Its
    `className="sm:col-span-2"` also sat on the `<input>` rather than the grid
    item, so it did nothing.
18. **`--ds-color-content-muted` on `--ds-color-surface-subtle` measures
    4.34:1**, below WCAG AA. The real-browser axe scan found three nodes on the
    success screen. Call sites moved to `content-secondary`; the pairing is now
    pinned by a tokens test and recorded as a blocker.
19. **The shared toast's dismiss control had no accessible name** (axe
    `button-name`, **critical**, one node per visible toast) **and a 16×16 px hit
    area** (WCAG 2.2 AA SC 2.5.8 failure). The public application depends on
    toasts for upload, validation and draft feedback, so this was fixed in place;
    its palette migration was not bundled (see section 5.2).
20. **A shared-helper E2E determinism defect.** `wizardHelpers.cjs` clicked
    Continue immediately after three `setInputFiles` calls, and chained three
    unguarded Continue clicks. Details and the fix are in the determinism
    contract at the top of that file. This was the cause of the intermittent
    `consent-mvr-yes` timeout — the symptom appeared three steps away from the
    cause.

#### Verification

- **New focused unit tests: 171 across 12 new files** (measured, all passing):
  13 submission-contract (callable name and exact payload keys, the frozen
  `formData` envelope, queue→submit→dequeue ordering, 3-attempt retry then queued
  fallback, error when the queue is unsupported, draft/recruiter clearing,
  server-id preference, single-submit guard, the required-upload and signature
  gates with their step returns, email validation, the failed-draft-save message,
  recruiter query parameters), 21 Stepper frame, 12 Checkbox/Radio/ChoiceGroup,
  6 ProgressBar, 8 RadioGroup adapter (including 4 duplicate-id regressions),
  10 MonthYearField, 8 AgreementBox, 16 UploadField, 13 checklist, 17 status
  screens, 25 custom questions, 22 review. `tokens.test.js` also grew from 13 to
  19 cases. Existing driver-app, InputField, DateTripletField, primitives-axe and
  field-validation suites still pass unchanged.
- **Full frontend suite:** 1521 passed / 48 skipped (1569) across 131 passed / 2
  skipped (133) files — up from a 1344-passed / 119-file baseline on
  `9325398`. The two skipped files are the Firestore/Storage rules suites, which
  need emulators.
- **Coverage gate (`npm run test:coverage`):** passed — statements 41.57 %,
  branches 40.68 %, functions 42.03 %, lines 42.51 %.
- **Lint:** 0 errors. **Typecheck:** clean. **Production build:** succeeded.
- **Callable-contract verification:** `submitGuestApplication`,
  `createPostApplicationSigningRequest`, `listSandboxTenantCompanies`,
  `deleteSandboxApplication` and `transferSandboxApplication` are byte-identical
  in `git diff`, and the submission payload shape is asserted key-by-key.
- **E2E:** the six guest wizard specs pass serially at `workers: 1`, and 96/96
  across two high-contention rounds (Chromium + Mobile Chrome, `--repeat-each=4`,
  10 workers) — the configuration that reproduced the `consent-mvr-yes` flake
  before the fix. The full CI-equivalent Chromium suite was run serially.
- **Accessibility:** the `@a11y` lane now walks the *whole* application (chooser,
  every step, both dynamic-row types, all conditional explanations, review,
  consent, the success screen with its blocking checklist, and the queued screen)
  and reports **zero serious or critical axe violations on Chromium and Mobile
  Chrome**.
- **Responsive:** a new spec asserts, at 1440×900 / 1024×768 / 412×915 and at
  eleven checkpoints per width, no horizontal document overflow, no control below
  WCAG 2.2 AA SC 2.5.8 (24 px), wizard navigation at or above 44 px, and no
  rendered interface text below 12 px.
- **Keyboard:** Tab order from the step heading into the first field, native
  arrow-key radio selection, Space checkbox toggling, and focusable disclosure
  regions are all asserted in the responsive spec.
- **`git diff --check`:** clean.
- **Grep audit of every changed source file:** no raw hex, no 9/10/11 px
  interface text, and no legacy palette classes outside `ToastProvider.jsx`
  (documented above and in section 5.2).

#### Preserved contracts

Firebase, Firestore, Storage and Cloud Functions; rules, indexes, schemas and
collection paths; routes, permissions, role checks and feature flags; every
application field key and saved payload shape; validation meaning and every
required/optional rule; draft, offline-queue and retry semantics; upload paths,
limits and accepted formats; application ordering and conditional-step logic;
consent wording and legal submission behaviour; post-application
template/signing contracts; navigation destinations and callable payloads. The
`#step-title` / `#driver-form` / `#progress-bar` / `#page-N` element ids, the
`${name}-${value}` radio ids, the `${idPrefix}-month|day|year` date ids, and the
`data-testid` checklist contracts are all unchanged.

#### Documented exceptions

- **Sandbox Magic Fill** — raw `<button>`. It must stay visually distinct from
  every production action, and the approved `Button` has no warning tone; a
  feature-side background utility cannot override the variant's own `background`
  rule. Renders only when `isSandboxMode` is true.
- **FMCSA employer combobox options** — raw `<button role="option">`. An ARIA
  combobox option cannot be the approved `Button` (`role="button"` would break
  the listbox contract) and there is no Combobox/Listbox primitive yet.
- **Two file-input compositions** (`UploadField`, the custom-questions upload) —
  no approved file-input contract exists yet (Phase 4). Both are
  keyboard-reachable and correctly named.
- **`ToastProvider` visuals** — nine legacy palette classes remain; migration is
  its own roadmap row.

---

### Driver dossier foundation completion log (GO) — 2026-07-27

Scope: the Driver Dossier **shell and foundation** — the dialog itself
(`DriverProfileModal`), its header and actions (`DossierHeader`), the identity
block and section navigation (`DossierSidebar`), the tab router
(`DossierContent`), the read-only Application summary (`ApplicationTab`), the
document gallery and its preview (`DocumentsTab`), and the `useCompactViewport`
hook that keeps the announced tab orientation honest.

**Deliberately out of scope, and unchanged:** the PEV/VOE workflow content, the
DQ File workflow internals, the full-application `SchemaSection` editing path and
the propose-changes / review-link workflow, and the Activity and Notes internals.
Only their trigger buttons were restyled; every callback argument is untouched.
All four tabs remain reachable and behave exactly as before inside the migrated
shell, which is asserted directly by
`e2e/driver-dossier.spec.cjs › keeps every section reachable and titled`.

#### Defects found and fixed

The first six were found and fixed during the initial migration pass; items 7–10
were found by the completion audit on the same day.

1. **The dialog was hand-rolled** — `role="dialog"`/`aria-modal` with no focus
   containment, no focus move-in and no focus restoration. Tab walked straight
   out of the dossier into the page behind it. Now the shared accessible `Modal`.
2. **Escape was a `window` listener**, so it tore the whole dossier down
   mid-delete. `Modal` now owns Escape per dialog: the topmost one is dismissed,
   and it is inert while a delete is in flight.
3. **The layout was `flex-row` with a fixed 280 px sidebar inside a 90vw panel** —
   at 412 px that left roughly 90 px for content. Now a full-screen sheet below
   `sm` with a horizontal navigation strip.
4. **The section navigation was six plain `<button>`s** — no `tablist`, no
   `aria-selected`, no `aria-controls`, no arrow-key model; selection was carried
   by background colour alone; the DQ-incomplete warning was a bare red dot.
5. **The close button had no accessible name**, and below `lg` the Status and
   Assign To selects were completely unlabelled (their label span was
   `display:none`, which removes it from the name computation).
6. **The document cards were `<div onClick>`** and the preview lightbox was a
   hand-rolled overlay with no dialog role, focus containment, restoration or
   Escape — layered on top of another modal.
7. **The dossier opened with focus on the `tel:` link.** `Modal` focuses the
   first focusable child, and in DOM order that is the sidebar's "Call" link — so
   opening a dossier and pressing Enter dialled the driver. Focus now goes to the
   tab panel, which is the reading surface and is inert when activated.
8. **At 412 px the Close and Delete actions were off-screen entirely.** The
   header's action group was `shrink-0`, so its `flex-wrap` never engaged: it
   held its 489 px max-content width inside a 412 px panel whose
   `overflow-hidden` clipped it away. On a phone — which has no Escape key —
   **there was no way at all to close the dossier.** The group now shrinks and
   wraps.
9. **At 1024 px the section title collapsed to zero width.** The header was
   `sm:flex-nowrap` with a fixed `sm:h-16`, and the title is `truncate`, so it did
   not ellipsise — it simply vanished while the status/assign controls kept their
   full width. The header now wraps at every width with a minimum height, the
   title holds a `basis-48` line, and the Status/Assign labels become visible at
   `xl` rather than `lg` (they stay in the accessible name tree at every width).
   Header height at 1024 px went from a clipped 151 px to a correct 100 px.
10. **`ApplicationTab` rendered nothing at all without application data** — a
    blank tab panel with no explanation. Now an announced empty state. Summary
    rows also applied `truncate` to their value, so long addresses and names were
    clipped with no tooltip; they now wrap.

#### Verification

- **Focused unit tests:** 136 passing across 7 files (up from 109 across 6). New
  this pass: `DriverProfileModal.behavior.test.jsx` (12 — focus move-in, the
  tel:-link regression, restoration on close and on Escape, nested delete
  confirmation focus/Escape scoping/in-flight inertness, page states), 12 new
  tablist-semantics and Arrow/Home/End keyboard tests in
  `DossierSidebar.contract.test.jsx`, 3 nested-preview focus tests in
  `DocumentsTab.contract.test.jsx`, and the reworked `ApplicationTab` empty-state
  assertions.
- **New E2E** (`e2e/driver-dossier.spec.cjs`): 10 checks on Chromium and 8 on
  Mobile Chrome (Pixel 7) — focus containment, keyboard-opened focus restoration
  to the originating row, the full Arrow/Home/End walkthrough with panel and
  title kept in step, every section reachable, the panel never silently blank,
  the nested delete confirmation, real-browser axe on both dialogs, and
  no-clipping/no-hidden-action/12 px-text checks at 1440×900, 1024×768 and
  412×915.
- **Existing E2E regressions:** `company-candidate-table.spec.cjs`,
  `a11y.spec.cjs` and `access-control.spec.cjs` — 11 passed, 1 skipped, serially
  at `workers: 1`.
- **Full frontend suite:** 1655 passed / 48 skipped (1703) across 137 passed / 2
  skipped (139) files. The two skipped files are the Firestore/Storage rules
  suites, which need emulators.
- **Coverage gate (`npm run test:coverage`):** passed — statements 42.95 %,
  branches 43.21 %, functions 43.70 %, lines 43.91 %.
- **Lint:** 0 errors (137 pre-existing repo-wide warnings). **Typecheck:** clean.
  **Production build:** succeeded. **`git diff --check`:** clean.
- **Accessibility:** zero axe violations (wcag2a/2aa/21a/21aa) on the dossier
  dialog and on the delete confirmation, on Chromium and Mobile Chrome. No
  interface text below the 12 px floor at any of the three widths.

#### Honest limitation of the E2E evidence

Under `VITE_E2E_TEST_MODE=1` Firestore is deliberately unreachable, so
`useAppFetch` never returns a document and the dossier settles into its
loading/error page state. The shell, navigation, header actions, page states and
responsive layout all render regardless and are genuinely covered — but **the
application summary, the document gallery, the document preview and the download
action cannot be exercised end-to-end.** Those surfaces are covered only by the
focused contract tests. Giving them real E2E coverage needs an E2E fixture path
in `useAppFetch`, which is a change to a shared data hook and was out of scope
here; it is recorded as remaining work rather than quietly skipped. For the same
reason the E2E page-state test deliberately asserts "the panel always announces
*a* state" rather than pinning the error state, which proved
environment-dependent between the preview browser and Playwright.

#### Preserved contracts

Firebase, Firestore, Storage and Cloud Functions; rules, indexes, schemas,
collection paths, queries and subscriptions; routes, permissions, role checks and
feature flags. Specifically frozen and asserted: the dialog's accessible name
`Driver dossier`; the
`useApplicationView(companyId, driverId, null, onClose, null)` argument list; the
`'application'` initial tab and all six tab state values in order; the
`deleteApplication({ companyId, applicationId, collectionName })` payload and the
`onDeleted()` → `onClose()` ordering; the `company_admin`-of-this-company OR
`super_admin` delete rule; every confirmation string; the
`generateApplicationPDF({ applicant, company, agreements: [] })` payload; the
`onStatusUpdate(value)` / `onAssignChange(value)` single-argument callbacks and
the assignee label chain; the eight document keys, their labels and order, and
the `fileUrls[key]` → `appData[key].url` → `appData.uploadedDocuments[key]` URL
precedence; the `download` attribute and `target`/`rel` pair; the SSN masking
rule, CDL expiry bands, consent values and every `--` / `'A'` / `'Driver'`
fallback. The Super Admin `DashboardModals` consumer, which passes no `onDeleted`,
is unaffected.

Two rendering behaviours were changed deliberately rather than frozen, and are
called out because a previously committed test asserted the old one:
`ApplicationTab` no longer returns `null` without data (it renders an announced
empty state), and summary-row values wrap instead of truncating. Neither is a
business contract.

#### Documented exceptions

- **Feature-owned WAI-ARIA tab composition.** The design system has no approved
  Tabs primitive — `SectionNavigation` is a vertical `nav` with `aria-current`,
  not a tablist. This follows the Documents Center precedent: real
  `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, roving
  `tabIndex` and automatic activation.
- **Feature-owned summary/full toggle group** in `ApplicationTab` — carries
  `aria-pressed`; there is no Segmented/ToggleGroup primitive yet.
- **Styled `<a>` rather than an approved control**, in four places: the sidebar
  `tel:` / `mailto:` actions, the preview download, and the CDL photo links. All
  four are navigations, so a link is the correct element, and there is no
  Link/ButtonLink primitive yet. Tokens only, 44 px targets, visible focus rings.

#### Remaining dossier work

- PEV/VOE workflow content and DQ File workflow internals (their own roadmap
  rows, both `Very high` / `High` risk).
- The full-application `SchemaSection` rendering and editing path, and the
  propose-changes / review-link workflow — the complex-editing campaign.
- Activity and Notes internals.
- E2E fixture coverage for the loaded dossier (see the limitation above).

---

### PEV initiation and tracking completion log (GO) — 2026-07-27

Scope: everything a recruiter touches to **start and track** a previous-employment
verification — the `PEVTab` summary cards, the employer list and its status
presentation, the Initiate / View Result / Copy Link / Upload Result / View
History / Resend actions, the verification-history dialog, the paywall and
no-employer states, `PEVRequestModal` with its email/fax/manual delivery choice
and missing-contact validation, the `FmcsaCarrierPicker` lookup states, and the
shared `PaywallMessage` both this tab and the Campaigns dashboard render.

**Deliberately out of scope, and unchanged:** `VOEPreviewModal`'s generated
document layout and its PDF/print rendering, and the external employer response
portal. The transition into `VOEPreviewModal` is untouched, including the detail
that closing the preview returns to the *request modal* rather than to the list.

#### Contract freeze first

`PEVTab` had **no test coverage at all** while owning a callable payload, an
activity-log write, a Firestore employer update, a Storage upload path, a
signed-URL callable, clipboard and window-opening behaviour, and an optimistic
local-override cache. 34 contract tests were written and made to pass against the
*unmigrated* component before any presentation changed.

Writing them surfaced a pre-existing smell that is recorded rather than changed:
`handleFinalSend` and `handleUploadResult` take a shallow `[...employers]` copy
and then **mutate the employer objects inside it**, which are the same objects
handed in through `appData`. The Firestore write and the employer data shape are
frozen contracts for this campaign, so the mutation stands; the test fixture is a
factory to keep it from leaking between cases. Worth fixing in the campaign that
owns this data path.

#### Defects found and fixed

1. **The delivery-method choice was three plain `<button>`s with a hand-drawn
   radio dot** and no `aria-checked`, `aria-pressed` or grouping of any kind.
   Assistive technology was told neither which method was selected nor that the
   three belonged together, and there was no arrow-key model. They are now native
   radios in a real `<fieldset>`/`<legend>`, so the browser owns selection and
   the question is announced once.
2. **The verification-history overlay was not a dialog** — a bare
   `<div class="fixed inset-0">` with no `role="dialog"`, no `aria-modal`, no
   focus containment, no focus restoration and no Escape, opened on top of the
   driver dossier, which *is* a modal dialog.
3. **The request modal was equally hand-rolled**, with the same four omissions.
4. **The history dialog was titled "Not Specified" for legacy employers.** It
   read `employer.companyName` only, while the list uses `companyName || name` —
   so the one place that tells you whose verification trail you are reading got
   it wrong for every legacy-shaped record.
5. **Three close controls had no accessible name**: the history dialog's (which
   was also a `Plus` icon rotated 45° to fake an X, so its icon claimed "add"),
   the request modal's, and the per-employer Resend action (whose only name
   source was a `title` attribute).
6. **The hidden file input was unlabelled and hidden by a CSS class alone**, so
   any environment that did not apply the stylesheet exposed an unnamed file
   control — axe `label`, **critical**. It now carries an accessible name and the
   native `hidden` attribute.
7. **Interface text at 10 px and 11 px** in eleven places across the summary
   cards, status pills, "Missing Info" marker, FMCSA notes and legal note.
8. **The employer list was a bare `<div>` grid**, so nothing announced how many
   employers there were; and the FMCSA suggestions had no labelled region.
9. **Every asynchronous action was silent** — the result upload, the signed-URL
   fetch and the FMCSA registry search each showed only a spinning icon, and the
   FMCSA error and no-results states announced nothing. All are now `role="status"`
   live regions.
10. **`PaywallMessage` always rendered an `<h3>`**, colliding with the section
    heading of whichever surface embedded it; inside the dossier that put two
    `<h3>`s at the same level. The level is now the caller's choice, defaulting
    to `h3` so the Campaigns consumer is unaffected.

#### Verification

- **Focused tests:** 107 passing across 6 files — 34 new `PEVTab.contract.test.jsx`
  freezes, 13 new `PEVTab.a11y.test.jsx`, 22 new `PEVRequestModal.a11y.test.jsx`,
  plus the 38 pre-existing FMCSA/lookup/request-modal tests.
- **Axe:** zero violations (wcag2a/2aa/21a/21aa) on every PEV surface and state —
  the tab with mixed statuses, the no-employer state, the paywalled state, the
  history dialog, and the request modal on open, with the fax field shown, and
  while displaying a validation error. Run through the real axe engine in CI via
  `vitest-axe`, and again in a real browser (below).
- **Real-browser measurement at 1440×900 / 1024×768 / 412×915:** no horizontal
  document overflow, no dialog clipping, no control outside the viewport, no
  interface text below 12 px, and zero axe violations — measured on the tab, the
  request dialog and the history dialog at each width. Heading order runs
  `h3 → h4 → h5` with no skipped level.
- **Keyboard and nested dialogs:** the history dialog moves focus in, closes on
  Escape and restores focus to the action that opened it (asserted in CI and
  confirmed in the browser); the request modal does the same.
- **E2E regressions, serially at `workers: 1`:** `driver-dossier.spec.cjs`
  (18 passed, 4 skipped, Chromium + Mobile Chrome), and
  `company-candidate-table` / `a11y` / `campaigns-dashboard` (15 passed,
  2 skipped) — the last of these covering the `PaywallMessage` change.
- **Full frontend suite, coverage, lint, typecheck, production build and
  `git diff --check`:** see the summary at the end of this log.

#### Honest limitation of the E2E evidence

**The PEV tab cannot be reached in a Playwright run.** Under
`VITE_E2E_TEST_MODE=1` Firestore is deliberately unreachable, so the driver
dossier settles into its error state and never mounts `DossierContent` — which is
what renders `PEVTab`. This was verified directly, not assumed. Consequently
there is **no PEV E2E spec**, and adding one would require an E2E fixture path in
`useAppFetch`, a shared data hook this campaign was scoped not to touch.

What was done instead, and what it is worth: the axe and structural coverage runs
the real axe engine in CI on the real markup, and the responsive/overflow figures
above were measured in an actual browser against the real components through a
temporary harness page, which was **deleted after measurement** and is not part
of this change. That gives genuine layout numbers but, unlike a spec, it does not
re-run in CI. Two consequences follow honestly: the 1440/1024/412 figures are a
point-in-time measurement rather than a regression gate, and **native arrow-key
radio selection was not driven end to end** — it is browser-owned behaviour, and
what is asserted is the structure that guarantees it (one shared `name`, all
three enabled, all inside one `<fieldset>`), plus that a real click fires
`click → input → change` and updates the selection.

#### Preserved contracts

Firebase, Firestore, Storage and Cloud Functions; rules, schemas, collection
paths, queries and subscriptions; feature flags and permissions. Specifically
frozen and asserted by value: the `features.pev === false` paywall gate; the
`sendVerificationRequest` payload key-by-key, including `employerEmail: null` for
fax and manual; the
`logActivity(companyId, collectionName, applicationId, 'PEV_REQUEST', entry, 'pev')`
argument list and the exact log-entry string; the
`updateDoc(companies/{companyId}/{collectionName}/{applicationId}, { employers })`
write with its `verification` and `history` object shapes; the optimistic
`localOverrides` merge; the `getSignedPevUrl({ storagePath })` payload, the
`http(s)`-opens-directly rule and every
`window.open(url, '_blank', 'noopener,noreferrer')`; the clipboard write; the
`companies/{companyId}/{collectionName}/{applicationId}/pev_results/{Date.now()}_{name}`
Storage path and the `.pdf,image/*` accept list; the `'email' | 'fax' | 'manual'`
delivery values, their `Email | Fax | Manual` labels and the `'Manual Download'`
recipient fallback; `mapFmcsaRowToPevContact` merge semantics and the FMCSA
lookup skip rules; the `onProceed(deliveryMethod, contactInfo)` pair; the
`companyEmail → email` seeding precedence; and every toast, validation and
user-facing string.

#### Documented exceptions

- **Feature-owned raw `<button>` per FMCSA suggestion row.** Each row carries
  multi-line structured content (legal name, USDOT + city/state, contact-availability
  note); the approved `Button` takes inline children and owns its layout, and
  there is no Listbox/Combobox or SelectableCard primitive yet — the same gap the
  public application's FMCSA employer combobox records. `aria-pressed` carries
  the selection and the selected state is also stated in text.
- **Feature-owned file input** for the result upload — no approved file-input
  contract exists yet (Phase 4), the same gap the public application's
  `UploadField` documents. It is named and driven by a visible, named button.
- **The request dialog's header is no longer an inverse panel.** It was
  `bg-slate-900`. The token contract has `--ds-color-content-inverse` but **no
  inverse surface**, so an inverse header cannot be expressed in approved tokens,
  and inventing one is not a feature's call. It now follows the dossier
  document-preview precedent and sits on `surface-subtle`, which also keeps the
  ghost `IconButton` legible. **New recorded gap:** an inverse surface token
  (`--ds-color-surface-inverse` + a secondary inverse content value) is missing
  from the semantic contract.
- **"Missing Info" moved into the radio's own description** rather than a
  separate badge. `Radio` takes a string `description`, so the marker is
  announced with the option instead of sitting in a 10 px pill beside it; the
  visible text is preserved.

#### Remaining PEV/VOE work

- `VOEPreviewModal` — **chrome completed 2026-07-27** (see the next log); the
  generated document is deliberately untokenised and guarded. Its **Print export
  was repaired 2026-07-27** — see the print-pipeline repair log.
- ~~The external employer response portal (`/verify/:token` respondent side)~~ — **closed out 2026-07-27**, see the verification-portal closeout log.
- The in-place mutation of `appData.employers` noted above.
- E2E reachability for the PEV tab, which depends on dossier E2E fixture data.

---

### VOE preview and export completion log (GO, with one escalation) — 2026-07-27

Scope: `VOEPreviewModal` — the dialog shell, header, recipient/applicant
summary, the Print / Download PDF / Edit Request / Transmit Request Now actions,
and the loading, export-failure and missing-data states. The external employer
response portal is **not** in scope and is untouched.

#### The central decision: the document is not themeable chrome

The generated 49 CFR §391.23 form leaves the application through two paths and
**neither carries the SafeHaul stylesheet**:

1. `handleDownloadPDF` rasterises the node with html2canvas — colours come from
   computed style at capture time.
2. `handlePrint` writes the node's `innerHTML` into a bare `window.open`
   document whose only stylesheet is Tailwind from a CDN. That window has no
   `:root` custom properties at all, so any `--ds-*` colour would resolve to
   nothing and the printed form would lose its rules, borders and emphasis.

So the chrome was migrated and **the document subtree was left byte-identical**.
This is enforced, not just documented: `VOEPreviewModal.export.test.jsx` fails if
any `ds-*` class or `var(--…)` value appears inside the document, pins the
document root's class list (the html2canvas capture surface), and asserts the
mirror image — that the chrome *is* tokenised — so the guard cannot be satisfied
by simply migrating nothing.

#### Contract freeze first

`VOEPreviewModal` had **no test coverage at all** while owning a generated legal
document, an html2canvas → jsPDF pipeline, a print-window pipeline, SSN masking,
signature rules and an audit identifier. 37 contract tests were written first;
35 passed against the unmigrated component and the 2 that failed are the two
defects below.

#### Defects found and fixed

1. **The dialog was hand-rolled** — no `role="dialog"`, no `aria-modal`, no focus
   containment, no focus restoration, no Escape. It opened on top of
   `PEVRequestModal`, itself a dialog inside the driver dossier, a third: Tab
   walked out of all three.
2. **The close control had no accessible name.**
3. **Export failure used `window.alert`**, which blocks the thread and is not
   part of the dialog. Now an in-dialog `role="alert"` with the same wording.
4. **A blocked pop-up crashed Print** with a TypeError on `windowPrint.document`
   and showed the user nothing. Now guarded and announced.
5. **PDF generation was silent** — an icon swap with no live region.
6. **Missing data rendered `null`**, so "Continue to Preview" opened nothing at
   all: no document, no explanation, no way back. Now an announced state with an
   Edit Request action.
7. **The disabled Transmit action never said why.** The reason existed only
   inside the rendered document image. It is now announced via
   `aria-describedby`.
8. **The document scroll region was not keyboard-focusable** (real-browser axe
   `scrollable-region-focusable`, serious). The document is far taller than the
   viewport and none of the dialog's focusable controls sit inside the scroller,
   so a keyboard user could not scroll the form at all.
9. `text-[10px]` chrome text below the 12 px floor.

#### ESCALATION — printing produces an unsigned, unstyled document

> **RESOLVED 2026-07-27** by the *VOE print pipeline repair* log below. The
> measurements in this section are the **pre-fix** state and are kept as the
> record of the defect. Print now carries the full document.

**This is pre-existing, was not introduced here, and was deliberately NOT
changed because the brief froze print sanitisation. It needs an owner decision.**

`handlePrint` passes the document's `innerHTML` through the shared
`sanitizeUserContent`, whose DOMPurify allowlist permits only
`b/strong/i/em/u/br/p/ul/ol/li/span/a/code/pre` and the attributes
`href/target/rel`. Measured in a real browser on the actual rendered document:

| | before sanitise | after |
|---|---|---|
| characters | 12,555 | 2,732 |
| `<div>` | 95 | **0** |
| `<img>` (the signature) | 1 | **0** |
| `<svg>` | 2 | **0** |
| `<h1>` | 1 | **0** |
| `class` attributes | 157 | **0** |

So **Print emits a flat, unstyled text dump with the applicant's signature
removed** — and the signature is the legally operative part of a §391.23
release. The Tailwind CDN script the print window loads is inert, because every
`class` attribute has already been stripped.

Two further points the owner needs:

- **The existing test suite does not catch this.** `createDOMPurify(window)` is
  effectively a no-op under happy-dom, so `src/tests/sanitizeUserContent.test.js`
  only ever exercises the regex pre-strip, and any unit test asserting print
  fidelity would pass while the real browser strips everything. The contract test
  added here therefore pins the *pipeline* (the document's `innerHTML` is passed
  to `sanitizeUserContent` and its return value is what gets written) rather than
  DOMPurify's environment-dependent output.
- **The sanitiser cannot simply be loosened.** It is shared with `NotesTab`,
  where the input is genuine user-authored content and the strict allowlist is
  exactly right. A fix belongs in `VOEPreviewModal`, not in the shared utility —
  and the document's dynamic values are all React text nodes, so the print
  markup has no user-authored HTML in it to sanitise in the first place.

**Download PDF is unaffected** — html2canvas captures the live DOM, so the PDF
export is correct and complete today. Users have one working export path and one
broken one.

#### Verification

- **Focused tests:** 64 new across 3 files — 37 contract (legal text and its
  ordering, fallbacks, SSN masking, signature branches, audit ID, html2canvas
  options, jsPDF dimensions, PDF filename, the five print `document.write`
  payloads and the 1 s delay, callbacks), 9 export-parity, 18 dialog/keyboard/axe.
- **Regressions:** 284 passed across the 15 VOE + PEV + driver-dossier files.
- **Axe:** the chrome has **zero** violations at 1440 / 1024 / 412 px, in the
  signed, typed-signature, missing-signature, missing-data and export-failure
  states, run both through `vitest-axe` in CI and through real-browser axe.
- **Known accepted deviation:** real-browser axe reports **4 serious
  `color-contrast` nodes, every one of them inside the immutable document** —
  "Generated on …" at 2.56:1, "Verified Business Entity" at 1.95:1, and two
  `text-[10px]` field labels at 2.45:1. Fixing them means changing document
  colours, which changes every exported PDF, so it needs owner approval and a
  re-proof of export parity. Recorded rather than silently changed.
- **Responsive, measured in a real browser:** at 1440×900 / 1024×768 / 412×915 —
  no document overflow, no dialog clipping, no off-screen control, and no chrome
  text below 12 px. At 412 px the dialog is a full-screen sheet (412 px) and the
  document still fits its region without horizontal scroll.
- **Keyboard:** focus moves into the dialog on open, Escape closes and returns to
  `PEVRequestModal`, focus is restored to the control that opened it, and the
  document region is now focusable and named.
- Full frontend suite, coverage, lint, typecheck, production build and
  `git diff --check` — see the summary below.

#### Honest limitation of the E2E evidence

`VOEPreviewModal` **cannot be reached in a Playwright run**, for the same reason
the PEV tab cannot: under `VITE_E2E_TEST_MODE=1` Firestore is unreachable, the
driver dossier settles into its error state and never mounts `DossierContent`.
There is therefore no VOE E2E spec. The axe and structural coverage runs the real
axe engine in CI; the responsive and sanitiser measurements above were taken in
an actual browser through a temporary harness page that was **deleted after
measurement** and is not part of this change. Those figures are a point-in-time
measurement, not a regression gate.

#### Preserved contracts

Every word of the regulatory text and its ordering; all applicant/employer values
and their `getFieldValue` / `NOT DISCLOSED` / `REDACTED (ON FILE)` /
`[PROSPECTIVE COMPANY]` / `Verified` fallbacks; SSN last-four masking; the
`TEXT_SIGNATURE:` prefix rule and all three signature branches; the audit-ID
derivation; the generated date/time; `{ scale: 2, useCORS: true }`; the jsPDF
`portrait` / `px` / `[canvas.width, canvas.height]` construction and `addImage`
placement; the `VOE_<employer>_<first>_<last>.pdf` filename with whitespace
underscored and the `Employer` fallback; the print window's feature string, its
five `document.write` payloads, the `sanitizeUserContent` step and the 1 s
print-then-close delay; and `onClose` / `onSend()`, including that `onClose`
returns to `PEVRequestModal` rather than to the employer list. Firebase,
callables, routes and data contracts are untouched.

#### Documented exceptions

- **The generated document is not tokenised**, by design and under test. See the
  decision above.
- **The dialog header is not an inverse panel.** It was `bg-slate-900`; there is
  no inverse surface token (blocker already recorded by the PEV campaign), so it
  follows the same precedent as `PEVRequestModal` and sits on the panel surface.
- **The document keeps its own `<h1>`.** It is a facsimile of a paper form, and
  the chrome heading above it is an `<h4>`; a *decrease* in heading level is not
  a heading-order defect and axe confirms it.

#### Remaining respondent-portal work

- ~~The external employer response portal (`/verify/:token` respondent side)~~ —
  **closed out 2026-07-27**, see the verification-portal closeout log.
- ~~The print-sanitisation escalation above~~ — **resolved**, see the next log.
- The 4 in-document contrast nodes, pending an owner decision.

---

### VOE print pipeline repair (GO) — 2026-07-27

Scope: the Print export path of `VOEPreviewModal`, and only that. No visual,
token, layout, wording, routing, Firebase, permission or workflow change. This
resolves the escalation raised by the log above.

#### Root cause

`handlePrint` serialised the rendered document to an HTML string and passed it
through `sanitizeUserContent` — the **user-content** policy. That policy exists
for `NotesTab` and the global question editor, where the input genuinely is
user-authored rich text, and its DOMPurify allowlist is `b/strong/i/em/u/br/p/
ul/ol/li/span/a/code/pre` with the attributes `href/target/rel`. Applied to a
rendered legal document it did exactly what it is built to do:

| | rendered | after `sanitizeUserContent` |
|---|---|---|
| `<div>` | 95 | **0** (DOMPurify keeps text, drops the element) |
| `class` attributes | 157 | **0** (`class` is not in `ALLOWED_ATTR`) |
| `<img>` — the signature | 1 | **0** (`img` is in `FORBID_TAGS`) |
| `<svg>` | 2 | **0** |
| `<h1>` | 1 | **0** |

With every `class` gone, the Tailwind CDN script the print window loaded was
inert, so the output was also unstyled. The result was an **unsigned, unstyled
text dump of a §391.23 release**. `Download PDF` was never affected — it
rasterises the live DOM.

**Why CI was green.** `createDOMPurify(window)` is inert under happy-dom, so the
sanitiser was a no-op in every unit test. A test asserting print fidelity would
have passed while a real browser stripped everything. That is the reason this
fix ships with a real-browser gate.

#### The fix

The insight the previous log already recorded: **the print markup contains no
user-authored HTML.** Every dynamic value in the document is a React text node,
so React escapes it during render. The structure around those values is authored
in JSX. It is trusted structure, and it needed its own policy — not a loosening
of the shared one.

New `src/shared/utils/printDocument.js`:

- `scrubTrustedPrintTree(root)` — walks a **clone** of the document as a DOM
  tree (never a string, so there is no serialise/re-parse round trip) and
  enforces an explicit policy: forbidden elements deleted outright, every `on*`
  handler attribute deleted, every URL-bearing attribute checked against a
  scheme allowlist (`img src` must be a base64 raster data URL or `http(s)`;
  `data:text/html` and `data:image/svg+xml` are rejected), and `style` values
  containing `javascript:` or `expression(` dropped. Structure, `class`, `<img>`
  and `<svg>` survive. It returns what it removed, and for a SafeHaul-generated
  document that is the empty set — which is itself asserted.
- `collectPrintStyles(document)` — inlines the application's own compiled CSS
  from `document.styleSheets`, falling back to a `<link>` for any stylesheet
  whose rules are unreadable. **The Tailwind CDN script is gone**: no network
  dependency, no JIT race, and the CSS is the build the app actually ships.
- `waitForPrintDocumentReady(printWindow)` — resolves once the print document's
  linked stylesheets, images and fonts have settled. **The flat 1 s timer is
  gone.** A timeout remains only as a backstop against a resource that never
  settles, and the return value says which path was taken.

`handlePrint` now writes a bare skeleton, appends the collected styles plus a
small print-only sheet (`@page` margins and `print-color-adjust: exact`, without
which Chrome and Safari drop the background fills and lighten the borders when
printing), clones and scrubs the document, appends it inside the same 20 px
padding wrapper, marks the body ready, waits, then prints.

Because this DOM walk is our own code rather than DOMPurify, it behaves
identically in happy-dom and in Chromium — so unlike the code it replaces, it is
genuinely unit-testable.

#### The shared sanitiser is untouched

`src/shared/utils/sanitizeUserContent.js` is **byte-identical**. `NotesTab`,
`GlobalQuestionsManager` and `companyService` keep the strict policy, and
`src/tests/sanitizeUserContent.test.js` still passes unchanged. A contract test
now asserts the *negative*: the VOE print path must never call it again.

#### Also fixed, and honestly noted as new behaviour

- **Print failures are now visible.** A blocked pop-up already was; a
  preparation failure now raises the same in-dialog `role="alert"`, closes the
  half-built window and re-enables the control, and a document with no
  collectable stylesheet says so rather than silently printing unstyled.
- **Print announces progress** in the existing `role="status"` region and
  disables its own control while preparing, so a double click cannot open two
  print windows. This is new; it did not exist before.

#### E2E reachability — a real gap, partially closed

The previous log recorded that `VOEPreviewModal` cannot be reached in Playwright:
under `VITE_E2E_TEST_MODE=1` Firestore is unreachable, the dossier settles into
its error state and never mounts `DossierContent`. **That is still true and is
not fixed here.**

What is new is `/e2e/voe-preview`, a lazy, `isE2ETestMode`-gated harness route
(`src/app/e2e/VOEPreviewHarness.jsx`) that mounts the real component with the
real export pipeline against fixture props. It proves the *document and the
exports* in a real browser. It does **not** prove the route a user takes to get
there, and it is not a substitute for dossier E2E fixture data. Verified absent
from the production build: no bundle in `dist/assets` contains the harness.

#### Verification — exact results

- **New unit tests:** 53 in `src/tests/printDocument.test.js` (preservation,
  removal, URL-scheme policy, stylesheet collection, readiness waiting).
- **`VOEPreviewModal.contract.test.jsx`:** 51 pass. The print block was
  **rewritten**: the previous 2 tests froze the broken pipeline by value (five
  `document.write` payloads, the `sanitizeUserContent` step, the 1 s timer) and
  are replaced by 16 that assert the structure, classes, signature, inlined CSS,
  readiness ordering, non-mutation of the live node, the blocked-pop-up and
  preparation-failure paths, the no-stylesheet warning, and that the user-content
  sanitiser is never called. Everything else in the file is unchanged and still
  passes.
- **`VOEPreviewModal.export.test.jsx`** (9) and **`.a11y.test.jsx`** (19): pass
  unchanged. **`sanitizeUserContent.test.js`** (2): passes unchanged.
- **New E2E:** `e2e/voe-print-export.spec.cjs`, 20 tests. **20/20 on each of
  Chromium, Mobile Chrome, Firefox and WebKit** — 80 runs, each lane run on its
  own, serially, per the concurrency rule. In the real print pop-up: 95 divs
  and 157 classed elements (identical to the source), the signature `<img>`
  present with `naturalWidth > 0`, computed background `rgb(255, 255, 255)`,
  serif family, non-zero border widths, `font-weight: 900` on the `<h1>`; zero
  `<script>` elements; no request to `cdn.tailwindcss.com`; the readiness marker
  set and zero unloaded stylesheets at the moment `print()` was called.
- **Hostile input, in a real browser:** applicant/employer values containing
  `<img src=x onerror=…><script>…</script>` appear as visible text, produce zero
  script elements, zero `on*` attributes and zero injected images, and the
  sentinel `window.__voePwned` is undefined in both the pop-up and the opener.
  `javascript:`, `data:text/html` and `data:image/svg+xml` signatures each lose
  their `src` and execute nothing.
- **PDF export:** unchanged and re-proven in a real browser — downloads
  `VOE_Acme_Freight_Maria_Garcia.pdf`, including immediately after a print, so
  the capture surface is provably undisturbed.
- **Axe:** zero serious/critical violations on the dialog chrome in a real
  browser. The generated document is excluded from that scan for the reason
  already recorded — its 4 grey small-print contrast nodes are an open owner
  decision, not something this change silently fixed.
- **Keyboard and responsive:** Print is focusable and operable with Enter,
  Escape closes and reports back to the opener, and there is no horizontal
  overflow at 1440 / 1024 / 412 px. Printing from a 412 px viewport still yields
  the full 157-class document.
- **Regressions:** `driver-dossier`, `pev-request-and-portal-response`,
  `company-candidate-table` and `a11y` E2E — 24 passed, 3 skipped, serially.
- **Full frontend suite:** 1857 passed, 48 skipped, 146 files. Coverage
  statements 44.86% / branches 44.92% / functions 45.25% / lines 45.89%.
- **Lint** (`eslint .`): 0 errors, 134 pre-existing warnings. **Typecheck**
  (`tsc --noEmit`): clean. **Build** (`vite build`): succeeds, with the
  pre-existing >500 kB chunk warning. **`git diff --check`**: clean.

#### Contracts preserved

Every word of the regulatory text and its ordering; all applicant/employer values
and their `getFieldValue` / `NOT DISCLOSED` / `REDACTED (ON FILE)` /
`[PROSPECTIVE COMPANY]` / `Verified` fallbacks; SSN last-four masking; the
`TEXT_SIGNATURE:` prefix rule and all three signature branches; the audit-ID
derivation; the generated date/time; `{ scale: 2, useCORS: true }`; the jsPDF
`portrait` / `px` / `[canvas.width, canvas.height]` construction and `addImage`
placement; the `VOE_<employer>_<first>_<last>.pdf` filename with whitespace
underscored and the `Employer` fallback; the print window's feature string, its
`Print VOE` title and its 20 px body padding; and `onClose` / `onSend()`,
including that `onClose` returns to `PEVRequestModal`. Firebase rules, database
structures, callables, integrations, permissions, routes, feature flags and
business workflows are untouched.

**Deliberately changed, because the defect was in them:** the five
`document.write` payloads, the `sanitizeUserContent` step, the Tailwind CDN
script and the 1 s print-then-close delay. Each is replaced by the mechanism
described above and covered by the tests listed above.

#### Still outstanding

- ~~The external employer response portal (`/verify/:token` respondent side)~~ —
  **closed out 2026-07-27**, see the verification-portal closeout log below.
- **Reaching `VOEPreviewModal` through the driver dossier in Playwright.** Still
  blocked on dossier E2E fixture data; the harness route is a workaround for
  export coverage, not a fix for reachability.
- The 4 in-document `color-contrast` nodes — still an open owner decision.
- **No test exercises an actual printed page.** `window.print()` is stubbed in
  every lane, so what is proven is the *document handed to the print engine* —
  its structure, styling, signature and readiness — not the paper output. The
  `print-color-adjust: exact` rule is included on the standard grounds that
  Chrome and Safari drop background fills without it; that specific claim is
  reasoning, not something these tests measure.

---

### Verification portal closeout — PEV/VOE campaign complete (GO) — 2026-07-27

Scope: the public respondent portal at `/verify/:token`, the last unmigrated
PEV/VOE surface. Base `origin/main` at `0fd3a0b` (merged PR #120, all 10 required
checks green on the latest head) with a clean tree.

#### Audit: what was already right

The 2026-07-23 slice migrated more than this campaign needed to touch, and it was
**left alone**: `PortalStatusScreens` (five states, each a `Card as="main"` with
one `<h1>` and an inner live region), `ApplicantDetailsCard`, all four form
sections on `FormSection`/`FormField`/`Input`/`Select`/`Textarea`, the
`role="alert"` error summary and its focus move, and the token-load/validate/
submit contracts in `useVerificationPortal`. Those were re-verified, not rewritten.

That slice explicitly recorded `SignaturePad` and the hook as **not changed** —
which is exactly where the remaining defects were.

#### Defects found and fixed

1. **The visible signature could diverge from the submitted data.** This is the
   serious one. Assigning `canvas.width` resets the bitmap; `SignaturePad`
   rebuilt the canvas on **every** window `resize` and never told its parent, so
   the drawing went blank while `formData.signatureData` still held the PNG
   captured beforehand. The respondent then submitted, under penalty of perjury,
   a signature they could no longer see. On a phone, rotating the device did it.
   Now: a resize that does not change the rendered size is ignored outright (an
   on-screen keyboard or a collapsing URL bar is a no-op); a real resize copies
   the bitmap out, rebuilds, draws it back 1:1 and **re-emits** so the stored PNG
   matches the pixels; and if the bitmap cannot be carried over the pad clears
   itself and emits `null`. Measured in Chromium: 3,716 inked pixels before a
   690→416 px change, 3,716 after.
2. **A stroke could be dropped entirely.** `isDrawing` was React state, so a
   `pointermove` arriving in the same task as its `pointerdown` — a fast flick, a
   high-frequency stylus — read the stale `false`. It is now a ref.
3. **`setPointerCapture` could abandon the stroke.** It ran before
   `beginStroke` and throws `NotFoundError` for a pointer id the browser does not
   consider active, so the exception escaped and nothing was drawn. Reordered and
   guarded.
4. **Strokes drifted from the cursor.** `canvas.width` was set from the
   *parent's* `offsetWidth`, which includes the container's 2 px border, so the
   backing store was 4 px wider than the rendered canvas. Positions are now
   measured against the canvas's own rect and scaled by the backing-store ratio.
   Confirmed in a real browser: 690×150 backing store for a 690×150 canvas
   (previously 694).
5. **Pen and stylus did not work at all** — only `mouse` and `touch` were
   handled. Pointer events are handled first now, with the mouse/touch handlers
   kept as a fallback and de-duplicated so one gesture is never drawn twice.
6. **The signing surface had no accessible name, and its instructions and error
   were associated with nothing.** A screen reader reaching it was told only
   "canvas". It is now a named `role="img"` with `aria-describedby` covering both,
   plus `aria-invalid` and a `role="status"` region announcing capture/clearing.
7. **Clear was a bare `<button>`** with raw palette classes that only existed
   once something had been drawn, so it appeared and vanished under the keyboard.
   It is an always-present design-system `Button`, disabled when there is nothing
   to clear.
8. **A real WCAG failure, found by this campaign's axe pass.** `RadioGroup`'s
   description used `content-muted` (slate-500); two of those groups render
   inside the drug-and-alcohol block on `--ds-color-status-warning-bg`, where it
   measured **4.27:1** against the required 4.5:1. Moved to `content-secondary`,
   the remedy the existing `content-muted` token blocker already prescribes.
9. **The validation summary named nothing a respondent could act on.** Entries
   were built by splitting the camelCase state key — "was Employed: Required",
   "signature Data: Please provide your electronic signature". They now use the
   field's real on-page label. **The messages themselves are unchanged.**
10. **Duplicate submission was possible.** The only guard was the submit
    Button's `loading` → `disabled`, and a disabled submit button does not stop
    *implicit* submission: pressing Enter in any text field while the first
    request was in flight fired a second `submitVerificationResponse` for the
    same token. Closed with synchronous `submitting`/`completed` refs (React
    batches state, so a ref is what actually closes the window).
11. **The page header was an untokenised `bg-slate-900` inverse bar** with
    `text-blue-400`/`text-blue-300` accents.

#### Contracts preserved

`/verify/:token` token access; `getVerificationRequest({ token })` and its
`result.data` handling; every load mapping (`completed` → already-completed,
`functions/deadline-exceeded` → expired, `functions/not-found` → "This
verification link is invalid or has been removed.", otherwise `err.message ||
'Failed to load verification request.'`, no token → "No verification token
provided."); all 19 `formData` keys and their initial values; every conditional
rule (`wasEmployed`, `subjectToDotTesting`, `hadDrugAlcoholViolations`,
`hadAccidents`); every `validate()` rule and message string;
`updateField(field, value)`; `submitVerificationResponse({ token, response:
formData })`; `SignaturePad`'s `onSignatureChange(data:image/png…)` / `null`
contract; the 150 px canvas height; the `?e2eVerify=mock` fixture path
bit-for-bit; and all regulatory and certification wording. Firebase, functions,
schemas and routes are untouched — `check:function-exports` still reports
`OK | mapped 101 | raw 101`.

**Additive, not a change:** `?e2eVerify=expired|invalid|completed|failure` join
the existing `mock` mode so the remaining page states can be reached in a real
browser. The failure modes **throw the same coded errors the callable throws**,
so they exercise the real mapping rather than bypassing it. `mock` and the real
callable path are unchanged.

#### Verification — exact results

- **Focused tests, 73 passing across 5 files.** 24 new in
  `SignaturePad.contract.test.jsx` — written **before** the presentation work;
  11 passed immediately (the frozen emission and height contracts) and **13
  failed**, which is the defect list above. 20 new in
  `VerificationPortal.closeout.test.jsx` (summary wording, duplicate submit with
  the callable held open, the real pad end-to-end, the resize invariant reaching
  the submit payload, conditional sections, axe with errors shown and with every
  section expanded). The 5 pre-existing `SignaturePad` tests and the 24
  pre-existing portal/hook tests pass **unchanged**.
- **New E2E:** `e2e/verification-portal-closeout.spec.cjs` — **29/29 Chromium**,
  **28 passed / 1 skipped Mobile Chrome** (the skip is the desktop-only keyboard
  test), each lane run on its own, serially. It reads canvas pixels back, so
  signing is measured rather than inferred: >100 inked pixels after a mouse drag
  and after a touch-typed pointer sequence, ink preserved exactly across
  1440→800 px and across a 412×915 → 915×412 orientation swap, ink untouched by a
  height-only change, and the pad's height still 150 px throughout.
- **Regressions:** `pev-request-and-portal-response` 4 passed/1 skipped
  (Chromium) and 3 passed/2 skipped (Mobile Chrome); `voe-print-export` 20/20.
- **Full frontend suite:** 1901 passed, 48 skipped, 146 files. Coverage
  statements 45.40% / branches 45.25% / functions 45.64% / lines 46.34% — up from
  44.86 / 44.92 / 45.25 / 45.89.
- **Lint** 0 errors (pre-existing warnings only) · **typecheck** clean ·
  **production build** succeeds with the pre-existing chunk-size warning ·
  **callable-contract** `OK | mapped 101 | raw 101` · **`git diff --check`** clean.
- **Axe, real browser:** zero serious/critical on all six states — pending form,
  expired, invalid, already-completed, load-failure and success — plus the
  validation-summary state and the all-conditionals-expanded state, on both lanes.

#### Documented exceptions

- **The header is not an inverse banner.** It was `bg-slate-900`; there is no
  `--ds-color-surface-inverse` in the token contract (blocker already recorded by
  the PEV campaign), so it follows the `PEVRequestModal` / `VOEPreviewModal`
  precedent and sits on the app surface with a bottom rule. Wording unchanged.
- **`SignaturePad` has no keyboard path to producing a signature.** A canvas
  cannot be drawn on with a keyboard. Everything *around* it is keyboard- and
  screen-reader-accessible — named surface, associated instructions and error,
  operable Clear, announced state — but signing itself is not. Escalated below
  rather than papered over.
- **The feature-local `RadioGroup` stays feature-owned.** The design-system
  Radio/Checkbox phase is still not started; no competing primitive was created.
- **The real radio `<input>` is `sr-only`** inside its `<label>`, the standard
  custom-radio pattern. Keyboard and screen-reader operation are unaffected, but
  automation must click the label, not the input — the E2E spec documents this.

#### Still outstanding

- **Keyboard/AT signing** — the escalation below.
- The 4 in-document `color-contrast` nodes in the VOE generated document — a
  pre-existing, separately recorded owner decision, untouched here.
- **Firefox and WebKit were not run for this spec**; the evidence is Chromium and
  Mobile Chrome, matching the lanes the brief named. Nothing in the pad uses a
  Chromium-specific API, but that is reasoning, not measurement.
- **No test asserts what a submitted signature *looks* like** — the pad's PNG is
  compared by identity and by inked-pixel count, not by image content.

---

### Lead-intake completion log (GO) — 2026-07-27

Scope: **Import Leads** (`ImportLeadsPage`, `CompanyBulkUpload`, the shared
`BulkUploadLayout`, `useBulkImport`, `useCompanyLeadUpload`) and **Quick Add
Lead** (`QuickAddLeadPage`). Base `origin/main` at `e581998` (merged PR #121,
all 10 required checks green) with a clean tree.

#### Contract freeze first

Before any presentation change, six freeze suites (99 tests) pinned every
behaviour the brief said must not move: the `companies/{companyId}/leads` path
and exact Quick Add payload keys/values; `BulkUploadLayout`'s step ids, accepted
formats, `'file'`/`'gsheet'` values, internal-field preview filter and 8-column/
10-row caps; `CompanyBulkUpload`'s CSV template contents, `uploadLeads(csvData,
importMethod)` signature and reset composition; `useBulkImport`'s parse/sheet
behaviour (also exercising its other consumer, `AudienceBuilder`, implicitly by
freezing the no-options default); and `useCompanyLeadUpload`'s team-member load,
assignment guards, created/updated payloads, `activity_logs` entries,
round-robin order, batch limits and the data-repair scan rule. All 99 passed
against the pre-migration code, then again after migration — the frozen half of
this task.

#### Defects found and fixed (presentation only, each proven by a companion test)

1. `BulkUploadLayout`'s overlay was a bare `fixed inset-0` div: no
   `role="dialog"`, no focus move/trap/restore, no Escape. Now the shared
   accessible `Modal`.
2. `ImportLeadsPage` always passed `isEmbedded` to `CompanyBulkUpload`, but the
   prop was never read, so the full-screen modal rendered on top of the page's
   own header — unreachable and covering live content. Now honoured: embedded
   renders in place; only the dashboard's own overlay usage gets a dialog.
3. The header close control, the file input's drop zone had an accessible
   label but the two import-method tiles and the two assignment tiles were
   colour-only toggle `<button>`s with no group semantics — now real
   `ChoiceGroup`/`Radio` groups.
4. The file input was `display: none`, removing it from the tab order
   entirely. Now visually hidden but focusable, with a per-instance `id`
   (previously a hard-coded global, which broke with two instances mounted).
5. Each team member was a `<div onClick>` with a decorative check icon: no
   role, no accessible name, no checked state, unreachable by keyboard. Now
   real `Checkbox` controls in a named group.
6. The preview table had no accessible name, no header `scope`, and its scroll
   region was neither focusable nor labelled — replaced with the approved
   `DataTable`. Fixing this also surfaced a **real overflow bug**: the bounding
   wrapper used `max-h-64`, which does nothing for `DataTable`'s `height: 100%`
   root (percentage heights need an ancestor with an explicit height), so a
   300-row import stretched to ~608 px instead of scrolling in the labelled
   region — caught by the Chromium E2E run, fixed by using `h-64`.
7. Upload progress was silent — the string was the disabled button's own
   label, never announced, with no `progressbar` role. Now a `role="status"`
   live region plus a determinate `ProgressBar` (additive `progressCount` on
   `useCompanyLeadUpload`) when a countable total exists.
8. The data-repair action used a blocking `window.confirm`; upload, sheet-parse
   and repair failures used blocking `alert()`. All replaced with in-page
   `role="alert"`/`role="status"` feedback and an accessible confirmation
   dialog, all keeping the exact frozen wording.
9. `QuickAddLeadPage` had no field-to-label association at all (bare
   `<label>`s, no `htmlFor`/`id`), so nine controls announced as unlabelled edit
   boxes. Now `FormField`-owned associations.
10. The frozen required-field message ("Please fill in required fields (First
    Name, Last Name, Phone).") was **unreachable in a real browser**: the
    inputs also carried the native `required` attribute, so the browser's own
    validation bubble blocked submission before `handleSubmit` ever ran. The
    form is now `noValidate`; the app owns validation, shows the same message,
    marks the offending fields `aria-invalid` with an associated error, and
    moves focus to the first invalid field.
11. Quick Add's `isSaving` guard was React state, so two activations dispatched
    before a re-render could both pass it. A `useRef` guard closes that window.
12. Neither form had `autoComplete` tokens.

#### Preserved contracts (see the freeze suites for the full list)

`companies/{companyId}/leads`; the nine Quick Add form keys and initial values
(`cdlClass: 'A'`); First Name/Last Name/Phone required; `ATS_STATUS_NEW`;
`source: 'manual_entry'`; `createdBy`/`createdAt`/`updatedAt`; every toast and
in-page message; import-method and assignment-mode values; team-member ids and
round-robin order; the CSV template headers/sample row/filename; accepted file
formats; Google Sheet behaviour; preview field filtering; upload/repair
callback arguments; `LEAD_DEFAULT_STATUS` and the bulk-import source strings.

#### Documented exceptions

- `CompanyBulkUpload`'s "Select Recipients" group uses `role="group"` with an
  adjacent Select-All action rather than the approved `ChoiceGroup`, because
  `ChoiceGroup` renders a bare `<legend>` with no slot for a sibling action.
- `QuickLeadModal` (a separate dashboard-launched quick-add modal, with its own
  phone-or-email rule and `LEAD_DEFAULT_STATUS`) was out of this campaign's
  scope, named in the brief as `QuickAddLeadPage` only, and remains unmigrated.

#### Verification

91 new focused unit tests beyond the 99 freezes (contract + a11y/defect,
per-file counts in the inventory row above), full suite/coverage (2075 passed,
0 regressions), lint (0 errors), typecheck (clean), production build, the
callable-contract check (unaffected — this surface writes via the Firestore SDK
directly, not callables), 25 new Chromium + 19 Mobile Chrome E2E covering the
real import Web Worker parse, the Google Sheet error path, assignment/recipient
selection, the data-repair dialog, the large-preview row cap and bounded
scroll (the defect above), a keyboard walkthrough, axe on every major state,
1440/1024/412 px overflow checks, regression E2E on the other
`BulkUploadLayout`/`useBulkImport` consumers (`AudienceBuilder`, the company
dashboard shell — both pass unchanged), and `git diff --check`.

---

### Company Settings closeout completion log (GO) — 2026-07-28

Scope: full reconciliation of the **Company Settings** row. Base `origin/main`
at `2580d1d` (merged PR #122) with a clean tree.

#### Audit: resolving the 2026-07-27 reconciliation flag

Every tab claimed migrated by section 8's narrative was read in full, not
just trusted: `CompanyProfileTab` + `profile/`/`questions/` subcomponents,
`TeamManagementTab` + `ManageTeamModal`, `BillingTab`, `AutomatedSmsTab`,
`EmailSettingsTab`, `PersonalProfileTab`. `BillingTab`, `AutomatedSmsTab` and
`PersonalProfileTab` were fully clean — no defect, no hardcoded color, no
sub-12px text. Three real gaps surfaced in files otherwise already on the
design system (defects below). The two areas the roadmap itself listed as
open — `NumberAssignmentManager` (SMS number assignment) and `IntegrationsTab`
(Integrations) — were unchanged since their respective 2026-07-23 deep-audits
and matched those audits' findings exactly.

#### Defects found and fixed

1. **`ManageTeamModal.jsx`** used `window.confirm` for the remove-team-member
   guard and a bare `alert("Error saving goal")` for a failed goal save —
   both inside a file the roadmap called "full GO." Replaced with a nested
   accessible confirmation dialog (exact frozen question text preserved) and
   an inline, per-member `role="alert"` message (exact frozen text
   preserved). Proven with a real nested-dialog test: both dialogs
   simultaneously in the DOM, focus moving into the nested one on open and
   returning to the exact trigger button when it closes via Escape.
2. **`CustomQuestionsBuilder.jsx`** used a blocking `alert()` for its
   DOT-required delete guard. Replaced with an inline `role="alert"`
   message, exact frozen text preserved, cleared on the next successful
   delete.
3. **`CompanyProfileTab.jsx`**'s own header and internal tab-strip (not a
   subcomponent — the file the roadmap itself names) still used raw
   `border-gray-200`/`text-gray-900`/`text-gray-500`/`border-blue-600` etc.
   alongside already-tokenized sibling markup. Tokenized in place.
4. **`EmailSettingsTab.jsx`**'s "How to Set Up SMTP" guide (Gmail/Outlook/
   SendGrid cards, ~70 lines) never used a single `ds-*` token despite sitting
   inside an otherwise fully-migrated component. Tokenized in place
   (Gmail/Outlook mapped to the `info` status tone, SendGrid to `accent` to
   preserve the three cards' visual distinction).
5. **`CompanySettings.jsx`** (the shell) had no page-level heading at all for
   seven of its eight tabs — only the Security Profile tab (via its own
   `PageHeader`) had one. Added a shell-level `<h1>Company Settings</h1>`,
   suppressed only on the one tab that already supplies its own, so no page
   ever carries two competing h1s.
6. **`CompanySettings.jsx`** also carried a **dead success-toast mechanism**:
   a local `showSuccess`/`successMsg` handler was passed to four tabs as
   `onShowSuccess`, but grepping every real tab confirmed none of them ever
   call it — each already uses the shared `useToast()` directly. The hard-coded
   green `fixed bottom-8 right-8` toast bar it drove could never render in
   production. Removed; nothing user-visible changed (proven by the existing
   and new shell tests, all passing before and after).
7. **`NumberAssignmentManager`/`DefaultLineSection`/`AssignmentTable`/
   `AssignmentRow`** — the exact debt the 2026-07-23 SMS deep-audit recorded:
   unlabelled per-row and default-line `<select>`s, `text-[9px]`/`text-[10px]`
   status text, and color-only status dots. Fixed: every select now has an
   `aria-label` naming its recruiter or "Company default line"; every status
   is now paired with visible/`sr-only` text via `Badge`, never color alone;
   all text floors at `--ds-font-size-xs`. The editable matrix deliberately
   stays a native `<table>`, not the approved `DataTable` — that unproven-fit
   finding from the 2026-07-23 audit is unchanged — but the table now has
   `scope="col"` headers, a `<caption>`, and sits in a labelled, focusable
   horizontal-scroll region for mobile overflow. A dead "Refresh Inventory"
   button with no `onClick` handler at all (a false affordance) was removed.
8. **`SMSDiagnosticModal`** was a hand-rolled `fixed inset-0` overlay with no
   dialog semantics and an icon-only close control with no accessible name;
   its sender `<select>` had a visually-adjacent `<label>` with no
   `htmlFor`/`id` pairing, so it was never programmatically associated.
   Migrated to the shared accessible `Modal` with `FormField`-paired controls.
9. **`IntegrationsTab`** — presentation-only fixes matching the 2026-07-23
   Integrations deep-audit's recorded debt: the "Connected" state was a
   10 px color pill; the "SDK Loading..." notice had no live-region role.
   Both fixed (`Badge`, `role="status"` `FieldMessage`). A **real
   color-contrast regression was caught by a live Chromium axe scan**: the
   "More Integrations Coming Soon" placeholder card carried the pre-migration
   markup's `opacity-70` on the whole card, which dims every descendant color
   toward the background — including the approved `--ds-color-content-muted`
   token, which passes WCAG AA on its own (enforced by
   `design-system/tests/tokens.test.js`) but fails once dimmed to 70%.
   Removed the opacity; the placeholder look is carried by the dashed border
   and muted tokens alone, at full opacity.
10. A second color-contrast finding from the same axe scan was in
    `LineManager.jsx` (`text-[10px] text-gray-400`, Phone Line Wallet) — this
    is the explicitly out-of-scope, Super-Admin-owned shared component next to
    `NumberAssignmentManager` on the same tab. **Not fixed here** — it belongs
    to whoever owns that shared component — and the new SMS-numbers E2E spec
    scopes its axe check to `[data-testid="number-assignment-manager"]`
    specifically so this campaign does not claim credit for, or silently
    mask, a defect in code it did not touch.

#### Preserved contracts (frozen by the respective 2026-07-23 deep-audits, unchanged)

SMS: the live `sms_provider` Firestore doc shape, `saveSmsLineAssignments`/
`verifyLineConnection`/`verifySmsConfig`/`sendTestSMS` callable payloads, the
stable line-token model (`<select>` option values are never raw phone
numbers), `MISSING_TOKEN` resilience, the roster resolution and one-time
legacy-token backfill, and the safety-critical 15-case
`NumberAssignmentManager.test.jsx` suite (cases A–O), which passed unchanged
before and after. Integrations: the Facebook SDK-load sequence,
`FB.login` scope string, the Graph API first-page-only auto-select,
`connectFacebookPage({ shortLivedUserToken, pageId, pageName })`, every
message, and the connected-state limitation itself (local React state only —
no persistence, no disconnect/reconnect flow; none was invented, since adding
one would be new business logic with no backend support, not a presentation
fix). The **tenant-binding security defect** in `connectFacebookPage`
(`request.auth.uid` instead of the real company id) recorded by that audit is
**still unfixed** — this migration is presentation-only and does not touch
`functions/`, so it does not and cannot make that workflow production-ready;
it remains a separate, security-reviewed backend project. Team & Users:
`createPortalUser`/`deletePortalUser` callables, the membership `onSnapshot`
subscription, the goal `setDoc` write, and the tracking-link construction.
Application questions: `applicationConfig`/`customQuestions` shape,
`crypto.randomUUID()` creation, and the DOT-required deletion protection rule
(only its *delivery* changed, from blocking to inline, with the exact same
wording). No Firebase, Firestore, Storage, Functions, rule, index, schema,
route, tab id, permission check, or callable payload changed anywhere in this
campaign.

#### Verification

99 contract-freeze tests written before any presentation change (7
`SMSDiagnosticModal`, 11 `IntegrationsTab`, plus the pre-existing frozen
15-case `NumberAssignmentManager` suite and the pre-existing
`ManageTeamModal`/`CustomQuestionsBuilder` suites used as the freeze) plus 91
new a11y/defect-proof tests (14 `NumberAssignmentManager`, 9
`SMSDiagnosticModal`, 8 `IntegrationsTab`, plus new/updated cases in
`ManageTeamModal.test.jsx`, `CustomQuestionsBuilder.test.jsx`, and
`CompanySettings.test.jsx`) — all passing. Full frontend suite/coverage: 2129
passed, 0 regressions (48 pre-existing emulator-gated rules tests skipped by
their environment guard). Lint: 0 errors (132 pre-existing warnings, none in a
changed file). Typecheck: clean. Production build: passed. Callable-contract
check: passed (56 frontend callables verified; this campaign added no new
callable reference). Two new E2E specs
(`company-settings-sms-numbers.spec.cjs`, `company-settings-integrations.spec.cjs`)
plus the full 12-spec Company Settings E2E regression suite ran serially on
Chromium (51 passed, 13 skipped, 1 failure — `company-settings-automated-sms.spec.cjs`'s
"announces an accessible loading status" case, reproduced in isolation on
this same commit; `AutomatedSmsTab.jsx` and its test were not touched by this
campaign, and the spec's own code comment already documents this exact
Firestore-offline-timing race as pre-existing) and Mobile Chrome (38 passed,
0 failed, 27 skipped). 1440/1024/412 px overflow checks and a real-browser
axe scan on every new/changed surface (the axe scan is what caught defect 9
above). `git diff --check` passed.

#### Documented exceptions

- The SMS assignment matrix stays a native `<table>`, not the approved
  `DataTable` — an explicit, unchanged carry-forward of the 2026-07-23
  deep-audit's "no safe universal conversion" finding for editable-matrix
  tables, not a new decision.
- Integrations is migrated in **presentation only**. It is not, and this
  campaign does not claim it to be, production-ready: the tenant-binding
  defect stands and must be fixed by a separate security-reviewed project
  before this workflow should be relied on.
- `LineManager.jsx` (Phone Line Wallet, Super-Admin-owned, shared with
  Super Admin's own integrations screen) is untouched and has its own
  pre-existing color-contrast defect (`text-[10px] text-gray-400`), recorded
  here for whoever owns that component, not fixed in this campaign.

### Super Admin shell, navigation and dialogs completion log (GO — partial row) — 2026-07-28

**Scope completed:** the Super Admin *shell* and *all five dialogs*. The eleven
data/ops views behind the navigation rail are **not** migrated. The row 5.1
entry stays `In progress` and the overall figure stays **18 of 19 (94.7%)**.

**Baseline:** `origin/main` at `9ea49eedbdd969464358b66e12e7daf322a017b3`.

#### Phase 0 — CI regression repaired before any migration work

The final `frontend-quality` run on PR #124's head **failed**: six
`e2e/company-settings-sms-numbers.spec.cjs` tests timed out waiting for
`SMS Integration Not Active`, all retries exhausted. The same spec passed
locally. Root cause was an environment divergence, not a flake:

- CI exposes the real `VITE_FIREBASE_*` secrets as workflow-level env vars, and
  Vite inlines them into whatever it serves — including the Playwright dev
  server. The E2E browser therefore talked to the **real Firestore project**
  while `DataContext` supplied a mock, non-Firebase user, so every listen
  returned `PERMISSION_DENIED`.
- `useLineAssignments` called `onSnapshot(ref, next)` with **no error callback**,
  so a failed listen ran neither callback: `loading` stayed `true` forever and
  the screen showed "Loading inventory..." indefinitely.
- Locally there is no `.env`, the placeholder-project branch applied, the app
  went offline, and the same specs passed. That is the whole divergence.

Two fixes, both of which stand on their own merits:

1. **Genuine production defect** — `useLineAssignments` now registers an error
   callback that settles `loading` and records the failure, and
   `NumberAssignmentManager` renders a distinct announced error state. It
   deliberately does **not** reuse the "SMS Integration Not Active" copy: a
   failed read says nothing about whether SMS is enabled, and claiming it would
   send an admin to a Super Admin to enable something already on.
2. **E2E isolation** — `src/lib/firebase/config.js` now forces the placeholder
   Firebase project whenever `VITE_E2E_TEST_MODE=1` (and never in `PROD`). The
   replacement is whole-object, not per-key `||` fallbacks, because in CI every
   real key is present and per-key fallbacks would silently keep using the real
   project. E2E can no longer read or write production data.

**Correction — the first attempt at (2) was incomplete and CI proved it.** After
that fix the same six tests failed again, identically. Placeholder credentials
are not sufficient: on a CI runner with real internet, `firestore.googleapis.com`
is reachable even for a project that does not exist, so the WebChannel retries
the rejected request indefinitely with backoff — neither the snapshot callback
nor the error callback ever fires, and a surface waiting for its listener to
settle hangs forever. On a sandbox with blocked egress the connection fails
instantly, the SDK goes offline and raises a cached empty snapshot, and the same
surface settles at once. That difference, not the credentials, is what made the
spec pass locally and time out in CI.

The working fix additionally points E2E Firestore at `127.0.0.1:9` (the reserved
discard port, never listening) via `connectFirestoreEmulator`. The connection is
refused immediately, so the SDK drops into offline mode the same way in every
environment. This makes the specs' stated premise — "Firestore is deliberately
unreachable under `VITE_E2E_TEST_MODE=1`" — true by construction rather than an
accident of the sandbox's network policy.

The lesson worth keeping: "unreachable" was assumed rather than enforced, and the
assumption held in exactly one environment.

Evidence: `NumberAssignmentManager.listener.test.jsx` (6 tests) fails 5/6
against the pre-fix hook and passes 6/6 after, with a control test that passes
both ways; `config.e2eIsolation.test.js` (3 tests) pins both directions; the
previously-failing spec re-run locally **with CI-like secrets injected** —
6 passed, 0 failed.

#### What was migrated

- **Shell** (`SuperAdminDashboard`, `DashboardHeader`, `SuperAdminSidebar`):
  design-system `Button`/`IconButton`/`Input` and `--ds-*` tokens throughout;
  `bg-gray-50`/`bg-blue-600`/`bg-orange-600`/`bg-red-500`/`text-gray-*` removed.
- **Five dialogs** (`EditCompanyModal`, `DeleteCompanyModal`, `EditUserModal`,
  `DeleteUserModal`, `ViewCompanyAppsModal`) moved from hand-built
  `fixed inset-0` overlays to the shared accessible `Modal`.

#### Defects found and fixed

1. **Blocking `window.confirm` + `alert()`** guarding and reporting the
   employer backfill — replaced with an accessible confirmation dialog and a
   result dialog carrying the same four counters. Blocking dialogs freeze the
   page and are suppressible by the browser, which would silently leave a
   destructive maintenance action unguarded.
2. **Unlabelled global search input** — placeholder only, which is not an
   accessible name and vanishes on input.
3. **Unnamed clear-search control** — icon-only raw `<button>`.
4. **Navigation had no accessible name**, and the active view was signalled by
   colour alone. Now a named `<nav>` with `aria-current="page"`.
5. **Mobile overflow** — the rail was `w-full sm:w-64 shrink-0` inside a `flex`
   row next to `flex-1` content, so below `sm` it demanded the full viewport
   *and refused to shrink*, pushing the main region off screen. It now stacks.
6. **Two `<h1>` elements on five views** — the masthead plus a view heading.
   Caught by the new E2E spec, not by review. The five view-level `<h1>`s are
   demoted to `<h2>`; the masthead is the single page heading.
7. **Duplicate DOM ids** — both plan radios in `EditCompanyModal` rendered
   `id="planType"`, breaking `<label for>` association. Now a real `ChoiceGroup`
   with distinct ids; the plan was also communicated by border colour alone.
8. **No dialog semantics anywhere** — no focus trap, no Escape, no focus
   restoration, unnamed icon-only close controls on all five modals.
9. **Unannounced errors** — delete failures, company-save failures and the
   application-load failure were plain text; now `role="alert"`.
10. **`ViewCompanyAppsModal` dismissed on drag-release** — the old overlay
    closed on any backdrop click and relied on `stopPropagation`, so selecting
    text in the table and releasing outside the panel closed the view.
11. **Colour-only status** in `ViewCompanyAppsModal`, produced by a brittle
    `getStatusColor(...).replace('bg-', ...).replace('text-', ...)` rewrite.
12. **Backdrop dismissal of destructive confirmations** — now disabled, and
    Escape is suppressed while a delete is in flight.

#### Contracts preserved (frozen by test)

`backfillEmployerFields` name, `{ timeout: 540000 }` and `{ dryRun: false }`
payload, plus the `showInfo` → `showSuccess(result.data.message)` →
`refreshData()` sequence; `deleteCompany({ companyId })` and
`deletePortalUser({ userId })` with their `onConfirm()` → `onClose()` order;
the exact `updateCompany(id, data, originalSlug)` payload including
`appSlug.toLowerCase().trim()` and `state.toUpperCase()`; `loadApplications`
and its multi-shape name/email/phone resolvers and `submittedAt` → `createdAt`
→ `'--'` date precedence; every `SUPER_ADMIN_VIEWS` value routed by the rail;
the search-clear-on-navigate behaviour; the `logout-button-super`,
`edit-user-close-btn`, `delete-company-modal`, `delete-user-modal`,
`edit-company-modal`, `edit-user-modal` and `view-apps-modal` ids.

`useSuperAdminData` was **not** modified: query paths, ordering, limits,
cursors, Load More semantics, company-map construction, combined lead/app
mapping, `status`/`sourceType` values and cached platform-stat behaviour are
byte-for-byte unchanged.

#### Verification

- `npx vitest run` — **2196 passed, 48 skipped, 0 failed** (2129 before; 67 new
  tests, no regressions).
- 15 shell contract/a11y tests; 45 modal tests including axe on all five
  dialogs; 6 listener-defect tests; 3 firebase-isolation tests.
- `e2e/super-admin-shell.spec.cjs` — new; **20 passed on Chromium +
  Mobile Chrome**, zero serious/critical axe violations, 1440/1024/412 px
  overflow clean, keyboard-only walkthrough, focus restoration asserted.
- `e2e/company-settings-sms-numbers.spec.cjs` re-run with CI-like secrets —
  6 passed.
- `npx eslint` on changed files — 0 errors (2 pre-existing warnings).
- `npx tsc -p jsconfig.json --noEmit` — clean.
- `npm run build` — succeeds.
- `git diff --check` — clean.
- `gitleaks detect` over the branch range — reproduced the `secret-scan` failure
  locally, then confirmed 0 findings after allowlisting the one known-fake
  placeholder literal by exact string (not by path or rule).

#### Approved feature-owned exception

- The `EditCompanyModal` logo `<input type="file">` stays raw. The design system
  still has no approved file-input contract — the same exception already
  recorded for the public driver application and the PEV result upload.

#### Two exceptions claimed in review and then withdrawn

Automated review on PR #125 rejected two exceptions this campaign initially
claimed, and it was right on both counts:

- **`SuperAdminSidebar` was hand-rolled**, justified by calling
  `SectionNavigation` a "flat list" contract. That was factually wrong:
  `SectionNavigation` takes `groups`, and already owns `aria-current`, roving
  Arrow/Home/End focus movement, a named `<nav>` landmark and a responsive
  `mobileLayout`. The hand-rolled rail recreated precisely the competing visual
  primitive — feature-local active, hover, focus, spacing and radius treatments
  — that this migration exists to remove. It now consumes `SectionNavigation`,
  which also gives the rail keyboard arrow navigation it never had. The group
  keys (`core`/`data`/`ops`/`create`) gain visible labels, so the grouping is
  announced instead of implied by a decorative divider.
- **`ViewCompanyAppsModal` kept `getStatusColor`**, which returns legacy palette
  classes (`bg-green-100`, `text-red-800`, ...). Adding text alongside the colour
  fixed the colour-only defect but left arbitrary colours inside a surface
  declared migrated. Status is now an approved `Badge`, with the domain→tone
  mapping owned by the feature (the design system must not know what "Background
  Check" means, and the feature must not invent colours).

The `DataTable`-inside-a-dialog exception for that same modal's table stands: the
approved `DataTable` contract has not been proven inside a dialog with its own
scroll container and sticky header.

#### Remaining scope for this row (explicitly NOT done)

`DashboardView`, `AnalyticsView`, `CompaniesView`, `UsersView`,
`UnifiedDriverList`, `GlobalSearchResults`, `FeaturesView`,
`IntegrationManager` / `LineManager` / `AddLineModal`, `GlobalQuestionsManager`,
`SystemHealthView`, `StatsBackfillPanel`, `CreateView`.

Known defects already identified in those views but **not yet fixed**, recorded
here so they are not lost:

- `FeaturesView` — the per-feature toggles are raw `<button>`s with **no
  accessible name and no `aria-checked`**, so a screen-reader user cannot tell
  what they toggle or what state they are in. Bulk enable/disable is guarded by
  `window.confirm`. Two hand-built overlays. `text-[10px]` schedule text.
- `StatsBackfillPanel` — **"Run All Companies" has no confirmation at all**,
  while the single-company action does. It also names a real customer
  ("Ray Star LLC") in production help copy.
- `CompaniesView` — `window.confirm` + `alert()` for activate/deactivate;
  `filteredCompanyList`'s `useMemo` omits `displayList`/`enrichedCompanies` from
  its dependency list, so enriched SMS numbers can fail to appear until an
  unrelated re-render; icon-only row actions rely on `title` alone.
- `UsersView` — icon-only row actions rely on `title` alone.
- `LineManager` — `text-[10px]` on the usage-type chip and the security notice
  (`text-gray-400`, a contrast failure), and `window.confirm` for line removal.
- `SystemHealthView` — `window.confirm` on Reset; the log terminal is not a
  live region.
- `UnifiedDriverList` — receives `loadMore`/`hasMore` from `ViewRouter` but uses
  neither, so the Unified Driver DB has **no working Load More** despite the
  router wiring one. Needs a decision: wire it up or remove the dead props.

### Super Admin data/ops views completion log (GO — partial row) — 2026-07-28

**Scope completed:** seven of the eleven views behind the Super Admin rail.
**Four remain unmigrated**, so the 5.1 row stays `In progress` and the overall
figure stays **18 of 19 (94.7%)**. Base: `origin/main` at `c5e09ef`.

#### Migrated

`DashboardView`, `AnalyticsView`, `CompaniesView` (both normal and
`isIntegrationMode` / SMS Integrations Hub), `UsersView`, `GlobalSearchResults`,
`FeaturesView`, `StatsBackfillPanel`, `UnifiedDriverList`.

#### Not migrated (remaining scope for this row)

`IntegrationManager`, `LineManager` + `AddLineModal`, `GlobalQuestionsManager`,
`SystemHealthView`, `CreateView`.

#### Defects found and fixed

1. **`CompaniesView` stale derived data.** `filteredCompanyList`'s `useMemo` read
   `displayList` but listed `[companySearch, companyList]`. When the async SMS
   enrichment resolved, the filtered rows never recomputed, so the Integrations
   hub showed blank SMS numbers until an unrelated re-render. Regression-guarded:
   the test fails against the old dependency array.
2. **`CompaniesView` row actions double-fired.** The row `onClick` opened the
   editor and the action buttons did not stop propagation, so "View
   Applications" or "Delete" *also* opened the edit modal — two dialogs at once.
3. **`CompaniesView` was unusable by keyboard.** Opening a company was a click
   handler on `<tr>` with no role/tabIndex/key handling. The company name is now
   a real button; pointer row-click is preserved.
4. **`FeaturesView` toggles had no accessible name and no state** — bare
   `<button>`s with a styled `<span>`, no text, no `aria-label`, no
   `aria-checked`. The worst defect in the area. Now approved `Checkbox`
   controls labelled with both feature and company.
5. **`StatsBackfillPanel` "Run All Companies" had no confirmation at all**,
   while the single-company action required an explicit ID. It rewrites
   `stats_daily` for every company and runs up to nine minutes. Now behind an
   accessible confirmation; the non-mutating dry-runs stay unguarded.
6. **`UnifiedDriverList` Load More was wired but ignored.** `ViewRouter` passes
   `loadMore`/`hasMore` and `useSuperAdminData` fully supports
   `loadMore('applications')`, but the view destructured and never used them, so
   older records were unreachable. Wired to the same control `CompaniesView`
   already uses — no new workflow invented.
7. **`UnifiedDriverList` row actions were hover-only** (`opacity-0
   group-hover:*`), invisible to keyboard users. Now revealed on focus too.
8. Blocking `window.confirm`/`alert()` replaced with accessible dialogs in
   `CompaniesView` (activate/deactivate) and `UnifiedDriverList` (permanent
   delete), wording preserved verbatim.
9. Colour-only status in `GlobalSearchResults` (`getStatusColor` pill) and
   `UsersView` role chips — now `Badge`s whose text carries the meaning.
10. **`AnalyticsView` tabs and date range were colour-only** with no
    `aria-selected`/`aria-pressed` and no arrow-key movement. Now a real
    WAI-ARIA tab interface with roving focus.
11. **The Analytics trend chart was an unlabelled `<svg>`** — invisible to
    assistive technology. Now `role="img"` with a summarising name plus a
    visually-hidden table of the same figures.
12. **Real-browser contrast failures the jsdom axe could not see.** Table
    headers used `content-muted` on `surface-subtle` = **4.34:1** (below 4.5).
    The design system already specified the correct pairing
    (`--ds-table-header-fg: content-secondary`, 6.92:1); 13 headers across five
    files were corrected. A tinted `status-info-bg` card also dropped DS field
    help text to 3.9:1 and was de-tinted.
13. **`ModernDriverTable` (shared) a11y defects**, surfaced by the Unified
    Driver DB axe run: select-all and per-row checkbox buttons had **no
    accessible name**, both pagination buttons had **no accessible name**, and
    the empty-state message was `#94a3b8` on white = **2.56:1**. Fixed in the
    shared component; its other consumer (company candidate table) re-verified.
14. **`scrollable-region-focusable` on mobile** — in the empty state the table
    scroll containers held no focusable children, so keyboard users could not
    scroll them. Now named, focusable regions, matching the pattern already used
    by `EnvelopeHistory` and `CampaignResultsTable`.
15. Unlabelled search inputs and all four `UnifiedDriverList` filter selects.
16. `text-[10px]` removed from `FeaturesView` schedules, `AnalyticsView` axis
    labels and the recruiter company name.
17. Two hand-built `fixed inset-0` overlays in `FeaturesView` (schedule, alert
    stats) moved to the shared accessible `Modal`.

#### Design-system additions

- `MetricCard` gained a `danger` tone. The status-danger tokens already existed
  and `Card`/`Badge`/`StatusMedallion` already exposed danger; `MetricCard` was
  the only primitive missing it, and the Super Admin dashboard has a real
  "Error" metric state that every other tone misrepresents.
- `Checkbox`/`Radio` gained `labelHidden`. `label` stays required — this changes
  only whether the name is *shown*. Needed for the feature matrix, where row and
  column headers already carry the meaning for sighted users.

#### Contracts preserved (frozen by test)

`useSuperAdminData` untouched. Frozen: the `features.{key}` /
`featureSchedules.{key}` update shapes and the clear-schedule-on-manual-toggle
rule; `backfillCompanyStats` / `backfillAllStats` names, `{ timeout: 540000 }`
and `{ companyId, dryRun }` / `{ dryRun }` payloads; the
`companies/{id}/{applications|leads}/{id}` delete path; `updateDoc(companies/{id},
{ isActive })`; the CSV export column order, headers and filename patterns; the
`callsMade > 20` High/Low rule; the `super_admin`-over-memberships precedence and
`company_admin → Admin` label rule; the `allCompaniesMap.get(...) || "Unknown"` /
`'Unknown Company'` fallbacks; `loadMore('companies')` and
`loadMore('applications')`; every `sourceType`, status value and toast string.

#### Verification

- `npx vitest run` — **2306 passed, 48 skipped, 0 failed** (2200 before; 106 new).
- 167 focused Super Admin unit tests across 10 files.
- `e2e/super-admin-views.spec.cjs` (new) + `super-admin-shell.spec.cjs` —
  **38 passed on Chromium + Mobile Chrome**, zero serious/critical axe on every
  migrated view on both lanes, 1440/1024/412 px overflow clean, single `<h1>`
  per view, keyboard tab-strip walkthrough, platform-wide backfill confirmation.
- `company-candidate-table.spec.cjs` re-run to prove the shared
  `ModernDriverTable` change did not regress its other consumer.
- `npx eslint src` — 0 errors. `tsc --noEmit` clean. `npm run build` succeeds.
  `git diff --check` clean.

#### PRODUCT / LEGAL blockers — deliberately not decided here

1. **`UnifiedDriverList` bulk actions are false affordances.** Message, Assign,
   Move Status and Archive are placeholders that only fire a success toast.
   Archiving 50 records reports success and archives nothing. Implementing them
   would be inventing a workflow and the toast wording is a frozen contract, so
   the behaviour is preserved exactly and escalated for an owner decision.
2. **`StatsBackfillPanel` names a real customer in operator copy** — "Only run
   after verifying Ray Star LLC results." Preserved verbatim; the repository
   establishes no generic replacement wording.
3. **`FeaturesView.handleBulkAction` is unreachable** — the handler exists but
   nothing renders a bulk control, so the platform has no bulk enable/disable
   UI. Left intact rather than migrated or deleted.

#### Approved feature-owned exceptions

- Native tables instead of `DataTable` in `CompaniesView`, `UsersView` and
  `FeaturesView`: all three carry per-row interactive controls (and, in
  Companies, a row-level click target), which is outside `DataTable`'s proven
  display-table contract. Same exception already recorded for
  `CampaignResultsTable`, `AssignmentTable` and `ViewCompanyAppsModal`.
- The `AnalyticsView` SVG trend-chart geometry stays feature-owned; only its
  colours, labels and surrounding card are standardised. The design system has
  no approved chart contract.
- `FeaturesView` uses a native `Checkbox` rather than an ARIA switch: there is
  no approved switch primitive. The `ToggleSwitch` in Company Settings is
  feature-owned and importing it across features would break layering. **Gap
  recorded**: promoting a `Switch` to the design system remains open.

### Super Admin review-defect closeout + integration contract freeze — 2026-07-28

**Row status unchanged: `In progress`, still 18 of 19 (94.7%).** This slice
fixes the two review defects merged with PR #127 and freezes the SMS-integration
security contracts ahead of that migration. It does **not** migrate any of the
four remaining views, so the figure does not move. Base: `origin/main` at
`1b90976`. Branch: `claude/super-admin-final-views` (uncommitted).

#### Review defects fixed

1. **Unified Driver DB "Load More" allowed overlapping concurrent loads.** The
   visible button called `loadMore(type)` with no in-flight guard, so two fast
   activations both read the same (stale) Firestore cursors, fetched the same
   batch and appended it twice — duplicate records and duplicate React keys. The
   guard now lives in `useSuperAdminData.loadMore`: a `useRef` flag keyed by type
   flips synchronously before any `await`, rejecting a duplicate concurrent
   invocation at the handler level (not just visually); a `loadingMore` state is
   threaded through `ViewRouter` to both `UnifiedDriverList` and `CompaniesView`
   so the button disables and shows a loading state; `finally` releases the guard
   so a retry after failure works. Pagination semantics, cursors, mapping,
   ordering, append behaviour and `loadMore('applications')` / `loadMore('companies')`
   are all unchanged. `CompaniesView` shared the same risk through the same shared
   handler and is fixed by the same guard. Regression-guarded at the hook level
   (rapid double-activation fetches once, no duplicate ids appended, per-type
   guard lets companies and applications load concurrently, retry works) plus
   component-level disabled-state proofs in both views.
2. **Analytics accessible peak reported the visual scaling floor, not the data.**
   The trend chart floors its visual scale at 5 (`Math.max(dataPeak, 5)`) so a
   quiet period is not stretched to full height, but its `role="img"` summary
   announced that floored maximum as the real activity peak (e.g. a true peak of
   2 announced as "peaking at 5"). The real data peak is now computed separately
   for the accessible text; the floored maximum still governs only the SVG
   geometry. Tested across all-zero data, real peak below/at/above the floor, and
   that the polyline coordinates still use the floored maximum while the summary
   always reports the true peak.

#### Integration contract freeze (Phase 2 — first step)

`IntegrationManager.contract.test.jsx` (new, 11 contract tests + 3 jsdom axe)
locks the security-sensitive SMS contracts before any presentation change: the
`companies/{id}/integrations/sms_provider` read path; initial `ringcentral` /
`isSandbox: true`; **encrypted credentials never loaded into form fields** and
never rendered into the DOM; `hasExistingCredentials` detection via the `:`
separator; the `__PRESERVE__` sentinel for blank-but-existing credentials and
typed-value override; RingCentral / 8x8 required-credential validation; phone
sanitisation and string coercion of every config value; `saveIntegrationConfig({
companyId, provider, config })` and `sendTestSMS({ companyId, testPhoneNumber })`
payloads; and the exact save/verify/test toast wording.

#### SMS integration group migrated (Phase 2 — COMPLETE for the three components)

All three SMS-integration components are now migrated to the design system with
their contracts frozen by test first:

- **`IntegrationManager.jsx`** → `Card`, `Button`, `FormField`, `Input`,
  `Checkbox`, `Badge`, `--ds-*` tokens. Defects fixed: legacy palette/hex focus
  rings removed; `text-[10px]`/`text-[11px]` notes removed (8x8 sender hint moved
  into an accessible `FormField` description); the colour-only blue/orange
  provider selector is now a `role="group"` of `Button`s with `aria-pressed`;
  the colour-only "✓ Saved" span is now a `Badge`; credential inputs have wired
  labels/required via `FormField`.
- **`LineManager.jsx`** → `Card`, `Button`, `IconButton`, `Badge`, plus the
  shared accessible `Modal` and `SafeHaulLoader`. Defects fixed: the blocking
  `window.confirm` on the destructive remove replaced with the shared dialog
  (wording preserved); gradient header + legacy palette → tokens; colour-only
  status/default pills → `Badge`s with text + icon; the icon-only remove control
  now has an accessible name (`Remove line {number}`); `text-[10px]` on the
  usage-type chip and the security notice removed; the table now sits in a named,
  focusable scroll region for mobile keyboard access.
- **`AddLineModal.jsx`** → the hand-built `fixed inset-0` overlay (no focus trap,
  no Escape, no focus restore) replaced with the shared accessible `Modal`;
  `FormField`/`Input`/`Textarea`/`Checkbox`/`Button` with wired labels;
  gradient/palette → tokens; `text-[10px]` help text moved into accessible
  descriptions.

Frozen contracts unchanged: the `sms_provider` read path and real-time listener,
`ringcentral`/`isSandbox:true` defaults, no-credential-prefill, `:`-separator
detection, `__PRESERVE__` sentinel, RC/8x8 validation, phone sanitisation, string
coercion, and every callable payload — `saveIntegrationConfig`, `sendTestSMS`,
`removePhoneLine({ companyId, phoneNumber })`, `testLineConnection`,
`addPhoneLine` (including the `label || phoneNumber` fallback and credential
omission when not needed) — plus every toast string. The phone number remains the
stable line identity used for removal; no raw-token substitution was introduced.

**The Super Admin row still stays `In progress` at 18/19**: Phases 3–5
(`GlobalQuestionsManager`, `SystemHealthView`, `CreateView`) remain unmigrated,
and the row's real-browser axe / E2E bar has not been re-run for these views.

Verification for this group: `vitest run src/features/super-admin/` **214 passed
/ 0 failed** across 14 files, including 3 new integration test files (36 tests:
IntegrationManager 11 contract + 3 axe, LineManager 6 contract + 3 remove-flow +
2 axe, AddLineModal 10 contract + 1 axe); `npm run build` succeeds; eslint 0
errors (2 pre-existing unused-var warnings in IntegrationManager's untouched
fetch logic); tsc clean; `git diff --check` clean. **Not run**: real-browser axe
(these views sit behind super-admin auth + company selection and are not
reachable from the dev preview here) and Playwright E2E.

#### GlobalQuestionsManager migrated (Phase 3 — COMPLETE for this view)

`GlobalQuestionsManager.jsx` is a thin wrapper: the question list, create/edit,
type/required/active controls, reordering, per-field validation and delete
confirmation all live in the shared **already-migrated** `CustomQuestionsBuilder`
(a settings-feature primitive this view reuses — the "already shares a proven
presentation primitive" case, so no re-implementation or merge with Company
Settings questions was done). This migration touches only the wrapper's own
presentation: the spinner is now `SafeHaulLoader`; the error block is a `Card`
with a `role="alert"` message and a danger `Button` retry; the version and legend
pills are `Badge`s (was legacy amber/gray/blue palette); the save-success block
is announced (`role="status"`); container spacing on `--ds-*` tokens.

Frozen (by `GlobalQuestionsManager.contract.test.jsx`, 11 tests incl. 2 jsdom
axe): the schema flatten (`field.key → id`, `sectionId`, `sectionTitle`,
`stepNumber`, `order = sectionIndex*100 + fieldIndex`); the save rebuild
(`sanitizeQuestionPayload` per question, group by `sectionId`, strip
`sectionId`/`sectionTitle`/`order`, `Custom Questions`/step 8/order 99 defaults,
`{ ...schema, sections }` shape, `saveSchema` call); the success/clear/3s-reset
behaviour; the `useGlobalSchema` interface; and every user-facing string. The
hook's `system_settings/application_schema` path, version increment and document
shape are owned by `useGlobalSchema` and untouched.

Phases 4–5 (`SystemHealthView`, `CreateView`) remain; the Super Admin row stays
`In progress` at 18/19.

#### Contracts preserved (frozen by test)

`useSuperAdminData` public interface unchanged except the additive `loadingMore`
return. All contracts listed in the previous log entry remain frozen; the SMS
contracts above are newly frozen.

#### Verification (this slice)

- `npx vitest run src/features/super-admin/` — **189 passed, 0 failed** across 12
  files (60 in the four Phase-1-touched files; 11 new integration contract tests).
- `npx eslint` on all changed files — **0 errors** (only pre-existing warnings).
- `tsc -p jsconfig.json --noEmit` — no errors in any changed file.
- `git diff --check` — clean.
- **Not run this slice** (honest gaps): Chromium / Mobile Chrome E2E, real-browser
  axe, full-repo coverage, production build. These are required before the row can
  move and were not part of this defect-and-freeze slice.

### True-100% closeout completion log (GO, with one enumerated open item) — 2026-07-28

Base: `main` / `origin/main` at `d25b3dc3d33cd1a6c2ea4e6fe2e0ffefbb51d7a7`
(verified equal to local `main` before branching). Branch:
`claude/design-system-true-100-closeout`, uncommitted.

**Baseline honesty check.** The two commits after PR #127 (`1fd2215`, `d25b3dc`)
had no CI run. Both diffs were reviewed and the baseline full unit suite was run
on a clean tree: **177 files, 2364 passed, 48 skipped, 0 failed.** The Load-More
concurrency guard, the Analytics accessible-peak fix, and the
IntegrationManager / LineManager / AddLineModal / GlobalQuestionsManager
migrations were all audited against the code (not the roadmap's claim) and found
correctly implemented and test-covered.

#### Scope completed

1. **Super Admin — the last three views.** `SystemHealthView` and `CreateView`
   migrated; **plus `EditUserNameForm` and `UserMembershipsManager`**, which the
   dialog pass had missed entirely.
2. **Design-system addition: an approved inverse (dark) surface role.** The System
   Health log console needed one and there was none, so every dark panel had been
   picking its own `bg-gray-900` / `text-gray-*` pairing — one of them at **2.2:1**.
   Added `surface-inverse`, `surface-inverse-subtle`, `border-inverse`,
   `content-on-inverse`, `content-on-inverse-muted` and four
   `status-*-fg-on-inverse` tokens, the Tailwind bridge, and **12 new contrast
   assertions** pinning every pairing the product puts on it.
3. **Driver Dossier residual bodies** — `DQFileTab`, `ActivityHistoryTab`,
   `NotesTab`. This closes the dossier row's deliberate carve-out (PEV/VOE was
   closed separately on 2026-07-27).
4. **QuickLeadModal** — the dashboard-launched modal, recorded residual since
   2026-07-27.
5. **Global notifications** — `ToastProvider`, `NotificationBell`,
   `NotificationItem`.
6. **The last five hand-built overlays** — `LeadAssignmentModal`,
   `CompanyChooserModal`, `FeatureDeactivationWarning`, `CallOutcomeModalUI`,
   `FeatureLockedModal` — plus `Modal`'s own unapproved default classes.
7. **`ModernDriverTable`** — tokenised, accessibility-repaired, and given a
   precise recorded `DataTable` exception with 33 tests proving nothing hides
   behind it.
8. **Roadmap reconciliation** — four stale `Not started` rows corrected
   (`AssignmentTable`, `StandardQuestionsConfig`, `LineManager`,
   `BulkUploadLayout`), including the `BulkUploadLayout` contradiction this
   campaign was explicitly asked to resolve.

#### Defects found and fixed (beyond palette)

1. **`CreateView` rendered both new-user passwords as `type="text"`** — a new
   portal user's password in clear text on screen, with no autofill hint, on the
   form that calls `createPortalUser`. Now `type="password"` +
   `autocomplete="new-password"`, matching the already-migrated Add-User form that
   posts to the same callable. Payload byte-for-byte identical.
2. **`UnifiedDriverList` bulk actions were false affordances.** Message / Assign /
   Move Status / Archive fired a **success** toast and did nothing; Archive first
   asked `window.confirm("…archive 50 records?")`. An operator could confirm a
   destructive-sounding bulk action on real driver records and be told it
   succeeded. No workflow was invented (none can be inferred safely — see the
   note in the component); the controls are now disabled and explicitly labelled
   unavailable, guarded by 10 regression tests.
3. **`LeadAssignmentModal`'s round-robin pool was unusable by keyboard** — each
   recruiter row was a `<div onClick>` with a `CheckSquare`/`Square` icon standing
   in for a checkbox. No role, no tabIndex, no `aria-checked`, no name.
4. **`NotificationItem` rows were click-only**, and both actions were hover-only
   *and* `title`-named. **`NotificationBell` had no accessible name at all.**
5. **`CreateView`'s plan selector was two `<div onClick>` cards** with a
   border-colour-only selected state.
6. **Nine controls had no accessible name whatsoever** across `CreateView` (3
   selects), `CallOutcomeModalUI` (6), plus `UserMembershipsManager`'s per-row role
   select and `ActivityHistoryTab`'s filter.
7. **Ten blocking `window.confirm`s and thirteen `alert()`s** replaced with
   accessible dialogs and announced live regions, every string preserved verbatim.
8. **`DQFileTab` reached across its own boundary** with
   `document.getElementById('dq-file-input')`, on a hard-coded id that would
   collide if two dossiers were ever mounted.
9. **`ActivityHistoryTab` invented ten icon hues** (`emerald`, `indigo`, `red-500`,
   `yellow`…), none approved and several failing contrast. The feature keeps the
   domain→meaning decision; the values are now semantic tones.
10. **Unannounced silence** on eight long-running or failing operations
    (System Health repair/backfill errors, DQ upload/delete, note save, membership
    load, notification severity, activity/notes/DQ loading).
11. **`animate-pulse` / `animate-bounce` with no reduced-motion guard** on the
    notification bell and the deactivation warning; a dead `shimmer` keyframe
    block in `FeatureLockedModal`.

#### Contracts preserved (frozen by test)

No Firebase rule, index, path, callable name, payload, or business workflow
changed. Newly frozen this campaign: the `createNewCompany` company payload and
both `createPortalUser` payloads (including the with-admin flow using the *new*
company id); the slug auto-generation rule; `updateUser` argument order;
`deletePortalUser`; `sendPasswordResetEmail`; `addMembership` /
`updateMembershipRole` / `deleteMembership` and the two differing role
vocabularies; the `QuickLeadModal` lead payload with `LEAD_DEFAULT_STATUS` and its
phone-or-email rule; the DQ `dq_files` path, Storage path (including its
deliberate `applications` segment for leads), eight `syncTargets` mappings and both
`logActivity` detail strings; the `internal_notes` path, `sharedHistory`
anonymisation and the 100-character log truncation; the `activity_logs` path, five
filter rules and Today/Yesterday/Recent grouping; the `LeadAssignmentModal` batch
payload and round-robin rotation; `ToastProvider`'s four helpers and 4000 ms
default; `ModernDriverTable`'s full prop contract.

#### Verification

- `npx vitest run` — **185 files, 2600 passed, 48 skipped, 0 failed** (2364 at
  baseline; **236 new tests**).
- `npm run test:coverage` — gate passed. Statements 59.97%, branches 58.1%,
  functions 62.03%, lines 61.34% against thresholds 16/13/13/16.
- `npx eslint .` — **0 errors** (105 pre-existing warnings).
- `npm run typecheck` (`tsc -p jsconfig.json --noEmit`) — clean.
- `npm run build` — succeeds, 2653 modules transformed.
- `node scripts/check-callable-contract.mjs` — passed, 56 frontend callables.
- `npm run check:function-exports` — OK, mapped 101 / raw 101.
- `git diff --check` — clean.
- **Chromium E2E:** `super-admin-views` + `super-admin-shell` **31 passed**;
  regression batch (`lead-intake`, `driver-dossier`, `company-shell-dashboard`,
  `company-candidate-table`, `a11y`, `access-control`) **49 passed**; shared
  Modal/Toast consumers (`login`, `edoc-send-template-modal`,
  `campaign-report-modal`, `public-application`, `company-settings-team`)
  **30 passed**. 0 failed.
- **Mobile Chrome E2E:** `super-admin-views` + `super-admin-shell` **38 passed**.
- **Real-browser axe:** zero serious/critical on all ten Super Admin rail views on
  **both** lanes, plus the dossier, candidate-table, lead-intake and
  public-application states covered by the regression batch.
- **Responsive:** 1440 / 1024 / 412 px document-overflow sweeps clean across all
  ten Super Admin views on Chromium, plus the Mobile Chrome device lane.

**Runner note, worth keeping.** A 6-spec Chromium batch at the local default
worker count produced **6 spurious `lead-intake` failures**; every one passed at
`--workers=1` and the first also passed alone. This is exactly the shared
dev-server hazard `AGENTS.md` rule 1 describes and the reason CI pins
`workers: 1`. Re-verified against a clean baseline before concluding it was not a
regression. **Run local Playwright batches with `--workers=1`.**

#### Honest gaps

- The six `window.confirm` sites in section 5.5 are **open**, so the
  repository-wide figure is not 100% even though the 5.1 screen inventory is 19/19.
- Firefox / WebKit / mobile-Safari lanes were not run (CI does not run them either).
- `npm run test:rules:stress` was not run — it needs the Firebase emulators, and
  nothing in this campaign touches rules.
- The Cloud Functions Jest suite was not run — no backend file changed.

### Final-six-confirmations completion log (GO) — 2026-07-28

Base: `main` / `origin/main` at `113a118fc9fc241975ce4a8bf660f394985bd572`
(verified equal to local `main` before branching). Branch:
`claude/final-six-confirmation-dialogs`.

**This closes the last open item in section 5.5, so the repository-wide figure is
now 100%.**

#### CI regression repaired first

PR #128 merged with a failing `frontend-quality` lane:
`DriverProfileModal.behavior.test.jsx > leaves focus on a real element after a
successful delete` — `document.activeElement` was `<body>`.

Root cause was a real latent bug in the shared `Modal`, not a flaky test. Its
cleanup restored focus **unconditionally**, including to a node that had already
left the document. When a nested confirmation and the dialog that owns it unmount
in the same commit, the inner dialog's restore target is a control *inside* the
outer dialog. Focusing a detached node cannot succeed: depending on the DOM
implementation it is either a silent no-op or it clears `activeElement` to
`<body>`. That is why it passed locally and failed on the runner — the outcome
depended on cleanup order and on happy-dom's detached-`focus()` behaviour, neither
of which a component may rely on.

`Modal` now skips a restore target that is not `isConnected`, which makes the
result identical whichever order runs. Two new tests in `Modal.test.jsx` pin it:
one asserts the detached target's `focus()` is **never called** (deterministic, and
verified to fail without the fix), the other reproduces the dossier's shape and
asserts focus lands on the original trigger.

#### Shared architecture

`src/shared/components/modals/ConfirmDialog.jsx` (new) — one business-neutral
confirmation built on the shared `Modal`. Before it there were **eight**
separately hand-written dialogs re-deriving the same medallion / heading /
description / Cancel-Confirm structure, plus the blocking guards. It owns:
`isOpen`, `title`, `description`, `children`, `tone`
(`danger` | `warning` | `info`), `confirmLabel`, `cancelLabel`, `loading`,
`error`, `onConfirm`, `onCancel`, `closeOnBackdrop`. It knows nothing about
campaigns, templates, envelopes or files.

Guarantees: initial focus on **Cancel** (the safe action); Escape and backdrop
inert while `loading`; backdrop dismissal off by default; a **synchronous ref
guard** on confirm so two activations in one render cannot both fire (visually
disabling the button is not sufficient — `loading` only lands on the next render);
`error` in a live region that leaves the dialog open for retry; long and untrusted
names rendered as text with `overflow-wrap: anywhere`.

It sits beside `Modal` rather than in `design-system/patterns` because the design
system must not depend on `shared` — that is the inversion the migration is
removing. Both move together later. **Gap recorded.**

#### The six recorded flows

| Flow | File | Preserved exactly |
|---|---|---|
| Cancel a sending campaign | `campaigns/CampaignsDashboard.jsx` | `cancelBulkSession`, `{ companyId, sessionId }`, idempotent cancel, record kept for reporting, `Campaign cancelled. No further messages will be sent.`, `Failed to cancel campaign: ` |
| Delete a campaign or draft | `campaigns/CampaignsDashboard.jsx` | live-session backstop **and its wording**, `campaign_drafts/{id}` vs `bulk_sessions/{id}`, `Campaign draft deleted` / `Campaign record deleted`, `Failed to delete campaign: ` |
| Retry failed recipients | `campaigns/components/DetailedReportModal.jsx` | `retryFailedAttempts`, `{ companyId, originalSessionId }`, failed-only + permanent-error semantics, `Retry session started with {targetCount} targets.`, `onClose()` only after success |
| Delete an e-doc template | `company-admin/views/DocumentsManager.jsx` | template document path, `postSubmitTemplateIds` pruning, immediate `postApplicationTemplates` persistence, the stale-reference warning, `TemplatesPanel`'s frozen `handleDeleteTemplate(id)` callback shape |
| Void a signing envelope | `signing/components/EnvelopeHistory.jsx` | `signing_requests/{id}`, `{ status: 'voided', voidedAt: serverTimestamp() }`, `voidingId` per-row busy state, `Document voided successfully.`, `Failed to void document.` |
| Remove an uploaded application file | `applications/hooks/useAppActions.js` | Storage delete, `{ [fieldKey]: null }`, `File Deleted` activity log, `File removed` / `File deletion failed.`, `canEdit` and missing-path guards |

**Stale-target safety.** Campaign delete chooses its collection from `activeTab`,
and the envelope list is driven by a live `onSnapshot`. Both now capture the target
**at open time**, so a tab switch or an incoming snapshot cannot retarget an open
confirmation at a different document.

#### The hook one, in detail

`handleAdminFileDelete` had the confirmation *inside* the hook. Two problems, both
fixed: a hook must not own a dialog, and **the guard was unreachable anyway** —
`handleAdminFileDelete` is exported through `useApplicationDetails` and
`useApplicationView`, but a repository-wide search found **no call site**. It was
dead code in a live API, waiting to surprise whoever wired it up.

The Firebase work stays in the hook. Confirmation ownership moved out through an
**additive** API — `pendingFileRemoval`, `requestAdminFileDelete`,
`confirmAdminFileDelete`, `cancelAdminFileDelete` — which holds the pending target
as *state* (a hook's job) and never renders (not a hook's job).
`handleAdminFileDelete` keeps its name and `(fieldKey, storagePath)` signature so
the public contract is unchanged; it now returns a boolean, which is additive
because it previously returned `undefined` in every branch, and which lets a
failed removal keep the dialog open for retry. No consumer changed.

#### Three bare `confirm(` and three `alert()` the original scan missed

The mission scoped "six", derived from a `window.confirm` scan. Scanning for the
**bare** form as well found more, all reachable:

- `campaigns/components/CampaignDetails.jsx` — `confirm(...)` on retry **and** on
  cancel. Both callables, payloads, toasts and `onClose()` timings unchanged.
- `driver-app/components/application/UploadField.jsx` — `confirm(...)` on removing
  an uploaded document, on the most mobile-heavy surface in the product.
- `company-admin/hooks/useApplicationView.js` — `alert("PDF Generation failed.
  Please try again.")` → the toast live region, wording verbatim.
- `driver-app/.../steps/Step9_Consent.jsx` — `alert("Please draw your signature
  first.")` → an announced inline `FieldMessage`, wording verbatim.
- `shared/hooks/useBulkImport.js` — the `onError` default was `alert(message)`, and
  **`AudienceBuilder` was the one consumer passing no handler**, so every CSV/Sheet
  import failure there froze the tab. `AudienceBuilder` now passes the toast; both
  hook defaults (`useBulkImport`, `useCompanyLeadUpload`) log instead of blocking
  and are unreachable in the app.

#### Verification

- `npx vitest run` — **190 files, 2655 passed, 48 skipped, 0 failed** (2600 at this
  branch's base; **+55**).
- New/updated focused suites: `ConfirmDialog.test.jsx` (26),
  `useAppActions.fileRemoval.test.jsx` (16), `Modal.test.jsx` (+2),
  `noBlockingBrowserDialogs.test.js` (2), plus rewritten confirmation coverage in
  `CampaignsDashboard`, `CampaignDetails`, `DetailedReportModal`,
  `EnvelopeHistory`, `UploadField`, `AudienceBuilder`, `useBulkImport` and
  `useCompanyLeadUpload`. Every one of those now also asserts the blocking API was
  **not** called.
- `npx eslint .` — 0 errors (105 pre-existing warnings). `tsc --noEmit` clean.
  `npm run build` succeeds. `check-callable-contract` 56 callables.
  `check:function-exports` 101/101. `git diff --check` clean.
- **Functions Jest:** `59 suites, 354 tests passed` (no backend file changed).
- **Chromium E2E:** `confirmation-dialogs.spec.cjs` (new) **10 passed**; regression
  batch (`lead-intake`, `campaigns-dashboard`, `campaign-details`,
  `campaign-report-modal`, `edoc-documents-tabs-and-templates`,
  `edoc-envelope-history`) **50 passed**. 0 failed, `--workers=1`.
- **Mobile Chrome E2E:** `confirmation-dialogs` + `public-application`
  **13 passed**.
- **Real-browser axe** on the open dialog: zero serious/critical.
- **Responsive:** 1440 / 1024 / 412 px with the dialog open, no document overflow;
  mobile device lane verified.

#### Honest gaps

- The five operator-side confirmations (campaign cancel/delete, retry, template
  delete, envelope void) are **not** driven in a real browser: they need seeded
  Firestore data that is unreachable under `VITE_E2E_TEST_MODE=1`. Their contracts
  are covered by focused unit suites that can supply data deterministically, and
  the *dialog* behaviour they all share is verified in a real browser through the
  driver-application flow. This is the same limitation already recorded for the PEV
  tab.
- Firefox / WebKit / mobile-Safari lanes not run (CI does not run them either).
- `npm run test:rules:stress` not run — needs the Firebase emulators, and nothing
  here touches rules.

---

## 7. Decisions and blockers

- `[!]` **Decide what the Unified Driver Database bulk actions should do.**
  Recorded 2026-07-28 by the true-100% closeout. Message, Assign, Move Status and
  Archive were placeholders that fired a **success** toast and did nothing, with
  Archive asking for confirmation first — so an operator could confirm a
  destructive-sounding action on 50 driver records and be told it worked. The
  false success is now removed (the controls are disabled and labelled
  unavailable), which is the safe end state but not the intended one. **A real
  implementation cannot be inferred from the repository**: `LeadAssignmentModal`
  does bulk assignment but only within one company's `leads`, and this view spans
  every company and mixes applications with leads; campaigns own bulk SMS with
  their own consent and throttling rules; nothing anywhere defines an "archived"
  state, so Archive is not delete. Each of the four needs an owner decision on
  cross-tenant policy and audit-log shape before anything is built.
- `[!]` **Approve replacement wording for the customer named in operator copy.**
  Carried forward from 2026-07-28: `StatsBackfillPanel`'s All-Companies help text
  reads "Only run after verifying Ray Star LLC results." Still preserved verbatim;
  the repository establishes no generic replacement.
- `[x]` **RESOLVED 2026-07-28 — the six remaining `window.confirm` guards are now
  shared dialogs.** All six were replaced with `ConfirmDialog`, along with three
  bare `confirm(...)` calls and three `alert()` calls the original scan had missed.
  `useAppActions` was resolved by moving confirmation *ownership* out of the hook
  through an additive request/confirm/cancel API while the Firebase work stayed
  put — and the guard turned out to be unreachable dead code, since nothing calls
  `handleAdminFileDelete`. A ratchet test now enforces the end state. See the
  final-six-confirmations completion log.
- `[!]` **Move `Modal` and `ConfirmDialog` into `design-system/patterns`.**
  Recorded 2026-07-28. `ConfirmDialog` belongs in `patterns/` per the
  design-system README, but it composes `Modal`, which still lives in
  `shared/components/modals`, and the design system must not depend on `shared`.
  Both should move together; that is a dependency-direction change worth doing
  deliberately rather than as a side effect of this campaign.
- `[!]` **Promote a `Switch` primitive to the design system.** Carried forward:
  `FeaturesView` uses a native `Checkbox` because there is no approved ARIA switch,
  while Company Settings has a feature-owned `ToggleSwitch` that cannot be imported
  across features without breaking layering.
- `[!]` **Decide how an employer signs the verification portal without a
  mouse.** Recorded 2026-07-27 by the verification-portal closeout. A canvas
  cannot be drawn on with a keyboard, so `SignaturePad` — the legally operative
  mark on a 49 CFR §391.23 response — has **no keyboard or assistive-technology
  path to producing a signature**. Everything around it is now accessible (named
  `role="img"` surface, associated instructions and error, operable and announced
  Clear), and axe reports zero serious/critical violations, because axe cannot
  detect a missing input modality. A typed fallback is the obvious remedy and the
  product already has the concept (`TEXT_SIGNATURE:` on the VOE side), but a
  typed mark that is **indistinguishable in the stored PNG from a drawn one** is
  a legal-semantics decision, not a styling one. Deliberately not invented here.
- `[!]` **Approve a `content-muted` value that is safe on `surface-subtle`.**
  Recorded 2026-07-27. `--ds-color-content-muted` (slate-500) on
  `--ds-color-surface-subtle` (slate-100) measures **4.34:1** — below WCAG AA for
  normal text. The token contract only ever verified `content-muted` against
  `surface`, so the pairing looked approved and a real-browser axe scan of the
  public application's success screen found three failing nodes. Those call sites
  moved to `content-secondary` (6.85:1) and `src/design-system/tests/tokens.test.js`
  now pins the gap in both directions. **Second, independent confirmation
  2026-07-27:** the verification-portal closeout measured the same token on
  `--ds-color-status-warning-bg` at **4.27:1** in the drug-and-alcohol block, and
  real-browser axe reported it as a serious violation; that call site also moved
  to `content-secondary`. Two unrelated surfaces have now failed this pairing,
  which strengthens the case that the **token value**, not each call site, is what
  needs the decision. Darkening `content-muted` would change every muted label in
  the product, so it needs owner approval; until then, **`content-muted` is
  approved on `surface` only.**
- `[!]` **Align control heights across the primitives.** Recorded 2026-07-27.
  `.ds-form-control` is 44 px but `.ds-button[data-size='md']` is 40 px and `sm`
  is 36 px, so an input and its adjacent button in the same row are different
  heights. 40 px still satisfies WCAG 2.2 AA SC 2.5.8 (24 px minimum) — 44 px is
  SC 2.5.5, level AAA — so this is a consistency and ergonomics decision, not a
  conformance failure. The public application uses the approved `size="lg"`
  (44 px) for the controls a driver taps repeatedly rather than overriding the
  primitive.
- `[!]` **Add an inverse surface to the semantic token contract.** Recorded
  2026-07-27 by the PEV campaign. The contract has
  `--ds-color-content-inverse` but no `--ds-color-surface-inverse` and no
  secondary inverse content value, so a dark dialog header or banner cannot be
  expressed in approved tokens at all. `PEVRequestModal`'s header was a
  `bg-slate-900` panel; rather than invent a colour it moved to
  `surface-subtle`, following the dossier document-preview precedent. Any surface
  that genuinely needs an inverse treatment is blocked on this.
- `[x]` **Decide how the VOE form should print. RESOLVED 2026-07-27** — see the
  *VOE print pipeline repair* log. Raised by the VOE campaign: `handlePrint` ran
  the generated document through the shared `sanitizeUserContent`, stripping all
  95 `<div>`s, the signature `<img>`, both `<svg>`s, the `<h1>` and all 157
  `class` attributes, and printing an unsigned, unstyled text dump of a legal
  §391.23 release. Resolved by giving *trusted application structure* its own
  policy (`@shared/utils/printDocument`) rather than loosening the shared
  sanitiser, which still guards `NotesTab` unchanged.
- `[!]` **Decide whether the VOE document's small print may be recoloured.**
  Recorded 2026-07-27. Real-browser axe reports 4 serious `color-contrast` nodes
  inside the generated document (2.56:1, 1.95:1 and two at 2.45:1). They are
  conventional grey legal small print on a printed-form facsimile, and changing
  them changes every exported PDF, so it needs approval plus a re-proof of
  export parity.
- `[!]` Confirm WCAG 2.2 AA as the permanent standard.
- `[!]` Select visual baseline hosting and review ownership. *(The catalog tool
  itself was decided on 2026-07-29 — Storybook 10.5.5, see Phase 11. What
  remains open is who hosts the built catalog, who approves a visual baseline
  change, and which service stores baselines. Chromatic was excluded from the
  catalog-foundation campaign by scope, not evaluated and rejected.)*
- `[!]` Decide whether Inter remains externally hosted.
- `[!]` Approve semantic brand/action colors before declaring visible component
  families fully approved. Compatibility-first consumers preserve the current
  blue-led UI direction and SafeHaul navy/mint brand assets, but product/design
  review is still required.
- `[!]` Decide table responsive behavior per use case (horizontal scroll,
  priority columns, stacked cards, or specialized interactive grid). There is
  no safe universal conversion. The candidate-list decision was completed on
  2026-07-23: retain the dense native table and use labeled horizontal overflow
  at narrow widths so no field or action disappears. Other tables still require
  individual decisions.
- `[!]` Decide the responsive/interaction strategy for *editable* matrices
  (per-row form controls), starting with the SMS number-assignment recruiter
  matrix. The approved DataTable is proven only for display tables; converting an
  editable matrix (per-row `<select>`, `MISSING_TOKEN` resilience options, verify
  actions, status) to a scroll table or stacked cards needs an owner decision and
  a proof of behavior parity before migration. This blocked the SMS
  number-assignment slice on 2026-07-23 (deep-audit log in section 6).

- `[!]` Correct the Facebook Integrations tenant binding before any Integrations
  presentation migration. `connectFacebookPage` uses `companyId =
  request.auth.uid`, which is incompatible with SafeHaul's auto-id + membership
  multi-tenant model, so connected leads ingest to `companies/{uid}/leads`
  instead of the real company. This is a backend correctness/security defect that
  must be fixed under a separate, security-reviewed integration-correctness
  project (explicit company id in the callable payload or via membership/claims,
  with tests) — not as part of a design-system slice. The Integrations
  presentation stays unmigrated until this is resolved (deep-audit log in section
  6).

These decisions do not block compatibility-first migrations that preserve the
current identity and record evidence. They do block declaring the affected
families fully approved, publishing durable visual baselines, or making the
related CI enforcement permanently blocking.

---

## 8. Safest next phase

The Company Settings SMS / number-assignment workflow was deep-audited on
2026-07-23 and returned **NO-GO** (deep-audit log in section 6): it is an
editable matrix, not a display table, and is blocked on the new `[!]`
editable-matrix responsive/interaction owner decision, an unproven
DataTable-for-form-controls fit, a safety-critical markup-coupled 15-case suite,
and entanglement with the out-of-scope secret-entry `LineManager`. No partial
table conversion was forced; its contracts are frozen in section 6 for a future
slice once the owner decision lands.

The **Login/Auth screen** (`/login`) was migrated and verified on 2026-07-23
(completion log in section 6): it now consumes `FormField`, `Input`, `Button`,
`IconButton`, and `Card`, and its password-reset overlay moved to the shared
accessible `Modal`, all with authentication, redirects, and reset behavior
preserved.

The **Company Profile branding-upload** section was migrated and verified on
2026-07-23 (completion log in section 6): `BrandingSection` now uses an approved
`Button` and `FieldMessage` with a labelled, keyboard-triggered file input, and
the exact `uploadCompanyLogo` Storage path and `companyLogoUrl` Firestore field
are preserved and locked by tests. The separate **`/company/profile`
account-security** screen was migrated and verified on 2026-07-24 (GO;
completion log in section 6): `UserProfilePage` now consumes `FormSection`,
`FormField`, `Input`, `Button`, `FieldDisplay`, `FieldMessage`, `PageHeader`,
and `Stack`, its avatar upload moved to the keyboard-accessible
`ProfileAvatarField` (no nested interactive elements), and correct autocomplete
was added, while every Auth reauthentication/email/password contract, the exact
`avatars/{uid}/{file.name}` Storage sequence, the username query with its
permission-denied skip, and all Firestore writes and toast messages are
preserved.

The **Company Profile — Application Form Questions** interface was migrated and
verified on 2026-07-24 (GO; completion log in section 6): the standard-field
required/hidden toggles became accessible ARIA switches with unique names, and
the custom-question builder/editor adopted `Card`/`FormField`/`Input`/`Select`/
`Button`/`IconButton`/`Badge` with labelled fields, named destructive/reorder
controls, and a keyboard move-up/down alongside the preserved native drag —
while the `applicationConfig`/`customQuestions` data shape, `crypto.randomUUID()`
creation, DOT deletion protection and its exact alert, and the inverse
compliance mappings are unchanged. With this, every in-phase **Company Settings /
Profile** item is resolved: Company info, branding, Team & Users, Billing,
Automated SMS, Email Settings, account security, and application questions are
migrated (GO); **SMS number assignment** and **Integrations** remain NO-GO.

The **Sandbox Transfer Success** status screen (`/sandbox/transfer-success`) was
migrated and verified on 2026-07-23 (completion log in section 6): it now
consumes `Card`, `Button`, `Badge`, `Stack`, and `Inline` with a single
`<h1>`/`<main>`, preserving the company-name fallback chain, the `New
Application` status wording, and both navigations.

The **public Verification Portal** (`/verify/:token`) was migrated and verified
on 2026-07-23 (completion log in section 6): the portal, its five status
screens, and the four FMCSA form sections now consume `Card`, `FormSection`,
`FormField`, `Input`/`Select`/`Textarea`, `FieldDisplay`, `FieldMessage`,
`Badge`, and `Button`; the feature-local `RadioGroup` was accessibility-hardened
in place (fieldset/legend, visible focus, error/description association) and the
`useVerificationPortal` hook and shared `SignaturePad` were left untouched, so
the token-load/validate/submit contracts are unchanged.

It was **closed out on 2026-07-27** (completion log in section 6), which finishes
the PEV/VOE campaign: the header is tokenised, the validation summary names
fields by their on-page label, submission is guarded against implicit
re-submission, and the shared `SignaturePad` is migrated — tokens, a named
`role="img"` surface with associated instructions and error, a design-system
Clear button, pointer/pen support and corrected coordinate scaling. The
load-bearing fix is that **the visible signature can no longer diverge from the
submitted data**: resizing used to blank the canvas while the form kept the PNG
captured beforehand, so a respondent could submit a §391.23 signature they could
no longer see. Every frozen contract — token access, both callables, all load
mappings, all form keys, all validation rules and messages, the
`data:image/png…`/`null` emission contract, the 150 px canvas height and the
`?e2eVerify=mock` path — is unchanged. **Keyboard/AT signing remains an open
owner decision** (section 7): a canvas cannot be signed without a pointer.

The **public Change Review Portal** (`/review-change/:token`) was migrated and
verified on 2026-07-23 (completion log in section 6): `ReviewChangePortal` now
consumes `Card`, `Button`, and `Input` with one `<h1>`, `role="status"`/
`role="alert"` states, and a tokenized feature-owned approve/reject/edit toggle
group (`aria-pressed` preserved), while the `getChangeReview`/
`submitChangeResolution` callables, the resolution payload, `isScalar`/
`previewValue`, token handling, and the non-display of `applicantName` are
unchanged; `functions/applicationChanges.js` was not touched.

The **Company Settings Team & Users** area was migrated and verified on
2026-07-23 (completion log in section 6): both surfaces landed together — the Add
New User form now uses `FormSection`/`FormField`/`Input`/`Select`/`Button`, and
`ManageTeamModal` moved to the shared accessible `Modal` with `Card`/`Button`/
`IconButton` and labelled goal inputs — while the `createPortalUser`/
`deletePortalUser` callables, the membership `onSnapshot` subscription, the goal
`setDoc` write, the tracking-link construction, the admin permission gate, and
`functions/hrAdmin.js` are all unchanged.

The **Company Settings Integrations** area was deep-audited on 2026-07-23 and
returned **NO-GO** (deep-audit log in section 6): the Facebook Lead Ads workflow
binds the tenant on `companyId = request.auth.uid`, which is incompatible with
SafeHaul's auto-id + membership multi-tenant model, so connected leads would
ingest to `companies/{uid}/leads` instead of the real company. Per the
tenant-binding rule, no backend was changed and the presentation was **not**
migrated (polishing the card would imply a production-ready workflow it is not);
the fix belongs to a separate, security-reviewed integration-correctness project.
All contracts (SDK load, login/scopes, Graph first-page selection, callable,
token safety, connected-state limitation) are frozen in section 6.

The **`/company/profile` account-security** screen and the **Company Profile —
application questions** interface were both migrated and verified on 2026-07-24
(GO; completion logs in section 6), which resolves every in-phase Company
Settings / Profile item. The **Campaigns** area migration then began with its
safest bounded slice — the **campaign list card** (`CampaignCard`), migrated and
verified on 2026-07-24 (GO; completion log in the Phase 13 Campaigns item): the
card now uses `Card`/`Badge`/`IconButton` with a feature-mapped status tone/label
and an accessible options popover, while `CampaignsDashboard` keeps both Firestore
listeners, the `cancelBulkSession` callable, confirmations, and delete logic
unchanged. The **campaigns dashboard shell** was then migrated and verified on
2026-07-24 (GO; completion log in the Phase 13 Campaigns item): the header, Create
action, stat cards, Drafts/Past Sequences tabs, loading/empty states, and card
grid now use `PageContainer`/`PageHeader`/`Section`/`ResponsiveGrid`, `Button`,
and `MetricCard`; the former 10 px low-contrast stat labels are fixed and the tabs
are an accessible WAI-ARIA tablist (programmatic selection + keyboard), all while
the paywall, both listeners + cleanup, stats math, the exact new-draft write,
`cancelBulkSession`, confirmations, delete logic, tab values, and
`CampaignCard`/report-modal wiring stay unchanged. The **campaign results table**
(`CampaignResultsTable`) was then migrated and verified on 2026-07-24 (GO;
completion log in the Phase 13 Campaigns item): the recipient delivery log now
uses `Card`/`Input`/`Label`/`Badge` with a semantic DS-token table, fixing the
10 px low-contrast headers, labelling the search, making statuses text + icon and
per-row errors readable, and preserving the `max-height` scroll region and sticky
header — while the exact Firestore read, log mapping, search logic, loading/empty
strings, status mapping, and timestamp/`Pending` formatting stay unchanged.
`DataTable` was recorded as a primitive-fit exception here (it owns a horizontal
column-scroll region and needs a definite-height ancestor for vertical
stickiness, which would change the log's grow-to-content scroll behavior). The
**detailed delivery-report dialog** (`DetailedReportModal`) was then migrated and
verified on 2026-07-24 (GO; completion log in the Phase 13 Campaigns item): it now
uses the shared accessible `Modal` (adding Escape, focus trap, and focus
restoration while keeping backdrop close) plus `Button`/`IconButton`/`Badge`, with
the log table in a labelled keyboard-focusable internal-scroll region so wide
content scrolls without document overflow — while the props, the
no-fetch-unless-open-with-both-IDs guard, the exact logs query/mapping, the
loading/empty/fetch-error strings, `hasFailures`, the delivered/failed mapping,
and the `retryFailedAttempts` confirmation/payload/toasts/close-after-success are
all unchanged (`retryFailedAttempts` and all backend/rules untouched). The
**campaign detail view** (`CampaignDetails`) was then migrated and verified on
2026-07-24 (GO; completion log in the Phase 13 Campaigns item): the full-screen
view now uses `Card`/`Button`/`IconButton`/`Badge`/`FieldMessage` and layout
tokens with a programmatic `progressbar`, wrapping failure text, and mobile-
reachable (wrapping) header actions — while `effectiveCompanyId`, the tenant-
mismatch/missing-company states, the status/date formatting, the progress/
audience/sent/failed calculations, the failure reason, the `CampaignResultsTable`
props, all four action-visibility rules, and the exact `pauseBulkSession`/
`resumeBulkSession`/`cancelBulkSession`/`retryFailedAttempts` payloads,
confirmations, toasts, loading flags, and `onClose` paths are unchanged
(`CampaignEditor` and all backend/rules untouched). The **`CampaignEditor` shell**
(wizard chrome only) was then migrated and verified on 2026-07-24 (GO; completion
log in the Phase 13 Campaigns item): the shell now uses `Input`/`Button`/
`FormField` + layout tokens with a keyboard-accessible section nav
(`aria-current="step"` + sr-only completed state), a labelled Campaign Name, and
announced save/Suspense regions — while the draft `onSnapshot` listener + unsub,
the deep filter merge with in-memory `rawData` preservation, the `isDirty`/init
guards, the exact 2-second autosave debounce, the `rawData` strip before
`saveDraft`, `isSectionComplete`, all lazy child props, and `onLaunchSuccess=
{onClose}` are unchanged. The **content composer** (`ContentComposer`) was then
migrated and verified on 2026-07-24 (GO; completion log in the Phase 13 Campaigns
item): the editor's Content section now uses `Card`/`FormField`/`Input`/
`Textarea`/`Button` with a keyboard-accessible SMS/Email toggle (labelled group of
`aria-pressed` buttons), associated Subject/Message labels, clearly-labelled
variable buttons, an `aria-live` character count, and the variable toolbar in
normal flow (the former absolute overlapping bar removed) — while the
`messageConfig` spread, the `sms`/`email` methods, email-only Subject, the
`activeField` tracking, the variable labels/values, the caret/selection insertion
with surrounding spaces, the subject-vs-message targeting, the
`requestAnimationFrame` focus/caret restore, the append fallback, the
placeholders, the character count, and the `DeviceMockup` `type`/preview content
are unchanged (`DeviceMockup` not redesigned; no message limit, validation, or
sending rule changed). The **audience builder** (`AudienceBuilder`) was then
migrated and verified on 2026-07-24 (GO; completion log in the Phase 13 Campaigns
item): the editor's Audience section now uses `Card`/`FormField`/`Select`/
`Input`/`Button` with accessible source and import tablists (roving tabindex,
`aria-selected`, keyboard activation), labelled filters and file/sheet inputs,
`aria-pressed` status pills carrying a check icon so selection is never
colour-only, an announced recipient count, readable exclusion chips, and a single
labelled file-input trigger with no nested interactive controls — while the
targeting/import hooks, the upload fingerprint and campaign-scope exclusion
resets, the CRM/upload `rawData` handling, `onChange(localFilters, matchCount)`
parent sync, manual exclusion toggling, `finalCount`, every filter/option value
(including the CRM `off` vs upload `7` exclusion defaults), the file `accept`
list, the sheet import behavior, every `VirtualLeadList` prop, and the exact
`onChange(localFilters, finalCount)` Confirm Audience call are unchanged. The
**recipient preview list** (`VirtualLeadList`) was then migrated and verified on
2026-07-24 (GO; completion log in the Phase 13 Campaigns item): its inaccessible
clickable row containers became native `aria-pressed` toggle buttons that keep
whole-row usability and pair a check/cross icon with a visually hidden state
sentence, so selection is never colour-only; already-messaged rows are no longer
exposed as controls at all; status pills became approved 12 px `Badge`s (the
10 px spans are gone); "Scanning Database…" was lifted from 4.23:1 to ≈9.5:1;
loading, empty and pagination regions are `role="status"`, and the failure state
is a `role="alert"` with an approved `Button` retry — while the callable, backend
filter mapping, `pageSize: 50`, pagination/reset/`hasMore`, the StrictMode fetch
guard, fallback ids, name/contact fallbacks, every exclusion rule and callback
value, the `Virtuoso` wiring, and all existing copy are unchanged. Its dark
surface is retained as the smallest documented feature-level exception (the design
system has no approved dark-surface tokens), with every piece of text on it
contrast-verified in a real browser against a populated list. The **launch pad**
(`LaunchPad`) was then migrated and verified on 2026-07-24 (GO; completion log in
the Phase 13 Campaigns item): the pre-flight result is now icon + text
(`role="alert"` for failures, `role="status"` for the all-clear with a `Badge`
estimate), a visually hidden `role="status"` announces "Launching campaign…", and
the confirmation moved to the shared accessible `Modal` (Escape, focus trap and
focus restoration, mobile-safe stacked actions) — while the `initBulkSession`
payload, the `rawData` extraction, the duplicate-launch lock, every toast and
friendly error mapping, `onLaunchSuccess`, the finally-state resets, the
validation messages, the estimate, and the 280-character preview truncation are
unchanged (the real launch callable is never invoked in tests).

**Campaigns is complete** as of 2026-07-24. The two non-interactive leftovers were
closed out by an owner decision to split them: the decorative `DeviceMockup`
illustration keeps `text-[10px]` for its simulated "9:41" status bar as an
**approved documented exception** (it simulates phone chrome rather than SafeHaul
interface text, and enlarging it would make the mockup read as oversized UI; the
rationale is recorded in-code and is scoped to that decorative component only),
while the `CompanyCampaignsPage` "Please select a company." fallback was **fixed**
— moved from legacy `text-gray-700` to `text-ds-content-secondary`, with a test
locking the token and asserting no `text-gray-*` remains. All ten interactive
components plus the route wrapper are therefore on approved primitives and
tokens, with no Campaigns file left on legacy interface styling. The recommended
next area is the **E-Docs** document/envelope workflows — audited and scoped
before any presentation change.

**E-Docs is complete.** The **envelope history table** (`EnvelopeHistory`) was
audited and migrated on 2026-07-24 (GO; completion log in section 6): the
Documents Center history now consumes the approved `DataTable` with a
feature-owned status adapter, so the 9 px delivery pills are gone, status is text
+ icon in a toned `Badge`, each row's Download/Link/Correct/Void action carries a
unique name prefixed with its visible label, the document title is the row
header, loading/empty are announced, the horizontal scroll region is labelled and
keyboard-focusable, and a snapshot failure now raises a visible `role="alert"`
instead of an empty table — while the `signing_requests` `onSnapshot` query and
ordering, the unsubscribe, the no-`companyId` guard placement, the
`voided`/`serverTimestamp` write and its path, the `window.confirm` text, both
callables (`getSigningLink`, `getSignedDocumentUrl`) with the `gs://` path
cleaning and `signedPdfUrl || storagePath` source, every toast string, the
`functions/not-found` mapping, the case-sensitive action-visibility rules, the
email-failure override with its 80-character truncation, the delivery-method
rules and all fallbacks are unchanged. `DataTable` is a genuine fit here — unlike
the campaign results table and report modal, this table has no max-height or
sticky-header constraint and no exact loading string to preserve.

The **Documents Center page header** was then migrated and verified on 2026-07-24
(GO; completion log in section 6, PR #100 merged as `bfe4563`): the canvas and
container moved to `bg-ds-canvas` + `PageContainer`/`Stack`, the heading and its
icon are tokenized through `PageHeader`, and Back to Dashboard / Create Template /
Send One-off are approved `Button`s that wrap onto their own line instead of
overflowing — while back navigation and both creator transitions keep their exact
call order.

The **Documents Center navigation and template-management surface** was then
migrated and verified on 2026-07-24 (GO; completion log in section 6): the
History/Templates control became a feature-owned WAI-ARIA tab interface
(labelled `role="tablist"`, `aria-selected`/`aria-controls`, a connected
`role="tabpanel"`, roving `tabIndex`, ArrowLeft/ArrowRight with wrap, Home/End,
focus following selection, a visible focus ring and a visually hidden
"(selected)" state so selection is never colour alone), and `TemplatesPanel` now
consumes `Card`/`Button`/`IconButton`/`Badge`/`Stack`/`ResponsiveGrid` — the
hover-only Delete control is always reachable, every card action is uniquely
named (`Delete`/`Use`/`Edit` + title), the ordering controls are
`Move <title> up`/`down` with tooltips explaining a disabled boundary, and the
unsupported 10 px field-count text became an approved `Badge` with the same
value. Meanwhile the `'list'`/`'templates'` state values (with `'list'` initial),
the exact `EnvelopeHistory` props, all thirteen `TemplatesPanel` props, the
`postSubmitRequiredById = {}` default, the `!== false` required rule, the
`templates.find` lookup with `null` for missing ids, the id order, the move
directions and first/last disabling, the `'Complete Form'` fallback, both exact
empty messages, `templatesLoading`, `tmp.fields?.length || 0` and every callback
argument shape are unchanged — and a test proves switching tabs performs no
Firestore write, callable or navigation. The design system still has no approved
Tabs or Checkbox primitive, so both remain documented feature-owned compositions.

**`SendTemplateModal`** (the send/driver-picker dialog, delivery-method controls
and prefill inputs) was migrated and verified on 2026-07-24 (GO; completion log
above). The remaining E-Docs work is **`EnvelopeCreator` with its PDF workbench
components** (field placement, coordinates, zoom and gestures — high risk; the
pre-existing non-blocking signing-room axe findings belong with it). It was
audited on 2026-07-25 and split into six sub-slices ordered safest first, each
with its own audit, tests, E2E and PR, and none sharing a diff with another.
**Sub-slice A (the creator shell)** and **sub-slice B (the field properties
panel)** are complete; sub-slice B replaced two icon-only toggles that had no
accessible name at all with native labelled checkboxes and removed the last
10 px text in the rail, while preserving every value, option list and
`updateActiveField` call — including the paired `readOnly`/`prefillPolicy`
writes in both directions.

**Sub-slice C (`EnvelopeSidebar`)** is also complete, migrated and verified on
2026-07-25 (GO; completion log in section 6): the recipient inputs gained real
labels, the delivery options became a labelled `aria-pressed` group with a check
icon, the placed-field rows stopped being clickable `div`s wrapping a nested
button, the palette buttons gained `Add <label> field` names and semantic tone
tokens, the file input moved from `display:none` to the approved visually-hidden
input + `Button` trigger, and every 9–10 px class is gone — while the
request-mode gating, the four delivery keys, the palette `templateId`s, the
`Placed (n)` list contracts and every callback argument shape are unchanged.

**Sub-slice D (`DateTripletField`)** is also complete, migrated and verified on
2026-07-25 (GO; completion log in section 6): the shared month/day/year control
now consumes the approved `Select` and `FieldMessage` with `--ds-*` tokens, the
three dropdowns are wrapped in a `role="group"` named by the field so the name is
heard once, each control's own name is composed from it ("Date of Birth month")
instead of a bare "Month", and the required marker pairs its asterisk with an
sr-only "required" — while every emit, clamp and `maxToday` rule and the frozen
`${idPrefix}-month|day|year` element ids are unchanged. This closes the nested
control exception recorded on PR #102, so `SendTemplateModal` is now migrated
without qualification.

**Sub-slice E (`ResizableDraggableField`)** is complete, migrated and verified on
2026-07-25 (GO; completion log in section 6): the placed-field overlay now uses
the same `--ds-*` status tones as the sidebar palette (which is what makes the
palette a legend for the overlays), the remove control and label editor have
accessible names, the 9 px label text is gone, and the resize affordance is no
longer hover-only — while every percentage↔pixel conversion, the
`pageHeight || 800` fallback, the 8 px floor, `bounds="parent"`, the
`.resize-handle, .label-input` cancel selectors, the `size.width > 40` threshold
and both callback payloads are unchanged.

**Sub-slice F (`PdfFieldWorkbench` + the responsive/accessibility close-out)** is
complete, migrated and verified on 2026-07-25 (GO; completion log in section 6):
the workbench canvas, page frames and zoom toolbar are tokenized, all three zoom
controls have accessible names (they previously had `title` only), the zoom level
is announced, and the 11 px/10 px text is gone — while the `workbenchRef`, the
canvas-click deselect, the toolbar's `stopPropagation`, the ±48 px zoom steps,
`PDF_VIEWPORT_WIDTH_DEFAULT`, `zoomPercentLabel`, `onLoadSuccess`, the `pageRefs`
registration, `data-page-num`, the badge text, the render flags, the
`pointer-events-none` overlay layer, the page filter and the
`pageHeight={dims ? dims.height : 900}` fallback are unchanged. Two of the three
recorded debts are closed with it: the **properties rail no longer clips** below
~600 px (it presents as a full-width sheet with its own dismiss control, since the
canvas that normally deselects sits underneath it, and desktop is byte-identical),
and **placement is no longer pointer-only** (the overlay is focusable, selects on
focus, and moves with arrow keys — Shift for a larger step, Alt to resize —
reusing the same percentage payloads and clamping so a field can never leave its
page). A responsive gap is recorded against F: the creator's fixed
three-column layout clips the properties rail below roughly 600 px, which
predates the migration and is not owned by sub-slice B or C (the sidebar's own
E2E confirms no document-level horizontal overflow at 1440/1024/412).

The **sandbox application** screen remains tied to the
public-application migration. The Phase 3 link-style Button variant (Login
text-link and reveal-adornment exceptions), a design-system file-input primitive
(the branding-upload exception), a design-system Radio/Checkbox or
segmented-control primitive (which would retire the verification RadioGroup, the
change-review decision control, the settings question toggles and the two
Documents Center template checkboxes), a design-system **Tabs** primitive
(currently missing: `SectionNavigation` is a vertical `nav` with Up/Down keys, so
the Documents Center History/Templates tab interface is a documented
feature-owned WAI-ARIA composition), the **remaining toned `Button` tones**
(partly closed: `Button` now supports `tone="success"` alongside
primary/secondary/ghost/danger, which retired the signing room's two submit-CTA
overrides; the info/accent/warning tones the envelope creator's eight
field-palette buttons need are still missing, so those stay a documented
feature-owned composition — their status tone is the legend for the field-type
colours `ResizableDraggableField` paints on the PDF, and flattening them to
`secondary` would break that pairing), and a **compact icon-button size** (currently missing:
the approved `IconButton`'s smallest size carries a min-height and padding that
would overflow the envelope creator's ~14 px corner remove badge, which sits on a
field whose minimum size is 8 px, so that one control stays a documented
feature-owned composition with an accessible name, focus ring and `--ds-*`
tokens) stay independently tracked. All public token
screens (`/verify/:token`, `/review-change/:token`, `/sandbox/transfer-success`)
are migrated. The SMS number-assignment NO-GO and the new Integrations
tenant-binding NO-GO are unchanged.

### Update — 2026-07-27

The **public driver application** (`/apply/:slug`) and the **sandbox application**
that reuses it were migrated and verified (GO; completion log in section 6). This
was the last `Critical`-priority screen in section 5.1 and the largest form
surface in the product: the shell, the shared `Stepper` frame, all nine steps, the
custom-questions step, the four status screens, the intake chooser, the
post-application required-document checklist, `UploadField`, and the shared
`InputField` / `RadioGroup` / `MonthYearField` / `DynamicRow` / `AgreementBox`
adapters. Twenty defects were found and fixed, including a genuine functional bug
(repeated-row radio groups sharing one element id, so clicking row 2 toggled row
1), a completely unlabelled custom-questions step, and a shared-helper E2E
determinism defect that had been surfacing as an intermittent `consent-mvr-yes`
timeout three steps away from its cause.

Two recorded primitive gaps were closed to make it possible without local
alternatives: the design system now has native-first **`Checkbox` / `Radio` /
`ChoiceGroup`** (Phase 4) and a determinate **`ProgressBar`** (Phase 5). The
Radio/Checkbox item above is therefore partly resolved — the primitive exists and
is proven, but `ToggleSwitch`, indeterminate state and the catalog examples remain
open, so the family is still `In progress`.

Two new `[!]` blockers were recorded from real measurements rather than
assumptions: `content-muted` on `surface-subtle` is 4.34:1 (below AA), and the
approved `Button` (40 px) does not match `.ds-form-control` (44 px). Both are
global changes needing owner approval; the campaign worked within the approved
API instead of overriding it.

The `ToastProvider` accessibility defects (unnamed dismiss control, 16 px hit
area) were fixed in place because the application depends on toasts for upload,
validation and draft feedback — but its **nine remaining legacy palette classes
were deliberately left alone**, because it is a global surface and an app-wide
restyle needs its own review. That is now the clearest small next slice.

With this, Phase 13 has three groups left: **Super Admin**, the **driver
dossier / PEV-VOE** workflows, and **Import leads / Quick add lead**. The SMS
number-assignment and Integrations NO-GOs are unchanged.

**Update — 2026-07-27, later the same day.** The driver dossier's *foundation*
is now migrated (see "Driver dossier foundation completion log" in section 6):
the modal shell, header, section navigation, read-only application summary and
document gallery. The dossier group is therefore reduced, not closed — its
**PEV/VOE workflow content, DQ File internals, the full-application editing and
change-review path, and the Activity/Notes internals are untouched** and are the
next slices. That campaign also fixed two defects that made the dossier
unusable outside a wide desktop: at 412 px the Close and Delete actions were
clipped off-screen entirely (no way to close the dossier on a phone), and at
1024 px the section title collapsed to zero width.

Sequence (whichever slice the owner selects):

1. audit and freeze the exact data/callable/upload behavior, validation, and
   messages before changing presentation;
2. confirm the go/no-go conditions (mockable contracts, testable behavior, no
   backend change, preservable permissions) are met;
3. migrate only that bounded area to approved primitives, preserving all
   behavior;
4. add focused behavior + accessibility coverage plus axe and responsive checks;
5. verify at 1440×900, 1024×768, and 412×915 before marking the slice complete.

Do not start any remaining slice in the same unreviewed diff as another. SMS
number-assignment, Company Profile branding upload/application questions, Team &
Users, and Integrations each remain independent items with their own audits and
behavior-preservation evidence. `/company/profile` account security is migrated
(GO) and no longer open. The SMS number-assignment slice stays blocked until the
editable-matrix strategy is owner-approved.

---

### Documents workspace redesign and AI Field Assistant completion log (GO)

- **Date:** 2026-07-28
- **Starting baseline:** `main` / `origin/main` at
  `00303f77451491f13ed11338c9e89d557bb821a9`.
- **Scope:** the company-side Documents route only. The signing room, the
  sealer, the public signing flow, the post-application backend and every
  Firestore/Storage rule are untouched.

**What changed**

The route kept its path but stopped being a tool-first page. `DocumentsManager`
is now a four-view workspace — **Overview** (default), **Sent Documents**,
**Templates**, **Application Forms** — behind the same feature-owned WAI-ARIA tab
interface (the design system still has no approved `Tabs` primitive; that gap is
unchanged). The header is `Documents` with a description, a primary
**New Document** action and a secondary **Manage Templates**.

New feature-owned components, all built from approved primitives
(`Card`, `MetricCard`, `Badge`, `Button`, `IconButton`, `DataTable`,
`FormField`, `Input`, `Select`, `Checkbox`, `Radio`, `ChoiceGroup`,
`ProgressBar`, `Modal`, `Stack`, `Inline`, `ResponsiveGrid`, `PageHeader`,
`PageContainer`):

- `DocumentsOverview`, `SentDocumentsPanel`, `TemplateLibraryPanel`,
  `ApplicationFormsPanel`, `NewDocumentDialog`, `SentDocumentDetailsDialog`,
  `SendTemplateWizard` (replaces `SendTemplateModal`);
- `AiScanOptionsDialog`, `AiSuggestionReviewPanel`, `AiSuggestionOverlay` in the
  envelope creator.

`TemplatesPanel` and `SendTemplateModal` were **replaced, not wrapped** — their
responsibilities split cleanly between the new template library and the new
Application Forms view, and the single long send modal became a three-step
guided flow. Both files and their suites were removed and re-covered by the
replacements' own suites.

**Preserved exactly** (audited before any presentation change): the route and
feature flag, company permissions and tenant isolation, every Firestore and
Storage path, the template and signing-request schemas, signing-token
confidentiality (still only ever via the `getSigningLink` callable, never
rendered), the status values, the `email` / `sms` / `both` / `copy` delivery
values, the seven-day expiry, every callable name and payload, `sendSMS`, the
signed-document download, `postApplicationTemplates` string/object compatibility
with its required-by-default rule and its ordering, immediate pruning after a
template delete, template editing, correction, voiding and deletion, and the
prefill bindings and serializer.

**Two deliberate behaviour changes, both recorded here rather than slipped in:**

1. The envelope creator's **One-off Send / Save Template toggle is gone.** The
   mode is chosen in the New Document dialog and is fixed for the rest of the
   flow. The old toggle let the outcome of a half-built envelope change silently.
   Template editing and request correction are unaffected — both already arrived
   with their mode pinned.
2. A **voided** row now offers a Details action (previously "No actions"). It is
   read-only: nothing about a voided document can be changed from it.

**AI Field Assistant.** New `Auto-place fields` action in the creator sidebar,
disabled until a PDF is loaded. Suggestions live in their own array and their own
visually distinct overlay layer, and only ever become real fields through an
explicit Apply. It never saves a template, never sends a document and never
writes raw model output to Firestore. Security, privacy and provider details are
recorded in [`docs/security-posture.md`](./security-posture.md).

**Design-system exceptions used (all pre-existing categories, none new):**

- The four-view tab interface stays feature-owned — no approved `Tabs` primitive.
- `AiSuggestionOverlay`'s two ~14 px corner controls are not `IconButton`, for
  exactly the reason already recorded for `ResizableDraggableField`'s remove
  control: the approved primitive's min-height would overflow a box whose
  minimum size is 8 px. Both keep an accessible name, a focus-visible ring and
  `--ds-*` tokens, and both retire when a compact icon-button size exists.
- `AiScanOptionsDialog`'s page-range input is a local control: `FormField`
  requires a plain-string label, and this one carries a live count. It keeps a
  programmatic label, a 44 px height, `aria-invalid` and the focus ring.
- `SendTemplateWizard` keeps the recorded `DateTripletField` composition
  unchanged from `SendTemplateModal` (`Label` + control, because the label
  carries a tooltip and an applies-count fragment).

**Verification**

1. Implementation complete; behaviour preserved as listed above.
2. Tests: 405 Functions tests (61 suites, incl. 51 new for the callable and the
   provider boundary); full frontend suite **2798 passed / 48 skipped** with the
   coverage ratchet green; new focused suites for the workspace utils (38), the
   Documents workspace shell (40), Overview, Sent Documents, the template
   library, Application Forms, the send wizard, the AI suggestion utils (29), the
   PDF inspector (30), the scan hook (30) and the assistant end-to-end in the
   creator (23). The AI provider is a mock in every test — CI never calls it.
3. Desktop visual behaviour reviewed at 1440 and 1024 px; no document-level
   overflow.
4. Mobile reviewed at 412 px; no document-level overflow.
5. Keyboard and accessibility reviewed: tab roving/arrow/Home/End, dialog focus
   trap and restoration, Escape gated during an in-flight send, `aria-current`
   step state, and zero serious/critical axe violations in the vitest suites and
   the scoped Playwright axe lane.
6. Documentation: this log, `docs/security-posture.md` and
   `docs/callable-frontend-map.md`.
7. Final diff inspected; `git diff --check` clean; lint 0 errors; typecheck clean;
   production build succeeds.

**Honest limitations**

- The configured document-vision model was verified against Groq's published
  documentation (vision + `json_schema` structured outputs), **not** against a
  live production API key — none is available in this environment. The pin lives
  in `GROQ_DOCUMENT_VISION_MODEL` precisely so it can be corrected without code
  changes, and the CDL model pin was not touched.
- Firefox and WebKit E2E lanes were not run; they are not part of the repo's CI
  gate, which runs Chromium and Mobile Chrome.

---

## E-Docs editor — professional document-building experience (2026-07-29)

Second pass over the company-side E-Docs **editor** (`EnvelopeCreator` and its
workbench). The architecture was already sound, so nothing was rebuilt: this
slice is visual hierarchy, navigation and editing comfort, plus the arrangement
tools a document builder is expected to have.

### What changed

**Top bar.** The bare `<h2>` heading is now `EditorTopBar`: back, an editable
document title, the fixed mode, page and field counts, a save-state indicator,
undo, redo, preview-as-signer and the one primary action. The save state is
explicit — `SAVE_STATES` in `utils/editorSaveState.js` — and "Saved" is
reachable only from `markSaved()` after a write has actually succeeded. Every
in-`try` bail-out on the save path restores "Unsaved changes" rather than
leaving a stale success. Leaving with unsaved work goes through the shared
accessible `ConfirmDialog`.

**Workspace.** Four regions instead of two-and-a-half: a page navigator rail, a
sectioned tools rail, the canvas, and a stable inspector.

- `PageThumbnailRail` renders 96px thumbnails lazily (IntersectionObserver with
  a screen of margin, plus the current page and its neighbours always), each
  entry stating its page number, field count, AI-suggestion count and
  manual-review flag as text, with `aria-current` on the current page.
- `EnvelopeSidebar` is now three collapsible sections — Setup, Add Fields,
  Fields — rather than one long column.
- `EditorCanvasToolbar` owns paging, zoom, Fit Width, Fit Page, undo, redo and
  preview. The workbench's floating zoom widget is gone: it exposed a second
  control group with the same accessible name in the same view.
- `EditorInspector` is a permanent 320px column from `lg` up with Properties and
  AI Suggestions tabs. The rail no longer collapses to `w-0` and reappear, so
  the canvas never resizes under the pointer.

**Field appearance.** A placed field is a thin toned border over a translucent
fill (a separate `aria-hidden` layer, because the tone tokens resolve to opaque
hex values Tailwind's opacity modifiers cannot thin). Selection is the loud
state — primary border, focus ring, heavier fill — and the only state that
renders the remove control and the resize handle. Selection is stated in the
accessible name, never by colour alone.

**AI review.** `AiSuggestionReviewPanel` groups suggestions by page and shows a
compact row per suggestion (label, type, confidence, accepted/pending, overlap
warning); the editing controls belong to the suggestion you open. Every action —
Apply selected, Apply high-confidence, Discard all, Rescan, Undo apply,
per-suggestion accept/reject, move and resize — is unchanged, and suggestions
still become fields only through an explicit apply.

**Undo/redo.** `utils/editorHistory.js` is a pure `{ entries, index }` value
over the local placed-field array. `commitFields` in `EnvelopeCreator` is the
single write path: it computes the next state and pushes history outside the
state updater (so React's double-invoke cannot duplicate an entry) and carries a
`coalesceKey`, which makes one completed drag or resize one entry. Zoom, paging
and panel selection are not history. Ctrl/⌘+Z undoes, Ctrl+Shift+Z and Ctrl+Y
redo. History resets on hydration, on PDF replacement and after a successful
save. AI undo flows through the same history and still removes only the ids its
apply added, so later manual work survives. Nothing remote — no Firestore
document, Storage path, signing token or recipient detail — is ever recorded.

**Field tools.** `utils/fieldGeometry.js` plus `FieldToolsPanel`: Shift-click
multi-selection (first selection is the anchor), align left/centre/right and
top/middle/bottom, match width/height/both, duplicate, copy to a chosen page and
copy to all pages. Live alignment guides while dragging; snapping to page edges,
page centre and neighbouring field edges on pointer drops only — arrow-key
placement stays exact to the percent, because the keyboard is the precision
path. Every copy takes its own id (uuid plus a monotonic suffix), keeps type,
label, binding, required flag and relative geometry, is clamped inside the page,
and skips the page it already lives on. Every bulk action is one undo step.

**Preview as signer.** `SignerPreviewDialog` renders the real `SignerField` over
`react-pdf` and drives it through `buildSignerPreview`, which runs
`resolveFieldsForSend` then `serializeTemplateFields` — the send path's own
transforms in its own order, so the preview cannot drift from what a recipient
sees. It performs no Firestore or Storage I/O, creates no signing request or
access token and sends no notification; a spy-based test asserts exactly that.
Unresolved required fields are raised in a `role="alert"`, and the field layer is
`inert` with an `<aside>` carrying the accessible equivalent.

**Compact editor.** Below `lg` the three-column layout is replaced, not
compressed: full-screen canvas, compact top bar, and a bottom toolbar opening
Setup / Add Field / Fields / Properties / AI Suggestions / Pages as bottom
sheets. Each sheet is the shared accessible `Modal`, so focus moves in, Tab is
trapped, Escape and the backdrop close it, and focus returns to the button that
opened it. `useCompactEditor` matches the same `lg` breakpoint the classes
switch on, so the JS and the CSS cannot disagree about which layout is showing.

### Preserved exactly

Routes, roles, permissions and tenant isolation; Firestore and Storage paths and
schemas; signing-token confidentiality; template/request field serialization;
field percentage coordinates; the drag and resize mathematics (including the
`pageHeight || 800` fallback, the 8px floor and `bounds="parent"`); supported
field types and bindings; AI suggestion safety and application rules; delivery
values and callable payloads; save, send, correction and template-edit behaviour;
keyboard placement and field-copy behaviour; the 20MB PDF upload limit; and
public signer behaviour. The `onStop` payload gained a trailing options object —
the four positional arguments are unchanged, and callers that ignore it behave
exactly as before.

### Design-system exceptions used

Three pre-existing categories, one new, all recorded:

- The inspector's WAI-ARIA tablist is feature-owned — no approved `Tabs`
  primitive (the same exception already recorded for the Driver Dossier). The
  tabs themselves are the approved `Button`.
- The palette's toned buttons and the overlay's ~14px corner controls are
  unchanged, for the reasons already recorded.
- **New:** the rail's disclosure headers and the compact bottom toolbar's cells
  are raw `<button>`s. Both need a full-width layout the approved `Button`'s
  inline layout and padding cannot express (edge-to-edge header with a rotating
  affordance inside a heading; equal-width stacked icon-over-label cells). Both
  use only `--ds-*` tokens, a 44px/56px activation height, a focus-visible ring
  and `aria-expanded`. **Missing capabilities:** a Disclosure/Accordion
  primitive and a stacked/toolbar `Button` variant.

### Verification

1. Implementation complete; behaviour preserved as listed above.
2. Tests: full frontend suite **3012 passed / 48 skipped** across 203 files with
   the coverage ratchet green (statements 63.54%, branches 61.24%, functions
   65.36%, lines 64.82%). The signing area alone is **647 passing**, including
   175 tests new in this slice: editor history (19), field geometry (44), the
   signer-preview projection (13), the preview dialog (18), the editor chrome
   (37), the rail sections (8), field appearance (9), the wired editor (39) and
   the compact editor (12). Functions: **405 passed** across 61 suites.
   Firestore/Storage rules under the emulators: **48 passed**. Callable contract:
   57 frontend callables verified.
3. Desktop visual behaviour reviewed at 1440 and 1024px; no document-level
   horizontal overflow.
4. Mobile reviewed at 412px (Pixel 7 lane); no document-level horizontal
   overflow; every bottom-toolbar target measured at 44px or more.
5. Keyboard and accessibility reviewed: roving tabindex with arrow/Home/End on
   the inspector tabs, disclosure `aria-expanded`/`aria-controls`, sheet focus
   trap and restoration, Escape handling, `aria-current` on the page navigator,
   selection stated in accessible names, and zero serious/critical axe violations
   in the vitest suites and the Playwright axe lanes.
6. E2E: 41 editor checks on Chromium and 44 on Mobile Chrome, plus the full
   E-Docs sweep (26 checks) and the `@a11y` lane (8 checks) — all passing.
7. Documentation: this log.
8. Final diff inspected; `git diff --check` clean; lint 0 errors; typecheck
   clean; production build succeeds.

### Defects found by this slice's own review

Two, both fixed with regression tests rather than worked around:

- **`Promise.withResolvers` on Node 20.** `PageThumbnailRail` owns its own
  react-pdf `Document`. Two creator suites stubbed the workbench but not the
  rail, so pdf.js mounted for real and called `Promise.withResolvers` — present
  on Node 22 (local) and absent on Node 20 (CI). The throw came from a passive
  effect, so React unmounted the whole tree and every later query saw an empty
  container. Both suites now stub the rail for the same reason they stub the
  workbench. Verified by re-running under a config that deletes
  `Promise.withResolvers`: the failure reproduces exactly with the stub removed
  and the full suite passes with it.
- **A save state that lied.** Editing a template whose `storagePath` never
  hydrated hits an existing guard that writes nothing — but it returned without
  restoring the save state, so the indicator and the live region said "Saving…"
  permanently. It now returns to "Unsaved changes"; the guard, the message and
  the refusal to write are unchanged.

### Honest limitations

- A real contrast defect was found by the mobile axe lane and fixed: the active
  bottom-toolbar item and the current page number used
  `--ds-color-action-primary` on `--ds-color-status-info-bg`, which measures
  4.23:1 against a 4.5:1 minimum. Both now use `--ds-color-status-info-fg`. The
  same pairing may exist on surfaces outside this slice and was not audited
  repository-wide.
- Snapping applies to pointer drops only. That is a deliberate choice, not an
  oversight, but it means a mouse user and a keyboard user can land a field in
  measurably different places from the same intent.
- Firefox and WebKit E2E lanes were not run; they are not part of the repo's CI
  gate, which runs Chromium.
- The AI provider is a mock in every test, as before — CI never calls it, and no
  provider claim in this slice was verified against a live key.

---

## Storybook design-system catalogue foundation (2026-07-29)

Phase 11's first two items move: the catalog *tool* is now decided and building
in CI, and 16 subjects plus 6 patterns are documented. The catalog item itself
stays open — see below for exactly what is missing.

### What changed

- **Storybook 10.5.5** on `@storybook/react-vite`, with `@storybook/addon-docs`
  and `@storybook/addon-a11y`. Configured in `.storybook/`.
- It reuses `vite.config.js` (hence the app's aliases) and the same Tailwind
  theme, and loads `src/design-system/index.css`, so a component cannot render
  differently in the catalog than in the product. `viteFinal` strips the three
  application-build-only settings that must not be inherited: the `index.html`
  rollup entry, the hidden Sentry sourcemaps, and the port-5000 `strictPort` dev
  server that would otherwise collide with the app and the Playwright suite.
- **151 stories** across 16 documented subjects and 6 business-neutral page
  patterns. Every page records intended use, supported variants, accessibility
  expectations, common mistakes, the feature-composition boundary, and an
  explicit **Approved / Needs review** status.
- **Three new scripts**: `storybook`, `build-storybook`, `test:stories`.
- **A required CI job**, `storybook-build`, added to both deploy jobs' `needs:`.
  It runs `npm ci`, the story render + axe lane, then `storybook build`, and
  uploads `storybook-static` as an artifact. It is given **no credentials**: the
  workflow-level `VITE_*` secrets are explicitly blanked rather than inherited,
  so the build provably needs none.

### Two real defects this campaign found and fixed

- **Story prose was leaking CSS into the production bundle.** Tailwind's
  extractor scans every file in `content` for candidate class names, prose
  included. A story documentation paragraph containing the word *shadow*
  compiled a `.shadow` rule into the shipped `dist/assets/main-*.css`. Fixed by
  excluding `src/**/*.stories.jsx` from the application's Tailwind `content` and
  giving the catalog `.storybook/tailwind.config.js`, which inherits the app's
  theme by reference and re-adds those files. Verified: every app JS and CSS
  artifact is now **byte-identical** to a build of `origin/main`.
- **`eslint .` was linting the Storybook build output.** `storybook-static/` is
  gitignored but was not in the ESLint ignore list, so a local lint after a
  catalog build reported 6,859 errors from a minified bundle. Added to
  `eslint.config.js` alongside `dist/`.

### Preserved exactly

No application behaviour changed. No Firebase rule, database structure, backend
behaviour, integration, permission, route, feature flag or business workflow was
touched. `vitest.config.js` gained the `@design-system` alias (already present in
`vite.config.js` and `jsconfig.json`) and excludes stories from coverage globs;
no threshold was lowered.

### Verification

| Check | Result |
| --- | --- |
| `npm run build-storybook` | green |
| `npm run test:stories` | 151 stories render; **0** serious/critical axe violations — and **0 at any impact level** |
| `npm run test:coverage` | 205 files, 3208 passed, 48 skipped; 63.9% stmts / 61.8% br / 65.8% fn / 65.2% lines, all far above the ratchet |
| `npm run lint:frontend` | 0 errors (106 pre-existing warnings) |
| `npm run typecheck` | clean |
| `npm run build` | green, artifacts byte-identical to `origin/main` |
| Real-browser pass | all 174 pages (151 stories + 23 docs) in Chromium: **0** console errors, **0** console warnings, **0** page errors, **0** render failures |
| `git diff --check` | clean |
| Visual review | 1440 / 1024 / 412px; screenshots in `docs/screenshots/storybook-catalog/` |

The axe harness was itself sanity-checked — a deliberately unlabelled button was
confirmed to produce a `button-name` critical violation through the same code
path — so the zero-violation result is a real pass, not a vacuous one.

### Honest limitations

- **The catalog item stays open.** `WorkspaceFrame` has no story, reduced-motion
  is documented but has no dedicated story, and the Approved/Needs-review status
  on each page is this campaign's reading, **not an owner-approved sign-off**.
- **No visual regression.** Determinism prerequisites are met (static literal
  fixtures, no externally hosted webfont in the catalog, the only animation
  disabled under `prefers-reduced-motion`, CI artifact upload), but no baselines
  exist and nothing blocks on them. Chromatic was excluded from this campaign by
  scope — not evaluated and rejected.
- **`color-contrast` is not covered by the story lane.** happy-dom computes no
  layout, so the rule is disabled there. Contrast remains covered by the
  real-browser `@axe-core/playwright` lane and the pinned token pairings in
  `tests/tokens.test.js`. The story lane also disables four page-level rules
  (`region`, `page-has-heading-one`, `landmark-one-main`) because a story is a
  fragment, not a page.
- **`Modal`, `ConfirmDialog` and the modal-form pattern are documented from
  `src/shared/components/modals`,** not from the design system. That is the
  existing recorded inversion — the design system must not depend on `shared` —
  and it is unchanged by this campaign.
- **No dark appearance was added,** because SafeHaul has none. The catalog
  offers the existing inverse *surface role* instead and says plainly that it is
  not a theme.
- The three viewport presets are catalog-level conveniences; they do not prove
  the application's own breakpoints, which are unchanged.

---

## Super Admin Environment & Integrations vault (2026-08-02)

**Status:** `[x]` Implemented and verified, with the honest limitations recorded
below. Branch `claude/super-admin-environment-integrations-8mjifh`, based on
`main` at `9c1ff4d06121dd09b20d4fc9aa42f18a022b49c4`.

### What was added

A new Super Admin navigation item, **Environment & Integrations** (icon
`KeyRound`, group `ops`), between *SMS Integrations* and *Form Builder*. It lists
every environment variable, deployment secret, runtime configuration value and
stored integration credential SafeHaul uses — 73 global registry entries plus 20
per-company credential field templates expanded per tenant — with every value
masked as `********` until a Super Admin deliberately reveals one.

The existing per-company **SMS Integrations** workflow is untouched and stays
where it was.

Full operational documentation:
[`docs/environment-and-integrations-runbook.md`](environment-and-integrations-runbook.md).

### Design-system decisions this campaign made

- **One capability added: `Button` now styles `aria-disabled='true'` the same as
  `disabled`.** The page must show unavailable actions rather than hide them, and
  it must say *why*. A truly `disabled` button is removed from the tab order,
  which puts its explanation out of reach of exactly the keyboard and
  screen-reader users who need it most. `aria-disabled` keeps the control
  focusable so the reason — carried in the accessible name and repeated as a
  tooltip — is reachable. Callers must refuse the activation themselves; the CSS
  cannot. Recorded here rather than hand-rolled in the feature.

- **`PageHeader` is deliberately not used.** It renders the page-level `<h1>`,
  and the Super Admin masthead already owns the single `<h1>` for this shell —
  an invariant `e2e/super-admin-views.spec.cjs` enforces across every migrated
  view. The view uses the same `<h2>` + description composition as
  `SystemHealthView` and the rest of the Super Admin row. Using `PageHeader` here
  would have been a real accessibility regression, not a stylistic difference.

- **No new primitives were hand-rolled.** The screen is Card, MetricCard, Badge,
  Button, IconButton, DataTable, FormField, Input, Select, `ResponsiveGrid` /
  `Stack`, and the shared accessible `Modal` / `ConfirmDialog`. The two known
  primitive gaps this screen would have liked — a filter-chip row and an overflow
  menu for row actions — were **not** invented; the filters are approved
  `FormField` + `Select` controls in a `ResponsiveGrid`, and the row actions are
  a visible `IconButton` group. Both gaps remain open in the Introduction page's
  missing-primitive list.

### Catalog

Two business-neutral story files were added, bringing the catalog to eight page
patterns:

- `Patterns/Managed value inventory` (`src/design-system/stories/patterns/ManagedValueInventory.stories.jsx`)
  — masked row, revealed row with its automatic-hide notice, editable entry,
  protected read-only entry with disabled-and-explained actions, missing entry,
  unavailable-from-source entry, and the empty state.
- `Patterns/Typed confirmation` (`src/shared/components/modals/TypedConfirmation.stories.jsx`)
  — the destructive confirmation that requires the exact name typed back, built
  from `ConfirmDialog` with no new dialog primitive. It lives beside
  `ConfirmDialog` for the same recorded reason `Modal` does.

No real SafeHaul key name or value appears in either. Fixtures are neutral
literals (`SERVICE_TOKEN`, `REGION_NAME`, …) and the only "revealed" value in the
catalog is the literal string `sample-value-not-a-secret`.

### Preserved exactly

No existing behaviour changed. The SMS `IntegrationManager` still never preloads
stored credentials into its form, `__PRESERVE__` still means "keep what is
stored", provider verification is unchanged, and line inventory, assignments and
dedicated-line credentials are untouched — `IntegrationManager.contract.test.jsx`,
`LineManager.contract.test.jsx` and `AddLineModal.contract.test.jsx` all still
pass unmodified. No Firestore rule was loosened: the only rules change **adds** a
terminal deny for the new `environment_audit_log` collection.

### Verification

| Check | Result |
| --- | --- |
| `npm run test:coverage` | 207 files, **3418 passed**, 48 skipped; 64.3% stmts / 61.9% br / 66.4% fn / 65.6% lines — all above the ratchet |
| `cd functions && npm test` | 63 suites, **484 passed** |
| `npm run test:stories` | **323 passed**; 0 serious/critical axe violations |
| `npm run lint` | 0 errors (107 pre-existing warnings) |
| `npm run typecheck` | clean |
| `npm run build` | green |
| `npm run build-storybook` | green |
| `node scripts/check-callable-contract.mjs` | passed, 63 callables verified |
| `node scripts/validate-function-index-parse.mjs` | OK, 108 exports mapped |
| `git diff --check` | clean |

### Honest limitations

- **No visual-regression baselines.** The roadmap's screenshot-baseline item is
  still open, so density and alignment on this screen were reviewed by eye and by
  the E2E overflow assertions at 1440 / 1024 / 768 / 412px — not against pinned
  images.
- **The E2E lane asserts the reachable state only.** Under
  `VITE_E2E_TEST_MODE=1` the inventory callable is unreachable by construction,
  so `e2e/super-admin-environment-integrations.spec.cjs` covers the page shell,
  the security notice, the summary cards, the named filter controls, the
  announced load failure and its retry, keyboard operation, axe and overflow.
  Masking, reveal, the 30-second auto-hide, the disabled-action explanations,
  typed-confirmation delete and re-authentication are proven by
  `EnvironmentIntegrationsView.contract.test.jsx`, which can supply rows
  deterministically. Asserting them in the browser would require a backend this
  environment must never have.
- **The Firestore rules emulator lane was not run locally** (no emulator
  download in this sandbox). The new terminal-deny rule and its assertions run in
  CI's `rules-emulator` job.
- **Status for build-time browser values is resolved in the browser.** The Cloud
  Functions runtime has no access to the bundle's inlined values, so the server
  reports `unknown` and the client refines it from a presence boolean. This is
  the only correct answer available, and both the row and the docs say so.

---

## 2026-08-03 marketing-site Firebase integration

- [~] Move the existing SafeHaul marketing landing page into both application
  repositories and deploy it beside the application through named Firebase
  Hosting targets.
  - Files: `landing/**`, `.firebaserc`, `firebase.json`,
    `.github/workflows/main.yml`, `functions/landingLead.js`,
    `functions/test/unit/landingLead.test.js`, Environment Vault registry and
    inventory tests, `README.md`, and `docs/FIREBASE_HOSTING_RUNBOOK.md`.
  - Architecture: the landing page remains a deliberately isolated static site;
    it does not import application features or design-system code. The same
    repository workflow deploys separate application and landing targets, so no
    route or application composition changes.
  - Security: removed the publicly embedded Telegram credential. The form now
    uses a same-origin Hosting rewrite to a server-side Function with an origin
    allowlist, strict validation, a honeypot, fail-closed per-IP rate limiting,
    bounded instances, safe error output, and Secret Manager bindings.
  - Verification so far: Firebase JSON parsed; function export/deploy planners
    passed (109 exports mapped); backend lint passed; 64 backend suites / 490
    tests passed; frontend lint passed with 0 errors and 107 pre-existing
    warnings; production Vite build passed; `git diff --check` passed; static
    credential and nested-route asset-path scans passed.
  - Visual/mobile/a11y: inherited landing content is unchanged apart from
    root-safe URLs, secure form transport, spam field, Escape handling, focus
    return, and dialog naming. Live desktop/mobile review and Firebase/domain
    verification remain required before this item can be marked complete.
  - Status remains in progress until both Firebase default URLs are verified,
    `safehaul.io`/`www.safehaul.io` are certified and live, and Vercel no longer
    owns or auto-deploys the production landing domain.


### Super Admin AI Integrations and Blog Posts completion log (GO) - 2026-08-03

`[x]` Implemented and verified.

**What changed.** Two new Super Admin views built entirely from approved
primitives: `AiIntegrationsView` (provider table, masked credentials with the
one-at-a-time reveal, status/cooldown treatments, Research & Media subsection,
telemetry panel) and `BlogPostsView` (title list with Delete). Supporting
feature components under `src/features/super-admin/components/ai/`.

**Preserved exactly.** The Environment & Integrations vault is untouched. The new
views reuse its `ReauthenticateModal` and its `requestReauth`/`runGuarded`
orchestration rather than copying the logic, and share its guards, rate-limit
buckets and audit trail on the server.

**Design-system exceptions used.** None. No new primitive was required. Two
business-neutral pattern stories were added to the catalogue — *Provider
integration row* (six states) and *Title deletion list* — using generic service
names and `sample-value-not-a-secret`, so no vendor name or product vocabulary
enters the catalogue.

**Deliberate non-use of `PageHeader`.** Both views start at `<h2>`; the Super
Admin masthead owns the single `<h1>`. Asserted in both contract tests and in
`e2e/super-admin-ai-and-blog.spec.cjs`.

**Accessibility defects found and fixed during this work.**

1. Row-level Delete controls shared the accessible name "Delete", which is
   unusable with a screen reader in a table and was also genuinely ambiguous
   about which credential a click removed. They now name their target, matching
   how the vault names its reveal controls.
2. `aria-label` on `ResponsiveGrid`'s `div` and on the masked-value `span` were
   `aria-prohibited-attr` violations, because a generic role cannot carry an
   accessible name. Named grids now use `role="group"`; the masked span drops the
   redundant label, since the field name is already visible text beside the
   value. axe caught the first in the browser; the second would have surfaced
   only once rows rendered.

   Note for a future pass: `EnvironmentIntegrationsView` and its
   `EnvironmentValueCell` carry the same two patterns. They were left unchanged
   here to keep this change scoped and because that view's contract suite pins
   its current behaviour. Worth a dedicated follow-up.

**Verification.**

| Command | Result |
| --- | --- |
| `npx vitest run` (frontend) | 210 files, 3538 tests passing |
| `functions && npx jest` | 67 files, 702 tests passing |
| `npm run test:stories` | 357 tests passing, 0 serious/critical axe |
| `npm run test:rules:emulators` | 50 tests passing |
| `npm run lint` | 0 errors |
| `npm run build` | succeeds |
| `npm run build-storybook` | succeeds |
| `npx playwright test --project=chromium e2e/super-admin-ai-and-blog.spec.cjs` | 24 passing, incl. axe and no horizontal overflow at 1440/1024/768/412 |
| `scripts/check-callable-contract.mjs` | passing |
| `scripts/check-ai-provider-boundary.mjs` | passing |
| `validate-function-index-parse.mjs` | passing |
| `git diff --check` | clean |

**Honest limitations.**

- No visual-regression baselines. The roadmap's screenshot-baseline item is still
  open, so density and alignment were reviewed by eye at the four widths.
- E2E covers the reachable page state only. Under `VITE_E2E_TEST_MODE=1`
  Firestore is deliberately unreachable, so the list callables cannot succeed;
  row-level behaviour (masking, reveal, the 30-second clear, typed delete,
  re-authentication) is proven by the contract tests, which can supply rows
  deterministically.
- Mobile Chrome and the full E2E suite were not run in this environment; only the
  chromium lane for the new spec was. CI runs the rest.
- The two accessibility defects above existed in a shipped pattern before this
  change and remain in the vault view, as noted.
