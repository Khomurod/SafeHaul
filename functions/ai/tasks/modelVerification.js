/**
 * Whether one model version does the job its lane is for: the daily model
 * check's test, asked of each version directly through its adapter.
 *
 * Directly, not through the router, for the same reason Test connection is:
 * a check must not move the provider's health, cooldowns or rests, and must
 * ask the exact version it names rather than whichever one answers.
 *
 * ## The two tests
 *
 * - **Photos:** the licence read exactly as a driver's is (`./cdlExtraction.js`:
 *   its prompt, schema and output budget) on a fake licence, then compared
 *   field by field. A version passes only when it reads all six fields right,
 *   because that is the job; "it accepted an image" is what Test connection
 *   already proves.
 * - **Text:** the structured-JSON probe from `./healthProbes.js`, which is the
 *   shape every text task asks for and the one that broke Groq in production
 *   while plain text still worked.
 *
 * ## The fake licence
 *
 * `verification/cdl-specimen.jpg` is a made-up Texas CDL: an invented person, a
 * sample address, the word SPECIMEN across it, and no photograph. Its SHA-256 is
 * pinned in `test/unit/aiModelVerification.test.js`, so it cannot be swapped for
 * a real licence without a reviewed change to that test. Nothing else in the
 * repository is an image of a document.
 */

const fs = require('fs');
const path = require('path');

const { LANES, CAPABILITIES } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError } = require('../router/errors');
const { normalizeOutput } = require('../router/output');
const { CDL_JSON_SCHEMA, CDL_PROMPT, normalizeFields } = require('./cdlExtraction');
const { PROBES } = require('./healthProbes');

const SPECIMEN_PATH = path.join(__dirname, 'verification', 'cdl-specimen.jpg');

/** Under a licence read's per-attempt ceiling with room to spare: a check is not a race. */
const VERIFY_TIMEOUT_MS = 25000;

/**
 * What a check found about one version, in the words the decision and the
 * owner's messages use.
 */
const RESULT = Object.freeze({
    PASSED: 'passed',
    /** Answered, but not right: a wrong field, or nothing SafeHaul could use. */
    MISREAD: 'misread',
    /** Withdrawn, not on this plan, or missing from the vendor's own list. */
    GONE: 'gone',
    /** Would not take the request at all. */
    REFUSED: 'refused',
    /** Busy, slow or unreachable: says nothing about the version. */
    BUSY: 'busy',
    /** The key was refused. */
    KEY: 'key',
    /** The account's allowance or money ran out. */
    QUOTA: 'quota',
    ERROR: 'error',
});

const RESULT_FOR_CATEGORY = Object.freeze({
    model_unavailable: RESULT.GONE,
    provider_request_rejected: RESULT.REFUSED,
    invalid_request: RESULT.REFUSED,
    malformed_response: RESULT.MISREAD,
    schema_validation_failed: RESULT.MISREAD,
    output_truncated: RESULT.MISREAD,
    unauthorized: RESULT.KEY,
    quota_exceeded: RESULT.QUOTA,
    rate_limited: RESULT.BUSY,
    provider_unavailable: RESULT.BUSY,
    timeout: RESULT.BUSY,
    network: RESULT.BUSY,
    deadline_exceeded: RESULT.BUSY,
});

let specimenDataUrl = null;

/** The fake licence as a data URL, read once per instance. */
function specimenImage() {
    if (!specimenDataUrl) {
        specimenDataUrl = `data:image/jpeg;base64,${fs.readFileSync(SPECIMEN_PATH).toString('base64')}`;
    }
    return specimenDataUrl;
}

const digits = (value) => String(value || '').replace(/\D/g, '');
const letters = (value) => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');

/** A date as printed (`04/12/1988`) or as a model may reformat it (`1988-04-12`). */
function sameDate(value, monthDayYear) {
    const read = digits(value);
    return read === monthDayYear || read === `${monthDayYear.slice(4)}${monthDayYear.slice(0, 4)}`;
}

/**
 * Whether the six fields are what the specimen prints, compared the way a
 * person would accept them: names without punctuation, dates in either order,
 * the address by its number and city.
 */
function readSpecimenRight(output) {
    const fields = normalizeFields(output);
    return letters(fields.firstName).startsWith('DANA')
        && letters(fields.lastName) === 'WHITFIELD'
        && sameDate(fields.dateOfBirth, '04121988')
        && sameDate(fields.expirationDate, '04122030')
        && digits(fields.cdlNumber) === '87654321'
        && /\b1200\b/.test(fields.fullAddress) && /AUSTIN/i.test(fields.fullAddress);
}

const STRUCTURED_PROBE = PROBES.find((probe) => probe.id === 'structured_json');

/** The request each lane is checked with. */
function requestFor(lane) {
    if (lane === LANES.VISION) {
        return {
            capability: CAPABILITIES.VISION,
            inputText: CDL_PROMPT,
            images: [{ dataUrl: specimenImage() }],
            schema: CDL_JSON_SCHEMA,
            schemaName: 'safehaul_model_check_cdl',
            maxOutputTokens: 450,
            check: readSpecimenRight,
        };
    }
    return {
        capability: CAPABILITIES.STRUCTURED_JSON,
        inputText: STRUCTURED_PROBE.inputText,
        images: null,
        schema: STRUCTURED_PROBE.schema,
        schemaName: 'safehaul_model_check_text',
        maxOutputTokens: STRUCTURED_PROBE.maxOutputTokens,
        check: STRUCTURED_PROBE.validate,
    };
}

/**
 * Checks one version on one lane.
 *
 * @param {object} params
 * @param {object} params.provider registry row
 * @param {string} params.lane `vision` or `text`
 * @param {string} params.model
 * @param {object} params.credentials resolved credentials (`values`)
 * @param {object} params.config the provider's stored config
 * @param {object} [params.deps] `{ fetchImpl }`
 * @returns {Promise<{ model: string, result: string, category: (string|null), latencyMs: number }>}
 */
async function verifyModel({ provider, lane, model, credentials, config, deps = {} }) {
    const request = requestFor(lane);
    const startedAt = Date.now();
    const outcome = (result, category) => ({ model, result, category, latencyMs: Date.now() - startedAt });
    try {
        const raw = await getAdapter(provider).execute({
            provider,
            capability: request.capability,
            model,
            systemInstructions: '',
            inputText: request.inputText,
            images: request.images,
            schema: request.schema,
            schemaName: request.schemaName,
            temperature: 0,
            maxOutputTokens: request.maxOutputTokens,
            timeoutMs: VERIFY_TIMEOUT_MS,
            parentSignal: undefined,
            credentials: credentials.values,
            config,
            fetchImpl: deps.fetchImpl,
        });
        const { output } = normalizeOutput({ text: raw?.text, schema: request.schema, providerId: provider.id });
        return request.check(output) ? outcome(RESULT.PASSED, null) : outcome(RESULT.MISREAD, 'wrong_answer');
    } catch (error) {
        const category = error instanceof AiError ? error.category : 'internal';
        return outcome(RESULT_FOR_CATEGORY[category] || RESULT.ERROR, category);
    }
}

module.exports = {
    RESULT,
    SPECIMEN_PATH,
    VERIFY_TIMEOUT_MS,
    verifyModel,
    readSpecimenRight,
};
