/**
 * Changing what is stored, and the integration connectivity test.
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
    mock, superAdmin, request, auditRecords, resetVaultState, restoreVaultState,
    ENCRYPTION_KEY, CLIENT_SECRET_PLAINTEXT, SMTP_PASSWORD_PLAINTEXT,
} = require('./environmentVault.callables.support');

beforeEach(resetVaultState);
afterEach(restoreVaultState);

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
            'secret-manager:BULK_WORKER_SECRET',
            'vite-build:VITE_FIREBASE_API_KEY',
            'github-actions-secret:GITHUB_TOKEN',
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
