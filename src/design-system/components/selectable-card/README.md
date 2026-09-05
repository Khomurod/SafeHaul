# SelectableCard

**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions across
four files and closing a gap this roadmap had recorded three times under three
names — Listbox, Combobox, SelectableCard.

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
  none of these rows. The roadmap claimed it covered the FMCSA rows until
  2026-09-04; it never did.
- **not `SectionNavigation`** — a navigation rail, not an item in a list.

## The guard

`check:ui-contract`'s `hand-rolled-current` rule refuses a raw `<button>`
carrying `aria-current` outside the design system's own source, and
`hand-rolled-toggle` (from the chip slice) does the same for `aria-pressed`.

Both are scoped to real controls. Three non-interactive `aria-current` sites in
the tree — a `<li>` step indicator, a `<span>` step chip — are correct markup for
a progress display that has **no primitive behind it yet**; that gap is recorded
in the roadmap's §5 table rather than demanded by a rule.
