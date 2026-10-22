import { describe, expect, it } from 'vitest';
import { MAX_PEV_COPIES, formatPevCopies, parsePevCopies } from './pevCopies';

describe('parsePevCopies', () => {
    it('reads addresses split by commas, semicolons, spaces or new lines, lower-cased and each once', () => {
        expect(parsePevCopies('Ops@Carrier.test, safety@carrier.test;ops@carrier.test\nhr@carrier.test  ')).toEqual({
            emails: ['ops@carrier.test', 'safety@carrier.test', 'hr@carrier.test'],
            error: null,
        });
    });

    it('drops the employer being asked, whatever its case', () => {
        expect(parsePevCopies('HR@Old.test, ops@carrier.test', 'hr@old.test').emails).toEqual(['ops@carrier.test']);
    });

    it('reads an empty field as copying no one', () => {
        expect(parsePevCopies('  ,; ')).toEqual({ emails: [], error: null });
        expect(parsePevCopies(undefined)).toEqual({ emails: [], error: null });
    });

    it('names the first address that is not one', () => {
        expect(parsePevCopies('ops@carrier.test, not-an-address')).toEqual({
            emails: [],
            error: '"not-an-address" is not a valid email address.',
        });
    });

    it(`refuses more than ${MAX_PEV_COPIES} people, counting each address once`, () => {
        const five = ['a', 'b', 'c', 'd', 'e'].map((n) => `${n}@x.test`);
        expect(parsePevCopies([...five, 'A@x.test'].join(',')).emails).toEqual(five);
        expect(parsePevCopies([...five, 'f@x.test'].join(','))).toEqual({ emails: [], error: 'Copy at most 5 people.' });
    });
});

describe('formatPevCopies', () => {
    it('shows a saved list as one line, skipping anything that is not an address string', () => {
        expect(formatPevCopies(['ops@carrier.test', '', null, 'hr@carrier.test'])).toBe('ops@carrier.test, hr@carrier.test');
        expect(formatPevCopies(undefined)).toBe('');
    });
});
