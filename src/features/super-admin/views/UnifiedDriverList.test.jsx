/**
 * Contract freeze + defect proof for the migrated `UnifiedDriverList`.
 *
 * This view permanently deletes lead/application records, so the delete path and
 * its guard are frozen first: the `deleteApplication` callable, as a company
 * admin's delete, never a bare `deleteDoc` that left the record's subcollections
 * and files behind. The headline fix is that `loadMore`/`hasMore` were passed in
 * by `ViewRouter` and silently ignored, leaving older records unreachable.
 *
 * All driver names, phone numbers and company names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteApplication = vi.fn(() => Promise.resolve({ data: { success: true } }));
const deleteDoc = vi.fn(() => Promise.resolve());
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (...a) => (name === 'deleteApplication'
        ? deleteApplication(...a)
        : Promise.reject(new Error(`unexpected callable ${name}`))),
}));
// Present only so a document delete from the browser would be seen.
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
    deleteDoc: (...a) => deleteDoc(...a),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
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
    vi.resetAllMocks();
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

describe('UnifiedDriverList — delete through the server', () => {
    it('deletes an application through deleteApplication, with its files and subcollections', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(deleteApplication).toHaveBeenCalledWith({
            companyId: 'co-1', applicationId: 'a-1', collectionName: 'applications',
        }));
        expect(deleteDoc).not.toHaveBeenCalled();
        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Application deleted.'));
    });

    it('deletes a lead from the leads collection', async () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Second Lead' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(deleteApplication).toHaveBeenCalledWith({
            companyId: 'co-2', applicationId: 'l-1', collectionName: 'leads',
        }));
        expect(deleteDoc).not.toHaveBeenCalled();
    });

    it('refreshes the dashboard data after a delete', async () => {
        const onDataUpdate = vi.fn();
        renderView({ onDataUpdate });
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(onDataUpdate).toHaveBeenCalled());
    });

    it('reports a refused delete in the server\'s words, and does not refresh', async () => {
        const onDataUpdate = vi.fn();
        deleteApplication.mockRejectedValueOnce(new Error('Application not found.'));
        renderView({ onDataUpdate });
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('Application not found.'));
        expect(onDataUpdate).not.toHaveBeenCalled();
    });
});

describe('UnifiedDriverList — blocking confirm replaced (defect)', () => {
    it('never calls window.confirm and does not delete until confirmed', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Driver' }));

        expect(deleteApplication).not.toHaveBeenCalled();
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
        expect(deleteApplication).not.toHaveBeenCalled();
    });
});

describe('UnifiedDriverList — naming and filters (defects)', () => {
    it('names every row action after its driver', () => {
        renderView();
        expect(screen.getByRole('button', { name: 'View Artificial Driver' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Second Lead' })).toBeInTheDocument();
    });

    // It had no handler: pressing it did nothing.
    it('offers no Message action', () => {
        renderView();
        expect(screen.queryByRole('button', { name: /^Message/ })).not.toBeInTheDocument();
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
        expect(values).toEqual(['All', 'Company App', 'Company Lead']);
    });

    // The status and type menus listed values no record holds (OTR, "In Review",
    // "Company Import"), so most choices emptied the list. They now offer what the
    // loaded records hold.
    it('offers the statuses and freight types the records hold, and each one finds its records', () => {
        renderView({
            allApplications: [
                { ...APPLICATIONS[0], status: 'New Application', driverType: 'Reefer' },
                { ...APPLICATIONS[1], status: 'Contact Attempt 1', driverType: ['Flatbed'] },
            ],
        });
        const optionValues = (label) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.value);
        expect(optionValues('Filter by status')).toEqual(['All', 'Contact Attempt 1', 'New Application']);
        expect(optionValues('Filter by driver type')).toEqual(['All', 'Flatbed', 'Reefer']);

        fireEvent.change(screen.getByLabelText('Filter by driver type'), { target: { value: 'Flatbed' } });
        expect(screen.getByText('Second Lead')).toBeInTheDocument();
        expect(screen.queryByText('Artificial Driver')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Filter by driver type'), { target: { value: 'All' } });
        fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'New Application' } });
        expect(screen.getByText('Artificial Driver')).toBeInTheDocument();
        expect(screen.queryByText('Second Lead')).not.toBeInTheDocument();
    });

    it('keeps a chosen value on offer when the loaded records change', () => {
        const { rerender } = renderView();
        fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Qualified' } });
        rerender(
            <UnifiedDriverList
                allApplications={[APPLICATIONS[0]]}
                allCompaniesMap={COMPANIES_MAP}
                onAppClick={vi.fn()}
                onDataUpdate={vi.fn()}
                loadMore={vi.fn()}
                hasMore={false}
            />,
        );
        expect(screen.getByLabelText('Filter by status')).toHaveValue('Qualified');
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
