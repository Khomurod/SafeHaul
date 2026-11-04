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
      message: 'Too many requests. Please wait and retry.',
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSecretGet).not.toHaveBeenCalled();
  });

  it('rejects when the per-IP read rate limit is exceeded', async () => {
    checkRateLimit
      .mockResolvedValueOnce(true) // per-envelope passes
      .mockResolvedValueOnce(false); // per-IP fails
    await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: 'Too many requests from this network.',
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSecretGet).not.toHaveBeenCalled();
  });

  it('keys the per-IP limit on the server-observed IP', async () => {
    await getPublicEnvelope({ ...validRequest, rawRequest: { ip: '203.0.113.7' } });
    expect(checkRateLimit).toHaveBeenCalledWith('envelope_read_req1', 30, 300, 'closed');
    expect(checkRateLimit).toHaveBeenCalledWith('envelope_read_ip_203.0.113.7', 100, 300, 'closed');
  });

  // The limits run side by side, then the two reads do; every decision is still
  // taken in the order it always was, and nothing leaves before the token compare.
  describe('independent steps side by side', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }

    it('starts both read limits before either answers', async () => {
      const limits = deferred();
      checkRateLimit.mockImplementation(() => limits.promise);
      const call = getPublicEnvelope(validRequest);
      try {
        await flush();
        expect(checkRateLimit).toHaveBeenCalledTimes(2);
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockSecretGet).not.toHaveBeenCalled();
      } finally {
        limits.resolve(true);
        await call.catch(() => {});
      }
      await expect(call).resolves.toMatchObject({ pdfUrl: 'https://signed.example/doc.pdf' });
    });

    it('refuses with the per-envelope message when both limits refuse', async () => {
      checkRateLimit.mockResolvedValue(false);
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'resource-exhausted',
        message: 'Too many requests. Please wait and retry.',
      });
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockSecretGet).not.toHaveBeenCalled();
    });

    it('counts the network limit even when the envelope limit refuses', async () => {
      checkRateLimit.mockResolvedValueOnce(false);
      await expect(
        getPublicEnvelope({ ...validRequest, rawRequest: { ip: '203.0.113.7' } }),
      ).rejects.toMatchObject({ code: 'resource-exhausted', message: 'Too many requests. Please wait and retry.' });
      expect(checkRateLimit).toHaveBeenCalledTimes(2);
      expect(checkRateLimit).toHaveBeenNthCalledWith(1, 'envelope_read_req1', 30, 300, 'closed');
      expect(checkRateLimit).toHaveBeenNthCalledWith(2, 'envelope_read_ip_203.0.113.7', 100, 300, 'closed');
    });

    it('still refuses per envelope when the network limit fails outright', async () => {
      // The network limit is asked even when the envelope limit refuses. If it
      // throws (an invalid key, say), that must not replace the envelope refusal.
      checkRateLimit
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('documentPath must point to a document'));
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'resource-exhausted',
        message: 'Too many requests. Please wait and retry.',
      });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('passes on an error from the envelope limit as before, reading nothing', async () => {
      const limiterError = new Error('documentPath must point to a document');
      checkRateLimit.mockRejectedValueOnce(limiterError);
      await expect(getPublicEnvelope(validRequest)).rejects.toBe(limiterError);
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockSecretGet).not.toHaveBeenCalled();
    });

    it('reads the envelope and its token side by side, only after both limits pass', async () => {
      const limits = deferred();
      const envelope = deferred();
      checkRateLimit.mockImplementation(() => limits.promise);
      mockGet.mockImplementation(() => envelope.promise);
      const call = getPublicEnvelope(validRequest);
      try {
        await flush();
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockSecretGet).not.toHaveBeenCalled();
        limits.resolve(true);
        await flush();
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockSecretGet).toHaveBeenCalledTimes(1);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
      } finally {
        limits.resolve(true);
        envelope.resolve({ exists: true, data: () => baseEnvelope() });
        await call.catch(() => {});
      }
      await expect(call).resolves.toMatchObject({ pdfUrl: 'https://signed.example/doc.pdf' });
    });

    it('answers not-found for a missing envelope, with the token read made', async () => {
      mockGet.mockResolvedValue({ exists: false, data: () => undefined });
      mockSecretGet.mockResolvedValue({ exists: false, data: () => undefined });
      await expect(
        getPublicEnvelope({ data: { ...validRequest.data, accessToken: 'wrong-token' } }),
      ).rejects.toMatchObject({ code: 'not-found' });
      expect(mockSecretGet).toHaveBeenCalledTimes(1);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('answers not-found for a missing envelope even when the token read fails', async () => {
      mockGet.mockResolvedValue({ exists: false, data: () => undefined });
      mockSecretGet.mockRejectedValue(new Error('UNAVAILABLE'));
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('answers internal, signing nothing, when the token read fails', async () => {
      mockSecretGet.mockRejectedValue(new Error('UNAVAILABLE'));
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'internal',
        message: 'An unexpected error occurred. Please try again.',
      });
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('never signs a URL or reports a status for a wrong token', async () => {
      for (const status of ['sent', 'signed', 'voided']) {
        mockGet.mockResolvedValue({ exists: true, data: () => baseEnvelope({ status }) });
        await expect(
          getPublicEnvelope({ data: { ...validRequest.data, accessToken: 'wrong-token' } }),
        ).rejects.toMatchObject({ code: 'permission-denied' });
      }
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('still accepts the token kept on the envelope itself when it has no token document', async () => {
      mockSecretGet.mockResolvedValue({ exists: false, data: () => undefined });
      mockGet.mockResolvedValue({ exists: true, data: () => baseEnvelope({ accessToken: 'secret-token' }) });
      await expect(getPublicEnvelope(validRequest)).resolves.toMatchObject({
        pdfUrl: 'https://signed.example/doc.pdf',
      });
    });

    it('refuses a request missing its data or a parameter before counting either limit', async () => {
      await expect(getPublicEnvelope({})).rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Missing data payload.',
      });
      await expect(
        getPublicEnvelope({ data: { companyId: 'co1', requestId: 'req1' } }),
      ).rejects.toMatchObject({ code: 'invalid-argument', message: 'Missing parameters.' });
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockSecretGet).not.toHaveBeenCalled();
    });

    it('answers internal, signing nothing, when the envelope read fails', async () => {
      mockGet.mockRejectedValue(new Error('UNAVAILABLE'));
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'internal',
        message: 'An unexpected error occurred. Please try again.',
      });
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('refuses an envelope with no file, signing nothing', async () => {
      mockGet.mockResolvedValue({ exists: true, data: () => baseEnvelope({ storagePath: undefined }) });
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Document file reference is missing.',
      });
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('answers internal when the document link cannot be signed', async () => {
      mockGetSignedUrl.mockRejectedValue(new Error('iam.serviceAccounts.signBlob denied'));
      await expect(getPublicEnvelope(validRequest)).rejects.toMatchObject({
        code: 'internal',
        message: 'Server permission error: Cannot sign URL.',
      });
    });
  });

  // The signer sees the company's signature through a short-lived link, as they
  // see the PDF; the Storage path it lives at never leaves the server, and only
  // an image in this company's company-signatures folder is ever signed.
  describe('company signatures', () => {
    const IMAGE = 'secure_documents/co1/originals/company-signatures/stamp.png';
    const companyField = (id, companySignaturePath) => ({
      id,
      type: 'company_signature',
      label: 'Company Signature',
      pageNumber: 1,
      xPosition: 60,
      yPosition: 70,
      width: 30,
      height: 10,
      required: false,
      readOnly: true,
      prefillPolicy: 'locked',
      defaultValue: '',
      companySignaturePath,
    });
    let signedPaths;

    beforeEach(() => {
      signedPaths = [];
      storage.bucket.mockImplementation(() => ({
        name: 'test-bucket',
        file: jest.fn((path) => ({
          getSignedUrl: jest.fn(async (options) => {
            signedPaths.push({ path, ...options });
            return [`https://signed.example/${path}`];
          }),
        })),
      }));
    });

    const fieldsOf = async (fields) => {
      mockGet.mockResolvedValue({ exists: true, data: () => baseEnvelope({ fields }) });
      const result = await getPublicEnvelope(validRequest);
      return Object.fromEntries(result.fields.map((field) => [field.id, field]));
    };

    it('returns a short-lived link to the image and never its path', async () => {
      const before = Date.now();
      const byId = await fieldsOf([{ id: 'f1', type: 'text', pageNumber: 1 }, companyField('cs1', IMAGE)]);

      expect(byId.cs1.companySignatureUrl).toBe(`https://signed.example/${IMAGE}`);
      expect(byId.cs1).not.toHaveProperty('companySignaturePath');
      expect(byId.cs1).toMatchObject({ type: 'company_signature', readOnly: true, xPosition: 60 });
      expect(byId.f1).not.toHaveProperty('companySignatureUrl');

      const stamp = signedPaths.find((entry) => entry.path === IMAGE);
      expect(stamp.action).toBe('read');
      // The PDF's expiry: an hour.
      expect(stamp.expires - before).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(stamp.expires - before).toBeLessThan(60 * 60 * 1000 + 5000);
      expect(signedPaths.map((entry) => entry.path).sort()).toEqual([IMAGE, 'secure_documents/co1/templates/form.pdf'].sort());
    });

    it('signs each document\'s own image', async () => {
      const other = 'secure_documents/co1/originals/company-signatures/other.jpg';
      const byId = await fieldsOf([companyField('cs1', IMAGE), companyField('cs2', other)]);
      expect(byId.cs1.companySignatureUrl).toBe(`https://signed.example/${IMAGE}`);
      expect(byId.cs2.companySignatureUrl).toBe(`https://signed.example/${other}`);
    });

    it.each([
      ['no path', undefined],
      ['an empty path', ''],
      ['another company\'s image', 'secure_documents/co2/originals/company-signatures/stamp.png'],
      ['the PDF itself', 'secure_documents/co1/templates/form.pdf'],
      ['a signer\'s signature', 'secure_documents/co1/signatures/req1_sig1.png'],
      ['a path that climbs out of the folder', 'secure_documents/co1/originals/company-signatures/../../completed/req1_signed.pdf'],
      ['a file that is not an image', 'secure_documents/co1/originals/company-signatures/notes.pdf'],
    ])('gives no link, and no path, for %s', async (_label, companySignaturePath) => {
      const byId = await fieldsOf([companyField('cs1', companySignaturePath)]);
      expect(byId.cs1).not.toHaveProperty('companySignatureUrl');
      expect(byId.cs1).not.toHaveProperty('companySignaturePath');
      expect(signedPaths.map((entry) => entry.path)).toEqual(['secure_documents/co1/templates/form.pdf']);
    });

    it('drops a path or link stored on any other field', async () => {
      const byId = await fieldsOf([{
        id: 'f1',
        type: 'text',
        pageNumber: 1,
        companySignaturePath: IMAGE,
        companySignatureUrl: 'https://elsewhere.example/x.png',
      }]);
      expect(byId.f1).not.toHaveProperty('companySignaturePath');
      expect(byId.f1).not.toHaveProperty('companySignatureUrl');
      expect(signedPaths.map((entry) => entry.path)).toEqual(['secure_documents/co1/templates/form.pdf']);
    });
  });
});
