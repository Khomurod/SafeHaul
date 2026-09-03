/**
 * Reading a driver's paperwork as TEXT, in one request.
 *
 * A carrier's licence photo, medical card, PSP report and motor vehicle record
 * are extracted in the browser — a PDF's own text layer where it has one, OCR
 * where it does not — and arrive here as one labelled document. This task turns
 * that into the fields a driver application actually holds.
 *
 * ## Why one text task rather than four vision calls
 *
 * A PSP report and a motor vehicle record are generated PDFs: their text layer is
 * the real text, not a guess about pixels, and reading all of them together lets
 * the model reconcile what they say — the same licence number on the CDL and the
 * MVR is one licence number. It is also one request rather than four, on a lane
 * with long-context providers, instead of four vision requests on the scarcer one.
 *
 * ## Any subset, always
 *
 * A recruiter may hold one document or all four. Whatever arrives is read and
 * whatever does not is absent — never inferred from another document, never
 * required, never an error.
 *
 * ## `readable` is the point of the schema
 *
 * The model reports, per document, whether the text it was given was good enough
 * to read. That is what lets the caller fall back to sending that one document's
 * pages to the vision route instead: OCR of a phone photo is exactly where text
 * extraction is weakest, and a model saying "this was garbage" is worth more than
 * a confidence score nobody calibrated.
 *
 * Privacy: a licence, a medical card and a safety record are `restricted`.
 * Nothing about their content is logged on this path.
 */

const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');
const { looseDateToIso, normalizeViolations, normalizePspOutput } = require('./reportExtraction');

/** The documents this task knows how to be given. Any subset, in any combination. */
const DOCUMENT_KINDS = Object.freeze(['cdl', 'medical', 'psp', 'mvr']);

const DOCUMENT_LABELS = Object.freeze({
    cdl: "DRIVER'S LICENSE",
    medical: 'MEDICAL EXAMINER CERTIFICATE',
    psp: 'FMCSA PSP REPORT',
    mvr: 'MOTOR VEHICLE RECORD',
});

/**
 * How much of each document reaches the prompt, and how much in total.
 *
 * Sized against the same arithmetic `blog/research/fetchSources.js` documents: a
 * provider's per-minute token budget is the binding constraint, and the ceiling
 * has to be one a caller cannot raise. Four documents at 5,000 characters is a
 * long prompt for a text lane and a short one for a long-context provider, which
 * is why the task asks for `LONG_CONTEXT` rather than hoping.
 */
const MAX_CHARS_PER_DOCUMENT = 5000;
const MAX_TOTAL_CHARS = 16000;

/** Below the router's own default and below the callable's timeout, as the siblings are. */
const DOCUMENT_TOTAL_DEADLINE_MS = 45000;
// Below the total on purpose: no single provider may take the whole budget, so a
// stalled one (a rate-limited provider sitting at the top of the routing order)
// fails over to a healthy one with time to spare, instead of timing out the whole
// read. 45s total / ~20s each leaves room for two full attempts.
const DOCUMENT_PER_ATTEMPT_MS = 20000;

const VIOLATION_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        date: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        source: { type: 'string' },
    },
    required: ['date', 'description', 'location', 'source'],
    additionalProperties: false,
});

const DOCUMENT_JSON_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        driver: {
            type: 'object',
            properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                dateOfBirth: { type: 'string' },
                fullAddress: { type: 'string' },
            },
            required: ['firstName', 'lastName', 'dateOfBirth', 'fullAddress'],
            additionalProperties: false,
        },
        license: {
            type: 'object',
            properties: {
                licenseNumber: { type: 'string' },
                state: { type: 'string' },
                licenseClass: { type: 'string' },
                expirationDate: { type: 'string' },
                endorsements: { type: 'array', items: { type: 'string' } },
                medicalCardExpiration: { type: 'string' },
            },
            required: ['licenseNumber', 'state', 'licenseClass', 'expirationDate', 'endorsements', 'medicalCardExpiration'],
            additionalProperties: false,
        },
        carriers: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    carrierName: { type: 'string' },
                    usdotNumber: { type: 'string' },
                    earliestDate: { type: 'string' },
                    latestDate: { type: 'string' },
                    recordType: { type: 'string' },
                },
                required: ['carrierName', 'usdotNumber', 'earliestDate', 'latestDate', 'recordType'],
                additionalProperties: false,
            },
        },
        violations: { type: 'array', items: VIOLATION_SCHEMA },
        unreadable: { type: 'array', items: { type: 'string' } },
    },
    required: ['driver', 'license', 'carriers', 'violations', 'unreadable'],
    additionalProperties: false,
});

const DOCUMENT_PROMPT = [
    'You are reading text extracted from a US commercial driver\'s hiring documents.',
    'Each document appears under a heading like "=== FMCSA PSP REPORT ===". Only some may be present.',
    'Return ONLY strict JSON. No markdown. No prose.',
    'driver: the name, date of birth and address as printed on the licence.',
    'license: licence number, two-letter state, class (for example "Class A"), expiration date as printed,',
    'endorsement letters, and medicalCardExpiration from the medical examiner certificate.',
    'carriers: every motor carrier named in PSP crash or inspection records — carrierName, usdotNumber (digits only),',
    'earliestDate and latestDate of records mentioning it as printed, and recordType (inspection, crash, or both).',
    'violations: every violation or conviction in the PSP report or the motor vehicle record, with source set to',
    '"psp" or "mvr" for the document it came from.',
    'unreadable: the heading name of any document whose text was too garbled or too sparse to read.',
    'Report only what is printed. Never infer employment dates from inspection dates. Leave anything missing empty.',
].join(' ');

