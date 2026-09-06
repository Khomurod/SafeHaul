/**
 * Operator-safety regression guard for the Unified Driver Database's bulk
 * actions — third and final shape (2026-09-06).
 *
 * The history this file guards against, in order:
 *
 *  1. Message / Assign / Move Status / Archive were placeholders that fired a
 *     **success** toast and did nothing. Archive also asked
 *     `window.confirm("Are you sure you want to archive N records?")`, so an
 *     operator could confirm a destructive-sounding action on real driver records
 *     and be told it had succeeded.
 *  2. From 2026-07-28 the four controls stayed visible but disabled and labelled
 *     unavailable, so the owner decision stayed visible too.
 *  3. The decision (2026-09-06): controls that do nothing are not shown. The bar
 *     and the row-selection checkboxes that existed only to feed it are removed.
 *     A real bulk action returns together with its selection when a recruiter
 *     asks for one.
 *
 * This file fails if any earlier shape comes back: no selection checkboxes, no
 * bulk group, no success toast from anything but a real action, no
 * `window.confirm`. The per-record delete path — which *is* real — must be
 * unaffected.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const deleteDoc = vi.hoisted(() => vi.fn());

vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    deleteDoc: (...a) => deleteDoc(...a),
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
    deleteDoc.mockResolvedValue(undefined);
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
        for (const name of ['Assign', 'Move Status', 'Archive']) {
            expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument();
        }
        // "Message" survives only as the real per-record action, never as a bulk one.
        for (const button of screen.queryAllByRole('button', { name: /^Message/ })) {
            expect(button).not.toBeDisabled();
            expect(button.getAttribute('aria-describedby')).toBeNull();
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

        // The genuine delete still targets the frozen document path.
        expect(deleteDoc).toHaveBeenCalledTimes(1);
    });
});
