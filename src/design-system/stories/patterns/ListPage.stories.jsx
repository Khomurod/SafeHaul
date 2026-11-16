import React, { useMemo, useState } from 'react';
import { fn } from 'storybook/test';
import { FileText, Icon } from '@design-system/icons';
import {
  Avatar, Badge, Button, Card, DataTable, FormField, Select, TabNav, defineTableColumns,
} from '@design-system/components';
import { PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { ListToolbar } from '@design-system/patterns';
import { RECORDS } from '../fixtures';

const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'In review', label: 'In review' },
  { id: 'Pending', label: 'Pending' },
  { id: 'Complete', label: 'Complete' },
  { id: 'Archived', label: 'Archived' },
];

/** Whose records "Only mine" keeps: the person viewing the page. */
const VIEWER = 'A. Okonkwo';

const initialsOf = (name) => name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  .map((word) => word[0]).slice(0, 2).join('').toUpperCase();

/** The owner beside a disc, or an empty ring holding the place. */
function OwnerCell({ owner }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--ds-space-2)' }}>
      {owner ? <Avatar size="xs" tone="brand">{initialsOf(owner)}</Avatar> : <Avatar size="xs" tone="placeholder" />}
      <span style={owner ? undefined : { color: 'var(--ds-color-content-muted)' }}>{owner ?? 'Unassigned'}</span>
    </span>
  );
}

/**
 * One column set for every list below. On a phone each row is a card laid out
 * by role: the title, the status in the corner, the short facts inline (an
 * empty region left out), the owner on a line of its own.
 */
const BASE_COLUMNS = [
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    width: 'xl',
    render: (row) => (
      <span style={{ display: 'grid', gap: 'var(--ds-space-1)' }}>
        <strong style={{ fontWeight: 'var(--ds-font-weight-semibold)' }}>{row.title}</strong>
        <span style={{ color: 'var(--ds-color-content-muted)' }}>{row.reference}</span>
      </span>
    ),
  },
  { key: 'status', header: 'Status', width: 'md', mobileRole: 'status', render: (row) => <Badge tone={row.tone}>{row.status}</Badge> },
  { key: 'region', header: 'Region', width: 'sm', render: (row) => row.region ?? '—' },
  { key: 'items', header: 'Items', width: 'sm', align: 'end', mobileLabel: 'Items', render: (row) => row.items },
  {
    key: 'updated',
    header: 'Updated',
    width: 'md',
    mobileRole: 'meta',
    mobileLabel: 'Updated',
    sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
    render: (row) => row.updated,
  },
  { key: 'owner', header: 'Owner', width: 'lg', mobileRole: 'line', render: (row) => <OwnerCell owner={row.owner} /> },
];

const columns = defineTableColumns(BASE_COLUMNS);

/** The same list with a leading icon on each card, for a list of documents. */
const iconColumns = defineTableColumns([
  {
    key: 'kind',
    header: '',
    headerLabel: 'Kind',
    mobileRole: 'lead',
    render: () => <Icon icon={FileText} size="lg" style={{ color: 'var(--ds-color-content-muted)' }} />,
  },
  ...BASE_COLUMNS,
]);

/** A row's own action, across the card's width on a phone. */
const actionColumns = defineTableColumns([
  ...iconColumns.filter((column) => column.key !== 'items'),
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
]);

