/**
 * Shared adapter for vendors that speak the OpenAI `/chat/completions` shape.
 *
 * Cerebras, Mistral, SambaNova, OpenRouter, Hugging Face's router and the
 * retired GitHub Models endpoint all accept the same request body, differing
 * only in base URL, extra headers, and how much of the structured-output
 * specification they actually implement. Those differences are parameters
 * here, not nine near-identical files.
 *
 * This module is a provider adapter and is therefore one of the few places
 * permitted to know a vendor's wire format at all.
 */

const { postJson } = require('./http');
const { AiError } = require('../router/errors');
const { STRUCTURED_MODE, resolveStructuredMode } = require('../registry/providers');
const { applyPromptCarriedSchema, schemaReminder } = require('./structuredOutput');
const { normalizeUsage } = require('./usage');

/**
 * Builds the `messages` array, attaching images only when the caller supplied
 * them. The router has already refused to route images to a provider that
 * cannot accept them, so reaching this function with images means the vendor
 * declared vision support.
 */
function buildMessages({ systemInstructions, inputText, images }) {
    const messages = [];
    if (systemInstructions) {
        messages.push({ role: 'system', content: systemInstructions });
    }

    if (Array.isArray(images) && images.length > 0) {
        const content = [{ type: 'text', text: inputText }];
        for (const image of images) {
            content.push({ type: 'image_url', image_url: { url: image.dataUrl } });
        }
        messages.push({ role: 'user', content });
    } else {
        messages.push({ role: 'user', content: inputText });
    }

    return messages;
}

/**
 * Applies the vendor's structured-output mechanism.
 *
 * `PROMPT_ONLY` and `OPENAI_JSON_OBJECT` cannot enforce a schema server-side,
 * so the schema is restated in the prompt. In every mode the router still
 * validates the parsed result — a vendor claiming JSON mode is not evidence
 * that it honoured the schema.
 */
function applyStructuredOutput(body, { schema, schemaName, structuredMode }) {
    if (!schema) return body;

    switch (structuredMode) {
        case STRUCTURED_MODE.OPENAI_JSON_SCHEMA:
            return {
                ...body,
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: schemaName, strict: true, schema },
                },
            };
        case STRUCTURED_MODE.OPENAI_JSON_OBJECT:
            return { ...body, response_format: { type: 'json_object' } };
        default:
            return body;
    }
}

/**
 * Creates an adapter for an OpenAI-compatible vendor.
 *
 * @param {object} options
 * @param {string} options.id registry provider id
 * @param {(ctx: object) => string} [options.buildUrl] defaults to `${base}/chat/completions`
 * @param {(ctx: object) => object} options.buildHeaders
 * @param {(body: object, ctx: object) => object} [options.decorateBody]
 * @param {(payload: object) => string|null} [options.extractText]
 */
function createOpenAiCompatibleAdapter(options) {
    const {
        id,
        buildUrl = ({ provider }) => `${provider.apiBaseUrl}/chat/completions`,
        buildHeaders,
        decorateBody = (body) => body,
        extractText = defaultExtractText,
    } = options;

    return {
        id,
        async execute(context) {
            const {
                provider, model, systemInstructions, inputText, images, schema, schemaName,
                temperature, maxOutputTokens, timeoutMs, parentSignal, credentials, config, fetchImpl,
            } = context;

            // Per-capability, because schema support is a property of the
            // resolved model rather than of the vendor as a whole.
            const structuredMode = resolveStructuredMode(provider, context.capability);
            const promptText = applyPromptCarriedSchema({ inputText, schema, structuredMode });

            let body = {
                model,
                messages: buildMessages({ systemInstructions, inputText: promptText, images }),
                temperature,
                max_tokens: maxOutputTokens,
                stream: false,
            };
            body = applyStructuredOutput(body, { schema, schemaName, structuredMode });
            body = decorateBody(body, { provider, config, capability: context.capability });

            const payload = await postJson({
                url: buildUrl({ provider, config, credentials }),
                headers: buildHeaders({ credentials, config, provider }),
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
            return { text, model, usage: normalizeUsage(payload) };
        },
    };
}

/** The standard `choices[0].message.content` shape, tolerating array content. */
function defaultExtractText(payload) {
    const message = payload?.choices?.[0]?.message;
    if (!message) return null;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => (typeof part === 'string' ? part : part?.text || ''))
            .join('')
            .trim();
    }
    return null;
}

module.exports = {
    createOpenAiCompatibleAdapter,
    buildMessages,
    defaultExtractText,
    // Re-exported for callers that imported it from here before it moved to
    // ./structuredOutput, which is now its home.
    schemaReminder,
};
