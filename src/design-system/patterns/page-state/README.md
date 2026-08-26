# PageState — EmptyState, ErrorState, LoadingState

Loading, empty and error: the three states every data-backed page has, and the
three most often left to chance.

```jsx
import { EmptyState, ErrorState, LoadingState } from '@design-system/patterns';

<EmptyState
  icon={Inbox}
  title="No records match these filters"
  description="Clear one or more filters to see more results."
  actions={<Button variant="secondary" onClick={clearFilters}>Clear all filters</Button>}
/>
```

## Announcement is the part that is not decoration

| State | Role | Why |
|---|---|---|
| `LoadingState` | `status` (polite) | Must not interrupt what the user is reading |
| `EmptyState` | `status` (polite) | Same |
| `ErrorState` | `alert` (assertive) | The user is otherwise waiting for something that is not coming |

Getting this wrong is a real defect in both directions: a polite error is silent
until the user happens to navigate to it, and an assertive empty state
interrupts them to say there is nothing. The three named components choose for
you, which is why they exist alongside the generic `PageState`.

Reach for `PageState` directly only for a state that is none of the three — a
permissions boundary, an expired link, a completed handoff. It derives
`assertive` from a `danger` tone, and takes `announce="off"` for a state
rendered as ordinary page content on navigation rather than appearing in
response to something.

## Empty is not one state

Three situations look identical and must not read identically:

1. **Nothing exists yet** — offer the action that creates the first record.
2. **Nothing matches the current filters** — say so, and offer to clear them.
3. **Nothing is visible to you** — a permissions boundary. Say that plainly.
   "No records" here implies the data does not exist when the caller simply
   cannot see it, which is the worst of the three.

## Which scale of "nothing here" is this?

Three different things are all called an empty state, and only one of them is
this pattern. Getting the scale wrong in either direction is why four panels in
this product were still hand-composed on 2026-08-25 — the pattern looked too
big for some of them, so nobody used it for any of them.

| The slot | Use | Not this |
|---|---|---|
| A page, a dialog body, a tab body, a card's whole content area | **`PageState`** — medallion, heading, optional description, a way forward | A `<p>` with a centred icon above it, which is this pattern rebuilt by hand |
| Inside a table, where the rows would be | The table's own state. `DataTable` takes `empty`/`error` props; a `ds-native-table` renders one `<td colSpan>` row — see the note below | A `PageState` inside a `<td>`: a card inside a table cell |
| One line of copy in a list or scroller that already shows its count | A plain sentence | Nothing to add — a heading and a medallion for "0 of 12 selected" is noise |

The middle row has one rule that is easy to get wrong and was, in three of this
product's native tables: **the live-region role goes on a wrapper inside the
cell, never on the `<td>` itself.** `role="status"` on a cell replaces the cell
role, and a row whose only child is not a cell is a row assistive technology may
drop from the table altogether.

```jsx
<tr>
  <td colSpan={columns.length}>
    <div role="status">No companies found.</div>
  </td>
</tr>
```

`DataTable` and `ModernDriverTable` both already did it this way; the rule is
written down here because two of the others had put the role on the cell and a
third announced nothing at all, so filtering a table down to no rows was silent.

## A state with no way forward is a wall

Every state needs an accessible way out: retry, clear filters, or create. The
component does not throw when `actions` is missing, because two cases legitimately
have none — a loading state (there is nothing to do but wait, and
`LoadingState` throws if you pass one) and a permissions boundary the viewer
genuinely cannot resolve. Everything else without an action is an oversight.

## The three props most often written by hand instead

Each of these became a prop because more than one consumer had already written it
by hand. That is the bar: a capability with one caller belongs at the caller.

| Prop | For | Why it cannot stay at the call site |
|---|---|---|
| `titleId` | A full-page state that is the accessible name of its `<main>` | `role="status"` is not a valid role for `<main>`, so the landmark and the live region have to be different elements — which leaves the landmark with nothing to be named by unless the heading carries an id. The alternative is duplicating the title into an `aria-label`: two copies of one string |
| `children` | A confirmation reference, a checklist of what is still outstanding | `description` renders as a `<p>`, so a bordered panel or a list cannot go inside it |
| `focusOnMount` | A state that **replaces** the control the user just activated | Focus falls to `<body>`, so a keyboard or screen-reader user is never taken to the confirmation they asked for. A polite announcement does not move the reading position. The heading gets `tabIndex="-1"` and the product's focus ring |

