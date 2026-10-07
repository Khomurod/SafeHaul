// functions/ai/registry/modelVersions.js
//
// Which model versions each provider is asked for, per capability, in order.
//
// A list rather than a single string, because a vendor withdraws, overloads or
// re-tiers one version far more often than it goes down whole. Each list holds
// one version today: the version the provider row used to pin. `providers.js`
// attaches the lists to their rows as `modelVersions` and derives
// `defaultModels` from their first entries, so every reader of a single pin
// sees exactly what it saw before.
//
// Data only, like `providerTable.js`. A provider row without a list here fails
// at load rather than routing with no model.

const { CAPABILITIES } = require('./capabilities');

const {
    TEXT,
    STRUCTURED_JSON,
    VISION,
    MULTI_IMAGE,
    SUMMARIZATION,
    CLASSIFICATION,
    ARTICLE_WRITING,
} = CAPABILITIES;

const MODEL_VERSIONS = {
    /**
     * Every text entry verified against the live Groq API on 2026-08-03 for
     * both plain text *and* `json_schema` structured output.
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
     * `qwen/qwen3.6-27b` was rejected the same way. `openai/gpt-oss-120b`
     * accepts schemas but burns so much reasoning budget that a small plain
     * text request returns `status: incomplete` with only a `reasoning`
     * item. `openai/gpt-oss-20b` answered both shapes correctly, so one
     * model serves every capability rather than pinning a second that is
     * only verified for one of them.
     */
    groq: {
        [TEXT]: ['openai/gpt-oss-20b'],
        [ARTICLE_WRITING]: ['openai/gpt-oss-20b'],
        [SUMMARIZATION]: ['openai/gpt-oss-20b'],
        [CLASSIFICATION]: ['openai/gpt-oss-20b'],
        [STRUCTURED_JSON]: ['openai/gpt-oss-20b'],
        // Groq's only multimodal model, one lane among several rather than
        // anything SafeHaul depends on: 131k context, three images per
        // request, and about 1,800 input tokens a photo against the free
        // tier's 7,000 input tokens a minute. Verified 2026-10-07.
        [VISION]: ['qwen/qwen3.8-27b'],
        [MULTI_IMAGE]: ['qwen/qwen3.8-27b'],
    },
    gemini: {
        [TEXT]: ['gemini-3.6-flash'],
        [ARTICLE_WRITING]: ['gemini-3.6-flash'],
        [SUMMARIZATION]: ['gemini-3.6-flash'],
        [CLASSIFICATION]: ['gemini-3.6-flash'],
        [STRUCTURED_JSON]: ['gemini-3.6-flash'],
        [VISION]: ['gemini-3.6-flash'],
        [MULTI_IMAGE]: ['gemini-3.6-flash'],
    },
    cloudflare: {
        [TEXT]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        [ARTICLE_WRITING]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        [SUMMARIZATION]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        // Was `@cf/meta/llama-3.1-8b-instruct`, which the Workers AI
        // catalogue now marks deprecated. Folded into the same model as the
        // other lanes rather than pinning a second one to keep current.
        // Verified 2026-08-17.
        [CLASSIFICATION]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        [STRUCTURED_JSON]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    },
    // Retired with GitHub Models (see its row); kept so the row stays whole.
    'github-models': {
        [TEXT]: ['openai/gpt-4.1-mini'],
        [ARTICLE_WRITING]: ['openai/gpt-4.1-mini'],
        [SUMMARIZATION]: ['openai/gpt-4.1-mini'],
        [CLASSIFICATION]: ['openai/gpt-4.1-mini'],
        [STRUCTURED_JSON]: ['openai/gpt-4.1-mini'],
    },
    /**
     * The Ministral models, the ones a *free* key can call.
     *
     * Mistral's free plan moved under us twice. `mistral-large-*` is paid
     * only (`403 tier_not_allowed`, 2026-09-03), and on 2026-10-07 the free
     * plan gave `mistral-medium-*` and `mistral-small-*` a limit of zero
     * requests a minute (`429`, `x-ratelimit-limit-req-minute: 0`), so every
     * Mistral lane failed on a key that authenticates.
     *
     * `ministral-14b-2512` read a CDL photo, two and five photos at once, and
     * answered the claim check, verified that day on a free key. It took
     * 33-48s to write an article against the row's 45s timeout, so articles
     * go to `ministral-8b-2512`, which wrote one in 9s.
     */
    mistral: {
        [TEXT]: ['ministral-14b-2512'],
        [ARTICLE_WRITING]: ['ministral-8b-2512'],
        [SUMMARIZATION]: ['ministral-14b-2512'],
        [CLASSIFICATION]: ['ministral-14b-2512'],
        [STRUCTURED_JSON]: ['ministral-14b-2512'],
        [VISION]: ['ministral-14b-2512'],
        [MULTI_IMAGE]: ['ministral-14b-2512'],
    },
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
    cerebras: {
        [TEXT]: ['gpt-oss-120b'],
        [ARTICLE_WRITING]: ['gpt-oss-120b'],
        [SUMMARIZATION]: ['gpt-oss-120b'],
        [CLASSIFICATION]: ['gpt-oss-120b'],
        [STRUCTURED_JSON]: ['gpt-oss-120b'],
    },
    sambanova: {
        [TEXT]: ['Meta-Llama-3.3-70B-Instruct'],
        [ARTICLE_WRITING]: ['Meta-Llama-3.3-70B-Instruct'],
        [SUMMARIZATION]: ['Meta-Llama-3.3-70B-Instruct'],
        // Was `Meta-Llama-3.1-8B-Instruct`, which no longer appears among
        // SambaNova Cloud's supported models. Verified 2026-08-17.
        [CLASSIFICATION]: ['Meta-Llama-3.3-70B-Instruct'],
        [STRUCTURED_JSON]: ['Meta-Llama-3.3-70B-Instruct'],
    },
    openrouter: {
        [TEXT]: ['meta-llama/llama-3.3-70b-instruct'],
        [ARTICLE_WRITING]: ['meta-llama/llama-3.3-70b-instruct'],
        [SUMMARIZATION]: ['meta-llama/llama-3.3-70b-instruct'],
        [CLASSIFICATION]: ['meta-llama/llama-3.3-70b-instruct'],
        [STRUCTURED_JSON]: ['meta-llama/llama-3.3-70b-instruct'],
        // The slug was `meta-llama/llama-4-scout-17b-16e-instruct` — Groq's
        // naming for the same weights, not OpenRouter's. OpenRouter does
        // not list it, so every OpenRouter image request 404'd on a model
        // that was in fact available under a different name. Confirmed
        // against OpenRouter's live catalogue (414 models) 2026-08-17.
        [VISION]: ['meta-llama/llama-4-scout'],
        [MULTI_IMAGE]: ['meta-llama/llama-4-scout'],
    },
    huggingface: {
        [TEXT]: ['openai/gpt-oss-120b:fastest'],
        [ARTICLE_WRITING]: ['openai/gpt-oss-120b:fastest'],
        [SUMMARIZATION]: ['openai/gpt-oss-120b:fastest'],
        [CLASSIFICATION]: ['openai/gpt-oss-120b:fastest'],
        [STRUCTURED_JSON]: ['openai/gpt-oss-120b:fastest'],
        [VISION]: ['meta-llama/Llama-4-Scout-17B-16E-Instruct'],
    },
};

module.exports = { MODEL_VERSIONS };
