/**
 * The daily model check for one provider: the list rules, and the walk that
 * feeds them.
 */

const { decideLane, checkProvider, MAX_TESTS_PER_PROVIDER } = require('../../ai/tasks/modelCheck');
const { RESULT } = require('../../ai/tasks/modelVerification');
const { requireProvider, builtInModels } = require('../../ai/registry/providers');
const { CAPABILITIES } = require('../../ai/registry/capabilities');

const results = (entries) => new Map(Object.entries(entries).map(([model, result]) => [model, { model, result }]));

describe('decideLane', () => {
    it('keeps a lane whose versions all pass exactly as it is', () => {
        expect(decideLane({ current: ['a', 'b'], checked: results({ a: RESULT.PASSED, b: RESULT.PASSED }), additions: [] }))
            .toEqual({ models: ['a', 'b'], dropped: [], added: [], status: 'ok', changed: false });
    });

    it.each([
        ['gone', RESULT.GONE],
        ['misread', RESULT.MISREAD],
        ['refused', RESULT.REFUSED],
    ])('drops a version that is %s, and keeps the order of the rest', (_label, result) => {
        expect(decideLane({ current: ['a', 'b', 'c'], checked: results({ a: RESULT.PASSED, b: result, c: RESULT.PASSED }), additions: [] }))
            .toMatchObject({ models: ['a', 'c'], dropped: [{ model: 'b', result }], status: 'ok', changed: true });
    });

    it.each([
        ['busy', RESULT.BUSY],
        ['a refused key', RESULT.KEY],
        ['a spent allowance', RESULT.QUOTA],
        ['an unexpected error', RESULT.ERROR],
    ])('keeps a version in place when the vendor was %s: that says nothing about the version', (_label, result) => {
        expect(decideLane({ current: ['a', 'b'], checked: results({ a: result, b: RESULT.PASSED }), additions: [] }))
            .toMatchObject({ models: ['a', 'b'], dropped: [], status: 'ok', changed: false });
    });

    it('adds passing candidates after the versions that stay, up to three', () => {
        expect(decideLane({ current: ['a', 'b'], checked: results({ a: RESULT.PASSED, b: RESULT.GONE }), additions: ['x', 'y', 'z'] }))
            .toMatchObject({ models: ['a', 'x', 'y'], dropped: [{ model: 'b' }], added: ['x', 'y'], status: 'ok', changed: true });
    });

    it('replaces a lane whose every version is gone with the ones that passed', () => {
        expect(decideLane({ current: ['a'], checked: results({ a: RESULT.GONE }), additions: ['x'] }))
            .toMatchObject({ models: ['x'], added: ['x'], status: 'ok', changed: true });
    });

    it('never empties a lane: with nothing passing, the list stays and the lane is failing', () => {
        expect(decideLane({ current: ['a', 'b'], checked: results({ a: RESULT.GONE, b: RESULT.MISREAD }), additions: [] }))
            .toEqual({ models: ['a', 'b'], dropped: [], added: [], status: 'failing', changed: false });
    });

    it('calls a lane unknown when nothing passed but nothing was disqualified either', () => {
        expect(decideLane({ current: ['a'], checked: results({ a: RESULT.BUSY }), additions: [] }))
            .toMatchObject({ models: ['a'], status: 'unknown', changed: false });
        // Untested for lack of time: kept, and unknown.
        expect(decideLane({ current: ['a'], checked: new Map(), additions: [] })).toMatchObject({ status: 'unknown' });
    });
});

