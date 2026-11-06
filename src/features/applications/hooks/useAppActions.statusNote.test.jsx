/**
 * After a stage change the dossier confirms it, and says what else it set off
 * (У5.3): a Contact Attempt stage that texts the driver adds "A text to the
 * driver is queued." (or "The driver may be texted.") to "Status updated to …".
 * The write is the same either way.
 *
 * All ids and names below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    updateDoc: vi.fn(async () => {}),
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'recruiter-1', displayName: 'Ann Baker' } },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    updateDoc: (...args) => fx.updateDoc(...args),
    serverTimestamp: () => '__ts__',
}));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess: fx.showSuccess, showError: fx.showError }),
}));

import { useAppActions } from './useAppActions';

const actions = () => renderHook(() => useAppActions({
    companyId: 'co-1',
    applicationId: 'rec-1',
    collectionName: 'applications',
    appData: { assignedTo: '', assignedToName: '' },
    setAppData: vi.fn(),
    setCurrentStatus: vi.fn(),
    currentStatus: 'New',
    setAssignedTo: vi.fn(),
    teamMembers: [],
    onStatusUpdate: vi.fn(),
})).result;

beforeEach(() => {
    vi.resetAllMocks();
    fx.updateDoc.mockImplementation(async () => {});
});

describe('the confirmation after a stage change', () => {
    it('says only the stage when nothing else happens', async () => {
        const result = actions();

        await act(() => result.current.handleStatusUpdate('Interested'));

        expect(fx.showSuccess).toHaveBeenCalledWith('Status updated to Interested');
    });

    it.each([
        ['A text to the driver is queued.', 'Status updated to Contact Attempt 1. A text to the driver is queued.'],
        ['The driver may be texted.', 'Status updated to Contact Attempt 1. The driver may be texted.'],
    ])('adds the text note "%s"', async (note, message) => {
        const result = actions();

        await act(() => result.current.handleStatusUpdate('Contact Attempt 1', { note }));

        expect(fx.showSuccess).toHaveBeenCalledWith(message);
        expect(fx.updateDoc).toHaveBeenCalledTimes(1);
        expect(fx.updateDoc.mock.calls[0][1]).toMatchObject({ status: 'Contact Attempt 1' });
    });

    it('says nothing about a text when the write fails', async () => {
        fx.updateDoc.mockImplementation(async () => { throw new Error('offline (artificial)'); });
        vi.useFakeTimers();
        try {
            const result = actions();
            const update = result.current.handleStatusUpdate('Contact Attempt 1', { note: 'A text to the driver is queued.' });
            await act(async () => { await vi.runAllTimersAsync(); });
            await act(() => update);
        } finally {
            vi.useRealTimers();
        }

        expect(fx.showSuccess).not.toHaveBeenCalled();
        expect(fx.showError).toHaveBeenCalledTimes(1);
    });
});
