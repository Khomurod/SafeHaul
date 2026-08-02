/**
 * The normalized, provider-neutral AI task contract.
 *
 * Features describe *what they need*, never *who should answer*. A task names
 * its capabilities, its schema and its privacy classification; the router
 * decides the vendor. Nothing in a task refers to a provider, a model or an
 * endpoint.
 *
 * There is deliberately no generic "send any prompt" entry point. Every task
 * type below is a narrow, server-side interface owned by the AI platform, so
 * the set of prompts SafeHaul can issue is fixed at deploy time rather than
 * chosen by a caller.
 */

const { normalizeCapabilities } = require('../registry/capabilities');

/** Every task type the platform knows how to run. */
const TASK_TYPES = Object.freeze({
    CDL_EXTRACTION: 'cdl_extraction',
    EDOC_FIELD_PLACEMENT: 'edoc_field_placement',
    ARTICLE_GENERATION: 'article_generation',
    ARTICLE_FACT_CHECK: 'article_fact_check',
    CAPABILITY_CLAIM_CHECK: 'capability_claim_check',
    TOPIC_SELECTION: 'topic_selection',
    HEALTH_CHECK: 'health_check',
});

/**
 * Privacy classification, which decides what may be logged about a task.
 *
 * `restricted` covers anything containing a real person's documents or data:
 * CDL photographs, document pages. Nothing about the content of a restricted
 * task is ever logged — not the prompt, not the response, not an excerpt.
 * `public` covers material already published on the internet plus SafeHaul's
 * own approved marketing knowledge.
 */
const PRIVACY = Object.freeze({
    RESTRICTED: 'restricted',
    INTERNAL: 'internal',
    PUBLIC: 'public',
});

/**
 * Builds a validated task. Throws on a malformed task rather than letting a
 * half-specified request reach a vendor.
 *
 * @param {object} spec
 * @returns {Readonly<object>}
 */
function defineTask(spec) {
    const {
        taskType,
        capabilities,
        systemInstructions = '',
        inputText,
        images = null,
        outputSchema = null,
        schemaName = 'safehaul_task_output',
        temperature = 0,
        maxOutputTokens = 2048,
        privacy = PRIVACY.INTERNAL,
        totalDeadlineMs,
    } = spec;

    if (!Object.values(TASK_TYPES).includes(taskType)) {
        throw new Error(`Unknown AI task type "${String(taskType)}".`);
    }
    if (typeof inputText !== 'string' || !inputText.trim()) {
        throw new Error('An AI task requires input text.');
    }
    if (!Object.values(PRIVACY).includes(privacy)) {
        throw new Error(`Unknown privacy classification "${String(privacy)}".`);
    }

    return Object.freeze({
        taskType,
        capabilities: normalizeCapabilities(capabilities),
        systemInstructions,
        inputText,
        images: images ? Object.freeze([...images]) : null,
        outputSchema,
        schemaName,
        temperature,
        maxOutputTokens,
        privacy,
        totalDeadlineMs,
    });
}

module.exports = { TASK_TYPES, PRIVACY, defineTask };
