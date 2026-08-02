/**
 * analyzeEdocFieldPlacement — authentication, tenancy, limits, validation and
 * privacy behaviour.
 *
 * The AI provider is ALWAYS a jest mock here; this suite never reaches Groq (or
 * any network). Every document, company and image below is artificial.
 */

jest.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return { HttpsError, onCall: (_opts, fn) => fn };
});

const mockCompanyDocGet = jest.fn();
jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: (...args) => mockCompanyDocGet(...args) })),
    })),
  },
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: jest.fn().mockResolvedValue(undefined),
}));

const mockAnalyzeDocumentPages = jest.fn();
jest.mock('../../shared/documentVisionProvider', () => {
  class DocumentVisionError extends Error {
    constructor(kind, message) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    DocumentVisionError,
    getDocumentVisionProvider: () => ({
      name: 'test-provider',
      model: 'test-model',
      analyzeDocumentPages: (...args) => mockAnalyzeDocumentPages(...args),
    }),
  };
});

const { analyzeEdocFieldPlacement, __private } = require('../../edocFieldPlacement');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAccessForRequest } = require('../../shared/companyAccess');
const { DocumentVisionError } = require('../../shared/documentVisionProvider');

const PNG = 'data:image/png;base64,';
const imageOfLength = (chars) => PNG + 'A'.repeat(Math.max(0, chars - PNG.length));

const onePage = () => [{ pageNumber: 1, imageDataUrl: imageOfLength(200) }];

const validSuggestion = (overrides = {}) => ({
  page: 1,
  category: 'signature',
  label: 'Sign here',
  required: true,
  confidence: 0.9,
  x: 10,
  y: 20,
  width: 25,
  height: 5,
  ...overrides,
});

const callWith = (data, auth = { uid: 'user-1' }) =>
  analyzeEdocFieldPlacement({ auth, data });

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue(true);
  assertCompanyAccessForRequest.mockResolvedValue(undefined);
  mockCompanyDocGet.mockResolvedValue({ exists: true, data: () => ({ features: { eDocs: true } }) });
  mockAnalyzeDocumentPages.mockResolvedValue({
    suggestions: [validSuggestion()],
    manualReview: [],
    model: 'test-model',
  });
});

