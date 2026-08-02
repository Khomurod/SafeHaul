import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { defineTableColumns } from './tableColumnContract';

const rows = [
  { id: 'row-1', name: 'Alpha Driver', status: 'Ready' },
  { id: 'row-2', name: 'Bravo Driver', status: 'Review' },
];

const columns = defineTableColumns([
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.name,
    rowHeader: true,
    width: 'lg',
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => row.status,
    align: 'center',
    width: 'sm',
  },
]);

describe('DataTable', () => {
  it('uses the same alignment and width contract for headers and cells', () => {
    render(<DataTable ariaLabel="Example records" columns={columns} data={rows} />);

    const statusHeader = screen.getByRole('columnheader', { name: 'Status' });
    const statusCell = screen.getByRole('cell', { name: 'Ready' });
    const nameCell = screen.getByRole('rowheader', { name: 'Alpha Driver' });

    expect(statusHeader).toHaveAttribute('data-align', 'center');
    expect(statusCell).toHaveAttribute('data-align', 'center');
    expect(statusHeader).toHaveAttribute('data-width', 'sm');
    expect(statusCell).toHaveAttribute('data-width', 'sm');
    expect(statusHeader).toHaveAttribute('data-priority', 'secondary');
    expect(statusCell).toHaveAttribute('data-priority', 'secondary');
    expect(nameCell).toHaveAttribute('data-width', 'lg');
  });

  it('activates a row by mouse, Enter, or Space without stealing nested control actions', () => {
    const onRowActivate = vi.fn();
    const action = vi.fn();
    const interactiveColumns = defineTableColumns([
      ...columns,
      {
        key: 'actions',
        header: 'Actions',
        render: () => <button type="button" onClick={action}>Call</button>,
        stopPropagation: true,
        width: 'actions',
      },
    ]);

    render(
      <DataTable
        ariaLabel="Example records"
        columns={interactiveColumns}
        data={rows}
        getRowLabel={(row) => `Open ${row.name}`}
        onRowActivate={onRowActivate}
      />,
    );

    const row = screen.getByRole('row', { name: /Open Alpha Driver/i });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowActivate).toHaveBeenCalledTimes(3);

    fireEvent.click(within(row).getByRole('button', { name: 'Call' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(onRowActivate).toHaveBeenCalledTimes(3);
  });

  it('uses native, labelled checkboxes and keeps page selection indeterminate', () => {
    function SelectionHarness() {
      const [selected, setSelected] = useState(['row-1']);
      return (
        <DataTable
          ariaLabel="Selectable records"
          columns={columns}
          data={rows}
          selection={{
            selectedIds: selected,
            onToggleRow: (id) => setSelected((current) => (
              current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
            )),
            onToggleAll: () => setSelected(
              selected.length === rows.length ? [] : rows.map((row) => row.id),
            ),
            getRowLabel: (row) => `Select ${row.name}`,
          }}
        />
      );
    }

    render(<SelectionHarness />);

    const selectAll = screen.getByRole('checkbox', { name: 'Select all rows on this page' });
    const alpha = screen.getByRole('checkbox', { name: 'Select Alpha Driver' });
    const bravo = screen.getByRole('checkbox', { name: 'Select Bravo Driver' });

    expect(selectAll.indeterminate).toBe(true);
    expect(alpha).toBeChecked();
    expect(bravo).not.toBeChecked();

    fireEvent.click(bravo);
    expect(selectAll).toBeChecked();
    expect(selectAll.indeterminate).toBe(false);
  });

  it.each([
    {
      props: { isLoading: true, loadingLabel: 'Loading records' },
      role: 'status',
      expectedText: ['Loading records'],
    },
    {
      props: { data: [], empty: { title: 'Nothing here', description: 'Try another filter.' } },
      role: 'status',
      expectedText: ['Nothing here', 'Try another filter.'],
    },
    {
      props: {
        data: [],
        error: { message: 'Records could not be loaded.', onRetry: vi.fn() },
      },
      role: 'alert',
      expectedText: ['Unable to load records', 'Records could not be loaded.', 'Retry'],
    },
  ])('provides a standardized $role state', ({ props, role, expectedText }) => {
    render(<DataTable ariaLabel="Example records" columns={columns} data={rows} {...props} />);
    const state = screen.getByRole(role);
    expectedText.forEach((text) => expect(state).toHaveTextContent(text));
  });

  it('labels horizontal scrolling and pagination controls', () => {
    render(
      <DataTable
        ariaLabel="Example records"
        columns={columns}
        data={rows}
        mobilePresentation="scroll"
        pagination={{
          currentPage: 2,
          totalPages: 3,
          hasPrev: true,
          hasNext: true,
          onPrev: vi.fn(),
          onNext: vi.fn(),
          label: '21–40 of 60',
        }}
      />,
    );

    expect(screen.getByRole('region', { name: /Example records.*Scroll horizontally/i }))
      .toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('navigation', { name: 'Example records pagination' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <DataTable
        ariaLabel="Accessible records"
        columns={columns}
        data={rows}
        getRowLabel={(row) => `Open ${row.name}`}
        onRowActivate={() => {}}
        selection={{
          selectedIds: [],
          onToggleRow: () => {},
          onToggleAll: () => {},
          getRowLabel: (row) => `Select ${row.name}`,
        }}
      />,
    );

    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
