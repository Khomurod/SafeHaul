# Card and MetricCard

`Card` owns shared surface, border, radius, elevation, and padding.
`MetricCard` displays a generic label/value/icon, with an optional note, and
optionally behaves as a native button. Features select the semantic tone and own
navigation or action callbacks.

## One surface geometry

`Card` reads its radius, border, shadow and padding from the surface-geometry
roles in `tokens/semantic.css` rather than choosing values here:

| Role | Used for |
|---|---|
| `--ds-card-radius` | Corner radius of any card-like surface |
| `--ds-card-border` / `--ds-card-shadow` | Its edge and elevation |
| `--ds-card-padding` | `padding="md"`, the default |
| `--ds-card-padding-compact` | `padding="sm"` |
| `--ds-card-padding-spacious` | `padding="lg"` |

`elevation="soft"` gives a card that holds a table or a list (the Leads and
E-Docs card strips) the table's own `--ds-shadow-soft`, so the two read as one
kind of surface. Every other card keeps `--ds-card-shadow`.

The roles exist so that a feature-owned panel which genuinely cannot be a `Card`
still matches one. Reference the role — or the `p-ds-card` / `rounded-ds-card`
Tailwind utilities that bridge it — instead of copying four values and getting
one of them wrong. Cards that each picked their own `p-4` / `p-6` /
`rounded-lg` were visibly different sizes beside one another on the same screen.

## The KPI tile (C2)

```jsx
<MetricCard label="Live sequences" value={0} description="Sending right now"
            tone="info" icon={<Icon icon={Zap} />} />
```

| Part | Look |
|---|---|
| label | sentence case, `--ds-font-size-body`, medium, `content-secondary`; **wraps** |
| glyph | bare, top-right, `content-muted`, sized by the slot (`--ds-icon-size-md`); decorative |
| value | `--ds-font-size-heading-2xl` (30px) bold, `-0.02em`; 24px under 768px; breaks rather than overflows |
| `description` | optional note under the value, `--ds-font-size-xs`, `content-muted`, `text-wrap: balance` |
| tone | a 4px bar on the left edge, inset `--ds-space-4` from the top and bottom |

The bar colours: `neutral` → `--ds-color-border-strong` (a total or a zero has
nothing to flag), `info` → the brand navy, `success` → `--ds-color-action-success`,
`warning` → `--ds-color-status-warning-fg`, `accent` → `--ds-color-status-accent-fg`,
`danger` → `--ds-color-action-danger`. The tone is decoration: the label and the
value carry the meaning. In forced colours the bar is `CanvasText`.

There is no icon tile any more, and so no `--ds-metric-icon-size`: the glyph is
drawn bare and the slot sizes it, so a caller's `size` on the `Icon` is
outranked and every tile's glyph matches. Nothing is cut: the label and value
carry no ellipsis. They keep their `title`s, which now show nothing hidden,
because the E-Docs overview's unit and browser tests find a tile by them.

A `description` must be a non-empty string (it throws otherwise); `undefined`
and `null` both mean none, so `description={note || null}` is fine. On an
interactive card it is part of the name, after the number —
`"<label>: <value>. <description>"` — because it is visible text inside the
button and WCAG 2.5.3 wants every visible word in the name, in order.

The active state (a dashboard filter) is a 3px line along the **top** edge in
the tone's foreground, so it never reads as the bar every tile has.

Tiles sit in a `ResponsiveGrid`; pick a `minItemWidth` that gives two a row on
a phone and equal columns on the 1200px canvas: about `150px` does both (two a
row at 360–412px with the phone's 16px gap; on the canvas empty tracks collapse,
so two tiles are ≈590px each and four ≈285px). C2's 240px is a desktop minimum
only — with the grid's gap it leaves one tile a row on a 412px phone.

An interactive `MetricCard` is named `"<label>: <value>"` (plus its description). Its visible text must
stay those two words apart: the label and value spans are blocks, with a space
between them that draws nothing. Without it the text reads `attention0`, which
axe's `label-content-name-mismatch` (WCAG 2.5.3) refuses, since the name does not
contain it.

## Loading

`MetricCard loading` draws a `Skeleton` line half the text column wide where the
value goes and ignores `value`, so a card that has not read its number never
shows one (no `0` that was not read), and the card keeps the height it will have
once the number arrives. The card carries `aria-busy="true"`; an interactive card
stays a `<button>` — it still navigates — and is named by its label (and its
description, if it has one), the visible text, so WCAG 2.5.3 still holds. Not
loading, it draws no placeholder and no busy state.

`aria-busy` announces nothing. The caller says once, in a polite `role="status"`
beside the group (never inside a `Notice`), that the group is loading and when it
has loaded, as the company dashboard does.
