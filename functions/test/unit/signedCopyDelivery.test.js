/**
 * `sendSignedDocumentCopy`: a company user's explicit approval emails the signer
 * their sealed copy, once. Only the company's team (or a Super Admin) may
 * approve; the document must be signed, carry the company's signature and the
 * signer's, have an address to send to, and its sealed PDF must be the one the
 * seal recorded. The `signedCopy` record is claimed in a transaction before the
 * one send, so a second press, tab or person cannot send it again, and it goes
 * only to the address the approver saw.
 *
 * The real access checks run against an in-memory Firestore; only the email
 * sender is a double. Every value is artificial.
 */
const crypto = require('crypto');

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');
const { createStorageFake } = require('./signedCopy.support');

const mock = createFirestoreMock({}, { filters: true });
const mockStorage = createStorageFake();
const mockClaims = new Map();
mock.admin.auth = () => ({ getUser: async (uid) => ({ customClaims: mockClaims.get(uid) || {} }) });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db, storage: mockStorage.storage }));

const mockSend = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSend(...args) }));

const { onCall } = require('firebase-functions/v2/https');
const { sendSignedDocumentCopy } = require('../../signedCopyDelivery');

// Read before any reset: the options the callable was declared with.
const declaredOptions = onCall.mock.calls[0][0];

const COMPANY = 'co-1';
const REQUEST = 'req-1';
const REQUEST_PATH = `companies/${COMPANY}/signing_requests/${REQUEST}`;
const SEALED_PATH = `secure_documents/${COMPANY}/completed/${REQUEST}_signed.pdf`;
const SEALED = Buffer.from('%PDF-1.7 synthetic sealed document');
const DRIVER_EMAIL = 'jane.driver@example.test';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const { Timestamp } = mock.admin.firestore;

function signedRequest(overrides = {}) {
    return {
        companyId: COMPANY,
        title: 'Offer Letter',
        status: 'signed',
        recipientId: 'driver-1',
        recipientName: 'Jane Driver',
        recipientEmail: DRIVER_EMAIL,
        fields: [
            { id: 'sig1', type: 'signature', required: true },
            { id: 'cs1', type: 'company_signature', companySignaturePath: `secure_documents/${COMPANY}/originals/company-signatures/stamp.png` },
        ],
        fieldValues: { sig1: `secure_documents/${COMPANY}/signatures/${REQUEST}_sig1.png` },
        signedPdfUrl: SEALED_PATH,
        sha256Checksum: sha256(SEALED),
        ...overrides,
    };
}

const record = () => mock.docs.get(REQUEST_PATH);
const APPROVAL = { companyId: COMPANY, requestId: REQUEST, recipientEmail: DRIVER_EMAIL };
const call = (uid, data = APPROVAL, token = {}) =>
    sendSignedDocumentCopy({ auth: uid ? { uid, token } : undefined, data });

beforeEach(() => {
    jest.resetAllMocks();
    mockSend.mockImplementation(async () => ({ success: true, messageId: '<m-1@example.test>' }));
    mock.reset({
        [`companies/${COMPANY}`]: { companyName: 'Acme Freight', isActive: true },
        'companies/co-2': { companyName: 'Other Freight', isActive: true },
        'companies/co-off': { companyName: 'Closed Freight', isActive: false },
        [REQUEST_PATH]: signedRequest(),
        'users/recruiter-1': { name: 'Rita Recruiter' },
    });
    mockStorage.reset();
    mockStorage.files.set(SEALED_PATH, SEALED);
    mockClaims.clear();
    mockClaims.set('recruiter-1', { roles: { [COMPANY]: 'recruiter' } });
    mockClaims.set('hr-1', { roles: { [COMPANY]: 'hr_user' } });
    mockClaims.set('admin-2', { roles: { 'co-2': 'company_admin' } });
    mockClaims.set('closed-admin', { roles: { 'co-off': 'company_admin' } });
    mockClaims.set('super-1', { roles: { globalRole: 'super_admin' } });
    mockClaims.set('driver-1', {});
});

