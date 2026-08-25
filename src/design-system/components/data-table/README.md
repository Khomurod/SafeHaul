# DataTable

`DataTable` is SafeHaul's approved business-neutral primitive for record lists
that need consistent columns, selection, pagination, and async states. Feature
modules still own the records, labels, filters, sorting decisions, actions,
permissions, formatting callbacks, and data loading.

## Column contract

Create columns with `defineTableColumns`. A column supports:

| Field | Values / responsibility |
|---|---|
| `key` | Unique stable string |
| `header` | Visible header content owned by the feature |
| `headerLabel` | Accessible label when the visible header is intentionally empty |
| `render(row)` | Feature-owned content and value formatting |
| `align` | `start`, `center`, or `end`; applied to both header and cells |
| `width` | `auto`, `xs`, `sm`, `md`, `lg`, `xl`, or `actions` |
| `priority` | `primary`, `secondary`, `tertiary`, or `actions` |
| `rowHeader` | Uses `<th scope="row">` for the primary identifying cell |
| `truncate` | Applies the approved single-line truncation behavior |
| `stopPropagation` | Keeps a nested cell action from also activating its row |

Do not add header-only or cell-only alignment classes. Add a reusable width or
alignment option to this contract when a genuine missing case is found.

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

Use `embedded` when a parent `Card` owns the surrounding border, radius, and
elevation. The table retains its column, density, state, and interaction
contracts without creating a second nested surface.

Features may provide `mobileHint` when the default mention of columns and
actions does not describe the table. The hint must explain the retained
horizontal-overflow interaction without domain logic entering the component.

For the Company candidate-list pilot, the mobile presentation is `scroll`.
Candidate records are a comparison surface with meaningful status, date,
assignment, and action columns; hiding those columns or converting them to
cards would remove context. The focused, labelled scroll region preserves the
native table and all actions, and a mobile-only hint explains the gesture.
Other tables must make and document their own use-case decision before
migration.

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

Pick the bucket from the widest thing the column will ever hold, not from the
common case, and leave real margin rather than a few pixels. If clipping is what
you actually want, declare `truncate` — that is the supported opt-in, and the
guard below exempts it.

**`width: 'actions'` is not "the width for an actions column".** It is 88px,
sized to fit the word "ACTIONS" in the header at mobile cell padding, which is
about one icon button's worth of room. A cell holding two buttons with text
labels measures roughly 90px and does not fit — pick `sm` or wider for those.
The name is the trap: it describes the column's role, not its capacity.

Until 2026-08-21 that overflow was invisible, because an icon inside a button
could be squeezed by a pixel or two to make the content fit. `Button` now pins
icon size and sets `flex: 0 0 auto`, so a cell that is too small reports it
instead of quietly distorting its glyphs.

`npm run check:table-layout` measures the built catalog in a real browser and
fails on a cell whose content is wider than its column. It cannot be a unit test:
jsdom has no layout engine, so `scrollWidth` is always `0` there. It covers
catalog patterns, so a feature whose real strings are longer than the pattern's
fixtures still needs measuring on its own screen.

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
