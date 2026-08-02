import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess, showError }),
}));

import { useApplicationDelete } from './useApplicationDelete';

describe('useApplicationDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCallable.mockResolvedValue({ data: { success: true } });
    });

    it('calls the deleteApplication callable with the ids and returns true on success', async () => {
        const { result } = renderHook(() => useApplicationDelete());
        let ok;
        await act(async () => {
            ok = await result.current.deleteApplication({ companyId: 'co1', applicationId: 'app1', collectionName: 'applications' });
        });
        expect(ok).toBe(true);
        expect(mockCallable).toHaveBeenCalledWith({ companyId: 'co1', applicationId: 'app1', collectionName: 'applications' });
        expect(showSuccess).toHaveBeenCalled();
    });

    it('guards against missing ids without calling the backend', async () => {
        const { result } = renderHook(() => useApplicationDelete());
        let ok;
        await act(async () => { ok = await result.current.deleteApplication({ companyId: 'co1' }); });
        expect(ok).toBe(false);
        expect(mockCallable).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalled();
    });

    it('returns false and surfaces an error when the callable rejects', async () => {
        mockCallable.mockRejectedValueOnce(new Error('permission-denied'));
        const { result } = renderHook(() => useApplicationDelete());
        let ok;
        await act(async () => { ok = await result.current.deleteApplication({ companyId: 'co1', applicationId: 'app1' }); });
        expect(ok).toBe(false);
        expect(showError).toHaveBeenCalled();
    });
});
