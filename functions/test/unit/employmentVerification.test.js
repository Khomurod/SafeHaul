/**
 * PEV — sending a verification request.
 *
 * The harness, the Firestore double and the fixtures live in
 * `employmentVerification.support.js`; the `jest.mock` registrations have to stay
 * in this file, because Jest hoists them per file and cannot register one from a
 * helper.
 *
 * ## What the cases below are for
 *
 * A request has to record WHICH employer it is for, not just where that employer
 * was sitting in an array. `employerIndex` is positional, and once employers
 * became editable, deleting or reordering one would file a completed verification
 * — its respondent, its signature and its result PDF — against a different
 * company, silently. See `shared/employerIdentity.js`.
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
  appKey, applicationDocs, verificationDocs,
  mockAssertCompanyAccessForRequest, mockSendDynamicEmail, resetPevState,
  setTransactionInterference, writeApplicationOutOfBand,
} = require('./employmentVerification.support');

const { sendVerificationRequest } = require('../../employmentVerification');

describe('employmentVerification callables', () => {
  beforeEach(resetPevState);

  describe('sendVerificationRequest', () => {
    it('rejects unauthenticated requests', async () => {
      await expect(
        sendVerificationRequest({
          data: { companyId: 'co-1', applicationId: 'app-1', employerIndex: 0, applicantName: 'John Driver' },
        }),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('creates verification request and sends email', async () => {
      // The application has to exist and hold the employer, because the request
      // now resolves WHICH employer it is for rather than trusting an index — see
      // `shared/employerIdentity.js`.
      applicationDocs.set(appKey('co-1', 'applications', 'app-1'), {
        employers: [{ companyName: 'Old Carrier' }],
      });

      const result = await sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1',
          applicationId: 'app-1',
          employerIndex: 0,
          applicantName: 'John Driver',
          employerName: 'Old Carrier',
          employerEmail: 'hr@oldcarrier.com',
          employmentStartDate: '2021-01-01',
          employmentEndDate: '2024-01-01',
          deliveryMethod: 'email',
        },
      });

      expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { uid: 'user-1' } }),
        'co-1',
        'PEV/sendVerificationRequest',
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('pev-token-123456');
      expect(result.verificationUrl).toBe('https://safehaul.test/verify/pev-token-123456');
      expect(mockSendDynamicEmail).toHaveBeenCalledWith(
        'co-1',
        'hr@oldcarrier.com',
        expect.stringContaining('Previous Employment Verification Request'),
        expect.stringContaining('/verify/pev-token-123456'),
      );
      expect(verificationDocs.get('pev-token-123456')).toMatchObject({
        companyId: 'co-1',
        applicationId: 'app-1',
        status: 'sent',
        applicantName: 'John Driver',
      });
      // The identity the write-back will resolve by, minted onto the row and
      // recorded on the request.
      const stored = verificationDocs.get('pev-token-123456');
      expect(stored.employerId).toMatch(/^[0-9a-f]{12}$/);
      expect(applicationDocs.get(appKey('co-1', 'applications', 'app-1')).employers[0].employerId)
        .toBe(stored.employerId);
    });

    it('keeps an employer id a row already had, rather than re-minting it', async () => {
      applicationDocs.set(appKey('co-1', 'applications', 'app-1'), {
        employers: [{ companyName: 'Old Carrier', employerId: 'aaaaaaaaaaaa' }],
      });

      await sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1', applicationId: 'app-1', employerIndex: 0,
          applicantName: 'John Driver', employerName: 'Old Carrier',
          employerEmail: 'hr@oldcarrier.com', deliveryMethod: 'email',
        },
      });

      expect(verificationDocs.get('pev-token-123456').employerId).toBe('aaaaaaaaaaaa');
    });

    it('refuses when the employer is no longer on the application', async () => {
      // The recruiter's screen is stale: the row they pressed on has been removed.
      // Issuing the request anyway would leave a result with nowhere safe to go.
      applicationDocs.set(appKey('co-1', 'applications', 'app-1'), { employers: [] });

      await expect(sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1', applicationId: 'app-1', employerIndex: 0,
          applicantName: 'John Driver', employerName: 'Old Carrier',
          employerEmail: 'hr@oldcarrier.com', deliveryMethod: 'email',
        },
      })).rejects.toMatchObject({ code: 'not-found' });
      expect(verificationDocs.size).toBe(0);
    });

    /**
     * The identity's own lost-update race, found in review on 2026-09-09.
     *
     * Stamping ids means writing the WHOLE employers array, so two recruiters
     * sending requests for two different employers on the same never-yet-stamped
     * application each mint a different set and each write all of them. Read, read,
     * write, write: the second write erases the first's ids, and the first request
     * is left recording an `employerId` that is not on the document any more — so
     * the answer that comes back cannot be filed, which is the exact orphaning the
     * identity was introduced to prevent.
     *
     * The competing commit below lands between this request's read and its write.
     * A transaction notices and re-runs; a read followed by an update does not.
     */
    it('does not erase employer ids a request that raced it had already minted', async () => {
      const key = appKey('co-1', 'applications', 'app-1');
      applicationDocs.set(key, {
        employers: [{ companyName: 'ABC Trucking' }, { companyName: 'XYZ Transport' }],
      });

      // The other recruiter's request commits first, stamping both rows.
      setTransactionInterference(() => writeApplicationOutOfBand(key, {
        employers: [
          { companyName: 'ABC Trucking', employerId: 'aaaaaaaaaaaa' },
          { companyName: 'XYZ Transport', employerId: 'bbbbbbbbbbbb' },
        ],
      }));

      await sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1', applicationId: 'app-1', employerIndex: 1,
          applicantName: 'John Driver', employerName: 'XYZ Transport',
          employerEmail: 'hr@xyz.com', deliveryMethod: 'email',
        },
      });

      // The other request's identity survived — the whole point.
      const stored = applicationDocs.get(key);
      expect(stored.employers[0].employerId).toBe('aaaaaaaaaaaa');
      expect(stored.employers[1].employerId).toBe('bbbbbbbbbbbb');
      // And this one recorded an id that is genuinely on the row it names.
      expect(verificationDocs.get('pev-token-123456').employerId).toBe('bbbbbbbbbbbb');
    });

    it('refuses when the row at that index is a different employer', async () => {
      // Exactly the shape of the corruption: the array moved under the recruiter's
      // screen, and the index now points at somebody else.
      applicationDocs.set(appKey('co-1', 'applications', 'app-1'), {
        employers: [{ companyName: 'XYZ Transport' }],
      });

      await expect(sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1', applicationId: 'app-1', employerIndex: 0,
          applicantName: 'John Driver', employerName: 'ABC Trucking',
          employerEmail: 'hr@abc.com', deliveryMethod: 'email',
        },
      })).rejects.toMatchObject({ code: 'not-found' });
    });
  });

});
