/**
 * CDL extraction task.
 *
 * The prompt, the JSON schema, the temperature and the output token ceiling
 * are carried over verbatim from the pre-migration `functions/cdlParser.js`.
 * That is deliberate: this change is meant to alter *which vendor may answer*,
 * not what SafeHaul asks for or what the driver-application wizard receives.
 * Any behavioural drift here would show up as different extracted fields on a
 * live driver application. The one addition is for the carrier's reader, which
 * can send a licence's two sides: with more than one page, one sentence says so.
 *
 * Privacy: a CDL photograph is `restricted`. Nothing about its content is
 * logged anywhere on this path.
 */

const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');

/** Unchanged from the original callable. */
const CDL_JSON_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        dateOfBirth: { type: 'string' },
        fullAddress: { type: 'string' },
        cdlNumber: { type: 'string' },
        expirationDate: { type: 'string' },
    },
    required: ['firstName', 'lastName', 'dateOfBirth', 'fullAddress', 'cdlNumber', 'expirationDate'],
    additionalProperties: false,
});

/** Unchanged from the original callable, including spacing and ordering. */
const CDL_PROMPT = [
    'You are an OCR data extractor for US Commercial Driver Licenses (CDL).',
    'Return ONLY strict JSON. No markdown. No prose.',
    'Required keys: firstName, lastName, dateOfBirth, fullAddress, cdlNumber, expirationDate.',
    'If a value is missing or unreadable, return empty string for that key.',
    'Keep dates exactly as printed on the card when possible.',
    'For fullAddress, prefer USPS-style with commas: street line, city, ST ZIP (ZIP+4 ok).',
    'If the card prints on one line with no commas, keep that single line; do not invent commas.',
].join(' ');

/** Added only when there is more than one page, so the driver's request is unchanged. */
const CDL_PAGES_NOTE = 'The images are the pages of one license, front and back: read each field from whichever page prints it.';

const FIELD_KEYS = Object.freeze([
    'firstName', 'lastName', 'dateOfBirth', 'fullAddress', 'cdlNumber', 'expirationDate',
]);

/** Coerces every key to a trimmed string, as the original `normalizeOutput` did. */
function normalizeFields(raw) {
    const fields = {};
    for (const key of FIELD_KEYS) {
        const value = raw?.[key];
        fields[key] = typeof value === 'string' ? value.trim() : '';
    }
    return fields;
}

/**
 * Ceiling for the whole CDL request, across every fallback.
 *
 * Exported so `cdlParser.test.js` can assert it stays below the callable's
 * `FUNCTION_TIMEOUT_SECONDS`. See the note at the `totalDeadlineMs` below.
 */
const CDL_TOTAL_DEADLINE_MS = 45000;

/**
 * Ceiling for one provider's attempt, below the total on purpose.
 *
 * The first provider in the routing order has a timeout as long as the whole
 * budget, so without this a stalled one took all 45s: the driver got a timeout
 * while the other providers sat unused, and the stall ended the task before it
 * could count against that provider, so the next driver waited on it too. A
 * stall now fails over with time to spare and is recorded like any failure.
 */
const CDL_PER_ATTEMPT_MS = 20000;

/**
 * @param {object} params
 * @param {string} [params.imageDataUrl] a `data:image/...;base64,...` URL: the driver's one photo
 * @param {string[]} [params.imageDataUrls] the pages of one licence, in the order attached
 * @param {object} [deps] injection seam for tests
 * @returns {Promise<{ fields: object, providerId: string, model: string, latencyMs: number, fallbackCount: number }>}
 */
async function extractCdlFields({ imageDataUrl, imageDataUrls }, deps = {}) {
    const pages = Array.isArray(imageDataUrls) && imageDataUrls.length > 0 ? imageDataUrls : [imageDataUrl];
    const capabilities = [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON];
    if (pages.length > 1) capabilities.push(CAPABILITIES.MULTI_IMAGE);

    const task = defineTask({
        taskType: TASK_TYPES.CDL_EXTRACTION,
        capabilities,
        inputText: pages.length > 1 ? `${CDL_PROMPT} ${CDL_PAGES_NOTE}` : CDL_PROMPT,
        images: pages.map((dataUrl) => ({ dataUrl })),
        outputSchema: CDL_JSON_SCHEMA,
        schemaName: 'cdl_extraction',
        temperature: 0,
        maxOutputTokens: 450,
        privacy: PRIVACY.RESTRICTED,
        // Must stay below `parseCdlWithGroq`'s 60s function timeout.
        //
        // Without this the router used its 120s default *inside* a function
        // that dies at 60, so a slow fallback chain was killed mid-walk: the
        // driver got a generic function timeout instead of the mapped
        // `unavailable` error, and no telemetry row was ever written — the
        // failures hardest to diagnose were the ones that recorded nothing.
        //
        // 45s leaves room for the callable to map the error and for the
        // telemetry write to land.
        totalDeadlineMs: CDL_TOTAL_DEADLINE_MS,
        perAttemptDeadlineMs: CDL_PER_ATTEMPT_MS,
    });

    const result = await runAiTask(task, deps);
    return {
        fields: normalizeFields(result.output),
        providerId: result.providerId,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackCount: result.fallbackCount,
    };
}

module.exports = {
    extractCdlFields,
    CDL_JSON_SCHEMA,
    CDL_PROMPT,
    CDL_TOTAL_DEADLINE_MS,
    CDL_PER_ATTEMPT_MS,
    normalizeFields,
    FIELD_KEYS,
};
