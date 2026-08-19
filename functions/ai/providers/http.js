/**
 * The one place in SafeHaul that performs an outbound AI request.
 *
 * Everything here exists to keep three promises the rest of the platform makes:
 *  - a request cannot hang past its bounded timeout,
 *  - a credential never appears in a log line, and
 *  - a provider error body never propagates verbatim, because several vendors
 *    echo the submitted prompt — which can be a driver's licence — back inside
 *    their error strings.
 */

const { AiError, categorizeHttpFailure } = require('../router/errors');

/** Longest vendor-stated wait worth honouring in-request. */
const MAX_RETRY_AFTER_MS = 30000;

/**
 * Reads the vendor's own "try again in" hint, in milliseconds.
 *
 * Providers state this and we were ignoring it. Groq answers a token-budget
 * refusal with `x-ratelimit-reset-tokens: 7.222s` — a seven second wait, against
 * a task deadline of two minutes and a function timeout of nine. Treating that as
 * a dead provider is throwing away a working one over a rounding error, and on a
 * per-minute token budget it is the difference between a blog that publishes and
 * one that never does.
 *
 * Only short, explicit waits are honoured. Anything longer than
 * `MAX_RETRY_AFTER_MS`, absent, or unparseable returns null and the failure is
 * handled as before — the router moves on.
 *
 * @returns {number|null}
 */
function readRetryAfterMs(response) {
    const get = (name) => {
        try { return response?.headers?.get?.(name) ?? null; } catch { return null; }
    };

    // `Retry-After` is seconds (the HTTP-date form is not used by these vendors).
    const retryAfter = Number.parseFloat(get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const ms = retryAfter * 1000;
        return ms <= MAX_RETRY_AFTER_MS ? Math.ceil(ms) : null;
    }

    // Groq's form: "7.222s", "1m2.5s", "500ms".
    for (const name of ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']) {
        const raw = get(name);
        if (typeof raw !== 'string') continue;
        const match = /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$|^(\d+(?:\.\d+)?)ms$/.exec(raw.trim());
        if (!match) continue;
        const ms = match[3] !== undefined
            ? Number.parseFloat(match[3])
            : (Number.parseFloat(match[1] || '0') * 60000) + (Number.parseFloat(match[2] || '0') * 1000);
        if (Number.isFinite(ms) && ms > 0 && ms <= MAX_RETRY_AFTER_MS) return Math.ceil(ms);
    }
    return null;
}

/** Response bodies are read only to classify the failure, then discarded. */
const MAX_ERROR_BODY_CHARS = 2000;

/**
 * Longest stated wait worth recording at all. A vendor claiming a week is
 * either broken or talking about something other than this request.
 */
const MAX_STATED_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * The vendor's stated wait, uncapped, from wherever it stated it.
 *
 * Separate from `readRetryAfterMs` because the two answer different questions.
 * That one asks "is it worth holding this request open?" and is deliberately
 * capped at 30 seconds. This one asks "how long is this provider actually
 * unavailable for?", and the answer sizes the cooldown — where being wrong by
 * an order of magnitude is expensive.
 *
 * It was measured being wrong by exactly that much. Gemini's free tier caps at
 * 20 requests per minute and says so in the error *body*:
 *
 *   Quota exceeded for metric: …/generate_content_free_tier_requests,
 *   limit: 20, model: gemini-3.6-flash
 *   Please retry in 44.26781542s.
 *
 * Nothing read that sentence, so a 45-second cap earned the flat 30-minute
 * quota cooldown and removed the highest-priority provider from every lane —
 * which is what "Gemini has accumulated repeated failures while still passing
 * basic text" looked like from the console.
 *
 * Only a duration is taken from the body: a number and a unit, nothing else. A
 * body is untrusted text that can quote the submitted prompt back at us, so the
 * result is a number or null, never a string.
 *
 * @returns {number|null}
 */
function readStatedRetryMs(response, raw) {
    const headerMs = (() => {
        let value = null;
        try { value = response?.headers?.get?.('retry-after') ?? null; } catch { value = null; }
        const seconds = Number.parseFloat(value);
        return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
    })();
    if (headerMs !== null && headerMs <= MAX_STATED_RETRY_MS) return headerMs;

    if (typeof raw !== 'string' || !raw) return null;
    // "Please retry in 44.26781542s", "retry after 30 seconds", "try again in 1.5s".
    const match = /(?:retry|try again)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/i
        .exec(raw);
    if (!match) return null;

    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2].toLowerCase();
    const multiplier = unit === 'ms' ? 1 : (unit.startsWith('m') && unit !== 'ms' ? 60000 : 1000);
    const ms = Math.ceil(amount * multiplier);
    return ms > 0 && ms <= MAX_STATED_RETRY_MS ? ms : null;
}

