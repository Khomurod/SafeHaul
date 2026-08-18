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
const {
    getProvider, PROVIDERS, STRUCTURED_MODE, resolveModel, resolveStructuredMode,
} = require('../../ai/registry/providers');
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

    it('asks a vision request for json_object, not json_schema', async () => {
        // The whole point of the per-capability structured mode. Groq's vision
        // model rejects `json_schema` with a 400, so sending the schema form
        // here would fail every CDL photograph — the exact way that "just turn
        // the vision capability on" would have broken.
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: '{"value":"x"}' }] }],
        });
        const schema = {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
        };

        await getAdapter(getProvider('groq')).execute(contextFor('groq', {
            fetchImpl,
            capability: CAPABILITIES.VISION,
            model: 'qwen/qwen3.6-27b',
            schema,
            images: [{ dataUrl: 'data:image/jpeg;base64,AAAA' }],
        }));

        const body = fetchImpl.calls[0].body;
        expect(body.text).toEqual({ format: { type: 'json_object' } });
        expect(JSON.stringify(body.text)).not.toMatch(/json_schema/);

        // Object mode guarantees valid JSON and nothing about its shape, so the
        // schema has to travel in the prompt for the model to aim at it — and
        // SafeHaul's own validator still enforces it on return.
        const userMessage = body.input.find((entry) => entry.role === 'user');
        expect(userMessage.content[0].text).toContain('"required":["value"]');
    });

    it('still asks for json_schema on the text lanes, which do support it', async () => {
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: '{"value":"x"}' }] }],
        });

        await getAdapter(getProvider('groq')).execute(contextFor('groq', {
            fetchImpl,
            capability: CAPABILITIES.STRUCTURED_JSON,
            schema: { type: 'object', properties: {}, additionalProperties: false },
        }));

        expect(fetchImpl.calls[0].body.text.format.type).toBe('json_schema');
    });

    it('records token usage when Groq reports it', async () => {
        const fetchImpl = fetchReturning({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
            usage: { input_tokens: 120, output_tokens: 34 },
        });

        const result = await getAdapter(getProvider('groq'))
            .execute(contextFor('groq', { fetchImpl }));

        expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 34 });
    });

    it('reports an empty response as malformed rather than returning nothing', async () => {
        const fetchImpl = fetchReturning({ output: [] });

        await expect(getAdapter(getProvider('groq')).execute(contextFor('groq', { fetchImpl })))
            .rejects.toMatchObject({ category: 'malformed_response' });
    });
});

/**
 * Gemini fixtures **captured verbatim from the live API** on 2026-08-03 against
 * `gemini-3.6-flash`, trimmed of ids and timings.
 *
 * This matters more than it looks. The original version of this group invented
 * its fixtures from the adapter's own assumptions — it asserted an `output_text`
 * field and a `parts`/`inline_data` request shape. The API returns neither. So
 * the tests passed, the adapter shipped, and *every* Gemini call failed in
 * production: text, structured JSON and vision alike. A test that asserts the
 * code's beliefs back to it cannot catch the code being wrong about the world.
 *
 * Anything added here must come from a recorded real response, not from reading
 * the adapter.
 */
const GEMINI_TEXT_RESPONSE = Object.freeze({
    status: 'completed',
    object: 'interaction',
    model: 'gemini-3.6-flash',
    usage: { total_output_tokens: 1, total_thought_tokens: 83 },
    steps: [
        // Private reasoning: no `content`, only an opaque signature.
        { type: 'thought', signature: 'EooDCocDARFNMg/8eBgcqFu4y7IZjWfHObLKleRTxSyT' },
        { type: 'model_output', content: [{ type: 'text', text: 'hello' }] },
    ],
});

/** A reply that ran out of budget mid-turn: no text, and `status: incomplete`. */
const GEMINI_TRUNCATED_RESPONSE = Object.freeze({
    status: 'incomplete',
    object: 'interaction',
    model: 'gemini-3.6-flash',
    usage: { total_output_tokens: 0, total_thought_tokens: 13 },
});

describe('model pins that vendors have retired', () => {
    /**
     * A registry pin is a claim about the world, and the world moves. Every
     * entry below was live in the registry and dead at the vendor — silently,
     * because the connection test sent plain text and never touched the model
     * a real task would have resolved.
     *
     * These assertions are cheap insurance against the same drift returning by
     * copy-paste. They cannot detect *new* drift; `diagnoseAiModelPins`
     * reconciles the pins against the vendors' live catalogues for that.
     *
     * All verified against vendor documentation and live catalogues 2026-08-17.
     */
    const deadModels = [
        // Retired 2025-12-31 and 2026-05-31 respectively. These were Mistral's
        // vision and multi-image pins, so Mistral could not serve a CDL
        // photograph for months while still advertising the capability.
        ['mistral', 'pixtral-12b-latest'],
        ['mistral', 'pixtral-large-latest'],
        // Groq's naming for the weights, used as an OpenRouter slug. OpenRouter
        // lists `meta-llama/llama-4-scout`, so every OpenRouter image request
        // 404'd on a model that was in fact available under another name.
        ['openrouter', 'meta-llama/llama-4-scout-17b-16e-instruct'],
        // Absent from Cerebras' catalogue, which now offers gpt-oss-120b,
        // gemma-4-31b and zai-glm-4.7.
        ['cerebras', 'llama-3.3-70b'],
        ['cerebras', 'llama3.1-8b'],
        // Deprecated in the Workers AI catalogue.
        ['cloudflare', '@cf/meta/llama-3.1-8b-instruct'],
        // No longer listed among SambaNova Cloud's supported models.
        ['sambanova', 'Meta-Llama-3.1-8B-Instruct'],
    ];

    it.each(deadModels)('%s no longer pins the retired model %s', (providerId, model) => {
        expect(Object.values(getProvider(providerId).defaultModels)).not.toContain(model);
    });

    it('gives every vision-capable provider a model for every image lane it claims', () => {
        // The defect this catches is the specific one that emptied the vision
        // lane: a provider advertising `vision` whose vision model no longer
        // resolves. The router gates on the capability, so the claim has to be
        // backed by something.
        for (const provider of PROVIDERS) {
            if (provider.retired) continue;
            for (const capability of [CAPABILITIES.VISION, CAPABILITIES.MULTI_IMAGE]) {
                if (!provider.capabilities.includes(capability)) continue;
                expect(resolveModel(provider, capability, {})).toBeTruthy();
            }
        }
    });

    it('keeps more than one provider able to serve a multi-page document', () => {
        // E-Doc asks for `multi_image` on any scan of two pages or more. When
        // Mistral's and OpenRouter's pins were dead, Gemini was the *only*
        // provider that could serve one — a single point of failure behind a
        // 20-request free-tier cap, which is what "AI is unreliable" looked
        // like from a driver's seat.
        const multiImageProviders = PROVIDERS.filter((provider) => (
            !provider.retired && provider.capabilities.includes(CAPABILITIES.MULTI_IMAGE)
        ));

        expect(multiImageProviders.length).toBeGreaterThan(1);
    });
});

