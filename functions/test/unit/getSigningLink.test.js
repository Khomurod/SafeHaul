jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

const mockRequestGet = jest.fn();
const mockSecretGet = jest.fn();

const mockSigningRequestRef = {
  get: mockRequestGet,
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: mockSecretGet,
    })),
  })),
};

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => mockSigningRequestRef),
        })),
      })),
    })),
  },
}));

jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: jest.fn().mockResolvedValue(undefined),
}));

const { getSigningLink } = require('../../getSigningLink');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');

describe('getSigningLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        appBaseUrl: 'https://app.test',
      }),
    });
    mockSecretGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'tok-abc' }),
    });
  });

  it('requires authentication', async () => {
    await expect(
      getSigningLink({ data: { companyId: 'co1', requestId: 'req1' } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('returns signing link for company team member', async () => {
    const result = await getSigningLink({
      auth: { uid: 'admin-1' },
      data: { companyId: 'co1', requestId: 'req1' },
    });
    expect(assertCompanyAccessForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { uid: 'admin-1' } }),
      'co1',
      'getSigningLink',
    );
    expect(result.signingLink).toBe('https://app.test/sign/co1/req1?token=tok-abc');
  });

  it('rejects when document is already signed', async () => {
    mockRequestGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'signed' }),
    });
    await expect(
      getSigningLink({
        auth: { uid: 'admin-1' },
        data: { companyId: 'co1', requestId: 'req1' },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('denies access when company access check fails', async () => {
    assertCompanyAccessForRequest.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { code: 'permission-denied' }),
    );
    await expect(
      getSigningLink({
        auth: { uid: 'outsider' },
        data: { companyId: 'co1', requestId: 'req1' },
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});
