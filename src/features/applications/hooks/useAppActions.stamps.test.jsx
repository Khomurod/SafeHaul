/**
 * The dossier says who changed a record, so the bell tells nobody about their
 * own action (`functions/shared/notificationAudience.js`): a stage change
 * stamps `statusChangedBy` and `statusChangedAt`, an assignment
 * `assignmentChangedBy` and `assignmentChangedAt`, in the same write. Team
 * members may write these fields (`firestore.rules`: only `status` and
 * `companyId` are checked).
 *
 * All ids and names below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ updateDoc: vi.fn(async () => {}) }));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'recruiter-1', displayName: 'Ann Baker' } },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    updateDoc: (...args) => fs.updateDoc(...args),
    serverTimestamp: () => '__ts__',
}));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));

import { useAppActions } from './useAppActions';

const actionsFor = (collectionName) => renderHook(() => useAppActions({
    companyId: 'co-1',
    applicationId: 'rec-1',
    collectionName,
    appData: { assignedTo: '', assignedToName: '' },
    setAppData: vi.fn(),
    setCurrentStatus: vi.fn(),
    currentStatus: 'New',
    setAssignedTo: vi.fn(),
    teamMembers: [{ id: 'recruiter-2', name: 'Lee Chen' }],
    onStatusUpdate: vi.fn(),
})).result;

beforeEach(() => {
    vi.resetAllMocks();
    fs.updateDoc.mockImplementation(async () => {});
});

describe('the dossier stamps who changed the record', () => {
    it.each(['applications', 'leads'])('a stage change on %s says who made it, in the same write', async (collectionName) => {
        const result = actionsFor(collectionName);

        await act(() => result.current.handleStatusUpdate('Interested'));

        expect(fs.updateDoc.mock.calls).toEqual([[
            { path: `companies/co-1/${collectionName}/rec-1` },
            { status: 'Interested', statusEnteredAt: '__ts__', statusChangedBy: 'recruiter-1', statusChangedAt: '__ts__' },
        ]]);
    });

    it('an assignment says who made it, in the same write', async () => {
        const result = actionsFor('applications');

        await act(() => result.current.handleAssignChange('recruiter-2'));

        expect(fs.updateDoc.mock.calls[0][1]).toEqual({
            assignedTo: 'recruiter-2',
            assignedToName: 'Lee Chen',
            assignmentChangedBy: 'recruiter-1',
            assignmentChangedAt: '__ts__',
        });
    });
});
