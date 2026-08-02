jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

// --- Firestore mocks -------------------------------------------------------
// The callable resolves companies/{id}/signing_requests/{deterministicId} and
// its secrets/token subdoc inside a transaction. The mocks below distinguish
// the two refs by identity so txn.get can serve the right snapshot.

const mockApplicationGet = jest.fn();
const mockTemplateGet = jest.fn();
const mockPublicProfileGet = jest.fn();
const mockRequestTxnGet = jest.fn();
const mockTokenTxnGet = jest.fn();
const mockTxnSet = jest.fn();
const mockTxnUpdate = jest.fn();

const mockTokenRef = { __kind: 'token' };
let mockLastRequestDocId = null;
const mockRequestRef = {
  get id() { return mockLastRequestDocId; },
  collection: jest.fn(() => ({ doc: jest.fn(() => mockTokenRef) })),
};

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => ({ __ts: true })),
      },
      Timestamp: {
        fromMillis: jest.fn((n) => ({ __millis: n, toMillis: () => n })),
      },
    },
  },
  db: {
    collection: jest.fn((name) => {
      if (name === 'public_profiles') {
        return {
          doc: jest.fn(() => ({
            get: mockPublicProfileGet,
          })),
        };
      }
      if (name === 'companies') {
        return {
          doc: jest.fn(() => ({
            collection: jest.fn((sub) => {
              if (sub === 'applications') {
                return { doc: jest.fn(() => ({ get: mockApplicationGet })) };
              }
              if (sub === 'templates') {
                return { doc: jest.fn(() => ({ get: mockTemplateGet })) };
              }
              if (sub === 'signing_requests') {
                return {
                  doc: jest.fn((id) => {
                    mockLastRequestDocId = id;
                    return mockRequestRef;
                  }),
                };
              }
              return { doc: jest.fn() };
            }),
          })),
        };
      }
      return { doc: jest.fn() };
    }),
    runTransaction: jest.fn(async (fn) => fn({
      get: jest.fn(async (ref) => (ref === mockTokenRef ? mockTokenTxnGet() : mockRequestTxnGet())),
      set: mockTxnSet,
      update: mockTxnUpdate,
    })),
  },
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({ companyName: 'Demo Co', isActive: true }),
}));

const { createPostApplicationSigningRequest, __private } = require('../../postApplicationEdocs');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');

const requestPayloadFromTxnSet = () => {
  const call = mockTxnSet.mock.calls.find(([ref]) => ref === mockRequestRef);
  return call ? call[1] : null;
};

const tokenPayloadFromTxnSet = () => {
  const call = mockTxnSet.mock.calls.find(([ref]) => ref === mockTokenRef);
  return call ? call[1] : null;
};

