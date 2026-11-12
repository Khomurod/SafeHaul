# SelectableCard

**Status: Approved.**

A block of record content that behaves as one option.

```jsx
import { SelectableCard } from '@/design-system/components';

<SelectableCard selected={picked === row.id} onSelect={() => pick(row.id)}>
  <Record {...row} />
</SelectableCard>

<SelectableCard current={page === n} padding="xs" aria-label={`Page ${n}`} onSelect={…}>…</SelectableCard>
<SelectableCard as="div" surface="inverse" tone="warning">…</SelectableCard>
```

## Props

| Prop | Values | Notes |
|---|---|---|
| `as` | `button` (default), `div` | `div` is the non-interactive twin |
| `selected` | `true` / `false` / omitted | → `aria-pressed`; omitted means "not a toggle" |
| `current` | `true` / omitted | → `aria-current="page"` |
| `tone` | `default`, `info`, `success`, `warning`, `danger` | colours the **border** only |
| `surface` | `default`, `inverse` | `inverse` is the console-dark panel |
| `padding` | `none`, `xs`, `sm` (default), `md` | |
| `frame` | `card` (default), `row` | `row` = one row of a grouped list inside a `Card`; see below |
| `onSelect` | handler | button only |

## Three states, and only one at a time

The four migrated sites carried three different ARIA states between them, which
is the thing this had to get right rather than average out:

- **`selected` → `aria-pressed`.** A two-state choice you can turn off: the FMCSA
  suggestion rows, the lead-exclusion rows.
- **`current` → `aria-current`.** Which one of a set you are on, where something
  always is: the PDF page thumbnails.
- **Neither.** A plain activation that goes somewhere: the company chooser.
  Picking a company signs you into it; it is not a selection, and announcing it
  as a toggle would be a lie.

Passing both throws. They answer different questions — "is this one on" and "is
this the one you are on" — and an element asserting both tells assistive
technology two stories about itself.

## `selected` and `current` look identical

On purpose. They differ in what they *tell* assistive technology, not in what
they look like: a person looking at the screen wants one answer ("this is the
one"), and a second visual language for the difference is a distinction nobody
asked for. `check:visual-contract` measures both so they cannot drift apart
quietly — nothing puts the two stories side by side, so a screenshot never
would.

The selected fill is `--ds-color-surface-selected`, the brand tint every
selected surface wears (C2) — not the info status tint, because being chosen is
not a status. `ChoiceGroup appearance="card"` draws a chosen option the same
way, so a role picked in a form and a record picked in a list read as one
answer. In forced colours the border is `Highlight`.

The selected weight is an **inset ring**, not a thicker border. A 2px border on
selection and 1px otherwise moves the content by a pixel every time the choice
moves, and in a virtualised list that is a visible twitch. Borrowed from
`SegmentedControl.css`, which records the same reasoning for its options.

## The container sets the width

A card fills the box it is given — three of the four consumers are full-width
rows, and the fourth is a 96px page rail whose own list is the narrow thing. So
`width: 100%` is the base rule, and a `w-24` written on the card itself is
silently ignored: both are one class, and the component stylesheet wins.

That is not a trap to work around from a call site. Constrain the container, the
way `PageThumbnailRail` constrains its `<ul>`. The catalog's `CurrentOfASet`
story does the same, after the first version of it tried the other way and the
committed screenshot showed four full-width cards where four thumbnails were
meant to be.

## `frame="row"`: the rows of one card

A grouped list of ways in — the C2 settings menu: one card per group, a line
between rows, every row still a button — is the rows of ONE box, not a stack of
boxes. The card draws the box and the list draws the dividers:

```jsx
<Card as="div" padding="none" elevation="soft">
  <ul className="divide-y divide-ds-border-subtle">
    {items.map((item) => (
      <li key={item.id}>
        <SelectableCard frame="row" onSelect={() => open(item.id)}>…</SelectableCard>
      </li>
    ))}
  </ul>
</Card>
```

A row has **no border and no radius** of its own and shows the card's surface.
Hover fills it (`surface-hover`) — there is no edge to colour — and the focus
ring is **inset** (`outline-offset: -2px`), so neither a neighbouring row nor
the card's edge covers it. The first and last row of the list round their outer
corners to the card's inner radius (`--ds-card-radius` less the card's 1px
border), so the fill and the ring follow the card's corner instead of poking
through it; that is why a row is a list item's only child. Selected or current:
the tint and a 2px inset navy ring (the card's 1px border plus 1px ring, as one
line); in forced colours a `Highlight` outline. `tone` and `surface="inverse"`
only colour or swap the box a row does not have, so both throw with it.

This is the supported way to get a borderless row — not a class that overrides
the card's border or radius from a call site (the rule above still holds).

## `as="div"` is the non-interactive twin, and it refuses state

`VirtualLeadList` deliberately renders already-messaged rows as non-controls —
its own comment says "only the toggleable rows become buttons". Those rows need
the same box and no button semantics. `as="div"` refuses `selected`, `current`
and `onSelect` rather than accepting one and rendering something that looks
clickable and is not.

## `tone` colours the border and nothing else

Deliberately not a fill. The one consumer that needs it is saying something about
the *record* ("already contacted"), not about the selection, and a tinted fill
would compete with the selected state sitting right beside it. Inventing a fill
treatment no call site asks for is how a primitive grows options nobody can
explain later.

On the inverse surface each tone resolves to its `-fg-on-inverse` role, which is
the pair those tokens exist for: the light-surface border colours are close to
invisible on slate-900.

## What it is not

- **not `Card`** — a plain surface with no interactivity and no state.
- **not `MetricCard`** — a fixed label/value/icon dashboard tile.
- **not `SegmentedControl`** — that takes a string `label`, so it can express
  none of these rows, the FMCSA rows included.
- **not `SectionNavigation`** — a navigation rail, not an item in a list.

## The guard

`ds/use-primitive` refuses a raw `<button>` carrying `aria-current` outside the
design system's own source, and does the same for `aria-pressed`.

Both are scoped to real controls. Three non-interactive `aria-current` sites in
the tree — a `<li>` step indicator, a `<span>` step chip — are correct markup for
a progress display that has **no primitive behind it yet**; that gap is recorded
in the roadmap's §5 table rather than demanded by a rule.
