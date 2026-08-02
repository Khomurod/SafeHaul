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
  presentation, forms, empty states, and dialog structure.
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
application context, domain services, or business vocabulary.

Do not move a feature screen here. Do not add a local alternative to an
approved component without recording the gap and migration decision in the
roadmap.

## Compatibility policy

`src/design-system/index.css` currently loads the existing
`src/shared/styles/designTokens.css` after the new namespaced token contract.
This preserves the current cascade while consumers migrate. The legacy file
must not be removed until its consumers and visual behavior have been
verified.

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
  migrates its password-reset overlay to the shared accessible Modal, while
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
  the sandbox Magic Fill control (missing Button tones), the FMCSA employer
  combobox options (`role="option"` cannot be an approved Button; no
  Combobox/Listbox primitive yet), and two file-input compositions (no approved
  file-input contract yet).

- The Driver Dossier foundation — the modal shell, header, section navigation,
  read-only application summary and document gallery — consumes the shared
  accessible `Modal`, Button/IconButton, Select, Badge and Card. The dossier
  keeps its six tab state values, the `useApplicationView` argument list, the
  delete payload and permission rule, the PDF payload, the document-URL
  precedence and every frozen string. Documented feature-owned exceptions: the
  WAI-ARIA tablist (no approved Tabs primitive), the summary/full toggle group
  (no Segmented/ToggleGroup primitive), and four styled `<a>` navigations
  (`tel:`, `mailto:`, download, CDL photos — no Link/ButtonLink primitive). The
  DQ, PEV/VOE, Activity and Notes tab bodies are deliberately not migrated and
  stay reachable and unchanged inside the shell.

- PEV initiation and tracking — the `PEVTab` summary/list/actions, the
  verification-history dialog, `PEVRequestModal` and `FmcsaCarrierPicker` —
  consumes `MetricCard`, `Card`, `Badge`, `Button`, `IconButton`, `ChoiceGroup`,
  `Radio`, `FormField` and `Input`, plus the shared accessible `Modal`. The
  shared `PaywallMessage` is migrated with it and now takes a `headingLevel` so
  it stops colliding with its host's section heading. The callable payloads,
  activity log, Firestore write, Storage path, clipboard/URL behaviour, delivery
  values and every frozen string remain feature-owned. Documented feature-owned
  exceptions: the FMCSA suggestion rows (raw `<button>`; no Listbox/SelectableCard
  primitive) and the result-upload file input (no approved file-input contract).
  `VOEPreviewModal`'s document layout, its PDF/print rendering and the employer
  response portal are deliberately not migrated.

- The VOE preview (`VOEPreviewModal`) consumes the shared accessible `Modal`,
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
  layout primitives, and the shared accessible `Modal` / `ConfirmDialog`. The
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

The primitive APIs are usable for migrated consumers, but their broader
component-family roadmap items remain in progress until catalog examples and
durable visual baselines are owner-approved.

## Component catalog

`npm run storybook` opens the catalog. It documents sixteen subjects — Button,
IconButton, Input, Select, Textarea, Checkbox/Radio/ChoiceGroup, Badge,
Card/MetricCard, DataTable, the page layout primitives, ProgressBar,
StatusMedallion, SectionNavigation, the form-structure primitives, Modal and
ConfirmDialog — plus eight business-neutral page patterns.

Each page records an explicit **Approved** / **Needs review** / **Temporary**
status and names what is unresolved. Read that status before reusing something:
the catalog is deliberately not a list of things that are all finished, and the
`Introduction` page lists the primitives that do **not** exist yet (Tabs, Link,
Combobox, file input, Switch, segmented control, filter chip, overflow menu,
disclosure, split panel, sticky footer). Do not hand-roll those — record the need
in the roadmap.

Catalog stories may not import features, Firebase, application context or domain
services, and may not use domain vocabulary. `tests/architecture.test.js`
enforces the import half of that rule, and `storybook-build` in CI builds the
catalog with no credentials at all.
