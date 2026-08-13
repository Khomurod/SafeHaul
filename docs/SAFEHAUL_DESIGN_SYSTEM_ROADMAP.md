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
- **Status is never colour alone** — always text or icon plus tone.
- **`--ds-color-content-muted` is approved on `--ds-color-surface` only.** It
  measures 4.34:1 on `surface-subtle` and 4.27:1 on `status-warning-bg`, both
  below WCAG AA for normal text. Two unrelated surfaces failed real-browser axe
  on this pairing. Use `content-secondary` (6.85:1) anywhere else, and see the
  open decision in §6.
- **Every overlay goes through the shared accessible `Modal`.** No hand-built
  `fixed inset-0` dialog. A repository-wide scan should return only `Modal`
  itself and callers passing it an `overlayClassName`.
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
- **`CallOutcomeModalUI`'s outcome grid stays a `role="group"` of raw
  `<button aria-pressed>` cards** — there is no approved Segmented/ToggleGroup or
  SelectableCard primitive. Same exception as the dossier summary toggle and the
  PEV FMCSA rows. All its colours are approved tokens.
- **File inputs stay local** in `DQFileTab`, `BulkUploadLayout`, the public
  application and the PEV result upload: there is no approved file-input
  contract yet.
- **Styled `<a>` navigations stay local** (`tel:`, `mailto:`, download, CDL
  photos, the DQ file download): there is no Link/ButtonLink primitive yet. All
  carry real accessible names.
- **`VOEPreviewModal`'s generated 49 CFR §391.23 document keeps its raw palette
  and its sub-12px type.** It is rasterised by html2canvas into a bare print
  window with no `--ds-*` custom properties, so a token would resolve to
  nothing. Enforced in both directions by `VOEPreviewModal.export.test.jsx`.
- **`DeviceMockup`'s phone status-bar time keeps `text-[10px]`** — it is a
  decorative illustration of a real device, not interface text.

---

## 6. Open decisions and blockers

These do not block compatibility-first migrations that preserve the current
identity and record evidence. They **do** block declaring the affected families
fully approved, publishing durable visual baselines, or making the related CI
enforcement permanently blocking.

- `[!]` **Approve a `content-muted` value that is safe on `surface-subtle`.**
  See §3. Darkening the token would change every muted label in the product, so
  it needs owner approval. Until then `content-muted` is approved on `surface`
  only, and `src/design-system/tests/tokens.test.js` pins the gap in both
  directions.
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
- `[!]` **Move `Modal` and `ConfirmDialog` into `design-system/patterns`.**
  `ConfirmDialog` belongs in `patterns/`, but it composes `Modal`, which still
  lives in `shared/components/modals`, and the design system must not depend on
  `shared`. Both must move together, deliberately.
- `[!]` **Promote a `Switch` primitive.** `FeaturesView` uses a native
  `Checkbox` because there is no approved ARIA switch, while Company Settings
  has a feature-owned `ToggleSwitch` that cannot be imported across features
  without breaking layering.
- `[!]` **Decide how an employer signs the verification portal without a
  mouse.** A canvas cannot be drawn on with a keyboard, so `SignaturePad` — the
  legally operative mark on a 49 CFR §391.23 response — has **no keyboard or
  assistive-technology path to producing a signature**. Everything around it is
  accessible and axe reports zero serious/critical violations, because axe
  cannot detect a missing input modality. A typed fallback is the obvious remedy
  and the product already has the concept (`TEXT_SIGNATURE:` on the VOE side),
  but a typed mark that is indistinguishable in the stored PNG from a drawn one
  is a **legal-semantics decision, not a styling one**.
- `[!]` **Align control heights across the primitives.** `.ds-form-control` has
  `min-height: 44px` (`components/form/FormControls.css`), while `Button` uses
  `--ds-control-height-md: 40px` and `-sm: 36px`
  (`tokens/foundation.css`), so an input and its adjacent button in the same row
  are different heights. 40px still satisfies WCAG 2.2 AA SC 2.5.8 (24px
  minimum) — 44px is SC 2.5.5, level AAA — so this is a consistency and
  ergonomics decision, not a conformance failure. The public application uses
  the approved `size="lg"` (44px) for the controls a driver taps repeatedly,
  rather than overriding the primitive.
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
| `src/design-system/tests/architecture.test.js` | No imports from features, application context or Firebase into `src/design-system` |
| `src/design-system/tests/tokens.test.js` | The semantic token contract and its contrast pairings, in both directions |
| `src/tests/noBlockingBrowserDialogs.test.js` | No `confirm(` / `alert(` anywhere under `src/`, with or without a `window.` prefix. It walks every non-test file, strips comments and string literals, and is proven to catch a real call rather than passing vacuously |
| `npm run test:stories` (`src/tests/designSystemStories.a11y.test.jsx`) | Every catalog story renders and passes axe |
| `npm run check:table-layout` (`scripts/check-table-layout.mjs`) | Measures the built catalog in a real browser at 412px and 1440px: a cell must contain its content (`scrollWidth > clientWidth` is a violation unless the column opts into `truncate`), and no region may reserve a gutter it never scrolls into |

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
feature screen with no story is not measured.

### Still open

- `[ ]` Ratcheting rules for arbitrary colours and unsupported type sizes.
- `[ ]` Ratcheting rules for raw tables, duplicate buttons, local modals and
  local form controls, with machine-readable approved locations.
- `[ ]` A design-system PR checklist requiring behaviour, desktop/mobile visual,
  keyboard, a11y, tests, roadmap, catalog, diff and compatibility evidence.

---

## 8. Migration state

**The screen inventory is complete: 19 of 19 areas migrated, closed 2026-07-28**,
covering the company workspace and settings, login/auth, the public driver
application, the driver dossier, PEV/VOE, e-docs and the signing experience,
lead intake, and Super Admin. Later campaigns extended it to the Environment &
Integrations vault, AI Integrations and Blog Posts, and operator-controlled AI
provider priority.

Two areas are deliberately **NO-GO** and remain unmigrated, each blocked on an
owner decision in §6:

| Area | Blocked on |
|---|---|
| Company Settings → SMS / number assignment | Editable-matrix responsive strategy; entanglement with the out-of-scope secret-entry `LineManager` |
| Company Settings → Integrations (Facebook) | The `request.auth.uid` tenant-binding defect |

Component families that are **complete**: dialogs (every active overlay uses the
shared `Modal`) and toast/notification. Families still in progress —
inputs, select/textarea, empty/error states, icons, loading primitives beyond
`ProgressBar` — are tracked by the guardrail work in §7 rather than by a list of
screens, because the screens are done and what remains is preventing regression.

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
