/**
 * "Sync Backend Structure" wrote schema defaults into every live record missing
 * a field. Old Production screens still offer its button, so the callable stays,
 * and refuses everyone without touching the database.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
const mockCollection = jest.fn();
jest.mock('../../firebaseAdmin', () => ({ admin: {}, db: { collection: (...a) => mockCollection(...a) } }));

const { syncSystemStructure } = require('../../systemIntegrity');

it('refuses even the Super Admin, and reads or writes nothing', async () => {
    const owner = { auth: { uid: 'owner', token: { roles: { globalRole: 'super_admin' } } }, data: {} };
    await expect(syncSystemStructure(owner)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockCollection).not.toHaveBeenCalled();
});
