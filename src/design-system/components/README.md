# Components

Business-neutral, accessible UI primitives belong here. Components accept
visual or interaction props such as `tone`, `size`, `disabled`, and
`aria-label`; they do not accept SafeHaul domain objects or query data.

`data-table/` contains the first approved primitive family and its documented
column, interaction, async-state, and responsive contracts. Its first consumer
is the Company candidate-list pilot.

`button/`, `card/`, and `badge/` contain the first shell/dashboard consumer
implementations, with APIs, unit/axe tests and usage documentation.

**The catalog and the baselines those families were waiting on both exist.** The
catalog is Storybook (`src/design-system/stories/`, `npm run storybook`), and 172
pixel baselines are committed under `e2e/visual/__screenshots__/`. `npm run
test:visual` has been **blocking** since 2026-08-25 — it ran advisory before
that, and had never once been green, because the application fetched its
typeface from a third party the runner could not reach. The font is served from
the repository now, so a moved baseline means the pixels moved.

`form/` contains the native-event FormField, Label, FieldMessage, Input,
Textarea, Select, and FormSection foundation, plus the native-first `Checkbox`,
`Radio` and `ChoiceGroup` choice controls added for the public driver
application. Existing shared form components remain compatibility adapters for
callback and file behavior.

`switch/` and `file-input/` are **complete**, not open — both landed 2026-08-22
with an implementation, a stylesheet, unit tests, a README and a Storybook entry;
`file-input/` additionally owns drop acceptance, rejection and upload behaviour
and their tests.

`progress/` contains the determinate `ProgressBar`. It exists because the public
application's step meter communicated progress by a styled `<div>`'s width alone,
which assistive technology cannot read at all. Indeterminate, buffered and
circular variants are not implemented.

`section-navigation/` contains the grouped, current-item-aware navigation
contract for feature-owned settings and sub-section shells. It centralizes
navigation semantics, focus behavior, responsive presentation, and interaction
states while leaving routes, permissions, labels, and available items to the
feature.

`disclosure/`, `link/`, `segmented/`, `status-medallion/` and `tabs/` complete
the current set. `link/` is worth calling out because its absence used to be
cited as an open gap: it exports `Link`, `ButtonLink` and `IconButtonLink`, so a
navigation that needs to look like a button has an approved anchor to use.
`status-medallion/` is the one family here with no README of its own.

**Dialog is not a remaining candidate.** It moved into the design system on
2026-08-22 and lives in `../patterns/modal/` — `Modal`, `ConfirmDialog` and their
stories — rather than under `components/`, because a dialog is a composition with
focus and dismissal behaviour rather than a single control.

Existing `src/shared/components` implementations remain compatibility sources
until each consumer is migrated. The live list of families and their status is
`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` section 5 — this file describes what is
in this directory, not what is left to do.
