import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { defineTableColumns } from './tableColumnContract';

const rows = [
  { id: 'row-1', name: 'Alpha record' },
  { id: 'row-2', name: 'Bravo record' },
];

const columns = defineTableColumns([
  { key: 'name', header: 'Name', rowHeader: true, width: 'lg', render: (row) => row.name },
]);

const paging = {
  currentPage: 1,
  totalPages: 3,
  hasPrev: false,
  hasNext: true,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  label: '1–20 of 60',
};

/** A contract violation throws outside a production build; keep its log quiet. */
function quietly(assertion) {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    assertion();
  } finally {
    quiet.mockRestore();
  }
}

afterEach(() => vi.clearAllMocks());

describe('DataTable — bounded height, state wording, page size', () => {
  it('draws an empty or failed list under the table, as wide as the card, keeping the header row', () => {
    const { container, rerender } = render(
      <DataTable ariaLabel="Example records" columns={columns} data={[]} empty={{ title: 'No records yet.' }} />,
    );
    const table = screen.getByRole('table', { name: 'Example records' });
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(table).not.toContainElement(screen.getByRole('status'));
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-state', 'empty');

    rerender(<DataTable ariaLabel="Example records" columns={columns} data={[]} error="The request failed." />);
    expect(table).not.toContainElement(screen.getByRole('alert'));
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-state', 'error');

    rerender(<DataTable ariaLabel="Example records" columns={columns} data={rows} />);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-state');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the state as a row of the table when the rows are cards', () => {
    const { container } = render(
      <DataTable
        ariaLabel="Example records"
        columns={columns}
        data={[]}
        mobilePresentation="cards"
        empty={{ title: 'No records yet.' }}
      />,
    );
    expect(screen.getByRole('table', { name: 'Example records' })).toContainElement(screen.getByRole('status'));
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-state');
  });


  it('caps its height at a known size, and refuses any other', () => {
    const { container, rerender } = render(
      <DataTable ariaLabel="Example records" columns={columns} data={rows} maxHeight="md" />,
    );
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-max-height', 'md');

    rerender(<DataTable ariaLabel="Example records" columns={columns} data={rows} />);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-max-height');

    quietly(() => expect(() => rerender(
      <DataTable ariaLabel="Example records" columns={columns} data={rows} maxHeight="400px" />,
    )).toThrow('Unsupported DataTable maxHeight "400px"'));
  });

  it('titles an error with the feature\'s words, and keeps the default otherwise', () => {
    const { rerender } = render(
      <DataTable
        ariaLabel="Example records"
        columns={columns}
        data={[]}
        error={{ title: 'Unable to load applications', message: 'The request failed.' }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unable to load applications');
    expect(alert).toHaveTextContent('The request failed.');
    expect(alert).not.toHaveTextContent('Unable to load records');

    rerender(<DataTable ariaLabel="Example records" columns={columns} data={[]} error="The request failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load records');
  });

  it('offers the empty state\'s action as a button', () => {
    const onClick = vi.fn();
    render(
      <DataTable
        ariaLabel="Example records"
        columns={columns}
        data={[]}
        empty={{ title: 'No records yet.', action: { label: 'Add a record', onClick } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a record' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows no empty-state button without an action', () => {
    render(<DataTable ariaLabel="Example records" columns={columns} data={[]} empty={{ title: 'No records yet.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('No records yet.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets the reader choose how many rows a page shows', async () => {
    const onPageSizeChange = vi.fn();
    const { container } = render(
      <DataTable
        ariaLabel="Example records"
        columns={columns}
        data={rows}
        pagination={{ ...paging, pageSize: 20, pageSizes: [20, 50, 100], onPageSizeChange }}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(select).toHaveValue('20');
    expect([...select.options].map((option) => option.textContent)).toEqual(['20', '50', '100']);

    fireEvent.change(select, { target: { value: '50' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('draws no page-size list unless the feature offers sizes', () => {
    render(<DataTable ariaLabel="Example records" columns={columns} data={rows} pagination={paging} />);
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('refuses page sizes it cannot act on', () => {
    quietly(() => {
      expect(() => render(
        <DataTable
          ariaLabel="Example records"
          columns={columns}
          data={rows}
          pagination={{ ...paging, pageSize: 20, pageSizes: [20, 50] }}
        />,
      )).toThrow('pagination.pageSizes needs pagination.onPageSizeChange');

      expect(() => render(
        <DataTable
          ariaLabel="Example records"
          columns={columns}
          data={rows}
          pagination={{ ...paging, pageSize: 20, pageSizes: 20, onPageSizeChange: vi.fn() }}
        />,
      )).toThrow('pagination.pageSizes must be a non-empty list');

      expect(() => render(
        <DataTable
          ariaLabel="Example records"
          columns={columns}
          data={rows}
          pagination={{ ...paging, pageSize: 20, pageSizes: [20, 'all'], onPageSizeChange: vi.fn() }}
        />,
      )).toThrow('pagination.pageSizes must be a non-empty list of whole numbers above 0');

      expect(() => render(
        <DataTable
          ariaLabel="Example records"
          columns={columns}
          data={rows}
          pagination={{ ...paging, pageSize: 25, pageSizes: [20, 50], onPageSizeChange: vi.fn() }}
        />,
      )).toThrow('pagination.pageSize "25" is not one of pagination.pageSizes');
    });
  });
});