/** Every value a list page owns, as a feature would. */
function useList({ initialQuery = '', initialRegion = '' } = {}) {
  const [segment, setSegment] = useState('all');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [region, setRegion] = useState(initialRegion);
  const [direction, setDirection] = useState('desc');
  const [selected, setSelected] = useState(() => new Set(['rec-002']));

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = RECORDS.filter((row) => (segment === 'all' || row.status === segment)
      && (!mine || row.owner === VIEWER)
      && (!region || row.region === region)
      && (!needle || `${row.title} ${row.reference}`.toLowerCase().includes(needle)));
    // The fixture is newest first.
    return direction === 'desc' ? shown : [...shown].reverse();
  }, [segment, mine, query, region, direction]);

  return {
    rows,
    segments: { ariaLabel: 'Show', items: SEGMENTS, value: segment, onChange: setSegment },
    toggle: { label: 'Only mine', checked: mine, onChange: setMine },
    search: { label: 'Search records', placeholder: 'Search title or reference', value: query, onChange: setQuery },
    region,
    setRegion,
    sort: { key: 'updated', direction },
    onSortChange: (next) => setDirection(next.direction),
    selection: {
      selectedIds: selected,
      selectAllLabel: 'Select all records on this page',
      getRowLabel: (row) => `Select ${row.title}`,
      onToggleRow: (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }),
      onToggleAll: (all) => setSelected(all ? new Set(rows.map((row) => row.id)) : new Set()),
    },
  };
}

function filtersFor(list, open, setOpen) {
  return {
    open,
    onOpenChange: setOpen,
    activeCount: list.region ? 1 : 0,
    onClear: () => list.setRegion(''),
    children: (
      <FormField label="Region">
        <Select value={list.region} onChange={(event) => list.setRegion(event.target.value)}>
          <option value="">Any region</option>
          <option value="North">North</option>
          <option value="South">South</option>
          <option value="East">East</option>
          <option value="West">West</option>
        </Select>
      </FormField>
    ),
  };
}

const EMPTY = {
  title: 'No records match',
  description: 'Clear the filters or the search to see every record.',
};

function Frame({ title, count, children }) {
  return (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <PageHeader
            title={title}
            count={count}
            countLabel="records"
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />
          <Stack gap="md">{children}</Stack>
        </Stack>
      </PageContainer>
    </div>
  );
}

/**
 * The standard: the heading with the count, the toolbar row on the page
 * (`placement="page"`), and the table as its own card under it.
 */
function ListPageExample({ initialOpen = false, initialRegion = '', initialQuery = '' }) {
  const list = useList({ initialQuery, initialRegion });
  const [open, setOpen] = useState(initialOpen);
  return (
    <Frame title="Records" count={list.rows.length}>
      <ListToolbar
        placement="page"
        segments={list.segments}
        toggle={list.toggle}
        search={list.search}
        filters={filtersFor(list, open, setOpen)}
      />
      <DataTable
        ariaLabel="Records"
        columns={columns}
        data={list.rows}
        mobilePresentation="cards"
        sort={list.sort}
        onSortChange={list.onSortChange}
        empty={EMPTY}
        pagination={{
          label: `${list.rows.length} total`,
          currentPage: 1,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
          onPrev: fn(),
          onNext: fn(),
        }}
      />
    </Frame>
  );
}

/**
 * A scope that is its own page (`TabNav`, in the row's `lead`), then the list's
 * own status segments as pills in the top strip of the table card, and a
 * selection: on a phone each card leads with its checkbox, under a "Select
 * all" and "Sort by" strip.
 */
function ScopedListExample() {
  const list = useList();
  const [open, setOpen] = useState(false);
  return (
    <Frame title="Records" count={list.rows.length}>
      <ListToolbar
        placement="page"
        lead={(
          <TabNav
            ariaLabel="Record lists"
            variant="segmented"
            currentId="all"
            items={[
              { id: 'all', label: 'All', href: '#all' },
              { id: 'mine', label: 'Assigned to me', href: '#mine' },
              { id: 'open', label: 'Unassigned', href: '#open' },
            ]}
          />
        )}
        search={list.search}
        filters={filtersFor(list, open, setOpen)}
      />
      <Card padding="none">
        <ListToolbar segments={{ ...list.segments, ariaLabel: 'Status', variant: 'pill' }} />
        <DataTable
          embedded
          ariaLabel="Records"
          columns={iconColumns}
          data={list.rows}
          mobilePresentation="cards"
          selection={list.selection}
          sort={list.sort}
          onSortChange={list.onSortChange}
          empty={EMPTY}
        />
      </Card>
    </Frame>
  );
}

