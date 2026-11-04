/**
 * The company signature and the signed copy, end to end on the server: a driver
 * signs a document carrying the company's signature (`submitPublicEnvelope`), it
 * is sealed (`sealDocument`), a recruiter approves sending, and the driver's
 * email carries a PDF with both signatures and the certificate page
 * (`sendSignedDocumentCopy`, through the real `sendDynamicEmail`).
 *
 * Firestore and Storage are in memory, the mail transport captures instead of
 * sending, and pdf-lib, the images and the PDF are real. Every value is
 * artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

let sealHandler;
jest.mock('firebase-functions/v1', () => ({
    runWith: () => ({
        firestore: {
            document: () => ({
                onUpdate: (handler) => {
                    sealHandler = handler;
                    return handler;
                },
            }),
        },
    }),
}));

const mockMail = [];
jest.mock('nodemailer', () => ({
    createTransport: () => ({
        sendMail: async (message) => {
            mockMail.push(message);
            return { messageId: `<copy-${mockMail.length}@example.test>` };
        },
        close: () => {},
    }),
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');
const { createStorageFake, drawnText, imagesOnPages, onePagePdf, tinyPng } = require('./signedCopy.support');

const mock = createFirestoreMock({}, { filters: true });
const mockStorage = createStorageFake();
const mockClaims = new Map([['recruiter-1', { roles: { 'co-1': 'recruiter' } }]]);
mock.admin.auth = () => ({ getUser: async (uid) => ({ customClaims: mockClaims.get(uid) || {} }) });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db, storage: mockStorage.storage }));

const { submitPublicEnvelope } = require('../../publicSigning');
const { sendSignedDocumentCopy } = require('../../signedCopyDelivery');
require('../../digitalSealing');

const REQUEST_PATH = 'companies/co-1/signing_requests/req-1';
const TEMPLATE_PATH = 'secure_documents/co-1/templates/offer.pdf';
const COMPANY_IMAGE = 'secure_documents/co-1/originals/company-signatures/stamp.png';
const DRIVER_INK = tinyPng(2, 2, [200, 0, 0]);
const COMPANY_STAMP = tinyPng(4, 2, [0, 0, 200]);

const fields = [
    { id: 'name', type: 'text', label: 'Name', pageNumber: 1, xPosition: 10, yPosition: 20, width: 40, height: 5, required: true },
    { id: 'sig1', type: 'signature', label: 'Signature', pageNumber: 1, xPosition: 10, yPosition: 70, width: 30, height: 10, required: true },
    {
        id: 'cs1',
        type: 'company_signature',
        label: 'Company Signature',
        pageNumber: 1,
        xPosition: 60,
        yPosition: 70,
        width: 30,
        height: 10,
        required: false,
        readOnly: true,
        prefillPolicy: 'locked',
        bindingKey: '',
        prefillGroupKey: '',
        defaultValue: '',
        fontSize: 'Auto',
        companySignaturePath: COMPANY_IMAGE,
    },
];

beforeEach(async () => {
    mockMail.length = 0;
    mock.reset({
        'companies/co-1': { companyName: 'Acme Freight', isActive: true },
        'companies/co-1/system_settings/email_config': {
            smtpHost: 'smtp.example.test',
            smtpPort: 587,
            smtpUser: 'hiring@example.test',
            smtpPass: 'synthetic-password',
        },
        'users/recruiter-1': { name: 'Rita Recruiter' },
        [REQUEST_PATH]: {
            companyId: 'co-1',
            title: 'Offer Letter',
            status: 'sent',
            storagePath: TEMPLATE_PATH,
            recipientName: 'Jane Driver',
            recipientEmail: 'jane.driver@example.test',
            fields,
            fieldValues: {},
            expiresAt: mock.admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        },
        [`${REQUEST_PATH}/secrets/token`]: { accessToken: 'synthetic-token' },
    });
    mockStorage.reset();
    mockStorage.files.set(TEMPLATE_PATH, await onePagePdf('Synthetic offer letter'));
    mockStorage.files.set(COMPANY_IMAGE, COMPANY_STAMP);
});

/** Runs the seal on the request as it now stands, as the trigger would. */
async function sealNow() {
    const ref = mock.db.collection('companies').doc('co-1').collection('signing_requests').doc('req-1');
    const after = await ref.get();
    await sealHandler(
        { before: { data: () => ({ status: 'processing' }) }, after: { data: () => after.data(), ref } },
        { params: { companyId: 'co-1', requestId: 'req-1' } },
    );
}

