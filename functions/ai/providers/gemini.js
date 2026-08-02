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

/** `data:image/png;base64,AAAA` → `{ mimeType, data }`. */
function splitDataUrl(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
    if (!match) {
        throw new AiError('invalid_request', 'Image was not a base64 data URL.', { providerId: 'gemini' });
    }
    return { mimeType: match[1], data: match[2] };
}

function buildInput({ inputText, images }) {
    if (!Array.isArray(images) || images.length === 0) return inputText;

    const parts = [{ text: inputText }];
    for (const image of images) {
        const { mimeType, data } = splitDataUrl(image.dataUrl);
        parts.push({ inline_data: { mime_type: mimeType, data } });
    }
    return [{ role: 'user', parts }];
}

/** Handles both the Interactions output shape and the legacy candidates shape. */
function extractText(payload) {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text;
    }

    const collected = [];
    const output = Array.isArray(payload?.output) ? payload.output : [];
    for (const item of output) {
        const content = Array.isArray(item?.content) ? item.content : [];
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
                max_output_tokens: maxOutputTokens,
            },
        };

        if (systemInstructions) {
            body.system_instruction = { parts: [{ text: systemInstructions }] };
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
            throw new AiError('malformed_response', 'Response contained no assistant text.', {
                providerId: provider.id,
            });
        }
        return { text, model };
    },
};

module.exports = { geminiAdapter, extractText, splitDataUrl };
