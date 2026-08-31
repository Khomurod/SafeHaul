/**
 * The Groq adapter, and its model pins as verified against the live API.
 *
 * Part of the `aiProviders` suite. The injected `fetch`, the adapter context
 * builder and the fixtures are in `aiProviders.support.js`. The `jest.mock`
 * below has to stay in this file, because Jest hoists it per file and cannot
 * register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiProviders.support').firebaseAdminMock());

const { getAdapter } = require('../../ai/providers');
const {
    getProvider, STRUCTURED_MODE, resolveModel, resolveStructuredMode,
} = require('../../ai/registry/providers');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { SCHEMA, fetchReturning, contextFor } = require('./aiProviders.support');

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