describe('checkProvider', () => {
    const gemini = requireProvider('gemini');
    const catalogue = (ids) => jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ models: ids.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) }),
    }));
    const run = (deps, config = {}) => checkProvider({
        provider: gemini, config, credentials: { values: { apiKey: 'k' } }, deadlineAt: Date.now() + 60000,
        deps: { sleep: async () => {}, ...deps },
    });
    const script = (byModel) => jest.fn(async ({ lane, model }) => ({ model, result: byModel[`${lane}/${model}`] || byModel[model] || RESULT.PASSED }));

    it('tests the lane\'s versions, then candidates while there is room, and decides each lane', async () => {
        const verify = script({});
        const out = await run({
            verify,
            fetchImpl: catalogue(['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-pro', 'gemini-2.5-flash-preview']),
        });

        expect(out.catalogue).toBe('ok');
        expect(out.lanes.vision).toMatchObject({
            models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash'], added: ['gemini-3.7-flash'], status: 'ok', changed: true,
        });
        // Pro and previews are never candidates.
        expect(verify.mock.calls.map(([call]) => call.model)).not.toContain('gemini-3.6-pro');
        expect(verify.mock.calls.map(([call]) => call.model)).not.toContain('gemini-2.5-flash-preview');
    });

    it('drops a version the catalogue no longer lists without spending a test on it', async () => {
        const verify = script({});
        const out = await run({ verify, fetchImpl: catalogue(['gemini-3.6-flash']) });

        expect(out.lanes.vision).toMatchObject({ models: ['gemini-3.6-flash'], dropped: [{ model: 'gemini-3.5-flash-lite', result: RESULT.GONE }] });
        expect(verify.mock.calls.map(([call]) => `${call.lane}/${call.model}`)).not.toContain('vision/gemini-3.5-flash-lite');
    });

    it('stops at a refused key, and reports it for the account', async () => {
        const verify = script({ 'gemini-3.6-flash': RESULT.KEY });
        const out = await run({ verify, fetchImpl: catalogue(['gemini-3.6-flash', 'gemini-3.5-flash-lite']) });

        expect(out.account).toBe(RESULT.KEY);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(out.lanes.vision.changed).toBe(false);
    });

    it('reports a catalogue that refuses the key without testing anything', async () => {
        const verify = script({});
        const out = await run({ verify, fetchImpl: jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) });

        expect(out).toEqual({ catalogue: 'unauthorized', account: RESULT.KEY, lanes: {} });
        expect(verify).not.toHaveBeenCalled();
    });

    it('still tests the lane\'s own versions when the catalogue cannot be read, and adds nothing', async () => {
        const verify = script({});
        const out = await run({ verify, fetchImpl: jest.fn(async () => { throw new Error('offline'); }) });

        expect(out.catalogue).toBe('unreachable');
        expect(out.lanes.vision).toMatchObject({ models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'], changed: false, status: 'ok' });
    });

    it('spends at most its budget of tests', async () => {
        const verify = script({ 'gemini-3.6-flash': RESULT.GONE, 'gemini-3.5-flash-lite': RESULT.GONE });
        const many = Array.from({ length: 20 }, (_, index) => `gemini-4.${index}-flash`);
        await run({ verify, fetchImpl: catalogue(['gemini-3.6-flash', 'gemini-3.5-flash-lite', ...many]) });

        expect(verify.mock.calls.length).toBeLessThanOrEqual(MAX_TESTS_PER_PROVIDER);
    });

    it('starts no test after its deadline', async () => {
        const verify = script({});
        await checkProvider({
            provider: gemini, config: {}, credentials: { values: { apiKey: 'k' } }, deadlineAt: Date.now() - 1,
            deps: { verify, sleep: async () => {}, fetchImpl: catalogue(['gemini-3.6-flash']) },
        });
        expect(verify).not.toHaveBeenCalled();
    });

    it('checks the versions a lane really uses: the saved list, when there is one', async () => {
        const verify = script({});
        const seed = builtInModels(gemini, CAPABILITIES.VISION);
        const out = await run({ verify, fetchImpl: catalogue(['gemini-3.7-flash']) }, { modelLists: { vision: { models: ['gemini-3.7-flash'], seed } } });

        expect(out.lanes.vision.previous).toEqual(['gemini-3.7-flash']);
        // What it saves is still measured against the release's list, not the saved one.
        expect(out.lanes.vision.seed).toEqual(seed);
    });

    it('says which built-in list each lane was checked against, for the list it saves', async () => {
        const verify = script({});
        // Saved against versions this release no longer ships: the check starts from the release's own.
        const config = { modelLists: { vision: { models: ['gemini-3.7-flash'], seed: ['gemini-3.5-flash'] } } };
        const out = await run({ verify, fetchImpl: catalogue(['gemini-3.6-flash', 'gemini-3.5-flash-lite']) }, config);

        expect(out.lanes.vision.previous).toEqual(builtInModels(gemini, CAPABILITIES.VISION));
        expect(out.lanes.vision.seed).toEqual(builtInModels(gemini, CAPABILITIES.VISION));
        expect(out.lanes.text.seed).toEqual(builtInModels(gemini, CAPABILITIES.STRUCTURED_JSON));
    });

    it('leaves a lane an operator chose by hand alone', async () => {
        const openrouter = requireProvider('openrouter');
        const verify = script({});
        const out = await checkProvider({
            provider: openrouter, config: { textModel: 'my-org/my-model' }, credentials: { values: { apiKey: 'k' } },
            deadlineAt: Date.now() + 60000,
            deps: { verify, sleep: async () => {}, fetchImpl: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })) },
        });

        expect(out.lanes.text).toMatchObject({ status: 'skipped', reason: 'operator', models: ['my-org/my-model'] });
        expect(verify.mock.calls.map(([call]) => call.lane)).not.toContain('text');
    });
});