/**
 * A list whose views are the page's tabs: no segments, so the card's top strip
 * is led by the search, with the switch and Filters at its end.
 */
function SearchStripExample() {
  const list = useList();
  const [open, setOpen] = useState(false);
  return (
    <Frame title="Records" count={list.rows.length}>
      <Card padding="none">
        <ListToolbar toggle={list.toggle} search={list.search} filters={filtersFor(list, open, setOpen)} />
        <DataTable
          embedded
          ariaLabel="Records"
          columns={actionColumns}
          data={list.rows}
          mobilePresentation="cards"
          sort={list.sort}
          onSortChange={list.onSortChange}
          empty={EMPTY}
        />
      </Card>
    </Frame>
  );
}

/** The card strip with underlined segments, as a console beside its sidebar keeps it. */
function ConsoleExample() {
  const list = useList();
  const [open, setOpen] = useState(false);
  return (
    <Frame title="Records" count={list.rows.length}>
      <Card padding="none">
        <ListToolbar
          segments={list.segments}
          toggle={list.toggle}
          search={list.search}
          filters={filtersFor(list, open, setOpen)}
        />
        <DataTable
          embedded
          ariaLabel="Records"
          columns={columns}
          data={list.rows}
          density="compact"
          mobilePresentation="cards"
          sort={list.sort}
          onSortChange={list.onSortChange}
          empty={EMPTY}
        />
      </Card>
    </Frame>
  );
}

const PHONE = { viewport: { value: 'safehaulMobile' } };
const TABLET = { viewport: { value: 'safehaulTablet' } };

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
          '2. `ListToolbar placement="page"`: a scope control (`lead`), the segments as a',
          '   segmented tray, then the search, the switch, Filters and the page actions, in',
          '   one row ending on the table\'s edge. When they do not fit, the tools take a row',
          '   of their own from the left. Filters open one row of fields below it.',
          '3. `DataTable`, its own card: one row per record, sorting from its headers, the',
          '   label "N total" and the pager under it. On a phone, cards laid out by role.',
          '4. A second tier of segments (pills), or the tools of a list whose views are the',
          '   page\'s tabs, go in the top strip of the table card (`placement="card"` in a',
          '   `Card padding="none"` around a `DataTable embedded`).',
          '',
          '### Accessibility',
          '',
          '- The segments are buttons with `aria-pressed` in a named group: they narrow one',
          '  list, they do not switch panels. A scope that is its own page is a `TabNav`.',
          '- The toolbar is not `role="toolbar"`, so the arrow keys stay with the search box.',
          '- The count is a `status` region: a screen reader hears the list grow or shrink.',
          '- Clearing the filters leaves focus on the Filters button.',
          '- On a phone "Select all" keeps the header checkbox\'s name, and every card\'s',
          '  checkbox has 44px to press.',
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

/** A tablet: the tools no longer fit beside the segments, so they take their own row from the left. */
export const Tablet = { globals: TABLET, render: () => <ListPageExample /> };

/** A phone: segments in equal rows, search with Filters, the switch, then one card per record. */
export const Phone = { globals: PHONE, render: () => <ListPageExample /> };

/** A scope in the row's `lead`, status pills in the table card, and a selection. */
export const ScopeAndStatusStrip = { render: () => <ScopedListExample /> };

/** The same on a phone: cards that lead with their checkbox, under "Select all" and "Sort by". */
export const ScopeAndStatusStripPhone = { globals: PHONE, render: () => <ScopedListExample /> };

/** A card strip led by the search, for a list whose views are the page's tabs. */
export const SearchStrip = { render: () => <SearchStripExample /> };

/** The search-led strip on a phone, each card's action across its width. */
export const SearchStripPhone = { globals: PHONE, render: () => <SearchStripExample /> };

/** `placement="card"` with underlined segments: the console shape, unchanged. */
export const CardStrip = { render: () => <ConsoleExample /> };
