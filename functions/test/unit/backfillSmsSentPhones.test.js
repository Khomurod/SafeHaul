/**
 * The SMS history backfill fills `sms_sent_phones`, the ledger the "recently
 * messaged" filter reads before a campaign texts a number again. Each number
 * must end with its newest delivery: sessions and their logs come back in id
 * order, not in time order, and the live sender stamps the ledger as it texts.
 * All data is artificial.
 */
const mockAssertCompanyAdminStrict = jest.fn().mockResolvedValue(true);

/** companyId -> [{ id, data, logs: [log data] }] */
const mockSessions = new Map();
/** `companyId/phone` -> ledger entry */
const mockLedger = new Map();
const mockLedgerWrites = [];

const at = (iso) => ({ toMillis: () => Date.parse(iso), iso });

const mockWrite = (ref, data) => {
    mockLedgerWrites.push({ key: ref.key, data });
    mockLedger.set(ref.key, { ...(mockLedger.get(ref.key) || {}), ...data });
};

const mockDb = {
    batch: () => {
        const pending = [];
        return { set: (ref, data) => pending.push([ref, data]), commit: async () => pending.forEach(([ref, data]) => mockWrite(ref, data)) };
    },
    collection: jest.fn((name) => {
        if (name !== 'companies') return {};
        const companyIds = () => [...mockSessions.keys()].sort();
        const page = (ids) => ({ get: async () => ({ size: ids.length, docs: ids.map((id) => ({ id })) }) });
        return {
            ...page(companyIds()),
            orderBy: () => ({
                ...page(companyIds()),
                startAfter: (afterId) => page(companyIds().filter((id) => id > afterId)),
            }),
            doc: (companyId) => ({
                collection: (sub) => {
                    if (sub === 'bulk_sessions') {
                        const sessions = mockSessions.get(companyId) || [];
                        return {
                            get: async () => ({ docs: sessions.map((s) => ({ id: s.id, data: () => s.data })) }),
                            doc: (sessionId) => ({
                                collection: () => ({
                                    where: () => ({
                                        get: async () => {
                                            const logs = sessions.find((s) => s.id === sessionId)?.logs || [];
                                            return { empty: logs.length === 0, docs: logs.map((log) => ({ data: () => log })) };
                                        },
                                    }),
                                }),
                            }),
                        };
                    }
                    if (sub === 'sms_sent_phones') {
                        return { doc: (phone) => ({ id: phone, key: `${companyId}/${phone}` }) };
                    }
                    return {};
                },
            }),
        };
    }),
    runTransaction: async (callback) => callback({
        getAll: async (...refs) => refs.map((ref) => ({
            exists: mockLedger.has(ref.key),
            data: () => mockLedger.get(ref.key),
        })),
        set: mockWrite,
    }),
};

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (opts, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } },
    db: mockDb,
}));

jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAdminStrict: (...args) => mockAssertCompanyAdminStrict(...args),
}));

const backfillTools = require('../../bulkActions/admin/backfillSmsSentPhones');

const runFor = (companyId) => backfillTools.backfillSmsSentPhones({ auth: { uid: 'u1' }, data: { companyId } });
const delivered = (recipientIdentity, timestamp) => ({ recipientIdentity, status: 'delivered', timestamp });

beforeEach(() => {
    jest.clearAllMocks();
    mockSessions.clear();
    mockLedger.clear();
    mockLedgerWrites.length = 0;
});

describe('backfillSmsSentPhones', () => {
    it('accepts canonical normalized keys and does not drop valid standardized numbers', async () => {
        mockSessions.set('co1', [{
            id: 'session-1',
            data: { config: { method: 'sms' } },
            logs: [
                delivered('(555) 123-4567', at('2026-10-01T12:00:00Z')),
                delivered('+44 20 7946 0018', at('2026-10-01T12:00:00Z')),
                delivered('No Phone', at('2026-10-01T12:00:00Z')),
            ],
        }]);

        const result = await runFor('co1');

        expect(result.success).toBe(true);
        expect(mockLedgerWrites.map((write) => write.key).sort()).toEqual(['co1/+15551234567', 'co1/+442079460018']);
    });

    it("keeps each number's newest delivery, whatever order the sessions come in", async () => {
        mockSessions.set('co1', [
            { id: 'a', data: {}, logs: [delivered('(555) 123-4567', at('2026-10-01T12:00:00Z'))] },
            { id: 'b', data: {}, logs: [delivered('(555) 123-4567', at('2025-01-01T12:00:00Z'))] },
        ]);

        await runFor('co1');

        expect(mockLedger.get('co1/+15551234567')).toMatchObject({ lastSentAt: { iso: '2026-10-01T12:00:00Z' }, sessionId: 'a' });
    });

    it('never moves a newer ledger entry back to an older delivery', async () => {
        mockLedger.set('co1/+15551234567', { lastSentAt: at('2026-10-14T09:00:00Z'), sessionId: 'live' });
        mockSessions.set('co1', [{ id: 'old', data: {}, logs: [delivered('(555) 123-4567', at('2026-01-01T12:00:00Z'))] }]);

        await runFor('co1');

        expect(mockLedgerWrites).toEqual([]);
        expect(mockLedger.get('co1/+15551234567').sessionId).toBe('live');
    });

    it('writes nothing for a delivery with no time, which cannot say how recent it was', async () => {
        mockSessions.set('co1', [{ id: 'a', data: {}, logs: [delivered('(555) 123-4567', undefined)] }]);

        await runFor('co1');

        expect(mockLedgerWrites).toEqual([]);
    });
});

describe('backfillAllSmsSentPhones', () => {
    const SUPER_ADMIN = { uid: 'sa', token: { roles: { globalRole: 'super_admin' } } };

    it('continues after the company a cut-short run names', async () => {
        for (const id of ['co1', 'co2', 'co3']) {
            mockSessions.set(id, [{ id: 's', data: {}, logs: [delivered('(555) 123-4567', at('2026-10-01T12:00:00Z'))] }]);
        }

        const result = await backfillTools.backfillAllSmsSentPhones({ auth: SUPER_ADMIN, data: { startAfterCompanyId: 'co1' } });

        expect(result.summaries.map((summary) => summary.companyId)).toEqual(['co2', 'co3']);
        expect(result.truncated).toBe(false);
        expect(result.nextCompanyId).toBeNull();
    });

    it('names the last company it finished when it runs out of time', async () => {
        for (const id of ['co1', 'co2']) mockSessions.set(id, []);
        const realNow = Date.now;
        let calls = 0;
        // The first look at the clock is the start; the third is past the budget.
        Date.now = () => (calls++ < 2 ? 0 : 9 * 60 * 1000);
        try {
            const result = await backfillTools.backfillAllSmsSentPhones({ auth: SUPER_ADMIN, data: {} });

            expect(result.truncated).toBe(true);
            expect(result.nextCompanyId).toBe('co1');
            expect(result.message).toContain('co1');
        } finally {
            Date.now = realNow;
        }
    });
});
