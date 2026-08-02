import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (_fns, name) => (...a) => mockCallable(name, ...a) }));
let mockSnapshotDocs = [];
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({})),
    onSnapshot: (_col, cb) => { cb({ docs: mockSnapshotDocs }); return () => {}; },
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showSuccess, showError }) }));

import { useApplicationChanges } from './useApplicationChanges';

const args = ['co1', 'app1', 'applications'];

describe('useApplicationChanges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSnapshotDocs = [];
        mockCallable.mockResolvedValue({ data: { applied: ['firstName'] } });
    });

    it('surfaces live pending changes from the snapshot', async () => {
        mockSnapshotDocs = [{ id: 'firstName', data: () => ({ fieldKey: 'firstName', fieldLabel: 'First Name', status: 'pending' }) }];
        const { result } = renderHook(() => useApplicationChanges(...args));
        await waitFor(() => expect(result.current.pendingChanges).toHaveLength(1));
        expect(result.current.pendingChanges[0]).toMatchObject({ id: 'firstName', fieldLabel: 'First Name' });
    });

    it('proposeChanges calls proposeApplicationChanges and reports success', async () => {
        const { result } = renderHook(() => useApplicationChanges(...args));
        let ok;
        await act(async () => { ok = await result.current.proposeChanges([{ fieldKey: 'firstName', proposedValue: 'X' }]); });
        expect(ok).toBe(true);
        expect(mockCallable).toHaveBeenCalledWith('proposeApplicationChanges', { companyId: 'co1', applicationId: 'app1', collectionName: 'applications', changes: [{ fieldKey: 'firstName', proposedValue: 'X' }] });
    });

    it('proposeChanges returns false when nothing applied', async () => {
        mockCallable.mockResolvedValueOnce({ data: { applied: [] } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let ok;
        await act(async () => { ok = await result.current.proposeChanges([{ fieldKey: 'x', proposedValue: 1 }]); });
        expect(ok).toBe(false);
    });

    it('createReviewLink builds the URL from path and copies to clipboard', async () => {
        mockCallable.mockResolvedValueOnce({ data: { token: 't1', path: '/review-change/t1' } });
        const writeText = vi.fn().mockResolvedValue();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { result } = renderHook(() => useApplicationChanges(...args));
        let url;
        await act(async () => { url = await result.current.createReviewLink(); });
        expect(url).toBe(`${window.location.origin}/review-change/t1`);
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/review-change/t1`);
        vi.unstubAllGlobals();
    });
});
