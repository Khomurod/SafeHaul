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
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockAssertCompanyAccessForRequest = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
}));

const mockExists = jest.fn().mockResolvedValue([true]);
const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.safehaul.test/pev.pdf']);

jest.mock('../../firebaseAdmin', () => ({
  storage: {
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        exists: (...args) => mockExists(...args),
        getSignedUrl: (...args) => mockGetSignedUrl(...args),
      })),
    })),
  },
}));

const { getSignedPevUrl } = require('../../getSignedPevUrl');

describe('getSignedPevUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExists.mockResolvedValue([true]);
    mockGetSignedUrl.mockResolvedValue(['https://signed.safehaul.test/pev.pdf']);
  });

  it('requires authentication', async () => {
    await expect(
      getSignedPevUrl({
        data: { storagePath: 'companies/co-1/applications/a1/pev_results/r1.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects non-PEV storage paths', async () => {
    await expect(
      getSignedPevUrl({
        auth: { uid: 'user-1' },
        data: { storagePath: 'companies/co-1/applications/a1/profile/avatar.png' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns signed URL for valid PEV result path', async () => {
    const result = await getSignedPevUrl({
      auth: { uid: 'user-1' },
      data: { storagePath: 'companies/co-1/applications/a1/pev_results/PEV_abc.pdf' },
    });

    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { uid: 'user-1' } }),
      'co-1',
      'getSignedPevUrl',
    );
    expect(mockExists).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      url: 'https://signed.safehaul.test/pev.pdf',
    });
  });

  it('returns not-found when storage file does not exist', async () => {
    mockExists.mockResolvedValueOnce([false]);

    await expect(
      getSignedPevUrl({
        auth: { uid: 'user-1' },
        data: { storagePath: 'companies/co-1/applications/a1/pev_results/missing.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
