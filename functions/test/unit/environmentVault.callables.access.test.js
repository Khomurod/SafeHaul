/**
 * Who may reach the vault at all: authorization, and how recent their
 * authentication has to be. Plus what the inventory listing may show.
 *
 * Part of the environment-vault callable suite. The Firestore store, the seed
 * documents, the fixtures and the reset are in
 * `environmentVault.callables.support.js`. Each `jest.mock` below has to stay
 * in this file, because Jest hoists it per file and cannot register one from a
 * helper.
 */

jest.mock('firebase-functions/v2/https', () => require('./environmentVault.callables.support').httpsMock());
jest.mock('@ringcentral/sdk', () => require('./environmentVault.callables.support').ringcentralSdkMock());
jest.mock('../../integrations/factory', () => require('./environmentVault.callables.support').integrationFactoryMock());
jest.mock('../../integrations/adapters/eightbyeight', () => require('./environmentVault.callables.support').emptyAdapterMock());
jest.mock('../../integrations/adapters/ringcentral', () => require('./environmentVault.callables.support').emptyAdapterMock());
jest.mock('../../firebaseAdmin', () => require('./environmentVault.callables.support').firebaseAdminMock());

const vault = require('../../environmentVault');
const {
    mock, nowSeconds, superAdmin, request, auditRecords, resetVaultState, restoreVaultState,
    CLIENT_ID_PLAINTEXT, CLIENT_SECRET_PLAINTEXT, LINE_JWT_PLAINTEXT,
    SMTP_PASSWORD_PLAINTEXT, PAGE_TOKEN_PLAINTEXT, GROQ_KEY_PLAINTEXT,
} = require('./environmentVault.callables.support');

beforeEach(resetVaultState);
afterEach(restoreVaultState);

// ---------------------------------------------------------------------------

