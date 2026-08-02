/**
 * Provider adapters.
 *
 * One test group per vendor, asserting the request actually sent and the
 * response actually parsed. `fetch` is always injected, so no test in this file
 * — or anywhere in this repository — contacts a real provider.
 *
 * These tests are the reason the router can trust its adapters: they pin the
 * endpoint, the authorization header, the structured-output mechanism and the
 * response envelope for each vendor independently.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: { collection: () => ({ add: jest.fn(), doc: () => ({ set: jest.fn(), get: jest.fn() }) }) },
}));

const { getAdapter, ADAPTERS } = require('../../ai/providers');
const { getProvider, PROVIDERS, STRUCTURED_MODE, resolveModel } = require('../../ai/registry/providers');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { AiError } = require('../../ai/router/errors');
const { requireModel: requireCloudflareModel } = require('../../ai/providers/cloudflare');

const SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
};

/** Records the single request an adapter makes and replies with a fixed body. */
function fetchReturning(body, { ok = true, status = 200 } = {}) {
    const calls = [];
    const impl = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
            ok,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    impl.calls = calls;
    return impl;
}

function contextFor(providerId, overrides = {}) {
    const provider = getProvider(providerId);
    return {
        provider,
        capability: CAPABILITIES.TEXT,
        model: 'test/model',
        systemInstructions: 'Be terse.',
        inputText: 'What is the answer?',
        images: null,
        schema: null,
        schemaName: 'safehaul_test',
        temperature: 0,
        maxOutputTokens: 128,
        timeoutMs: 5000,
        parentSignal: undefined,
        credentials: { apiKey: 'test-key', apiToken: 'test-token', token: 'test-gh-token' },
        config: { accountId: 'a'.repeat(32) },
        ...overrides,
    };
}

const OPENAI_BODY = { choices: [{ message: { content: '{"answer":"42"}', role: 'assistant' } }] };

describe('registry and adapter coverage', () => {
    it('has an adapter for every registered provider', () => {
        for (const provider of PROVIDERS) {
            expect(() => getAdapter(provider)).not.toThrow();
        }
        expect(Object.keys(ADAPTERS)).toHaveLength(9);
    });

    it('declares vision support consistently with its capability list', () => {
        for (const provider of PROVIDERS) {
            const claimsVision = provider.capabilities.includes(CAPABILITIES.VISION);
            expect(provider.supportsVision).toBe(claimsVision);
        }
    });

    it('resolves a model for every capability each non-retired provider claims', () => {
        // Some capabilities (long context, for instance) are properties of the
        // text model rather than a separate model, so the registry does not pin
        // one for each. What must hold is that resolution never returns null,
        // because the router skips a provider it cannot pick a model for.
        for (const provider of PROVIDERS) {
            if (provider.retired) continue;
            for (const capability of provider.capabilities) {
                expect(typeof resolveModel(provider, capability, {})).toBe('string');
            }
        }
    });

    it('lets an operator override the model for the capabilities a field applies to', () => {
        const huggingface = getProvider('huggingface');

        expect(resolveModel(huggingface, CAPABILITIES.TEXT, { textModel: 'my-org/my-model' }))
            .toBe('my-org/my-model');
        // The text override must not leak into the vision slot.
        expect(resolveModel(huggingface, CAPABILITIES.VISION, { textModel: 'my-org/my-model' }))
            .toBe(huggingface.defaultModels[CAPABILITIES.VISION]);
    });

    it('ignores a blank override rather than resolving to an empty model', () => {
        const openrouter = getProvider('openrouter');
        expect(resolveModel(openrouter, CAPABILITIES.TEXT, { textModel: '   ' }))
            .toBe(openrouter.defaultModels[CAPABILITIES.TEXT]);
    });

    it('gives every provider a bounded timeout and a finite attempt count', () => {
        for (const provider of PROVIDERS) {
            expect(provider.timeoutMs).toBeGreaterThan(0);
            expect(provider.timeoutMs).toBeLessThanOrEqual(120000);
            expect(provider.retryPolicy.attempts).toBeGreaterThanOrEqual(1);
            expect(provider.retryPolicy.attempts).toBeLessThanOrEqual(2);
        }
    });
});

describe('Groq adapter', () => {
    it('posts to the Responses endpoint with a bearer token', async () => {
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }],
        });

        const result = await getAdapter(getProvider('groq'))
            .execute(contextFor('groq', { fetchImpl }));

        expect(fetchImpl.calls[0].url).toBe('https://api.groq.com/openai/v1/responses');
        expect(fetchImpl.calls[0].options.headers.Authorization).toBe('Bearer test-key');
        expect(result.text).toBe('hello');
    });

    it('asks for a json_schema text format when a schema is supplied', async () => {
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"42"}' }] }],
        });

        await getAdapter(getProvider('groq'))
            .execute(contextFor('groq', { fetchImpl, schema: SCHEMA, schemaName: 'my_schema' }));

        expect(fetchImpl.calls[0].body.text.format).toEqual({
            type: 'json_schema',
            name: 'my_schema',
            schema: SCHEMA,
        });
    });

    it('sends an image as input_image alongside the prompt', async () => {
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        });

        await getAdapter(getProvider('groq')).execute(contextFor('groq', {
            fetchImpl,
            images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        }));

        const userMessage = fetchImpl.calls[0].body.input.find((entry) => entry.role === 'user');
        expect(userMessage.content).toEqual([
            { type: 'input_text', text: 'What is the answer?' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ]);
    });

    it('reports an empty response as malformed rather than returning nothing', async () => {
        const fetchImpl = fetchReturning({ output: [] });

        await expect(getAdapter(getProvider('groq')).execute(contextFor('groq', { fetchImpl })))
            .rejects.toMatchObject({ category: 'malformed_response' });
    });
});