## `className` goes on the state, not on the surface

Worth its own heading, because it is the one thing about this pattern that looks
like it works when it does not. `className` is merged onto the **state** element;
every other prop goes to the surface — the `Card` when `surface="card"` (the
default), the state element itself for `bare` and `inverse`.

So with the default surface, a layout class passed here lands *inside* the card:

```jsx
{/* Wrong: narrows the text inside a full-width card. */}
<ErrorState className="max-w-md" title="…" />

{/* Right: the wrapper owns the width, the pattern owns the state. */}
<div className="w-full max-w-md">
  <ErrorState title="…" />
</div>
```

Nine of the fifteen screens migrated on 2026-08-25 were written the first way,
and the rendered result is close enough to correct that only reading the diff
caught it. The wrapper shape is the one `ErrorBoundary` has always used.

```jsx
<main aria-labelledby={headingId} className="…">
  <EmptyState
    icon={Inbox}
    headingLevel={1}
    titleId={headingId}
    focusOnMount
    title="Submission received"
    description="We have your submission and someone will be in touch."
    actions={<Button variant="ghost" onClick={onGoHome}>Go to home</Button>}
  >
    <ReferencePanel reference={reference} />
  </EmptyState>
</main>
```

## The failure mode this pattern exists to prevent is not a raw `<div>`

It is a **hand-composed state**: `Card` + `StatusMedallion` + heading + body +
actions, every ingredient an approved primitive, arranged into the shape these
three components own. No `check:ui-contract` rule can see one — there is nothing
wrong with any of the parts.

Fifteen of them were found in the product on 2026-08-25, several written *after*
this pattern existed. Nine were full-page status screens in the signing room and
the public application, and between them they had two title sizes, two medallion
sizes, icons at 28/32/40/48px and three different gaps under the medallion: five
appearances for one thing. Two more were page-level — a document-load failure and
a permissions boundary. Four were panel-level empties, two of which announced
nothing at all when a filter emptied the list. The guardrail is a review step,
recorded in roadmap §7 — if you are arranging primitives into this shape, use the
pattern.

## Other rules the tests pin

- **The medallion is decorative** (`aria-hidden`), so the heading and body must
  distinguish the states with the colour removed.
- **`headingLevel` matches the surrounding outline.** Default `2`; a state
  inside a section that already owns an `<h2>` needs `3`.
- **`surface="bare"`** when it already sits inside a `Card`. Two nested card
  surfaces is the defect that otherwise produces; the padding lives on the state
  itself, so spacing is identical either way.
- **`surface="inverse"`** when it sits on a dark console surface
  (`--ds-color-surface-inverse`) — a log viewer, a live preview panel.
  It drops the card and recolours the title and description to
  `--ds-color-content-on-inverse` and `--ds-color-content-on-inverse-muted`.
  Without it the title renders in `--ds-color-content`, which is near-black:
  invisible on the panel, and invisible in a code review too. The medallion is
  deliberately *not* inverted — its tinted backgrounds are light, so it reads as
  a light chip, the same as `Badge` on those surfaces.
- **On a phone, actions stack full width.** Two side-by-side buttons at 412px
  get about 170px each, which truncates any real label.
- **The loading medallion's spin stops under `prefers-reduced-motion`.** The
  polite announcement is doing the work regardless.

## Do not replace loaded data with an error

If rows are already on screen and a refresh fails, keep the stale rows and
report the failure above them. Discarding what the user can already read is
strictly worse than showing it with a warning. `DataTable` does this already —
pass it `error` while `data` is non-empty and it renders an inline notice
instead of taking the body.

## What features own

The words, which action is offered, and what retry does. Features must not
invent new state visuals, and must not skip a state because it is "rare".
