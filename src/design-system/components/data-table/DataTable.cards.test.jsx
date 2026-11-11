import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { defineTableColumns } from './tableColumnContract';
import { cardLabelOf, cardRoleOf, isEmptyCellContent, usesMobileRoles } from './mobileRoles';

/**
 * Phone cards by role (`mobileRole`, `roleCards.css`) and cards with a
 * selection: the checkbox leads each card, and "Select all" moves to a strip
 * above the cards beside "Sort by", since a card has no header row.
 */

const rows = [
  { id: 'r1', name: 'Alpha Record', initials: 'AR', status: 'Open', region: 'North', updated: 'Jul 11', note: '—' },
  { id: 'r2', name: 'Bravo Record', initials: 'BR', status: 'Closed', region: '', updated: 'Jul 10', note: 'Called back' },
];

const roleColumns = defineTableColumns([
  { key: 'initials', header: '', headerLabel: 'Initials', mobileRole: 'lead', render: (row) => <span aria-hidden="true">{row.initials}</span> },
  { key: 'name', header: 'Record', rowHeader: true, width: 'lg', render: (row) => row.name },
  { key: 'status', header: 'Status', mobileRole: 'status', width: 'sm', render: (row) => row.status },
  { key: 'region', header: 'Region', width: 'sm', render: (row) => row.region },
  {
    key: 'updated',
    header: 'Updated',
    mobileRole: 'meta',
    mobileLabel: 'Updated ',
    width: 'sm',
    sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
    render: (row) => row.updated,
  },
  { key: 'note', header: 'Last note', mobileRole: 'line', mobileLabel: 'Last note:', width: 'md', render: (row) => row.note },
  { key: 'secret', header: 'Reference', mobileRole: 'hidden', width: 'sm', render: (row) => row.id },
  {
    key: 'actions',
    header: '',
    headerLabel: 'Actions',
    mobileRole: 'actions',
    width: 'sm',
    stopPropagation: true,
    render: (row) => <button type="button">{`Open ${row.name}`}</button>,
  },
]);

