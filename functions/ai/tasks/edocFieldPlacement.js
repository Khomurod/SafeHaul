/**
 * E-Doc field-placement task.
 *
 * Schema and prompt are carried over verbatim from
 * `functions/shared/documentVisionProvider.js`, and the shared semantic
 * vocabulary is still imported from `functions/shared/edocFieldSemantics.js`
 * so the server, this task and the signing editor cannot drift on what a
 * category means.
 *
 * The callable keeps its own normalization, clamping and de-duplication of the
 * returned suggestions. This task is responsible only for getting
 * schema-valid output from some provider; deciding what is a legitimate field
 * placement stays where it already was.
 *
 * Privacy: document page images are `restricted`.
 */

const {
    SEMANTIC_CATEGORIES,
    MANUAL_REVIEW_KINDS,
} = require('../../shared/edocFieldSemantics');
const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');

/** Unchanged from the original provider module. */
const FIELD_PLACEMENT_JSON_SCHEMA = Object.freeze({
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
                required: ['page', 'category', 'label', 'required', 'confidence', 'x', 'y', 'width', 'height'],
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
});

/** Unchanged from the original provider module. */
const FIELD_PLACEMENT_PROMPT = [
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

/**
 * Tells the model which page number each image belongs to, so returned page
 * numbers line up with the document rather than with array position.
 */
function buildPageLegend(pages) {
    return pages
        .map((page, index) => `Image ${index + 1} is page ${page.pageNumber}.`)
        .join(' ');
}

/**
 * @param {object} params
 * @param {Array<{ pageNumber: number, imageDataUrl: string }>} params.pages
 * @param {object} [deps]
 * @returns {Promise<{ suggestions: Array, manualReview: Array, providerId: string, model: string }>}
 */
async function analyzeDocumentPages({ pages }, deps = {}) {
    const capabilities = [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON];
    if (pages.length > 1) capabilities.push(CAPABILITIES.MULTI_IMAGE);

    const task = defineTask({
        taskType: TASK_TYPES.EDOC_FIELD_PLACEMENT,
        capabilities,
        inputText: `${FIELD_PLACEMENT_PROMPT} ${buildPageLegend(pages)}`,
        images: pages.map((page) => ({ dataUrl: page.imageDataUrl })),
        outputSchema: FIELD_PLACEMENT_JSON_SCHEMA,
        schemaName: 'edoc_field_placement',
        temperature: 0,
        maxOutputTokens: 4000,
        privacy: PRIVACY.RESTRICTED,
    });

    const result = await runAiTask(task, deps);
    return {
        suggestions: Array.isArray(result.output?.suggestions) ? result.output.suggestions : [],
        manualReview: Array.isArray(result.output?.manualReview) ? result.output.manualReview : [],
        providerId: result.providerId,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackCount: result.fallbackCount,
    };
}

module.exports = {
    analyzeDocumentPages,
    FIELD_PLACEMENT_JSON_SCHEMA,
    FIELD_PLACEMENT_PROMPT,
    buildPageLegend,
};
