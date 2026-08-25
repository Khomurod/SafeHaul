# SafeHaul design system

This directory is the business-neutral visual contract for SafeHaul. It owns
how reusable interface elements look and behave, but it does not decide what
driver, recruiter, application, lead, campaign, or company data is shown.

Before changing UI code, read:

1. `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`
2. This file
3. The component or pattern documentation relevant to the change

## Layer responsibilities

- `tokens/` contains primitive and semantic design decisions and the Tailwind
  bridge. Feature code should prefer semantic tokens over palette values.
- `components/` is for small, accessible, business-neutral controls and
  display primitives.
- `patterns/` composes components into repeatable UI states such as data
  presentation, forms, empty states, and dialog structure. `patterns/modal`
  holds `Modal` and `ConfirmDialog` — the accessible dialog primitive every
  overlay goes through, and the one confirmation shape. `patterns/page-state`
  holds `EmptyState`, `ErrorState` and `LoadingState`, which own the
  announcement each state needs as well as its appearance.
- `layouts/` contains business-neutral page and region composition.
- `icons/` documents and exports the approved icon contract.
- `stories/` is the component catalog, built with Storybook 10 and configured in
  `.storybook/`. Run it with `npm run storybook`; `npm run test:stories` renders
  every story and runs axe over it. See `stories/README.md`.
- `tests/` enforces token and dependency boundaries.

Feature screens remain in `src/features`. Features own content, available
actions, domain-to-visual mapping, and orchestration. Hooks and services own
data, state, and business logic. `src/app` owns routing and application
composition. `src/shared` remains a compatibility and cross-feature utility
layer while visual primitives migrate deliberately into this directory.

## Dependency rule

Code in this directory may depend on React, approved presentation libraries,
and other design-system modules. It must not import feature modules, Firebase,
application context, domain services, business vocabulary, **or `shared`** —
`shared` imports *from* here, so a dependency in that direction is a cycle.
`tests/architecture.test.js` enforces all of it, in stylesheets as well as
modules: it walks `.css` too and resolves every `@import` and `url()` against
this directory, because the JavaScript-only version of that rule let
`index.css` import a token file from `shared` for the whole of the migration
while the README claimed the boundary was enforced.

Do not move a feature screen here. Do not add a local alternative to an
approved component without recording the gap and migration decision in the
roadmap.

## There is no compatibility layer left

`src/design-system/index.css` used to load `src/shared/styles/designTokens.css`
last in the cascade, "while consumers migrate". That file declared a second,
un-namespaced scale for colour, type, radius, shadow, spacing, z-index and the
focus ring in forty-odd raw hexes, and by 2026-08-25 **not one of its ~60
variables or six utility classes had a consumer**. It is deleted. Its only live
rule, the global `prefers-reduced-motion` reset, moved to `utilities.css`.

This directory now imports nothing from outside itself, in JavaScript **or CSS** —
`tests/architecture.test.js` walks both, which is what makes the sentence above
this one true rather than aspirational.

## Current approved consumers

- Company candidate lists consume `DataTable`.
- The Company workspace shell and dashboard consume workspace/page layouts,
  Button/IconButton, Card/MetricCard, Badge, and DataTable.
- The Company Settings Personal Profile compatibility slice consumes the
  native-event form foundation, Card, Button, PageHeader, and Stack while its
  Firestore and clipboard behavior remains feature-owned.
- The Company Settings shell consumes SectionNavigation while the settings
  feature retains tab state, labels, feature flags, permissions, and rendered
  content.
- The Company Settings Billing informational card consumes FormSection,
  FieldDisplay, Badge, and FieldMessage while the plan mapping and support copy
  remain feature-owned.
- The Company Settings Automated SMS templates form consumes FormSection,
  FormField, Textarea, Button, and FieldMessage while the three template names,
  Firestore read/write, placeholder meaning, and messages remain feature-owned.
- The Company Settings Email Settings form consumes FormSection, FormField,
  Input, Textarea, Button, Badge, Card, and FieldMessage while the SMTP fields,
  callable contracts, password rules, provider setup guide, test/save workflows,
  status mapping, and messages remain feature-owned.
- The public signing room's status screens (loading, access denied, voided,
  signed, ESIGN consent) consume Card, Button, Stack, and the `StatusMedallion`
  primitive, while the signing feature keeps the domain-to-tone/icon decision,
  every frozen user-facing string, and the `window.close()` behaviour.
