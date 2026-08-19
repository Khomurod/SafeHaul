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
    'output_truncated',
    'provider_request_rejected',
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
    // SafeHaul could not read its own credentials — an infrastructure fault on
    // our side, not a vendor's. Kept distinct from `not_configured` because the
    // two need opposite operator actions: one says "add a key", this one says
    // "the key is there and the runtime cannot read it". Reporting the first for
    // the second sent operators to re-enter credentials that already existed.
    'credential_error',
    'internal',
]);

const ALL_CATEGORIES = Object.freeze([...RETRYABLE_CATEGORIES, ...TERMINAL_CATEGORIES]);

/**
 * Categories that abandon the whole task, as opposed to the current provider.
 *
 * `retryable: false` answers "should this provider be tried again?" — it does
 * *not* answer "should the remaining providers be tried?" Conflating the two
 * meant one provider could take down the entire fallback chain:
 *
 *  - `unauthorized` is one vendor's key being wrong, expired or revoked. Eight
 *    other vendors with working keys are unaffected, but the router threw before
 *    reaching any of them.
 *  - `internal` is the catch-all the router assigns to *any* exception an adapter
 *    raises that is not an `AiError` — a `TypeError`, a bad property access, a
 *    parse slip. One unexpected bug in the highest-priority adapter therefore
 *    disabled every AI feature, with a message blaming the request.
 *
 * Because Groq is priority 1, either of those made the platform behave as though
 * no provider were configured. That is the opposite of what nine providers and a
 * capability-aware router are for.
 *
 * These four genuinely are task-fatal: the first two mean every vendor would
 * answer the same way, and the last two mean there is no time or nothing left to
 * try.
 */
const TASK_FATAL_CATEGORIES = Object.freeze([
    'invalid_request',
    'capability_unavailable',
    'deadline_exceeded',
    'all_providers_failed',
    // Only ever produced by `buildTerminalFailure` once the walk is over, so it
    // cannot end a walk early. Listed for the same reason `all_providers_failed`
    // is: it is an aggregate verdict, and nothing downstream should retry it.
    'credential_error',
]);

/** True when the failure ends the task rather than just this provider's turn. */
function isTaskFatal(category) {
    return TASK_FATAL_CATEGORIES.includes(category);
}

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
    // Distinct from malformed_response on purpose. A truncated reply is a
    // budget problem with a known fix; reporting it as "unreadable" sent a real
    // diagnosis down the wrong path once already.
    output_truncated: 'The AI service ran out of room before it finished answering.',
    // A 4xx here is SafeHaul's request being wrong for this vendor, not the
    // vendor being down. Reporting it as `provider_unavailable` cost real
    // debugging time: three genuine Gemini request-shape bugs all surfaced as
    // "temporarily unavailable", which reads as "wait and retry" when the true
    // answer was "this will fail identically forever."
    provider_request_rejected: 'The AI service rejected the request SafeHaul sent.',
    schema_validation_failed: 'The AI service returned an unexpected result.',
    not_configured: 'No AI provider is configured for this task.',
    // Says whose fault it is without naming a resource. An operator reading this
    // in the console needs to check Secret Manager access for the Functions
    // runtime; a driver mid-application is shown the callable's own wording
    // instead, which never mentions credentials at all.
    credential_error: 'SafeHaul could not read its AI provider credentials.',
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
        // The vendor's machine-readable error code where it gave one, already
        // pattern-checked by `providers/http.js`. A code, never a message:
        // `model_not_found` distinguishes "the vendor is down" from "we are
        // asking for a model that no longer exists", which is exactly the fault
        // a bare category could not express.
        this.vendorCode = typeof options.vendorCode === 'string' ? options.vendorCode : null;
        // The vendor's own "try again in" hint, in milliseconds, when it gave one
        // and it was short enough to honour. Never surfaced to a caller.
        this.retryAfterMs = Number.isFinite(options.retryAfterMs) && options.retryAfterMs > 0
            ? options.retryAfterMs
            : null;
        // The vendor's stated wait, uncapped, used to size a cooldown rather
        // than to hold a request open. A per-minute cap must not cost half an
        // hour of a provider's availability.
        this.retryAfterHintMs = Number.isFinite(options.retryAfterHintMs) && options.retryAfterHintMs > 0
            ? options.retryAfterHintMs
            : null;
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

    // A status the vendor uses for exhaustion is decisive on its own. This is
    // what keeps a vendor that signals a spent allowance with 402 rather than
    // 429 earning a quota cooldown.
    if (detection?.statuses.includes(status)) {
        return status === 429 ? 'rate_limited' : 'quota_exceeded';
    }

    // Everything below this line used to sit *after* a body-marker test that
    // fired on any status >= 400, and that ordering manufactured false quota
    // diagnoses. `bodyMarkers` are words — `quota`, `rate limit`,
    // `insufficient` — and vendors put them in errors that have nothing to do
    // with an allowance: "insufficient permissions" on a 401, or a 400 naming a
    // quota *documentation* URL. Each of those was relabelled `quota_exceeded`,
    // which earned a 30-minute cooldown and told the operator to go and buy
    // capacity for a request-shape or credential bug. So a status SafeHaul can
    // classify precisely is now classified precisely, and the word search is
    // only consulted for statuses that carry no specific meaning.
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 404) return 'model_unavailable';
    if (status === 400 || status === 422) {
        // The request shape was wrong for this vendor. That is a SafeHaul-side
        // problem for *this* adapter, but another vendor with a different shape
        // may well succeed, so it stays **retryable** at the router level and is
        // recorded against the provider — unchanged behaviour.
        //
        // It gets its own category purely so the console and telemetry name the
        // real cause. "Temporarily unavailable" for a permanent request-shape
        // bug points an operator at the vendor's status page instead of at us.
        return 'provider_request_rejected';
    }
    if (status >= 500) return 'provider_unavailable';

    // A 4xx SafeHaul has no specific reading for — 402 Payment Required is the
    // one that matters — is where the vendor's own wording is the best evidence
    // available, so the marker search still runs here.
    if (status >= 400 && detection?.bodyMarkers.some((marker) => haystack.includes(marker))) {
        return 'quota_exceeded';
    }
    return 'provider_unavailable';
}

module.exports = {
    AiError,
    ALL_CATEGORIES,
    RETRYABLE_CATEGORIES,
    TERMINAL_CATEGORIES,
    TASK_FATAL_CATEGORIES,
    isTaskFatal,
    SAFE_MESSAGES,
    categorizeHttpFailure,
};
