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
const mockGetSignedUrl = jest.fn();

const mockRequestDocRef = {
  get: mockGet,
  collection: jest.fn(),
};

jest.mock('../../firebaseAdmin', () => ({
  db: { collection: jest.fn() },
  storage: { bucket: jest.fn() },
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn(),
}));

const { getPublicEnvelope } = require('../../publicSigning');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { db, storage } = require('../../firebaseAdmin');

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
    jest.resetAllMocks();
    mockGetSignedUrl.mockResolvedValue(['https://signed.example/doc.pdf']);
    mockRequestDocRef.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        get: mockSecretGet,
      })),
    }));
    db.collection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => mockRequestDocRef),
        })),
      })),
    }));
    storage.bucket.mockImplementation(() => ({
      name: 'test-bucket',
      file: jest.fn(() => ({
        getSignedUrl: mockGetSignedUrl,
      })),
    }));
    checkRateLimit.mockResolvedValue(true);
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

  it('shows the signer the day they are signing, not the day it was sent', async () => {
    // The browser is deliberately NOT the one that decides this: a device with a
    // wrong clock would print a date the sealed PDF never agrees with.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00Z'));
    try {
      mockGet.mockResolvedValue({
        exists: true,
        data: () =>
          baseEnvelope({
            expiresAt: { toMillis: () => Date.now() + 3600000 },
            fields: [
              {
                id: 'date_signed',
                type: 'date',
                pageNumber: 1,
                required: true,
                readOnly: true,
                prefillPolicy: 'locked',
                bindingKey: 'current_date',
                defaultValue: '{{current_date}}',
              },
              // Sent before the fix, with the creation date already baked in.
              {
                id: 'legacy_date_signed',
                type: 'date',
                pageNumber: 1,
                required: true,
                bindingKey: 'current_date',
                defaultValue: 'May 7, 2026',
              },
              { id: 'dob', type: 'text', pageNumber: 1, bindingKey: 'dob', defaultValue: 'January 2, 1980' },
              { id: 'hire_date', type: 'date', pageNumber: 1, defaultValue: 'March 1, 2026' },
            ],
          }),
      });

      const byId = Object.fromEntries(
        (await getPublicEnvelope(validRequest)).fields.map((f) => [f.id, f]),
      );
      expect(byId.date_signed.defaultValue).toBe('September 11, 2026');
      expect(byId.legacy_date_signed.defaultValue).toBe('September 11, 2026');
      // Every other date on the same page is shown exactly as it is stored.
      expect(byId.dob.defaultValue).toBe('January 2, 1980');
      expect(byId.hire_date.defaultValue).toBe('March 1, 2026');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads the day in the zone the signer\'s browser names, on the server clock', async () => {
    // 9:30 pm in Los Angeles on the 11th is already the 12th in UTC.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-12T04:30:00Z'));
    try {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => baseEnvelope({
          expiresAt: { toMillis: () => Date.now() + 3600000 },
          fields: [{ id: 'date_signed', type: 'date', pageNumber: 1, bindingKey: 'current_date', defaultValue: '{{current_date}}' }],
        }),
      });
      const inLosAngeles = await getPublicEnvelope({ ...validRequest, data: { ...validRequest.data, timeZone: 'America/Los_Angeles' } });
      expect(inLosAngeles.fields[0].defaultValue).toBe('September 11, 2026');
      expect(inLosAngeles.timeZone).toBe('America/Los_Angeles');

      // No zone, or one that is not a zone, reads the UTC day as before.
      for (const timeZone of [undefined, 'Not/AZone', 'America/Los_Angeles; DROP', 42]) {
        const result = await getPublicEnvelope({ ...validRequest, data: { ...validRequest.data, timeZone } });
        expect(result.fields[0].defaultValue).toBe('September 12, 2026');
        expect(result.timeZone).toBe('UTC');
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports the instant it stamped, so the room can see the day roll over', async () => {
    // Without it the room would have to ask the device clock whether the day has
    // changed before submitting, which is the clock this whole rule distrusts.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-11T23:55:00Z'));
    try {
      const result = await getPublicEnvelope(validRequest);
      expect(result.serverTime).toBe('2026-09-11T23:55:00.000Z');
    } finally {
      jest.useRealTimers();
    }
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
