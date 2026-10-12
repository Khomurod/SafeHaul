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
  collection: jest.fn(),
};

jest.mock('../../firebaseAdmin', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  admin: { firestore: { Timestamp: { fromMillis: (ms) => ({ ms }) } } },
}));
const mockTx = { get: (ref) => ref.get(), set: jest.fn(), update: jest.fn() };

jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: jest.fn(),
}));

const { getSigningLink } = require('../../getSigningLink');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');
const { db } = require('../../firebaseAdmin');

describe('getSigningLink', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockSigningRequestRef.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        get: mockSecretGet,
      })),
    }));
    db.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => mockSigningRequestRef),
        })),
      })),
    }));
    db.runTransaction.mockImplementation(async (fn) => fn(mockTx));
    assertCompanyAccessForRequest.mockResolvedValue(undefined);
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

  it('replaces a link a correction left with the old address, so the copied link is the one the correction sends', async () => {
    mockRequestGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        appBaseUrl: 'https://app.test',
        recipientEmail: 'dana@example.test',
        sendEmail: true,
        linkSentTo: { email: 'dana@wrong.example.test' },
      }),
    });
    const result = await getSigningLink({
      auth: { uid: 'admin-1' },
      data: { companyId: 'co1', requestId: 'req1' },
    });

    const [, written] = mockTx.set.mock.calls[0];
    expect(written.accessToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.signingLink).toBe(`https://app.test/sign/co1/req1?token=${written.accessToken}`);
    // The new link has reached no one yet, so the correction's trigger sends this one.
    expect(mockTx.update).toHaveBeenCalledWith(mockSigningRequestRef, {
      linkSentTo: {},
      expiresAt: expect.objectContaining({ ms: expect.any(Number) }),
    });
  });

  it('hands out the link unchanged when it went where the request says', async () => {
    mockRequestGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        appBaseUrl: 'https://app.test',
        recipientEmail: 'Dana@Example.test',
        linkSentTo: { email: 'dana@example.test' },
      }),
    });
    const result = await getSigningLink({
      auth: { uid: 'admin-1' },
      data: { companyId: 'co1', requestId: 'req1' },
    });

    expect(result.signingLink).toBe('https://app.test/sign/co1/req1?token=tok-abc');
    expect(mockTx.set).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
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
