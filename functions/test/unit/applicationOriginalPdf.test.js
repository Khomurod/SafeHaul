// The only door to a document that may carry a full Social Security Number.
//
// Two properties matter equally here: nobody unauthorized gets through, and
// nobody at all gets through without leaving a record. The second is the reason
// `application_originals/**` has no Storage rule — a direct bucket read by a
// staff token would be authorized but invisible.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockAssertCompanyAccess = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccess: (...args) => mockAssertCompanyAccess(...args),
}));

const auditWrites = [];
const applicationData = { value: { applicantId: 'driver-1', driverId: 'driver-1', email: 'marcus@example.test' } };
const mockExists = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockAuditAdd = jest.fn(async (record) => { auditWrites.push(record); });
const signedFilePath = { value: null };

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } },
  db: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: applicationData.value !== null,
              data: () => applicationData.value,
            }),
            collection: () => ({ add: (...args) => mockAuditAdd(...args) }),
          }),
        }),
      }),
    }),
  },
  storage: {
    bucket: () => ({
      file: (path) => {
        signedFilePath.value = path;
        return {
          exists: (...args) => mockExists(...args),
          getMetadata: async () => [{ metadata: { safehaulFileName: 'Driver-Application-Marcus-Delgado-2026-07-14.pdf' } }],
          getSignedUrl: (...args) => mockGetSignedUrl(...args),
        };
      },
    }),
  },
}));

const { getApplicationOriginalPdfUrl } = require('../../applicationOriginalPdf');

const PERMISSION_DENIED = Object.assign(new Error('denied'), { code: 'permission-denied' });

const request = (over = {}) => ({
  auth: { uid: 'staff-1', token: { name: 'Dana Whitfield', email: 'dana@carrier.test' } },
  data: { companyId: 'company-abc', applicationId: 'app-1' },
  ...over,
});

describe('getApplicationOriginalPdfUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditWrites.length = 0;
    applicationData.value = { applicantId: 'driver-1', driverId: 'driver-1', email: 'marcus@example.test' };
    mockAssertCompanyAccess.mockResolvedValue(undefined);
    mockExists.mockResolvedValue([true]);
    mockGetSignedUrl.mockResolvedValue(['https://signed.storage.test/original.pdf']);
  });

  describe('authorization', () => {
    it('requires authentication', async () => {
      await expect(getApplicationOriginalPdfUrl({ data: {} }))
        .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('lets a company user through', async () => {
      const result = await getApplicationOriginalPdfUrl(request());
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://signed.storage.test/original.pdf');
      expect(result.isOriginal).toBe(true);
    });

    it('denies a user from another company', async () => {
      mockAssertCompanyAccess.mockRejectedValue(PERMISSION_DENIED);
      applicationData.value = { applicantId: 'someone-else', driverId: 'someone-else' };

      await expect(getApplicationOriginalPdfUrl(request({
        auth: { uid: 'rival-staff', token: { email: 'rival@other.test' } },
      }))).rejects.toMatchObject({ code: 'permission-denied' });

      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(auditWrites).toHaveLength(0);
    });

    it('lets the applicant through by owner id', async () => {
      mockAssertCompanyAccess.mockRejectedValue(PERMISSION_DENIED);
      const result = await getApplicationOriginalPdfUrl(request({
        auth: { uid: 'driver-1', token: { email: 'marcus@example.test' } },
      }));
      expect(result.success).toBe(true);
      expect(auditWrites[0].accessRole).toBe('applicant');
    });

    it('accepts a VERIFIED matching email, and refuses an unverified one', async () => {
      mockAssertCompanyAccess.mockRejectedValue(PERMISSION_DENIED);
      applicationData.value = { applicantId: 'other', driverId: 'other', email: 'Marcus@Example.test' };

      const verified = await getApplicationOriginalPdfUrl(request({
        auth: { uid: 'driver-2', token: { email: 'marcus@example.test', email_verified: true } },
      }));
      expect(verified.success).toBe(true);

      await expect(getApplicationOriginalPdfUrl(request({
        auth: { uid: 'driver-3', token: { email: 'marcus@example.test', email_verified: false } },
      }))).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('surfaces an access-check failure instead of silently denying', async () => {
      // An unavailable Firestore is not "you are not company staff". Falling
      // through would turn an outage into a confusing denial for a recruiter
      // who does have access.
      mockAssertCompanyAccess.mockRejectedValue(new Error('firestore unavailable'));
      await expect(getApplicationOriginalPdfUrl(request())).rejects.toThrow(/firestore unavailable/);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('reports a missing application as not found rather than leaking its absence as denial', async () => {
      applicationData.value = null;
      await expect(getApplicationOriginalPdfUrl(request()))
        .rejects.toMatchObject({ code: 'not-found' });
    });
  });

  describe('what it serves', () => {
    it('defaults to the ORIGINAL, v1', async () => {
      await getApplicationOriginalPdfUrl(request());
      expect(signedFilePath.value).toBe('application_originals/company-abc/app-1/v1.pdf');
    });

    it('serves a named resubmission when asked', async () => {
      const result = await getApplicationOriginalPdfUrl(request({
        data: { companyId: 'company-abc', applicationId: 'app-1', snapshotId: 'v3' },
      }));
      expect(signedFilePath.value).toBe('application_originals/company-abc/app-1/v3.pdf');
      expect(result.isOriginal).toBe(false);
    });

    it('refuses a version that could walk out of the tenant', async () => {
      for (const snapshotId of ['../../other/v1', 'v1/../../x', 'v0', '../v1', 'latest']) {
        await expect(getApplicationOriginalPdfUrl(request({
          data: { companyId: 'company-abc', applicationId: 'app-1', snapshotId },
        }))).rejects.toMatchObject({ code: 'invalid-argument' });
      }
    });

    it('says plainly when no preserved PDF exists, rather than rendering one', async () => {
      mockExists.mockResolvedValue([false]);
      await expect(getApplicationOriginalPdfUrl(request()))
        .rejects.toMatchObject({ code: 'not-found' });
    });

    it('issues a short-lived link that downloads under the human filename', async () => {
      const result = await getApplicationOriginalPdfUrl(request());
      const [options] = mockGetSignedUrl.mock.calls[0];
      expect(options.action).toBe('read');
      expect(options.responseDisposition)
        .toBe('attachment; filename="Driver-Application-Marcus-Delgado-2026-07-14.pdf"');
      expect(result.expiresInSeconds).toBe(600);
      expect(options.expires - Date.now()).toBeLessThanOrEqual(600 * 1000);
    });

    it('rejects a request with no company or application', async () => {
      await expect(getApplicationOriginalPdfUrl(request({ data: { applicationId: 'app-1' } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(getApplicationOriginalPdfUrl(request({ data: { companyId: 'company-abc' } })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    });
  });

  describe('audit', () => {
    it('records who opened what, before issuing the link', async () => {
      await getApplicationOriginalPdfUrl(request());

      expect(auditWrites).toHaveLength(1);
      expect(auditWrites[0]).toMatchObject({
        action: 'Original Application PDF Accessed',
        type: 'security',
        companyId: 'company-abc',
        performedBy: 'staff-1',
        performedByName: 'Dana Whitfield',
        accessRole: 'company',
        snapshotId: 'v1',
      });
      expect(auditWrites[0].details).toMatch(/full Social Security Number/);
    });

    it('refuses the access when the audit record cannot be written', async () => {
      // An unauditable read of this document is not an acceptable one.
      mockAuditAdd.mockRejectedValueOnce(new Error('firestore unavailable'));
      await expect(getApplicationOriginalPdfUrl(request())).rejects.toThrow(/firestore unavailable/);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('names the record when it is a resubmission rather than the original', async () => {
      await getApplicationOriginalPdfUrl(request({
        data: { companyId: 'company-abc', applicationId: 'app-1', snapshotId: 'v2' },
      }));
      expect(auditWrites[0].details).toMatch(/resubmission \(v2\)/);
    });
  });
});