describe('sendSignedDocumentCopy — who may approve', () => {
    it('binds the secret that reads an encrypted SMTP password', () => {
        expect(declaredOptions).toMatchObject({ secrets: ['SMS_ENCRYPTION_KEY'] });
    });

    it('refuses a caller who is not signed in', async () => {
        await expect(call(null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it.each([
        ['the driver who signed it', 'driver-1'],
        ['a user of another company', 'admin-2'],
    ])('refuses %s', async (_label, uid) => {
        await expect(call(uid)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy).toBeUndefined();
    });

    it('refuses the staff of a deactivated company', async () => {
        mock.docs.set('companies/co-off/signing_requests/req-1', signedRequest({ companyId: 'co-off' }));
        mockStorage.files.set('secure_documents/co-off/completed/req-1_signed.pdf', SEALED);
        await expect(call('closed-admin', { ...APPROVAL, companyId: 'co-off' })).rejects.toMatchObject({
            code: 'permission-denied',
            message: expect.stringMatching(/deactivated/i),
        });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it.each([
        ['no companyId', { requestId: REQUEST, recipientEmail: DRIVER_EMAIL }],
        ['no requestId', { companyId: COMPANY, recipientEmail: DRIVER_EMAIL }],
        ['a requestId that is not text', { ...APPROVAL, requestId: 7 }],
        ['a requestId with a slash', { ...APPROVAL, requestId: 'a/b' }],
        ['no recipientEmail', { companyId: COMPANY, requestId: REQUEST }],
        ['a blank recipientEmail', { ...APPROVAL, recipientEmail: '  ' }],
        ['a recipientEmail that is not text', { ...APPROVAL, recipientEmail: ['jane.driver@example.test'] }],
    ])('refuses a call with %s', async (_label, data) => {
        await expect(call('recruiter-1', data)).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy).toBeUndefined();
    });

    it('answers not-found for a document that does not exist', async () => {
        await expect(call('recruiter-1', { ...APPROVAL, requestId: 'missing' })).rejects.toMatchObject({ code: 'not-found' });
    });

    it.each([['an HR user', 'hr-1'], ['a Super Admin', 'super-1']])('lets %s approve', async (_label, uid) => {
        await expect(call(uid)).resolves.toMatchObject({ success: true, sentTo: DRIVER_EMAIL });
        expect(record().signedCopy).toMatchObject({ state: 'sent', approvedBy: uid });
    });
});

describe('sendSignedDocumentCopy — what must be true first', () => {
    const refusals = [
        ['the document is not signed yet', { status: 'pending_seal' }, /not signed/i],
        ['the seal failed', { status: 'error_sealing' }, /not signed/i],
        ['it has no company signature', { fields: [{ id: 'sig1', type: 'signature' }] }, /no company signature/i],
        ['the signer signed nothing', { fieldValues: { sig1: '' } }, /signer's signature/i],
        ['it has no signer signature field', { fields: [{ id: 'cs1', type: 'company_signature' }], fieldValues: {} }, /signer's signature/i],
        ['it has no email address', { recipientEmail: null }, /email address/i],
        ['its email address is not valid', { recipientEmail: 'jane at example' }, /email address/i],
        ['it has no recorded checksum', { sha256Checksum: undefined }, /checksum/i],
        ['its PDF does not match the checksum', { sha256Checksum: sha256(Buffer.from('another file')) }, /does not match/i],
    ];

    it.each(refusals)('refuses when %s, sending nothing', async (_label, overrides, message) => {
        mock.docs.set(REQUEST_PATH, signedRequest(overrides));
        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringMatching(message) });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy).toBeUndefined();
    });

    it('refuses when the sealed PDF is missing', async () => {
        mockStorage.files.delete(SEALED_PATH);
        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringMatching(/sealed PDF/i) });
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('answers unavailable, sending nothing, when the sealed PDF cannot be read', async () => {
        mockStorage.failures.set(SEALED_PATH, new Error('storage unavailable'));
        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'unavailable' });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy).toBeUndefined();
    });

    it('sends the PDF the seal wrote, never the file a client-writable link names', async () => {
        const elsewhere = `secure_documents/${COMPANY}/originals/elsewhere.pdf`;
        mockStorage.files.set(elsewhere, Buffer.from('a different file'));
        mock.docs.set(REQUEST_PATH, signedRequest({ signedPdfUrl: elsewhere }));
        await call('recruiter-1');
        expect(mockStorage.calls.downloads).toEqual([SEALED_PATH]);
        expect(mockSend.mock.calls[0][4].attachments[0].content.equals(SEALED)).toBe(true);
    });

    it('counts an initial as the signer\'s signature', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({
            fields: [{ id: 'in1', type: 'initial' }, { id: 'cs1', type: 'company_signature' }],
            fieldValues: { in1: `secure_documents/${COMPANY}/signatures/${REQUEST}_in1.png` },
        }));
        await expect(call('recruiter-1')).resolves.toMatchObject({ success: true });
    });
});

