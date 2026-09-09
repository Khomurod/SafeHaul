/**
 * PEV — the employer's portal, and the answer they submit.
 *
 * Split from the single 525-line suite on 2026-09-09 for the source-size standard;
 * `employmentVerification.support.js` holds the harness, and every `describe`
 * keeps its original title so full test names are unchanged.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('uuid', () => require('./employmentVerification.support').uuidMock());
jest.mock('pdf-lib', () => require('./employmentVerification.support').pdfLibMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const {
  appKey, applicationDocs, createTs, responseDocs,
  savedStoragePaths, verificationDocs, mockCheckRateLimit, mockSendDynamicEmail,
  resetPevState,
} = require('./employmentVerification.support');

const {
  getVerificationRequest,
  submitVerificationResponse,
} = require('../../employmentVerification');

describe('employmentVerification callables', () => {
  beforeEach(resetPevState);

  describe('getVerificationRequest', () => {
    it('returns completed state when request is already completed', async () => {
      verificationDocs.set('done-token', {
        status: 'completed',
        completedAt: createTs(),
      });

      const result = await getVerificationRequest({ data: { token: 'done-token' } });
      expect(result.status).toBe('completed');
      expect(result.message).toMatch(/already been completed/i);
    });

    it('returns pending data and marks request as opened', async () => {
      verificationDocs.set('pending-token', {
        status: 'sent',
        applicantName: 'Jane Driver',
        employerName: 'Past Fleet',
        companyName: 'SafeHaul Carrier',
        employmentStartDate: '2022-01-01',
        employmentEndDate: '2023-01-01',
        createdAt: createTs(),
        expiresAt: createTs(Date.now() + 60000),
      });

      const result = await getVerificationRequest({ data: { token: 'pending-token' } });
      expect(mockCheckRateLimit).toHaveBeenCalledWith('pev_read_pending-token', 20, 60, 'closed');
      expect(result).toMatchObject({
        status: 'pending',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
      });
      expect(verificationDocs.get('pending-token')).toMatchObject({ status: 'opened' });
    });
  });

  describe('submitVerificationResponse', () => {
    it('rejects submissions missing required respondent details', async () => {
      verificationDocs.set('pev-token-1', {
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId: 'app-1',
        employerIndex: 0,
        expiresAt: createTs(Date.now() + 60000),
      });

      await expect(
        submitVerificationResponse({
          data: {
            token: 'pev-token-1',
            response: {
              respondentName: 'Responder',
              respondentTitle: '',
              respondentPhone: '',
            },
            rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('stores response, updates status, and updates employer verification record', async () => {
      verificationDocs.set('pev-token-2', {
        token: 'pev-token-2',
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId: 'app-9',
        employerIndex: 0,
        employerName: 'Old Carrier',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
        expiresAt: createTs(Date.now() + 60000),
        createdAt: createTs(),
      });
      applicationDocs.set(appKey('co-1', 'applications', 'app-9'), {
        employers: [{ name: 'Old Carrier' }],
      });

      const result = await submitVerificationResponse({
        data: {
          token: 'pev-token-2',
          response: {
            wasEmployed: true,
            confirmedStartDate: '2020-01-01',
            confirmedEndDate: '2022-01-01',
            positionHeld: 'Driver',
            reasonForLeaving: 'Resigned',
            respondentName: 'HR Lead',
            respondentTitle: 'HR Manager',
            respondentPhone: '555-222-3333',
            signatureData: null,
          },
        },
        rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
      });

      expect(result.success).toBe(true);
      expect(responseDocs.get('pev-token-2/submission')).toMatchObject({
        respondentName: 'HR Lead',
        respondentTitle: 'HR Manager',
        signatureMethod: null,
      });
      expect(savedStoragePaths).toEqual([]);
      expect(verificationDocs.get('pev-token-2')).toMatchObject({ status: 'completed' });
      expect(applicationDocs.get(appKey('co-1', 'applications', 'app-9')).employers[0].verification).toMatchObject({
        status: 'Completed',
        respondentName: 'HR Lead',
      });
      expect(mockSendDynamicEmail).toHaveBeenCalledWith(
        'co-1',
        'ops@safehaul.test',
        expect.stringContaining('PEV Complete'),
        expect.stringContaining('Employment Verification Completed'),
      );
    });
    // Step J (2026-09-06): the signature arrives as a drawn PNG or a typed
    // name and is validated by employmentVerification/signature.js before
    // anything is stored. These three pin what submitVerificationResponse
    // does with each outcome; the normaliser's own rules live in
    // pevSignature.test.js.
    const ONE_PIXEL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    function seedSubmittableRequest(token, applicationId) {
      verificationDocs.set(token, {
        token,
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId,
        employerIndex: 0,
        employerName: 'Old Carrier',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
        expiresAt: createTs(Date.now() + 60000),
        createdAt: createTs(),
      });
      applicationDocs.set(appKey('co-1', 'applications', applicationId), {
        employers: [{ name: 'Old Carrier' }],
      });
    }

    function submit(token, signatureFields) {
      return submitVerificationResponse({
        data: {
          token,
          response: {
            wasEmployed: true,
            respondentName: 'HR Lead',
            respondentTitle: 'HR Manager',
            respondentPhone: '555-222-3333',
            ...signatureFields,
          },
        },
        rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
      });
    }

    it('stores a typed signature as text, records the method, and writes nothing to Storage', async () => {
      seedSubmittableRequest('pev-token-3', 'app-3');

      const result = await submit('pev-token-3', {
        signatureData: 'TEXT_SIGNATURE:  HR Lead ',
        signatureMethod: 'typed',
      });

      expect(result.success).toBe(true);
      const stored = responseDocs.get('pev-token-3/submission');
      expect(stored).toMatchObject({ signatureMethod: 'typed', signatureText: 'HR Lead' });
      expect(stored.signaturePath).toBeUndefined();
      expect(savedStoragePaths).toEqual([]);
      expect(verificationDocs.get('pev-token-3')).toMatchObject({ status: 'completed' });
    });

    it('stores a drawn signature as a PNG in Storage and records the path and the method', async () => {
      seedSubmittableRequest('pev-token-4', 'app-4');

      const result = await submit('pev-token-4', {
        signatureData: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
        signatureMethod: 'drawn',
      });

      expect(result.success).toBe(true);
      const stored = responseDocs.get('pev-token-4/submission');
      expect(stored).toMatchObject({
        signatureMethod: 'drawn',
        signaturePath: 'companies/co-1/pev_signatures/pev-token-4.png',
      });
      expect(stored.signatureText).toBeUndefined();
      expect(savedStoragePaths).toEqual(['companies/co-1/pev_signatures/pev-token-4.png']);
    });

    it('refuses a signature that is neither a PNG nor a typed name before anything is stored', async () => {
      seedSubmittableRequest('pev-token-5', 'app-5');

      await expect(
        submit('pev-token-5', {
          signatureData: 'data:image/svg+xml;base64,PHN2Zy8+',
          signatureMethod: 'drawn',
        }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      expect(responseDocs.has('pev-token-5/submission')).toBe(false);
      expect(savedStoragePaths).toEqual([]);
      expect(verificationDocs.get('pev-token-5').status).not.toBe('completed');
      expect(applicationDocs.get(appKey('co-1', 'applications', 'app-5')).employers[0].verification).toBeUndefined();
    });

  });
});
