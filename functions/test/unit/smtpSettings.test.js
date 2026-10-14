/**
 * A company's email settings are read one way, for its own emails and for a
 * bulk campaign alike.
 *
 * The two senders read them apart. A campaign set `secure` from a field no save
 * writes, so a server on port 465 never answered it; it skipped the settings on
 * the company document that the company's own emails still use; and a password
 * it could not decrypt went to the server as the ciphertext. The company's own
 * emails kept a connection for ten minutes by company, so a changed password or
 * server was not used until then, and a replaced connection was never closed.
 *
 * Every address, password and key below is artificial.
 */
process.env.SMS_ENCRYPTION_KEY = '12345678901234567890123456789012';

const mockDocs = new Map();
jest.mock('../../firebaseAdmin', () => {
    const ref = (path) => ({
        get: async () => {
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
    });
    const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
    return { db, admin: { firestore: () => db } };
});

const mockTransports = [];
jest.mock('nodemailer', () => ({
    createTransport: (options) => {
        const transport = {
            options,
            sendMail: jest.fn(async () => ({ messageId: 'message-1' })),
            close: jest.fn(),
            transporter: { options },
        };
        mockTransports.push(transport);
        return transport;
    },
}));

const { encrypt } = require('../../integrations/encryption');
const { setupSender } = require('../../bulkActions/workers/senderSetup');
const { sendDynamicEmail } = require('../../emailService');

const COMPANY = 'companies/co-1';
const EMAIL_CONFIG = `${COMPANY}/system_settings/email_config`;
const OLDEST_SETTINGS = `${COMPANY}/integrations/email_settings`;
const SAVED = { smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'hiring@example.com', smtpPass: 'artificial-password' };

/** The connection a campaign would send with, or null. */
async function campaignTransport() {
    const { emailTransporter } = await setupSender({ companyId: 'co-1', sessionRef: null, config: { method: 'email' }, senderId: 'recruiter-1' });
    return emailTransporter ? emailTransporter.options : null;
}

beforeEach(() => {
    mockDocs.clear();
    mockTransports.length = 0;
    mockDocs.set(COMPANY, { companyName: 'Artificial Freight LLC' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('a bulk campaign connects as the company emails do', () => {
    it('opens a TLS connection to a server on port 465', async () => {
        mockDocs.set(EMAIL_CONFIG, { ...SAVED, smtpPort: 465 });
        expect(await campaignTransport()).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true });
    });

    it('starts plain and upgrades on port 587', async () => {
        mockDocs.set(EMAIL_CONFIG, SAVED);
        expect(await campaignTransport()).toMatchObject({
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            auth: { user: 'hiring@example.com', pass: 'artificial-password' },
        });
    });

    it('reads settings kept on the company document, as the company emails do', async () => {
        mockDocs.set(COMPANY, { companyName: 'Artificial Freight LLC', emailSettings: { ...SAVED, smtpPass: `enc:v1:${encrypt('artificial-password')}` } });
        expect(await campaignTransport()).toMatchObject({ host: 'smtp.example.com', auth: { pass: 'artificial-password' } });
    });

    it('does not send a password it cannot decrypt to the server', async () => {
        mockDocs.set(EMAIL_CONFIG, { ...SAVED, smtpPass: 'enc:v1:00:00' });
        expect(await campaignTransport()).toBeNull();
    });

    it('still reads the oldest settings, and a Gmail account without a server', async () => {
        mockDocs.set(OLDEST_SETTINGS, { email: 'hiring@example.com', password: 'artificial-password' });
        expect(await campaignTransport()).toMatchObject({ service: 'gmail', auth: { user: 'hiring@example.com', pass: 'artificial-password' } });
    });
});

describe("the company's own emails", () => {
    // Each case its own company: the connections are kept for the process.
    const send = (companyId) => sendDynamicEmail(companyId, 'driver@example.com', 'Subject', '<p>Body</p>');
    const configOf = (companyId) => `companies/${companyId}/system_settings/email_config`;

    it('use a changed password at once, and close the connection it replaces', async () => {
        mockDocs.set('companies/co-2', { companyName: 'Artificial Freight LLC' });
        mockDocs.set(configOf('co-2'), SAVED);
        await send('co-2');
        mockDocs.set(configOf('co-2'), { ...SAVED, smtpPass: 'artificial-password-2' });
        await send('co-2');

        expect(mockTransports).toHaveLength(2);
        expect(mockTransports[1].options.auth.pass).toBe('artificial-password-2');
        expect(mockTransports[0].close).toHaveBeenCalledTimes(1);
        expect(mockTransports[1].sendMail).toHaveBeenCalledTimes(1);
    });

    it('keep one pooled connection while the settings stay the same', async () => {
        mockDocs.set('companies/co-3', { companyName: 'Artificial Freight LLC' });
        mockDocs.set(configOf('co-3'), SAVED);
        await send('co-3');
        await send('co-3');

        expect(mockTransports).toHaveLength(1);
        expect(mockTransports[0].options).toMatchObject({ pool: true, secure: false });
        expect(mockTransports[0].close).not.toHaveBeenCalled();
        expect(mockTransports[0].sendMail).toHaveBeenCalledTimes(2);
        expect(mockTransports[0].sendMail.mock.calls[0][0].from).toBe('"Artificial Freight LLC" <hiring@example.com>');
    });

    it('open TLS on port 465 when the port was stored as text', async () => {
        mockDocs.set('companies/co-4', { companyName: 'Artificial Freight LLC', emailSettings: { ...SAVED, smtpPort: '465' } });
        await send('co-4');
        expect(mockTransports[0].options).toMatchObject({ port: 465, secure: true });
    });
});