/**
 * Performs a JSON POST with a hard timeout.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {object} params.headers
 * @param {object} params.body
 * @param {number} params.timeoutMs
 * @param {object} params.provider registry row, used for quota detection
 * @param {AbortSignal} [params.parentSignal] the overall request deadline
 * @param {Function} [params.fetchImpl] injected for tests; never network in CI
 * @returns {Promise<object>} parsed JSON response body
 */
async function postJson({ url, headers, body, timeoutMs, provider, parentSignal, fetchImpl }) {
    const doFetch = fetchImpl || globalThis.fetch;
    if (typeof doFetch !== 'function') {
        throw new AiError('internal', 'No fetch implementation available.', { providerId: provider?.id });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
        if (parentSignal.aborted) controller.abort();
        else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    let response;
    try {
        response = await doFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError' || controller.signal.aborted;
        if (aborted) {
            // Distinguish "our per-provider budget ran out" from "the whole
            // request deadline ran out"; only the former is worth failing over.
            if (parentSignal?.aborted) {
                throw new AiError('deadline_exceeded', 'Overall AI deadline reached.', { providerId: provider?.id });
            }
            throw new AiError('timeout', `No response within ${timeoutMs}ms.`, { providerId: provider?.id });
        }
        throw new AiError('network', error?.message || 'Request failed.', { providerId: provider?.id });
    } finally {
        clearTimeout(timer);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    }

    if (!response.ok) {
        let raw = '';
        try {
            raw = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
        } catch {
            raw = '';
        }
        const category = categorizeHttpFailure(response.status, raw, provider);
        // Status and — where the vendor supplies one — its machine-readable
        // error *code*. The body itself is not carried forward, because it can
        // quote the prompt back at us. See `extractVendorCode`.
        throw new AiError(category, `HTTP ${response.status}`, {
            providerId: provider?.id,
            status: response.status,
            vendorCode: extractVendorCode(raw),
            // How long the vendor says to wait, when it says so. Groq returns
            // `x-ratelimit-reset-tokens: 7.222s`; the standard `Retry-After` is
            // honoured too. The router uses this to wait rather than abandoning a
            // provider over a few seconds — see `readRetryAfterMs`.
            retryAfterMs: readRetryAfterMs(response),
            // The full stated wait, used to size the cooldown rather than to
            // hold this request open. See `readStatedRetryMs`.
            retryAfterHintMs: readStatedRetryMs(response, raw),
        });
    }

    try {
        return await response.json();
    } catch {
        throw new AiError('malformed_response', 'Response body was not valid JSON.', {
            providerId: provider?.id,
            status: response.status,
        });
    }
}

/**
 * The vendor's machine-readable error code, and only that.
 *
 * `model_not_found` is the difference between "the vendor is down" and "we are
 * asking for a model that no longer exists" — the second is the fault that
 * emptied the vision lane, and a bare category could not express it. So the code
 * is worth keeping where a vendor gives one.
 *
 * The error *message* beside it is not, and the two live in the same object. So
 * this reads only the fields vendors use for codes, and then requires the result
 * to look like a code: short, single-token, no whitespace or punctuation beyond
 * `_.-`. Anything failing that is dropped rather than truncated, because a
 * truncated error message is still an error message — and several vendors quote
 * the submitted prompt back inside theirs, which on the CDL path means quoting
 * the licence.
 *
 * @param {string} raw the response body, already length-capped
 * @returns {string|null}
 */
const VENDOR_CODE_PATTERN = /^[a-z0-9_.-]{1,64}$/i;

function extractVendorCode(raw) {
    if (!raw) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    const candidates = [
        parsed?.error?.code,
        parsed?.error?.type,
        parsed?.code,
        parsed?.type,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && VENDOR_CODE_PATTERN.test(candidate)) {
            return candidate;
        }
        // Some vendors report a numeric code. A number cannot carry a prompt.
        if (Number.isInteger(candidate)) return String(candidate);
    }
    return null;
}

module.exports = {
    readRetryAfterMs,
    readStatedRetryMs,
    extractVendorCode,
    MAX_RETRY_AFTER_MS,
    MAX_STATED_RETRY_MS,
    postJson,
};
