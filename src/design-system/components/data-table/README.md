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
| `width` | `auto`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, or `actions` |
| `rowHeader` | Uses `<th scope="row">` for the primary identifying cell |
| `leadingAvatar` | On the row header only: its cells start with an `sm` `Avatar` and a 12px gap before the text (a person cell), so a [row detail](#row-details) starts its words under that text |
| `truncate` | Applies the approved single-line truncation behavior |
| `stopPropagation` | Keeps a nested cell action from also activating its row |
| `mobileLabel` | The label beside the value when the table is cards on a phone; `''` shows none. On a card laid out by role, the words before an inline value ("Updated", "Last call:"), and nothing when unset |
| `mobileRole` | Where the value goes on a phone card: `lead`, `title`, `status`, `meta`, `line`, `actions` or `hidden`. See [Cards by role](#cards-by-role) |
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
- Only the sorted column shows its arrow, in the header's own colour: at rest
  the sorted header is no darker than the others, so the arrow alone says
  which column orders the list. Pointed at or focused, a sortable header
  darkens, and another sortable header shows the direction a press would ask
  for. The arrow keeps its space
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
targets through design-system tokens and component CSS: a 44px header on the
table's surface, its labels in sentence case as the feature wrote them (12px,
medium weight, the secondary text colour of `--ds-table-header-fg`); 68px
comfortable rows (56px compact); 16px inline cell padding (`--ds-table-*`).
The header band is 44px whatever a header holds: a sort button or the
"select all" box sits inside that height, with no block padding added to it.

A selected row takes the brand tint (`--ds-table-row-selected-bg`), which is
also a person's disc (`Avatar tone="brand"`); on a selected row the disc gets a
2px ring of the surface, drawn as an outline so forced colours keep it.

A table on its own is the card that holds it: the card radius
(`--ds-card-radius`, 16px) and the soft shadow (`--ds-shadow-soft`), at every
width. A list page puts its toolbar row above that card
(`patterns/list-toolbar/README.md`).

`minWidth` is the narrowest the table gets before its region scrolls sideways:
`wide` (920px, the default), `standard` (760px), or `none` for a small table
whose columns squeeze to fit their container. Any other value is a contract
violation.

`maxHeight` caps a table that shares its space, such as a panel beside other
content: `sm` (256px) or `md` (400px), and its rows scroll under the sticky
header. Without it the table grows with its rows. A parent of bounded height,
such as a `fill` dialog with `scroll="body"`, needs no cap: the table fills it
and scrolls the same way (the `InDialog` story). Any other value is a contract
violation.

Use `embedded` when a parent `Card` owns the surrounding border, radius, and
elevation — a list whose card has a top strip (`ListToolbar placement="card"`)
above the table. The table retains its column, density, state, and interaction
contracts without creating a second nested surface.

Features may provide `mobileHint` when the default mention of columns and
actions does not describe the table. The hint must explain the retained
horizontal-overflow interaction without domain logic entering the component.

The candidate lists (Applications, Company Leads, My Leads) are cards on a
phone: a recruiter works one driver at a time there. Cards take a selection, so
a list with bulk checkboxes can be cards too (see
[Cards with a selection](#cards-with-a-selection)).

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
  selection, the checkbox column and the identifying column pin together. The
  pin, its surface, hover tint, local stacking order and the 1px seam that
  appears under 768px are one stylesheet, `pinnedColumn.css`; above that width
  a table that fits its card looks exactly as it did. A leading avatar or icon
  column (`mobileRole: 'lead'`) does not name the row, so the pin skips it and
  holds the row header after it; the avatar scrolls away under it.
- **A list or matrix of per-row controls worked one record at a time becomes
  one card per row under 768px** — `mobilePresentation="cards"`
  (`mobileCards.css`). The SMS recruiter-assignment matrix is one: a `<select>`
  and its verify action 400px apart in a sideways-scrolling form is the worst
  case for a thumb. Under 768px each row is a card: the row header is its
  title, and every other cell sits under its column's label (its
  `mobileLabel`, else its text `header`, else its `headerLabel`);
  `mobileLabel: ''` shows none, so an actions cell takes the card's width. Once
  the columns state a `mobileRole` the card is laid out by role instead
  ([Cards by role](#cards-by-role)). The table states its roles itself; a card
  pins nothing (`data-pin-first-column` is off while the cards are on screen).
  At 768px and up it is the table it always was: its first column pinned, its
  region named as one that scrolls (`useCardsLayout`). The `CardsOnMobile`
  story is the plain shape; `Components/DataTable phone cards` the one by role.

### Cards by role

A card that lists every column under its label reads as a form, not a record.
When the columns state a `mobileRole`, each card is one record
(`mobileRoles.js`, `roleCards.css`):

| Role | On the card |
|---|---|
| `lead` | The leading avatar or icon (a 32px slot, the text starting after it). At 768px and up the column is only as wide as that slot, the next cell's padding its gap, and the pinned column skips it. One per table, the first column, the row header right after it |
| `title` | The first line. The row header's role, and the only one it may have |
| `status` | The top-right corner. One per table: several statuses go in its one cell, which stacks them one under another |
| `meta` | Inline after the title, wrapping as a line of short facts, each after its `mobileLabel` ("Updated Jul 11"); left out when the cell renders nothing, a blank or "—". The role of any column that states none |
| `line` | A line of its own (an owner with their avatar), after its `mobileLabel` if it has one |
| `actions` | The card's full width; the cell's direct children (pass the buttons, not a wrapper) share it. A record with nothing to do renders nothing there (`null`), and the card leaves the empty cell out, as it does an empty `meta` or `line` |
| `hidden` | Out of sight on the card, but still read under its column header, as an empty `meta` or `line` item is. So a control never goes in a `hidden` column: it would take focus unseen. A control on a card goes in `actions` |

A role card never takes a label from the header: "Reefer · IL" needs no
"Freight · State" before it. A table whose columns state no role keeps the
label-and-value card, so a list that has not opted in does not move. The
column contract refuses an unknown role, a row header with any role but
`title`, `title` on another column, a second `lead` or `status`, and a `lead`
that is not the first column with the row header (if any) right after it;
`DataTable` refuses a role on a table that never draws cards.

`mobileStatus="below"` moves the `status` cell from the corner to a line of
its own under the title on a phone narrower than 412px, where the corner would
squeeze a title that holds a name and a number; every card then keeps one
shape. From 412px it is the corner again. The default, `corner`, keeps the
corner at every width. `below` with no `status` column, or any other value, is
a contract violation.

A cell the card leaves out (`hidden`, an empty item) is clipped out of sight
rather than removed: the header row, hidden too, keeps every column, so each
cell stays under its own header for assistive technology.

### Cards with a selection

On a phone the header row is hidden, so its checkbox moves to a strip above
the cards: "Select all" (visible words; the checkbox keeps the header's
accessible name, `selection.selectAllLabel`, which contains them) beside the
"Sort by" list. Each card leads with its own checkbox — a 24px slot with 44px
to press, which never activates the row. The strip is drawn only while the
cards are on screen; at 768px and up the checkbox is back in the header row.


`check:visual-contract` measures the pinned cell (`position`, `left`,
`z-index`, background) and the card shape at 412px and 1440px;
`check:table-layout` measures both stories for cell overflow; the catalog
baselines hold the pictures (`data-table-cards`, every `data-table-*-mobile`).

### Keeping the checkbox column's place

`reserveSelection` draws the checkbox column's width on a table without a
selection: an empty cell in the header and in every row, hidden from assistive
technology (`aria-hidden`), with nothing to press or read. A list whose sibling
lists have checkboxes passes it so its columns stand where theirs do and
nothing moves between them (Leads → Assigned to me beside All and Unassigned,
for a company admin). It pins as the checkbox column does, and a card leaves
it out. With a `selection` it is ignored.

### Row details

`getRowDetail(row)` returns `{ tone, content }`, or `null` for none: a sentence
about the record that belongs to none of its columns (what is wrong with a team
member, say). `tone` is a row tone, `neutral` (the default), `warning` or
`danger`, on that tone's tint; `warning` and `danger` lead with the glyph
`Notice` uses for the tone, so the tone is never colour alone. Content that is
empty (`null`, a blank, "—") is no detail.

- In a table the detail is a row of its own right under its record: one cell
  across every column, no divider between the record and its detail (the
  divider runs under the detail), its glyph and words starting where the row
  header's text starts — after the checkbox column (or its reserved place), a
  `lead` column, and the row header's own avatar (`leadingAvatar`). A row
  header that is not the first column is not lined up with.
- On a card by role it is a line of the card, after the `line` items and before
  the actions: a tinted block across the card's text column. A label-and-value
  card ends with it.
- The row's header cell (and a row that takes focus) points at it with
  `aria-describedby`: it describes the record and is never part of the row's
  name. It stays readable where it is, as a cell, so reading the table in order
  meets it too.

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
a twelve-pixel sentence-case label at medium weight takes about 7px a letter. A
bucket leaves this much for its header text once the 16px cell padding is taken
(the same at every width):

| Bucket | Header text fits in |
|---|---|
| `xs` | 56px — a short word ("Dials") |
| `sm` | 88px — "Last call", "Actions" |
| `md` | 112px |
| `lg` | 144px |
| `xl` | 188px |
| `2xl` | 224px — a role beside its status badge |

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
sized to fit the word "Actions" in the header with the cell padding, which is
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
- Empty states accept a feature-owned title, description, optional icon, and an
  optional `action` (`{ label, onClick }`), drawn as one secondary button for
  the one thing to do next, such as adding the first record.
- Errors use an alert and retry action. The title is the feature's `title`
  ("Unable to load applications"), else "Unable to load records". When existing
  rows are available, the error is an inline notice so stale-but-useful data is
  not discarded.
- An empty list, or a failed load with no rows, sits under the header row and
  outside the scroll region, so it is as wide as the card rather than the
  table: on a phone, where a `scroll` table is wider than the screen, the
  message and its button stay in view instead of centring across columns
  scrolled out of sight. With `mobilePresentation="cards"` it stays a row of
  the table, which is already the screen's width there.
- The footer sits on the table's surface: the feature's label on the left —
  "N total" on a list page, the pager saying which page — and Previous, "Page X
  of Y" and Next on the right, its text lined up with the first column. On a
  phone it stays one row, at least 68px tall around the 44px pager, unless a
  "Rows per page" list needs a row of its own.
- Pagination controls are always labelled and take the shared control height
  (`--ds-control-height-md`, 44px), so they match every other control in the
  product rather than being table-specific. A feature that lets the reader pick
  the page length passes `pageSize`, `pageSizes` (such as `[20, 50, 100]`) and
  `onPageSizeChange(size)`, and the bar shows a labelled "Rows per page" list.
  `pageSizes` that is not a list of whole numbers above 0, `pageSizes` without the callback, or a
  `pageSize` not in the list is a contract violation, and a production build
  leaves the list out and keeps Previous and Next.
- A row's actions are always visible. There is no hover-only reveal: it hides
  the actions from touch and from a reader who has not found them yet.

## Verification contract

Every migrated consumer needs:

1. unit coverage for its column and interaction contract;
2. structural axe coverage;
3. desktop header/cell alignment review;
4. Mobile Chrome review for the selected responsive pattern;
5. filtering, sorting, pagination, permissions, bulk actions, and row-action
   regression coverage applicable to that feature;
6. roadmap evidence before the inventory status changes.
