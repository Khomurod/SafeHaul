/**
 * A preview link for a document already on the application: signed when someone
 * looks, reused while it is fresh. `getSignedGuestUploadUrl` allows twenty a minute
 * per IP and a truck stop's Wi-Fi is one IP, so a revisited step, a second field
 * showing the same file or a re-render must not sign again. A failure is never
 * remembered.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sign: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: () => (payload) => mocks.sign(payload) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));

import * as previewModule from './useSignedUploadPreview';

const { PREVIEW_STATE, useSignedUploadPreview } = previewModule;
const upload = (storagePath = 'guest_uploads/c1/session-1/cdl-front.jpg') => ({ name: 'cdl-front.jpg', storagePath });
const look = (value) => renderHook(({ v }) => useSignedUploadPreview(v, 'c1'), { initialProps: { v: value } });

beforeEach(() => {
    previewModule.resetSignedPreviewCache?.();
    mocks.sign.mockReset();
    let minted = 0;
    mocks.sign.mockImplementation(async () => { minted += 1; return { data: { url: `https://signed.example/${minted}` } }; });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useSignedUploadPreview', () => {
    it('signs a document once while its link is fresh: a new copy of the value, a revisit or another field reuse it', async () => {
        const field = look(upload());
        await waitFor(() => expect(field.result.current.state).toBe(PREVIEW_STATE.READY));
        field.rerender({ v: upload() });
        field.unmount();

        const revisit = look(upload());
        const another = look(upload());
        await waitFor(() => expect(revisit.result.current.url).toBe('https://signed.example/1'));
        await waitFor(() => expect(another.result.current.url).toBe('https://signed.example/1'));

        expect(mocks.sign).toHaveBeenCalledTimes(1);
        expect(mocks.sign).toHaveBeenCalledWith({ companyId: 'c1', storagePath: upload().storagePath });
    });

    it('signs again once the link is ten minutes old, well before its fifteen run out', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
        const first = look(upload());
        await waitFor(() => expect(first.result.current.url).toBe('https://signed.example/1'));
        first.unmount();

        vi.setSystemTime(new Date('2026-10-15T09:09:00Z'));
        const soon = look(upload());
        await waitFor(() => expect(soon.result.current.url).toBe('https://signed.example/1'));
        soon.unmount();

        vi.setSystemTime(new Date('2026-10-15T09:10:30Z'));
        const later = look(upload());
        await waitFor(() => expect(later.result.current.url).toBe('https://signed.example/2'));
        expect(mocks.sign).toHaveBeenCalledTimes(2);
    });

    it('signs another document on its own', async () => {
        const front = look(upload());
        const back = look(upload('guest_uploads/c1/session-1/cdl-back.jpg'));
        await waitFor(() => expect(back.result.current.state).toBe(PREVIEW_STATE.READY));
        await waitFor(() => expect(front.result.current.state).toBe(PREVIEW_STATE.READY));

        expect(mocks.sign).toHaveBeenCalledTimes(2);
        expect(front.result.current.url).not.toBe(back.result.current.url);
    });

    it('does not remember a failure: Try again signs afresh', async () => {
        mocks.sign.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));
        const field = look(upload());
        await waitFor(() => expect(field.result.current.state).toBe(PREVIEW_STATE.ERROR));

        act(() => field.result.current.retry());

        await waitFor(() => expect(field.result.current.state).toBe(PREVIEW_STATE.READY));
        expect(mocks.sign).toHaveBeenCalledTimes(2);
    });

    it('still tells a missing file from a failed look, and remembers neither', async () => {
        mocks.sign.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'functions/not-found' }));
        const field = look(upload());
        await waitFor(() => expect(field.result.current.state).toBe(PREVIEW_STATE.MISSING));
        field.unmount();

        const again = look(upload());
        await waitFor(() => expect(again.result.current.state).toBe(PREVIEW_STATE.READY));
        expect(mocks.sign).toHaveBeenCalledTimes(2);
    });

    it('shows nothing, and signs nothing, without a file', async () => {
        const field = look(null);
        await waitFor(() => expect(field.result.current.state).toBe(PREVIEW_STATE.NONE));
        expect(mocks.sign).not.toHaveBeenCalled();
    });
});
