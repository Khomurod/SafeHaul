/**
 * Operator-safety regression guard for the Unified Driver Database's bulk
 * actions.
 *
 * The decision: controls that do nothing are not shown. There is no bulk bar,
 * and no row-selection checkboxes that would exist only to feed it; a real bulk
 * action returns together with its selection when a recruiter asks for one. A
 * placeholder that fires a **success** toast and does nothing — worse, one that
 * first asks `window.confirm("Are you sure you want to archive N records?")` —
 * lets an operator confirm a destructive-sounding action on real driver records
 * and be told it succeeded.
 *
 * This file fails if any such shape comes back: no selection checkboxes, no
 * bulk group, no success toast from anything but a real action, no
 * `window.confirm`. The per-record delete path — which *is* real — must be
 * unaffected.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const deleteApplication = vi.hoisted(() => vi.fn());

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (...a) => (name === 'deleteApplication'
        ? deleteApplication(...a)
        : Promise.reject(new Error(`unexpected callable ${name}`))),
}));

import { UnifiedDriverList } from './UnifiedDriverList';

const APPLICATIONS = [
    {
        id: 'a1', companyId: 'co-1', applicantName: 'Test Driver One',
        firstName: 'Test', lastName: 'DriverOne',
        sourceType: 'application', status: 'New Application', phone: '5550001111',
    },
    {
        id: 'a2', companyId: 'co-1', applicantName: 'Test Driver Two',
        firstName: 'Test', lastName: 'DriverTwo',
        sourceType: 'application', status: 'New Application', phone: '5550002222',
    },
];

const COMPANIES = new Map([['co-1', 'Artificial Freight Co']]);

function renderList(props = {}) {
    return render(
        <UnifiedDriverList
            allApplications={APPLICATIONS}
            allCompaniesMap={COMPANIES}
            onAppClick={vi.fn()}
            onDataUpdate={vi.fn()}
            loadMore={vi.fn()}
            isLoadingMore={false}
            hasMore={false}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.resetAllMocks();
    deleteApplication.mockResolvedValue({ data: { success: true } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('UnifiedDriverList — no bulk controls, because none does anything', () => {
    it('renders no selection checkboxes', () => {
        renderList();
        // Rows and the header once carried "Select Test Driver One" / "Select all".
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('renders no bulk-action group and none of the four placeholder controls', () => {
        renderList();
        expect(screen.queryByRole('group', { name: 'Bulk actions for selected records' })).not.toBeInTheDocument();
        // Nor any Message: the row's own did nothing either, and went with them.
        for (const name of ['Message', 'Assign', 'Move Status', 'Archive']) {
            expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument();
        }
    });

    it('never fires a success toast or a confirm() just from rendering and clicking around', () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        renderList();
        // The first data row (index 0 is the header row).
        fireEvent.click(screen.getAllByRole('row')[1]);

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('leaves the real per-record delete path intact', async () => {
        renderList();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Test DriverOne' }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Permanently delete' }));

        // The genuine delete, through the server.
        await waitFor(() => expect(deleteApplication).toHaveBeenCalledTimes(1));
    });
});
