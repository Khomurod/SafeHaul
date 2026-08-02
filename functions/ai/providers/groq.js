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

/** Walks the Responses envelope for assistant text. */
function extractAssistantText(payload) {
    const output = Array.isArray(payload?.output) ? payload.output : [];
    const chunks = [];
    for (const item of output) {
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
            max_output_tokens: maxOutputTokens,
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
            throw new AiError('malformed_response', 'Response contained no assistant text.', {
                providerId: provider.id,
            });
        }
        return { text, model };
    },
};

module.exports = { groqAdapter, extractAssistantText };
