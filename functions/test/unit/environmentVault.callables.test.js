/**
 * Behaviour contract for the Environment & Integrations vault callables.
 *
 * These prove the properties the feature exists to guarantee:
 *  - authorization is exactly `globalRole === 'super_admin'` — a company admin
 *    is rejected, not degraded;
 *  - reveal and every mutation additionally require recent authentication;
 *  - the inventory response contains **no** plaintext and no ciphertext;
 *  - a reveal returns exactly one value and never a second entry;
 *  - encrypted company credentials are decrypted server-side;
 *  - a GitHub Actions secret reports its limitation honestly instead of
 *    inventing or omitting a value;
 *  - every reveal writes an audit record that contains no value;
 *  - a mutation touches only the field it names, and is verified by read-back.
 *
 * All company, page and credential values below are artificial.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

// Keep the real SDKs out of the process; the connectivity test is exercised
// separately through its own guard assertions.
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));
jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
jest.mock('../../integrations/adapters/ringcentral', () => class {});

const { createFirestoreMock } = require('../helpers/firestoreMock');

// Real encryption, so the decryption path is genuinely exercised.
const ENCRYPTION_KEY = '01234567890123456789012345678901'; // exactly 32 chars
process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
const { encrypt } = require('../../integrations/encryption');

const CLIENT_ID_PLAINTEXT = 'artificial-client-id';
const CLIENT_SECRET_PLAINTEXT = 'artificial-client-secret';
const LINE_JWT_PLAINTEXT = 'artificial-line-jwt';
const SMTP_PASSWORD_PLAINTEXT = 'artificial-smtp-password';
const PAGE_TOKEN_PLAINTEXT = 'artificial-page-token';
const GROQ_KEY_PLAINTEXT = 'artificial-groq-key';

function seedDocuments() {
    return {
        'companies/co-alpha': { companyName: 'Alpha Test Carrier' },
        'companies/co-alpha/integrations/sms_provider': {
            provider: 'ringcentral',
            config: {
                clientId: encrypt(CLIENT_ID_PLAINTEXT),
                clientSecret: encrypt(CLIENT_SECRET_PLAINTEXT),
                isSandbox: false,
            },
            defaultPhoneNumber: '+15550001111',
            updatedBy: 'seed-user',
        },
        'companies/co-alpha/integrations/sms_provider/keychain/+15550001111': {
            phoneNumber: '+15550001111',
            label: 'Line A',
            jwt: encrypt(LINE_JWT_PLAINTEXT),
            addedBy: 'seed-user',
        },
        'companies/co-alpha/system_settings/email_config': {
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpUser: 'ops@example.test',
            smtpPass: SMTP_PASSWORD_PLAINTEXT,
            isVerified: true,
        },
        'integrations_index/page-artificial': {
            platform: 'facebook',
            companyId: 'co-alpha',
            pageId: 'page-artificial',
            pageName: 'Alpha Test Page',
            accessToken: PAGE_TOKEN_PLAINTEXT,
        },
    };
}

// The vault modules destructure `{ admin, db }` at require time, so the store
// has to exist before the first require and then be reset *in place*.
const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({
    admin: mock.admin,
    db: mock.db,
    auth: mock.admin.auth(),
    storage: {},
}));

const vault = require('../../environmentVault');
const { AUDIT_COLLECTION } = require('../../environmentVault/audit');

const nowSeconds = () => Math.floor(Date.now() / 1000);

const superAdmin = (overrides = {}) => ({
    uid: 'super-1',
    token: { globalRole: 'super_admin', email: 'ops@example.test', auth_time: nowSeconds(), ...overrides },
});

const request = (auth, data = {}) => ({ auth, data });

/** Every audit document currently in the store. */
const auditRecords = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`${AUDIT_COLLECTION}/`))
    .map(([, data]) => data);