describe('createPostApplicationSigningRequest', () => {
  const baseReq = {
    data: {
      companyId: 'co1',
      applicationId: 'app1',
      confirmationNumber: 'SAF-2026-ABCDE',
      templateId: 'tpl1',
      appBaseUrl: 'https://truckerapp-system.web.app',
    },
    rawRequest: { ip: '203.0.113.10' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLastRequestDocId = null;
    mockPublicProfileGet.mockResolvedValue({
      exists: true,
      data: () => ({
        companyName: 'Demo Logistics',
        postApplicationTemplates: [{ templateId: 'tpl1', title: 'W-9', enabled: true }],
      }),
    });
    mockApplicationGet.mockResolvedValue({
      exists: true,
      data: () => ({
        confirmationNumber: 'SAF-2026-ABCDE',
        firstName: 'Anthony',
        lastName: 'Collins',
        email: 'driver@example.com',
        phone: '5551112222',
        street: '2221 MEADECROFT RD',
        city: 'CHARLOTTE',
        state: 'NC',
        zip: '28214',
      }),
    });
    mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'W-9 Form',
        storagePath: 'secure_documents/co1/templates/w9.pdf',
        fields: [
          { id: 'f1', type: 'text', required: true, defaultValue: '{{first_name}} {Last_name}' },
          { id: 'f2', type: 'text', required: true, bindingKey: 'email', defaultValue: '' },
          { id: 'sig', type: 'signature', required: true, defaultValue: '' },
        ],
      }),
    });
    // Default: no pre-existing signing request / token.
    mockRequestTxnGet.mockResolvedValue({ exists: false, data: () => null });
    mockTokenTxnGet.mockResolvedValue({ exists: false, data: () => null });
  });

  it('creates a signing request with resolved placeholders under a deterministic id', async () => {
    const res = await createPostApplicationSigningRequest(baseReq);

    expect(res.success).toBe(true);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBeTruthy();
    expect(res.alreadyCompleted).toBeUndefined();

    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.title).toBe('W-9 Form');
    expect(requestPayload.source).toBe('post_application_success');
    expect(requestPayload.sourceApplicationId).toBe('app1');
    expect(requestPayload.sourceConfirmationNumber).toBe('SAF-2026-ABCDE');
    expect(requestPayload.fields.find((f) => f.id === 'f1').defaultValue).toBe('Anthony Collins');
    expect(requestPayload.fields.find((f) => f.id === 'f2').defaultValue).toBe('driver@example.com');
    expect(checkRateLimit).toHaveBeenCalled();
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
  });

  it('never stores the access token on the request doc — secrets subdoc only', async () => {
    const res = await createPostApplicationSigningRequest(baseReq);
    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.accessToken).toBeUndefined();
    expect(JSON.stringify(requestPayload)).not.toContain(res.accessToken);
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('repeated clicks reuse the pending request and token (no duplicates)', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() + 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'existing-token-123' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBe('existing-token-123');
    expect(mockTxnSet).not.toHaveBeenCalled();
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it('reports alreadyCompleted (without any token) once the document is signed', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'signed', title: 'W-9 Form' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.alreadyCompleted).toBe(true);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBeUndefined();
    expect(mockTxnSet).not.toHaveBeenCalled();
  });

  it('re-issues a fresh token when the pending link has expired', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() - 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'stale-token' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.accessToken).toBeTruthy();
    expect(res.accessToken).not.toBe('stale-token');
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRequestRef, expect.objectContaining({ status: 'sent' }));
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('re-issues a token when the secrets doc is missing on a pending request', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() + 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({ exists: false, data: () => null });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.accessToken).toBeTruthy();
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('rejects voided documents with a clear failed-precondition', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'voided' }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects when the company is invalid / not accepting intake', async () => {
    const { HttpsError } = require('firebase-functions/v2/https');
    assertCompanyAcceptingIntake.mockRejectedValueOnce(new HttpsError('not-found', 'Company not found.'));
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when rate limit blocks request', async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('rejects when application record is missing', async () => {
    mockApplicationGet.mockResolvedValueOnce({ exists: false, data: () => null });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when confirmation number does not match application', async () => {
    mockApplicationGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ confirmationNumber: 'SAF-2026-ZZZZZ' }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects when template document does not exist', async () => {
    mockTemplateGet.mockResolvedValueOnce({ exists: false, data: () => null });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when template storagePath is missing', async () => {
    mockTemplateGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Broken Template', fields: [] }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('supports legacy string list in postApplicationTemplates config', async () => {
    mockPublicProfileGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        postApplicationTemplates: ['tpl1'],
      }),
    });
    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.success).toBe(true);
  });

  it('marks locked fields readOnly when value is prefilled', async () => {
    mockTemplateGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'DD Form',
        storagePath: 'secure_documents/co1/templates/dd.pdf',
        fields: [
          {
            id: 'full_name',
            type: 'text',
            required: true,
            prefillPolicy: 'locked',
            bindingKey: 'full_name',
            defaultValue: '',
          },
        ],
      }),
    });
    await createPostApplicationSigningRequest(baseReq);
    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.fields[0].defaultValue).toBe('Anthony Collins');
    expect(requestPayload.fields[0].readOnly).toBe(true);
  });

  it('rejects templates that are not enabled on public profile', async () => {
    mockPublicProfileGet.mockResolvedValue({
      exists: true,
      data: () => ({
        postApplicationTemplates: [{ templateId: 'other_template', enabled: true }],
      }),
    });

    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects locked required fields with missing prefill', async () => {
    mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Direct Deposit',
        storagePath: 'secure_documents/co1/templates/dd.pdf',
        fields: [
          {
            id: 'acct_name',
            type: 'text',
            required: true,
            prefillPolicy: 'locked',
            bindingKey: 'bank_account_name',
            defaultValue: '',
          },
        ],
      }),
    });

    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects invalid arguments before any writes', async () => {
    await expect(
      createPostApplicationSigningRequest({
        ...baseReq,
        data: { ...baseReq.data, companyId: '' },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockTxnSet).not.toHaveBeenCalled();
  });
});

describe('normalizePostSubmitTemplateConfig — required backward compatibility', () => {
  const { normalizePostSubmitTemplateConfig, buildPostApplicationRequestId } = __private;

  it('legacy strings and objects without a flag default to required', () => {
    const out = normalizePostSubmitTemplateConfig(['tpl1', { templateId: 'tpl2', enabled: true }]);
    expect(out).toEqual([
      expect.objectContaining({ templateId: 'tpl1', enabled: true, required: true }),
      expect.objectContaining({ templateId: 'tpl2', enabled: true, required: true }),
    ]);
  });

  it('explicit required:false is honored', () => {
    const [tpl] = normalizePostSubmitTemplateConfig([{ templateId: 'tpl1', required: false }]);
    expect(tpl.required).toBe(false);
  });

  it('preserves order (explicit order field, index fallback)', () => {
    const out = normalizePostSubmitTemplateConfig([
      { templateId: 'a' },
      { templateId: 'b', order: 9 },
    ]);
    expect(out[0].order).toBe(0);
    expect(out[1].order).toBe(9);
  });

  it('buildPostApplicationRequestId is deterministic per application+template', () => {
    expect(buildPostApplicationRequestId('app1', 'tpl1')).toBe('postapp_app1_tpl1');
    expect(buildPostApplicationRequestId('app1', 'tpl1')).toBe(buildPostApplicationRequestId('app1', 'tpl1'));
    expect(buildPostApplicationRequestId('app1', 'tpl2')).not.toBe(buildPostApplicationRequestId('app1', 'tpl1'));
  });
});
