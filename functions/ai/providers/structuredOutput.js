/**
 * Prompt-carried JSON schema, shared by every adapter that needs it.
 *
 * Some structured-output modes cannot enforce a schema server-side: the vendor
 * will promise valid JSON and nothing more. In those modes the schema is
 * restated in the prompt, and SafeHaul's own validator in
 * `../validation/schema.js` is what actually enforces it on return.
 *
 * This lives in one module rather than in each adapter because the set of modes
 * that need it is a property of the platform, not of any one vendor, and
 * because two copies of the reminder text would drift. Groq reaches it through
 * its Responses API adapter and the OpenAI-compatible vendors through theirs.
 */

const { STRUCTURED_MODE } = require('../registry/providers');

/**
 * Modes with no server-side schema enforcement.
 *
 * `json_object`-style modes guarantee syntactically valid JSON and nothing
 * about its shape, so from SafeHaul's point of view they are the same as having
 * no JSON mode at all — the schema has to travel in the prompt either way.
 */
const PROMPT_CARRIED_MODES = Object.freeze([
    STRUCTURED_MODE.PROMPT_ONLY,
    STRUCTURED_MODE.OPENAI_JSON_OBJECT,
    STRUCTURED_MODE.GROQ_RESPONSES_JSON_OBJECT,
]);

function needsPromptCarriedSchema(structuredMode) {
    return PROMPT_CARRIED_MODES.includes(structuredMode);
}

/** Restates the schema in the prompt for vendors with no enforceable JSON mode. */
function schemaReminder(schema) {
    return [
        '',
        'Reply with a single JSON object and nothing else. No prose, no code fence.',
        'The object must conform exactly to this JSON Schema:',
        JSON.stringify(schema),
    ].join('\n');
}

/**
 * The prompt to actually send: the caller's text, plus the schema when the
 * chosen mode cannot enforce one.
 */
function applyPromptCarriedSchema({ inputText, schema, structuredMode }) {
    if (!schema || !needsPromptCarriedSchema(structuredMode)) return inputText;
    return `${inputText}${schemaReminder(schema)}`;
}

module.exports = {
    PROMPT_CARRIED_MODES,
    needsPromptCarriedSchema,
    schemaReminder,
    applyPromptCarriedSchema,
};
