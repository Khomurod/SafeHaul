/**
 * The link, minted once.
 *
 * The token comes back from the callable exactly once and is never retrievable, so
 * the properties worth pinning are that the URL is built from it correctly and
 * that nothing pretends the link can be looked up later.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ httpsCallable: vi.fn(), call: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: callables.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { useInviteLink } from './useInviteLink';

beforeEach(() => {
    vi.clearAllMocks();
    callables.httpsCallable.mockReturnValue(callables.call);
    callables.call.mockResolvedValue({ data: { inviteToken: 'tok-abc', applicantKey: 'key-1', expiresInDays: 14 } });
    // jsdom defines `navigator.clipboard` as a getter, so it is redefined rather
    // than assigned.
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
});

describe('the driver link', () => {
    it('builds the apply URL from the token and the key', async () => {
        const { result } = renderHook(() => useInviteLink({ companyId: 'co-1', appSlug: 'blue-line' }));

        await act(async () => { await result.current.mint('key-1'); });

        expect(callables.call).toHaveBeenCalledWith({ companyId: 'co-1', applicantKey: 'key-1' });
        expect(result.current.link.url).toContain('/apply/blue-line?invite=tok-abc&k=key-1');
        expect(result.current.link.expiresInDays).toBe(14);
    });

    it('escapes what it puts in the query string', async () => {
        callables.call.mockResolvedValue({ data: { inviteToken: 'a b&c', applicantKey: 'k/1', expiresInDays: 14 } });
        const { result } = renderHook(() => useInviteLink({ companyId: 'co-1', appSlug: 'blue-line' }));

        await act(async () => { await result.current.mint('key-1'); });

        expect(result.current.link.url).toContain('invite=a%20b%26c');
        expect(result.current.link.url).toContain('k=k%2F1');
    });

    it('copies it, and survives a browser that refuses the clipboard', async () => {
        const { result } = renderHook(() => useInviteLink({ companyId: 'co-1', appSlug: 'blue-line' }));
        await act(async () => { await result.current.mint('key-1'); });

        await act(async () => { await result.current.copy(); });
        expect(result.current.copied).toBe(true);

        navigator.clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
        await act(async () => { await result.current.copy(); });
        // The link is still on screen to be selected by hand.
        expect(result.current.copied).toBe(false);
        expect(result.current.link.url).toBeTruthy();
    });

    it('does nothing without an application to mint one for', async () => {
        const { result } = renderHook(() => useInviteLink({ companyId: 'co-1', appSlug: 'blue-line' }));
        await act(async () => { await result.current.mint(null); });
        expect(callables.call).not.toHaveBeenCalled();
        expect(result.current.link).toBeNull();
    });

    it('reports a failure instead of a half-made link', async () => {
        const denied = new Error('nope');
        denied.code = 'functions/permission-denied';
        callables.call.mockRejectedValueOnce(denied);
        const { result } = renderHook(() => useInviteLink({ companyId: 'co-1', appSlug: 'blue-line' }));

        await act(async () => { await result.current.mint('key-1'); });

        expect(result.current.link).toBeNull();
        expect(result.current.error).toMatch(/do not have access/);
    });
});
