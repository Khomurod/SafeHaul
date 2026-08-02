/**
 * Cloudflare Workers AI adapter.
 *
 * Workers AI is the one supported provider whose endpoint embeds an account
 * identifier: `/client/v4/accounts/{accountId}/ai/run/{model}`. That account id
 * is a stored non-secret config field, validated against the registry's
 * `^[a-f0-9]{32}$` pattern before it is ever interpolated, so a malformed or
 * hostile value cannot reshape the URL.
 *
 * Workers AI has no server-enforced JSON schema mode, so the registry marks it
 * `PROMPT_ONLY`: the schema is restated in the prompt and the router validates
 * whatever comes back.
 */

const { postJson } = require('./http');
const { AiError } = require('../router/errors');
const { schemaReminder } = require('./openaiCompatible');

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;

function requireAccountId(config) {
    const accountId = typeof config?.accountId === 'string' ? config.accountId.trim() : '';
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        throw new AiError('not_configured', 'Cloudflare account id is missing or malformed.', {
            providerId: 'cloudflare',
        });
    }
    return accountId;
}

/**
 * Model ids are vendor-namespaced (`@cf/meta/…`) and go into the path, so they
 * are constrained to the characters Cloudflare actually uses. This keeps a
 * model override from introducing path traversal.
 */
const MODEL_PATTERN = /^@?[A-Za-z0-9._/-]{1,120}$/;

function requireModel(model) {
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
        throw new AiError('model_unavailable', 'Cloudflare model id is malformed.', {
            providerId: 'cloudflare',
        });
    }
    return model;
}

function extractText(payload) {
    const result = payload?.result;
    if (typeof result?.response === 'string') return result.response;
    if (typeof result?.output_text === 'string') return result.output_text;
    const choice = result?.choices?.[0]?.message?.content;
    if (typeof choice === 'string') return choice;
    return null;
}

const cloudflareAdapter = {
    id: 'cloudflare',
    async execute(context) {
        const {
            provider, model, systemInstructions, inputText, schema,
            temperature, maxOutputTokens, timeoutMs, parentSignal, credentials, config, fetchImpl,
        } = context;

        const accountId = requireAccountId(config);
        const safeModel = requireModel(model);

        const promptText = schema ? `${inputText}${schemaReminder(schema)}` : inputText;

        const messages = [];
        if (systemInstructions) messages.push({ role: 'system', content: systemInstructions });
        messages.push({ role: 'user', content: promptText });

        const payload = await postJson({
            url: `${provider.apiBaseUrl}/accounts/${accountId}/ai/run/${safeModel}`,
            headers: { Authorization: `Bearer ${credentials.apiToken}` },
            body: { messages, temperature, max_tokens: maxOutputTokens },
            timeoutMs,
            provider,
            parentSignal,
            fetchImpl,
        });

        // Workers AI answers 200 with `success: false` for some model errors,
        // so a bare status check is not enough to call this a success.
        if (payload && payload.success === false) {
            throw new AiError('provider_unavailable', 'Workers AI reported an unsuccessful run.', {
                providerId: provider.id,
            });
        }

        const text = extractText(payload);
        if (typeof text !== 'string' || !text.trim()) {
            throw new AiError('malformed_response', 'Response contained no assistant text.', {
                providerId: provider.id,
            });
        }
        return { text, model: safeModel };
    },
};

module.exports = { cloudflareAdapter, extractText, ACCOUNT_ID_PATTERN };