- The Login screen consumes FormField, Input, Button, IconButton, and Card, and
  migrates its password-reset overlay to the approved accessible Modal, while
  authentication, redirects, password visibility, and the reset workflow remain
  feature-owned.
- The public driver application (`/apply/:slug`) and the sandbox application that
  reuses it consume Card, Button, IconButton, Badge, FormSection, FormField,
  Input, Textarea, Select, Checkbox, Radio, ChoiceGroup, FieldDisplay,
  FieldMessage, Label, StatusMedallion, and the new ProgressBar. The wizard's
  step order, conditional steps, every field key and saved payload shape, the
  `submitGuestApplication` contract, draft/offline-queue/retry semantics, upload
  paths and limits, consent wording, and the post-application signing contracts
  all remain feature-owned and unchanged. Documented feature-owned exceptions:
  the sandbox Magic Fill control (missing Button tones) and the FMCSA employer
  combobox options (`role="option"` cannot be an approved Button; no
  Combobox/Listbox primitive). Its uploads are `FileInput` as of 2026-08-25.

- The Driver Dossier foundation — the modal shell, header, section navigation,
  read-only application summary and document gallery — consumes the shared
  accessible `Modal`, Button/IconButton, Select, Badge and Card. The dossier
  keeps its six tab state values, the `useApplicationView` argument list, the
  delete payload and permission rule, the PDF payload, the document-URL
  precedence and every frozen string. As of 2026-08-25 its tab rail is `TabList`
  (vertical on a desktop, horizontal on a phone, with the panel in
  `DriverProfileModal` deriving its ids from the same `idBase`), its summary/full
  toggle is `SegmentedControl`, and its `tel:`/`mailto:`/download/photo
  navigations are `Link` / `ButtonLink` / `IconButtonLink`. The four tab bodies the
  2026-07-27 foundation slice left out are all migrated now: DQ, Activity and
  Notes on 2026-07-28 (`DQFileTab` was one of the first `FileInput` consumers),
  PEV/VOE separately, and on 2026-08-25 the Documents and Notes bodies moved their
  hand-composed empty and loading panels onto `patterns/page-state`. Their paths,
  payloads and audit-log calls are frozen by
  `tabs/DossierBodies.contract.test.jsx`, because these bodies own DOT-compliance
  data.

- PEV initiation and tracking — the `PEVTab` summary/list/actions, the
  verification-history dialog, `PEVRequestModal` and `FmcsaCarrierPicker` —
  consumes `MetricCard`, `Card`, `Badge`, `Button`, `IconButton`, `ChoiceGroup`,
  `Radio`, `FormField` and `Input`, plus the approved accessible `Modal`. The
  shared `PaywallMessage` is migrated with it and now takes a `headingLevel` so
  it stops colliding with its host's section heading. The callable payloads,
  activity log, Firestore write, Storage path, clipboard/URL behaviour, delivery
  values and every frozen string remain feature-owned. Documented feature-owned
  exceptions: the FMCSA suggestion rows (raw `<button>`; no Listbox/SelectableCard
  primitive — a three-line record summary, which `SegmentedControl`'s string
  `label` cannot express) and the result-upload input, which is a *programmatic*
  picker: one hidden input opened by whichever per-employer row action was
  activated, where `FileInput` is a visible control by contract.
  `VOEPreviewModal`'s document layout, its PDF/print rendering and the employer
  response portal are deliberately not migrated.

- The VOE preview (`VOEPreviewModal`) consumes the approved accessible `Modal`,
  `Button` and `IconButton` for its **chrome only**. The generated 49 CFR
  §391.23 document inside it is deliberately **not** tokenised: it is rasterised
  by html2canvas and written into a bare print window that has no `--ds-*`
  custom properties, so a tokenised colour would resolve to nothing on export.
  `VOEPreviewModal.export.test.jsx` enforces the boundary in both directions —
  no `ds-*` class inside the document, and tokens required outside it. Treat any
  exported document as immutable content, not themeable chrome, and prove export
  parity before changing that.

- The Super Admin Environment & Integrations vault consumes Card, MetricCard,
  Badge, Button, IconButton, DataTable, FormField, Input, Select, the page
  layout primitives, and the approved accessible `Modal` / `ConfirmDialog`. The
  configuration registry, the six Cloud Functions callables, the reveal
  authorisation and timing rules, the audit trail and every domain-to-visual
  mapping remain feature-owned. It deliberately does **not** use `PageHeader`:
  that primitive renders the page-level `<h1>`, which the Super Admin masthead
  already owns, so the view uses the same `<h2>` composition as the other
  migrated Super Admin views.

  This campaign added one capability to the design system: `Button` now styles
  `aria-disabled='true'` identically to `disabled`. A truly `disabled` button is
  removed from the tab order, which makes an unavailable action's *reason*
  unreachable by exactly the users who most need it. Callers using
  `aria-disabled` must refuse the activation themselves.