beforeEach(() => {
    process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
    mock.reset(seedDocuments());
    process.env.GROQ_API_KEY = GROQ_KEY_PLAINTEXT;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    delete process.env.GROQ_API_KEY;
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('authorization', () => {
    const callables = [
        ['listEnvironmentAndIntegrations', {}],
        ['revealEnvironmentValue', { entryId: 'functions-env:GROQ_API_KEY' }],
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
        await expect(vault.revealEnvironmentValue(request(auth, { entryId: 'functions-env:GROQ_API_KEY' })))
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
        await expect(vault.revealEnvironmentValue(request(stale, { entryId: 'functions-env:GROQ_API_KEY' })))
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
        await expect(vault.revealEnvironmentValue(request(noAuthTime, { entryId: 'functions-env:GROQ_API_KEY' })))
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
            'functions-env:GROQ_API_KEY',
            'vite-build:VITE_FIREBASE_API_KEY',
            'github-actions-secret:FIREBASE_SERVICE_ACCOUNT_TRUCKERAPP_SYSTEM',
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

        expect(byId.get('functions-env:GROQ_API_KEY').status).toBe('configured');
        expect(byId.get('functions-env:APP_BASE_URL').status).toBe('missing');
        // The Cloud Functions runtime cannot see the browser bundle's values.
        expect(byId.get('vite-build:VITE_FIREBASE_API_KEY').status).toBe('unknown');
        expect(byId.get('vite-build:VITE_FIREBASE_API_KEY').statusResolvedBy).toBe('client-bundle');
        expect(byId.get('github-actions-secret:SENTRY_AUTH_TOKEN').status).toBe('unknown');
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

describe('reveal', () => {
    it('decrypts an encrypted company credential and returns only that value', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
        }));

        expect(result.value).toBe(CLIENT_SECRET_PLAINTEXT);
        expect(result.entryId).toBe('company:co-alpha:sms_provider:clientSecret');
        // One value, not a bundle.
        expect(Object.keys(result).sort()).toEqual(['availability', 'entryId', 'readFrom', 'unavailableReason', 'value']);
        expect(JSON.stringify(result)).not.toContain(CLIENT_ID_PLAINTEXT);
        expect(JSON.stringify(result)).not.toContain(LINE_JWT_PLAINTEXT);
    });

    it('addresses a keychain line by its document id, not its free-text label', async () => {
        // Two lines may carry the same label; the row id must still resolve to
        // exactly one document.
        mock.docs.set('companies/co-alpha/integrations/sms_provider/keychain/+15559999999', {
            phoneNumber: '+15559999999',
            label: 'Line A',
            jwt: encrypt('a-different-line-jwt'),
        });

        const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
        const jwtRows = entries.filter((row) => row.templateId === 'sms_keychain' && row.key === 'jwt');
        expect(jwtRows).toHaveLength(2);
        expect(new Set(jwtRows.map((row) => row.id)).size).toBe(2);

        const second = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_keychain:+15559999999:jwt',
        }));
        expect(second.value).toBe('a-different-line-jwt');
    });

    it('rejects an entry identifier carrying a path separator', async () => {
        await expect(vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_keychain:../../other/doc:jwt',
        }))).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('reveals a dedicated line JWT from the private keychain', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_keychain:+15550001111:jwt',
        }));
        expect(result.value).toBe(LINE_JWT_PLAINTEXT);
    });

    it('reveals a plaintext-at-rest credential without pretending it was encrypted', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:email_config:smtpPass',
        }));
        expect(result.value).toBe(SMTP_PASSWORD_PLAINTEXT);
        expect(result.availability).toBe('firestore-plaintext');
    });

    it('reveals a Cloud Functions runtime value', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'functions-env:GROQ_API_KEY',
        }));
        expect(result.value).toBe(GROQ_KEY_PLAINTEXT);
        expect(result.readFrom).toBe('process-env');
    });

    it('reveals a protected infrastructure key — sensitivity does not remove the eye', async () => {
        process.env.SMS_ENCRYPTION_KEY = ENCRYPTION_KEY;
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'secret-manager:SMS_ENCRYPTION_KEY',
        }));
        expect(result.value).toBe(ENCRYPTION_KEY);
    });

    it('never returns the whole process.env for an unregistered key', async () => {
        process.env.SOME_UNREGISTERED_HOST_VARIABLE = 'must-not-be-reachable';
        try {
            await expect(vault.revealEnvironmentValue(request(superAdmin(), {
                entryId: 'functions-env:SOME_UNREGISTERED_HOST_VARIABLE',
            }))).rejects.toMatchObject({ code: 'not-found' });
        } finally {
            delete process.env.SOME_UNREGISTERED_HOST_VARIABLE;
        }
    });

    it('reports a GitHub Actions secret honestly instead of inventing a value', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'github-actions-secret:SENTRY_AUTH_TOKEN',
        }));
        expect(result.value).toBeNull();
        expect(result.availability).toBe('not-retrievable');
        expect(result.unavailableReason).toBe('The source does not permit reading the saved value.');
    });

    it('directs a build-time browser value to the bundle that actually holds it', async () => {
        const result = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'vite-build:VITE_FIREBASE_API_KEY',
        }));
        expect(result.value).toBeNull();
        expect(result.readFrom).toBe('client-bundle');
        expect(result.availability).toBe('browser-visible');
    });

    it('writes one value-free audit record per reveal', async () => {
        await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
        }));

        const reveals = auditRecords().filter((record) => record.action === 'reveal');
        expect(reveals).toHaveLength(1);
        expect(reveals[0]).toMatchObject({
            actorUid: 'super-1',
            actorEmail: 'ops@example.test',
            result: 'success',
            key: 'clientSecret',
            companyId: 'co-alpha',
            scope: 'company',
        });
        expect(JSON.stringify(reveals[0])).not.toContain(CLIENT_SECRET_PLAINTEXT);
        expect(reveals[0].value).toBeUndefined();
    });

    it('rejects an unknown entry identifier', async () => {
        await expect(vault.revealEnvironmentValue(request(superAdmin(), { entryId: 'nonsense' })))
            .rejects.toMatchObject({ code: 'not-found' });
        await expect(vault.revealEnvironmentValue(request(superAdmin(), { entryId: 'company:co-alpha:sms_provider:notAField' })))
            .rejects.toMatchObject({ code: 'not-found' });
    });

    it('rate-limits repeated reveals', async () => {
        const auth = superAdmin();
        const entryId = 'functions-env:GROQ_API_KEY';
        let denied = null;
        for (let i = 0; i < 40 && !denied; i += 1) {
            try {
                await vault.revealEnvironmentValue(request(auth, { entryId }));
            } catch (error) {
                denied = error;
            }
        }
        expect(denied).toMatchObject({ code: 'resource-exhausted' });
    });
});

