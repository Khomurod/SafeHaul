/**
 * Contract freeze + defect proof for the migrated Super Admin `CompaniesView`.
 *
 * This table drives destructive and tenant-scoped actions, so the callback
 * argument shapes are frozen before any presentation change. The defect suites
 * below each fail against the pre-migration component.
 *
 * All company names, slugs and phone numbers below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDoc = vi.fn(() => Promise.resolve());
const getDoc = vi.fn();

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
    getDoc: (...a) => getDoc(...a),
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
            loadMore={vi.fn()}
            hasMore={false}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getDoc.mockResolvedValue({ exists: () => false });
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

    it('passes the whole company object to onEdit in integration mode', () => {
        const onEdit = vi.fn();
        renderView({ isIntegrationMode: true, onEdit });

        fireEvent.click(screen.getByRole('button', { name: /Manage API for Artificial Freight Co/ }));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'co-1' }));
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
});

describe('CompaniesView — stale enrichment defect', () => {
    it('shows the SMS number once the async enrichment resolves', async () => {
        // The pre-migration `filteredCompanyList` memo read `displayList` but
        // depended on `[companySearch, companyList]`, so the enrichment landing
        // in state never reached the rendered rows.
        getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ defaultPhoneNumber: '+15550000001', provider: 'artificial-provider' }),
        });

        renderView({ isIntegrationMode: true });

        // Both rows resolve from the same mock, so both must update — the point
        // is that the enrichment reaches the rendered rows at all.
        expect(await screen.findAllByText('+15550000001')).toHaveLength(2);
        expect(screen.getAllByText('artificial-provider')).toHaveLength(2);
    });

    it('still shows the frozen not-provisioned copy when there is no config', async () => {
        renderView({ isIntegrationMode: true });
        expect(await screen.findAllByText('Not Provisioned')).toHaveLength(2);
    });
});

describe('CompaniesView — row actions no longer double-fire (defect)', () => {
    it('does not also open the editor when a row action is used', () => {
        const onEdit = vi.fn();
        const onViewApps = vi.fn();
        renderView({ onEdit, onViewApps });

        fireEvent.click(screen.getByRole('button', { name: 'View applications for Artificial Freight Co' }));

        expect(onViewApps).toHaveBeenCalledTimes(1);
        // Pre-migration this bubbled to the row's onClick and stacked two dialogs.
        expect(onEdit).not.toHaveBeenCalled();
    });

    it('does not open the editor when the status toggle is used', () => {
        const onEdit = vi.fn();
        renderView({ onEdit });
        fireEvent.click(screen.getByRole('button', { name: /Active — Artificial Freight Co/ }));
        expect(onEdit).not.toHaveBeenCalled();
    });

    it('still opens the company from a pointer click on the row', () => {
        const onEdit = vi.fn();
        renderView({ onEdit });
        fireEvent.click(screen.getByText('Second Artificial Carrier').closest('tr'));
        expect(onEdit).toHaveBeenCalledWith('co-2');
    });
});

describe('CompaniesView — keyboard and naming (defects)', () => {
    it('makes the company name a real button so it is keyboard reachable', () => {
        const onEdit = vi.fn();
        renderView({ onEdit });
        const nameButton = screen.getByRole('button', { name: 'Artificial Freight Co' });
        nameButton.focus();
        expect(nameButton).toHaveFocus();
        fireEvent.click(nameButton);
        expect(onEdit).toHaveBeenCalledWith('co-1');
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
