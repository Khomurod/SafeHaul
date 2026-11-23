/**
 * The vault lists a company's Gmail connection and never reads its refresh
 * token back: the reveal answers `not-retrievable` without opening the
 * document, and the row offers no eye, edit or delete.
 *
 * Part of the environment-vault callable suite; the store, the seed documents
 * and the reset are in `environmentVault.callables.support.js`. Every value
 * below is artificial.
 */

jest.mock('firebase-functions/v2/https', () => require('./environmentVault.callables.support').httpsMock());
jest.mock('@ringcentral/sdk', () => require('./environmentVault.callables.support').ringcentralSdkMock());
jest.mock('../../integrations/factory', () => require('./environmentVault.callables.support').integrationFactoryMock());
jest.mock('../../integrations/adapters/eightbyeight', () => require('./environmentVault.callables.support').emptyAdapterMock());
jest.mock('../../integrations/adapters/ringcentral', () => require('./environmentVault.callables.support').emptyAdapterMock());
jest.mock('../../firebaseAdmin', () => require('./environmentVault.callables.support').firebaseAdminMock());

const vault = require('../../environmentVault');
const { sealPassword } = require('../../shared/smtpSettings');
const {
    mock, superAdmin, request, auditRecords, resetVaultState, restoreVaultState,
} = require('./environmentVault.callables.support');

const EMAIL_CONFIG = 'companies/co-alpha/system_settings/email_config';
const REFRESH_TOKEN = 'artificial-gmail-refresh-token';
const TOKEN_ENTRY = 'company:co-alpha:email_config:gmailRefreshToken';

function connectGmail() {
    mock.docs.set(EMAIL_CONFIG, {
        ...mock.docs.get(EMAIL_CONFIG),
        provider: 'gmail',
        gmailEmail: 'hiring@example.test',
        gmailSub: '1234567890',
        gmailRefreshToken: sealPassword(REFRESH_TOKEN),
    });
}

const emailRows = async () => {
    const { entries } = await vault.listEnvironmentAndIntegrations(request(superAdmin()));
    return entries.filter((row) => row.templateId === 'email_config');
};

beforeEach(resetVaultState);
afterEach(restoreVaultState);

describe('Gmail in the vault', () => {
    it('lists no Gmail rows for a company that never connected Gmail', async () => {
        const keys = (await emailRows()).map((row) => row.key);
        expect(keys).toEqual(['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass']);
    });

    it('lists the connected account and its token, the token with no eye, edit or delete', async () => {
        connectGmail();
        const rows = await emailRows();
        const email = rows.find((row) => row.key === 'gmailEmail');
        const token = rows.find((row) => row.key === 'gmailRefreshToken');

        expect(email).toMatchObject({ status: 'configured', sensitivity: 'internal', permissions: { revealable: true } });
        expect(token).toMatchObject({
            status: 'configured',
            sensitivity: 'critical',
            availability: 'not-retrievable',
            maskedValue: '********',
            permissions: { revealable: false, editable: false, replaceable: false, addable: false, deletable: false },
        });
        expect(token.unavailableReason).toMatch(/reconnect Gmail/i);
        expect(JSON.stringify(rows)).not.toContain(REFRESH_TOKEN);
    });

    it('answers a reveal of the token without reading the document', async () => {
        connectGmail();
        const docRef = mock.db.collection('companies').doc('co-alpha').collection('system_settings').doc('email_config');
        const reads = jest.spyOn(mock.db, 'collection');

        const result = await vault.revealEnvironmentValue(request(superAdmin(), { entryId: TOKEN_ENTRY }));

        expect(result).toEqual({
            entryId: TOKEN_ENTRY,
            availability: 'not-retrievable',
            readFrom: 'none',
            value: null,
            unavailableReason: expect.stringMatching(/never shows this token/),
        });
        expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN);
        // The audit write is the only collection touched: not `companies`.
        expect(reads.mock.calls.map(([name]) => name)).not.toContain('companies');
        expect((await docRef.get()).data().gmailRefreshToken).toMatch(/^enc:v1:/);

        const [audit] = auditRecords().filter((record) => record.action === 'reveal');
        expect(audit).toMatchObject({ result: 'unavailable', key: 'gmailRefreshToken' });
        expect(JSON.stringify(audit)).not.toContain(REFRESH_TOKEN);
    });

    it('refuses to edit or delete the token from the vault', async () => {
        connectGmail();
        await expect(vault.updateEnvironmentValue(request(superAdmin(), { entryId: TOKEN_ENTRY, value: 'x' })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(vault.deleteEnvironmentValue(request(superAdmin(), { entryId: TOKEN_ENTRY, confirmation: 'gmailRefreshToken' })))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mock.docs.get(EMAIL_CONFIG).gmailRefreshToken).toMatch(/^enc:v1:/);
    });
});