describe('sendSignedDocumentCopy — sending', () => {
    it('sends one email to the signer with the sealed PDF attached, and records it', async () => {
        const before = Date.now();
        const result = await call('recruiter-1');

        expect(mockSend).toHaveBeenCalledTimes(1);
        const [companyId, to, subject, html, options] = mockSend.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(to).toBe(DRIVER_EMAIL);
        expect(subject).toBe('Your signed copy: "Offer Letter"');
        expect(html).toContain('Jane Driver');
        expect(html).toContain('Offer Letter');
        expect(html).not.toMatch(/<a\s|https?:\/\//i);
        expect(options.attachments).toHaveLength(1);
        expect(options.attachments[0]).toMatchObject({ filename: 'Offer Letter.pdf', contentType: 'application/pdf' });
        expect(Buffer.isBuffer(options.attachments[0].content)).toBe(true);
        expect(options.attachments[0].content.equals(SEALED)).toBe(true);

        expect(result).toEqual({ success: true, sentTo: DRIVER_EMAIL, sentAt: expect.any(String) });
        const sentAtMs = Date.parse(result.sentAt);
        expect(sentAtMs).toBeGreaterThanOrEqual(before);
        expect(record().signedCopy).toEqual({
            state: 'sent',
            approvedBy: 'recruiter-1',
            approvedByName: 'Rita Recruiter',
            approvedAt: '__server_timestamp__',
            sentTo: DRIVER_EMAIL,
            sentAt: expect.objectContaining({ toMillis: expect.any(Function) }),
            messageId: '<m-1@example.test>',
        });
        expect(record().signedCopy.sentAt.toMillis()).toBe(sentAtMs);
        // Nothing else about the document changes.
        expect(record().status).toBe('signed');
    });

    it('names the approver from the sign-in first, then the profile, then the email', async () => {
        await call('recruiter-1', undefined, { name: 'Rita R.', email: 'rita@example.test' });
        expect(record().signedCopy.approvedByName).toBe('Rita R.');

        mock.docs.set(REQUEST_PATH, signedRequest());
        mock.docs.delete('users/recruiter-1');
        await call('recruiter-1', undefined, { email: 'rita@example.test' });
        expect(record().signedCopy.approvedByName).toBe('rita@example.test');
    });

    it('escapes what it puts in the email, and keeps the subject on one line', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({ title: 'Offer <b>"Bonus"</b>\r\nBcc: x@example.test', recipientName: '<img src=x>' }));
        await call('recruiter-1');
        const [, , subject, html, options] = mockSend.mock.calls[0];
        expect(subject).not.toMatch(/[\r\n]/);
        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;b&gt;&quot;Bonus&quot;&lt;/b&gt;');
        expect(options.attachments[0].filename).toBe('Offer bBonusb Bcc xexample.test.pdf');
    });

    it.each([
        ['a title with no safe characters', 'Договор', 'signed-document.pdf'],
        ['no title', undefined, 'signed-document.pdf'],
        ['a title that already ends in .pdf', 'W-9 form.PDF', 'W-9 form.pdf'],
        ['a title with slashes', '../../etc/passwd', 'etcpasswd.pdf'],
    ])('names the attachment safely for %s', async (_label, title, filename) => {
        mock.docs.set(REQUEST_PATH, signedRequest({ title }));
        await call('recruiter-1');
        expect(mockSend.mock.calls[0][4].attachments[0].filename).toBe(filename);
    });

    it('refuses a second send, naming where and when the first went, and sends no email', async () => {
        await call('recruiter-1');
        mockSend.mockClear();
        await expect(call('hr-1')).rejects.toMatchObject({
            code: 'already-exists',
            message: expect.stringMatching(new RegExp(`^A signed copy was already sent to ${DRIVER_EMAIL.replace(/\./g, '\\.')} on \\w+ \\d{1,2}, \\d{4}\\.$`)),
        });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy.approvedBy).toBe('recruiter-1');
    });

    it('refuses while another approval is still sending', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({
            signedCopy: { state: 'sending', approvedBy: 'hr-1', approvedByName: 'Hana HR', approvedAt: Timestamp.fromMillis(Date.now() - 60 * 1000), sentTo: DRIVER_EMAIL },
        }));
        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'aborted', message: expect.stringMatching(/^Already being sent/) });
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy.approvedBy).toBe('hr-1');
    });

    it('takes over an approval that has sat at sending for over ten minutes', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({
            signedCopy: { state: 'sending', approvedBy: 'hr-1', approvedByName: 'Hana HR', approvedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000), sentTo: DRIVER_EMAIL },
        }));
        await expect(call('recruiter-1')).resolves.toMatchObject({ success: true });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(record().signedCopy).toMatchObject({ state: 'sent', approvedBy: 'recruiter-1' });
    });

    it('records a failed send, sends once only, and lets a later approval succeed', async () => {
        mockSend.mockRejectedValueOnce(new Error('Failed to send email: Invalid login'));
        await expect(call('recruiter-1')).rejects.toMatchObject({
            code: 'unavailable',
            message: expect.stringContaining('Invalid login'),
        });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(record().signedCopy).toMatchObject({
            state: 'failed',
            approvedBy: 'recruiter-1',
            sentTo: DRIVER_EMAIL,
            error: 'Failed to send email: Invalid login',
        });

        await expect(call('hr-1')).resolves.toMatchObject({ success: true });
        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(record().signedCopy).toMatchObject({ state: 'sent', approvedBy: 'hr-1', messageId: '<m-1@example.test>' });
        expect(record().signedCopy).not.toHaveProperty('error');
    });

    it("logs a failed send by its code, never the address a mail server's reply names", async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockSend.mockRejectedValueOnce(Object.assign(
            new Error(`Failed to send email: 550 5.1.1 <${DRIVER_EMAIL}>: Recipient address rejected`),
            { code: 'EENVELOPE' },
        ));

        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'unavailable' });

        const logged = errorSpy.mock.calls.flat().map(String).join('\n');
        expect(logged).toContain(REQUEST);
        expect(logged).toContain('EENVELOPE');
        expect(logged).not.toContain(DRIVER_EMAIL);
        // The team still reads the reason on the document.
        expect(record().signedCopy.error).toContain('Recipient address rejected');
        errorSpy.mockRestore();
    });

    it('sends to the address on the document as it reads when claimed', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({ recipientEmail: '  Jane.Driver@Example.test ' }));
        await expect(call('recruiter-1')).resolves.toMatchObject({ sentTo: 'Jane.Driver@Example.test' });
        expect(mockSend.mock.calls[0][1]).toBe('Jane.Driver@Example.test');
    });
});

