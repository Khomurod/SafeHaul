/**
 * Contract freeze + defect proof for the migrated Super Admin `CompaniesView`.
 *
 * This table drives destructive and tenant-scoped actions, so the callback
 * argument shapes are frozen before any presentation change. The defect suites
 * below each fail against the pre-migration component.
 *
 * All company names and slugs below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDoc = vi.fn(() => Promise.resolve());

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
    updateDoc: (...a) => updateDoc(...a),
}));

import { CompaniesView } from './CompaniesView';

const COMPANIES = [
    { id: 'co-1', companyName: 'Artificial Freight Co', appSlug: 'artificial-freight', planType: 'paid', isActive: true },
    { id: 'co-2', companyName: 'Second Artificial Carrier', appSlug: 'second-carrier', planType: 'free', isActive: false },
];

const NO_ERRORS = { companies: false, users: false, apps: false };

function renderView(props = {}) {
    return render(
        <CompaniesView
            listLoading={false}
            statsError={NO_ERRORS}
            companyList={COMPANIES}
            onViewApps={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onOpen={vi.fn()}
            loadMore={vi.fn()}
            hasMore={false}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('CompaniesView — frozen callback contracts', () => {
    it('passes { id, name } to onViewApps and onDelete, and the bare id to onEdit', () => {
        const onViewApps = vi.fn();
        const onDelete = vi.fn();
        const onEdit = vi.fn();
        renderView({ onViewApps, onDelete, onEdit });

        fireEvent.click(screen.getByRole('button', { name: 'View applications for Artificial Freight Co' }));
        expect(onViewApps).toHaveBeenCalledWith({ id: 'co-1', name: 'Artificial Freight Co' });

        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Freight Co' }));
        expect(onDelete).toHaveBeenCalledWith({ id: 'co-1', name: 'Artificial Freight Co' });

        fireEvent.click(screen.getByRole('button', { name: 'Edit Artificial Freight Co' }));
        expect(onEdit).toHaveBeenCalledWith('co-1');
    });

    it("passes the whole company to onOpen, for the company's own screen", () => {
        const onOpen = vi.fn();
        renderView({ onOpen });

        fireEvent.click(screen.getByRole('button', { name: 'Artificial Freight Co' }));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'co-1', companyName: 'Artificial Freight Co' }));
    });

    it('reads nothing per row: what is set for a company is on its own screen', () => {
        renderView();
        expect(screen.getAllByRole('row')).toHaveLength(3);
        expect(screen.queryByText('Not Provisioned')).not.toBeInTheDocument();
        expect(screen.getAllByRole('columnheader').map((h) => h.textContent))
            .toEqual(['Company Name', 'Slug / ID', 'Plan', 'Status', 'Actions']);
    });

    it('calls loadMore with the exact "companies" key', () => {
        const loadMore = vi.fn();
        renderView({ hasMore: true, loadMore });
        fireEvent.click(screen.getByRole('button', { name: 'Load More from Database' }));
        expect(loadMore).toHaveBeenCalledWith('companies');
    });

    it('disables Load More while a database fetch is in flight', () => {
        const loadMore = vi.fn();
        renderView({ hasMore: true, isLoadingMore: true, loadMore });
        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(loadMore).not.toHaveBeenCalled();
    });

    it('writes only isActive when toggling, to the exact company doc', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
        expect(updateDoc.mock.calls[0][0]).toEqual({ path: 'companies/co-1' });
        expect(updateDoc.mock.calls[0][1]).toEqual({ isActive: false });
    });

    it('searches across name, slug and id', () => {
        renderView();
        const search = screen.getByLabelText('Search companies by name, slug or ID');

        fireEvent.change(search, { target: { value: 'second-carrier' } });
        expect(screen.queryByText('Artificial Freight Co')).not.toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'co-1' } });
        expect(screen.getByText('Artificial Freight Co')).toBeInTheDocument();
    });

    it('keeps the frozen loading, error and empty strings', () => {
        const { rerender } = renderView({ listLoading: true });
        expect(screen.getByText('Loading companies...')).toBeInTheDocument();

        rerender(<CompaniesView listLoading={false} statsError={{ ...NO_ERRORS, companies: true }} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Error loading companies.');

        rerender(<CompaniesView listLoading={false} statsError={NO_ERRORS} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        expect(screen.getByText('No companies found.')).toBeInTheDocument();
    });

    /*
     * A live-region role on a `<td>` replaces the cell role, and a row whose
     * only child is not a cell may be dropped from the table. Each state is
     * announced by its own wrapper (the table's state panel), never by a cell,
     * and the empty state is announced too, so filtering to nothing is heard.
     */
    it('announces each state from its own wrapper, never from a cell', () => {
        const { rerender } = renderView({ listLoading: true });
        const loading = screen.getByText('Loading companies...').closest('[role="status"]');
        expect(loading).not.toBeNull();
        expect(loading.tagName).not.toBe('TD');

        rerender(<CompaniesView listLoading={false} statsError={{ ...NO_ERRORS, companies: true }} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        const error = screen.getByText('Error loading companies.').closest('[role="alert"]');
        expect(error).not.toBeNull();
        expect(error.tagName).not.toBe('TD');

        rerender(<CompaniesView listLoading={false} statsError={NO_ERRORS} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        const empty = screen.getByText('No companies found.').closest('[role="status"]');
        expect(empty).not.toBeNull();
        expect(empty.tagName).not.toBe('TD');
        document.querySelectorAll('td').forEach((cell) => expect(cell).not.toHaveAttribute('role', 'status'));
    });
});

