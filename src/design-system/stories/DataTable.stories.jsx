import React from 'react';
import { fn } from 'storybook/test';
import { Eye, Inbox } from 'lucide-react';
import { Badge, DataTable, IconButton } from '@design-system/components';
import { NOT_PROVIDED, RECORDS } from './fixtures';

/** Reference column set reused across the stories below. */
const columns = [
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    priority: 'primary',
    width: 'lg',
    truncate: true,
    render: (row) => (
      <div>
        <strong>{row.title}</strong>
        <div style={{ color: 'var(--ds-color-content-muted)', fontSize: 'var(--ds-font-size-sm)' }}>
          {row.reference}
        </div>
      </div>
    ),
  },
  {
    key: 'owner',
    header: 'Owner',
    width: 'md',
    truncate: true,
    render: (row) => row.owner ?? <span style={{ color: 'var(--ds-color-content-muted)' }}>{NOT_PROVIDED}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 'sm',
    render: (row) => <Badge tone={row.tone}>{row.status}</Badge>,
  },
  {
    key: 'items',
    header: 'Items',
    align: 'end',
    width: 'xs',
    render: (row) => row.items.toLocaleString('en-US'),
  },
  {
    key: 'updated',
    header: 'Updated',
    width: 'sm',
    priority: 'tertiary',
    render: (row) => row.updated,
  },
  {
    key: 'actions',
    header: '',
    headerLabel: 'Actions',
    align: 'end',
    width: 'actions',
    priority: 'actions',
    stopPropagation: true,
    render: (row) => (
      <IconButton size="sm" variant="ghost" label={`View ${row.reference}`} onClick={fn()}>
        <Eye size={16} aria-hidden="true" />
      </IconButton>
    ),
  },
];

/**
 * `DataTable` is the approved tabular primitive. It owns the column contract,
 * every table state, selection mechanics, keyboard row activation and
 * responsive scrolling.
 */