describe('Groq model pins — verified against the live API', () => {
    /**
     * These are assertions about the *vendor*, not about our code, and they exist
     * because getting them wrong silently broke every schema-using AI feature in
     * production while the health check stayed green.
     *
     * Verified against the live Groq API on 2026-08-03 with a real key.
     */
    const groq = getProvider('groq');

    it('asks for json_schema only from the models that accept it', () => {
        // Groq rejects the others outright:
        //   400 "This model does not support response format `json_schema`."
        // Groq's structured-outputs documentation lists exactly the gpt-oss
        // models as schema-capable (verified 2026-08-17).
        //
        // This is now a statement about the *pairing* rather than about every
        // pin, because the vision model is deliberately not schema-capable and
        // is asked in JSON object mode instead. A model pinned to a lane whose
        // structured mode it cannot serve is a guaranteed 400 on every request.
        const SCHEMA_CAPABLE = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

        for (const [capability, model] of Object.entries(groq.defaultModels)) {
            const mode = resolveStructuredMode(groq, capability);
            if (mode === STRUCTURED_MODE.GROQ_RESPONSES_SCHEMA) {
                expect(SCHEMA_CAPABLE).toContain(model);
            } else {
                expect(mode).toBe(STRUCTURED_MODE.GROQ_RESPONSES_JSON_OBJECT);
                expect(SCHEMA_CAPABLE).not.toContain(model);
            }
        }
    });

    it('names no model Groq has withdrawn', () => {
        // `GET /models` no longer lists these and requesting either returns
        // `model_not_found`. The old registry pinned both for CDL and E-Doc.
        const WITHDRAWN = [
            'meta-llama/llama-4-scout-17b-16e-instruct',
            'meta-llama/llama-4-maverick-17b-128e-instruct',
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
        ];
        const pinned = Object.values(groq.defaultModels);
        for (const dead of WITHDRAWN) expect(pinned).not.toContain(dead);
    });

    it('claims vision again, on a model that exists and in a mode it supports', () => {
        // Vision was withdrawn on 2026-08-03 when Groq retired both llama-4
        // vision models, and that was right at the time. Groq's catalogue then
        // moved on: `qwen/qwen3.6-27b` is multimodal and is Groq's own
        // recommended replacement for Scout (verified 2026-08-17).
        //
        // Two things have to hold together for this to be more than a flag.
        expect(groq.supportsVision).toBe(true);
        expect(groq.capabilities).toContain(CAPABILITIES.VISION);
        expect(groq.capabilities).toContain(CAPABILITIES.MULTI_IMAGE);
        expect(groq.capabilities).toContain(CAPABILITIES.STRUCTURED_JSON);

        // 1. The image lanes resolve the multimodal model.
        expect(resolveModel(groq, CAPABILITIES.VISION, {})).toBe('qwen/qwen3.6-27b');
        expect(resolveModel(groq, CAPABILITIES.MULTI_IMAGE, {})).toBe('qwen/qwen3.6-27b');

        // 2. Those lanes ask in the only mode that model accepts. Getting this
        //    wrong is a 400 on every CDL photograph, not a degraded answer.
        expect(resolveStructuredMode(groq, CAPABILITIES.VISION))
            .toBe(STRUCTURED_MODE.GROQ_RESPONSES_JSON_OBJECT);
        expect(resolveStructuredMode(groq, CAPABILITIES.STRUCTURED_JSON))
            .toBe(STRUCTURED_MODE.GROQ_RESPONSES_SCHEMA);
    });

    it('declares the vendor image cap so the router does not spend a request learning it', () => {
        // Groq accepts at most five images per request and answers a sixth with
        // a 400. E-Doc caps itself at five pages, so the two agree today — the
        // registry states it so the router enforces it rather than trusting
        // that they always will.
        expect(groq.maxImages).toBe(5);
    });

    it('declares a model for every capability it claims', () => {
        // A claimed capability with no model is the defect that made the router
        // spend a request to discover the model was gone.
        for (const capability of groq.capabilities) {
            if (capability === CAPABILITIES.LONG_CONTEXT) continue; // not a model axis
            expect(resolveModel(groq, capability, {})).toBeTruthy();
        }
    });
});

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
