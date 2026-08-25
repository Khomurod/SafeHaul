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

## A state with no way forward is a wall

Every state needs an accessible way out: retry, clear filters, or create. The
component does not throw when `actions` is missing, because two cases legitimately
have none — a loading state (there is nothing to do but wait, and
`LoadingState` throws if you pass one) and a permissions boundary the viewer
genuinely cannot resolve. Everything else without an action is an oversight.

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
