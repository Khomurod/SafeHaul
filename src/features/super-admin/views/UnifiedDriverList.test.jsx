/**
 * Contract freeze + defect proof for the migrated `UnifiedDriverList`.
 *
 * This view permanently deletes lead/application records, so the delete path and
 * its guard are frozen first. The headline fix is that `loadMore`/`hasMore` were
 * passed in by `ViewRouter` and silently ignored, leaving older records
 * unreachable.
 *
 * All driver names, phone numbers and company names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteDoc = vi.fn(() => Promise.resolve());
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
    deleteDoc: (...a) => deleteDoc(...a),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess, showError }),
}));

import { UnifiedDriverList } from './UnifiedDriverList';

const APPLICATIONS = [
    { id: 'a-1', firstName: 'Artificial', lastName: 'Driver', email: 'd1@example.test', phone: '5550000001', companyId: 'co-1', sourceType: 'Company App', status: 'New', createdAt: { seconds: 1900000000 } },
    { id: 'l-1', firstName: 'Second', lastName: 'Lead', email: 'd2@example.test', companyId: 'co-2', sourceType: 'Company Lead', status: 'Qualified', createdAt: { seconds: 1900000000 } },
];

const COMPANIES_MAP = new Map([['co-1', 'Artificial Freight Co'], ['co-2', 'Second Artificial Carrier']]);

function renderView(props = {}) {
    return render(
        <UnifiedDriverList
            allApplications={APPLICATIONS}
            allCompaniesMap={COMPANIES_MAP}
            onAppClick={vi.fn()}
            onDataUpdate={vi.fn()}
            loadMore={vi.fn()}
            hasMore={false}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('UnifiedDriverList — Load More wiring (defect)', () => {
    it('offers Load More when the hook says there is more', () => {
        renderView({ hasMore: true });
        expect(screen.getByRole('button', { name: 'Load More from Database' })).toBeInTheDocument();
    });

    it('calls loadMore with the exact "applications" key', () => {
        const loadMore = vi.fn();
        renderView({ hasMore: true, loadMore });
        fireEvent.click(screen.getByRole('button', { name: 'Load More from Database' }));
        // Pre-migration the prop was destructured and never used, so older
        // records could not be reached at all.
        expect(loadMore).toHaveBeenCalledWith('applications');
    });

    it('hides Load More when there is nothing more to fetch', () => {
        renderView({ hasMore: false });
        expect(screen.queryByRole('button', { name: 'Load More from Database' })).not.toBeInTheDocument();
    });

    it('disables Load More and shows a loading state while a fetch is in flight', () => {
        const loadMore = vi.fn();
        renderView({ hasMore: true, isLoadingMore: true, loadMore });
        // The label changes to the loading text and the button is disabled, so a
        // second activation cannot fire a duplicate fetch even by pointer.
        const button = screen.getByRole('button', { name: 'Loading…' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(button);
        expect(loadMore).not.toHaveBeenCalled();
    });
});

describe('UnifiedDriverList — frozen delete contract', () => {
    it('deletes applications from the applications subcollection', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(deleteDoc).toHaveBeenCalled());
        expect(deleteDoc).toHaveBeenCalledWith({ path: 'companies/co-1/applications/a-1' });
        expect(showSuccess).toHaveBeenCalledWith('Record deleted successfully.');
    });

    it('deletes leads from the leads subcollection', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Second Lead' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith({ path: 'companies/co-2/leads/l-1' }));
    });

    it('refreshes the dashboard data after a delete', async () => {
        const onDataUpdate = vi.fn();
        renderView({ onDataUpdate });
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(onDataUpdate).toHaveBeenCalled());
    });

    it('reports a failed delete through the frozen toast', async () => {
        deleteDoc.mockRejectedValueOnce(new Error('nope'));
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('Failed to delete. Check console.'));
    });
});

describe('UnifiedDriverList — blocking confirm replaced (defect)', () => {
    it('never calls window.confirm and does not delete until confirmed', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));

        expect(deleteDoc).not.toHaveBeenCalled();
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName('SUPER ADMIN WARNING');
        expect(confirmSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('preserves the warning wording', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/PERMANENTLY DELETE this record for/)).toBeInTheDocument();
        expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    });

    it('does not delete when cancelled', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(deleteDoc).not.toHaveBeenCalled();
    });
});

describe('UnifiedDriverList — naming and filters (defects)', () => {
    it('names every row action after its driver', () => {
        renderView();
        expect(screen.getByRole('button', { name: 'View Artificial Driver' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Message Artificial Driver' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Second Lead' })).toBeInTheDocument();
    });

    it('labels the search box and all four filters', () => {
        renderView();
        expect(screen.getByLabelText(/Search drivers by name, email, phone or company/)).toBeInTheDocument();
        ['Filter by status', 'Filter by source', 'Filter by driver type', 'Filter by documents status']
            .forEach((label) => expect(screen.getByLabelText(label)).toBeInTheDocument());
    });

    it('keeps the exact filter option values', () => {
        renderView();
        const source = screen.getByLabelText('Filter by source');
        const values = within(source).getAllByRole('option').map((o) => o.value);
        expect(values).toEqual(['All', 'Company App', 'Company Lead', 'Company Import']);
    });

    it('filters by source using the frozen sourceType values', () => {
        renderView();
        fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'Company Lead' } });
        expect(screen.queryByText('Artificial Driver')).not.toBeInTheDocument();
        expect(screen.getByText('Second Lead')).toBeInTheDocument();
    });

    it('searches across name, email, phone and company', () => {
        renderView();
        const search = screen.getByLabelText(/Search drivers by name, email, phone or company/);

        fireEvent.change(search, { target: { value: 'Second Artificial Carrier' } });
        expect(screen.getByText('Second Lead')).toBeInTheDocument();
        expect(screen.queryByText('Artificial Driver')).not.toBeInTheDocument();

        fireEvent.change(search, { target: { value: '5550000001' } });
        expect(screen.getByText('Artificial Driver')).toBeInTheDocument();
    });

    it('opens the dossier from the row action', () => {
        const onAppClick = vi.fn();
        renderView({ onAppClick });
        fireEvent.click(screen.getByRole('button', { name: 'View Artificial Driver' }));
        expect(onAppClick).toHaveBeenCalledWith(APPLICATIONS[0]);
    });
});
