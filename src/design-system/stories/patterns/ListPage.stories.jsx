import React, { useMemo, useState } from 'react';
import { fn } from 'storybook/test';
import { Badge, Button, Card, DataTable, FormField, Select, defineTableColumns } from '@design-system/components';
import { PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { ListToolbar } from '@design-system/patterns';
import { NOT_PROVIDED, RECORDS } from '../fixtures';

const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'In review', label: 'In review' },
  { id: 'Pending', label: 'Pending' },
  { id: 'Complete', label: 'Complete' },
  { id: 'Archived', label: 'Archived' },
];

/** Whose records "Only mine" keeps: the person viewing the page. */
const VIEWER = 'A. Okonkwo';

const columns = defineTableColumns([
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    width: 'xl',
    truncate: true,
    render: (row) => row.title,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: 'lg',
    truncate: true,
    render: (row) => row.owner ?? <span style={{ color: 'var(--ds-color-content-muted)' }}>{NOT_PROVIDED}</span>,
  },
  { key: 'status', header: 'Status', width: 'md', render: (row) => <Badge tone={row.tone}>{row.status}</Badge> },
  { key: 'region', header: 'Region', width: 'sm', render: (row) => row.region ?? '—' },
  { key: 'items', header: 'Items', width: 'sm', align: 'end', render: (row) => row.items },
  {
    key: 'updated',
    header: 'Updated',
    width: 'md',
    sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
    render: (row) => row.updated,
  },
]);

/**
 * A whole list page as the standard composes it: the heading with the count,
 * one card holding the toolbar and the table. The story owns every value, as a
 * feature would.
 */
function ListPageExample({ initialOpen = false, initialRegion = '', initialQuery = '' }) {
  const [segment, setSegment] = useState('all');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(initialOpen);
  const [region, setRegion] = useState(initialRegion);
  const [direction, setDirection] = useState('desc');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = RECORDS.filter((row) => (segment === 'all' || row.status === segment)
      && (!mine || row.owner === VIEWER)
      && (!region || row.region === region)
      && (!needle || `${row.title} ${row.reference}`.toLowerCase().includes(needle)));
    // The fixture is newest first.
    return direction === 'desc' ? shown : [...shown].reverse();
  }, [segment, mine, query, region, direction]);

  return (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            count={rows.length}
            countLabel="records"
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />
          <Card padding="none">
            <ListToolbar
              segments={{ ariaLabel: 'Show', items: SEGMENTS, value: segment, onChange: setSegment }}
              toggle={{ label: 'Only mine', checked: mine, onChange: setMine }}
              search={{ label: 'Search records', placeholder: 'Search title or reference', value: query, onChange: setQuery }}
              filters={{
                open,
                onOpenChange: setOpen,
                activeCount: region ? 1 : 0,
                onClear: () => setRegion(''),
                children: (
                  <FormField label="Region">
                    <Select value={region} onChange={(event) => setRegion(event.target.value)}>
                      <option value="">Any region</option>
                      <option value="North">North</option>
                      <option value="South">South</option>
                      <option value="East">East</option>
                      <option value="West">West</option>
                    </Select>
                  </FormField>
                ),
              }}
            />
            <DataTable
              embedded
              ariaLabel="Records"
              columns={columns}
              data={rows}
              density="compact"
              mobilePresentation="cards"
              sort={{ key: 'updated', direction }}
              onSortChange={(next) => setDirection(next.direction)}
              empty={{
                title: 'No records match',
                description: 'Clear the filters or the search to see every record.',
              }}
            />
          </Card>
        </Stack>
      </PageContainer>
    </div>
  );
}

const meta = {
  title: 'Patterns/List page',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** The standard every list page follows. The rules, and why,',
          'are in `src/design-system/patterns/list-toolbar/README.md`.',
          '',
          '### Anatomy',
          '',
          '1. `PageHeader` with the page title and the number of records (`count`). One',
          '   heading: no second heading or "Showing X of Y" above the table.',
          '2. One `Card padding="none"` holding the toolbar and the table.',
          '3. `ListToolbar`: segments, the switch, search, Filters, and the page actions, in',
          '   one row. Filters open one row of fields below it, with a quiet "Clear filters".',
          '4. `DataTable embedded`: one row per record, one fact per cell, sorting from',
          '   its headers. Cards on a phone.',
          '',
          '### Accessibility',
          '',
          '- The segments are buttons with `aria-pressed` in a named group: they narrow one',
          '  list, they do not switch panels.',
          '- The toolbar is not `role="toolbar"`, so the arrow keys stay with the search box.',
          '- The count is a `status` region: a screen reader hears the list grow or shrink.',
          '- Clearing the filters leaves focus on the Filters button.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The list as it opens: every record, newest first. */
export const Default = { render: () => <ListPageExample /> };

/** The filters open, with one applied: the field row and "Clear filters". */
export const FiltersOpen = { render: () => <ListPageExample initialOpen initialRegion="North" /> };

/** Nothing matches: the empty state names the filters and the search as the cause. */
export const NoMatchingResults = {
  render: () => <ListPageExample initialOpen initialRegion="West" initialQuery="ledger" />,
};
