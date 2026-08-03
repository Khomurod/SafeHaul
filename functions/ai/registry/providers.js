/**
 * The frozen AI provider registry.
 *
 * This module is the single authority on which AI vendors SafeHaul may talk
 * to, what each one can do, and what it needs to be configured. Three rules
 * make it load-bearing rather than decorative:
 *
 *  1. A provider id supplied by a browser is only ever *looked up* here. It is
 *     never concatenated into a Secret Manager resource name, a URL, or a
 *     Firestore path. An id that is not in this table does not exist.
 *  2. `secretFields` drive the Secret Manager naming convention in
 *     `../credentials/secretManager.js`. The browser never names a secret.
 *  3. `capabilities` is a hard gate in the router, not a hint. A provider that
 *     does not declare `vision` can never be handed a CDL photograph.
 *
 * Adding a provider means adding a row here plus an adapter in `../providers/`.
 * Nothing else in the application should need to change.
 */

const { CAPABILITIES } = require('./capabilities');

const {
    TEXT,
    STRUCTURED_JSON,
    VISION,
    MULTI_IMAGE,
    LONG_CONTEXT,
    SUMMARIZATION,
    CLASSIFICATION,
    ARTICLE_WRITING,
} = CAPABILITIES;

/** Every provider that can generate prose can also summarize/classify/write. */
const TEXT_SUITE = [TEXT, SUMMARIZATION, CLASSIFICATION, ARTICLE_WRITING];

/**
 * Structured-output strategies. The adapter decides how to *ask* for JSON;
 * the router always validates the result regardless of which strategy was
 * used, because "the vendor promised JSON" is not evidence that it sent JSON.
 */
const STRUCTURED_MODE = Object.freeze({
    /** OpenAI-style `response_format: { type: 'json_schema', json_schema: … }`. */
    OPENAI_JSON_SCHEMA: 'openai_json_schema',
    /** OpenAI-style `response_format: { type: 'json_object' }` plus prompt-carried schema. */
    OPENAI_JSON_OBJECT: 'openai_json_object',
    /** Groq Responses API `text.format = { type: 'json_schema', … }`. */
    GROQ_RESPONSES_SCHEMA: 'groq_responses_schema',
    /** Gemini Interactions API `response_format` with a `schema`. */
    GEMINI_RESPONSE_FORMAT: 'gemini_response_format',
    /** No server-side JSON mode; schema is carried in the prompt and validated on return. */
    PROMPT_ONLY: 'prompt_only',
});

/**
 * How a provider signals "you have exceeded your allowance". Detected from the
 * HTTP status plus a lowercase substring match on the error body. Quota
 * detection drives a longer cooldown than an ordinary failure, so getting it
 * right is what stops the router hammering an exhausted key.
 */
const DEFAULT_QUOTA_DETECTION = Object.freeze({
    statuses: Object.freeze([429]),
    bodyMarkers: Object.freeze(['rate limit', 'quota', 'too many requests', 'insufficient']),
});

/**
 * Standard retry policy. One controlled attempt per provider is the default:
 * the router's availability strategy is "try the next vendor", not "hammer
 * this one". A single retry is only enabled where the vendor documents a
 * transient, safely-retryable condition.
 */
const SINGLE_ATTEMPT = Object.freeze({ attempts: 1, backoffMs: 0 });
const ONE_SAFE_RETRY = Object.freeze({ attempts: 2, backoffMs: 750 });

/**
 * A credential field is a value that must never reach a browser except through
 * the audited one-at-a-time reveal path. A config field is ordinary
 * non-secret configuration (an account id, a model name) stored in Firestore.
 */
function secretField(name, label, description, extra = {}) {
    return Object.freeze({ name, label, description, required: true, ...extra });
}

function configField(name, label, description, extra = {}) {
    return Object.freeze({ name, label, description, required: false, ...extra });
}

