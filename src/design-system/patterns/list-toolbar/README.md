# List page and `ListToolbar`

A list page shows many records of one kind and lets people narrow them. Every
list page in the product follows the same six rules. The catalog's
`Patterns/List page` stories are the example to copy.

```jsx
<PageHeader title="Records" count={rows.length} countLabel="records" actions={newButton} />
<Card padding="none">
  <ListToolbar segments={…} toggle={…} search={…} filters={…} />
  <DataTable embedded … />
</Card>
```

## The six rules

1. **One heading.** `PageHeader` carries the title and the number of records
   (`count`). There is no second heading above the table and no "Showing X of Y";
   the pagination footer gives the detail.
2. **One row of controls.** `ListToolbar` puts the segments on the left, and the
   switch, the search, Filters and any action on the list's records (assigning
   the selected ones) on the right. An action that makes a new record stays in
   `PageHeader`. Filters open one row of fields below it. "Clear filters" is a
   quiet link, shown only while a filter applies.
3. **One row per record, one fact per cell.** The table is a `DataTable
   embedded` in the same `Card padding="none"`. The row's header cell may carry
   one muted second line where people need it to tell records apart (an email
   under a name). Text starts at the left, numbers end at the right, nothing is
   centred, and a header is one line (`components/data-table/README.md`).
4. **Sort from the headers.** A sortable column's header is a button with one
   arrow (`sortable` on the column, `sort` and `onSortChange` on the table).
5. **Calm statuses and names.** One label per status group, a name as the person
   wrote it, and an empty cell said quietly ("Unassigned", "—"), not in italics
   with an icon. The feature owns these words; the standard asks for them.
6. **Cards on a phone.** `mobilePresentation="cards"`, unless the list needs row
   selection; a list with checkboxes stays a table that scrolls.

## `ListToolbar`

Every part is optional, and the page owns every value: the toolbar draws the
controls and reports what was pressed. A part without its list or its callback
is refused outside a production build; in one it is left out.

| Prop | Shape | Draws |
|---|---|---|
| `segments` | `{ ariaLabel, items: [{ id, label, count? }], value, onChange(id) }` | Which part of the list, as underlined segments. `count` only where the page already knows it |
| `toggle` | `{ label, checked, onChange(next) }` | A `Switch` with its words beside it (`showLabel`) |
| `search` | `{ label, placeholder?, value, onChange(text) }` | A search box in a `search` landmark |
| `filters` | `{ open, onOpenChange(next), activeCount, onClear(), children }` | The Filters button, and when open, a row of the `children` fields with "Clear filters" |
| `actions` | node | Actions on the list's records, such as assigning the selected ones, last in the row |

On a phone (639px and below) the segments come first and scroll sideways, then
the switch, then the search with Filters beside it. Tab follows the same order.
Wider, when the tools do not fit beside the segments, as on a tablet, they wrap
under them, and the segments keep their own 48px row.

## Accessibility

- **The segments are buttons with `aria-pressed` in a named group,** not tabs:
  they narrow one list rather than switch between panels. The pressed one is
  underlined as well as coloured.
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