- The Campaigns audience and content builders consume Card, Button, Badge,
  FormField, Input, Select and the three page states. The campaign draft shape,
  the `getFilteredLeadsPage` callable, the filter keys, the CSV/Sheet import
  path, the exclusion semantics and every frozen string remain feature-owned.
  The audience preview panel is an **inverse (console) surface** expressed in
  the `--ds-color-surface-inverse` roles, the same ones `SystemHealthView`'s log
  panel uses; `PageState` gained `surface="inverse"` so its three states did not
  have to be hand-composed there. One documented feature-owned exception
  remains: `DeviceMockup`, which is artwork rather than interface and keeps its
  own four-literal device palette.

- Settings, the driver-change review portal, the e-doc envelope creator and the
  Login screen consume the form primitives, Card, Button (including the `link`
  variant), IconButton, IconButtonLink, Checkbox, Switch, SegmentedControl,
  Disclosure, FileInput and the inverse surface roles. Authentication, the reset
  workflow, the envelope field model and its PDF coordinates, the question schema
  and every callable contract remain feature-owned. Documented feature-owned
  exceptions: the signing-room and envelope-creator controls whose geometry comes
  from the PDF, the field-palette tiles, the FMCSA combobox options, the login
  hero's artwork wash and Facebook's own brand blue.

  (The welcome tour used to be listed here. It was removed on 2026-08-25 — see
  roadmap §6 — so it is not a consumer of anything.)

