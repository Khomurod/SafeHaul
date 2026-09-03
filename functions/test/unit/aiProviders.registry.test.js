/**
 * Registry and adapter coverage, and the model pins vendors have retired.
 *
 * Part of the `aiProviders` suite. The injected `fetch`, the adapter context
 * builder and the fixtures are in `aiProviders.support.js`. The `jest.mock`
 * below has to stay in this file, because Jest hoists it per file and cannot
 * register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiProviders.support').firebaseAdminMock());

const { getAdapter, ADAPTERS } = require('../../ai/providers');
const { getProvider, PROVIDERS, resolveModel } = require('../../ai/registry/providers');
const { CAPABILITIES } = require('../../ai/registry/capabilities');

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

describe('Mistral runs on the tier a free key actually has', () => {
    /**
     * Distinct from a retired pin: `mistral-large-latest` is a live, working
     * model — it is simply *paid-tier only*. A free key gets `403
     * tier_not_allowed` and Large is not even in its catalogue, so pinning it
     * meant every Mistral lane 403'd and the connection test reported six
     * failures on a key that authenticates and does inference. Verified against
     * the live API on a free key 2026-09-03: `mistral-medium-latest` serves
     * every lane — text, structured JSON and vision — on the free entitlement.
     *
     * These guard the regression back to a paid-tier default, which no vendor
     * catalogue reconciliation would catch (the model is real, just entitled).
     */
    const PAID_TIER_ONLY = ['mistral-large-latest', 'mistral-large-2512'];

    it('pins no paid-tier-only model on any lane', () => {
        const pins = Object.values(getProvider('mistral').defaultModels);
        for (const paid of PAID_TIER_ONLY) expect(pins).not.toContain(paid);
    });

    it('resolves a free-tier model for text, structured JSON and vision alike', () => {
        const mistral = getProvider('mistral');
        for (const capability of [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.VISION]) {
            expect(resolveModel(mistral, capability, {})).toMatch(/^mistral-(medium|small)/);
        }
    });
});