describe('a document with a company signature, from the driver signing to the signed copy', () => {
    it('emails the driver one PDF carrying both signatures and the certificate', async () => {
        await expect(submitPublicEnvelope({
            data: {
                companyId: 'co-1',
                requestId: 'req-1',
                accessToken: 'synthetic-token',
                // The signing room seeds every field, the company's signature as ''.
                fieldValues: { name: 'Jane Driver', sig1: `data:image/png;base64,${DRIVER_INK.toString('base64')}`, cs1: '' },
                auditData: { userAgent: 'Synthetic/1.0' },
            },
            rawRequest: { headers: {}, ip: '203.0.113.5' },
        })).resolves.toEqual({ success: true });
        expect(mock.docs.get(REQUEST_PATH).status).toBe('pending_seal');

        await sealNow();
        const sealed = mock.docs.get(REQUEST_PATH);
        expect(sealed.status).toBe('signed');
        // The driver's ink is gone from Storage; the company's image stays for its next document.
        expect(mockStorage.files.has('secure_documents/co-1/signatures/req-1_sig1.png')).toBe(false);
        expect(mockStorage.files.has(COMPANY_IMAGE)).toBe(true);
        // Nothing is emailed until someone approves it.
        expect(mockMail).toHaveLength(0);

        const result = await sendSignedDocumentCopy({
            auth: { uid: 'recruiter-1', token: { email: 'rita@example.test' } },
            data: { companyId: 'co-1', requestId: 'req-1', recipientEmail: 'jane.driver@example.test' },
        });
        expect(result).toMatchObject({ success: true, sentTo: 'jane.driver@example.test' });

        expect(mockMail).toHaveLength(1);
        const [mail] = mockMail;
        expect(mail).toMatchObject({
            from: '"Acme Freight" <hiring@example.test>',
            to: 'jane.driver@example.test',
            subject: 'Your signed copy: "Offer Letter"',
        });
        expect(mail.attachments).toHaveLength(1);
        const [attachment] = mail.attachments;
        expect(attachment).toMatchObject({ filename: 'Offer Letter.pdf', contentType: 'application/pdf' });

        const pages = await imagesOnPages(attachment.content);
        expect(pages).toHaveLength(2);
        expect(pages[0]).toEqual(expect.arrayContaining([{ width: 2, height: 2 }, { width: 4, height: 2 }]));
        expect(pages[0]).toHaveLength(2);
        expect(pages[1]).toEqual([]);
        const text = drawnText(attachment.content);
        expect(text).toContain('Certificate of Completion');
        expect(text).toContain('Jane Driver');

        expect(mock.docs.get(REQUEST_PATH).signedCopy).toMatchObject({
            state: 'sent',
            approvedBy: 'recruiter-1',
            approvedByName: 'Rita Recruiter',
            sentTo: 'jane.driver@example.test',
            messageId: '<copy-1@example.test>',
        });

        // A second press sends nothing.
        await expect(sendSignedDocumentCopy({
            auth: { uid: 'recruiter-1', token: {} },
            data: { companyId: 'co-1', requestId: 'req-1', recipientEmail: 'jane.driver@example.test' },
        })).rejects.toMatchObject({ code: 'already-exists' });
        expect(mockMail).toHaveLength(1);
    });
});
