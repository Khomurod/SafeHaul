/**
 * PEV — the request document and the people a request copies.
 *
 * The harness is `employmentVerification.support.js`; the request document's
 * own rendering is `pevRequestPdf.test.js`. Here the document is a stand-in, so
 * the cases can say what is attached, stored, recorded and copied.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('uuid', () => require('./employmentVerification.support').uuidMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const mockBuildRequestPdf = jest.fn();
jest.mock('../../employmentVerification/requestPdf', () => ({
    ...jest.requireActual('../../employmentVerification/requestPdf'),
    buildRequestPdf: (...args) => mockBuildRequestPdf(...args),
}));

const {
    appKey, applicationDocs, verificationDocs, savedStoragePaths, dqFileDocs,
    mockSendDynamicEmail, resetPevState, failNextStorageSave, failNextDqFiling,
} = require('./employmentVerification.support');
const { sendVerificationRequest } = require('../../employmentVerification');
const { sendReminderEmail } = require('../../employmentVerification/notifications');

const PDF_BYTES = Uint8Array.from([37, 80, 68, 70]); // "%PDF"

beforeEach(() => {
    resetPevState();
    mockBuildRequestPdf.mockReset();
    mockBuildRequestPdf.mockImplementation(async () => ({ bytes: PDF_BYTES, release: 'signed' }));
    applicationDocs.set(appKey('co-1', 'applications', 'app-1'), {
        ssn: '123-45-6789',
        signature: 'TEXT_SIGNATURE:John Driver',
        signatureDate: '2026-09-01T15:00:00Z',
        employers: [{ companyName: 'Old Carrier', position: 'OTR Driver', city: 'Dallas', state: 'TX' }],
    });
});

function send(extra = {}) {
    return sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
            companyId: 'co-1', applicationId: 'app-1', employerIndex: 0,
            applicantName: 'John Driver', employerName: 'Old Carrier', employerEmail: 'hr@oldcarrier.com',
            employmentStartDate: '01/2021', employmentEndDate: '01/2024', deliveryMethod: 'email',
            ...extra,
        },
    });
}

const options = () => mockSendDynamicEmail.mock.calls[0][4];

describe('the request document', () => {
    it('is attached to the email, stored beside the record, and recorded on the request', async () => {
        const result = await send();

        const attachment = options().attachments[0];
        expect(attachment).toMatchObject({
            filename: 'Verification-of-Employment-Request-John-Driver.pdf',
            contentType: 'application/pdf',
        });
        expect(Buffer.compare(attachment.content, Buffer.from(PDF_BYTES))).toBe(0);
        expect(mockSendDynamicEmail.mock.calls[0][3]).toContain("the applicant's release, signed with their application");

        const stored = verificationDocs.get('pev-token-123456');
        expect(stored.requestPdfPath).toMatch(/^companies\/co-1\/applications\/app-1\/pev_requests\/PEV_REQUEST_Old_Carrier_.+\.pdf$/);
        expect(stored.requestRelease).toBe('signed');
        expect(savedStoragePaths).toEqual([stored.requestPdfPath]);
        expect(result.requestPdfPath).toBe(stored.requestPdfPath);
    });

    it('is filed in the driver\'s DQ file, opening from a signed link and hidden rather than deleted', async () => {
        await send();
        const stored = verificationDocs.get('pev-token-123456');
        const filed = [...dqFileDocs.entries()];
        expect(filed).toHaveLength(1);
        const [key, record] = filed[0];
        expect(key).toMatch(/^co-1\/applications\/app-1\/pev_request_/);
        expect(record).toMatchObject({
            type: 'pev_request',
            fileType: 'PEV Request – Old Carrier',
            storagePath: stored.requestPdfPath,
            url: null,
            isSynced: true,
            fileName: 'Verification-of-Employment-Request-John-Driver.pdf',
        });
    });

    it('tells the screen it filed the document', async () => {
        expect((await send()).requestPdfFiled).toBe(true);
    });

    it('tells the screen when the document could not be filed, and still sends it', async () => {
        failNextDqFiling();
        const result = await send();
        expect(result.success).toBe(true);
        expect(result.requestPdfPath).toMatch(/pev_requests\//);
        expect(result.requestPdfFiled).toBe(false);
        expect(dqFileDocs.size).toBe(0);
        expect(options().attachments).toHaveLength(1);
    });

    it('files nothing in the DQ file when the email cannot be sent', async () => {
        mockSendDynamicEmail.mockRejectedValue(new Error('smtp down'));
        await expect(send()).rejects.toBeTruthy();
        expect(dqFileDocs.size).toBe(0);
    });

    it('files nothing in the DQ file when there is no document', async () => {
        failNextStorageSave();
        await send();
        expect(dqFileDocs.size).toBe(0);
    });

    it('is built from the application, the employer row and the request', async () => {
        await send();
        expect(mockBuildRequestPdf).toHaveBeenCalledWith(expect.objectContaining({
            applicantName: 'John Driver',
            application: expect.objectContaining({ ssn: '123-45-6789', signature: 'TEXT_SIGNATURE:John Driver' }),
            employer: expect.objectContaining({
                name: 'Old Carrier', email: 'hr@oldcarrier.com', position: 'OTR Driver',
                city: 'Dallas', state: 'TX', startDate: '01/2021', endDate: '01/2024',
            }),
            emailed: true,
        }));
    });

    it.each(['unsigned', 'undated', 'predates-wording'])('claims no signed release in the email when the document is %s', async (release) => {
        mockBuildRequestPdf.mockImplementation(async () => ({ bytes: PDF_BYTES, release }));
        await send();
        const html = mockSendDynamicEmail.mock.calls[0][3];
        expect(html).toContain('The attached PDF carries the request.');
        expect(html).not.toContain("applicant's release");
    });

    it('does not stop the request when it cannot be stored, and says so', async () => {
        failNextStorageSave();
        const result = await send();

        expect(result.success).toBe(true);
        expect(result.requestPdfPath).toBeNull();
        expect(options()).not.toHaveProperty('attachments');
        expect(mockSendDynamicEmail.mock.calls[0][3]).not.toContain('The attached PDF');
        expect(verificationDocs.get('pev-token-123456').requestPdfPath).toBeNull();
    });

    it('is made for a hand-delivered request too, pointing at the link given with it', async () => {
        const result = await send({ deliveryMethod: 'manual', employerEmail: undefined });
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
        expect(result.requestPdfPath).toMatch(/pev_requests\//);
        expect(mockBuildRequestPdf).toHaveBeenCalledWith(expect.objectContaining({ emailed: false }));
    });
});

describe('copies (CC)', () => {
    it('copies each valid address once, lower-cased, never the employer itself', async () => {
        await send({ ccEmails: ['Ops@Carrier.test', 'ops@carrier.test', ' safety@carrier.test ', '', 'HR@oldcarrier.com'] });
        expect(options().cc).toEqual(['ops@carrier.test', 'safety@carrier.test']);
        expect(verificationDocs.get('pev-token-123456').ccEmails).toEqual(['ops@carrier.test', 'safety@carrier.test']);
    });

    it('sends no cc header when nobody is copied', async () => {
        await send();
        expect(options()).not.toHaveProperty('cc');
        expect(verificationDocs.get('pev-token-123456').ccEmails).toEqual([]);
    });

    it.each([
        [['not-an-address'], /not a valid CC address/],
        ['ops@carrier.test', /list of email addresses/],
        [['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test', 'f@x.test'], /at most 5/],
    ])('refuses %j before anything is written or sent', async (ccEmails, message) => {
        await expect(send({ ccEmails })).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(message) });
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
        expect(verificationDocs.size).toBe(0);
        expect(savedStoragePaths).toEqual([]);
    });

    it('copies no one on a hand-delivered request', async () => {
        await send({ deliveryMethod: 'manual', employerEmail: undefined, ccEmails: ['ops@carrier.test'] });
        expect(verificationDocs.get('pev-token-123456').ccEmails).toEqual([]);
    });
});

describe('reminders', () => {
    const params = { applicantName: 'John Driver', employerName: 'Old Carrier', companyName: 'Carrier', token: 't', baseUrl: 'https://x.test', deadlineDate: '2026-11-21', employmentDates: 'a to b' };

    it('attach the stored request document again', async () => {
        await sendReminderEmail('co-1', 'hr@oldcarrier.com', params, 'first_reminder', 'John Driver', 'companies/co-1/applications/app-1/pev_requests/x.pdf');
        expect(options().attachments).toEqual([expect.objectContaining({
            filename: 'Verification-of-Employment-Request-John-Driver.pdf', contentType: 'application/pdf',
        })]);
        expect(options()).not.toHaveProperty('cc');
    });

    it('go out without an attachment for a request that has no document', async () => {
        await sendReminderEmail('co-1', 'hr@oldcarrier.com', params, 'first_reminder', 'John Driver', null);
        expect(options()).toEqual({});
    });
});
