/**
 * A submitted application or lead is staged into drivers/{id}/pending_updates,
 * which nothing reads. It must not carry the SSN: a copy, even encrypted, is one
 * more place the number lives.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

const mockStaged = [];
jest.mock('../../firebaseAdmin', () => {
    const doc = () => ({
        collection: (name) => ({ add: async (data) => { if (name === 'pending_updates') mockStaged.push(data); } }),
        update: async () => {},
        get: async () => ({ exists: false }),
    });
    return {
        admin: { firestore: { FieldValue: { serverTimestamp: () => 'srv', arrayUnion: (...v) => v } } },
        db: { collection: () => ({ doc, where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }) }) },
        auth: { getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); } },
    };
});
const mockEncrypt = jest.fn((v) => `enc:${v}`);
jest.mock('../../integrations/encryption', () => ({ encrypt: (...a) => mockEncrypt(...a), decrypt: jest.fn() }));

const { onCompanyLeadSubmitted } = require('../../driverSync');

it('stages a submission without any copy of the SSN', async () => {
    await onCompanyLeadSubmitted({
        params: { companyId: 'co1', leadId: 'lead1' },
        data: { data: () => ({ email: 'dana@example.test', firstName: 'Dana', lastName: 'Driver', ssn: '123-45-6789', companyId: 'co1' }) },
    });

    expect(mockStaged).toHaveLength(1);
    expect(mockStaged[0].proposedChanges.personalInfo).toMatchObject({ firstName: 'Dana', email: 'dana@example.test' });
    expect(JSON.stringify(mockStaged[0])).not.toMatch(/ssn|123-45-6789/i);
    expect(mockEncrypt).not.toHaveBeenCalled();
});
