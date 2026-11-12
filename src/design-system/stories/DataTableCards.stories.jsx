import React from 'react';
import { fn } from 'storybook/test';
import { FileText, Icon } from '@design-system/icons';
import { Avatar, Badge, Button, DataTable } from '@design-system/components';
import { NOT_PROVIDED, RECORDS } from './fixtures';

const initialsOf = (name) => name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  .map((word) => word[0]).slice(0, 2).join('').toUpperCase();

/**
 * Columns placed by role on a phone card: a leading icon, the row header as the
 * title, the status in the top-right corner, short facts inline (each after its
 * `mobileLabel`, an empty one left out), the owner on a line of its own, the
 * action across the card, and the reference left off.
 */
const roleColumns = [
  {
    key: 'kind',
    header: '',
    headerLabel: 'Kind',
    mobileRole: 'lead',
    render: () => <Icon icon={FileText} size="lg" />,
  },
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    width: 'xl',
    render: (row) => <strong>{row.title}</strong>,
  },
  { key: 'status', header: 'Status', width: 'sm', mobileRole: 'status', render: (row) => <Badge tone={row.tone}>{row.status}</Badge> },
  { key: 'region', header: 'Region', width: 'sm', mobileRole: 'meta', render: (row) => row.region ?? '—' },
  {
    key: 'updated',
    header: 'Updated',
    width: 'sm',
    mobileRole: 'meta',
    mobileLabel: 'Updated',
    sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
    render: (row) => row.updated,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: 'lg',
    mobileRole: 'line',
    render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--ds-space-2)' }}>
        {row.owner ? <Avatar size="xs" tone="brand">{initialsOf(row.owner)}</Avatar> : <Avatar size="xs" tone="placeholder" />}
        {row.owner ?? NOT_PROVIDED}
      </span>
    ),
  },
  { key: 'reference', header: 'Reference', width: 'md', mobileRole: 'hidden', render: (row) => row.reference },
  {
    key: 'actions',
    header: '',
    headerLabel: 'Actions',
    width: 'sm',
    align: 'end',
    mobileRole: 'actions',
    stopPropagation: true,
    render: (row) => <Button size="sm" variant="secondary" aria-label={`Open ${row.reference}`} onClick={fn()}>Open</Button>,
  },
];

/** The page owns the order and the selection, as a feature does. */
function WorkList(args) {
  const [direction, setDirection] = React.useState('desc');
  const [selected, setSelected] = React.useState(() => new Set(['rec-002']));
  // The fixture is newest first.
  const data = direction === 'desc' ? args.data : [...args.data].reverse();
  return (
    <DataTable
      {...args}
      data={data}
      sort={{ key: 'updated', direction }}
      onSortChange={(next) => {
        args.onSortChange(next);
        setDirection(next.direction);
      }}
      selection={args.withSelection ? {
        selectedIds: selected,
        selectAllLabel: 'Select all records on this page',
        getRowLabel: (row) => `Select ${row.title}`,
        onToggleRow: (id) => setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        }),
        onToggleAll: (all) => setSelected(all ? new Set(args.data.map((row) => row.id)) : new Set()),
      } : undefined}
    />
  );
}

const meta = {
  title: 'Components/DataTable phone cards',
  component: DataTable,
  render: WorkList,
  args: {
    ariaLabel: 'Follow-ups',
    data: RECORDS,
    columns: roleColumns,
    minWidth: 'standard',
    mobilePresentation: 'cards',
    onRowActivate: fn(),
    onSortChange: fn(),
    getRowLabel: (row) => `Open ${row.title}`,
    getRowTone: (row) => (row.tone === 'danger' || row.tone === 'warning' ? row.tone : 'neutral'),
    withSelection: false,
  },
  argTypes: {
    data: { control: false },
    columns: { control: false },
    withSelection: { control: 'boolean' },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** `mobilePresentation="cards"` with a `mobileRole` on the',
          'columns: under 768px each row is one record laid out by role, not a list of',
          'labelled values (`components/data-table/README.md`, "Cards by role").',
          '',
          '| Role | On the card |',
          '| --- | --- |',
          '| `lead` | The leading avatar or icon slot (32px). The first column, the row header after it; at 768px and up narrow, and the pin skips it |',
          '| `title` | The row header, first line. The default for the `rowHeader` column |',
          '| `status` | Top-right; one column per table, its badges one under another |',
          '| `meta` | Inline after the title, after its `mobileLabel`; left out when empty or "—". The default for a column that states no role |',
          '| `line` | A line of its own |',
          '| `actions` | The card\'s full width; the buttons share it |',
          '| `hidden` | Out of sight on the card, still read under its header; never a control |',
          '',
          'With a `selection`, each card leads with its checkbox (a 24px slot, 44px to',
          'press) and a strip above the cards holds "Select all" — the header checkbox,',
          'under the same name — beside "Sort by". A table whose columns state no role',
          'keeps the label-and-value card.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** At 1440px: a table, its leading column only as wide as its icon. */
export const ByRole = {};

/** At 412px: one card per record, laid out by role. */
export const ByRoleMobile = { globals: { viewport: { value: 'safehaulMobile' } } };

/** At 412px with a selection: checkboxes lead the cards, under "Select all" and "Sort by". */
export const WithSelectionMobile = {
  globals: { viewport: { value: 'safehaulMobile' } },
  args: { withSelection: true },
};

/** At 1440px with a selection: the header checkbox stays in the header row. */
export const WithSelection = { args: { withSelection: true } };
