// functions/ai/registry/modelVersions.js
//
// Which model versions each provider is asked for, per capability, in order.
//
// A list rather than a single string, because a vendor withdraws, overloads or
// re-tiers one version far more often than it goes down whole. The first entry
// is the preferred version; the rest are spares the router moves to when a
// failure is about that one version (see `../router/versionPolicy.js`).
// `providers.js` attaches the lists to their rows as `modelVersions` and
// derives `defaultModels` from their first entries.
//
// A spare is verified live, on every lane it is listed for, before it is
// listed: the fake licence read in full, two photos at once, a structured JSON
// answer, and — where it writes articles — an article inside the row's timeout.
// A spare that could not be verified says why, where it is listed.
//
// Data only, like `providerTable.js`. A provider row without a list here fails
// at load rather than routing with no model.

const { CAPABILITIES } = require('./capabilities');

/**
 * At most three versions per lane: one preferred and two spares, so a turn can
 * reach every version of a lane inside one request's budget.
 */
const MAX_VERSIONS_PER_LANE = 3;

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
     * Every text entry must answer both plain text *and* `json_schema`
     * structured output. `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`
     * are rejected outright for structured output:
     *
     *   400 "This model does not support response format `json_schema`."
     *
     * Groq's health check sends plain text with no schema, so it passes on a
     * model that fails every schema-using task — article generation, topic
     * selection, CDL extraction, E-Doc placement.
     *
     * `openai/gpt-oss-20b` leads every text lane. `openai/gpt-oss-120b` is its
     * spare, and can answer a request 20b fails with
     * `400 json_validate_failed`. It has its own per-minute allowance, so a
     * rate-limited 20b does not take it down too.
     */
    groq: {
        [TEXT]: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
        [ARTICLE_WRITING]: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
        [SUMMARIZATION]: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
        [CLASSIFICATION]: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
        [STRUCTURED_JSON]: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
        // Groq's only multimodal model, one lane among several rather than
        // anything SafeHaul depends on: 131k context, three images per
        // request, and about 1,800 input tokens a photo against the free
        // tier's 7,000 input tokens a minute. No spare:
        // Groq offers no other model that reads images.
        [VISION]: ['qwen/qwen3.8-27b'],
        [MULTI_IMAGE]: ['qwen/qwen3.8-27b'],
    },
    /**
     * `gemini-3.5-flash-lite` is the spare for photos and structured text. It
     * can be slow while the vendor is overloaded, which is why an overloaded
     * vendor's spares are left to work that has the time. It is not an article
     * spare — it rejects the article request with `400 invalid_request` — so
     * articles keep one version. `gemini-3.5-flash` is not listed until a check
     * verifies it.
     */
    gemini: {
        [TEXT]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        [ARTICLE_WRITING]: ['gemini-3.6-flash'],
        [SUMMARIZATION]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        [CLASSIFICATION]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        [STRUCTURED_JSON]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        [VISION]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        [MULTI_IMAGE]: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    },
    cloudflare: {
        [TEXT]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        [ARTICLE_WRITING]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        [SUMMARIZATION]: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        // The same model as the other lanes rather than a second pin to keep
        // current; the Workers AI catalogue marks
        // `@cf/meta/llama-3.1-8b-instruct` deprecated.
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
     * On the free plan `mistral-large-*` is paid only
     * (`403 tier_not_allowed`), and `mistral-medium-*` and `mistral-small-*`
     * have a limit of zero requests a minute (`429`,
     * `x-ratelimit-limit-req-minute: 0`).
     *
     * `ministral-14b-2512` reads a CDL photo, two and five photos at once, and
     * answers the claim check on a free key, but it is too slow to write an
     * article inside the row's 45s timeout, so articles go to
     * `ministral-8b-2512`.
     *
     * `ministral-8b-2512` is the spare everywhere else.
     * `mistral-medium-latest` comes last, for a paid plan: on a free key it
     * answers with a limit of zero, which the router reads as "not on this
     * plan" and rests for a day.
     */
    mistral: {
        [TEXT]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
        [ARTICLE_WRITING]: ['ministral-8b-2512', 'mistral-medium-latest'],
        [SUMMARIZATION]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
        [CLASSIFICATION]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
        [STRUCTURED_JSON]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
        [VISION]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
        [MULTI_IMAGE]: ['ministral-14b-2512', 'ministral-8b-2512', 'mistral-medium-latest'],
    },
    /**
     * Cerebras' public catalogue offers `gpt-oss-120b` (production),
     * `gemma-4-31b` and `zai-glm-4.7` (preview); `llama-3.3-70b` and
     * `llama3.1-8b` are absent from it.
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
        // `Meta-Llama-3.1-8B-Instruct` is not among SambaNova Cloud's
        // supported models.
        [CLASSIFICATION]: ['Meta-Llama-3.3-70B-Instruct'],
        [STRUCTURED_JSON]: ['Meta-Llama-3.3-70B-Instruct'],
    },
    openrouter: {
        [TEXT]: ['meta-llama/llama-3.3-70b-instruct'],
        [ARTICLE_WRITING]: ['meta-llama/llama-3.3-70b-instruct'],
        [SUMMARIZATION]: ['meta-llama/llama-3.3-70b-instruct'],
        [CLASSIFICATION]: ['meta-llama/llama-3.3-70b-instruct'],
        [STRUCTURED_JSON]: ['meta-llama/llama-3.3-70b-instruct'],
        // OpenRouter's own slug. `meta-llama/llama-4-scout-17b-16e-instruct`
        // is Groq's naming for the same weights; OpenRouter does not list it,
        // so a request for it 404s.
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

module.exports = { MODEL_VERSIONS, MAX_VERSIONS_PER_LANE };
