/**
 * Provider-neutral document-vision boundary + Groq adapter.
 *
 * `fetch` is always injected as a jest mock: this suite never reaches Groq.
 */

const {
  createGroqDocumentVisionProvider,
  getDocumentVisionProvider,
  DocumentVisionError,
  DEFAULT_GROQ_DOCUMENT_VISION_MODEL,
  FIELD_PLACEMENT_JSON_SCHEMA,
  __private,
} = require('../../shared/documentVisionProvider');
const { SEMANTIC_CATEGORIES, MANUAL_REVIEW_KINDS } = require('../../shared/edocFieldSemantics');

const PAGES = [{ pageNumber: 1, imageDataUrl: 'data:image/png;base64,AAAA' }];

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => ({
    output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] },
    ],
  }),
});

describe('schema contract', () => {
  it('constrains category and manual-review kind to the shared vocabulary', () => {
    const item = FIELD_PLACEMENT_JSON_SCHEMA.properties.suggestions.items;
    expect(item.properties.category.enum).toEqual(SEMANTIC_CATEGORIES);
    expect(item.additionalProperties).toBe(false);

    const review = FIELD_PLACEMENT_JSON_SCHEMA.properties.manualReview.items;
    expect(review.properties.kind.enum).toEqual(MANUAL_REVIEW_KINDS);
  });

  it('tells the model to report exclusive choices instead of faking checkboxes', () => {
    expect(__private.PROMPT).toMatch(/mutually exclusive choice into independent checkboxes/i);
    expect(__private.PROMPT).toMatch(/PERCENTAGES/);
  });
});

describe('groq adapter', () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_DOCUMENT_VISION_MODEL;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GROQ_DOCUMENT_VISION_MODEL;
    else process.env.GROQ_DOCUMENT_VISION_MODEL = originalModel;
  });

  it('uses its own model variable, not the CDL one', () => {
    process.env.GROQ_DOCUMENT_VISION_MODEL = 'vendor/doc-model-1';
    process.env.GROQ_VISION_MODEL = 'vendor/cdl-model-should-be-ignored';
    expect(createGroqDocumentVisionProvider().model).toBe('vendor/doc-model-1');
  });

  it('falls back to the pinned default when unset', () => {
    delete process.env.GROQ_DOCUMENT_VISION_MODEL;
    expect(createGroqDocumentVisionProvider().model).toBe(DEFAULT_GROQ_DOCUMENT_VISION_MODEL);
  });

  it('throws not-configured when no API key is present', async () => {
    delete process.env.GROQ_API_KEY;
    const provider = createGroqDocumentVisionProvider({ fetchImpl: jest.fn() });
    await expect(provider.analyzeDocumentPages({ pages: PAGES })).rejects.toMatchObject({
      kind: 'not-configured',
    });
  });

  it('sends one labelled image per page and requests the strict schema', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ suggestions: [], manualReview: [] }));
    const provider = createGroqDocumentVisionProvider({ apiKey: 'k', fetchImpl });

    await provider.analyzeDocumentPages({
      pages: [
        { pageNumber: 2, imageDataUrl: 'data:image/png;base64,AA' },
        { pageNumber: 5, imageDataUrl: 'data:image/png;base64,BB' },
      ],
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.text.format.type).toBe('json_schema');
    expect(body.temperature).toBe(0);
    const images = body.input[0].content.filter((c) => c.type === 'input_image');
    expect(images).toHaveLength(2);
    const texts = body.input[0].content.filter((c) => c.type === 'input_text').map((c) => c.text);
    expect(texts.join(' ')).toContain('page 2');
    expect(texts.join(' ')).toContain('page 5');
  });

  it('never puts the API key anywhere except the Authorization header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ suggestions: [], manualReview: [] }));
    const provider = createGroqDocumentVisionProvider({ apiKey: 'super-secret-key', fetchImpl });
    await provider.analyzeDocumentPages({ pages: PAGES });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer super-secret-key');
    expect(init.body).not.toContain('super-secret-key');
  });

  it('returns parsed suggestions and manual-review entries', async () => {
    const payload = {
      suggestions: [{ page: 1, category: 'signature', label: 'Sign', required: true, confidence: 0.8, x: 1, y: 2, width: 3, height: 4 }],
      manualReview: [{ page: 1, kind: 'dropdown', detail: 'State selector' }],
    };
    const provider = createGroqDocumentVisionProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: jest.fn().mockResolvedValue(okResponse(payload)),
    });

    const result = await provider.analyzeDocumentPages({ pages: PAGES });
    expect(result.suggestions).toHaveLength(1);
    expect(result.manualReview[0].kind).toBe('dropdown');
    expect(result.model).toBe('m');
  });

  it('recovers JSON wrapped in stray model prose', () => {
    expect(__private.extractJsonObject('Sure! {"suggestions":[]} done')).toEqual({ suggestions: [] });
    expect(__private.extractJsonObject('no json here')).toBeNull();
  });

  it('throws unreadable when the model returns non-JSON', async () => {
    const provider = createGroqDocumentVisionProvider({
      apiKey: 'k',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'sorry' }] }] }),
      }),
    });
    await expect(provider.analyzeDocumentPages({ pages: PAGES })).rejects.toMatchObject({
      kind: 'unreadable',
    });
  });

  it('throws unavailable on a network failure', async () => {
    const provider = createGroqDocumentVisionProvider({
      apiKey: 'k',
      fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    });
    await expect(provider.analyzeDocumentPages({ pages: PAGES })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('throws provider-error on a non-2xx response', async () => {
    const provider = createGroqDocumentVisionProvider({
      apiKey: 'k',
      fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }),
    });
    await expect(provider.analyzeDocumentPages({ pages: PAGES })).rejects.toMatchObject({
      kind: 'provider-error',
    });
  });

  it('logs the provider status but never the request payload or model text', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const provider = createGroqDocumentVisionProvider({
        apiKey: 'k',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => 'the document says 123 Main St',
        }),
      });
      await expect(provider.analyzeDocumentPages({ pages: PAGES })).rejects.toBeTruthy();
    } finally {
      console.error = original;
    }
    const joined = errors.join('\n');
    expect(joined).toContain('400');
    expect(joined).not.toContain('123 Main St');
    expect(joined).not.toContain('data:image');
  });
});

describe('provider resolution', () => {
  it('resolves the groq adapter by default', () => {
    expect(getDocumentVisionProvider({ apiKey: 'k' }).name).toBe('groq');
  });

  it('rejects an unknown provider name', () => {
    expect(() => getDocumentVisionProvider({ provider: 'nope' })).toThrow(DocumentVisionError);
  });
});