describe('Gemini adapter', () => {
    it('posts to the Interactions endpoint with the x-goog-api-key header', async () => {
        const fetchImpl = fetchReturning({ output_text: 'hello' });

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(fetchImpl.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
        expect(fetchImpl.calls[0].options.headers['x-goog-api-key']).toBe('test-key');
        // A bearer header would be wrong for this vendor and must not appear.
        expect(fetchImpl.calls[0].options.headers.Authorization).toBeUndefined();
        expect(result.text).toBe('hello');
    });

    it('requests JSON through response_format', async () => {
        const fetchImpl = fetchReturning({ output_text: '{"answer":"42"}' });

        await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl, schema: SCHEMA }));

        expect(fetchImpl.calls[0].body.response_format).toEqual({
            type: 'text',
            mime_type: 'application/json',
            schema: SCHEMA,
        });
    });

    it('strips the data URL prefix and sends inline base64', async () => {
        const fetchImpl = fetchReturning({ output_text: 'ok' });

        await getAdapter(getProvider('gemini')).execute(contextFor('gemini', {
            fetchImpl,
            images: [{ dataUrl: 'data:image/jpeg;base64,QUJD' }],
        }));

        const parts = fetchImpl.calls[0].body.input[0].parts;
        expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
        // Gemini rejects the `data:` prefix, so it must not survive.
        expect(JSON.stringify(parts)).not.toContain('data:image');
    });

    it('reads the legacy candidates envelope as well as the new one', async () => {
        const fetchImpl = fetchReturning({
            candidates: [{ content: { parts: [{ text: 'legacy shape' }] } }],
        });

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(result.text).toBe('legacy shape');
    });

    it('refuses an image that is not a base64 data URL', async () => {
        const fetchImpl = fetchReturning({ output_text: 'ok' });

        await expect(getAdapter(getProvider('gemini')).execute(contextFor('gemini', {
            fetchImpl,
            images: [{ dataUrl: 'https://example.com/photo.png' }],
        }))).rejects.toMatchObject({ category: 'invalid_request' });
    });
});