const PROVIDER_LIST = [
    {
        id: 'groq',
        displayName: 'Groq',
        priority: 1,
        docsUrl: 'https://console.groq.com/docs',
        apiBaseUrl: 'https://api.groq.com/openai/v1',
        adapter: 'groq',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, VISION, MULTI_IMAGE, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.GROQ_RESPONSES_SCHEMA,
        supportsVision: true,
        secretFields: [
            secretField('apiKey', 'API key', 'Groq API key from console.groq.com/keys.'),
        ],
        configFields: [],
        defaultModels: {
            // Pinned to the models the production CDL and E-Doc paths already
            // use, so migrating to the shared router changes routing, not
            // model behaviour.
            [TEXT]: 'llama-3.3-70b-versatile',
            [ARTICLE_WRITING]: 'llama-3.3-70b-versatile',
            [SUMMARIZATION]: 'llama-3.3-70b-versatile',
            [CLASSIFICATION]: 'llama-3.1-8b-instant',
            [STRUCTURED_JSON]: 'llama-3.3-70b-versatile',
            [VISION]: 'meta-llama/llama-4-scout-17b-16e-instruct',
            [MULTI_IMAGE]: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'gemini',
        displayName: 'Google Gemini',
        priority: 2,
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        adapter: 'gemini',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, VISION, MULTI_IMAGE, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.GEMINI_RESPONSE_FORMAT,
        supportsVision: true,
        secretFields: [
            secretField('apiKey', 'API key', 'Gemini API key from aistudio.google.com/apikey.'),
        ],
        configFields: [],
        defaultModels: {
            [TEXT]: 'gemini-3.6-flash',
            [ARTICLE_WRITING]: 'gemini-3.6-flash',
            [SUMMARIZATION]: 'gemini-3.6-flash',
            [CLASSIFICATION]: 'gemini-3.6-flash',
            [STRUCTURED_JSON]: 'gemini-3.6-flash',
            [VISION]: 'gemini-3.6-flash',
            [MULTI_IMAGE]: 'gemini-3.6-flash',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: Object.freeze({
            statuses: Object.freeze([429]),
            bodyMarkers: Object.freeze([
                'rate limit', 'quota', 'resource_exhausted', 'too many requests',
            ]),
        }),
        healthTest: { capability: TEXT },
    },
    {
        id: 'cloudflare',
        displayName: 'Cloudflare Workers AI',
        priority: 3,
        docsUrl: 'https://developers.cloudflare.com/workers-ai/',
        // The account id is interpolated by the adapter from stored config,
        // never from a request payload.
        apiBaseUrl: 'https://api.cloudflare.com/client/v4',
        adapter: 'cloudflare',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON],
        structuredMode: STRUCTURED_MODE.PROMPT_ONLY,
        supportsVision: false,
        secretFields: [
            secretField('apiToken', 'API token', 'Workers AI token with the Workers AI read/run permission.'),
        ],
        configFields: [
            configField('accountId', 'Account ID', 'Cloudflare account ID that owns the Workers AI binding.', {
                required: true,
                pattern: '^[a-f0-9]{32}$',
                placeholder: '32-character hexadecimal account id',
            }),
        ],
        defaultModels: {
            [TEXT]: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            [ARTICLE_WRITING]: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            [SUMMARIZATION]: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            [CLASSIFICATION]: '@cf/meta/llama-3.1-8b-instruct',
            [STRUCTURED_JSON]: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'github-models',
        displayName: 'GitHub Models',
        priority: 4,
        docsUrl: 'https://github.blog/changelog/2026-07-30-github-models-is-now-retired/',
        apiBaseUrl: 'https://models.github.ai/inference',
        adapter: 'githubModels',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_SCHEMA,
        supportsVision: false,
        secretFields: [
            secretField('token', 'Personal access token', 'GitHub token with the models permission.'),
        ],
        configFields: [],
        defaultModels: {
            [TEXT]: 'openai/gpt-4.1-mini',
            [ARTICLE_WRITING]: 'openai/gpt-4.1-mini',
            [SUMMARIZATION]: 'openai/gpt-4.1-mini',
            [CLASSIFICATION]: 'openai/gpt-4.1-mini',
            [STRUCTURED_JSON]: 'openai/gpt-4.1-mini',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
        // GitHub retired Models on 2026-07-30: the playground, catalogue,
        // inference API and BYOK were withdrawn from every customer. The row
        // stays so the documented fallback order keeps its shape and so the
        // console can explain the gap honestly, but the provider can never be
        // selected, configured or enabled. If GitHub ever restores an
        // inference API, clearing `retired` re-enables it.
        retired: Object.freeze({
            since: '2026-07-30',
            reason: 'GitHub retired GitHub Models on 30 July 2026. The inference API, model catalogue and bring-your-own-key access were withdrawn from all customers.',
            reference: 'https://github.blog/changelog/2026-07-30-github-models-is-now-retired/',
        }),
    },
    {
        id: 'mistral',
        displayName: 'Mistral',
        priority: 5,
        docsUrl: 'https://docs.mistral.ai/',
        apiBaseUrl: 'https://api.mistral.ai/v1',
        adapter: 'mistral',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, VISION, MULTI_IMAGE, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_SCHEMA,
        supportsVision: true,
        secretFields: [
            secretField('apiKey', 'API key', 'Mistral API key from console.mistral.ai.'),
        ],
        configFields: [],
        defaultModels: {
            [TEXT]: 'mistral-large-latest',
            [ARTICLE_WRITING]: 'mistral-large-latest',
            [SUMMARIZATION]: 'mistral-small-latest',
            [CLASSIFICATION]: 'mistral-small-latest',
            [STRUCTURED_JSON]: 'mistral-large-latest',
            [VISION]: 'pixtral-12b-latest',
            [MULTI_IMAGE]: 'pixtral-large-latest',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'cerebras',
        displayName: 'Cerebras',
        priority: 6,
        docsUrl: 'https://inference-docs.cerebras.ai/',
        apiBaseUrl: 'https://api.cerebras.ai/v1',
        adapter: 'cerebras',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_SCHEMA,
        supportsVision: false,
        secretFields: [
            secretField('apiKey', 'API key', 'Cerebras inference API key from cloud.cerebras.ai.'),
        ],
        configFields: [],
        defaultModels: {
            [TEXT]: 'llama-3.3-70b',
            [ARTICLE_WRITING]: 'llama-3.3-70b',
            [SUMMARIZATION]: 'llama-3.3-70b',
            [CLASSIFICATION]: 'llama3.1-8b',
            [STRUCTURED_JSON]: 'llama-3.3-70b',
        },
        timeoutMs: 30000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'sambanova',
        displayName: 'SambaNova',
        priority: 7,
        docsUrl: 'https://docs.sambanova.ai/cloud/docs/get-started/overview',
        apiBaseUrl: 'https://api.sambanova.ai/v1',
        adapter: 'sambanova',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_OBJECT,
        supportsVision: false,
        secretFields: [
            secretField('apiKey', 'API key', 'SambaNova Cloud API key from cloud.sambanova.ai.'),
        ],
        configFields: [],
        defaultModels: {
            [TEXT]: 'Meta-Llama-3.3-70B-Instruct',
            [ARTICLE_WRITING]: 'Meta-Llama-3.3-70B-Instruct',
            [SUMMARIZATION]: 'Meta-Llama-3.3-70B-Instruct',
            [CLASSIFICATION]: 'Meta-Llama-3.1-8B-Instruct',
            [STRUCTURED_JSON]: 'Meta-Llama-3.3-70B-Instruct',
        },
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'openrouter',
        displayName: 'OpenRouter',
        priority: 8,
        docsUrl: 'https://openrouter.ai/docs',
        apiBaseUrl: 'https://openrouter.ai/api/v1',
        adapter: 'openrouter',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, VISION, MULTI_IMAGE, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_SCHEMA,
        supportsVision: true,
        secretFields: [
            secretField('apiKey', 'API key', 'OpenRouter API key from openrouter.ai/keys.'),
        ],
        configFields: [
            // OpenRouter fronts many upstream vendors, so the operator picks
            // which one their key is actually entitled to. Left blank the
            // registry defaults apply.
            configField('textModel', 'Text model override', 'OpenRouter model slug used for text tasks.', {
                placeholder: 'e.g. meta-llama/llama-3.3-70b-instruct',
                appliesTo: [TEXT, ARTICLE_WRITING, SUMMARIZATION, CLASSIFICATION, STRUCTURED_JSON],
            }),
            configField('visionModel', 'Vision model override', 'OpenRouter model slug used for image tasks.', {
                placeholder: 'e.g. meta-llama/llama-4-scout-17b-16e-instruct',
                appliesTo: [VISION, MULTI_IMAGE],
            }),
        ],
        defaultModels: {
            [TEXT]: 'meta-llama/llama-3.3-70b-instruct',
            [ARTICLE_WRITING]: 'meta-llama/llama-3.3-70b-instruct',
            [SUMMARIZATION]: 'meta-llama/llama-3.3-70b-instruct',
            [CLASSIFICATION]: 'meta-llama/llama-3.3-70b-instruct',
            [STRUCTURED_JSON]: 'meta-llama/llama-3.3-70b-instruct',
            [VISION]: 'meta-llama/llama-4-scout-17b-16e-instruct',
            [MULTI_IMAGE]: 'meta-llama/llama-4-scout-17b-16e-instruct',
        },
        timeoutMs: 60000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: Object.freeze({
            statuses: Object.freeze([402, 429]),
            bodyMarkers: Object.freeze(['rate limit', 'quota', 'credits', 'insufficient']),
        }),
        healthTest: { capability: TEXT },
    },
    {
        id: 'huggingface',
        displayName: 'Hugging Face',
        priority: 9,
        docsUrl: 'https://huggingface.co/docs/inference-providers',
        apiBaseUrl: 'https://router.huggingface.co/v1',
        adapter: 'huggingface',
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, VISION, LONG_CONTEXT],
        structuredMode: STRUCTURED_MODE.OPENAI_JSON_OBJECT,
        supportsVision: true,
        secretFields: [
            secretField('apiKey', 'Access token', 'Fine-grained token with "Make calls to Inference Providers".'),
        ],
        configFields: [
            // The router fans out to many upstream partners and not every
            // model is warm for every account, so the operator names the model
            // their token can actually reach.
            configField('textModel', 'Text model', 'Hub model id, optionally suffixed with a provider or policy.', {
                placeholder: 'e.g. openai/gpt-oss-120b:fastest',
                appliesTo: [TEXT, ARTICLE_WRITING, SUMMARIZATION, CLASSIFICATION, STRUCTURED_JSON],
            }),
            configField('visionModel', 'Vision model', 'Hub model id of a vision-language model.', {
                placeholder: 'e.g. meta-llama/Llama-4-Scout-17B-16E-Instruct',
                appliesTo: [VISION],
            }),
        ],
        defaultModels: {
            [TEXT]: 'openai/gpt-oss-120b:fastest',
            [ARTICLE_WRITING]: 'openai/gpt-oss-120b:fastest',
            [SUMMARIZATION]: 'openai/gpt-oss-120b:fastest',
            [CLASSIFICATION]: 'openai/gpt-oss-120b:fastest',
            [STRUCTURED_JSON]: 'openai/gpt-oss-120b:fastest',
            [VISION]: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        },
        timeoutMs: 60000,
        retryPolicy: ONE_SAFE_RETRY,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
];

/** Deep-freeze a provider row so no caller can mutate shared registry state. */
function freezeProvider(row) {
    return Object.freeze({
        ...row,
        capabilities: Object.freeze([...row.capabilities]),
        secretFields: Object.freeze([...row.secretFields]),
        configFields: Object.freeze([...row.configFields]),
        defaultModels: Object.freeze({ ...row.defaultModels }),
        healthTest: Object.freeze({ ...row.healthTest }),
    });
}

const PROVIDERS = Object.freeze(
    PROVIDER_LIST
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map(freezeProvider),
);

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

/**
 * The documented default fallback order. Derived from `priority` rather than
 * written out twice, so the table above stays the only place the order lives.
 */
const DEFAULT_FALLBACK_ORDER = Object.freeze(PROVIDERS.map((provider) => provider.id));

/**
 * The single lookup every caller must use. Returns `null` for anything not in
 * the table, which is what stops a browser-supplied id from reaching a URL or
 * a secret name.
 *
 * @param {unknown} providerId
 * @returns {object|null}
 */
function getProvider(providerId) {
    if (typeof providerId !== 'string') return null;
    return PROVIDERS_BY_ID.get(providerId) || null;
}

/** Throwing variant for server paths where an unknown id is a programming error. */
function requireProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) {
        throw new Error(`Unknown AI provider "${String(providerId)}".`);
    }
    return provider;
}

function isRetired(provider) {
    return Boolean(provider && provider.retired);
}

/**
 * Whether a provider can satisfy every capability a task requires. Retired
 * providers answer `false` for everything.
 *
 * @param {object} provider
 * @param {string[]} capabilities
 */
function supportsAllCapabilities(provider, capabilities) {
    if (!provider || isRetired(provider)) return false;
    return capabilities.every((capability) => provider.capabilities.includes(capability));
}

/**
 * The model this provider should use for a capability, honouring any operator
 * override in stored config.
 *
 * @param {object} provider registry row
 * @param {string} capability
 * @param {object} config non-secret stored config for this provider
 * @returns {string|null}
 */
function resolveModel(provider, capability, config = {}) {
    for (const field of provider.configFields) {
        if (!Array.isArray(field.appliesTo)) continue;
        if (!field.appliesTo.includes(capability)) continue;
        const override = config[field.name];
        if (typeof override === 'string' && override.trim()) return override.trim();
    }
    return provider.defaultModels[capability] || provider.defaultModels[CAPABILITIES.TEXT] || null;
}

module.exports = {
    PROVIDERS,
    DEFAULT_FALLBACK_ORDER,
    STRUCTURED_MODE,
    getProvider,
    requireProvider,
    isRetired,
    supportsAllCapabilities,
    resolveModel,
};
