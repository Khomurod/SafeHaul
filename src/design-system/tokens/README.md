# Design tokens

SafeHaul uses two token levels:

- `foundation.css` contains raw, namespaced scales. Feature code should not
  normally consume palette tokens directly.
- `semantic.css` assigns UI meaning such as surface, content, action, status,
  focus, and table roles.

The `--ds-*` namespace makes a design-system token visible as one at every call
site. Tailwind exposes selected semantic tokens with `ds-`-prefixed utilities.

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

## Colour roles worth knowing

- **Actions are the brand navy.** `--ds-color-action-primary` is
  `--ds-color-brand-deep` (#004C68) and its hover `--ds-color-brand-deep-strong`
  (#003A50). Links (`--ds-color-content-link`) and the focus ring
  (`--ds-color-focus`) stay blue, so a link still reads as different from an
  action, and the ring clears 3:1 on the canvas it is drawn on.
- **What is selected wears the brand tint.** `--ds-color-surface-selected` and
  `--ds-color-brand-primary-subtle` are `--ds-color-brand-deep-tint` (#E6F0F3).
- **The company frame keeps its blue.** `--ds-color-navigation-accent` is the
  sidebar's active item and group glyph, its logo tile and the signed-in
  person's disc (`Avatar tone="navigation"`). Nothing outside the frame reads it.
- **Progress stays blue.** `--ds-color-progress` (blue-600) fills an `info`
  `ProgressBar`: how far something has got is information, not an action.
- **`--ds-color-brand-primary` is safe as text** on `surface` and `canvas` (the
  page eyebrow). The two `brand-deep-*` steps are interface colours derived from
  the mark, not part of it: the logo, loader and favicon never draw them.

Every pairing above is asserted in `tests/tokens.test.js`.

## Type

The scale runs 12px (`--ds-font-size-xs`) to 30px
(`--ds-font-size-heading-2xl`, the level-1 page title above 767px). Display type
sets on `--ds-line-height-display` (1.15); headings on `tight`, body on `body`.

## Geometry contracts

Three groups of tokens exist so that geometry is decided once rather than at each
call site. Changing one of these changes the product, which is the point.

- **Control scale** (`--ds-control-height-{sm,md,lg}` = 36 / 44 / 52px, plus
  `--ds-control-icon-{sm,md,lg}` = 14 / 16 / 18px). Read by `Button`,
  `IconButton`, `Input`, `Select` and `Textarea`, all defaulting to `md`, so an
  input and the button beside it are the same height with nothing set at the call
  site. `md` is WCAG 2.2 SC 2.5.5 (Enhanced). `lg` is for the primary action of a
  public, mobile-first, single-task screen — not for matching a form control.
- **Surface geometry** (`--ds-card-*`, `--ds-page-content-width`,
  `--ds-page-gutter*`, `--ds-section-gap`, `--ds-field-gap`). One card and page
  rhythm: cards are 16px round (`--ds-card-radius` = `--ds-radius-xl`), and the
  `standard` page canvas is 1200px of content between 40px gutters (16px on a
  phone), read by `PageContainer`.
- **Table roles** (`--ds-table-*`). Header height (44px, on the card's white),
  row heights per density (comfortable 68px, compact 56px), cell padding (16px),
  and the column widths a table may not paint outside of. The table card's lift
  is `--ds-shadow-soft`.
- **Disabled dimming** (`--ds-opacity-disabled`, `--ds-opacity-disabled-soft`).
  Two roles, not one: `disabled` is the plain fade, and `soft` is for a control
  that also *recolours* when disabled — `FormControls` does — so it needs less
  dimming on top to stay readable. Nine sites were dimming to five different
  values before these existed.

**A token nothing references is deleted, not kept.** A token costs nothing to
keep, so nothing notices one outliving its consumers — and a vocabulary nobody
prunes stops being a vocabulary and becomes a list, where the next reader cannot
tell which entry is live. `tests/tokens.consumers.test.js` enforces it. It compares
whole names rather than substrings, and it does not count a **test** as a
consumer: a token asserted on only by a test is still dead in the product.

The consequence is a sequencing rule worth stating: **declare a token in the
change that gives it a consumer, not before.** `--ds-z-dropdown` was declared
ahead of the layering work and sat unused; the rest of the z scale arrives with
the migration that reads it.

Something that is *not* a control must not read a control height. The table's
selection hit area has its own role, `--ds-table-selection-control-size`, rather
than following `--ds-control-height-md`, which would have grown it when that
moved to 44px; `tests/tokens.test.js` pins that `Card` reads no control height
either.