describe('authorization', () => {
    const callables = [
        ['listEnvironmentAndIntegrations', {}],
        ['revealEnvironmentValue', { entryId: 'secret-manager:GROQ_API_KEY' }],
        ['updateEnvironmentValue', { entryId: 'company:co-alpha:sms_provider:clientSecret', value: 'x' }],
        ['addEnvironmentValue', { entryId: 'company:co-alpha:sms_provider:senderId', value: 'x' }],
        ['deleteEnvironmentValue', { entryId: 'company:co-alpha:sms_provider:jwt', confirmation: 'jwt' }],
        ['testManagedIntegration', { entryId: 'company:co-alpha:sms_provider:provider' }],
    ];

    it.each(callables)('%s rejects unauthenticated callers', async (name, data) => {
        await expect(vault[name](request(null, data))).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each(callables)('%s rejects an ordinary signed-in user', async (name, data) => {
        const auth = { uid: 'user-1', token: { auth_time: nowSeconds() } };
        await expect(vault[name](request(auth, data))).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it.each(callables)('%s rejects a company admin', async (name, data) => {
        const auth = { uid: 'admin-1', token: { roles: { 'co-alpha': 'company_admin' }, auth_time: nowSeconds() } };
        await expect(vault[name](request(auth, data))).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('rejects a company admin even when the claim is nested under roles.globalRole', async () => {
        const auth = { uid: 'admin-2', token: { roles: { globalRole: 'company_admin' }, auth_time: nowSeconds() } };
        await expect(vault.listEnvironmentAndIntegrations(request(auth))).rejects.toMatchObject({
            code: 'permission-denied',
        });
    });

    it('accepts a Super Admin whose claim is nested under roles.globalRole', async () => {
        const auth = { uid: 'super-2', token: { roles: { globalRole: 'super_admin' }, auth_time: nowSeconds() } };
        const result = await vault.listEnvironmentAndIntegrations(request(auth));
        expect(result.entries.length).toBeGreaterThan(0);
    });

    it('records a value-free denial for every rejected call', async () => {
        const auth = { uid: 'user-1', token: { auth_time: nowSeconds() } };
        await expect(vault.revealEnvironmentValue(request(auth, { entryId: 'secret-manager:GROQ_API_KEY' })))
            .rejects.toMatchObject({ code: 'permission-denied' });

        const records = auditRecords();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ action: 'reveal', result: 'denied', reason: 'not-super-admin' });
        expect(JSON.stringify(records[0])).not.toContain(GROQ_KEY_PLAINTEXT);
    });
});

describe('recent authentication', () => {
    const stale = superAdmin({ auth_time: nowSeconds() - (60 * 60) });

    it('is required to reveal', async () => {
        await expect(vault.revealEnvironmentValue(request(stale, { entryId: 'secret-manager:GROQ_API_KEY' })))
            .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('REAUTH_REQUIRED') });
    });

    it('is required to mutate', async () => {
        await expect(vault.updateEnvironmentValue(request(stale, {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: 'replacement',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('is not required merely to list the inventory', async () => {
        const result = await vault.listEnvironmentAndIntegrations(request(stale));
        expect(result.entries.length).toBeGreaterThan(0);
    });

    it('is not satisfied by a missing auth_time claim', async () => {
        const noAuthTime = { uid: 'super-3', token: { globalRole: 'super_admin' } };
        await expect(vault.revealEnvironmentValue(request(noAuthTime, { entryId: 'secret-manager:GROQ_API_KEY' })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

describe('inventory listing', () => {
    it('masks every value and leaks no plaintext or ciphertext', async () => {
        const result = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const payload = JSON.stringify(result);

        for (const secret of [
            CLIENT_ID_PLAINTEXT, CLIENT_SECRET_PLAINTEXT, LINE_JWT_PLAINTEXT,
            SMTP_PASSWORD_PLAINTEXT, PAGE_TOKEN_PLAINTEXT, GROQ_KEY_PLAINTEXT,
        ]) {
            expect(payload).not.toContain(secret);
        }

        // No ciphertext either — a stored `iv:payload` string must not travel.
        const storedCiphertext = mock.docs.get('companies/co-alpha/integrations/sms_provider').config.clientSecret;
        expect(payload).not.toContain(storedCiphertext);

        for (const entry of result.entries) {
            expect(entry.maskedValue).toBe('********');
            expect(entry).not.toHaveProperty('value');
        }
    });

    it('lists global keys and every company credential field separately', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const ids = entries.map((entry) => entry.id);

        expect(ids).toEqual(expect.arrayContaining([
            'secret-manager:SMS_ENCRYPTION_KEY',
            'secret-manager:GROQ_API_KEY',
            'vite-build:VITE_FIREBASE_API_KEY',
            'github-actions-secret:GITHUB_TOKEN',
            'company:co-alpha:sms_provider:clientId',
            'company:co-alpha:sms_provider:clientSecret',
            'company:co-alpha:sms_keychain:+15550001111:jwt',
            'company:co-alpha:email_config:smtpPass',
            'company:co-alpha:facebook_page:page-artificial:accessToken',
        ]));
    });

    it('reports configured, missing and unknown status honestly', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const byId = new Map(entries.map((entry) => [entry.id, entry]));

        expect(byId.get('secret-manager:GROQ_API_KEY').status).toBe('configured');
        expect(byId.get('functions-env:APP_BASE_URL').status).toBe('missing');
        // The Cloud Functions runtime cannot see the browser bundle's values.
        expect(byId.get('vite-build:VITE_FIREBASE_API_KEY').status).toBe('unknown');
        expect(byId.get('vite-build:VITE_FIREBASE_API_KEY').statusResolvedBy).toBe('client-bundle');
        expect(byId.get('github-actions-secret:GITHUB_TOKEN').status).toBe('unknown');
        expect(byId.get('company:co-alpha:sms_provider:clientSecret').status).toBe('configured');
    });

    it('scopes company rows to the requested company when asked', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin(), { companyId: 'co-other' }));
        expect(entries.filter((entry) => entry.scope === 'company')).toHaveLength(0);
        expect(entries.filter((entry) => entry.scope === 'global').length).toBeGreaterThan(0);
    });

    it('labels company rows with the company name and id', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const row = entries.find((entry) => entry.id === 'company:co-alpha:sms_provider:clientSecret');
        expect(row.companyId).toBe('co-alpha');
        expect(row.companyName).toBe('Alpha Test Carrier');
        expect(row.scope).toBe('company');
    });

    it('offers Add rather than Edit on a supported field with nothing stored', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const row = entries.find((entry) => entry.id === 'company:co-alpha:sms_provider:senderId');

        expect(row.status).toBe('missing');
        // An enabled Edit here would be a control guaranteed to fail server-side.
        expect(row.permissions.editable).toBe(false);
        expect(row.permissions.addable).toBe(true);
        expect(row.permissions.revealable).toBe(false);
        expect(row.restrictions.edit).toBe('Nothing is stored yet — use Add');
    });

    it('omits credentials that belong to a provider this company is not using', async () => {
        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        // The seeded company is on RingCentral, so no 8x8 API key row is invented.
        expect(entries.find((entry) => entry.id === 'company:co-alpha:sms_provider:apiKey')).toBeUndefined();
    });
});
