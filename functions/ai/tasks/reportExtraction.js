/**
 * PSP report and MVR extraction — suggestions, never answers.
 *
 * A carrier may let its applicants upload their FMCSA Pre-Employment Screening
 * Program report or their motor vehicle record. The pages are read with the same
 * vision route the CDL auto-fill uses, and what comes back is a list of things
 * the applicant might want to add: a carrier the report mentions, a violation it
 * lists, the licence details an MVR prints. The applicant confirms each one.
 *
 * WHAT A PSP REPORT IS, AND IS NOT. It is crash and inspection history — a
 * carrier's USDOT number appears beside the date of an inspection or crash. That
 * is evidence the driver worked for (or drove for) that carrier around that
 * date; it is NOT an employment record with start and end dates. The output
 * therefore names `firstSeen` / `lastSeen` months and calls them what they are.
 * The wizard uses them to suggest "you may have driven for X around this time"
 * and leaves the employment dates for the applicant to enter.
 *
 * Privacy: both documents are `restricted`. Nothing about their content is
 * logged on this path.
 */

const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');

const MAX_ITEMS = 25;
const MAX_TEXT = 200;
const REPORT_TOTAL_DEADLINE_MS = 45000;
// Below the total, so a stalled provider fails over instead of taking the whole
// budget (see `CDL_PER_ATTEMPT_MS`). Longer than a single photo's 20s because a
// report sends up to five pages; 25s still leaves 20s for the next provider.
const REPORT_PER_ATTEMPT_MS = 25000;

const VIOLATION_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        date: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
    },
    required: ['date', 'description', 'location'],
    additionalProperties: false,
});

const PSP_JSON_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
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
    },
    required: ['carriers', 'violations'],
    additionalProperties: false,
});

const MVR_JSON_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        licenseNumber: { type: 'string' },
        state: { type: 'string' },
        licenseClass: { type: 'string' },
        expirationDate: { type: 'string' },
        endorsements: { type: 'array', items: { type: 'string' } },
        violations: { type: 'array', items: VIOLATION_SCHEMA },
    },
    required: ['licenseNumber', 'state', 'licenseClass', 'expirationDate', 'endorsements', 'violations'],
    additionalProperties: false,
});

const PSP_PROMPT = [
    'You are reading pages of a US FMCSA Pre-Employment Screening Program (PSP) driver report.',
    'Return ONLY strict JSON. No markdown. No prose.',
    'List every motor carrier named in the crash or inspection records: carrierName, usdotNumber (digits only, or empty),',
    'earliestDate and latestDate of the records mentioning that carrier (as printed, or empty), and recordType (inspection, crash, or both).',
    'List every violation or citation shown in inspection or crash records: date as printed, description, and location (city/state) if printed.',
    'Do not infer employment dates; report only what is printed. If nothing is readable, return empty arrays.',
].join(' ');

const MVR_PROMPT = [
    'You are reading pages of a US state motor vehicle record (MVR, driving record).',
    'Return ONLY strict JSON. No markdown. No prose.',
    'Return licenseNumber, state (two-letter postal code), licenseClass (for example "Class A"), expirationDate as printed,',
    'endorsements as a list of single-letter codes, and every violation or conviction listed: date as printed, description, location if printed.',
    'If a value is missing or unreadable, return an empty string or empty list for it. Never guess.',
].join(' ');

/** Trim to a string, bounded, or ''. */
function text(value, max = MAX_TEXT) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Printed dates come in every shape a state or FMCSA prints them in. Normalise to
 * `YYYY-MM-DD`, `YYYY-MM` when only a month is legible, or '' — a date that
 * cannot be read is offered blank, never invented.
 */
function looseDateToIso(raw) {
    const value = text(raw, 40);
    if (!value) return '';
    let match;
    if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value))) {
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value))) {
        const year = match[3].length === 2 ? Number(match[3]) + 2000 : Number(match[3]);
        return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }
    if ((match = /^(\d{1,2})[/-](\d{4})$/.exec(value))) {
        return `${match[2]}-${match[1].padStart(2, '0')}`;
    }
    if ((match = /^(\d{4})-(\d{1,2})$/.exec(value))) {
        return `${match[1]}-${match[2].padStart(2, '0')}`;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(value)) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return '';
}

function normalizeViolations(raw) {
    return (Array.isArray(raw) ? raw : [])
        .map((entry) => ({
            date: looseDateToIso(entry?.date),
            charge: text(entry?.description),
            location: text(entry?.location),
        }))
        .filter((entry) => entry.charge)
        .slice(0, MAX_ITEMS);
}