/** A screen of the given width, as `useCardsLayout` asks for it. */
function screenWidth(narrow) {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    matches: narrow,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function selection(overrides = {}) {
  return {
    selectedIds: new Set(),
    selectAllLabel: 'Select all records on this page',
    getRowLabel: (row) => `Select ${row.name}`,
    onToggleRow: vi.fn(),
    onToggleAll: vi.fn(),
    ...overrides,
  };
}

function renderCards(props = {}) {
  return render(
    <DataTable
      ariaLabel="Records"
      columns={roleColumns}
      data={rows}
      mobilePresentation="cards"
      sort={{ key: 'updated', direction: 'desc' }}
      onSortChange={vi.fn()}
      {...props}
    />,
  );
}

/** A stylesheet of this folder, its comments left out. */
const stylesheet = (name) => readFileSync(path.join(__dirname, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector passes `test`. */
function declarationsWhere(css, test) {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) => test(selector.trim()));
  return rule?.[2] ?? '';
}

const declarationsFor = (css, ...parts) => declarationsWhere(css, (selector) => parts.every((part) => selector.includes(part)));

const cellIn = (row, text) => within(row).getAllByRole('cell').find((cell) => cell.textContent === text);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataTable cards by role', () => {
  it('places each cell by its column role, the row header as the title', () => {
    const { container } = renderCards();

    const table = container.querySelector('.ds-data-table');
    expect(table).toHaveAttribute('data-mobile-roles', 'true');
    expect(table).toHaveAttribute('data-mobile-lead', 'true');
    const [first] = screen.getAllByRole('row').slice(1);
    expect(within(first).getByRole('rowheader')).toHaveAttribute('data-mobile-role', 'title');
    expect(cellIn(first, 'Open')).toHaveAttribute('data-mobile-role', 'status');
    expect(cellIn(first, 'r1')).toHaveAttribute('data-mobile-role', 'hidden');
    // A column that states no role is an inline item once roles are on.
    expect(cellIn(first, 'North')).toHaveAttribute('data-mobile-role', 'meta');
    // The role layout replaces the label-and-value one.
    expect(container.querySelector('[data-label]')).toBeNull();
    expect(container.querySelector('col[data-mobile-role="lead"]')).not.toBeNull();
  });

  it('writes an inline label only where the column gives one, trimmed', () => {
    renderCards();

    const [first] = screen.getAllByRole('row').slice(1);
    expect(cellIn(first, 'Jul 11')).toHaveAttribute('data-mobile-label', 'Updated');
    expect(cellIn(first, 'North')).not.toHaveAttribute('data-mobile-label');
  });

  it('marks an empty inline value, so the card leaves it out', () => {
    renderCards();

    const [first, second] = screen.getAllByRole('row').slice(1);
    expect(cellIn(first, '—')).toHaveAttribute('data-mobile-empty', 'true');
    expect(cellIn(second, '')).toHaveAttribute('data-mobile-empty', 'true');
    expect(cellIn(second, 'Called back')).not.toHaveAttribute('data-mobile-empty');
  });

  it('keeps every cell of a row under its own column header, the ones the card leaves out included', () => {
    renderCards({ selection: selection() });

    const [header, ...records] = screen.getAllByRole('row');
    const columnCount = within(header).getAllByRole('columnheader').length;
    records.forEach((row) => {
      const cells = [...within(row).queryAllByRole('rowheader'), ...within(row).queryAllByRole('cell')];
      expect(cells).toHaveLength(columnCount);
    });
    // The card leaves these out by clipping them, never by removing them from
    // the accessibility tree, which would shift every cell after them.
    const css = stylesheet('roleCards.css');
    for (const part of ["[data-mobile-role='hidden']", '[data-mobile-empty]']) {
      const rule = declarationsFor(css, part);
      expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
      expect(rule).not.toMatch(/display:\s*none/);
    }
    expect(css).not.toMatch(/\[data-mobile-(role|empty)[^{]*\{[^}]*display:\s*none/);
  });

  it('pins the row header after a leading avatar column, not the avatar, while the table scrolls', () => {
    screenWidth(false);
    const { container } = renderCards({ selection: selection() });

    const table = container.querySelector('.ds-data-table');
    expect(table).toHaveAttribute('data-pin-first-column');
    expect(table).toHaveAttribute('data-mobile-lead');
    // The structure the pin reads: the lead cell, then the row's name.
    const headerLead = container.querySelector('thead th[data-mobile-role="lead"]');
    expect(headerLead.nextElementSibling).toHaveTextContent('Record');
    const [first] = screen.getAllByRole('row').slice(1);
    expect(first.querySelector('[data-mobile-role="lead"]').nextElementSibling).toBe(within(first).getByRole('rowheader'));

    const css = stylesheet('pinnedColumn.css');
    const leadOnly = declarationsWhere(css, (selector) => selector.includes('[data-mobile-lead]') && selector.endsWith("[data-mobile-role='lead']"));
    expect(leadOnly).toMatch(/position:\s*static/);
    expect(declarationsFor(css, '[data-mobile-lead]', "tbody > tr > [data-mobile-role='lead'] + *")).toMatch(/position:\s*sticky/);
    expect(declarationsFor(css, '[data-mobile-lead]', "thead > tr > [data-mobile-role='lead'] + *")).toMatch(/position:\s*sticky/);
  });

  it('keeps the label-and-value card for a table whose columns state no role', () => {
    const plain = defineTableColumns([
      { key: 'name', header: 'Record', rowHeader: true, render: (row) => row.name },
      { key: 'status', header: 'Status', render: (row) => row.status },
    ]);
    const { container } = render(<DataTable ariaLabel="Records" columns={plain} data={rows} mobilePresentation="cards" />);

    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-mobile-roles');
    expect(container.querySelector('[data-mobile-role]')).toBeNull();
    expect(screen.getAllByRole('cell')[0]).toHaveAttribute('data-label', 'Status');
  });

  it('refuses a role on a table that never draws cards', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<DataTable ariaLabel="Records" columns={roleColumns} data={rows} />))
      .toThrow('needs mobilePresentation="cards"');
  });

  it('takes the pin off while the cards are on screen', () => {
    screenWidth(true);
    const { container } = renderCards();

    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-pin-first-column');
  });
});

