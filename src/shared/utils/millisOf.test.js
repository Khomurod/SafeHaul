import { describe, expect, it } from 'vitest';
import { millisOf } from './millisOf';

describe('millisOf', () => {
    it('reads a Timestamp, its plain { seconds } form and a Date', () => {
        expect(millisOf({ toMillis: () => 1_700_000_000_123 })).toBe(1_700_000_000_123);
        expect(millisOf({ seconds: 1_700_000_000, nanoseconds: 0 })).toBe(1_700_000_000_000);
        expect(millisOf(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    });

    it('reads nothing else as a time', () => {
        for (const value of [null, undefined, '', '2026-11-07', 1_700_000_000_000, {}, { seconds: '1' }]) {
            expect(millisOf(value)).toBeNull();
        }
    });
});
