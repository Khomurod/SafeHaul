/**
 * The versions the daily check saved, as the router reads them.
 *
 * Pinned: a saved lane list comes after an operator override and before the
 * built-in list; it covers photos and text but never article writing; it gives
 * way to a release that changed the built-in list it was checked against; and
 * nothing malformed in the stored document can break routing or reach a vendor.
 */

const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { MAX_VERSIONS_PER_LANE } = require('../../ai/registry/modelVersions');
const { requireProvider, resolveModels, builtInModels } = require('../../ai/registry/providers');
const { managedLane, sanitizeModelList, savedModels } = require('../../ai/registry/savedModels');

const mistral = requireProvider('mistral');
const gemini = requireProvider('gemini');
const GEMINI_VISION = builtInModels(gemini, CAPABILITIES.VISION);
/** Lists saved for `provider`, checked against the built-in lists this release ships. */
const saved = (provider, vision, text) => ({
    modelLists: {
        ...(vision ? { vision: { models: vision, seed: builtInModels(provider, CAPABILITIES.VISION) } } : {}),
        ...(text ? { text: { models: text, seed: builtInModels(provider, CAPABILITIES.STRUCTURED_JSON) } } : {}),
    },
});

describe('which capabilities a saved list covers', () => {
    it('photos and text, each from its own lane', () => {
        expect(managedLane(CAPABILITIES.VISION)).toBe('vision');
        expect(managedLane(CAPABILITIES.MULTI_IMAGE)).toBe('vision');
        for (const capability of [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.SUMMARIZATION, CAPABILITIES.CLASSIFICATION]) {
            expect(managedLane(capability)).toBe('text');
        }
    });

    it('never article writing, which keeps its built-in list', () => {
        // A version that reads a licence well can still be too slow, or refuse, to write an article.
        expect(managedLane(CAPABILITIES.ARTICLE_WRITING)).toBeNull();
        const config = saved(mistral, ['ministral-8b-2512'], ['ministral-8b-2512']);
        expect(resolveModels(mistral, CAPABILITIES.ARTICLE_WRITING, config))
            .toEqual(resolveModels(mistral, CAPABILITIES.ARTICLE_WRITING, {}));
    });
});

describe('the order of precedence', () => {
    it('asks the saved versions instead of the built-in ones', () => {
        const config = saved(mistral, ['ministral-8b-2512', 'mistral-small-2603'], ['ministral-3b-2512']);

        expect(resolveModels(mistral, CAPABILITIES.VISION, config)).toEqual(['ministral-8b-2512', 'mistral-small-2603']);
        expect(resolveModels(mistral, CAPABILITIES.MULTI_IMAGE, config)).toEqual(['ministral-8b-2512', 'mistral-small-2603']);
        expect(resolveModels(mistral, CAPABILITIES.STRUCTURED_JSON, config)).toEqual(['ministral-3b-2512']);
    });

    it('keeps the built-in list for a lane with nothing saved', () => {
        const config = saved(gemini, ['gemini-3.5-flash-lite']);
        expect(resolveModels(gemini, CAPABILITIES.TEXT, config)).toEqual(resolveModels(gemini, CAPABILITIES.TEXT, {}));
    });

    it('lets an operator override win over a saved list', () => {
        const openrouter = requireProvider('openrouter');
        const config = { ...saved(openrouter, null, ['meta-llama/llama-4-scout']), textModel: 'my-org/my-model' };
        expect(resolveModels(openrouter, CAPABILITIES.TEXT, config)).toEqual(['my-org/my-model']);
    });

    it('hands each caller its own copy', () => {
        const config = saved(mistral, ['ministral-8b-2512']);
        resolveModels(mistral, CAPABILITIES.VISION, config).push('changed-by-a-caller');
        expect(resolveModels(mistral, CAPABILITIES.VISION, config)).toEqual(['ministral-8b-2512']);
    });
});

describe('a stored document that is not what it should be', () => {
    it.each([
        ['no config', undefined],
        ['no lists', {}],
        ['lists that are not an object', { modelLists: 'gemini-3.6-flash' }],
        ['a lane that is not an object', { modelLists: { vision: ['gemini-3.6-flash'] } }],
        ['models that are not a list', { modelLists: { vision: { models: 'gemini-3.6-flash', seed: GEMINI_VISION } } }],
        ['an empty list', { modelLists: { vision: { models: [], seed: GEMINI_VISION } } }],
        ['nothing shaped like a model id', { modelLists: { vision: { models: [42, null, '', '  ', 'two words', '../etc'], seed: GEMINI_VISION } } }],
        ['a seed that is not a list', { modelLists: { vision: { models: ['gemini-3.7-flash'], seed: GEMINI_VISION.join(',') } } }],
    ])('reads %s as nothing saved, so the built-in list applies', (_label, config) => {
        expect(savedModels(config, CAPABILITIES.VISION, GEMINI_VISION)).toBeNull();
        expect(resolveModels(gemini, CAPABILITIES.VISION, config)).toEqual(GEMINI_VISION);
    });

    it('keeps the usable ids, once each, trimmed, and no more than a lane holds', () => {
        const list = ['  gemini-3.6-flash ', 'gemini-3.6-flash', 'bad id', 'gemini-3.5-flash-lite', '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            'openai/gpt-oss-120b:fastest'];
        expect(sanitizeModelList(list)).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash-lite', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
        expect(sanitizeModelList(list)).toHaveLength(MAX_VERSIONS_PER_LANE);
    });

    it('refuses an id too long to be a model id', () => {
        expect(sanitizeModelList([`a${'b'.repeat(128)}`])).toEqual([]);
    });
});

describe('a list saved against other built-in versions', () => {
    // A release that re-pins a lane is used at once, not after the next check
    // has found the old versions failing.
    it.each([
        ['other versions', ['gemini-3.5-flash', 'gemini-3.5-flash-lite']],
        ['the same versions in another order', [...GEMINI_VISION].reverse()],
        ['nothing, as lists saved before they recorded it', undefined],
    ])('gives way to the release\'s own list when it was checked against %s', (_label, seed) => {
        const config = { modelLists: { vision: { models: ['gemini-3.7-flash'], seed } } };
        expect(resolveModels(gemini, CAPABILITIES.VISION, config)).toEqual(GEMINI_VISION);
    });

    it('applies while the release still ships the list it was checked against', () => {
        const config = { modelLists: { vision: { models: ['gemini-3.7-flash'], seed: [...GEMINI_VISION] } } };
        expect(resolveModels(gemini, CAPABILITIES.VISION, config)).toEqual(['gemini-3.7-flash']);
    });
});
