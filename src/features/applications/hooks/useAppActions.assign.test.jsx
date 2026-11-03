/**
 * The dossier's Assign To: the record keeps the assignee's id and name, an
 * unassigned record keeps no name at all (the lists then show it as
 * Unassigned), and each change is logged from the assignee it replaced. When a
 * save fails, the picker goes back to the assignee the record holds.
 *
 * All ids and names below are artificial.
 */
import React, { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ updateDoc: vi.fn(), doc: vi.fn((_db, ...p) => ({ path: p.join('/') })) }));
const logActivity = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { displayName: 'Rita Admin' } } }));
vi.mock('firebase/firestore', () => ({
    doc: (...a) => fs.doc(...a),
    updateDoc: (...a) => fs.updateDoc(...a),
    serverTimestamp: () => '__ts__',
}));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: (...a) => logActivity(...a) }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toast }));

import { useAppActions } from './useAppActions';

const TEAM = [
    { id: 'recruiter-1', name: 'Ann Baker' },
    { id: 'recruiter-2', name: 'Lee Chen' },
];

/**
 * The hook over a record and the picker's value held in state, as `useAppFetch`
 * holds them; it shows what the picker would show.
 */
let api;
function Harness({ record }) {
    const [appData, setAppData] = useState(record);
    const [assignedTo, setAssignedTo] = useState(record.assignedTo || '');
    api = useAppActions({
        companyId: 'co-1',
        applicationId: 'app-1',
        collectionName: 'applications',
        appData,
        setAppData,
        setCurrentStatus: vi.fn(),
        currentStatus: 'New',
        setAssignedTo,
        teamMembers: TEAM,
        onStatusUpdate: vi.fn(),
    });
    return <output aria-label="Assigned to">{assignedTo || '(none)'}</output>;
}

const written = () => fs.updateDoc.mock.calls.map(([, data]) => data);
const logged = () => logActivity.mock.calls.map((call) => call[4]);
const picker = () => screen.getByLabelText('Assigned to');
/** A save of this assignee is refused on every try. */
const refuse = (refused) => async (_ref, data) => {
    if (data.assignedTo === refused) throw new Error('permission-denied');
};

beforeEach(() => {
    vi.resetAllMocks();
    fs.doc.mockImplementation((_db, ...p) => ({ path: p.join('/') }));
    fs.updateDoc.mockResolvedValue(undefined);
    logActivity.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("the dossier's Assign To", () => {
    it('stores no name for an unassigned record', async () => {
        render(<Harness record={{ assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' }} />);

        await act(() => api.handleAssignChange(''));

        expect(written()).toEqual([{ assignedTo: '', assignedToName: '' }]);
        expect(logged()).toEqual(['Rita Admin reassigned this from Ann Baker to Unassigned']);
    });

    it('logs each change from the assignee it replaced', async () => {
        render(<Harness record={{ assignedTo: '', assignedToName: '' }} />);

        await act(() => api.handleAssignChange('recruiter-1'));
        await act(() => api.handleAssignChange('recruiter-2'));

        expect(written()).toEqual([
            { assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' },
            { assignedTo: 'recruiter-2', assignedToName: 'Lee Chen' },
        ]);
        expect(logged()).toEqual([
            'Rita Admin reassigned this from Unassigned to Ann Baker',
            'Rita Admin reassigned this from Ann Baker to Lee Chen',
        ]);
        await waitFor(() => expect(picker()).toHaveTextContent('recruiter-2'));
    });

    it('reads a name left on an unassigned record as Unassigned', async () => {
        render(<Harness record={{ assignedTo: '', assignedToName: 'Former Recruiter' }} />);

        await act(() => api.handleAssignChange('recruiter-2'));

        expect(logged()).toEqual(['Rita Admin reassigned this from Unassigned to Lee Chen']);
    });

    it('puts the picker back on the saved assignee when the save fails', async () => {
        fs.updateDoc.mockRejectedValue(new Error('permission-denied'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
        render(<Harness record={{ assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' }} />);

        await act(async () => {
            const p = api.handleAssignChange('recruiter-2');
            await vi.runAllTimersAsync();
            await p;
        });
        vi.useRealTimers();

        await waitFor(() => expect(picker()).toHaveTextContent('recruiter-1'));
        expect(fs.updateDoc).toHaveBeenCalledTimes(3);
        expect(toast.showError).toHaveBeenCalledWith('Failed to update assignment. Please try again.');
        expect(toast.showSuccess).not.toHaveBeenCalled();
        expect(logActivity).not.toHaveBeenCalled();
    });

    it('a later pick that saved wins over an earlier one that failed', async () => {
        fs.updateDoc.mockImplementation(refuse('recruiter-2'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
        render(<Harness record={{ assignedTo: '', assignedToName: '' }} />);

        await act(async () => {
            const failed = api.handleAssignChange('recruiter-2');
            const saved = api.handleAssignChange('recruiter-1');
            await vi.runAllTimersAsync();
            await Promise.all([failed, saved]);
        });
        vi.useRealTimers();

        await waitFor(() => expect(picker()).toHaveTextContent('recruiter-1'));
        expect(toast.showSuccess).toHaveBeenCalledWith('Assigned to Ann Baker');
        expect(toast.showError).toHaveBeenCalledWith('Failed to update assignment. Please try again.');
    });

    it('a failed pick leaves the next change logged from the saved assignee', async () => {
        fs.updateDoc.mockImplementation(refuse('recruiter-2'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
        render(<Harness record={{ assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' }} />);

        await act(async () => {
            const p = api.handleAssignChange('recruiter-2');
            await vi.runAllTimersAsync();
            await p;
        });
        vi.useRealTimers();
        await act(() => api.handleAssignChange(''));

        await waitFor(() => expect(picker()).toHaveTextContent('(none)'));
        expect(logged()).toEqual(['Rita Admin reassigned this from Ann Baker to Unassigned']);
    });
});