const meta = {
  title: 'Components/DataTable',
  component: DataTable,
  args: {
    ariaLabel: 'Records',
    data: RECORDS,
    columns,
    density: 'comfortable',
    minWidth: 'wide',
  },
  argTypes: {
    density: { control: 'inline-radio', options: ['comfortable', 'compact'] },
    minWidth: { control: 'inline-radio', options: ['standard', 'wide'] },
    isLoading: { control: 'boolean' },
    embedded: { control: 'boolean' },
    data: { control: false },
    columns: { control: false },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** `DataTable` is the furthest-migrated primitive in the',
          'system: the Company candidate list and workspace consume it, and the column',
          'contract is enforced at runtime by `defineTableColumns`.',
          '',
          '**Needs review:** the roadmap\'s *blocking visual regression* item is still open,',
          'so table density and alignment changes are reviewed by eye today. Treat any',
          'change to column widths or density as needing screenshots at all three widths.',
          '',
          '### Intended use',
          '',
          'A list of records with more than one attribute worth comparing. If each row is a',
          'rich object rather than a set of comparable fields, use `Card`s.',
          '',
          '### The column contract',
          '',
          'Alignment and width live on the column, not split between header and cell, so the',
          'two cannot drift apart. `defineTableColumns` **throws** on a duplicate key, a',
          'missing `render`, or an unsupported alignment/width/priority — a broken column',
          'fails immediately instead of rendering a subtly misaligned table.',
          '',
          '| Field | Values |',
          '| --- | --- |',
          '| `align` | `start` (default), `center`, `end` |',
          '| `width` | `auto`, `xs`, `sm`, `md`, `lg`, `xl`, `actions` |',
          '| `priority` | `primary`, `secondary`, `tertiary`, `actions` |',
          '| `rowHeader` | renders `<th scope="row">` — set it on the identifying column |',
          '| `truncate` | allows the cell to ellipsise instead of wrapping |',
          '| `stopPropagation` | stops a cell\'s clicks from activating the row |',
          '',
          'Numeric columns should be `align: "end"`. An action column must be',
          '`width: "actions"`, `align: "end"`, `priority: "actions"` and',
          '`stopPropagation: true`.',
          '',
          '### Accessibility expectations',
          '',
          '- `ariaLabel` is required: it names the table and its scroll region, and becomes',
          '  the `<caption>`.',
          '- Exactly one column should be the `rowHeader`, so each row is announced by what',
          '  it *is* before its attributes.',
          '- With `onRowActivate`, rows become focusable and respond to Enter and Space. Any',
          '  control inside a row needs `stopPropagation` on its column, or clicking it also',
          '  activates the row.',
          '- The scroll region is keyboard-focusable, so a horizontally scrolling table can',
          '  actually be scrolled without a mouse.',
          '- Loading and empty states are polite live regions; the error state is a',
          '  `role="alert"`.',
          '- A header with no visible text still needs `headerLabel` (as the actions column',
          '  above does), which renders a screen-reader-only header.',
          '',
          '### Common mistakes',
          '',
          '- Starting an action column at `width: "auto"`, which lets one long label stretch',
          '  the column and unbalance every row.',
          '- Left-aligning numbers, so digits cannot be compared down the column.',
          '- Leaving a cell blank when data is missing. Render a real placeholder —',
          '  an empty cell reads as a bug.',
          '- Row click as the *only* way to open a record; it is undiscoverable. Keep a',
          '  visible action too.',
          '- Putting more than one horizontal quick action in a compact row.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the data, the column labels, the cell content, sorting and pagination',
          'callbacks, and which actions a user may take. They must not restyle the table,',
          'introduce their own row heights, or hand-roll a `<table>`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default comfortable table with a mixed, realistic column set. */
export const Default = {};

/**
 * `density="compact"` is for long lists where more rows on screen matters more
 * than breathing room. Alignment and the action column are unchanged.
 */
export const Compact = {
  args: { density: 'compact' },
};

/** Rows become activatable. The action column stops its clicks from bubbling. */
export const InteractiveRows = {
  args: {
    onRowActivate: fn(),
    getRowLabel: (row) => `Open ${row.title}`,
    getRowTone: (row) => row.tone,
  },
};

/** Multi-row selection, including the indeterminate select-all state. */
export const WithSelection = {
  args: {
    selection: {
      selectedIds: ['rec-001', 'rec-003'],
      selectAllLabel: 'Select all records on this page',
      getRowLabel: (row) => `Select ${row.title}`,
      onToggleRow: fn(),
      onToggleAll: fn(),
    },
  },
};

/** Pagination. The page indicator is a polite live region. */
export const WithPagination = {
  args: {
    pagination: {
      label: 'Showing 1–6 of 128 records',
      currentPage: 1,
      totalPages: 22,
      hasPrev: false,
      hasNext: true,
      onPrev: fn(),
      onNext: fn(),
    },
  },
};

/**
 * Loading. Skeleton rows preserve the column geometry so the layout does not
 * jump when data arrives, and the announcement is made once, politely.
 *
 * The skeleton pulse is a pure CSS animation and is disabled under
 * `prefers-reduced-motion`. No story output depends on a timer.
 */
export const Loading = {
  args: { isLoading: true, data: [] },
};

/** Empty. A title, an optional explanation and a relevant icon. */
export const Empty = {
  args: {
    data: [],
    empty: {
      title: 'No records match these filters.',
      description: 'Clear one or more filters to see more results.',
      icon: Inbox,
    },
  },
};

/** Error with no data: the whole table body becomes the error state. */
export const ErrorState = {
  args: {
    data: [],
    error: { message: 'The record list could not be loaded.', onRetry: fn() },
  },
};

/**
 * Error *with* data already on screen. The stale rows are kept and the failure
 * is reported above them — throwing away visible data on a refresh failure is
 * worse than showing it with a warning.
 */
export const ErrorWithStaleData = {
  args: {
    error: { message: 'Could not refresh. Showing the last loaded results.', onRetry: fn() },
  },
};

/**
 * Long and short content together. Row 1 has a two-character title, row 2 a
 * title long enough to truncate, and rows 3 and 5 are missing their secondary
 * values — the three cases that break table alignment in practice.
 */
export const LongAndMissingContent = {
  args: { density: 'compact' },
  parameters: {
    docs: {
      description: {
        story:
          'Check that the truncated title still shows its reference underneath, that the '
          + '"Not provided" placeholders are visibly de-emphasised rather than blank, and '
          + 'that the numeric column stays right-aligned against a three-digit value.',
      },
    },
  },
};

/** Tablet width — where an action column first starts competing for space. */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  args: { density: 'compact' },
};

/**
 * Mobile. The table scrolls horizontally inside a focusable region, and the
 * swipe hint appears only at this width.
 */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  args: { density: 'compact' },
};