describe('mutations', () => {
    const providerDoc = () => mock.docs.get('companies/co-alpha/integrations/sms_provider');

    it('updates only the requested field and verifies the write', async () => {
        const before = providerDoc();
        const untouchedClientId = before.config.clientId;

        const result = await vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: 'replacement-secret',
        }));
        expect(result.verified).toBe(true);

        const after = providerDoc();
        expect(after.config.clientId).toBe(untouchedClientId);
        expect(after.config.clientSecret).not.toBe(before.config.clientSecret);
        expect(after.provider).toBe('ringcentral');
        expect(after.defaultPhoneNumber).toBe('+15550001111');

        const revealed = await vault.revealEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
        }));
        expect(revealed.value).toBe('replacement-secret');
    });

    it('stores the replacement encrypted, never as plaintext', async () => {
        await vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: 'replacement-secret',
        }));
        expect(providerDoc().config.clientSecret).not.toContain('replacement-secret');
        expect(providerDoc().config.clientSecret).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    });

    it('refuses to write the SMS form preservation sentinel as a credential', async () => {
        await expect(vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: '__PRESERVE__',
        }))).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('refuses an empty value', async () => {
        await expect(vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: '   ',
        }))).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('refuses to edit a deployment-managed or protected global key', async () => {
        for (const entryId of [
            'secret-manager:SMS_ENCRYPTION_KEY',
            'functions-env:BULK_WORKER_SECRET',
            'vite-build:VITE_FIREBASE_API_KEY',
            'github-actions-secret:GROQ_API_KEY',
        ]) {
            await expect(vault.updateEnvironmentValue(request(superAdmin(), { entryId, value: 'x' })))
                .rejects.toMatchObject({ code: 'failed-precondition' });
        }
        expect(process.env.SMS_ENCRYPTION_KEY).toBe(ENCRYPTION_KEY);
    });

    it('refuses to edit a field the registry marks read-only', async () => {
        await expect(vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:email_config:smtpPass',
            value: 'new-password',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mock.docs.get('companies/co-alpha/system_settings/email_config').smtpPass)
            .toBe(SMTP_PASSWORD_PLAINTEXT);
    });

    it('adds a value only where the source supports it, and only when absent', async () => {
        const added = await vault.addEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:senderId',
            value: 'AlphaCo',
        }));
        expect(added.verified).toBe(true);
        expect(providerDoc().config.senderId).toBeDefined();

        await expect(vault.addEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:senderId',
            value: 'AlphaCo2',
        }))).rejects.toMatchObject({ code: 'already-exists' });
    });

    it('refuses to add against an unsupported source', async () => {
        await expect(vault.addEnvironmentValue(request(superAdmin(), {
            entryId: 'functions-env:APP_BASE_URL',
            value: 'https://example.test',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('requires the exact key name to delete', async () => {
        await expect(vault.deleteEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            confirmation: 'clientsecret',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('refuses to delete a credential the active integration still needs', async () => {
        await expect(vault.deleteEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            confirmation: 'clientSecret',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(providerDoc().config.clientSecret).toBeDefined();
    });

    it('deletes exactly one field and leaves the rest of the document intact', async () => {
        await vault.addEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:senderId',
            value: 'AlphaCo',
        }));

        const result = await vault.deleteEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:senderId',
            confirmation: 'senderId',
        }));

        expect(result.verified).toBe(true);
        const after = providerDoc();
        expect(after.config.senderId).toBeUndefined();
        expect(after.config.clientId).toBeDefined();
        expect(after.config.clientSecret).toBeDefined();
        expect(after.provider).toBe('ringcentral');
    });

    it('writes a value-free audit record for every mutation', async () => {
        await vault.updateEnvironmentValue(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
            value: 'replacement-secret',
        }));

        const updates = auditRecords().filter((record) => record.action === 'update');
        expect(updates).toHaveLength(1);
        expect(updates[0].result).toBe('success');
        expect(updates[0].valueLength).toBe('replacement-secret'.length);
        expect(JSON.stringify(updates[0])).not.toContain('replacement-secret');
    });
});

describe('integration connectivity test', () => {
    it('is refused for entries that do not support it', async () => {
        await expect(vault.testManagedIntegration(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:clientSecret',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });

        await expect(vault.testManagedIntegration(request(superAdmin(), {
            entryId: 'secret-manager:SMS_ENCRYPTION_KEY',
        }))).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('never echoes a provider error back to the caller', async () => {
        const factory = require('../../integrations/factory');
        factory.getAdapter.mockRejectedValueOnce(new Error(`bad credential ${CLIENT_SECRET_PLAINTEXT}`));

        await expect(vault.testManagedIntegration(request(superAdmin(), {
            entryId: 'company:co-alpha:sms_provider:provider',
        }))).rejects.toMatchObject({
            code: 'internal',
            message: 'The integration could not be reached with the stored credentials.',
        });
    });
});
