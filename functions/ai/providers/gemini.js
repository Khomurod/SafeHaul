/**
 * Google Gemini adapter.
 *
 * Targets the Interactions API (`/v1beta/interactions`), which Google's
 * current documentation presents as the standard surface, authenticated with
 * the `x-goog-api-key` header. Structured output uses `response_format` with a
 * `mime_type` of `application/json` and an inline schema.
 *
 * Images are supplied inline as base64 with their media type, which is why the
 * adapter splits the data URL rather than passing it through — Gemini does not
 * accept the `data:` prefix.
 */

const { postJson } = require('./http');
const { AiError } = require('../router/errors');

const INTERACTIONS_PATH = '/interactions';

/**
 * Extra `max_output_tokens` granted to cover Gemini's private reasoning.
 *
 * Current Gemini models think before answering, and those thought tokens are
 * charged against `max_output_tokens` alongside the visible answer. A caller
 * asking for 450 tokens of JSON is asking for 450 tokens *of JSON* — every
 * other provider in the registry reads the parameter that way, and a shared
 * platform is worth little if one adapter silently means something else.
 *
 * Measured against the live API on 2026-08-03 with `gemini-3.6-flash`: a
 * one-word answer consumed 83 thought tokens at the default thinking level and
 * 58 at `thinking_level: low`. A 16-token budget produced 13 thought tokens,
 * zero output tokens and `status: "incomplete"` — the model never got to
 * answer. Real prompts reason more than a one-word reply does, so the headroom
 * is set well above the measured figures rather than at them.
 *
 * This is a ceiling, not a spend: unused budget costs nothing.
 */
const THINKING_HEADROOM_TOKENS = 2048;

/** `data:image/png;base64,AAAA` → `{ mimeType, data }`. */
function splitDataUrl(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
    if (!match) {
        throw new AiError('invalid_request', 'Image was not a base64 data URL.', { providerId: 'gemini' });
    }
    return { mimeType: match[1], data: match[2] };
}

/**
 * Builds the `input` for one turn.
 *
 * The Interactions API takes a **step list**, mirroring the `steps` it returns:
 * an array of `{ type, content: [...] }`, where the request's own turn is a
 * `user_input` step. It explicitly refuses the `:generateContent` conventions:
 *
 *   role + parts            → 400 "Unknown parameter 'parts' at 'input[0]'"
 *   role + content          → 400 "When using the steps-based API version, use
 *                                  step_list input format instead of turn_list"
 *   inline_data / image{}    → 400 "Unknown parameter ... at input[0].content[1]"
 *
 * An image is a content entry of `type: 'image'` carrying `mime_type` and
 * base64 `data` as *sibling* fields — not nested, and not a `data:` URL, which
 * is why the caller's data URL is split. Verified live on 2026-08-03 against
 * `gemini-3.6-flash`, which read an 8×8 red PNG and answered "Red".
 *
 * A step list is used even for text-only requests. A bare string is also
 * accepted by the API, but one shape means one code path to keep correct.
 */
function buildInput({ inputText, images }) {
    const content = [{ type: 'text', text: inputText }];

    for (const image of Array.isArray(images) ? images : []) {
        const { mimeType, data } = splitDataUrl(image.dataUrl);
        content.push({ type: 'image', mime_type: mimeType, data });
    }

    return [{ type: 'user_input', content }];
}

/**
 * Pulls the assistant text out of an Interactions response.
 *
 * ## The shape this actually returns
 *
 * A successful reply carries its text in a **`steps`** array, one entry per
 * stage of the turn, each tagged with a `type`:
 *
 *     "steps": [
 *       { "type": "thought",      "signature": "<opaque>" },
 *       { "type": "model_output", "content": [{ "type": "text", "text": "OK" }] }
 *     ]
 *
 * `thought` steps carry no `content` at all — only an opaque signature — so a
 * reader that ignores `type` and simply walks every step still works, but only
 * `model_output` steps are the answer. Thought text is the model's private
 * reasoning and must never be concatenated into a user-visible article or a
 * JSON payload the router is about to parse, so the type is checked.
 *
 * This originally read a top-level `output` array, which the API does not
 * return. Every Gemini call therefore failed as `malformed_response` — the
 * model answered correctly and the adapter could not see it. Verified against
 * the live API on 2026-08-03.
 *
 * `output_text` and the legacy `candidates[].content.parts` shape are still
 * accepted: the first is cheap to support if a convenience field appears, and
 * the second is what `:generateContent` returns, so a future adapter pointed at
 * that endpoint keeps working.
 */
function extractText(payload) {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text;
    }

    const collected = [];
    // `steps` is the live shape; `output` is kept so a rename does not regress.
    const steps = Array.isArray(payload?.steps)
        ? payload.steps
        : (Array.isArray(payload?.output) ? payload.output : []);

    for (const step of steps) {
        // Never fold private reasoning into the answer.
        if (step?.type === 'thought') continue;
        const content = Array.isArray(step?.content) ? step.content : [];
        for (const part of content) {
            if (typeof part?.text === 'string') collected.push(part.text);
        }
    }
    if (collected.length > 0) return collected.join('');

    const candidateParts = payload?.candidates?.[0]?.content?.parts;
    if (Array.isArray(candidateParts)) {
        const text = candidateParts.map((part) => part?.text || '').join('');
        if (text.trim()) return text;
    }
    return null;
}

const geminiAdapter = {
    id: 'gemini',
    async execute(context) {
        const {
            provider, model, systemInstructions, inputText, images, schema,
            temperature, maxOutputTokens, timeoutMs, parentSignal, credentials, fetchImpl,
        } = context;

        const body = {
            model,
            input: buildInput({ inputText, images }),
            generation_config: {
                temperature,
                // See THINKING_HEADROOM_TOKENS: the caller's budget is for the
                // visible answer, so thinking gets its own allowance on top.
                max_output_tokens: maxOutputTokens + THINKING_HEADROOM_TOKENS,
            },
        };

        if (systemInstructions) {
            // A plain string, not `{ parts: [{ text }] }`. The Interactions API
            // rejects the parts form outright:
            //   400 "The value is invalid for 'system_instruction'.
            //        Expected string, unexpected character: '{'"
            // The parts form is the `:generateContent` convention, which is
            // where this came from. Verified live on 2026-08-03.
            body.system_instruction = systemInstructions;
        }

        if (schema) {
            body.response_format = {
                type: 'text',
                mime_type: 'application/json',
                schema,
            };
        }

        const payload = await postJson({
            url: `${provider.apiBaseUrl}${INTERACTIONS_PATH}`,
            headers: { 'x-goog-api-key': credentials.apiKey },
            body,
            timeoutMs,
            provider,
            parentSignal,
            fetchImpl,
        });

        const text = extractText(payload);
        if (typeof text !== 'string' || !text.trim()) {
            // `incomplete` means the model stopped before finishing — almost
            // always the output budget. Saying so beats "unreadable response",
            // which describes the symptom and hides the cause.
            if (payload?.status === 'incomplete') {
                throw new AiError('output_truncated', 'Interaction ended incomplete with no text.', {
                    providerId: provider.id,
                });
            }
            throw new AiError('malformed_response', 'Response contained no assistant text.', {
                providerId: provider.id,
            });
        }
        return { text, model };
    },
};

module.exports = { geminiAdapter, extractText, splitDataUrl };
