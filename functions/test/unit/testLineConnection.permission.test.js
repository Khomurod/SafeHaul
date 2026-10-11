/**
 * Testing an SMS line logs in to RingCentral with the company's stored app
 * credentials, so only that company's admin, or the Super Admin, may ask for it.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
const mockDecrypt = jest.fn((value) => `plain:${value}`);
jest.mock('../../integrations/encryption', () => ({ encrypt: jest.fn(), decrypt: (...a) => mockDecrypt(...a) }));
jest.mock('../../integrations/adapters/ringcentral', () => class {});
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
const mockLogin = jest.fn(async () => {});
jest.mock('@ringcentral/sdk', () => ({
    SDK: Object.assign(class {
        login(...a) { return mockLogin(...a); }
        async get() { return { json: async () => ({ id: 'acct', contact: { firstName: 'Ann', lastName: 'Lee' }, records: [] }) }; }
    }, { server: { sandbox: 'sandbox-url', production: 'prod-url' } }),
}));
jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: Object.assign(
            () => ({
                collection: () => ({
                    doc: () => ({
                        collection: () => ({
                            doc: () => ({
                                get: async () => ({ exists: true, data: () => ({ config: { clientId: 'enc-id', clientSecret: 'enc-secret' } }) }),
                            }),
                        }),
                    }),
                }),
            }),
            { FieldValue: { serverTimestamp: () => '__ts' } },
        ),
    },
}));

const { testLineConnection } = require('../../integrations/controllers/configController');

const call = (token, data) => testLineConnection({ auth: { uid: 'u1', token }, data: { jwt: 'their-jwt', ...data } });

beforeEach(() => {
    mockDecrypt.mockClear();
    mockLogin.mockClear();
});

describe('testLineConnection', () => {
    it.each([
        ['a recruiter of the company', { roles: { co1: 'recruiter' } }],
        ["another company's admin", { roles: { co2: 'company_admin' } }],
        ['a signed-in driver', { roles: {} }],
    ])("refuses %s, before touching the company's credentials", async (_who, token) => {
        await expect(call(token, { companyId: 'co1' })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockDecrypt).not.toHaveBeenCalled();
        expect(mockLogin).not.toHaveBeenCalled();
    });

    it('needs a company', async () => {
        await expect(call({ roles: { globalRole: 'super_admin' } }, { clientId: 'id', clientSecret: 'secret' }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockLogin).not.toHaveBeenCalled();
    });

    it("lets the company's admin and the Super Admin test with the stored credentials", async () => {
        await expect(call({ roles: { co1: 'company_admin' } }, { companyId: 'co1' })).resolves.toMatchObject({ success: true });
        await expect(call({ globalRole: 'super_admin' }, { companyId: 'co1' })).resolves.toMatchObject({ success: true });
        expect(mockDecrypt).toHaveBeenCalledWith('enc-secret');
        expect(mockLogin).toHaveBeenCalledWith({ jwt: 'their-jwt' });
    });
});