- The signing room, the public driver application, the driver dossier, Import
  Leads and the Super Admin maintenance panels consume `patterns/page-state` and
  `ConfirmDialog` for every status screen and every confirmation, as of
  2026-08-25. Before that they hand-composed both: nine full-page status screens
  and four panel-level empties reproduced `PageState`, and six dialogs reproduced
  `ConfirmDialog` — one of them a local component with the same name, shadowing
  the import. See roadmap §8 for what that cost and §7 for the review step that
  now finds it, because no static rule can: a hand-composed pattern is made of
  correct primitives.

  Three capabilities were added to `PageState` rather than kept at the call
  sites, each because more than one consumer had written it by hand: `titleId`
  (a full-page state is the accessible name of its `<main>`, and `role="status"`
  is not valid on `<main>`, so the landmark needs the heading's id), `children`
  (a confirmation reference, an outstanding-document checklist) and
  `focusOnMount` (a state that replaces the control the user just activated
  leaves focus on `<body>` unless something moves it — announcement alone does
  not move the reading position).

The primitive APIs are usable for migrated consumers, but their broader
component-family roadmap items remain in progress until catalog examples and
durable visual baselines are owner-approved.

## Component catalog

`npm run storybook` opens the catalog. It documents the control scale plus
Button (five variants, including `link`), IconButton, Link/ButtonLink, Input,
Select, Textarea,
Checkbox/Radio/ChoiceGroup, Switch, FileInput, Badge, Card/MetricCard, Tabs,
SegmentedControl, Disclosure, DataTable, the page layout primitives,
ProgressBar, StatusMedallion, SectionNavigation, the form-structure primitives,
Modal and ConfirmDialog — plus the business-neutral page patterns.

`Foundations/Control scale` is the one to read first: it shows an input and its
adjacent button at each of the three steps, and proves that icon size comes from
the design system rather than the call site.

Each page records an explicit **Approved** / **Needs review** / **Temporary**
status and names what is unresolved. Read that status before reusing something:
the catalog is deliberately not a list of things that are all finished. The
`Introduction` page is the authority on what does **not** exist yet — as of
2026-08-25 that is Combobox/Listbox, an indeterminate checkbox outside
`DataTable`, a compact icon-button step for a control overlaying PDF geometry, a
filter chip, an overflow menu, a split panel, a sticky page footer, a
card-section disclosure, a section rail with per-item status, and a bottom app
bar that is deliberately not being built. Tabs, Link, FileInput, Switch,
SegmentedControl, Disclosure, the three page states and `ConfirmDialog` all
exist and all have consumers — *every* consumer, as of 2026-08-25. Do not
hand-roll any of them, and do not hand-roll the ones that are missing either;
record the need in the roadmap.

The trap that caught this product twice is worth naming here: a **hand-composed
pattern** — `Card` + `StatusMedallion` + heading + body + actions, or a `Modal`
with its own Cancel/Confirm footer — is made entirely of approved primitives, so
it passes every automated rule while being a second implementation of something
the design system owns. Twenty-one had accumulated by 2026-08-25. If you are
arranging primitives into a shape that looks like `PageState` or
`ConfirmDialog`, use the pattern.

Catalog stories may not import features, Firebase, application context or domain
services, and may not use domain vocabulary. `tests/architecture.test.js`
enforces the import half of that rule, and `storybook-build` in CI builds the
catalog with no credentials at all.

## Guardrails

Eight automated checks stand between this design system and the state the
application was in before the 2026-08 campaign, when a substantial and
well-adopted system coexisted with 660 raw palette classes, off-scale type and
sub-12px text — all of which passed review, lint, 234 test files and CI, because
nothing checked.

**Every one of them is blocking.** The pixel lane was `continue-on-error` until
2026-08-25, on the grounds that baselines are not portable; the CI record said
otherwise — it had failed 20 of 152 on every run, all twenty being application
screens, because the product fetched its typeface from a third party the runner
could not reach. The font is in this repository now, so there is nothing left
that is not portable. The accessibility lane was advisory too, and had been green
for weeks.

| Command | Blocking | Catches |
|---|---|---|
| `npm test` (`tests/architecture.test.js`) | yes | An import from features, context, Firebase or `shared` into this directory — in a stylesheet as well as a module |
| `npm test` (`tests/tokens.test.js`) | yes | A broken token contract, a contrast pairing below AA, an unbridged Tailwind utility, a control sizing itself in pixels |
| `npm run check:ui-contract` | yes | A raw colour, off-scale type size, sub-12px text, Tailwind radius or shadow, hand-built overlay, raw table, hand-styled control, hand-rolled tablist, raw file input or hand-written `target="_blank"` — in JSX, in stories and in CSS |
| `npm run check:table-layout` | yes | A cell narrower than its content, in a real browser at 412px and 1440px — in `DataTable` **and** in the `ds-native-table` contract |
| `npm run check:visual-contract` | yes | A change to computed geometry — control heights, cell padding, radii, resolved colours |
| `npm run test:stories` | yes | A story that fails to render, or fails axe |
| `npm run test:visual` | **yes** | A change to how anything *looks*, across 67 catalog subjects and 15 real screens at both widths |
| `npm run test:e2e -- --grep "@a11y"` | **yes** | Real-browser axe on the mobile-critical journeys, plus the keyboard behaviour axe cannot see: roving `tabIndex`, arrow/Home/End on a tab strip, `aria-pressed` on a segmented group, a file input named by its field, and that every control a Tab press reaches shows the product's focus ring rather than the browser's |

**A ninth guard is a person, and saying so is better than pretending.** None of
the eight can see a *hand-composed pattern* — a status screen built from `Card` +
`StatusMedallion` + heading + body + actions, or a `Modal` with its own
Cancel/Confirm footer. Every ingredient is approved, so every rule passes, and
twenty-one of them had accumulated by 2026-08-25. Two searches find them, and both
belong in a review of any UI change: `StatusMedallion` used outside this
directory, and a locally declared component whose name ends in `Dialog`. Neither
is a clean automated rule — both have legitimate hits — and a check that fires on
correct code gets switched off.

`check:ui-contract` is zero-tolerance against
`ui-contract.allowlist.json`, which lists every violation the product
deliberately keeps and **why**. It fails on anything not listed, on a count
higher *or lower* than recorded, on any entry whose rule has no reason, and on an
approved native table that does not apply the `ds-native-table` contract. It
began as a shrink-only inventory of 660 violations tagged with the migration
slice that owed each one; that debt reached zero on 2026-08-25 and the `debt`
escape hatch went with it, so an entry is now a decision someone wrote down
rather than a promise to come back.

Its styled-control rules were, until 2026-08-25, matching `<(button)\b([^>]*)>` —
and `[^>]*` stops at the `>` in `=>`, so any control whose `className` came after
an arrow function was invisible. It saw 12 hand-styled controls; a real
open-tag scanner sees 49. **A guard's coverage is a thing to measure, not to
assume.**

Run all of them before opening a UI pull request — `.github/pull_request_template.md`
is the checklist, and it asks you never to tick a check you did not run.
