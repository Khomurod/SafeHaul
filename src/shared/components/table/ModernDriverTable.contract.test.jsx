/**
 * Contract freeze + a11y proof for `ModernDriverTable`, written with its
 * design-system migration (2026-07-28) — the roadmap's oldest open table row.
 *
 * `DataTable` is deliberately not adopted (see the component's recorded
 * exception). This file exists to prove that no accessibility or visual debt
 * hides behind that exception: everything `DataTable` would have supplied is
 * asserted here directly.
 *
 * Frozen: the column contract (`key`, `header`, `render`, `headerClassName`,
 * `cellClassName`, `stopPropagation`), `onRowClick`, `getRowClassName`, the
 * `Set`-or-array `selectedIds`, `onToggleSelect(id, event)` still receiving an
 * event that supports `stopPropagation()`, `onToggleSelectAll`, the pagination
 * prop shape, and the `emptyMessage` / `emptyIcon` states.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import { ModernDriverTable } from './ModernDriverTable';

const DATA = [
    { id: 'r1', name: 'Test Driver One', city: 'Springfield' },
    { id: 'r2', name: 'Test Driver Two', city: 'Shelbyville' },
];

const COLUMNS = [
    { key: 'name', header: 'Name', render: (item) => item.name },
    { key: 'city', header: 'City', render: (item) => item.city },
];

function renderTable(props = {}) {
    return render(
        <ModernDriverTable
            data={DATA}
            columns={COLUMNS}
            ariaLabel="Test records"
            {...props}
        />,
    );
}

describe('ModernDriverTable — rendering contract', () => {
    it('renders each column header and every cell through render()', () => {
        renderTable();
        expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'City' })).toBeInTheDocument();
        expect(screen.getByText('Test Driver One')).toBeInTheDocument();
        expect(screen.getByText('Shelbyville')).toBeInTheDocument();
    });

    it('applies caller-supplied header, cell and row classes', () => {
        const { container } = renderTable({
            columns: [{ ...COLUMNS[0], headerClassName: 'hdr-x', cellClassName: 'cell-x' }],
            getRowClassName: () => 'row-x',
        });
        expect(container.querySelector('th.hdr-x')).not.toBeNull();
        expect(container.querySelector('td.cell-x')).not.toBeNull();
        expect(container.querySelector('tr.row-x')).not.toBeNull();
    });

    it('shows the empty state with the caller message and icon', () => {
        renderTable({ data: [], emptyMessage: 'Nothing here.', emptyIcon: <span>custom-icon</span> });
        expect(screen.getByText('Nothing here.')).toBeInTheDocument();
        expect(screen.getByText('custom-icon')).toBeInTheDocument();
    });

    it('announces the loading state, which was previously a silent skeleton', () => {
        renderTable({ isLoading: true });
        expect(screen.getByRole('status')).toHaveTextContent('Loading Test records');
    });
});

describe('ModernDriverTable — row activation (was mouse-only)', () => {
    it('activates a row on click', () => {
        const onRowClick = vi.fn();
        renderTable({ onRowClick });
        fireEvent.click(screen.getByText('Test Driver One').closest('tr'));
        expect(onRowClick).toHaveBeenCalledWith(DATA[0]);
    });

    it.each(['Enter', ' '])('activates a focused row on %s', (key) => {
        const onRowClick = vi.fn();
        renderTable({ onRowClick });
        const row = screen.getByText('Test Driver One').closest('tr');
        expect(row).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(row, { key, target: row });
        expect(onRowClick).toHaveBeenCalledWith(DATA[0]);
    });

    it('does not make rows focusable when there is no row action', () => {
        renderTable();
        expect(screen.getByText('Test Driver One').closest('tr')).not.toHaveAttribute('tabindex');
    });

    it('does not activate the row when a key is pressed on a control inside it', () => {
        const onRowClick = vi.fn();
        const onAction = vi.fn();
        renderTable({
            onRowClick,
            columns: [{
                key: 'act',
                header: 'Actions',
                render: () => <button type="button" onClick={onAction}>Row action</button>,
            }],
        });

        // Both fixture rows render the action, so take the first.
        const button = screen.getAllByRole('button', { name: 'Row action' })[0];
        fireEvent.keyDown(button, { key: 'Enter' });
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it('honours a column opting out of row activation', () => {
        const onRowClick = vi.fn();
        renderTable({
            onRowClick,
            columns: [{ key: 'x', header: 'X', render: () => 'cell', stopPropagation: true }],
        });
        // Both fixture rows render the cell, so take the first.
        fireEvent.click(screen.getAllByText('cell')[0]);
        expect(onRowClick).not.toHaveBeenCalled();
    });
});

describe('ModernDriverTable — selection (icon buttons replaced by real checkboxes)', () => {
    const selectionProps = {
        showCheckboxes: true,
        selectedIds: new Set(['r1']),
    };

    it('uses native checkboxes, not aria-pressed icon buttons', () => {
        renderTable(selectionProps);
        const boxes = screen.getAllByRole('checkbox');
        // one select-all + one per row
        expect(boxes).toHaveLength(3);
        boxes.forEach((b) => expect(b).toHaveAttribute('type', 'checkbox'));
    });

    it('reflects the selected state on the control and the row', () => {
        renderTable(selectionProps);
        const selectedRow = screen.getByText('Test Driver One').closest('tr');
        expect(selectedRow).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Test Driver Two').closest('tr')).toHaveAttribute('aria-selected', 'false');
    });

    it('accepts an array as well as a Set for selectedIds', () => {
        renderTable({ showCheckboxes: true, selectedIds: ['r2'] });
        expect(screen.getByText('Test Driver Two').closest('tr')).toHaveAttribute('aria-selected', 'true');
    });

    it('names each row checkbox after its record when getRowLabel is supplied', () => {
        renderTable({ ...selectionProps, getRowLabel: (item) => item.name });
        expect(screen.getByRole('checkbox', { name: 'Deselect Test Driver One' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Select Test Driver Two' })).toBeInTheDocument();
    });

    it('falls back to a generic name when no getRowLabel is supplied', () => {
        renderTable(selectionProps);
        expect(screen.getByRole('checkbox', { name: 'Deselect row' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Select row' })).toBeInTheDocument();
    });

    it('passes the row id and an event that supports stopPropagation', () => {
        const onToggleSelect = vi.fn();
        renderTable({ ...selectionProps, onToggleSelect });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row' }));
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
        const [id, event] = onToggleSelect.mock.calls[0];
        expect(id).toBe('r2');
        expect(typeof event.stopPropagation).toBe('function');
    });

    it('does not activate the row when its checkbox is clicked', () => {
        const onRowClick = vi.fn();
        renderTable({ ...selectionProps, onRowClick, onToggleSelect: vi.fn() });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select row' }));
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it('names the select-all control for both states and wires it', () => {
        const onToggleSelectAll = vi.fn();
        renderTable({ showCheckboxes: true, selectedIds: new Set(), onToggleSelectAll });
        const all = screen.getByRole('checkbox', { name: 'Select all rows' });
        expect(all).not.toBeChecked();
        fireEvent.click(all);
        expect(onToggleSelectAll).toHaveBeenCalledTimes(1);
    });

    it('marks select-all checked only when every row is selected', () => {
        renderTable({ showCheckboxes: true, selectedIds: new Set(['r1', 'r2']) });
        expect(screen.getByRole('checkbox', { name: 'Deselect all rows' })).toBeChecked();
    });
});

describe('ModernDriverTable — pagination', () => {
    const pagination = {
        currentPage: 2,
        totalPages: 5,
        onNext: vi.fn(),
        onPrev: vi.fn(),
        hasPrev: true,
        hasNext: true,
        label: 'Showing 2 of 10 records',
    };

    it('renders a named pager with the caller label and working controls', () => {
        renderTable({ pagination });
        const nav = screen.getByRole('navigation', { name: 'Test records pagination' });
        expect(within(nav).getByText('Showing 2 of 10 records')).toBeInTheDocument();

        fireEvent.click(within(nav).getByRole('button', { name: 'Previous page' }));
        fireEvent.click(within(nav).getByRole('button', { name: 'Next page' }));
        expect(pagination.onPrev).toHaveBeenCalled();
        expect(pagination.onNext).toHaveBeenCalled();
    });

    it('disables the controls at the ends', () => {
        renderTable({ pagination: { ...pagination, hasPrev: false, hasNext: false } });
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('falls back to 1 total page', () => {
        renderTable({ pagination: { ...pagination, totalPages: 0 } });
        expect(screen.getByRole('navigation', { name: /pagination/ })).toHaveTextContent('Page 2 of 1');
    });

    it('hides the pager while loading', () => {
        renderTable({ isLoading: true, pagination });
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
});

describe('ModernDriverTable — accessibility guarantees behind the DataTable exception', () => {
    it('names the table via a caption', () => {
        renderTable();
        expect(screen.getByRole('table')).toHaveAccessibleName(/Test records/);
    });

    it('puts the table in a named, keyboard-focusable scroll region', () => {
        renderTable();
        const region = screen.getByRole('region', { name: /Test records/ });
        expect(region).toHaveAttribute('tabindex', '0');
    });

    it('marks every header as a column header', () => {
        renderTable();
        expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    });

    it('carries no legacy palette classes', () => {
        const { container } = renderTable({ showCheckboxes: true, selectedIds: new Set(['r1']), pagination: { currentPage: 1, totalPages: 1, label: 'x', hasPrev: false, hasNext: false } });
        for (const legacy of ['slate-200', 'slate-100', 'slate-50', 'slate-500', 'slate-300', 'blue-50', 'blue-600', 'bg-white']) {
            expect(container.innerHTML).not.toContain(legacy);
        }
    });

    it.each([
        ['default', {}],
        ['with selection', { showCheckboxes: true, selectedIds: new Set(['r1']), onToggleSelect: vi.fn(), onToggleSelectAll: vi.fn() }],
        ['with row activation', { onRowClick: vi.fn() }],
        ['loading', { isLoading: true }],
        ['empty', { data: [] }],
        ['paginated', { pagination: { currentPage: 1, totalPages: 3, onNext: vi.fn(), onPrev: vi.fn(), hasPrev: false, hasNext: true, label: 'Showing 2 of 6' } }],
    ])('has no jsdom axe violations (%s)', async (_name, props) => {
        const { container } = renderTable(props);
        expect((await axe(container)).violations).toEqual([]);
    });
});
