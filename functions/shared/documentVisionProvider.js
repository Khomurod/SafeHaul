/**
 * Provider-neutral document-vision boundary.
 *
 * The callable layer (`edocFieldPlacement.js`) never talks to a vendor SDK or
 * endpoint directly: it asks this module for a provider and calls
 * `analyzeDocumentPages()`. Swapping vendors means adding an adapter here, not
 * touching the callable, its auth, its limits or its validation.
 *
 * PRIVACY: adapters receive rendered page images and MUST NOT log them, log the
 * provider's raw text response, or persist either. Only counts, ids and status
 * codes may be logged.
 */

const {
  SEMANTIC_CATEGORIES,
  MANUAL_REVIEW_KINDS,
} = require('./edocFieldSemantics');

/**
 * Separate from the CDL parser's GROQ_VISION_MODEL on purpose: the two features
 * have different accuracy/latency needs and must be able to move independently.
 * Changing this must never change CDL parsing.
 *
 * Verified against Groq's published docs (console.groq.com/docs/vision and
 * /docs/structured-outputs, checked 2026-07-28): the Llama 4 multimodal models
 * accept image input and are listed as supporting json_schema structured
 * outputs. Override per environment with GROQ_DOCUMENT_VISION_MODEL.
 */
const DEFAULT_GROQ_DOCUMENT_VISION_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';

const GROQ_RESPONSES_ENDPOINT = 'https://api.groq.com/openai/v1/responses';

/**
 * Strict JSON schema the provider must conform to. Percentage coordinates keep
 * placement independent of editor zoom and of the pixel size the page happened
 * to be rendered at.
 */
const FIELD_PLACEMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          category: { type: 'string', enum: SEMANTIC_CATEGORIES },
          label: { type: 'string' },
          required: { type: 'boolean' },
          confidence: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: [
          'page',
          'category',
          'label',
          'required',
          'confidence',
          'x',
          'y',
          'width',
          'height',
        ],
        additionalProperties: false,
      },
    },
    manualReview: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          kind: { type: 'string', enum: MANUAL_REVIEW_KINDS },
          detail: { type: 'string' },
        },
        required: ['page', 'kind', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions', 'manualReview'],
  additionalProperties: false,
};

const PROMPT = [
  'You locate blank fillable areas in a scanned business document so a human can review them.',
  'Return ONLY strict JSON matching the provided schema. No prose, no markdown.',
  'For each blank area a signer must fill, emit one suggestion.',
  `Allowed category values: ${SEMANTIC_CATEGORIES.join(', ')}.`,
  'Use "text" only for a blank whose meaning is none of the other categories.',
  'Coordinates are PERCENTAGES of the page: x and y are the top-left corner (0-100),',
  'width and height are the size (0-100). Never return pixels.',
  'confidence is 0-1 and must reflect genuine certainty; use low values when guessing.',
  'label is the short human-readable name of the blank, taken from the nearby printed text.',
  'Do NOT emit a suggestion for text that is already printed on the page.',
  'Do NOT invent fields that are not visibly blank.',
  `If the page contains a radio/single-choice group, dropdown, multi-line free-text area, repeating rows or a complex table, add an entry to manualReview with kind one of: ${MANUAL_REVIEW_KINDS.join(', ')}.`,
  'Never convert a mutually exclusive choice into independent checkboxes; report it in manualReview instead.',
].join(' ');

/** Pull the assistant text out of a Groq Responses API payload. */
function extractAssistantText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text;
      }
    }
  }
  return '';
}

/** Parse JSON, tolerating a model that wrapped the object in stray text. */
function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // fall through to brace slicing
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * Error shape every adapter throws so the callable can map failures to stable
 * HttpsError codes without knowing the vendor.
 *
 * @param {'not-configured'|'unavailable'|'provider-error'|'unreadable'} kind
 */
class DocumentVisionError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'DocumentVisionError';
    this.kind = kind;
  }
}

/**
 * Groq adapter.
 *
 * @param {{ apiKey?: string, model?: string, fetchImpl?: Function }} options
 */
function createGroqDocumentVisionProvider(options = {}) {
  const model =
    options.model ||
    process.env.GROQ_DOCUMENT_VISION_MODEL ||
    DEFAULT_GROQ_DOCUMENT_VISION_MODEL;

  return {
    name: 'groq',
    model,

    /**
     * @param {{ pages: Array<{pageNumber: number, imageDataUrl: string}> }} input
     * @returns {Promise<{ suggestions: object[], manualReview: object[], model: string }>}
     */
    async analyzeDocumentPages({ pages }) {
      const apiKey = options.apiKey || process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new DocumentVisionError(
          'not-configured',
          'Document vision provider is not configured on the server.'
        );
      }

      const content = [{ type: 'input_text', text: PROMPT }];
      for (const page of pages) {
        content.push({
          type: 'input_text',
          text: `The next image is page ${page.pageNumber}. Use page=${page.pageNumber} for every suggestion taken from it.`,
        });
        content.push({ type: 'input_image', image_url: page.imageDataUrl });
      }

      const requestBody = {
        model,
        temperature: 0,
        max_output_tokens: 4000,
        text: {
          format: {
            type: 'json_schema',
            name: 'edoc_field_placement',
            schema: FIELD_PLACEMENT_JSON_SCHEMA,
          },
        },
        input: [{ role: 'user', content }],
      };

      const doFetch = options.fetchImpl || globalThis.fetch;
      let response;
      try {
        response = await doFetch(GROQ_RESPONSES_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
      } catch (networkErr) {
        // Message only: the request body carries page images.
        console.error('[documentVisionProvider] network error:', networkErr?.message || 'unknown');
        throw new DocumentVisionError('unavailable', 'Could not reach the AI service.');
      }

      if (!response?.ok) {
        // Status only. The provider error body can echo request content back.
        console.error('[documentVisionProvider] provider status:', response?.status ?? 'unknown');
        throw new DocumentVisionError('provider-error', 'The AI service rejected the request.');
      }

      let raw;
      try {
        raw = await response.json();
      } catch (_) {
        throw new DocumentVisionError('unreadable', 'The AI service returned an unreadable response.');
      }

      const parsed = extractJsonObject(extractAssistantText(raw));
      if (!parsed || typeof parsed !== 'object') {
        // Never log the model text: it can quote document contents verbatim.
        console.error('[documentVisionProvider] model returned non-JSON output');
        throw new DocumentVisionError('unreadable', 'The AI service returned unreadable data.');
      }

      return {
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        manualReview: Array.isArray(parsed.manualReview) ? parsed.manualReview : [],
        model,
      };
    },
  };
}

/**
 * Resolve the configured provider. Only `groq` exists today; the indirection is
 * what keeps the callable vendor-neutral.
 */
function getDocumentVisionProvider(options = {}) {
  const name = (options.provider || process.env.DOCUMENT_VISION_PROVIDER || 'groq').toLowerCase();
  if (name === 'groq') return createGroqDocumentVisionProvider(options);
  throw new DocumentVisionError('not-configured', `Unknown document vision provider "${name}".`);
}

module.exports = {
  DEFAULT_GROQ_DOCUMENT_VISION_MODEL,
  FIELD_PLACEMENT_JSON_SCHEMA,
  DocumentVisionError,
  createGroqDocumentVisionProvider,
  getDocumentVisionProvider,
  __private: { extractAssistantText, extractJsonObject, PROMPT },
};
