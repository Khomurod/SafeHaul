jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: {
            Timestamp: {
                fromDate: (d) => d
            }
        }
    }
}));

const {
    derivePhoneLedgerKeys,
    isCanonicalPhoneLedgerKey,
    buildSmsLedgerThreshold,
    findRecentlyMessagedCanonicalPhones,
} = require('../../bulkActions/helpers/phoneLedger');

function createDbWithDocs(docsById) {
    const getAll = jest.fn(async (...docRefs) => docRefs.map((ref) => {
        const data = docsById[ref.id];
        return {
            id: ref.id,
            exists: !!data,
            data: () => data,
        };
    }));

    return {
        getAll,
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                collection: jest.fn(() => ({
                    doc: jest.fn((id) => ({ id })),
                })),
            })),
        })),
    };
}

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

    it('returns empty lookup for malformed input and validates canonical key shape', () => {
        expect(derivePhoneLedgerKeys('123')).toEqual({ canonical: null, lookupKeys: [] });
        expect(isCanonicalPhoneLedgerKey('+15551234567')).toBe(true);
        expect(isCanonicalPhoneLedgerKey('15551234567')).toBe(false);
    });

    it('finds recently messaged canonicals via legacy-only and canonical-only ledger docs', async () => {
        const now = new Date();
        const db = createDbWithDocs({
            '15551234567': { lastSentAt: now }, // legacy key only
            '+15559876543': { lastSentAt: now }, // canonical key only
        });
        const thresholdTs = buildSmsLedgerThreshold('7');

        const matched = await findRecentlyMessagedCanonicalPhones({
            db,
            companyId: 'co1',
            canonicalPhones: ['+15551234567', '+15559876543'],
            thresholdTs,
        });

        expect(matched).toEqual(new Set(['+15551234567', '+15559876543']));
    });

    it('dedupes canonical matches even when multiple lookup keys hit the same number', async () => {
        const now = new Date();
        const db = createDbWithDocs({
            '+15551234567': { lastSentAt: now },
            '15551234567': { lastSentAt: now },
            '5551234567': { lastSentAt: now },
        });
        const thresholdTs = buildSmsLedgerThreshold('7');

        const matched = await findRecentlyMessagedCanonicalPhones({
            db,
            companyId: 'co1',
            canonicalPhones: ['+15551234567'],
            thresholdTs,
        });

        expect(matched.size).toBe(1);
        expect(matched.has('+15551234567')).toBe(true);
    });

    it('respects threshold and ignores stale ledger entries', async () => {
        const old = new Date('2020-01-01T00:00:00.000Z');
        const db = createDbWithDocs({
            '15551234567': { lastSentAt: old },
        });
        const thresholdTs = buildSmsLedgerThreshold('7');

        const matched = await findRecentlyMessagedCanonicalPhones({
            db,
            companyId: 'co1',
            canonicalPhones: ['+15551234567'],
            thresholdTs,
        });

        expect(matched.size).toBe(0);
    });

    it('treats forever mode as no threshold cutoff', async () => {
        const old = new Date('2020-01-01T00:00:00.000Z');
        const db = createDbWithDocs({
            '+15551234567': { lastSentAt: old },
        });

        const matched = await findRecentlyMessagedCanonicalPhones({
            db,
            companyId: 'co1',
            canonicalPhones: ['+15551234567'],
            thresholdTs: null,
        });

        expect(matched).toEqual(new Set(['+15551234567']));
    });
});
