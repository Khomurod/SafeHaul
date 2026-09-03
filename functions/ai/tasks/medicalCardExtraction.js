/**
 * Reading a medical examiner's certificate.
 *
 * The vision fallback for the one document the other tasks do not cover: when the
 * text extracted from a medical card is unreadable — a phone photo of a laminated
 * card is where OCR is weakest — its pages come here instead.
 *
 * The application stores exactly one field from this card, `medCardExpiration`,
 * and this task returns exactly that. The examiner's name and the certificate
 * number are printed there too and are deliberately not extracted: nothing in the
 * application holds them, and reading a driver's medical document for fields
 * nobody stores is not something to do by accident.
 *
 * Privacy: a medical certificate is `restricted`. Nothing about its content is
 * logged on this path.
 */

const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');
const { looseDateToIso } = require('./reportExtraction');

const MEDICAL_CARD_JSON_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        expirationDate: { type: 'string' },
    },
    required: ['expirationDate'],
    additionalProperties: false,
});

const MEDICAL_CARD_PROMPT = [
    'You are reading a US medical examiner\'s certificate (DOT medical card) for a commercial driver.',
    'Return ONLY strict JSON. No markdown. No prose.',
    'Return expirationDate — the date the certificate expires, as printed on the card.',
    'If it is missing or unreadable, return an empty string. Never guess.',
].join(' ');

const MEDICAL_CARD_TOTAL_DEADLINE_MS = 45000;

function normalizeMedicalCardOutput(raw) {
    return { medCardExpiration: looseDateToIso(raw?.expirationDate) };
}

/**
 * @param {object} params
 * @param {string[]} params.imageDataUrls rendered pages, first page first
 * @param {object} [deps] injection seam for tests
 */
async function extractMedicalCardFields({ imageDataUrls }, deps = {}) {
    const capabilities = [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON];
    if (imageDataUrls.length > 1) capabilities.push(CAPABILITIES.MULTI_IMAGE);

    const task = defineTask({
        taskType: TASK_TYPES.MEDICAL_CARD_EXTRACTION,
        capabilities,
        inputText: MEDICAL_CARD_PROMPT,
        images: imageDataUrls.map((dataUrl) => ({ dataUrl })),
        outputSchema: MEDICAL_CARD_JSON_SCHEMA,
        schemaName: 'medical_card_extraction',
        temperature: 0,
        maxOutputTokens: 200,
        privacy: PRIVACY.RESTRICTED,
        totalDeadlineMs: MEDICAL_CARD_TOTAL_DEADLINE_MS,
    });

    const result = await runAiTask(task, deps);
    return {
        license: normalizeMedicalCardOutput(result.output),
        providerId: result.providerId,
        model: result.model,
        latencyMs: result.latencyMs,
        fallbackCount: result.fallbackCount,
    };
}

module.exports = {
    MEDICAL_CARD_JSON_SCHEMA,
    MEDICAL_CARD_PROMPT,
    MEDICAL_CARD_TOTAL_DEADLINE_MS,
    extractMedicalCardFields,
    normalizeMedicalCardOutput,
};