function text(value, max = 200) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * The labelled document handed to the model.
 *
 * Truncated here as well as in the caller, because the caller is a browser and a
 * ceiling a client enforces is a ceiling a client can raise.
 */
function buildDocumentText(documents) {
    const parts = [];
    let budget = MAX_TOTAL_CHARS;
    for (const kind of DOCUMENT_KINDS) {
        const body = typeof documents?.[kind] === 'string' ? documents[kind].trim() : '';
        if (!body || budget <= 0) continue;
        const slice = body.slice(0, Math.min(MAX_CHARS_PER_DOCUMENT, budget));
        budget -= slice.length;
        parts.push(`=== ${DOCUMENT_LABELS[kind]} ===\n${slice}`);
    }
    return parts.join('\n\n');
}

/** Which documents the model said it could not read, mapped back to their keys. */
function normalizeUnreadable(raw) {
    const reported = (Array.isArray(raw) ? raw : []).map((entry) => text(entry, 60).toUpperCase());
    return DOCUMENT_KINDS.filter((kind) => reported.some(
        (entry) => entry.includes(DOCUMENT_LABELS[kind]) || entry === kind.toUpperCase(),
    ));
}

/**
 * One shape for both routes.
 *
 * The carrier and violation normalisers are the vision task's own, imported rather
 * than reimplemented: a PSP violation read from a text layer and one read from a
 * page image must produce the same row, or accepting a suggestion would depend on
 * which route happened to answer.
 */
function normalizeDocumentOutput(raw) {
    const psp = normalizePspOutput({ carriers: raw?.carriers, violations: [] });
    const endorsements = (Array.isArray(raw?.license?.endorsements) ? raw.license.endorsements : [])
        .map((code) => text(code, 3).toUpperCase().replace(/[^A-Z]/g, ''))
        .filter((code) => code.length === 1);
    const state = text(raw?.license?.state, 40).toUpperCase();

    return {
        driver: {
            firstName: text(raw?.driver?.firstName, 80),
            lastName: text(raw?.driver?.lastName, 80),
            dateOfBirth: looseDateToIso(raw?.driver?.dateOfBirth),
            fullAddress: text(raw?.driver?.fullAddress, 200),
        },
        license: {
            cdlNumber: text(raw?.license?.licenseNumber, 40),
            cdlState: /^[A-Z]{2}$/.test(state) ? state : '',
            cdlClass: text(raw?.license?.licenseClass, 20),
            cdlExpiration: looseDateToIso(raw?.license?.expirationDate),
            endorsements: [...new Set(endorsements)],
            medCardExpiration: looseDateToIso(raw?.license?.medicalCardExpiration),
        },
        carriers: psp.carriers,
        violations: normalizeViolations(raw?.violations).map((row, index) => ({
            ...row,
            source: text(raw?.violations?.[index]?.source, 8).toLowerCase() === 'mvr' ? 'mvr' : 'psp',
        })),
        unreadable: normalizeUnreadable(raw?.unreadable),
    };
}

/**
 * @param {object} params
 * @param {{cdl?: string, medical?: string, psp?: string, mvr?: string}} params.documents
 *   Extracted text per document. Any subset; at least one.
 * @param {object} [deps] injection seam for tests
 */
async function extractApplicationDocuments({ documents }, deps = {}) {
    const inputText = buildDocumentText(documents);
    if (!inputText) throw new Error('No document text was provided.');

    const task = defineTask({
        taskType: TASK_TYPES.APPLICATION_DOCUMENT_EXTRACTION,
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT],
        inputText: `${DOCUMENT_PROMPT}\n\n${inputText}`,
        outputSchema: DOCUMENT_JSON_SCHEMA,
        schemaName: 'application_document_extraction',
        temperature: 0,
        maxOutputTokens: 3000,
        privacy: PRIVACY.RESTRICTED,
        totalDeadlineMs: DOCUMENT_TOTAL_DEADLINE_MS,
        perAttemptDeadlineMs: DOCUMENT_PER_ATTEMPT_MS,
    });

    const result = await runAiTask(task, deps);
    return {
        extracted: normalizeDocumentOutput(result.output),
        providerId: result.providerId,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackCount: result.fallbackCount,
    };
}

module.exports = {
    DOCUMENT_JSON_SCHEMA,
    DOCUMENT_KINDS,
    DOCUMENT_LABELS,
    DOCUMENT_PROMPT,
    DOCUMENT_PER_ATTEMPT_MS,
    DOCUMENT_TOTAL_DEADLINE_MS,
    MAX_CHARS_PER_DOCUMENT,
    MAX_TOTAL_CHARS,
    buildDocumentText,
    extractApplicationDocuments,
    normalizeDocumentOutput,
    normalizeUnreadable,
};