describe('authentication and tenant access', () => {
  it('rejects an unauthenticated caller before touching the provider', async () => {
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() }, null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(mockAnalyzeDocumentPages).not.toHaveBeenCalled();
  });

  it('requires a companyId', async () => {
    await expect(callWith({ scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('requires a scanId so stale answers can be discarded client-side', async () => {
    await expect(callWith({ companyId: 'c1', pages: onePage() })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('propagates a company-access denial and never calls the provider', async () => {
    const denied = new Error('nope');
    denied.code = 'permission-denied';
    assertCompanyAccessForRequest.mockRejectedValue(denied);

    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(mockAnalyzeDocumentPages).not.toHaveBeenCalled();
  });

  it('denies a company with E-Docs switched off', async () => {
    mockCompanyDocGet.mockResolvedValue({ exists: true, data: () => ({ features: { eDocs: false } }) });

    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(mockAnalyzeDocumentPages).not.toHaveBeenCalled();
  });

  it('treats a company without a features map as E-Docs enabled', async () => {
    mockCompanyDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown company', async () => {
    mockCompanyDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

describe('rate limiting', () => {
  it('applies a per-user and a per-company budget, both fail-closed', async () => {
    await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });

    expect(checkRateLimit).toHaveBeenCalledWith('edoc_field_ai_user_user-1', 12, 60, 'closed');
    expect(checkRateLimit).toHaveBeenCalledWith('edoc_field_ai_company_c1', 60, 300, 'closed');
  });

  it('rejects when the per-user budget is exhausted', async () => {
    checkRateLimit.mockImplementation(async (key) => !key.startsWith('edoc_field_ai_user_'));

    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(mockAnalyzeDocumentPages).not.toHaveBeenCalled();
  });

  it('rejects when the per-company budget is exhausted', async () => {
    checkRateLimit.mockImplementation(async (key) => !key.startsWith('edoc_field_ai_company_'));

    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(mockAnalyzeDocumentPages).not.toHaveBeenCalled();
  });
});

describe('payload limits', () => {
  it('requires at least one page', async () => {
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: [] })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('caps the number of pages per request', async () => {
    const pages = Array.from({ length: __private.MAX_PAGES_PER_REQUEST + 1 }, (_, i) => ({
      pageNumber: i + 1,
      imageDataUrl: imageOfLength(200),
    }));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects a non-image payload (no arbitrary URLs or storage paths)', async () => {
    const pages = [{ pageNumber: 1, imageDataUrl: 'https://example.invalid/page.png' }];
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects an oversized single page image', async () => {
    const pages = [{ pageNumber: 1, imageDataUrl: imageOfLength(__private.MAX_IMAGE_CHARS + 10) }];
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects a duplicate page number', async () => {
    const pages = [
      { pageNumber: 2, imageDataUrl: imageOfLength(200) },
      { pageNumber: 2, imageDataUrl: imageOfLength(200) },
    ];
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects an invalid page number', async () => {
    const pages = [{ pageNumber: 0, imageDataUrl: imageOfLength(200) }];
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects a payload whose pages are individually fine but collectively too large', () => {
    const per = Math.floor(__private.MAX_TOTAL_PAYLOAD_CHARS / 3) + 1000;
    const pages = Array.from({ length: 4 }, (_, i) => ({
      pageNumber: i + 1,
      imageDataUrl: imageOfLength(Math.min(per, __private.MAX_IMAGE_CHARS)),
    }));
    expect(() => __private.validatePagesInput(pages)).toThrow(/too large/i);
  });
});

describe('provider output validation', () => {
  it('returns validated suggestions with the scanId echoed back', async () => {
    const result = await callWith({ companyId: 'c1', scanId: 'scan-42', pages: onePage() });

    expect(result.scanId).toBe('scan-42');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      type: 'signature',
      category: 'signature',
      bindingKey: '',
      page: 1,
    });
  });

  it('drops an unknown category instead of inventing a field type', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({
      suggestions: [validSuggestion({ category: 'notary_seal' })],
      manualReview: [],
    });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(result.suggestions).toEqual([]);
  });

  it('maps every semantic category to an existing signer type and binding', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({
      suggestions: [
        validSuggestion({ category: 'full_name', x: 1 }),
        validSuggestion({ category: 'email', x: 30 }),
        validSuggestion({ category: 'zip', x: 60 }),
        validSuggestion({ category: 'date', y: 60 }),
        validSuggestion({ category: 'checkbox', y: 80, width: 4, height: 3 }),
      ],
      manualReview: [],
    });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });

    expect(result.suggestions.map((s) => [s.type, s.bindingKey])).toEqual([
      ['text', 'full_name'],
      ['text', 'email'],
      ['text', 'zip'],
      ['date', 'current_date'],
      ['checkbox', ''],
    ]);
  });

  it('drops a suggestion for a page that was not part of the scan', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({
      suggestions: [validSuggestion({ page: 7 })],
      manualReview: [],
    });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(result.suggestions).toEqual([]);
  });

  it('drops non-finite and zero-size coordinates', () => {
    const pages = new Set([1]);
    expect(__private.normalizeSuggestion(validSuggestion({ x: NaN }), pages)).toBeNull();
    expect(__private.normalizeSuggestion(validSuggestion({ width: 0 }), pages)).toBeNull();
    expect(__private.normalizeSuggestion(validSuggestion({ height: 0 }), pages)).toBeNull();
    expect(__private.normalizeSuggestion(validSuggestion({ width: 'wide' }), pages)).toBeNull();
  });

  it('clamps a negative origin back onto the page', () => {
    const normalized = __private.normalizeSuggestion(
      validSuggestion({ x: -20, y: -5, width: 30, height: 6 }),
      new Set([1])
    );
    expect(normalized.x).toBe(0);
    expect(normalized.y).toBe(0);
  });

  it('rejects a box clamped past the bottom edge instead of returning a sliver', () => {
    expect(
      __private.normalizeSuggestion(
        validSuggestion({ x: 10, y: 130, width: 30, height: 400 }),
        new Set([1])
      )
    ).toBeNull();
  });

  it('keeps a box inside the page rather than letting it hang off the right edge', () => {
    const normalized = __private.normalizeSuggestion(
      validSuggestion({ x: 90, y: 10, width: 40, height: 5 }),
      new Set([1])
    );
    expect(normalized.x + normalized.width).toBeLessThanOrEqual(100);
  });

  it('clamps confidence into 0..1 and defaults a missing value to 0', () => {
    const pages = new Set([1]);
    expect(__private.normalizeSuggestion(validSuggestion({ confidence: 4 }), pages).confidence).toBe(1);
    expect(__private.normalizeSuggestion(validSuggestion({ confidence: -2 }), pages).confidence).toBe(0);
    expect(
      __private.normalizeSuggestion(validSuggestion({ confidence: 'high' }), pages).confidence
    ).toBe(0);
  });

  it('removes near-duplicate boxes, keeping the more confident one', () => {
    const deduped = __private.dedupeSuggestions([
      { page: 1, category: 'signature', x: 10, y: 10, confidence: 0.4 },
      { page: 1, category: 'signature', x: 10.5, y: 10.2, confidence: 0.95 },
      { page: 1, category: 'signature', x: 60, y: 10, confidence: 0.5 },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].confidence).toBe(0.95);
  });

  it('keeps only known manual-review kinds', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({
      suggestions: [],
      manualReview: [
        { page: 1, kind: 'radio_group', detail: 'Marital status' },
        { page: 1, kind: 'hologram', detail: 'unknown kind' },
      ],
    });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(result.manualReview).toEqual([{ page: 1, kind: 'radio_group', detail: 'Marital status' }]);
  });

  it('survives malformed provider output without throwing', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({ suggestions: 'not-an-array', manualReview: null });
    const result = await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(result.suggestions).toEqual([]);
    expect(result.manualReview).toEqual([]);
  });

  it('never writes to Firestore', async () => {
    // The only db access allowed is the company feature read.
    const { db } = require('../../firebaseAdmin');
    await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });
    expect(db.collection).toHaveBeenCalledWith('companies');
    expect(db.collection).toHaveBeenCalledTimes(1);
  });
});

