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
  return { https };
});

const mockExists = jest.fn().mockResolvedValue([true]);
const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.example/guest.jpg']);

jest.mock('../../firebaseAdmin', () => ({
  db: {},
  storage: {
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        exists: mockExists,
        getSignedUrl: mockGetSignedUrl,
      })),
    })),
  },
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');
const { getSignedGuestUploadUrl } = require('../../getSignedGuestUploadUrl');

describe('getSignedGuestUploadUrl', () => {
  const validPath = 'companies/co1/applications/guest_uploads/123_scan.jpg';
  const ctx = { rawRequest: { ip: '203.0.113.5' } };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExists.mockResolvedValue([true]);
    mockGetSignedUrl.mockResolvedValue(['https://signed.example/guest.jpg']);
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAcceptingIntake.mockResolvedValue({});
  });

  it('returns a signed URL for a valid guest_uploads path', async () => {
    const result = await getSignedGuestUploadUrl(
      { companyId: 'co1', storagePath: validPath },
      ctx
    );
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
    expect(result).toEqual({ success: true, url: 'https://signed.example/guest.jpg' });
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'read', version: 'v4' })
    );
  });

  it('rejects paths outside guest_uploads', async () => {
    await expect(
      getSignedGuestUploadUrl(
        { companyId: 'co1', storagePath: 'companies/co1/applications/driverA/cdl.jpg' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when companyId does not match path', async () => {
    await expect(
      getSignedGuestUploadUrl(
        { companyId: 'co2', storagePath: validPath },
        ctx
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when file does not exist', async () => {
    mockExists.mockResolvedValueOnce([false]);
    await expect(
      getSignedGuestUploadUrl({ companyId: 'co1', storagePath: validPath }, ctx)
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects when rate limited', async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    await expect(
      getSignedGuestUploadUrl({ companyId: 'co1', storagePath: validPath }, ctx)
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});
