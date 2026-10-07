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
const {
    getProvider, PROVIDERS, resolveModel, resolveModels,
} = require('../../ai/registry/providers');
const { MODEL_VERSIONS, MAX_VERSIONS_PER_LANE } = require('../../ai/registry/modelVersions');
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
     * failures on a key that authenticates and does inference. On 2026-10-07
     * the free plan also gave Medium and Small a limit of zero requests a
     * minute, and the Ministral models serve every lane — text, structured JSON
     * and vision — on the free entitlement (verified against the live API).
     *
     * These guard the regression back to a paid-tier default, which no vendor
     * catalogue reconciliation would catch (the model is real, just entitled).
     */
    const PAID_TIER_ONLY = ['mistral-large-latest', 'mistral-large-2512'];
    /** Live and listed, but a free key may send them nothing (`429`, limit 0). */
    const ZERO_ON_FREE_TIER = ['mistral-medium-latest', 'mistral-small-latest'];

    it('pins no paid-tier-only model on any lane', () => {
        const pins = Object.values(getProvider('mistral').defaultModels);
        for (const paid of [...PAID_TIER_ONLY, ...ZERO_ON_FREE_TIER]) expect(pins).not.toContain(paid);
    });

    it('resolves a free-tier model for text, structured JSON and vision alike', () => {
        const mistral = getProvider('mistral');
        for (const capability of [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.VISION]) {
            expect(resolveModel(mistral, capability, {})).toMatch(/^ministral-/);
        }
    });
});

describe('model versions', () => {
    it('declares an ordered, duplicate-free version list for every provider and capability', () => {
        for (const provider of PROVIDERS) {
            expect(MODEL_VERSIONS[provider.id]).toBeDefined();
            for (const capability of provider.capabilities) {
                // A property of the text model, not a model of its own.
                if (capability === CAPABILITIES.LONG_CONTEXT) continue;
                const versions = provider.modelVersions[capability];
                expect(Array.isArray(versions)).toBe(true);
                expect(versions.length).toBeGreaterThan(0);
                // One preferred and two spares at most, so one request's
                // budget can reach every version of a lane.
                expect(versions.length).toBeLessThanOrEqual(MAX_VERSIONS_PER_LANE);
                expect(new Set(versions).size).toBe(versions.length);
                for (const version of versions) expect(version.trim()).toBe(version);
            }
        }
    });

    it('derives each single pin from the first version of its list', () => {
        // Everything that reads one pin per capability — the console, the
        // provider list — must keep seeing what a single-pin row showed it.
        for (const provider of PROVIDERS) {
            expect(Object.keys(provider.defaultModels).sort())
                .toEqual(Object.keys(provider.modelVersions).sort());
            for (const [capability, versions] of Object.entries(provider.modelVersions)) {
                expect(provider.defaultModels[capability]).toBe(versions[0]);
            }
        }
    });

    it('freezes the lists, so no caller can reorder a provider\'s versions', () => {
        const gemini = getProvider('gemini');
        expect(Object.isFrozen(gemini.modelVersions)).toBe(true);
        expect(Object.isFrozen(gemini.modelVersions[CAPABILITIES.VISION])).toBe(true);
    });

    it('resolves the whole list in order, with resolveModel naming its first version', () => {
        for (const provider of PROVIDERS) {
            for (const capability of provider.capabilities) {
                const versions = resolveModels(provider, capability, {});
                expect(versions.length).toBeGreaterThan(0);
                expect(resolveModel(provider, capability, {})).toBe(versions[0]);
            }
        }
    });

    it('hands back a copy, so changing it cannot change the registry', () => {
        const gemini = getProvider('gemini');
        resolveModels(gemini, CAPABILITIES.TEXT, {}).push('changed-by-a-caller');
        expect(resolveModels(gemini, CAPABILITIES.TEXT, {})).not.toContain('changed-by-a-caller');
    });

    it('never hands the router more than three versions for a lane', () => {
        const groq = getProvider('groq');
        const long = { ...groq, modelVersions: { ...groq.modelVersions, [CAPABILITIES.TEXT]: ['a', 'b', 'c', 'd'] } };
        expect(resolveModels(long, CAPABILITIES.TEXT, {})).toEqual(['a', 'b', 'c']);
    });

    it('lets an operator override replace the list rather than join it', () => {
        // The operator is naming the one model their account can reach.
        const openrouter = getProvider('openrouter');
        expect(resolveModels(openrouter, CAPABILITIES.TEXT, { textModel: 'my-org/my-model' }))
            .toEqual(['my-org/my-model']);
    });

    it('uses the text list for a capability that has none of its own', () => {
        const groq = getProvider('groq');
        expect(resolveModels(groq, CAPABILITIES.LONG_CONTEXT, {}))
            .toEqual(resolveModels(groq, CAPABILITIES.TEXT, {}));
        // An empty list counts as none, as a missing single pin did.
        const emptied = { ...groq, modelVersions: { ...groq.modelVersions, [CAPABILITIES.VISION]: [] } };
        expect(resolveModels(emptied, CAPABILITIES.VISION, {}))
            .toEqual(resolveModels(groq, CAPABILITIES.TEXT, {}));
    });

    it('refuses to load a provider that declares no versions', () => {
        // Failing at load is the point: a row with no model would otherwise be
        // skipped as `no_model` on every request, silently.
        jest.isolateModules(() => {
            jest.doMock('../../ai/registry/modelVersions', () => ({ MODEL_VERSIONS: {} }));
            expect(() => require('../../ai/registry/providers')).toThrow(/No model versions declared/);
        });
        jest.dontMock('../../ai/registry/modelVersions');
    });

    it('still resolves a hand-built row that carries only single pins', () => {
        const row = { configFields: [], defaultModels: { [CAPABILITIES.TEXT]: 'my-org/text' } };
        expect(resolveModels(row, CAPABILITIES.VISION, {})).toEqual(['my-org/text']);
        expect(resolveModels({ configFields: [], defaultModels: {} }, CAPABILITIES.TEXT, {})).toEqual([]);
        expect(resolveModel({ configFields: [], defaultModels: {} }, CAPABILITIES.TEXT, {})).toBeNull();
    });
});
