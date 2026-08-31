/**
 * Gemini, Cloudflare Workers AI, GitHub Models and the OpenAI-compatible
 * adapters.
 *
 * Part of the `aiProviders` suite. The injected `fetch`, the adapter context
 * builder and the fixtures are in `aiProviders.support.js`. The `jest.mock`
 * below has to stay in this file, because Jest hoists it per file and cannot
 * register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiProviders.support').firebaseAdminMock());

const { getAdapter } = require('../../ai/providers');
const { getProvider, STRUCTURED_MODE } = require('../../ai/registry/providers');
const { requireModel: requireCloudflareModel } = require('../../ai/providers/cloudflare');
const {
    SCHEMA, fetchReturning, contextFor, OPENAI_BODY, GEMINI_TEXT_RESPONSE,
    GEMINI_TRUNCATED_RESPONSE,
} = require('./aiProviders.support');

describe('Gemini adapter', () => {
    it('posts to the Interactions endpoint with the x-goog-api-key header', async () => {
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(fetchImpl.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
        expect(fetchImpl.calls[0].options.headers['x-goog-api-key']).toBe('test-key');
        // A bearer header would be wrong for this vendor and must not appear.
        expect(fetchImpl.calls[0].options.headers.Authorization).toBeUndefined();
        expect(result.text).toBe('hello');
    });

    it('reads the assistant text out of `steps`, not `output`', async () => {
        // The regression that broke every Gemini call. `output` does not exist
        // on this API; reading it made a correct answer look unreadable.
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(result.text).toBe('hello');
    });

    it('never folds a thought step into the answer', async () => {
        // Thought text is the model's private reasoning. Concatenating it would
        // corrupt an article and break JSON the router is about to parse.
        const fetchImpl = fetchReturning({
            status: 'completed',
            steps: [
                { type: 'thought', content: [{ type: 'text', text: 'SECRET REASONING' }] },
                { type: 'model_output', content: [{ type: 'text', text: '{"answer":"42"}' }] },
            ],
        });

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(result.text).toBe('{"answer":"42"}');
        expect(result.text).not.toContain('SECRET REASONING');
    });

    it('sends system instructions as a plain string', async () => {
        // `{ parts: [{ text }] }` is the :generateContent convention and is
        // rejected here: 400 "Expected string, unexpected character: '{'".
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl, systemInstructions: 'Be terse.' }));

        expect(fetchImpl.calls[0].body.system_instruction).toBe('Be terse.');
    });

    it('sends the input as a user_input step list', async () => {
        // `role`+`parts` → 400 "Unknown parameter 'parts'".
        // `role`+`content` → 400 "use step_list input format instead of turn_list".
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        const input = fetchImpl.calls[0].body.input;
        expect(input).toEqual([
            { type: 'user_input', content: [{ type: 'text', text: 'What is the answer?' }] },
        ]);
        expect(JSON.stringify(input)).not.toContain('"parts"');
        expect(JSON.stringify(input)).not.toContain('"role"');
    });

    it('grants output budget on top of the caller\'s, for thinking tokens', async () => {
        // Thought tokens are charged against max_output_tokens. A 16-token
        // budget produced 13 thought tokens and zero output. The caller's number
        // must mean visible output, as it does for every other provider.
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl, maxOutputTokens: 128 }));

        expect(fetchImpl.calls[0].body.generation_config.max_output_tokens)
            .toBeGreaterThan(128);
    });

    it('requests JSON through response_format', async () => {
        const fetchImpl = fetchReturning({
            status: 'completed',
            steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"answer":"42"}' }] }],
        });

        await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl, schema: SCHEMA }));

        expect(fetchImpl.calls[0].body.response_format).toEqual({
            type: 'text',
            mime_type: 'application/json',
            schema: SCHEMA,
        });
    });

    it('sends an image as a sibling-field image content entry', async () => {
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        await getAdapter(getProvider('gemini')).execute(contextFor('gemini', {
            fetchImpl,
            images: [{ dataUrl: 'data:image/jpeg;base64,QUJD' }],
        }));

        const content = fetchImpl.calls[0].body.input[0].content;
        // Not nested under `image`, not `inline_data` — both are rejected.
        expect(content[1]).toEqual({ type: 'image', mime_type: 'image/jpeg', data: 'QUJD' });
        // Gemini rejects the `data:` prefix, so it must not survive.
        expect(JSON.stringify(content)).not.toContain('data:image');
        expect(JSON.stringify(content)).not.toContain('inline_data');
    });

    it('reports a truncated reply as truncated, not unreadable', async () => {
        // `incomplete` with no text has a known fix — raise the budget. Calling
        // it "unreadable" describes the symptom and hides the cause.
        const fetchImpl = fetchReturning(GEMINI_TRUNCATED_RESPONSE);

        await expect(getAdapter(getProvider('gemini')).execute(contextFor('gemini', { fetchImpl })))
            .rejects.toMatchObject({ category: 'output_truncated' });
    });

    it('still reports a genuinely unreadable reply as malformed', async () => {
        const fetchImpl = fetchReturning({ status: 'completed', steps: [] });

        await expect(getAdapter(getProvider('gemini')).execute(contextFor('gemini', { fetchImpl })))
            .rejects.toMatchObject({ category: 'malformed_response' });
    });

    it('reads the legacy candidates envelope as well as the new one', async () => {
        const fetchImpl = fetchReturning({
            candidates: [{ content: { parts: [{ text: 'legacy shape' }] } }],
        });

        const result = await getAdapter(getProvider('gemini'))
            .execute(contextFor('gemini', { fetchImpl }));

        expect(result.text).toBe('legacy shape');
    });

    it('refuses an image that is not a base64 data URL, without ending the whole task', async () => {
        const fetchImpl = fetchReturning(GEMINI_TEXT_RESPONSE);

        // The router now validates every image data URL once, before the walk
        // begins, so this branch is a backstop rather than the gate.
        //
        // The category matters. `invalid_request` is task-fatal, so raising it
        // from inside an adapter aborted the entire nine-provider walk on one
        // adapter's opinion of an image — a vendor-specific complaint that
        // stopped vendors who were never asked. `provider_request_rejected`
        // ends Gemini's turn and lets the next provider try.
        await expect(getAdapter(getProvider('gemini')).execute(contextFor('gemini', {
            fetchImpl,
            images: [{ dataUrl: 'https://example.com/photo.png' }],
        }))).rejects.toMatchObject({ category: 'provider_request_rejected' });
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
