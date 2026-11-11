# List page and `ListToolbar`

A list page shows many records of one kind and lets people narrow them. Every
list page in the product follows the same six rules. The catalog's
`Patterns/List page` stories are the example to copy.

```jsx
<PageHeader title="Records" count={rows.length} countLabel="records" actions={newButton} />
<Stack gap="md">
  <ListToolbar placement="page" segments={…} toggle={…} search={…} filters={…} />
  <DataTable … pagination={{ label: `${total} total`, … }} />
</Stack>
```

A second tier of segments (status pills under a scope), or the tools of a list
whose views are the page's own tabs, go in the top strip of the table card:

```jsx
<ListToolbar placement="page" lead={<TabNav variant="segmented" … />} search={…} filters={…} />
<Card padding="none">
  <ListToolbar segments={{ …, variant: 'pill' }} />
  <DataTable embedded … />
</Card>
```

## The six rules

1. **One heading.** `PageHeader` carries the title and the number of records
   (`count`). There is no second heading above the table and no "Showing X of Y";
   the table's footer says "N total" and which page.
2. **One row of controls.** `ListToolbar placement="page"` sits above the table
   card: a scope that is its own page on the left (`lead`, a `TabNav`), then the
   segments; the search, the switch, Filters and any action on the list's
   records (assigning the selected ones) on the right, ending on the table's
   edge. An action that makes a new record stays in `PageHeader`. Filters open
   one row of fields below it. "Clear filters" is a quiet link, shown only while
   a filter applies.
3. **One row per record.** The table is a `DataTable`, its own card. A cell
   holds one fact, or facts read together, separated by " · " ("Reefer · IL",
   "Role and status"); a merged cell keeps the sort of the fact it sorts by. The
   row's header cell may carry one muted second line where people need it to
   tell records apart (an email under a name). Text starts at the left, numbers
   end at the right, nothing is centred, a header is one line, and nothing is cut
   off: a long value wraps (`components/data-table/README.md`).
4. **Sort from the headers.** A sortable column's header is a button with one
   arrow (`sortable` on the column, `sort` and `onSortChange` on the table).
5. **Calm statuses and names.** One label per status group, a name as the person
   wrote it, and an empty cell said quietly ("Unassigned", "—"), not in italics
   with an icon. The feature owns these words; the standard asks for them.
6. **Cards on a phone.** `mobilePresentation="cards"` with a `mobileRole` on the
   columns: each card is one record — the title, the status in its corner, short
   facts inline, a leading avatar or icon. A list with checkboxes is cards too:
   each card leads with its checkbox under a "Select all" and "Sort by" strip.

## `ListToolbar`

Every part is optional, and the page owns every value: the toolbar draws the
controls and reports what was pressed. A part without its list or its callback
is refused outside a production build; in one it is left out, and an unknown
placement or look takes its default.

| Prop | Shape | Draws |
|---|---|---|
| `placement` | `'card'` (default) or `'page'` | Where the row sits: the top strip inside the list's card, or a row of its own above the table card. See [Placement](#placement) |
| `lead` | node | A page-level scope control on the left, before the segments: a `TabNav variant="segmented"` whose items are pages of their own |
| `segments` | `{ ariaLabel, items: [{ id, label, count? }], value, onChange(id), variant? }` | Which part of the list. `count` only where the page already knows it. `variant` is `segmented` (the page row's default: a tray, the chosen one dark), `underline` (the card strip's default) or `pill` (bordered pills, the chosen one on the selected tint, for a second tier) |
| `toggle` | `{ label, checked, onChange(next) }` | A `Switch` with its words beside it (`showLabel`) |
| `search` | `{ label, placeholder?, value, onChange(text) }` | A search box in a `search` landmark |
| `filters` | `{ open, onOpenChange(next), activeCount, onClear(), children }` | The Filters button, and when open, a row of the `children` fields with "Clear filters" |
| `actions` | node | Actions on the list's records, such as assigning the selected ones, last in the row |

### Placement

- **`page`**: no surface. The segments are the segmented tray
  (`components/tabs/segmentedGroup.css`, shared with `TabList` and `TabNav`).
  The tools are, in order, the search (240px to grow, between 236px and 320px),
  the switch in a bordered box of the control height, Filters, then the
  actions, ending on the table's right edge. When they do not fit beside the
  scope and segments they take a row of their own, starting at the left with
  the search growing — never a group hanging at the right under the segments.
  That is measured on the row itself (`useToolsWrap`, a `ResizeObserver`, which
  sets `data-wrapped`), not guessed from the window width, so a list beside a
  collapsed sidebar keeps one row. Until it is set the row never wraps on its
  own: the search gives way down to its 236px first, the width the measurement
  counts. The open filters are a surface of their own
  under the row. Put 16px between the row and the table card (`Stack gap="md"`).
- **`card`**: the top strip of the list's `Card padding="none"`, at least 64px,
  above a `DataTable embedded`. With segments it keeps its long-standing look:
  underlined segments that scroll sideways, then the switch, the search and
  Filters at the strip's end. Without segments the search leads, growing to
  420px, and the switch (boxed) and Filters sit at the strip's end. Pills
  (`segments.variant="pill"`, a second tier under a page-level scope) or a tray
  sit centred in the strip, 16px from its edge, the tray keeping its own border.

### On a phone (767px and below)

Every option stays in view and every target is at least 44px tall. The scope
and the segments come first, wrapping into equal rows (two in halves, three in
thirds, four in a 2 × 2 grid, more in rows of three; pills wrap and fill their
rows). Then the tools, row by row in the order they are written: the search
with Filters beside it; or, when a switch follows the search, the search on a
row of its own and the switch beside Filters on the next; then any actions.
Under 384px the search always takes its row alone. A card strip with segments
keeps its switch on a row above the search and Filters.

Tab follows the order the controls are written in (the search, the switch,
Filters on the page row and in a strip without segments; the switch first in a
card strip with segments), and the rows are drawn in that order at every
width: nothing is moved with CSS `order`.

## Accessibility

- **The segments are buttons with `aria-pressed` in a named group,** not tabs:
  they narrow one list rather than switch between panels. The pressed one is
  marked by more than colour: underlined, or filled, and semibold.
- **A scope that is its own page is navigation** (`TabNav` in `lead`): links
  with `aria-current="page"`, each its own Tab stop.
- **Not `role="toolbar"`.** That role moves focus with the arrow keys, which would
  take Left and Right away from the caret in the search. Each control is its own
  Tab stop.
- **The search box has a name** (`search.label`), because it shows no label of its
  own.
- **Every filter field has a real label** (`FormField`). A select labelled by
  nearby text announces as an anonymous combobox.
- **The Filters button says how many apply** ("Filters, 2 applied"). It is how
  a reader learns that the list is not showing everything.
- **An empty result names its cause.** When filters or a search apply, the
  table's empty state says nothing matches and how to see more, not "No records".
- **Clearing the filters leaves focus on the Filters button,** not on a link that
  has just gone away.
- **The count is a `status` region** (`PageHeader`), so a screen reader hears the
  list grow or shrink as the controls change it.

## What the page still owns

Which segments, filters and actions exist, their words and defaults, how a
search matches, and the query behind the list. The toolbar never fetches or
filters records itself.
