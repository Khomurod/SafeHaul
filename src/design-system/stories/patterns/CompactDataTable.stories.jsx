import React from 'react';
import { fn } from 'storybook/test';
import { Eye } from 'lucide-react';
import { Badge, Button, DataTable, IconButton } from '@design-system/components';
import { PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { NOT_PROVIDED, RECORDS } from '../fixtures';

/** A missing secondary value renders a real, de-emphasised placeholder. */
function Missing() {
  return <span style={{ color: 'var(--ds-color-content-muted)' }}>{NOT_PROVIDED}</span>;
}

/**
 * The reference compact-list column set.
 *
 * The shape is deliberate and is the point of this pattern:
 *
 * - `title` is the `rowHeader` at `width: 'lg'` with `truncate`, so it takes the
 *   slack and a long title ellipsises instead of stretching every other column.
 * - Secondary text lives *under* the title rather than in its own column, which
 *   keeps the row count of columns low enough to survive tablet width.
 * - `items` is `align: 'end'` so digits line up down the column.
 * - `actions` is pinned: `width: 'actions'`, `align: 'end'`, `priority: 'actions'`
 *   and `stopPropagation`, so it can never be stretched by its content and its
 *   clicks never activate the row.
 */
const compactColumns = [
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    priority: 'primary',
    width: 'lg',
    truncate: true,
    render: (row) => (
      <div style={{ minWidth: 0 }}>
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
    render: (row) => row.owner ?? <Missing />,
  },
  {
    key: 'region',
    header: 'Region',
    width: 'sm',
    priority: 'tertiary',
    render: (row) => row.region ?? <Missing />,
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
    key: 'actions',
    // No visible header text, but the column is still named for screen readers.
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

function CompactListPage({ density = 'compact', ...tableProps }) {
  return (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            description="A compact list sized so more rows fit on screen without losing alignment."
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />
          <DataTable
            ariaLabel="Records"
            data={RECORDS}
            columns={compactColumns}
            density={density}
            minWidth="wide"
            getRowLabel={(row) => `${row.title}, ${row.status}`}
            pagination={{
              label: 'Showing 1–6 of 128 records',
              currentPage: 1,
              totalPages: 22,
              hasPrev: false,
              hasNext: true,
              onPrev: fn(),
              onNext: fn(),
            }}
            {...tableProps}
          />
        </Stack>
      </PageContainer>
    </div>
  );
}

/**
 * The compact record list — the densest approved table composition, and the one
 * where column sizing mistakes show up first.
 */
const meta = {
  title: 'Patterns/Compact data table',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved composition, with visual regression Needs review.** Every part',
          'is an approved primitive used as intended. What is *not* settled is automated',
          'verification: the roadmap\'s blocking visual-screenshot item is still open, so',
          'density and alignment are reviewed by eye. Any change to these column widths needs',
          'screenshots at 1440, 1024 and 412px.',
          '',
          '### What this pattern demonstrates',
          '',
          'The fixture rows are chosen to break naive tables:',
          '',
          '- **A two-character title** (row 1) and **a title long enough to truncate**',
          '  (row 2), so left-edge alignment can be judged against both extremes.',
          '- **Missing secondary information** (rows 3 and 5 have no owner or region), which',
          '  renders a visible "Not provided" placeholder rather than a blank cell.',
          '- **Every status tone**, so no badge colour goes unreviewed.',
          '- **Exactly one horizontal quick action** per row, in a pinned action column.',
          '- **Balanced alignment**: identity and text start-aligned on the left, the numeric',
          '  column and the action column end-aligned on the right.',
          '- **Compact rows**, with the same column contract as the comfortable density.',
          '',
          '### Sizing the action column',
          '',
          'This is the part that goes wrong most often. An action column must be:',
          '',
          '```js',
          '{',
          '  key: \'actions\',',
          '  header: \'\',',
          '  headerLabel: \'Actions\',   // named for screen readers, invisible on screen',
          '  align: \'end\',            // pinned to the right edge',
          '  width: \'actions\',        // fixed — never `auto`',
          '  priority: \'actions\',',
          '  stopPropagation: true,   // its clicks must not activate the row',
          '  render: (row) => …,',
          '}',
          '```',
          '',
          'With `width: "auto"` the column grows to fit its widest content, so one long action',
          'label drags every row\'s right edge out of alignment. With `align: "start"` the',
          'actions float in the middle of the row and stop reading as a column at all.',
          '',
          '### One quick action, not three',
          '',
          'A compact row has space for **one** horizontal quick action. Past that the icons',
          'crowd, the touch targets merge, and no icon is distinguishable at a glance. If a',
          'row genuinely needs more, the second action belongs on the detail page — there is',
          'no approved overflow-menu primitive yet, so do not hand-roll one here.',
          '',
          '### Accessibility expectations',
          '',
          '- `ariaLabel` names the table, its scroll region and its caption.',
          '- The title column is the `rowHeader`, so each row announces what it is first.',
          '- The action column has no visible header but still carries `headerLabel`.',
          '- Each action names its row (`View REC-000103`), so a list of buttons is not six',
          '  identical "View"s.',
          '- Missing data is a real placeholder — an empty cell is announced as nothing and',
          '  reads as a rendering bug.',
          '- On mobile the table scrolls inside a keyboard-focusable region and the swipe hint',
          '  appears.',
          '',
          '### Common mistakes',
          '',
          '- `width: "auto"` on the action column.',
          '- Left-aligning numbers.',
          '- More than one quick action per compact row.',
          '- Blank cells for missing values.',
          '- Making the row clickable with no visible action, so the affordance is invisible.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the columns\' labels, the cell content, the domain-to-tone mapping,',
          'which actions a user may take, and sorting/pagination behaviour. They must not',
          'change densities, row heights or the column contract.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The compact list at desktop width, with pagination. */
export const Default = {
  globals: { viewport: { value: 'safehaulDesktop' } },
  render: () => <CompactListPage />,
};

/**
 * Compact against comfortable, same columns and same data. Only the row height
 * changes — alignment and the action column are identical.
 */
export const DensityComparison = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <div className="sb-specimen">
            <span className="sb-specimen__label">density=&quot;compact&quot;</span>
            <DataTable ariaLabel="Records, compact" data={RECORDS} columns={compactColumns} density="compact" />
          </div>
          <div className="sb-specimen">
            <span className="sb-specimen__label">density=&quot;comfortable&quot;</span>
            <DataTable ariaLabel="Records, comfortable" data={RECORDS} columns={compactColumns} density="comfortable" />
          </div>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * Rows are activatable *and* keep their visible action. Row click alone is
 * undiscoverable; the action column is what tells the user the row opens.
 */
export const InteractiveRows = {
  render: () => (
    <CompactListPage
      onRowActivate={fn()}
      getRowTone={(row) => row.tone}
    />
  ),
};

/** Selection added. The checkbox column is fixed-width and does not disturb alignment. */
export const WithSelection = {
  render: () => (
    <CompactListPage
      selection={{
        selectedIds: ['rec-002', 'rec-005'],
        selectAllLabel: 'Select all records on this page',
        getRowLabel: (row) => `Select ${row.title}`,
        onToggleRow: fn(),
        onToggleAll: fn(),
      }}
    />
  ),
};

/** Desktop — 1440px. The reference width for column balance. */
export const DesktopViewport = {
  globals: { viewport: { value: 'safehaulDesktop' } },
  render: () => <CompactListPage />,
};

/**
 * Tablet — 1024px. The first width where the action column has to hold its
 * ground: check that it stays pinned right and does not collapse into the
 * numeric column.
 */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  render: () => <CompactListPage />,
};

/**
 * Mobile — 412px. The table scrolls horizontally inside its focusable region
 * and the swipe hint appears. Check that the row header stays readable and the
 * action target stays at least 44px.
 */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => <CompactListPage />,
};
