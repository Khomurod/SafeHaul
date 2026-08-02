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
  logger: { info: jest.fn(), error: jest.fn() },
}));

const mockAssertCompanyAccessForRequest = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
}));

const mockExists = jest.fn().mockResolvedValue([true]);
const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.safehaul.test/cdl.jpg']);

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

const { getSignedApplicationFileUrl } = require('../../getSignedApplicationFileUrl');

const GUEST_PATH = 'companies/co-1/applications/guest_uploads/abc_license.jpg';

describe('getSignedApplicationFileUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExists.mockResolvedValue([true]);
    mockGetSignedUrl.mockResolvedValue(['https://signed.safehaul.test/cdl.jpg']);
    mockAssertCompanyAccessForRequest.mockResolvedValue(undefined);
  });

  it('requires authentication', async () => {
    await expect(
      getSignedApplicationFileUrl({ data: { storagePath: GUEST_PATH } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a missing/invalid storagePath', async () => {
    await expect(
      getSignedApplicationFileUrl({ auth: { uid: 'u1' }, data: {} }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects paths outside companies/{id}/(applications|autofill)/guest_uploads', async () => {
    for (const bad of [
      'secure_documents/co-1/x.pdf',
      'companies/co-1/applications/a1/profile/avatar.png',
      'companies/co-1/leads/guest_uploads/x.jpg', // leads not allowed
      'companies/co-1/applications/guest_uploads', // too short
    ]) {
      await expect(
        getSignedApplicationFileUrl({ auth: { uid: 'u1' }, data: { storagePath: bad } }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('enforces company access (RBAC) for the companyId in the path', async () => {
    await getSignedApplicationFileUrl({ auth: { uid: 'u1' }, data: { storagePath: GUEST_PATH } });
    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { uid: 'u1' } }),
      'co-1',
      'getSignedApplicationFileUrl',
    );
  });

  it('propagates permission-denied from the access check (no URL minted)', async () => {
    const denied = new Error('denied');
    denied.code = 'permission-denied';
    mockAssertCompanyAccessForRequest.mockRejectedValueOnce(denied);
    await expect(
      getSignedApplicationFileUrl({ auth: { uid: 'u1' }, data: { storagePath: GUEST_PATH } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('returns a fresh 1-hour signed read URL for an allowed member', async () => {
    const res = await getSignedApplicationFileUrl({
      auth: { uid: 'u1' },
      data: { storagePath: GUEST_PATH },
    });
    expect(res).toEqual({ success: true, url: 'https://signed.safehaul.test/cdl.jpg' });
    const opts = mockGetSignedUrl.mock.calls[0][0];
    expect(opts).toMatchObject({ version: 'v4', action: 'read' });
    expect(opts.expires).toBeGreaterThan(Date.now() + 50 * 60 * 1000); // ~1h
  });

  it('accepts the autofill guest_uploads variant', async () => {
    await getSignedApplicationFileUrl({
      auth: { uid: 'u1' },
      data: { storagePath: 'companies/co-9/autofill/guest_uploads/x.jpg' },
    });
    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(expect.anything(), 'co-9', expect.any(String));
  });

  it('returns not-found when the file does not exist', async () => {
    mockExists.mockResolvedValueOnce([false]);
    await expect(
      getSignedApplicationFileUrl({ auth: { uid: 'u1' }, data: { storagePath: GUEST_PATH } }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
