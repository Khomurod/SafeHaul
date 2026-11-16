/**
 * Every email the server sends goes through `sendDynamicEmail`, signing links
 * included. Its logs name the company, never a recipient: a Cloud Functions log
 * is read by everyone who can read the project's logs, and a mail server's
 * reply, or the error Nodemailer builds from it, can repeat the address.
 * Nodemailer and the SMTP settings are mocked; nothing is sent, and every
 * address is artificial.
 */
const mockTransport = { sendMail: jest.fn(), close: jest.fn() };
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../../shared/smtpSettings', () => ({
    readSmtpSettings: jest.fn(),
    smtpTransportOptions: jest.fn(),
    smtpFingerprint: jest.fn(),
}));

const nodemailer = require('nodemailer');
const smtpSettings = require('../../shared/smtpSettings');
const { sendDynamicEmail } = require('../../emailService');

const ADDRESS = 'dana.driver@example.test';
const OTHER = 'sam.signer@example.test';

const logged = () => [console.log, console.info, console.warn, console.error]
    .flatMap((spy) => spy.mock.calls.flat())
    .map((value) => (value instanceof Error ? `${value.message} ${JSON.stringify(value)}` : String(value)))
    .join('\n');

beforeEach(() => {
    jest.resetAllMocks();
    nodemailer.createTransport.mockImplementation(() => mockTransport);
    smtpSettings.readSmtpSettings.mockImplementation(async () => ({
        settings: { host: 'smtp.example.test', user: 'hiring@example.test', pass: 'artificial' },
        companyName: 'Artificial Freight',
    }));
    smtpSettings.smtpTransportOptions.mockImplementation(() => ({}));
    smtpSettings.smtpFingerprint.mockImplementation(() => 'fingerprint-1');
    mockTransport.sendMail.mockImplementation(async () => ({ messageId: '<artificial-id@example.test>' }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('logs a sent email by its company, without the recipient', async () => {
    await sendDynamicEmail('co-1', ADDRESS, 'Please sign', '<p>Sign here</p>');

    expect(mockTransport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ADDRESS }));
    expect(logged()).toContain('co-1');
    expect(logged()).not.toContain(ADDRESS);
    expect(logged()).not.toContain('dana.driver');
});

it('logs an email to several recipients without any of them', async () => {
    await sendDynamicEmail('co-1', [ADDRESS, OTHER], 'Please sign', '<p>Sign here</p>');

    expect(logged()).not.toContain(ADDRESS);
    expect(logged()).not.toContain(OTHER);
});

it('logs a failed email by its code, without the recipient the mail server names, and still throws', async () => {
    const rejected = Object.assign(
        new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${ADDRESS}>: Recipient address rejected`),
        { code: 'EENVELOPE', responseCode: 550, rejected: [ADDRESS], response: `550 5.1.1 <${ADDRESS}>: Recipient address rejected` },
    );
    mockTransport.sendMail.mockImplementation(async () => { throw rejected; });

    await expect(sendDynamicEmail('co-1', ADDRESS, 'Please sign', '<p>Sign here</p>')).rejects.toThrow('Failed to send email');

    expect(logged()).toContain('co-1');
    expect(logged()).toContain('EENVELOPE');
    expect(logged()).not.toContain(ADDRESS);
});

it("throws an error that keeps the failure's code, so a caller can log it without the text", async () => {
    const rejected = Object.assign(
        new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${ADDRESS}>: Recipient address rejected`),
        { code: 'EENVELOPE', responseCode: 550 },
    );
    mockTransport.sendMail.mockImplementation(async () => { throw rejected; });
    await expect(sendDynamicEmail('co-1', ADDRESS, 'Please sign', '<p>Sign here</p>'))
        .rejects.toMatchObject({ message: expect.stringMatching(/^Failed to send email: /), code: 'EENVELOPE', responseCode: 550 });

    smtpSettings.readSmtpSettings.mockImplementation(async () => ({ settings: null, companyName: 'Artificial Freight' }));
    await expect(sendDynamicEmail('co-1', ADDRESS, 'Please sign', '<p>Sign here</p>')).rejects.toMatchObject({ code: 'not-configured' });
});

it('logs a company without email set up as such', async () => {
    smtpSettings.readSmtpSettings.mockImplementation(async () => ({ settings: null, companyName: 'Artificial Freight' }));

    await expect(sendDynamicEmail('co-1', ADDRESS, 'Please sign', '<p>Sign here</p>')).rejects.toThrow('Missing email configuration');

    expect(logged()).toContain('co-1');
    expect(logged()).toContain('not-configured');
    expect(logged()).not.toContain(ADDRESS);
});