describe('Cloudflare Workers AI adapter', () => {
    it('puts the stored account id and model in the path', async () => {
        const fetchImpl = fetchReturning({ success: true, result: { response: 'hello' } });

        await getAdapter(getProvider('cloudflare')).execute(contextFor('cloudflare', {
            fetchImpl,
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        }));

        expect(fetchImpl.calls[0].url).toBe(
            `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}`
            + '/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        );
        expect(fetchImpl.calls[0].options.headers.Authorization).toBe('Bearer test-token');
    });

    it('refuses a malformed account id instead of building a URL from it', async () => {
        const fetchImpl = fetchReturning({ success: true, result: { response: 'x' } });

        await expect(getAdapter(getProvider('cloudflare')).execute(contextFor('cloudflare', {
            fetchImpl,
            config: { accountId: '../../../evil' },
        }))).rejects.toMatchObject({ category: 'not_configured' });

        expect(fetchImpl.calls).toHaveLength(0);
    });

    it('refuses a model id that could escape the path', async () => {
        const fetchImpl = fetchReturning({ success: true, result: { response: 'x' } });

        await expect(getAdapter(getProvider('cloudflare')).execute(contextFor('cloudflare', {
            fetchImpl,
            model: '../../accounts/other/ai/run/x',
        }))).rejects.toMatchObject({ category: 'model_unavailable' });

        expect(fetchImpl.calls).toHaveLength(0);
    });

    it('accepts the vendor-namespaced model ids the registry actually ships', () => {
        const provider = getProvider('cloudflare');
        for (const model of Object.values(provider.defaultModels)) {
            expect(() => requireCloudflareModel(model)).not.toThrow();
        }
    });

    it.each([
        ['a parent-directory segment', '@cf/meta/../../../x'],
        ['a bare traversal', '../../accounts/other/ai/run/x'],
        ['an absolute path', '/etc/passwd'],
        ['a missing vendor prefix', 'meta/llama-3.3-70b'],
        ['a trailing dot segment', '@cf/meta/llama.'],
    ])('rejects %s as a Cloudflare model id', (_label, model) => {
        expect(() => requireCloudflareModel(model)).toThrow();
    });

    it('treats success:false as a failure even on HTTP 200', async () => {
        const fetchImpl = fetchReturning({ success: false, errors: [{ message: 'model error' }] });

        await expect(getAdapter(getProvider('cloudflare')).execute(contextFor('cloudflare', {
            fetchImpl,
            model: '@cf/meta/llama-3.1-8b-instruct',
        }))).rejects.toMatchObject({ category: 'provider_unavailable' });
    });

    it('carries the schema in the prompt, since Workers AI has no JSON mode', async () => {
        const fetchImpl = fetchReturning({ success: true, result: { response: '{"answer":"42"}' } });

        await getAdapter(getProvider('cloudflare')).execute(contextFor('cloudflare', {
            fetchImpl,
            model: '@cf/meta/llama-3.1-8b-instruct',
            schema: SCHEMA,
        }));

        const userMessage = fetchImpl.calls[0].body.messages.find((m) => m.role === 'user');
        expect(userMessage.content).toContain('JSON Schema');
        expect(userMessage.content).toContain('"answer"');
        expect(getProvider('cloudflare').structuredMode).toBe(STRUCTURED_MODE.PROMPT_ONLY);
    });
});

describe('GitHub Models adapter', () => {
    it('refuses to run, because the vendor retired the API', async () => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await expect(getAdapter(getProvider('github-models')).execute(contextFor('github-models', { fetchImpl })))
            .rejects.toMatchObject({ category: 'provider_unavailable' });

        // The point of the guard is that no request is attempted at all.
        expect(fetchImpl.calls).toHaveLength(0);
    });

    it('is marked retired in the registry with a dated reason and reference', () => {
        const provider = getProvider('github-models');
        expect(provider.retired.since).toBe('2026-07-30');
        expect(provider.retired.reason).toMatch(/retired GitHub Models/i);
        expect(provider.retired.reference).toMatch(/^https:\/\/github\.blog\//);
    });

    it('keeps its place in the fallback order so the documented order is intact', () => {
        expect(getProvider('github-models').priority).toBe(4);
    });
});

describe('OpenAI-compatible adapters', () => {
    const cases = [
        ['mistral', 'https://api.mistral.ai/v1/chat/completions', 'apiKey'],
        ['cerebras', 'https://api.cerebras.ai/v1/chat/completions', 'apiKey'],
        ['sambanova', 'https://api.sambanova.ai/v1/chat/completions', 'apiKey'],
        ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'apiKey'],
        ['huggingface', 'https://router.huggingface.co/v1/chat/completions', 'apiKey'],
    ];

    it.each(cases)('%s posts to its documented endpoint with a bearer token', async (providerId, expectedUrl) => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        const result = await getAdapter(getProvider(providerId))
            .execute(contextFor(providerId, { fetchImpl }));

        expect(fetchImpl.calls[0].url).toBe(expectedUrl);
        expect(fetchImpl.calls[0].options.headers.Authorization).toBe('Bearer test-key');
        expect(result.text).toBe('{"answer":"42"}');
    });

    it.each(cases)('%s sends a system message and the prompt', async (providerId) => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await getAdapter(getProvider(providerId)).execute(contextFor(providerId, { fetchImpl }));

        expect(fetchImpl.calls[0].body.messages).toEqual([
            { role: 'system', content: 'Be terse.' },
            { role: 'user', content: 'What is the answer?' },
        ]);
        expect(fetchImpl.calls[0].body.stream).toBe(false);
    });

    it('uses strict json_schema where the vendor supports it', async () => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await getAdapter(getProvider('mistral'))
            .execute(contextFor('mistral', { fetchImpl, schema: SCHEMA, schemaName: 'x' }));

        expect(fetchImpl.calls[0].body.response_format).toEqual({
            type: 'json_schema',
            json_schema: { name: 'x', strict: true, schema: SCHEMA },
        });
    });

    it('falls back to json_object plus a prompt-carried schema where it does not', async () => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await getAdapter(getProvider('sambanova'))
            .execute(contextFor('sambanova', { fetchImpl, schema: SCHEMA }));

        expect(fetchImpl.calls[0].body.response_format).toEqual({ type: 'json_object' });
        const userMessage = fetchImpl.calls[0].body.messages.find((m) => m.role === 'user');
        expect(userMessage.content).toContain('JSON Schema');
    });

    it('identifies SafeHaul to OpenRouter without sending a credential in those headers', async () => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await getAdapter(getProvider('openrouter')).execute(contextFor('openrouter', { fetchImpl }));

        const headers = fetchImpl.calls[0].options.headers;
        expect(headers['HTTP-Referer']).toBe('https://safehaul.io');
        expect(headers['X-Title']).toBe('SafeHaul');
        expect(headers['HTTP-Referer']).not.toContain('test-key');
    });

    it('attaches images as image_url parts for a vision-capable vendor', async () => {
        const fetchImpl = fetchReturning(OPENAI_BODY);

        await getAdapter(getProvider('mistral')).execute(contextFor('mistral', {
            fetchImpl,
            images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
        }));

        const userMessage = fetchImpl.calls[0].body.messages.find((m) => m.role === 'user');
        expect(userMessage.content).toEqual([
            { type: 'text', text: 'What is the answer?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ]);
    });
});

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
