// A `sending` claim lapses ten minutes after its approval, and the Documents
// workspace must say so at that moment, not on the next unrelated render. The
// hook keeps one timer, for the earliest fresh claim, and clears it when the
// claims change or the caller unmounts. All fixtures are artificial.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_LIFETIME_MS, sendingClaimExpiresAt } from '@features/signing/utils/signedCopy';
import { useRerenderWhenClaimsExpire } from './useRerenderWhenClaimsExpire';

const NOW = Date.parse('2026-11-04T15:00:00Z');
const MINUTE = 60 * 1000;
const sending = (agoMs) => ({ state: 'sending', sentTo: 'pat@example.test', approvedAt: new Date(NOW - agoMs) });

describe('sendingClaimExpiresAt', () => {
    it('is when a fresh claim lapses', () => {
        expect(sendingClaimExpiresAt(sending(MINUTE), NOW)).toBe(NOW - MINUTE + CLAIM_LIFETIME_MS);
    });

    it('reads a Firestore timestamp', () => {
        const record = { state: 'sending', approvedAt: { seconds: (NOW - 2 * MINUTE) / 1000 } };
        expect(sendingClaimExpiresAt(record, NOW)).toBe(NOW - 2 * MINUTE + CLAIM_LIFETIME_MS);
    });

    it.each([
        ['a claim that has lapsed', sending(CLAIM_LIFETIME_MS)],
        ['a claim with no approval time', { state: 'sending' }],
        ['a sent copy', { state: 'sent', approvedAt: new Date(NOW) }],
        ['a failed copy', { state: 'failed', approvedAt: new Date(NOW) }],
        ['no record', null],
    ])('is null for %s', (_label, record) => {
        expect(sendingClaimExpiresAt(record, NOW)).toBeNull();
    });
});

describe('useRerenderWhenClaimsExpire', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function renderCounting(records) {
        let renders = 0;
        const utils = renderHook(({ list }) => {
            renders += 1;
            useRerenderWhenClaimsExpire(list);
        }, { initialProps: { list: records } });
        return { ...utils, renders: () => renders };
    }

    it('sets no timer without a fresh claim', () => {
        renderCounting([null, { state: 'sent' }, { state: 'failed' }, sending(CLAIM_LIFETIME_MS + 1)]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('re-renders just after the earliest claim lapses, then the next, then stops', () => {
        // The nine-minute-old claim lapses in one minute, the other in eight.
        const { renders } = renderCounting([sending(2 * MINUTE), sending(9 * MINUTE), null]);
        expect(vi.getTimerCount()).toBe(1);
        const start = renders();

        act(() => { vi.advanceTimersByTime(MINUTE - 1); });
        expect(renders()).toBe(start);
        act(() => { vi.advanceTimersByTime(2000); });
        expect(renders()).toBe(start + 1);
        expect(vi.getTimerCount()).toBe(1);

        act(() => { vi.advanceTimersByTime(7 * MINUTE); });
        expect(renders()).toBe(start + 2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops its timer when the claim is settled', () => {
        const { rerender } = renderCounting([sending(MINUTE)]);
        expect(vi.getTimerCount()).toBe(1);
        rerender({ list: [{ state: 'sent', sentTo: 'pat@example.test' }] });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears its timer on unmount', () => {
        const { unmount, renders } = renderCounting([sending(MINUTE)]);
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
        const before = renders();
        act(() => { vi.advanceTimersByTime(CLAIM_LIFETIME_MS); });
        expect(renders()).toBe(before);
    });
});
