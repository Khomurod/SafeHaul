import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { defineTableColumns } from './tableColumnContract';

const rows = [
  { id: 'row-1', name: 'Alpha', count: 3 },
  { id: 'row-2', name: 'Bravo', count: 1 },
];

const columns = defineTableColumns([
  { key: 'name', header: 'Name', rowHeader: true, sortable: true, render: (row) => row.name },
  {
    key: 'count',
    header: 'Count',
    align: 'end',
    sortable: { first: 'desc', labels: { desc: 'Most first', asc: 'Fewest first' } },
    render: (row) => row.count,
  },
  { key: 'note', header: 'Note', render: () => 'Plain' },
]);

/** A page that owns the order, as a feature does. */
function SortedList({ initial = { key: 'name', direction: 'asc' }, onSortChange, ...props }) {
  const [sort, setSort] = useState(initial);
  return (
    <DataTable
      ariaLabel="Records"
      columns={columns}
      data={rows}
      sort={sort}
      onSortChange={(next) => { onSortChange?.(next); setSort(next); }}
      {...props}
    />
  );
}

const header = (name) => screen.getByRole('columnheader', { name });

describe('DataTable sorting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes a sortable header one button named by its label, and leaves the others as text', () => {
    render(<SortedList />);

    expect(within(header('Name')).getByRole('button', { name: 'Name' })).toBeInTheDocument();
    expect(within(header('Count')).getByRole('button', { name: 'Count' })).toBeInTheDocument();
    expect(within(header('Note')).queryByRole('button')).toBeNull();
  });

  it('says on the sorted column only which way the list runs', () => {
    render(<SortedList />);

    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Count')).not.toHaveAttribute('aria-sort');
    expect(header('Note')).not.toHaveAttribute('aria-sort');
  });

  it('turns the sorted column the other way, and back, on each press', () => {
    const onSortChange = vi.fn();
    render(<SortedList onSortChange={onSortChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' });
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'asc' });
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sorts another column in its own first direction', () => {
    const onSortChange = vi.fn();
    render(<SortedList onSortChange={onSortChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Count' }));

    expect(onSortChange).toHaveBeenCalledWith({ key: 'count', direction: 'desc' });
    expect(header('Count')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Name')).not.toHaveAttribute('aria-sort');
  });

  it('marks the sorted button, so its arrow stays on screen', () => {
    render(<SortedList />);

    expect(screen.getByRole('button', { name: 'Name' })).toHaveAttribute('data-active');
    expect(screen.getByRole('button', { name: 'Count' })).not.toHaveAttribute('data-active');
  });

  it('leaves the order to the page: the rows stay as they came', () => {
    render(<SortedList />);

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));

    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Alpha', 'Bravo']);
  });

  it('does not open a row when its header is pressed', () => {
    const onRowActivate = vi.fn();
    render(<SortedList onRowActivate={onRowActivate} getRowLabel={(row) => `Open ${row.name}`} />);

    fireEvent.click(screen.getByRole('button', { name: 'Count' }));

    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(<SortedList />);

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('refuses a setting it cannot act on', () => {
    it('a sortable column with no onSortChange', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<DataTable ariaLabel="Records" columns={columns} data={rows} />))
        .toThrow('needs onSortChange');
    });

    it('a sort key that is not a sortable column', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<SortedList initial={{ key: 'note', direction: 'asc' }} />))
        .toThrow('sort.key "note" is not a sortable column');
    });

    it('a direction other than asc or desc', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<SortedList initial={{ key: 'name', direction: 'up' }} />))
        .toThrow('Unsupported DataTable sort direction "up"');
    });
  });

  describe('as cards on a phone', () => {
    function phoneScreen() {
      vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    }

    it('puts a "Sort by" list above the cards, with every sortable column both ways', () => {
      phoneScreen();
      render(<SortedList mobilePresentation="cards" />);

      const sortBy = screen.getByRole('combobox', { name: 'Sort by' });
      expect(within(sortBy).getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Name — Ascending',
        'Name — Descending',
        'Count — Fewest first',
        'Count — Most first',
      ]);
      expect(sortBy).toHaveValue('name:asc');
    });

    it('sorts from the list as the header would', () => {
      phoneScreen();
      const onSortChange = vi.fn();
      render(<SortedList mobilePresentation="cards" onSortChange={onSortChange} />);

      fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'count:desc' } });

      expect(onSortChange).toHaveBeenCalledWith({ key: 'count', direction: 'desc' });
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('count:desc');
      expect(header('Count')).toHaveAttribute('aria-sort', 'descending');
    });

    it('keeps the hidden header row as text, so there is one sort control on screen', () => {
      phoneScreen();
      render(<SortedList mobilePresentation="cards" />);

      expect(within(header('Name')).queryByRole('button')).toBeNull();
      expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    });

    it('shows no list when nothing sorts', () => {
      phoneScreen();
      const plain = defineTableColumns([{ key: 'note', header: 'Note', render: () => 'Plain' }]);
      render(<DataTable ariaLabel="Records" columns={plain} data={rows} mobilePresentation="cards" />);

      expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
    });

    it('shows header buttons, and no list, from 768px up', () => {
      render(<SortedList mobilePresentation="cards" />);

      expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
      expect(within(header('Name')).getByRole('button', { name: 'Name' })).toBeInTheDocument();
    });
  });
});