describe('DataTable cards with a selection', () => {
  it('puts "Select all" in a strip above the cards, under the header checkbox\'s name', () => {
    screenWidth(true);
    const onToggleAll = vi.fn();
    const { container } = renderCards({ selection: selection({ selectedIds: new Set(['r1']), onToggleAll }) });

    const strip = container.querySelector('.ds-data-table__card-strip');
    const selectAll = within(strip).getByRole('checkbox', { name: 'Select all records on this page' });
    expect(within(strip).getByText('Select all')).toBeInTheDocument();
    // One "select all" in the document: the header row holds none while the cards show.
    expect(screen.getAllByRole('checkbox', { name: 'Select all records on this page' })).toHaveLength(1);
    expect(selectAll.indeterminate).toBe(true);
    fireEvent.click(selectAll);
    expect(onToggleAll).toHaveBeenCalledWith(true, expect.anything());
    // "Sort by" shares the strip.
    expect(within(strip).getByRole('combobox', { name: 'Sort by' })).toHaveValue('updated:desc');
  });

  it('keeps the checkbox in the header row while the table is a table', () => {
    screenWidth(false);
    const { container } = renderCards({ selection: selection() });

    expect(container.querySelector('.ds-data-table__card-strip')).toBeNull();
    const header = container.querySelector('thead');
    expect(within(header).getByRole('checkbox', { name: 'Select all records on this page' })).toBeInTheDocument();
  });

  it('leads each card with its own checkbox, which never opens the row', () => {
    screenWidth(true);
    const onRowActivate = vi.fn();
    const onToggleRow = vi.fn();
    renderCards({ selection: selection({ onToggleRow }), onRowActivate });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bravo Record' }));

    expect(onToggleRow).toHaveBeenCalledWith('r2', expect.anything());
    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it('offers no "Select all" for an empty list, and no strip with nothing to select or sort', () => {
    screenWidth(true);
    const { container, rerender } = renderCards({ data: [], selection: selection() });
    expect(screen.queryByRole('checkbox', { name: 'Select all records on this page' })).toBeNull();

    const plain = defineTableColumns([
      { key: 'name', header: 'Record', rowHeader: true, render: (row) => row.name },
      { key: 'status', header: 'Status', mobileRole: 'status', render: (row) => row.status },
    ]);
    rerender(<DataTable ariaLabel="Records" columns={plain} data={rows} mobilePresentation="cards" />);
    expect(container.querySelector('.ds-data-table__card-strip')).toBeNull();
  });

  it('has no structural accessibility violations', async () => {
    screenWidth(true);
    const { container } = renderCards({ selection: selection({ selectedIds: new Set(['r2']) }), onRowActivate: vi.fn() });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('mobileRoles helpers', () => {
  it('turns roles on only for cards with a role stated', () => {
    expect(usesMobileRoles(true, roleColumns)).toBe(true);
    expect(usesMobileRoles(false, roleColumns)).toBe(false);
    expect(usesMobileRoles(true, [{ key: 'a' }])).toBe(false);
  });

  it('defaults the row header to the title and any other column to an inline item', () => {
    expect(cardRoleOf({ rowHeader: true })).toBe('title');
    expect(cardRoleOf({ rowHeader: false })).toBe('meta');
    expect(cardRoleOf({ mobileRole: 'line' })).toBe('line');
  });

  it('labels only inline items and lines, and never from the header', () => {
    expect(cardLabelOf({ mobileLabel: ' Last call: ' }, 'meta')).toBe('Last call:');
    expect(cardLabelOf({ mobileLabel: 'Owner', header: 'Owner' }, 'status')).toBeUndefined();
    expect(cardLabelOf({ header: 'Owner' }, 'meta')).toBeUndefined();
    expect(cardLabelOf({ mobileLabel: '' }, 'line')).toBeUndefined();
  });

  it('counts nothing, a blank and a dash as empty, and anything drawn as content', () => {
    [null, undefined, false, '', '  ', '—', '–', '-', [null, '']].forEach((value) => {
      expect(isEmptyCellContent(value)).toBe(true);
    });
    [0, 'x', <span key="a" />, ['', 'x']].forEach((value) => {
      expect(isEmptyCellContent(value)).toBe(false);
    });
  });
});
