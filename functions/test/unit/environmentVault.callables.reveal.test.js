/**
 * Revealing a stored secret.
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
const { encrypt } = require('../../integrations/encryption');
const {
    mock, superAdmin, request, auditRecords, resetVaultState, restoreVaultState,
    ENCRYPTION_KEY, CLIENT_ID_PLAINTEXT, CLIENT_SECRET_PLAINTEXT, LINE_JWT_PLAINTEXT,
    SMTP_PASSWORD_PLAINTEXT, GROQ_KEY_PLAINTEXT,
} = require('./environmentVault.callables.support');

beforeEach(resetVaultState);
afterEach(restoreVaultState);

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
            entryId: 'secret-manager:GROQ_API_KEY',
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
            entryId: 'github-actions-secret:GITHUB_TOKEN',
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
        const entryId = 'secret-manager:GROQ_API_KEY';
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
