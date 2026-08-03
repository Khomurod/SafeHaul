/**
 * CDL extraction task.
 *
 * The prompt, the JSON schema, the temperature and the output token ceiling
 * are carried over verbatim from the pre-migration `functions/cdlParser.js`.
 * That is deliberate: this change is meant to alter *which vendor may answer*,
 * not what SafeHaul asks for or what the driver-application wizard receives.
 * Any behavioural drift here would show up as different extracted fields on a
 * live driver application.
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
 * @param {object} params
 * @param {string} params.imageDataUrl a `data:image/...;base64,...` URL
 * @param {object} [deps] injection seam for tests
 * @returns {Promise<{ fields: object, providerId: string, model: string, latencyMs: number, fallbackCount: number }>}
 */
async function extractCdlFields({ imageDataUrl }, deps = {}) {
    const task = defineTask({
        taskType: TASK_TYPES.CDL_EXTRACTION,
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
        inputText: CDL_PROMPT,
        images: [{ dataUrl: imageDataUrl }],
        outputSchema: CDL_JSON_SCHEMA,
        schemaName: 'cdl_extraction',
        temperature: 0,
        maxOutputTokens: 450,
        privacy: PRIVACY.RESTRICTED,
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

module.exports = { extractCdlFields, CDL_JSON_SCHEMA, CDL_PROMPT, normalizeFields, FIELD_KEYS };
