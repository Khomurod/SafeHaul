/**
 * parseCdlWithGroq — callable contract after the shared-AI migration.
 *
 * The callable keeps its name, its payload shape, its guest-reachable posture,
 * its tenant admission, its rate limit and its HttpsError codes. What changed
 * is that it no longer speaks to a vendor: it asks the shared AI task for CDL
 * fields and lets the router decide who answers.
 *
 * These tests therefore mock at the task boundary. Provider selection,
 * fallback ordering and structured-output validation have their own suites in
 * `aiRouter.test.js` and `aiProviders.test.js`.
 */

jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

jest.mock('../../firebaseAdmin', () => ({ db: {} }));
jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({ companyName: 'Tenant Co' }),
}));
jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const mockExtractCdlFields = jest.fn();
jest.mock('../../ai/tasks/cdlExtraction', () => {
  const actual = jest.requireActual('../../ai/tasks/cdlExtraction');
  return {
    ...actual,
    extractCdlFields: (...args) => mockExtractCdlFields(...args),
  };
});

const { parseCdlWithGroq, __private } = require('../../cdlParser');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');
const { CDL_JSON_SCHEMA } = require('../../ai/tasks/cdlExtraction');
const { AiError } = require('../../ai/router/errors');

const GUEST_CONTEXT = { rawRequest: { ip: '203.0.113.8' }, auth: undefined };

const SUCCESSFUL_EXTRACTION = {
  fields: {
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '01/01/1990',
    fullAddress: '123 Main St, Dallas, TX 75001',
    cdlNumber: 'D1234567',
    expirationDate: '12/31/2030',
  },
  providerId: 'groq',
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  latencyMs: 812,
  fallbackCount: 0,
};

describe('parseCdlWithGroq', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractCdlFields.mockResolvedValue(SUCCESSFUL_EXTRACTION);
  });

  it('allows unauthenticated guest caller and returns normalized fields', async () => {
    const res = await parseCdlWithGroq({
      companyId: 'co1',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      storagePath: 'companies/co1/autofill/guest_uploads/x.jpg',
    }, GUEST_CONTEXT);

    expect(res.success).toBe(true);
    expect(res.fields.firstName).toBe('John');
    expect(res.fields.cdlNumber).toBe('D1234567');
    expect(res.storagePath).toBe('companies/co1/autofill/guest_uploads/x.jpg');
    expect(res.schema).toEqual(CDL_JSON_SCHEMA);
    expect(checkRateLimit).toHaveBeenCalled();
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
  });

  it('reports the provider and model that actually answered', async () => {
    mockExtractCdlFields.mockResolvedValue({
      ...SUCCESSFUL_EXTRACTION,
      providerId: 'mistral',
      model: 'pixtral-12b-latest',
      fallbackCount: 1,
    });

    const res = await parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    );

    // The callable is named after Groq for client compatibility, but it must
    // tell the truth about who served the request.
    expect(res.provider).toBe('mistral');
    expect(res.sourceModel).toBe('pixtral-12b-latest');
  });

  it('passes the image to the shared task and nothing else', async () => {
    await parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    );

    expect(mockExtractCdlFields).toHaveBeenCalledWith({ imageDataUrl: 'data:image/png;base64,AAAA' });
  });

  it('enforces tenant admission before spending an AI call', async () => {
    assertCompanyAcceptingIntake.mockRejectedValueOnce(
      Object.assign(new Error('inactive'), { code: 'permission-denied' }),
    );

    await expect(parseCdlWithGroq(
      { companyId: 'closed-co', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toThrow();

    expect(mockExtractCdlFields).not.toHaveBeenCalled();
  });

  it('enforces the per-IP rate limit before spending an AI call', async () => {
    checkRateLimit.mockResolvedValueOnce(false);

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(mockExtractCdlFields).not.toHaveBeenCalled();
  });

  it('rejects a request when no provider is configured', async () => {
    mockExtractCdlFields.mockRejectedValue(new AiError('not_configured', 'nothing configured'));

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('reports an unreachable AI service as unavailable', async () => {
    mockExtractCdlFields.mockRejectedValue(new AiError('network', 'dns'));

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reports exhaustion of every provider as internal', async () => {
    mockExtractCdlFields.mockRejectedValue(new AiError('all_providers_failed', '5 attempted'));

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'internal' });
  });

  it('never logs the provider error detail, which can quote the licence', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockExtractCdlFields.mockRejectedValue(
      new AiError('malformed_response', 'model said: John Doe of 123 Main St'),
    );

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'internal' });

    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('123 Main St');
    expect(logged).not.toContain('John Doe');
    expect(logged).toContain('malformed_response');
    spy.mockRestore();
  });

  it('rejects when too little was extracted to be useful', async () => {
    mockExtractCdlFields.mockResolvedValue({
      ...SUCCESSFUL_EXTRACTION,
      fields: {
        firstName: '', lastName: '', dateOfBirth: '',
        fullAddress: '', cdlNumber: '', expirationDate: '',
      },
    });

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects non-image payloads', async () => {
    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:application/pdf;base64,AAAA' },
      { rawRequest: { ip: '203.0.113.10' } },
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('requires a companyId', async () => {
    await expect(parseCdlWithGroq(
      { imageDataUrl: 'data:image/png;base64,AAAA' },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an oversized image before reaching the AI platform', async () => {
    // The browser already caps uploads at 8 MB; this is the server-side
    // backstop, because the callable is reachable without authentication.
    const huge = `data:image/png;base64,${'A'.repeat(__private.MAX_IMAGE_CHARS + 1)}`;

    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: huge },
      GUEST_CONTEXT,
    )).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(mockExtractCdlFields).not.toHaveBeenCalled();
  });

  it('extractJsonObject handles wrapped text', () => {
    const parsed = __private.extractJsonObject('hello {"firstName":"A","lastName":"B","dateOfBirth":"","fullAddress":"","cdlNumber":"","expirationDate":""} world');
    expect(parsed.firstName).toBe('A');
  });

  it('normalizeOutput coerces every expected key to a trimmed string', () => {
    const normalized = __private.normalizeOutput({ firstName: '  A  ', cdlNumber: 42 });
    expect(normalized.firstName).toBe('A');
    // A non-string from a provider must not reach the wizard as a number.
    expect(normalized.cdlNumber).toBe('');
    expect(normalized.expirationDate).toBe('');
  });
});
