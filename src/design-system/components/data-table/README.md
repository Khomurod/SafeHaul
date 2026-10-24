# DataTable

`DataTable` is SafeHaul's approved business-neutral primitive for record lists
that need consistent columns, selection, pagination, and async states. Feature
modules still own the records, labels, filters, the sort order, actions,
permissions, formatting callbacks, and data loading.

## Column contract

Create columns with `defineTableColumns`. A column supports:

| Field | Values / responsibility |
|---|---|
| `key` | Unique stable string |
| `header` | Visible header content owned by the feature |
| `headerLabel` | Accessible label when the visible header is intentionally empty |
| `render(row)` | Feature-owned content and value formatting |
| `align` | `start` (default) for text or `end` for numbers, applied to both header and cells. Nothing is centred: a centred column has no edge to scan |
| `width` | `auto`, `xs`, `sm`, `md`, `lg`, `xl`, or `actions` |
| `rowHeader` | Uses `<th scope="row">` for the primary identifying cell |
| `truncate` | Applies the approved single-line truncation behavior |
| `stopPropagation` | Keeps a nested cell action from also activating its row |
| `mobileLabel` | The label beside the value when the table is cards on a phone; `''` shows none |
| `sortable` | `true`, or `{ first, labels }`: the column sorts by pressing its header. See [Sorting](#sorting) |

Do not add header-only or cell-only alignment classes. Add a reusable width or
alignment option to this contract when a genuine missing case is found.

## Sorting

The table draws the sort control; the feature owns the order. Pass `sort`
(`{ key, direction }`, `direction` is `asc` or `desc`) and
`onSortChange({ key, direction })`, and hand the table its rows already in that
order, whether the order comes from a query or from the page.

- A sortable header is one `<button>` named by the header text, with one arrow,
  inside a `<th>` that carries `aria-sort` while its column is the sorted one.
  The header text must be a string: it names the button and the phone's options.
- One column is sorted at a time and the list always has an order, so a header
  has two states, never "unsorted". Pressing the sorted header turns it;
  pressing another sorts by it in its `first` direction (`asc` unless set; a
  date column usually starts `desc`, newest first).
- Only the sorted column shows its arrow. Another sortable header shows the
  direction a press would ask for on hover or focus. The arrow keeps its space
  while hidden, so a sortable header needs about 16px more than its text (see
  the header widths below). In an `end` column the arrow leads.
- Pressing a header never activates a row.
- With `mobilePresentation="cards"`, while the cards are on screen the header row
  is hidden, so a **Sort by** list sits above the cards: every sortable column in
  both directions, worded by `labels` (`{ asc: 'Oldest first', desc: 'Newest
  first' }`; `Ascending` / `Descending` by default).
- The table refuses (`contractViolation`) a sortable column without
  `onSortChange`, a sortable column whose header is not text, a `sort.key` that
  is not a sortable column, and a direction other than `asc` or `desc`.

Do not draw sort arrows inside a header yourself.

## Native table and interaction policy

- Use native table markup for reading and comparing records.
- Do not add ARIA grid roles unless spreadsheet-style cell navigation is a
  documented product requirement.
- Interactive rows retain native table semantics and support mouse, Enter, and
  Space activation.
- Nested buttons and links remain independent tab stops and must have accessible
  names.
- Selection uses native checkboxes. The header checkbox reflects checked,
  unchecked, and mixed states for the currently visible page.
- A caption labels the table; the scroll region and pagination navigation also
  have accessible names.

## Layout and responsive policy

The component owns header height, row height, horizontal padding, density,
column widths, sticky headers, alignment, focus treatment, and pagination
targets through design-system tokens and component CSS.

`minWidth` is the narrowest the table gets before its region scrolls sideways:
`wide` (920px, the default), `standard` (760px), or `none` for a small table
whose columns squeeze to fit their container. Any other value is a contract
violation.

Use `embedded` when a parent `Card` owns the surrounding border, radius, and
elevation. The table retains its column, density, state, and interaction
contracts without creating a second nested surface.

Features may provide `mobileHint` when the default mention of columns and
actions does not describe the table. The hint must explain the retained
horizontal-overflow interaction without domain logic entering the component.

The candidate lists (Applications, Company Leads, My Leads) are cards on a
phone: a recruiter works one driver at a time there, and every column still
shows, under its label. Company Leads for an admin keeps `scroll`, because its
checkboxes assign leads in bulk and cards take no selection.

### Tables on phones: the rule

The standard applied is Nielsen Norman Group's guidance for
mobile tables (Amy Schade, *Mobile Tables: Comparisons and Other Data Tables*,
2017): when a table must scroll sideways, *"the leftmost column … should be
locked in place, so users can see the necessary labels at all times"*, sticky
column headers *"help users know what they are looking at"*, and the cut-off
columns themselves are the signal that there is more.

- **A table whose rows are compared keeps the table.** A labelled,
  keyboard-focusable horizontal-scroll region, a sticky header, and the first
  column pinned. `DataTable` does all three by default — at `standard` or `wide`
  it is wider than a phone, so it scrolls there — and `pinFirstColumn={false}`
  opts out for a table whose first column does not identify the row. With a
  selection, the checkbox column and the identifying column pin together. A
  native table opts in with `data-pin-first-column` on the `<table>`. The pin,
  its surface, hover tint, local stacking order and the 1px seam that appears
  under 768px are one stylesheet, `pinnedColumn.css`, for both contracts; above
  that width a table that fits its card looks exactly as it did.
- **A matrix of per-row form controls worked one record at a time becomes one
  card per row under 768px** — `data-mobile-presentation="cards"` on a native
  table (`nativeTable.css`). Every `<td data-label="…">` shows its value under
  the label of its column, in column order, nothing hidden; the caller states
  the table roles explicitly because `display: block` can drop them. The SMS
  recruiter-assignment matrix is the first: a `<select>` and its verify action
  400px apart in a sideways-scrolling form was the worst case for a thumb, and
  nothing in that matrix is read across rows.
- **A `DataTable` of records worked one at a time becomes cards the same way**
  — `mobilePresentation="cards"` (`mobileCards.css`). Under 768px each row is a
  card: the row header is its title, and every other cell sits under its
  column's label (its `mobileLabel`, else its text `header`, else its
  `headerLabel`); `mobileLabel: ''` shows none, so an actions cell takes the
  card's width. The table states its roles itself and takes no `selection`; a
  card pins nothing. At 768px and up it is the table it always was: its first
  column pinned, its region named as one that scrolls (`useCardsLayout`). The
  unfinished-applications list is the first; the `CardsOnMobile` story is the
  shape to copy.

