/**
 * A Company Admin's API keys: made only by an admin of that company, shown once,
 * stored as a hash, at most five turned on, and turned off for good.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('../../firebaseAdmin', () => require('./companyApi.support').firebaseAdminMock());
const mockCheckRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...args) => mockCheckRateLimit(...args) }));
const mockAssertCompanyAdminStrict = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAdminStrict: (...args) => mockAssertCompanyAdminStrict(...args),
}));

const { HttpsError } = require('firebase-functions/v2/https');
const support = require('./companyApi.support');
const { hashKey, keyMatches } = require('../../companyApi/apiKeys');
const { createCompanyApiKey, listCompanyApiKeys, revokeCompanyApiKey } = require('../../companyApi/keyCallables');

const ADMIN = { uid: 'admin-uid', token: { name: 'Dana Admin', email: 'dana@example.test' } };
const call = (fn, data, auth = ADMIN) => fn({ data, auth });
const storedKeys = () => [...support.docs.entries()].filter(([path]) => path.startsWith('company_api_keys/'));

beforeEach(() => {
    jest.resetAllMocks();
    support.reset();
    mockCheckRateLimit.mockResolvedValue(true);
    mockAssertCompanyAdminStrict.mockImplementation(async (uid, companyId) => {
        if (uid !== 'admin-uid' || companyId !== 'co-a') throw new HttpsError('permission-denied', 'Company Admins only.');
    });
});

describe('making a key', () => {
    it('returns the key once and keeps only its hash', async () => {
        const made = await call(createCompanyApiKey, { companyId: 'co-a', name: '  Our   TMS ', scopes: ['documents:read'] });

        expect(made).toEqual(expect.objectContaining({
            name: 'Our TMS', scopes: ['applications:read', 'documents:read'], prefix: `shk_${made.keyId}_…`,
        }));
        const stored = support.docs.get(`company_api_keys/${made.keyId}`);
        expect(stored).toEqual(expect.objectContaining({
            companyId: 'co-a', name: 'Our TMS', hash: hashKey(made.key), createdBy: 'admin-uid',
            createdByName: 'Dana Admin', lastUsedAt: null, revokedAt: null,
        }));
        expect(keyMatches(stored.hash, made.key)).toBe(true);
        expect(JSON.stringify(stored)).not.toContain(made.key.split('_')[2]);
    });

    it('refuses anyone but a Company Admin of that company, and keeps nothing', async () => {
        await expect(call(createCompanyApiKey, { companyId: 'co-b', name: 'TMS' })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(call(createCompanyApiKey, { companyId: 'co-a', name: 'TMS' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(storedKeys()).toHaveLength(0);
    });

    it('refuses a missing name and a permission this API does not know', async () => {
        await expect(call(createCompanyApiKey, { companyId: 'co-a', name: ' ' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call(createCompanyApiKey, { companyId: 'co-a', name: 'TMS', scopes: ['applications:write'] }))
            .rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('applications:write') });
        expect(storedKeys()).toHaveLength(0);
    });

    it('stops a loop of key-making, and fails closed', async () => {
        mockCheckRateLimit.mockResolvedValue(false);
        await expect(call(createCompanyApiKey, { companyId: 'co-a', name: 'TMS' })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith('api_key_mint_admin-uid', 10, 300, 'closed');
        expect(storedKeys()).toHaveLength(0);
    });

    it('allows five turned-on keys; a turned-off one does not count', async () => {
        support.seedKey('co-a', { revokedAt: new Date('2026-10-02T00:00:00Z') });
        support.seedKey('co-b');
        for (let i = 0; i < 5; i += 1) await call(createCompanyApiKey, { companyId: 'co-a', name: `Key ${i}` });

        await expect(call(createCompanyApiKey, { companyId: 'co-a', name: 'One more' })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(storedKeys().filter(([, data]) => data.companyId === 'co-a')).toHaveLength(6);
    });
});

describe('listing keys', () => {
    it('lists only this company’s keys, turned-on and newest first, never a hash', async () => {
        const old = support.seedKey('co-a', { name: 'Old' });
        const off = support.seedKey('co-a', { name: 'Off', revokedAt: new Date('2026-10-03T00:00:00Z') });
        support.seedKey('co-b', { name: 'Theirs' });
        const made = await call(createCompanyApiKey, { companyId: 'co-a', name: 'New' });

        const listed = await call(listCompanyApiKeys, { companyId: 'co-a' });

        expect(listed.keys.map((key) => key.keyId)).toEqual([made.keyId, old.keyId, off.keyId]);
        expect(listed.maxActiveKeys).toBe(5);
        expect(Object.keys(listed.scopes)).toEqual(['applications:read', 'documents:read', 'ssn:read']);
        expect(JSON.stringify(listed)).not.toMatch(/hash|shk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}/);
    });

    it('refuses anyone but a Company Admin', async () => {
        await expect(call(listCompanyApiKeys, { companyId: 'co-b' })).rejects.toMatchObject({ code: 'permission-denied' });
    });
});

describe('turning a key off', () => {
    it('turns it off for good, and saying it twice changes nothing', async () => {
        const { keyId } = support.seedKey('co-a');

        await expect(call(revokeCompanyApiKey, { companyId: 'co-a', keyId })).resolves.toEqual({ keyId, revoked: true, alreadyRevoked: false });
        const revoked = support.docs.get(`company_api_keys/${keyId}`);
        expect(revoked.revokedAt).toBeInstanceOf(Date);
        expect(revoked).toEqual(expect.objectContaining({ revokedBy: 'admin-uid', revokedByName: 'Dana Admin' }));

        await expect(call(revokeCompanyApiKey, { companyId: 'co-a', keyId })).resolves.toEqual({ keyId, revoked: true, alreadyRevoked: true });
    });

    it('answers another company’s key, or a malformed id, as no key at all', async () => {
        const theirs = support.seedKey('co-b');

        await expect(call(revokeCompanyApiKey, { companyId: 'co-a', keyId: theirs.keyId })).rejects.toMatchObject({ code: 'not-found' });
        await expect(call(revokeCompanyApiKey, { companyId: 'co-a', keyId: '../co-b' })).rejects.toMatchObject({ code: 'not-found' });
        expect(support.docs.get(`company_api_keys/${theirs.keyId}`).revokedAt).toBeNull();
    });
});
