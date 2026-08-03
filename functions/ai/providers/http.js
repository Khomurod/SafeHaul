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
        // Status only. The body was read to classify the failure and is not
        // carried forward, because it can quote the prompt back at us.
        throw new AiError(category, `HTTP ${response.status}`, {
            providerId: provider?.id,
            status: response.status,
            // How long the vendor says to wait, when it says so. Groq returns
            // `x-ratelimit-reset-tokens: 7.222s`; the standard `Retry-After` is
            // honoured too. The router uses this to wait rather than abandoning a
            // provider over a few seconds — see `readRetryAfterMs`.
            retryAfterMs: readRetryAfterMs(response),
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

module.exports = {
    readRetryAfterMs,
    MAX_RETRY_AFTER_MS, postJson };
