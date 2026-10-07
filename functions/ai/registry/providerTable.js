// functions/ai/registry/providerTable.js
//
// The declarative provider table: every AI provider SafeHaul can route to,
// as one frozen row each — capabilities, credential fields, retry and quota
// policy, structured-output strategy. The model versions each row is asked
// for live beside it in `modelVersions.js`. Extracted verbatim from
// `providers.js`, which derives the frozen registry, the fallback order and
// the lookups from this table. Data lives here; behaviour stays there.

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
    /**
     * Groq Responses API `text.format = { type: 'json_object' }` plus a
     * prompt-carried schema.
     *
     * Needed because Groq's schema support is per *model*, not per vendor. Only
     * `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and
     * `openai/gpt-oss-safeguard-20b` accept `json_schema`; every other model,
     * including the only vision-capable one, answers a schema request with a
     * 400. Verified against Groq's structured-outputs documentation 2026-08-17.
     */
    GROQ_RESPONSES_JSON_OBJECT: 'groq_responses_json_object',
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
        // Position 2, not 1. The brief specified Groq first, and the owner
        // reversed it on 2026-08-03 after measurement: on the free tiers
        // `openai/gpt-oss-20b` writes 175-213 word articles while Gemini writes
        // 311-417 from the same or thinner sources. Groq stays as the fallback
        // because it is the more *available* of the two — Gemini's free tier caps
        // at 20 requests — so a short article beats no article.
        priority: 2,
        docsUrl: 'https://console.groq.com/docs',
        apiBaseUrl: 'https://api.groq.com/openai/v1',
        adapter: 'groq',
        /**
         * Vision, on Groq's multimodal Qwen.
         *
         * Groq withdrew both llama-4 vision models in 2026 (Maverick 03-09,
         * Scout 07-17), and on 2026-10-07 the Qwen pinned in their place,
         * `qwen/qwen3.6-27b`, answered 404 `model_not_found`: every photo
         * request to Groq failed. `qwen/qwen3.8-27b` replaced it, verified that
         * day on the live API: it read a CDL photo, and two photos at once.
         *
         * Groq's schema support is per *model*. `qwen/qwen3.6-27b` answered
         * `json_schema` with a 400 and was asked in JSON object mode through
         * `structuredModeByCapability`; `qwen/qwen3.8-27b` accepts it with
         * images (CDL, medical card, PSP, MVR and E-Doc schemas, 2026-10-07),
         * so every Groq lane now asks in schema mode and Groq enforces the shape.
         *
         * `maxImages` is the model's per-request cap, and the router enforces
         * it. `qwen/qwen3.8-27b` takes three (`400 "This model supports up to 3
         * images"`, 2026-10-07), so a four- or five-page E-Doc goes to the next
         * provider instead of spending a request that cannot succeed.
         */
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, LONG_CONTEXT, VISION, MULTI_IMAGE],
        structuredMode: STRUCTURED_MODE.GROQ_RESPONSES_SCHEMA,
        supportsVision: true,
        maxImages: 3,
        secretFields: [
            secretField('apiKey', 'API key', 'Groq API key from console.groq.com/keys.'),
        ],
        configFields: [],
        timeoutMs: 45000,
        retryPolicy: SINGLE_ATTEMPT,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
    {
        id: 'gemini',
        displayName: 'Google Gemini',
        // Position 1 by owner decision — see the note on Groq's priority above.
        priority: 1,
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
                placeholder: 'e.g. meta-llama/llama-4-scout',
                appliesTo: [VISION, MULTI_IMAGE],
            }),
        ],
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
        timeoutMs: 60000,
        retryPolicy: ONE_SAFE_RETRY,
        quotaDetection: DEFAULT_QUOTA_DETECTION,
        healthTest: { capability: TEXT },
    },
];

/** Deep-freeze a provider row so no caller can mutate shared registry state. */

module.exports = {
    TEXT_SUITE,
    STRUCTURED_MODE,
    DEFAULT_QUOTA_DETECTION,
    SINGLE_ATTEMPT,
    ONE_SAFE_RETRY,
    secretField,
    configField,
    PROVIDER_LIST,
};
