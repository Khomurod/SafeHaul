/**
 * The versions the daily check saved, as the router reads them.
 *
 * Pinned: a saved lane list comes after an operator override and before the
 * built-in list; it covers photos and text but never article writing; and
 * nothing malformed in the stored document can break routing or reach a vendor.
 */

const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { MAX_VERSIONS_PER_LANE } = require('../../ai/registry/modelVersions');
const { requireProvider, resolveModels } = require('../../ai/registry/providers');
const { managedLane, sanitizeModelList, savedModels } = require('../../ai/registry/savedModels');

const mistral = requireProvider('mistral');
const gemini = requireProvider('gemini');
const saved = (vision, text) => ({
    modelLists: {
        ...(vision ? { vision: { models: vision } } : {}),
        ...(text ? { text: { models: text } } : {}),
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
        const config = saved(['ministral-8b-2512'], ['ministral-8b-2512']);
        expect(resolveModels(mistral, CAPABILITIES.ARTICLE_WRITING, config))
            .toEqual(resolveModels(mistral, CAPABILITIES.ARTICLE_WRITING, {}));
    });
});

describe('the order of precedence', () => {
    it('asks the saved versions instead of the built-in ones', () => {
        const config = saved(['ministral-8b-2512', 'mistral-small-2603'], ['ministral-3b-2512']);

        expect(resolveModels(mistral, CAPABILITIES.VISION, config)).toEqual(['ministral-8b-2512', 'mistral-small-2603']);
        expect(resolveModels(mistral, CAPABILITIES.MULTI_IMAGE, config)).toEqual(['ministral-8b-2512', 'mistral-small-2603']);
        expect(resolveModels(mistral, CAPABILITIES.STRUCTURED_JSON, config)).toEqual(['ministral-3b-2512']);
    });

    it('keeps the built-in list for a lane with nothing saved', () => {
        const config = saved(['gemini-3.5-flash-lite']);
        expect(resolveModels(gemini, CAPABILITIES.TEXT, config)).toEqual(resolveModels(gemini, CAPABILITIES.TEXT, {}));
    });

    it('lets an operator override win over a saved list', () => {
        const openrouter = requireProvider('openrouter');
        const config = { ...saved(null, ['meta-llama/llama-4-scout']), textModel: 'my-org/my-model' };
        expect(resolveModels(openrouter, CAPABILITIES.TEXT, config)).toEqual(['my-org/my-model']);
    });

    it('hands each caller its own copy', () => {
        const config = saved(['ministral-8b-2512']);
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
        ['models that are not a list', { modelLists: { vision: { models: 'gemini-3.6-flash' } } }],
        ['an empty list', { modelLists: { vision: { models: [] } } }],
        ['nothing shaped like a model id', { modelLists: { vision: { models: [42, null, '', '  ', 'two words', '../etc'] } } }],
    ])('reads %s as nothing saved, so the built-in list applies', (_label, config) => {
        expect(savedModels(config, CAPABILITIES.VISION)).toBeNull();
        expect(resolveModels(gemini, CAPABILITIES.VISION, config)).toEqual(resolveModels(gemini, CAPABILITIES.VISION, {}));
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
