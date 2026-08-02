jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

const mockGet = jest.fn();
const mockSecretGet = jest.fn();
const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.example/doc.pdf']);

const mockRequestDocRef = {
  get: mockGet,
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
          doc: jest.fn(() => mockRequestDocRef),
        })),
      })),
    })),
  },
  storage: {
    bucket: jest.fn(() => ({
      name: 'test-bucket',
      file: jest.fn(() => ({
        getSignedUrl: mockGetSignedUrl,
      })),
    })),
  },
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { getPublicEnvelope } = require('../../publicSigning');
const { checkRateLimit } = require('../../shared/rateLimiter');

function baseEnvelope(overrides = {}) {
  return {
    status: 'sent',
    storagePath: 'secure_documents/co1/templates/form.pdf',
    title: 'Test Envelope',
    recipientName: 'Signer',
    fields: [{ id: 'f1', type: 'text', pageNumber: 1, required: true }],
    expiresAt: { toMillis: () => Date.now() + 3600000 },
    ...overrides,
  };
}

describe('getPublicEnvelope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({
      exists: true,
      data: () => baseEnvelope(),
    });
    mockSecretGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'secret-token' }),
    });
  });

  const validRequest = {
    data: { companyId: 'co1', requestId: 'req1', accessToken: 'secret-token' },
  };

  it('returns envelope metadata and signed PDF URL for valid token', async () => {
    const result = await getPublicEnvelope(validRequest);
    expect(result.title).toBe('Test Envelope');
    expect(result.pdfUrl).toBe('https://signed.example/doc.pdf');
    expect(result.fields[0].pageNumber).toBe(1);
    expect(mockGetSignedUrl).toHaveBeenCalled();
  });

  it('normalizes legacy x/y field coordinates to xPosition/yPosition', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () =>
        baseEnvelope({
          fields: [
            {
              id: 'f1',
              type: 'checkbox',
              pageNumber: 1,
              x: 12,
              y: 34,
              width: 4,
              height: 3,
            },
          ],
        }),
    });
    const result = await getPublicEnvelope(validRequest);
    expect(result.fields[0].xPosition).toBe(12);
    expect(result.fields[0].yPosition).toBe(34);
  });

  it('returns signed status without PDF when already signed', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => baseEnvelope({ status: 'signed' }),
    });
    const result = await getPublicEnvelope(validRequest);
    expect(result).toEqual({ status: 'signed' });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('returns voided status for voided envelopes', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => baseEnvelope({ status: 'voided' }),
    });
    const result = await getPublicEnvelope(validRequest);
    expect(result).toEqual({ status: 'voided' });
  });

  it('rejects expired signing links', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () =>
        baseEnvelope({
          expiresAt: { toMillis: () => Date.now() - 1000 },
        }),
    });
    await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });

  it('rejects invalid access tokens', async () => {
    await expect(
      getPublicEnvelope({
        data: { companyId: 'co1', requestId: 'req1', accessToken: 'wrong-token' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  // A2 FIX coverage: read path is now rate-limited (per-envelope + per-IP, fail-closed).
  it('rejects when the per-envelope read rate limit is exceeded', async () => {
    checkRateLimit.mockResolvedValueOnce(false); // first (per-requestId) check fails
    await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('rejects when the per-IP read rate limit is exceeded', async () => {
    checkRateLimit
      .mockResolvedValueOnce(true) // per-envelope passes
      .mockResolvedValueOnce(false); // per-IP fails
    await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('keys the per-IP limit on the server-observed IP', async () => {
    await getPublicEnvelope({ ...validRequest, rawRequest: { ip: '203.0.113.7' } });
    expect(checkRateLimit).toHaveBeenCalledWith('envelope_read_req1', 30, 300, 'closed');
    expect(checkRateLimit).toHaveBeenCalledWith('envelope_read_ip_203.0.113.7', 100, 300, 'closed');
  });
});
