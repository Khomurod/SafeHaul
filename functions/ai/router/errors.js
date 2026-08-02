/**
 * The AI error taxonomy.
 *
 * The distinction that matters is *whose fault it is*, because that decides
 * whether the router moves on to the next provider or stops immediately:
 *
 *  - `retryable: true`  — the vendor failed us. Try the next provider.
 *  - `retryable: false` — SafeHaul or the caller is at fault. Trying nine
 *                         vendors in a row would just burn nine quotas and
 *                         return the same answer.
 *
 * Nothing in here ever carries a credential, a raw provider error body, or
 * document content. `safeMessage` is what a user may see; `detail` is for
 * server logs and is deliberately short.
 */

/** Categories that mean "this provider failed, try another". */
const RETRYABLE_CATEGORIES = Object.freeze([
    'timeout',
    'network',
    'provider_unavailable',
    'quota_exceeded',
    'rate_limited',
    'model_unavailable',
    'malformed_response',
    'schema_validation_failed',
    'not_configured',
]);

/** Categories that mean "stop; another provider will not help". */
const TERMINAL_CATEGORIES = Object.freeze([
    'invalid_request',
    'unauthorized',
    'capability_unavailable',
    'deadline_exceeded',
    'all_providers_failed',
    'internal',
]);

const ALL_CATEGORIES = Object.freeze([...RETRYABLE_CATEGORIES, ...TERMINAL_CATEGORIES]);

/**
 * Safe, user-facing text per category. Deliberately vague about vendors: an
 * operator learns which provider failed from the AI Integrations console and
 * the telemetry, not from an error shown to a driver mid-application.
 */
const SAFE_MESSAGES = Object.freeze({
    timeout: 'The AI service did not respond in time.',
    network: 'The AI service could not be reached.',
    provider_unavailable: 'The AI service is temporarily unavailable.',
    quota_exceeded: 'The AI service allowance has been used up.',
    rate_limited: 'The AI service is busy. Please try again shortly.',
    model_unavailable: 'The configured AI model is not available.',
    malformed_response: 'The AI service returned an unreadable response.',
    schema_validation_failed: 'The AI service returned an unexpected result.',
    not_configured: 'No AI provider is configured for this task.',
    invalid_request: 'The request could not be processed.',
    unauthorized: 'The AI service rejected SafeHaul credentials.',
    capability_unavailable: 'No configured AI provider supports this task.',
    deadline_exceeded: 'The AI request took too long to complete.',
    all_providers_failed: 'Every configured AI provider failed to complete this request.',
    internal: 'The AI request could not be completed.',
});

class AiError extends Error {
    /**
     * @param {string} category one of ALL_CATEGORIES
     * @param {string} [detail] short, credential-free server-side detail
     * @param {object} [options]
     * @param {string} [options.providerId] provider that produced the failure
     * @param {number} [options.status] upstream HTTP status, when there was one
     */
    constructor(category, detail = '', options = {}) {
        const safeCategory = ALL_CATEGORIES.includes(category) ? category : 'internal';
        super(SAFE_MESSAGES[safeCategory]);
        this.name = 'AiError';
        this.category = safeCategory;
        this.safeMessage = SAFE_MESSAGES[safeCategory];
        // Truncated because some vendors echo the request — including document
        // text — back inside their error strings.
        this.detail = typeof detail === 'string' ? detail.slice(0, 200) : '';
        this.providerId = options.providerId || null;
        this.status = Number.isInteger(options.status) ? options.status : null;
    }

    get retryable() {
        return RETRYABLE_CATEGORIES.includes(this.category);
    }

    /** The only shape that may cross a trust boundary. */
    toSafeJSON() {
        return { category: this.category, message: this.safeMessage };
    }
}

/**
 * Maps an upstream HTTP status to a category, consulting the provider's own
 * quota detection first so a vendor that signals exhaustion with 402 rather
 * than 429 still earns a quota cooldown.
 *
 * @param {number} status
 * @param {string} body raw response body (never logged, only inspected)
 * @param {object} provider registry row
 * @returns {string} category
 */
function categorizeHttpFailure(status, body, provider) {
    const detection = provider?.quotaDetection;
    const haystack = typeof body === 'string' ? body.toLowerCase() : '';

    if (detection) {
        const statusMatches = detection.statuses.includes(status);
        const markerMatches = detection.bodyMarkers.some((marker) => haystack.includes(marker));
        if (statusMatches || (status >= 400 && markerMatches)) {
            return status === 429 ? 'rate_limited' : 'quota_exceeded';
        }
    }

    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 404) return 'model_unavailable';
    if (status === 400 || status === 422) {
        // A 400 usually means the request shape was wrong for this vendor.
        // That is a SafeHaul-side problem for *this* adapter, but another
        // vendor with a different shape may well succeed, so it stays
        // retryable at the router level and is recorded against the provider.
        return 'provider_unavailable';
    }
    if (status >= 500) return 'provider_unavailable';
    return 'provider_unavailable';
}

module.exports = {
    AiError,
    ALL_CATEGORIES,
    RETRYABLE_CATEGORIES,
    TERMINAL_CATEGORIES,
    SAFE_MESSAGES,
    categorizeHttpFailure,
};
