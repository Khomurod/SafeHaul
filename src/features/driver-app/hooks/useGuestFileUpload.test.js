/**
 * The guest upload hook's "still uploading" flag, which the wizard's Continue,
 * the preparation workspace and a Company Admin's editor all wait on before they
 * move on: a document still on its way is not an answer yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ finish: [] }));

vi.mock('firebase/functions', () => ({
    httpsCallable: () => async ({ fileName }) => ({
        data: { storagePath: `companies/company-1/applications/guest_uploads/${fileName}` },
    }),
}));
vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    // Each upload finishes when the test says so.
    uploadBytes: () => new Promise((resolve) => { mocks.finish.push(resolve); }),
}));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import { useGuestFileUpload } from './useGuestFileUpload';

const png = (name) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
    mocks.finish.length = 0;
});

describe('useGuestFileUpload', () => {
    it('is still uploading while any upload is on its way, not only until the first finishes', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let front;
        let back;
        act(() => {
            front = result.current.handleFileUpload('cdl-front', png('front.png'));
            back = result.current.handleFileUpload('cdl-back', png('back.png'));
        });
        await vi.waitFor(() => expect(mocks.finish).toHaveLength(2));
        expect(result.current.isUploading).toBe(true);

        await act(async () => { mocks.finish[0](); await front; });
        expect(result.current.isUploading).toBe(true);

        await act(async () => { mocks.finish[1](); await back; });
        expect(result.current.isUploading).toBe(false);
        await expect(back).resolves.toEqual({
            name: 'back.png', storagePath: 'companies/company-1/applications/guest_uploads/back.png',
        });
    });
});