`check:visual-contract` measures the pinned cell (`position`, `left`,
`z-index`, background) and the card shape at 412px and 1440px;
`check:table-layout` measures both stories for cell overflow; the catalog
baselines hold the pictures (`pattern-native-table-sticky`,
`pattern-native-table-cards`, every `data-table-*-mobile`).

The feature toolbar remains outside `DataTable`. This prevents the design
system from learning feature-specific filters, bulk operations, permissions,
or domain vocabulary.

### A column must be able to contain what you put in it

Widths are fixed buckets and the table is `table-layout: fixed`, so a column
does **not** grow to fit. Content too wide for its bucket silently spills over
the next column, or past the edge the table paints to.

`Badge` is `white-space: nowrap`, so a column holding badges cannot be narrower
than the widest badge — that is a hard floor, not a preference. The same applies
to buttons with text labels.

A header is one line too (`white-space: nowrap`), so a header is a floor as well:
twelve-pixel capitals take about 8px a letter. A bucket leaves this much for its
header text once the cell padding is taken (desktop / phone):

| Bucket | Header text fits in |
|---|---|
| `xs` | 48px / 56px — a short word ("Dials") |
| `sm` | 80px / 88px — "Last call", "Actions" |
| `md` | 104px / 112px |
| `lg` | 136px / 144px |
| `xl` | 180px / 188px |

A sortable header's arrow takes about 16px of that, hidden or not.

A header that does not fit shows an ellipsis in production, and fails
`check:table-layout` and `e2e/table-layout.spec.cjs` unless its column declares
`truncate`. When a table's fixed columns add up to less than its width they
stretch to fill it, so a narrow header may fit on a wide screen and not on a
phone: the spec measures both.

Pick the bucket from the widest thing the column will ever hold, not from the
common case, and leave real margin rather than a few pixels. If clipping is what
you actually want, declare `truncate` — that is the supported opt-in, and the
guard below exempts it.

**`width: 'actions'` is not "the width for an actions column".** It is 88px,
sized to fit the word "ACTIONS" in the header at mobile cell padding, which is
about one icon button's worth of room. A cell holding two buttons with text
labels measures roughly 90px and does not fit — pick `sm` or wider for those.
The name is the trap: it describes the column's role, not its capacity.

`Button` pins icon size and sets `flex: 0 0 auto`, so a cell that is too small
reports its overflow instead of quietly distorting its glyphs to fit.

`npm run check:table-layout` measures the built catalog in a real browser and
fails on a cell whose content is wider than its column. It cannot be a unit test:
jsdom has no layout engine, so `scrollWidth` is always `0` there. The same
measurement runs over the application's own table screens in
`e2e/table-layout.spec.cjs` (1440px and 412px), because a feature's real strings
are longer than a pattern's fixtures. A new table screen joins that list. Only
the screens whose fixtures show records (`row`) have their cells measured; the
others (`empty`) are measured on their headers and empty state until their
fixtures gain records.

## Async and feedback states

- Loading keeps column structure visible and exposes a polite status.
- Empty states accept a feature-owned title, description, and optional icon.
- Errors use an alert and retry action. When existing rows are available, the
  error is an inline notice so stale-but-useful data is not discarded.
- Pagination controls are always labelled and take the shared control height
  (`--ds-control-height-md`, 44px), so they match every other control in the
  product rather than being table-specific.

## Verification contract

Every migrated consumer needs:

1. unit coverage for its column and interaction contract;
2. structural axe coverage;
3. desktop header/cell alignment review;
4. Mobile Chrome review for the selected responsive pattern;
5. filtering, sorting, pagination, permissions, bulk actions, and row-action
   regression coverage applicable to that feature;
6. roadmap evidence before the inventory status changes.
