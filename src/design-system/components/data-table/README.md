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

## Async and feedback states

- Loading keeps column structure visible and exposes a polite status.
- Empty states accept a feature-owned title, description, and optional icon.
- Errors use an alert and retry action. When existing rows are available, the
  error is an inline notice so stale-but-useful data is not discarded.
- Pagination controls are always labelled and use 40px interaction targets.

## Verification contract

Every migrated consumer needs:

1. unit coverage for its column and interaction contract;
2. structural axe coverage;
3. desktop header/cell alignment review;
4. Mobile Chrome review for the selected responsive pattern;
5. filtering, sorting, pagination, permissions, bulk actions, and row-action
   regression coverage applicable to that feature;
6. roadmap evidence before the inventory status changes.
