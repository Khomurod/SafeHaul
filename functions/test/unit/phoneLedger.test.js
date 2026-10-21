const { derivePhoneLedgerKeys } = require('../../bulkActions/helpers/phoneLedger');

describe('phoneLedger helper', () => {
    it('derives deterministic canonical + legacy-compatible keys for US numbers', () => {
        const out = derivePhoneLedgerKeys('(555) 123-4567');
        expect(out.canonical).toBe('+15551234567');
        expect(new Set(out.lookupKeys)).toEqual(new Set([
            '+15551234567',
            '15551234567',
            '5551234567',
        ]));
    });

    it('handles unusual but valid long-form numbers and keeps canonical stable', () => {
        const out = derivePhoneLedgerKeys('+44 20 7946 0018');
        expect(out.canonical).toBe('+442079460018');
        expect(new Set(out.lookupKeys)).toEqual(new Set([
            '+442079460018',
            '442079460018',
        ]));
    });

    it('returns empty lookup for malformed input', () => {
        expect(derivePhoneLedgerKeys('123')).toEqual({ canonical: null, lookupKeys: [] });
    });
});
