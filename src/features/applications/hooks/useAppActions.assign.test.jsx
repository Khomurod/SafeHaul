/**
 * The dossier's Assign To: the record keeps the assignee's id and name, an
 * unassigned record keeps no name at all (the lists then show it as
 * Unassigned), and each change is logged from the assignee it replaced.
 *
 * All ids and names below are artificial.
 */
import React, { useState } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/** The hook over a record held in state, as `useAppFetch` holds it. */
let api;
function Harness({ record }) {
    const [appData, setAppData] = useState(record);
    api = useAppActions({
        companyId: 'co-1',
        applicationId: 'app-1',
        collectionName: 'applications',
        appData,
        setAppData,
        setCurrentStatus: vi.fn(),
        currentStatus: 'New',
        setAssignedTo: vi.fn(),
        teamMembers: TEAM,
        onStatusUpdate: vi.fn(),
    });
    return null;
}

const written = () => fs.updateDoc.mock.calls.map(([, data]) => data);
const logged = () => logActivity.mock.calls.map((call) => call[4]);

beforeEach(() => {
    vi.resetAllMocks();
    fs.doc.mockImplementation((_db, ...p) => ({ path: p.join('/') }));
    fs.updateDoc.mockResolvedValue(undefined);
    logActivity.mockResolvedValue(undefined);
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
    });

    it('reads a name left on an unassigned record as Unassigned', async () => {
        render(<Harness record={{ assignedTo: '', assignedToName: 'Former Recruiter' }} />);

        await act(() => api.handleAssignChange('recruiter-2'));

        expect(logged()).toEqual(['Rita Admin reassigned this from Unassigned to Lee Chen']);
    });
});
