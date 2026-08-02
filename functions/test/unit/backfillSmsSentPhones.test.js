const mockAssertCompanyAdminStrict = jest.fn().mockResolvedValue(true);
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(true);

const logsGet = jest.fn().mockResolvedValue({
    empty: false,
    docs: [
        {
            data: () => ({
                recipientIdentity: '(555) 123-4567',
                status: 'delivered',
                timestamp: new Date()
            })
        },
        {
            data: () => ({
                recipientIdentity: '+44 20 7946 0018',
                status: 'delivered',
                timestamp: new Date()
            })
        },
        {
            data: () => ({
                recipientIdentity: 'No Phone',
                status: 'delivered',
                timestamp: new Date()
            })
        }
    ]
});

const mockDb = {
    batch: jest.fn(() => ({
        set: mockBatchSet,
        delete: jest.fn(),
        commit: mockBatchCommit,
    })),
    collection: jest.fn((name) => {
        if (name !== 'companies') return {};

        return {
            doc: jest.fn(() => ({
                collection: jest.fn((sub) => {
                    if (sub === 'bulk_sessions') {
                        return {
                            get: jest.fn().mockResolvedValue({
                                docs: [
                                    {
                                        id: 'session-1',
                                        data: () => ({ config: { method: 'sms' } })
                                    }
                                ]
                            }),
                            doc: jest.fn(() => ({
                                collection: jest.fn((inner) => {
                                    if (inner === 'logs') {
                                        return {
                                            where: jest.fn(() => ({ get: logsGet }))
                                        };
                                    }
                                    return {};
                                })
                            }))
                        };
                    }

                    if (sub === 'sms_sent_phones') {
                        return {
                            doc: jest.fn((id) => ({ id }))
                        };
                    }

                    return {};
                })
            }))
        };
    })
};

const mockAdmin = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true })
        }
    }
};

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (opts, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: mockAdmin,
    db: mockDb
}));

jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAdminStrict: (...args) => mockAssertCompanyAdminStrict(...args)
}));

const backfillTools = require('../../bulkActions/admin/backfillSmsSentPhones');

describe('backfillSmsSentPhones canonical validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('accepts canonical normalized keys and does not drop valid standardized numbers', async () => {
        const result = await backfillTools.backfillSmsSentPhones({
            auth: { uid: 'u1' },
            data: { companyId: 'co1' }
        });

        expect(result.success).toBe(true);
        const writtenDocIds = mockBatchSet.mock.calls.map((call) => call[0].id);

        expect(writtenDocIds).toContain('+15551234567');
        expect(writtenDocIds).toContain('+442079460018');
        expect(writtenDocIds).not.toContain('No Phone');
        expect(mockBatchCommit).toHaveBeenCalled();
    });
});
