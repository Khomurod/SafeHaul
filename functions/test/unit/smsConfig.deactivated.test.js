/**
 * The SMS callables that check a company admin by membership refuse the admin
 * of a deactivated company before they touch its provider; a super admin is
 * never asked. The deactivation itself is read in shared/companyAccess.js
 * (companyAccess.deactivated.test.js). All ids are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
const mockGetAdapter = jest.fn();
jest.mock('../../integrations/factory', () => ({ getAdapter: (...args) => mockGetAdapter(...args) }));
jest.mock('../../integrations/encryption', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../../integrations/adapters/ringcentral', () => class {});
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));

const mockWrites = [];
jest.mock('../../firebaseAdmin', () => {
    const doc = (path) => ({
        get: async () => ({ exists: false, data: () => undefined }),
        set: async (data) => { mockWrites.push({ path, data }); },
        update: async (data) => { mockWrites.push({ path, data }); },
        collection: (name) => collection(`${path}/${name}`),
    });
    const collection = (path) => ({
        doc: (id) => doc(`${path}/${id}`),
        // Every membership query finds the caller as the company's admin.
        where: () => ({ where: () => ({ get: async () => ({ empty: false, docs: [{ data: () => ({ role: 'company_admin' }) }] }) }) }),
    });
    return {
        admin: { firestore: Object.assign(() => ({ collection }), { FieldValue: { serverTimestamp: () => 'server-time' } }) },
    };
});

const mockAssertCompanyActive = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
    ...jest.requireActual('../../shared/companyAccess'),
    assertCompanyActive: (...args) => mockAssertCompanyActive(...args),
}));

const { saveIntegrationConfig, verifySmsConfig, verifyLineConnection } = require('../../integrations/controllers/configController');

const ADMIN = { uid: 'admin-1', token: { roles: { 'co-off': 'company_admin' } } };
const SUPER = { uid: 'super-1', token: { globalRole: 'super_admin', roles: {} } };
const deactivated = () => Object.assign(new Error('This company has been deactivated.'), { code: 'permission-denied' });

const CALLS = [
    ['saveIntegrationConfig', (auth) => saveIntegrationConfig({ auth, data: { companyId: 'co-off', provider: '8x8', config: { apiKey: 'k' } } })],
    ['verifySmsConfig', (auth) => verifySmsConfig({ auth, data: { companyId: 'co-off' } })],
    ['verifyLineConnection', (auth) => verifyLineConnection({ auth, data: { companyId: 'co-off', phoneNumber: '+15551234567' } })],
];

beforeEach(() => {
    jest.clearAllMocks();
    mockWrites.length = 0;
    mockAssertCompanyActive.mockReset().mockRejectedValue(deactivated());
    mockGetAdapter.mockReset().mockRejectedValue(new Error('the provider was reached'));
});

describe('a deactivated company', () => {
    test.each(CALLS)("%s refuses the company's admin before touching the provider", async (_name, call) => {
        await expect(call(ADMIN)).rejects.toMatchObject({ code: 'permission-denied', message: 'This company has been deactivated.' });
        expect(mockAssertCompanyActive).toHaveBeenCalledWith('co-off');
        expect(mockGetAdapter).not.toHaveBeenCalled();
        expect(mockWrites).toEqual([]);
    });

    test.each(CALLS)('%s never asks for a super admin', async (_name, call) => {
        await call(SUPER).catch(() => {});
        expect(mockAssertCompanyActive).not.toHaveBeenCalled();
    });
});