/**
 * The USDOT number in what the report printed beside a carrier.
 *
 * Read the whole value, then take the number — the same lesson as the state code
 * below. Cutting to twelve characters first turned "USDOT 1234567" into "123456"
 * (found 2026-10-01): seven digits is the ordinary length now, and the wrong number
 * became the identity a carrier then LOCKED, so the driver was held to an employer
 * nobody had. A labelled number wins over an unlabelled one ("MC 765432 USDOT …").
 */
function usdotDigits(raw) {
    const value = text(raw, 60);
    const labelled = /dot\D*?(\d+)/i.exec(value);
    const digits = labelled ? labelled[1] : (/\d+/.exec(value) || [''])[0];
    return digits.slice(0, 12);
}

function normalizePspOutput(raw) {
    const carriers = (Array.isArray(raw?.carriers) ? raw.carriers : [])
        .map((entry) => ({
            name: text(entry?.carrierName, 120),
            dotNumber: usdotDigits(entry?.usdotNumber),
            firstSeen: looseDateToIso(entry?.earliestDate).slice(0, 7),
            lastSeen: looseDateToIso(entry?.latestDate).slice(0, 7),
            recordType: /crash/i.test(text(entry?.recordType)) && /inspect/i.test(text(entry?.recordType))
                ? 'both'
                : /crash/i.test(text(entry?.recordType)) ? 'crash' : /inspect/i.test(text(entry?.recordType)) ? 'inspection' : 'unknown',
        }))
        .filter((entry) => entry.name || entry.dotNumber)
        .slice(0, MAX_ITEMS);
    return { carriers, violations: normalizeViolations(raw?.violations) };
}

function normalizeMvrOutput(raw) {
    const endorsements = (Array.isArray(raw?.endorsements) ? raw.endorsements : [])
        .map((code) => text(code, 3).toUpperCase().replace(/[^A-Z]/g, ''))
        .filter((code) => code.length === 1);
    // Read the whole printed value, then accept only a two-letter code: cutting
    // "Texas" to two characters would have produced a valid-looking "TE".
    const state = text(raw?.state, 40).toUpperCase();
    return {
        license: {
            cdlNumber: text(raw?.licenseNumber, 40),
            cdlState: /^[A-Z]{2}$/.test(state) ? state : '',
            cdlClass: text(raw?.licenseClass, 20),
            cdlExpiration: looseDateToIso(raw?.expirationDate),
            endorsements: [...new Set(endorsements)],
        },
        violations: normalizeViolations(raw?.violations),
    };
}

const KINDS = Object.freeze({
    psp: { taskType: TASK_TYPES.PSP_REPORT_EXTRACTION, prompt: PSP_PROMPT, schema: PSP_JSON_SCHEMA, schemaName: 'psp_report_extraction', normalize: normalizePspOutput },
    mvr: { taskType: TASK_TYPES.MVR_EXTRACTION, prompt: MVR_PROMPT, schema: MVR_JSON_SCHEMA, schemaName: 'mvr_extraction', normalize: normalizeMvrOutput },
});

/**
 * @param {object} params
 * @param {'psp'|'mvr'} params.kind
 * @param {string[]} params.imageDataUrls rendered page images, first page first
 * @param {object} [deps] injection seam for tests
 */
async function extractReportSuggestions({ kind, imageDataUrls }, deps = {}) {
    const spec = KINDS[kind];
    if (!spec) throw new Error(`Unknown report kind: ${kind}`);
    const capabilities = [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON];
    if (imageDataUrls.length > 1) capabilities.push(CAPABILITIES.MULTI_IMAGE);

    const task = defineTask({
        taskType: spec.taskType,
        capabilities,
        inputText: spec.prompt,
        images: imageDataUrls.map((dataUrl) => ({ dataUrl })),
        outputSchema: spec.schema,
        schemaName: spec.schemaName,
        temperature: 0,
        maxOutputTokens: 2500,
        privacy: PRIVACY.RESTRICTED,
        totalDeadlineMs: REPORT_TOTAL_DEADLINE_MS,
        perAttemptDeadlineMs: REPORT_PER_ATTEMPT_MS,
    });

    const result = await runAiTask(task, deps);
    return {
        kind,
        suggestions: spec.normalize(result.output),
        providerId: result.providerId,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackCount: result.fallbackCount,
    };
}

module.exports = {
    KINDS,
    MAX_ITEMS,
    MVR_JSON_SCHEMA,
    PSP_JSON_SCHEMA,
    REPORT_TOTAL_DEADLINE_MS,
    REPORT_PER_ATTEMPT_MS,
    extractReportSuggestions,
    looseDateToIso,
    normalizeMvrOutput,
    normalizePspOutput,
    // Shared with `applicationDocumentExtraction.js`, so a violation read from a
    // PDF's text layer and one read from a page image produce the same row. Two
    // copies would mean accepting a suggestion depended on which route answered.
    normalizeViolations,
};
