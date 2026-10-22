import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ getDoc: vi.fn(), doc: vi.fn((_db, ...path) => ({ path: path.join('/') })) }));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { usePevDefaultCopies } from './usePevDefaultCopies';

const saved = (data) => ({ exists: () => data !== undefined, data: () => data });

describe('usePevDefaultCopies', () => {
    beforeEach(() => {
        fs.getDoc.mockReset();
        fs.doc.mockClear();
    });

    it('takes the list saved on the company since the profile loaded', async () => {
        fs.getDoc.mockResolvedValue(saved({ pevCcEmails: ['new@carrier.test'] }));
        const { result } = renderHook(() => usePevDefaultCopies('co-1', ['old@carrier.test']));

        expect(result.current).toEqual({ copies: ['old@carrier.test'], loaded: false });
        await waitFor(() => expect(result.current).toEqual({ copies: ['new@carrier.test'], loaded: true }));
        expect(fs.doc).toHaveBeenCalledWith({}, 'companies', 'co-1');
    });

    it('keeps the profile list when the company has none saved, or the read fails', async () => {
        fs.getDoc.mockResolvedValueOnce(saved({}));
        const first = renderHook(() => usePevDefaultCopies('co-1', ['old@carrier.test']));
        await waitFor(() => expect(first.result.current).toEqual({ copies: ['old@carrier.test'], loaded: true }));

        fs.getDoc.mockRejectedValueOnce(new Error('offline'));
        const second = renderHook(() => usePevDefaultCopies('co-1', ['old@carrier.test']));
        await waitFor(() => expect(second.result.current).toEqual({ copies: ['old@carrier.test'], loaded: true }));
    });

    it('reads nothing without a company', () => {
        const { result } = renderHook(() => usePevDefaultCopies(undefined, undefined));
        expect(result.current).toEqual({ copies: [], loaded: true });
        expect(fs.getDoc).not.toHaveBeenCalled();
    });
});
