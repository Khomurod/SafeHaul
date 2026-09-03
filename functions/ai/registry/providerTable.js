// functions/ai/registry/providerTable.js
//
// The declarative provider table: every AI provider SafeHaul can route to,
// as one frozen row each — capabilities, models, credential fields, retry
// and quota policy, structured-output strategy. Extracted verbatim from
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
         * Vision is back, on a different model and by a different mechanism.
         *
         * It was removed on 2026-08-03 because Groq withdrew both llama-4
         * vision models, and that was correct at the time: Maverick shut down
         * 2026-03-09 and Scout 2026-07-17. But Groq's catalogue moved on and
         * the registry did not. `qwen/qwen3.6-27b` is multimodal — Groq
         * documents it for "image analysis, OCR, and visual question
         * answering" — and Groq's own deprecation page names it as the
         * recommended replacement for Scout. Verified 2026-08-17.
         *
         * The subtlety that makes this more than a flag: Groq's schema support
         * is per *model*. Only the `openai/gpt-oss-*` models accept
         * `json_schema`; `qwen/qwen3.6-27b` supports JSON object mode only and
         * answers a schema request with a 400. So the vision lanes carry their
         * own structured mode below, and the schema is restated in the prompt
         * and enforced by SafeHaul's own validator on return.
         *
         * `maxImages` is Groq's documented per-request cap. E-Doc already
         * limits itself to five pages, so the two agree — but the router
         * enforces it rather than trusting that they always will.
         */
        capabilities: [...TEXT_SUITE, STRUCTURED_JSON, LONG_CONTEXT, VISION, MULTI_IMAGE],
        structuredMode: STRUCTURED_MODE.GROQ_RESPONSES_SCHEMA,
        structuredModeByCapability: {
            [VISION]: STRUCTURED_MODE.GROQ_RESPONSES_JSON_OBJECT,
            [MULTI_IMAGE]: STRUCTURED_MODE.GROQ_RESPONSES_JSON_OBJECT,
        },
        supportsVision: true,
        maxImages: 5,
        secretFields: [
            secretField('apiKey', 'API key', 'Groq API key from console.groq.com/keys.'),
        ],
        configFields: [],
        /**
         * Every entry verified against the live Groq API on 2026-08-03 for both
         * plain text *and* `json_schema` structured output.
         *
         * The previous values were wrong, behind a comment claiming they were
         * "pinned to the models the production CDL and E-Doc paths already use".
         * That was true only of the two vision models, and both had since been
         * withdrawn. The text models were never used in production by anything.
         *
         * `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` are rejected
         * outright for structured output:
         *
         *   400 "This model does not support response format `json_schema`."
         *
         * Groq's health check sends plain text with no schema, so it passed while
         * every schema-using task — article generation, topic selection, CDL
         * extraction, E-Doc placement — failed. That is what produced
         * `failed_generation (all_providers_failed)` in production.
         *
         * `qwen/qwen3.6-27b` is rejected the same way. `openai/gpt-oss-120b`
         * accepts schemas but burns so much reasoning budget that a small plain
         * text request returns `status: incomplete` with only a `reasoning`
         * item. `openai/gpt-oss-20b` answered both shapes correctly, so one
         * model serves every capability rather than pinning a second that is
         * only verified for one of them.
         */
        defaultModels: {
            [TEXT]: 'openai/gpt-oss-20b',
            [ARTICLE_WRITING]: 'openai/gpt-oss-20b',
            [SUMMARIZATION]: 'openai/gpt-oss-20b',
            [CLASSIFICATION]: 'openai/gpt-oss-20b',
            [STRUCTURED_JSON]: 'openai/gpt-oss-20b',
            // Groq's only multimodal model. Preview status at the time of
            // writing, which is why it is one lane among several rather than
            // anything SafeHaul depends on: 131k context, 16,384 max output,
            // five images and 20MB per request. Verified 2026-08-17.
            [VISION]: 'qwen/qwen3.6-27b',
            [MULTI_IMAGE]: 'qwen/qwen3.6-27b',
        },
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
            // Was `@cf/meta/llama-3.1-8b-instruct`, which the Workers AI
            // catalogue now marks deprecated. Folded into the same model as the
            // other lanes rather than pinning a second one to keep current.
            // Verified 2026-08-17.
            [CLASSIFICATION]: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
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
        /**
         * Pinned to `mistral-medium-latest`, one model for every lane.
         *
         * `mistral-large-latest` (the previous text and vision pin) is paid-tier
         * only: a free key gets `403 tier_not_allowed` and Large is not even in
         * its catalogue, so every lane 403'd and the connection test reported
         * six failures. The pixtral models it replaced were retired months ago.
         *
         * `mistral-medium-latest` is vision-capable with structured output and
         * long context, so one model serves the text and image lanes on the
         * *free* entitlement. Verified 2026-09-03 on a free key against the live
         * API: it read a CDL photo, a PSP page image, and PSP/MVR/medical text
         * into the schema. No per-tier config exists, so the default targets the
         * tier a free key actually has.
         */
        defaultModels: {
            [TEXT]: 'mistral-medium-latest',
            [ARTICLE_WRITING]: 'mistral-medium-latest',
            [SUMMARIZATION]: 'mistral-medium-latest',
            [CLASSIFICATION]: 'mistral-medium-latest',
            [STRUCTURED_JSON]: 'mistral-medium-latest',
            [VISION]: 'mistral-medium-latest',
            [MULTI_IMAGE]: 'mistral-medium-latest',
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
        /**
         * Every previous pin was gone. `llama-3.3-70b` and `llama3.1-8b` are
         * both absent from Cerebras' public catalogue, which now offers
         * `gpt-oss-120b` (production), `gemma-4-31b` and `zai-glm-4.7`
         * (preview) — so Cerebras was contributing nothing to the fallback
         * order but a wasted round trip. Verified 2026-08-17.
         *
         * `gpt-oss-120b` is the only production model of the three, so it takes
         * every lane rather than pinning a preview model alongside it.
         */
        defaultModels: {
            [TEXT]: 'gpt-oss-120b',
            [ARTICLE_WRITING]: 'gpt-oss-120b',
            [SUMMARIZATION]: 'gpt-oss-120b',
            [CLASSIFICATION]: 'gpt-oss-120b',
            [STRUCTURED_JSON]: 'gpt-oss-120b',
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
            // Was `Meta-Llama-3.1-8B-Instruct`, which no longer appears among
            // SambaNova Cloud's supported models. Verified 2026-08-17.
            [CLASSIFICATION]: 'Meta-Llama-3.3-70B-Instruct',
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
                placeholder: 'e.g. meta-llama/llama-4-scout',
                appliesTo: [VISION, MULTI_IMAGE],
            }),
        ],
        defaultModels: {
            [TEXT]: 'meta-llama/llama-3.3-70b-instruct',
            [ARTICLE_WRITING]: 'meta-llama/llama-3.3-70b-instruct',
            [SUMMARIZATION]: 'meta-llama/llama-3.3-70b-instruct',
            [CLASSIFICATION]: 'meta-llama/llama-3.3-70b-instruct',
            [STRUCTURED_JSON]: 'meta-llama/llama-3.3-70b-instruct',
            // The slug was `meta-llama/llama-4-scout-17b-16e-instruct` — Groq's
            // naming for the same weights, not OpenRouter's. OpenRouter does
            // not list it, so every OpenRouter image request 404'd on a model
            // that was in fact available under a different name. Confirmed
            // against OpenRouter's live catalogue (414 models) 2026-08-17.
            [VISION]: 'meta-llama/llama-4-scout',
            [MULTI_IMAGE]: 'meta-llama/llama-4-scout',
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
