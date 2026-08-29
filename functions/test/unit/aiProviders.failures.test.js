/**
 * How an HTTP failure is classified, and what a timeout does.
 *
 * Part of the `aiProviders` suite. The injected `fetch`, the adapter context
 * builder and the fixtures are in `aiProviders.support.js`. The `jest.mock`
 * below has to stay in this file, because Jest hoists it per file and cannot
 * register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiProviders.support').firebaseAdminMock());

const { getAdapter } = require('../../ai/providers');
const { getProvider } = require('../../ai/registry/providers');
const { AiError } = require('../../ai/router/errors');
const { contextFor } = require('./aiProviders.support');

describe('HTTP failure classification', () => {
    async function failWith(status, body) {
        const fetchImpl = async () => ({
            ok: false,
            status,
            text: async () => body,
            json: async () => ({}),
        });
        return getAdapter(getProvider('mistral'))
            .execute(contextFor('mistral', { fetchImpl }))
            .catch((error) => error);
    }

    it('maps 429 to a rate limit so the provider earns a quota cooldown', async () => {
        expect((await failWith(429, 'rate limit exceeded')).category).toBe('rate_limited');
    });

    it('maps 401 and 403 to unauthorized, which must not fail over', async () => {
        const unauthorized = await failWith(401, 'bad key');
        expect(unauthorized.category).toBe('unauthorized');
        expect(unauthorized.retryable).toBe(false);
        expect((await failWith(403, 'forbidden')).category).toBe('unauthorized');
    });

    it('maps 404 to an unavailable model', async () => {
        expect((await failWith(404, 'no such model')).category).toBe('model_unavailable');
    });

    it('maps 5xx to a provider outage, which does fail over', async () => {
        const outage = await failWith(503, 'upstream down');
        expect(outage.category).toBe('provider_unavailable');
        expect(outage.retryable).toBe(true);
    });

    it('detects a quota message on a non-429 status', async () => {
        // OpenRouter signals exhausted credits with 402, not 429.
        const fetchImpl = async () => ({
            ok: false, status: 402, text: async () => 'insufficient credits', json: async () => ({}),
        });
        const error = await getAdapter(getProvider('openrouter'))
            .execute(contextFor('openrouter', { fetchImpl }))
            .catch((err) => err);

        expect(error.category).toBe('quota_exceeded');
    });

    /**
     * The word search used to run BEFORE the status mapping, for any status at
     * or above 400. `bodyMarkers` are words — `quota`, `rate limit`,
     * `insufficient` — and vendors put them in errors that have nothing to do
     * with an allowance. Each of those was relabelled `quota_exceeded`, which
     * earned a 30-minute cooldown and told the operator to go and buy capacity
     * for what was actually a request-shape or credential bug.
     *
     * This is the mechanism that manufactured a false quota diagnosis, so these
     * four cases pin the ordering rather than the wording.
     */
    it('does not call a rejected request a quota problem because the body says "quota"', async () => {
        const error = await failWith(400, '{"error":{"message":"Invalid request. See quota docs at example.com"}}');

        expect(error.category).toBe('provider_request_rejected');
    });

    it('does not call a refused credential a quota problem because the body says "insufficient"', async () => {
        const error = await failWith(401, '{"error":{"message":"insufficient permissions for this key"}}');

        expect(error.category).toBe('unauthorized');
    });

    it('does not call a retired model a quota problem because the body says "rate limit"', async () => {
        const error = await failWith(404, 'model not found; see rate limit documentation');

        expect(error.category).toBe('model_unavailable');
    });

    it('still trusts the vendor word search on a status it cannot read specifically', async () => {
        // 402 has no SafeHaul-specific meaning, so the vendor's own wording is
        // the best evidence available and the marker search still runs.
        const fetchImpl = async () => ({
            ok: false, status: 402, text: async () => 'insufficient credits', json: async () => ({}),
        });
        const error = await getAdapter(getProvider('mistral'))
            .execute(contextFor('mistral', { fetchImpl }))
            .catch((err) => err);

        expect(error.category).toBe('quota_exceeded');
    });

    /**
     * Measured live on 2026-08-18: the Gemini free tier allows 20 requests per
     * minute and states the wait in the error BODY, not a header —
     * "Please retry in 44.26781542s". Nothing read that sentence, so a
     * 45-second cap earned the flat 30-minute quota cooldown and removed the
     * highest-priority provider from every lane.
     */
    it('reads a stated wait out of the error body, not only the headers', async () => {
        const body = JSON.stringify({
            error: {
                message: 'You exceeded your current quota. \n* Quota exceeded for metric:'
                    + ' generativelanguage.googleapis.com/generate_content_free_tier_requests,'
                    + ' limit: 20, model: gemini-3.6-flash\nPlease retry in 44.26781542s.',
                code: 'too_many_requests',
            },
        });
        const error = await failWith(429, body);

        expect(error.category).toBe('rate_limited');
        // Rounded up from 44.26781542s. Uncapped, because it sizes a cooldown
        // rather than holding this request open.
        expect(error.retryAfterHintMs).toBe(44268);
    });

    it('takes a duration from the body and never a phrase', async () => {
        const { readStatedRetryMs } = require('../../ai/providers/http');
        const noHeaders = { headers: { get: () => null } };

        expect(readStatedRetryMs(noHeaders, 'Please retry in 44.26781542s.')).toBe(44268);
        expect(readStatedRetryMs(noHeaders, 'retry after 30 seconds')).toBe(30000);
        expect(readStatedRetryMs(noHeaders, 'try again in 2 minutes')).toBe(120000);
        expect(readStatedRetryMs(noHeaders, 'try again in 500ms')).toBe(500);
        // Nothing that is not a duration, and nothing absurd.
        expect(readStatedRetryMs(noHeaders, 'retry when the licence for John Doe is readable')).toBeNull();
        expect(readStatedRetryMs(noHeaders, 'please retry in 400 hours')).toBeNull();
        expect(readStatedRetryMs(noHeaders, '')).toBeNull();
    });

    it('never carries the provider error body forward', async () => {
        const error = await failWith(500, 'Error processing document for John Doe of 123 Main St');

        expect(error.detail).toBe('HTTP 500');
        expect(JSON.stringify(error.toSafeJSON())).not.toContain('123 Main St');
        expect(error.message).not.toContain('John Doe');
    });

    it('reports an unparseable success body as malformed', async () => {
        const fetchImpl = async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new Error('not json'); },
            text: async () => 'not json',
        });

        const error = await getAdapter(getProvider('mistral'))
            .execute(contextFor('mistral', { fetchImpl }))
            .catch((err) => err);

        expect(error.category).toBe('malformed_response');
    });
});

describe('timeouts', () => {
    it('aborts a provider that does not answer within its budget', async () => {
        const fetchImpl = (url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        });

        const error = await getAdapter(getProvider('mistral'))
            .execute(contextFor('mistral', { fetchImpl, timeoutMs: 20 }))
            .catch((err) => err);

        expect(error).toBeInstanceOf(AiError);
        expect(error.category).toBe('timeout');
        expect(error.retryable).toBe(true);
    });
});
