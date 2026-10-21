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
     * A live-region role on the `<td>` REPLACES the cell role: a row whose only
     * child is not a cell is a row assistive technology may drop from the table
     * altogether. And the empty row needs a role too, or filtering the list down
     * to nothing replaces the whole table and announces nothing.
     *
     * `ModernDriverTable` and `DataTable` both put the role in a wrapper inside
     * the cell. This asserts the same shape here, in both directions — the role
     * is on the wrapper, and it is not on the cell.
     */
    it('announces each state from inside the cell, never on the cell itself', () => {
        const { rerender } = renderView({ listLoading: true });
        const loading = screen.getByText('Loading companies...');
        expect(loading).toHaveAttribute('role', 'status');
        expect(loading.closest('td')).not.toHaveAttribute('role');

        rerender(<CompaniesView listLoading={false} statsError={{ ...NO_ERRORS, companies: true }} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        const error = screen.getByText('Error loading companies.');
        expect(error).toHaveAttribute('role', 'alert');
        expect(error.closest('td')).not.toHaveAttribute('role');

        rerender(<CompaniesView listLoading={false} statsError={NO_ERRORS} companyList={[]} onViewApps={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} loadMore={vi.fn()} hasMore={false} />);
        const empty = screen.getByText('No companies found.');
        expect(empty).toHaveAttribute('role', 'status');
        expect(empty.closest('td')).not.toHaveAttribute('role');
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