describe('CompaniesView — the shared table', () => {
    it('is a DataTable named after the page, with the company name as each row header', () => {
        renderView();
        const table = screen.getByRole('table', { name: 'Manage Companies' });
        expect(table.closest('.ds-data-table')).toHaveAttribute('data-embedded', 'true');
        expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent))
            .toEqual(['AArtificial Freight Co', 'SSecond Artificial Carrier']);
    });

    it('opens a company from the keyboard on its row, as from a click', () => {
        const onOpen = vi.fn();
        renderView({ onOpen });
        const row = screen.getByText('Second Artificial Carrier').closest('tr');
        fireEvent.keyDown(row, { key: 'Enter' });
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'co-2' }));
    });

    it('pages the list with the table pager: 20, 50 or 100 rows', () => {
        const many = Array.from({ length: 25 }, (_, i) => ({
            id: `co-${i + 1}`, companyName: `Artificial Carrier ${i + 1}`, appSlug: `carrier-${i + 1}`,
        }));
        renderView({ companyList: many });
        expect(screen.getByText('Showing 20 of 25 companies')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 5 of 25 companies')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
        expect(screen.getByText('Showing 25 of 25 companies')).toBeInTheDocument();
    });
});

describe('CompaniesView — row actions no longer double-fire (defect)', () => {
    it('does not also open the company when a row action is used', () => {
        const onOpen = vi.fn();
        const onEdit = vi.fn();
        const onViewApps = vi.fn();
        renderView({ onOpen, onEdit, onViewApps });

        fireEvent.click(screen.getByRole('button', { name: 'View applications for Artificial Freight Co' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit Artificial Freight Co' }));

        expect(onViewApps).toHaveBeenCalledTimes(1);
        expect(onEdit).toHaveBeenCalledTimes(1);
        // Pre-migration this bubbled to the row's onClick and stacked two screens.
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('does not open the company when the status toggle is used', () => {
        const onOpen = vi.fn();
        renderView({ onOpen });
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('still opens the company from a pointer click on the row', () => {
        const onOpen = vi.fn();
        renderView({ onOpen });
        fireEvent.click(screen.getByText('Second Artificial Carrier').closest('tr'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'co-2' }));
    });
});

describe('CompaniesView — keyboard and naming (defects)', () => {
    it('makes the company name a real button so it is keyboard reachable', () => {
        const onOpen = vi.fn();
        renderView({ onOpen });
        const nameButton = screen.getByRole('button', { name: 'Artificial Freight Co' });
        nameButton.focus();
        expect(nameButton).toHaveFocus();
        fireEvent.click(nameButton);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('names every icon-only row action after its company', () => {
        renderView();
        ['View applications for', 'Edit', 'Delete'].forEach((prefix) => {
            expect(screen.getByRole('button', { name: new RegExp(`${prefix} Artificial Freight Co`) })).toBeInTheDocument();
        });
    });

    it('states the status as text, with the company named for screen readers', () => {
        renderView();
        expect(screen.getByRole('button', { name: /Active — Artificial Freight Co/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Inactive — Second Artificial Carrier/ })).toBeInTheDocument();
    });
});

describe('CompaniesView — blocking dialogs replaced (defect)', () => {
    it('never calls window.confirm or window.alert', async () => {
        const confirmSpy = vi.fn(() => true);
        const alertSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);
        vi.stubGlobal('alert', alertSpy);

        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
        await waitFor(() => expect(updateDoc).toHaveBeenCalled());

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('preserves the confirmation wording verbatim', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('DEACTIVATE "Artificial Freight Co"?')).toBeInTheDocument();
        expect(within(dialog).getByText('This company will be blocked from logging in and using the portal.')).toBeInTheDocument();
    });

    it('uses the activate wording for an inactive company', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Inactive — Second Artificial Carrier/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('ACTIVATE "Second Artificial Carrier"?')).toBeInTheDocument();
        expect(within(dialog).getByText('This company will regain access to the portal.')).toBeInTheDocument();
    });

    it('does not write when the confirmation is cancelled', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(updateDoc).not.toHaveBeenCalled();
    });

    it('announces a toggle failure instead of alert()', async () => {
        updateDoc.mockRejectedValueOnce(new Error('permission denied'));
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to deactivate company: permission denied');
    });
});

describe('CompaniesView — accessibility', () => {
    it('has no violations in the populated table', async () => {
        const { container } = renderView();
        expect((await axe(container)).violations).toEqual([]);
    });
});
