# Design tokens

SafeHaul uses two token levels:

- `foundation.css` contains raw, namespaced scales. Feature code should not
  normally consume palette tokens directly.
- `semantic.css` assigns UI meaning such as surface, content, action, status,
  focus, and table roles.

The `--ds-*` namespace was originally there to avoid colliding with the legacy
variables in `src/shared/styles/designTokens.css`. That file is **deleted** as of
2026-08-25 — not one of its ~60 variables had a consumer left — so the namespace
now serves only its second purpose: making a design-system token visible as one
at every call site. Tailwind exposes selected semantic tokens with `ds-`-prefixed
utilities.

`typeface.css` holds the product's typeface, served from
`src/design-system/fonts/` rather than fetched from a CDN. Read its header before
changing it: an external `@import` is what made every application visual baseline
fail on the CI runner, for the whole life of that lane.

Do not add body text below 12px. Do not add a raw color to a feature when an
appropriate semantic role exists; add or revise a semantic role with contrast
evidence instead. If a role exists but has no Tailwind utility, add the bridge —
an unbridged role is why feature code reached for a raw palette class, and
`tests/tokens.test.js` now asserts every bridged utility resolves to a real
token.

## Geometry contracts

Three groups of tokens exist so that geometry is decided once rather than at each
call site. Changing one of these changes the product, which is the point.

- **Control scale** (`--ds-control-height-{sm,md,lg}` = 36 / 44 / 52px, plus
  `--ds-control-icon-{sm,md,lg}` = 14 / 16 / 18px). Read by `Button`,
  `IconButton`, `Input`, `Select` and `Textarea`, all defaulting to `md`, so an
  input and the button beside it are the same height with nothing set at the call
  site. `md` is WCAG 2.2 SC 2.5.5 (Enhanced). `lg` is for the primary action of a
  public, mobile-first, single-task screen — not for matching a form control.
- **Surface geometry** (`--ds-card-*`, `--ds-page-gutter*`, `--ds-section-gap`,
  `--ds-field-gap`). One card and page rhythm.
- **Table roles** (`--ds-table-*`). Header height, row heights per density, cell
  padding, and the column widths a table may not paint outside of.

Something that is *not* a control must not read a control height. Two did:
`MetricCard`'s icon chip and the table's selection hit area both followed
`--ds-control-height-md` and would have grown when it moved to 44px. They have
their own roles (`--ds-metric-icon-size`,
`--ds-table-selection-control-size`), and `tests/tokens.test.js` pins that.
