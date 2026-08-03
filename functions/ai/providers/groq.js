/**
 * Groq adapter.
 *
 * Uses Groq's Responses API (`/openai/v1/responses`) with a `json_schema`
 * text format. That is deliberately the same endpoint, the same body shape and
 * the same schema mechanism the pre-migration CDL parser and document-vision
 * provider already used in production, so moving those features onto the
 * shared router changes which provider *may* be chosen without changing what
 * Groq is actually asked for or what it sends back.
 */

const { postJson } = require('./http');
const { AiError } = require('../router/errors');

const RESPONSES_PATH = '/responses';

/**
 * Extra `max_output_tokens` granted to cover a reasoning model's private
 * thinking.
 *
 * Groq's catalogue is now reasoning-first: `openai/gpt-oss-*` think before
 * answering and charge that thinking against `max_output_tokens`. Measured
 * against the live API on 2026-08-03, `openai/gpt-oss-120b` asked for a
 * one-word answer inside 32 tokens returned `status: "incomplete"`,
 * `incomplete_details.reason: "max_output_tokens"`, and a single `reasoning`
 * output item — no answer at all.
 *
 * A caller asking for 450 tokens of JSON is asking for 450 tokens *of JSON*.
 * Same reasoning and rationale as the Gemini adapter: one adapter must not mean
 * something different by a shared parameter. It is a ceiling, not a spend.
 *
 * Smaller than Gemini's for a concrete reason. Groq enforces a per-request size
 * limit per organization tier, counting input *and* output:
 *
 *   "Request too large for model `openai/gpt-oss-20b` in organization ...
 *    service tier"
 *
 * which the registry's quota detection classifies as `rate_limited`.
 *
 * The arithmetic matters, so it is written down. Groq's response headers give the
 * ceiling explicitly:
 *
 *     x-ratelimit-limit-tokens: 8000     (per minute, this organization's tier)
 *
 * and `max_output_tokens` is charged against it *in full*, whether or not the
 * model uses it. An enriched article prompt is roughly 2,300 input tokens, so the
 * output request must stay near or below 5,000 for the call to be accepted at
 * all. At 4096 requested plus a 1024 headroom the total reached 8,120 and every
 * Groq attempt failed as `rate_limited` before writing a word.
 *
 * 512 is sized to the reasoning `openai/gpt-oss-20b` actually performs, which is
 * brief, rather than to the much larger budgets a Gemini-style thinker needs.
 */
const REASONING_HEADROOM_TOKENS = 512;

/**
 * Walks the Responses envelope for assistant text.
 *
 * Only `output_text` parts count. A reasoning model also returns items of type
 * `reasoning` carrying `reasoning_text`, which is the model's private thinking:
 * folding it in would corrupt an article and break JSON the router is about to
 * parse. Selecting by part type rather than taking every string keeps it out.
 */
function extractAssistantText(payload) {
    const output = Array.isArray(payload?.output) ? payload.output : [];
    const chunks = [];
    for (const item of output) {
        if (item?.type === 'reasoning') continue;
        const content = Array.isArray(item?.content) ? item.content : [];
        for (const part of content) {
            if (part?.type === 'output_text' && typeof part.text === 'string') {
                chunks.push(part.text);
            }
        }
    }
    if (chunks.length > 0) return chunks.join('');
    // Some Groq builds also populate the convenience field.
    if (typeof payload?.output_text === 'string') return payload.output_text;
    return null;
}

function buildInput({ systemInstructions, inputText, images }) {
    const content = [{ type: 'input_text', text: inputText }];
    if (Array.isArray(images)) {
        for (const image of images) {
            content.push({ type: 'input_image', image_url: image.dataUrl });
        }
    }

    const input = [];
    if (systemInstructions) {
        input.push({ role: 'system', content: [{ type: 'input_text', text: systemInstructions }] });
    }
    input.push({ role: 'user', content });
    return input;
}

const groqAdapter = {
    id: 'groq',
    async execute(context) {
        const {
            provider, model, systemInstructions, inputText, images, schema, schemaName,
            temperature, maxOutputTokens, timeoutMs, parentSignal, credentials, fetchImpl,
        } = context;

        const body = {
            model,
            temperature,
            // See REASONING_HEADROOM_TOKENS: the caller's budget is for the
            // visible answer, so reasoning gets its own allowance on top.
            max_output_tokens: maxOutputTokens + REASONING_HEADROOM_TOKENS,
            input: buildInput({ systemInstructions, inputText, images }),
        };

        if (schema) {
            body.text = { format: { type: 'json_schema', name: schemaName, schema } };
        }

        const payload = await postJson({
            url: `${provider.apiBaseUrl}${RESPONSES_PATH}`,
            headers: { Authorization: `Bearer ${credentials.apiKey}` },
            body,
            timeoutMs,
            provider,
            parentSignal,
            fetchImpl,
        });

        const text = extractAssistantText(payload);
        if (typeof text !== 'string' || !text.trim()) {
            // `incomplete` means the model stopped before answering — almost
            // always the output budget, consumed by reasoning. Naming that beats
            // "unreadable response", which hides a cause with a known fix.
            if (payload?.status === 'incomplete') {
                throw new AiError('output_truncated', 'Response ended incomplete with no text.', {
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

module.exports = { groqAdapter, extractAssistantText };