describe('sendSignedDocumentCopy — only to the address the approver saw', () => {
    const CHANGED = /^The signer's email changed after you opened this\. Close it and review the document again\.$/;
    const NEW_EMAIL = 'jane.new@example.test';
    const FAILED_COPY = { state: 'failed', approvedBy: 'hr-1', approvedByName: 'Hana HR', approvedAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000), sentTo: DRIVER_EMAIL, error: 'Mailbox unavailable' };

    it('refuses when a correction changed the address before the approval, sending nothing', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({ recipientEmail: NEW_EMAIL, signedCopy: FAILED_COPY }));
        await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'aborted', message: expect.stringMatching(CHANGED) });
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockStorage.calls.downloads).toEqual([]);
        expect(record().signedCopy).toEqual(FAILED_COPY);
    });

    it('refuses when the address changes while the approval is checked, claiming nothing', async () => {
        mock.docs.set(REQUEST_PATH, signedRequest({ signedCopy: FAILED_COPY }));
        const runTransaction = mock.db.runTransaction;
        // The correction lands after the first read and before the transaction's.
        mock.db.runTransaction = async (handler) => {
            mock.docs.set(REQUEST_PATH, signedRequest({ recipientEmail: NEW_EMAIL, signedCopy: FAILED_COPY }));
            return runTransaction(handler);
        };
        try {
            await expect(call('recruiter-1')).rejects.toMatchObject({ code: 'aborted', message: expect.stringMatching(CHANGED) });
        } finally {
            mock.db.runTransaction = runTransaction;
        }
        expect(mockSend).not.toHaveBeenCalled();
        expect(record().signedCopy).toEqual(FAILED_COPY);
        expect(record().recipientEmail).toBe(NEW_EMAIL);
    });

    it('sends when the address differs only in case and spaces', async () => {
        await expect(call('recruiter-1', { ...APPROVAL, recipientEmail: '  JANE.Driver@EXAMPLE.test ' })).resolves.toMatchObject({ sentTo: DRIVER_EMAIL });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend.mock.calls[0][1]).toBe(DRIVER_EMAIL);
    });
});