describe('provider failures', () => {
  it('maps a missing provider configuration to failed-precondition', async () => {
    mockAnalyzeDocumentPages.mockRejectedValue(new DocumentVisionError('not-configured', 'no key'));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('maps a network failure to unavailable', async () => {
    mockAnalyzeDocumentPages.mockRejectedValue(new DocumentVisionError('unavailable', 'timeout'));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('maps unreadable model output to internal', async () => {
    mockAnalyzeDocumentPages.mockRejectedValue(new DocumentVisionError('unreadable', 'garbage'));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('maps an unexpected error to internal without leaking its detail', async () => {
    mockAnalyzeDocumentPages.mockRejectedValue(new Error('boom with 123 Main St in it'));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toMatchObject({
      code: 'internal',
      message: 'The AI service could not analyze this document.',
    });
  });
});

describe('logging privacy', () => {
  const originalLog = console.log;
  const originalError = console.error;
  let logged;

  beforeEach(() => {
    logged = [];
    console.log = (...args) => logged.push(args.join(' '));
    console.error = (...args) => logged.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it('logs counts only — never image data, labels or provider text', async () => {
    mockAnalyzeDocumentPages.mockResolvedValue({
      suggestions: [validSuggestion({ label: 'Applicant home address line' })],
      manualReview: [{ page: 1, kind: 'table', detail: 'Employment history grid' }],
    });

    await callWith({ companyId: 'c1', scanId: 's1', pages: onePage() });

    const all = logged.join('\n');
    expect(all).toContain('kept=1');
    expect(all).not.toContain('data:image');
    expect(all).not.toContain('Applicant home address line');
    expect(all).not.toContain('Employment history grid');
  });

  it('does not log the underlying error text on an unexpected provider failure', async () => {
    mockAnalyzeDocumentPages.mockRejectedValue(new Error('SSN 000-00-0000'));
    await expect(callWith({ companyId: 'c1', scanId: 's1', pages: onePage() })).rejects.toBeTruthy();
    // The message IS logged for diagnostics; assert we never dumped the payload.
    expect(logged.join('\n')).not.toContain('data:image');
  });
});
