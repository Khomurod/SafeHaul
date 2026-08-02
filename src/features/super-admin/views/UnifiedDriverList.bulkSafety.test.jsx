/**
 * Operator-safety regression guard for the Unified Driver Database bulk actions
 * (2026-07-28).
 *
 * Before this change, Message / Assign / Move Status / Archive were placeholders
 * that fired a **success** toast and did nothing. Archive additionally asked
 * `window.confirm("Are you sure you want to archive N records?")` first, so an
 * operator could confirm a destructive-sounding bulk action on real driver records
 * and be told it had succeeded.
 *
 * This file fails if any of that comes back: no success toast, no `window.confirm`,
 * and the four controls must stay disabled with an explanation until a real
 * implementation is specified by the owner. `Clear` must keep working, and the
 * per-record delete path — which *is* real — must be unaffected.
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
        // The row-action names are built from firstName/lastName, the selection
        // checkbox name from applicantName; both are needed to query unambiguously.
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

/** Selects the first row so the bulk bar appears. */
function selectFirstRow() {
    fireEvent.click(screen.getByRole('checkbox', { name: /^Select Test Driver One$/ }));
}

/**
 * The view also renders per-row "Message" and "Delete" actions, so every bulk
 * query is scoped to the bulk bar's own named group.
 */
function bulkBar() {
    return screen.getByRole('group', { name: 'Bulk actions for selected records' });
}

beforeEach(() => {
    vi.clearAllMocks();
    deleteDoc.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('UnifiedDriverList — bulk actions must not report false success', () => {
    it('shows the bulk bar once a record is selected', () => {
        renderList();
        selectFirstRow();
        expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
    });

    it.each(['Message', 'Assign', 'Move Status', 'Archive'])(
        '%s is disabled rather than reporting success',
        (name) => {
            renderList();
            selectFirstRow();
            const button = within(bulkBar()).getByRole('button', { name: new RegExp(`^${name}`) });
            expect(button).toBeDisabled();
        },
    );

    it('never fires a success toast from a bulk control', () => {
        renderList();
        selectFirstRow();

        for (const name of ['Message', 'Assign', 'Move Status', 'Archive']) {
            fireEvent.click(within(bulkBar()).getByRole('button', { name: new RegExp(`^${name}`) }));
        }

        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
    });

    it('never asks for a confirmation it will not honour', () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        renderList();
        selectFirstRow();
        fireEvent.click(within(bulkBar()).getByRole('button', { name: /^Archive/ }));

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('explains why the controls are unavailable, and wires the explanation to each', () => {
        const { container } = renderList();
        selectFirstRow();

        const button = within(bulkBar()).getByRole('button', { name: /^Archive/ });
        const noteId = button.getAttribute('aria-describedby');
        expect(noteId).toBeTruthy();
        expect(container.querySelector(`#${noteId}`)).toHaveTextContent(
            /Bulk Message, Assign, Move Status and Archive are not available yet/,
        );
    });

    it('keeps Clear working', () => {
        renderList();
        selectFirstRow();
        expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();

        fireEvent.click(within(bulkBar()).getByRole('button', { name: /^Clear/ }));
        expect(screen.queryByRole('group', { name: 'Bulk actions for selected records' })).not.toBeInTheDocument();
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
