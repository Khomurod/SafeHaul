jest.mock('firebase-functions/v1', () => {
  const https = {
    onCall: (fn) => fn,
    HttpsError: class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  };
  return {
    https,
    runWith: () => ({ https }),
  };
});

jest.mock('../../firebaseAdmin', () => ({
  db: {},
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');
const { getSignedUploadUrl } = require('../../storageSecure');

describe('getSignedUploadUrl (guest upload path reservation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assertCompanyAcceptingIntake.mockResolvedValue({});
  });

  const authedCtx = {
    auth: { uid: 'driver1' },
    rawRequest: { ip: '1.2.3.4' },
  };

  const guestCtx = {
    auth: null,
    rawRequest: { ip: '9.9.9.9' },
  };

  it('validates tenant and returns a guest_uploads storage path', async () => {
    const data = await getSignedUploadUrl(
      { companyId: 'co99', fileName: 'doc.pdf', fileType: 'application/pdf' },
      authedCtx
    );
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co99');
    expect(data.storagePath).toMatch(/^companies\/co99\/applications\/guest_uploads\//);
    expect(data.storagePath).toContain('_doc.pdf');
    expect(data.url).toBeUndefined();
  });

  it('allows unauthenticated guest to reserve a guest_uploads path', async () => {
    const data = await getSignedUploadUrl(
      { companyId: 'co99', fileName: 'doc.pdf', fileType: 'application/pdf' },
      guestCtx
    );
    expect(data.storagePath).toMatch(/^companies\/co99\/applications\/guest_uploads\//);
  });

  it('does not return a path when tenant check fails', async () => {
    const functions = require('firebase-functions/v1');
    assertCompanyAcceptingIntake.mockRejectedValueOnce(
      new functions.https.HttpsError('not-found', 'Company not found.')
    );
    await expect(
      getSignedUploadUrl({ companyId: 'missing', fileName: 'a.pdf', fileType: 'application/pdf' }, authedCtx)
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
