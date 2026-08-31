/**
 * Turning what a provider returned into what the task asked for, and the
 * small guards around a request and its verdict.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { AiError } = require('./errors');
const { validateAgainstSchema, extractJsonObject } = require('../validation/schema');
/**
 * Validates a provider's raw text against the task's expected output.
 *
 * A structured task that yields unparseable or schema-violating JSON is a
 * *provider* failure, so it fails over — which is what makes structured output
 * reliable across nine vendors of differing JSON discipline.
 */
function normalizeOutput({ text, schema, providerId }) {
    if (!schema) return { output: text };

    const parsed = extractJsonObject(text);
    if (!parsed) {
        throw new AiError('malformed_response', 'Output was not parseable JSON.', { providerId });
    }

    const { valid, errors } = validateAgainstSchema(parsed, schema);
    if (!valid) {
        // Only the first violation, and it names a path, not a value.
        throw new AiError('schema_validation_failed', errors[0] || 'Schema validation failed.', { providerId });
    }
    return { output: parsed };
}

/**
 * Rejects images SafeHaul itself built wrongly, once, before any provider is
 * tried.
 *
 * A non-data-URL image is a bug on our side, not a vendor's, so it is fatal —
 * but it must be fatal *here*, where it costs nothing. It used to surface from
 * inside the Gemini adapter as `invalid_request`, which `isTaskFatal` treats as
 * terminal, so a malformed image aborted the whole walk from within whichever
 * provider happened to be first. Same verdict, reached before spending a
 * request, and identical no matter who leads the order.
 */
const IMAGE_DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;


function assertImagesAreWellFormed(images) {
    for (const [index, image] of images.entries()) {
        if (typeof image?.dataUrl !== 'string' || !IMAGE_DATA_URL.test(image.dataUrl)) {
            throw new AiError('invalid_request', `Image ${index + 1} is not a base64 data URL.`);
        }
    }
}

/**
 * A task's own one-word summary of its answer, sanitised.
 *
 * The pattern check is the point: a task supplies the reducer, and this makes it
 * impossible for one to hand telemetry an article, a claim, a source or anything
 * else with a space in it. Anything that is not a short single token is dropped
 * rather than truncated — the same rule `vendorCode` follows, because a truncated
 * sentence is still a sentence.
 */
const VERDICT_PATTERN = /^[a-z0-9_.-]{1,32}$/i;


function safeVerdict(task, output) {
    if (typeof task?.verdictOf !== 'function') return null;
    try {
        const verdict = task.verdictOf(output);
        return typeof verdict === 'string' && VERDICT_PATTERN.test(verdict) ? verdict : null;
    } catch {
        // A reducer that throws must never fail the task it is describing.
        return null;
    }
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

module.exports = { normalizeOutput, assertImagesAreWellFormed, safeVerdict, sleep };
