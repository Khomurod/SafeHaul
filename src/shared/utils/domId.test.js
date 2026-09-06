import { describe, expect, it } from 'vitest';
import { domIdSegment } from './domId';

describe('domIdSegment', () => {
    it('leaves an already-safe value untouched, so frozen ids the E2E specs click do not move', () => {
        expect(domIdSegment('yes')).toBe('yes');
        expect(domIdSegment('consent-mvr')).toBe('consent-mvr');
        expect(domIdSegment('5+')).toBe('5-');
        expect(domIdSegment(3)).toBe('3');
    });

    it('collapses whitespace and punctuation into single hyphens', () => {
        expect(domIdSegment('0-6 months')).toBe('0-6-months');
        expect(domIdSegment('Owner / Operator')).toBe('Owner-Operator');
        expect(domIdSegment('a  b\tc')).toBe('a-b-c');
    });

    it('never yields a segment that would break a selector built from the id', () => {
        for (const value of ['0-6 months', '6-12 months', '1-2 years', 'Student / Recent Grad', 'New']) {
            expect(domIdSegment(value)).toMatch(/^[A-Za-z0-9_-]+$/);
        }
    });
});
