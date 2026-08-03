/**
 * AI capability vocabulary.
 *
 * A capability is a *requirement of a task*, not a marketing feature of a
 * vendor. The router uses these to decide which providers may legally receive
 * a given request. The rule that matters most: a text-only provider must never
 * receive a CDL photograph or a document page image, so `VISION` is a hard
 * gate, never a preference.
 *
 * Keep this list small and behavioural. Adding a capability means every
 * provider row in `providers.js` must declare whether it supports it.
 */

const CAPABILITIES = Object.freeze({
    /** Plain prose generation. Every usable provider supports this. */
    TEXT: 'text',
    /** Server-enforced JSON matching a supplied schema. */
    STRUCTURED_JSON: 'structured_json',
    /** Understanding of a single raster image supplied inline. */
    VISION: 'vision',
    /** More than one image in a single request. */
    MULTI_IMAGE: 'multi_image',
    /** Roughly 100k input tokens or more. */
    LONG_CONTEXT: 'long_context',
    /** Condensing supplied source material. */
    SUMMARIZATION: 'summarization',
    /** Assigning supplied text to a fixed label set. */
    CLASSIFICATION: 'classification',
    /** Long-form editorial writing for publication. */
    ARTICLE_WRITING: 'article_writing',
});

const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

const CAPABILITY_SET = new Set(ALL_CAPABILITIES);

/**
 * Human labels for the Super Admin console. Kept here so the console and the
 * router cannot drift on what a capability is called.
 */
const CAPABILITY_LABELS = Object.freeze({
    [CAPABILITIES.TEXT]: 'Text generation',
    [CAPABILITIES.STRUCTURED_JSON]: 'Structured JSON output',
    [CAPABILITIES.VISION]: 'Image understanding',
    [CAPABILITIES.MULTI_IMAGE]: 'Multiple images',
    [CAPABILITIES.LONG_CONTEXT]: 'Long context',
    [CAPABILITIES.SUMMARIZATION]: 'Summarization',
    [CAPABILITIES.CLASSIFICATION]: 'Classification',
    [CAPABILITIES.ARTICLE_WRITING]: 'Article writing',
});

function isCapability(value) {
    return typeof value === 'string' && CAPABILITY_SET.has(value);
}

/**
 * Validates a caller-supplied capability list. Throws rather than silently
 * dropping an unknown capability: a typo that quietly widens the eligible
 * provider set is exactly how an image reaches a text-only vendor.
 *
 * @param {string[]} requested
 * @returns {string[]} frozen, de-duplicated capability list
 */
function normalizeCapabilities(requested) {
    if (!Array.isArray(requested) || requested.length === 0) {
        throw new Error('At least one capability is required.');
    }
    const seen = [];
    for (const capability of requested) {
        if (!isCapability(capability)) {
            throw new Error(`Unknown AI capability "${String(capability)}".`);
        }
        if (!seen.includes(capability)) seen.push(capability);
    }
    return Object.freeze(seen);
}

module.exports = {
    CAPABILITIES,
    ALL_CAPABILITIES,
    CAPABILITY_LABELS,
    isCapability,
    normalizeCapabilities,
};
