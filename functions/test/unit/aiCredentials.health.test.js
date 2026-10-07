/**
 * What an unreadable credential means, how a quota cooldown is sized, and how
 * health is tracked per lane.
 *
 * Part of the `aiCredentials` suite. The Firestore double, the fake Secret
 * Manager, the fixtures and the reset are in `aiCredentials.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */

jest.mock('firebase-functions/v2/https', () => require('./aiCredentials.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./aiCredentials.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./aiCredentials.support').rateLimiterMock());
jest.mock('../../ai/tasks/healthCheck', () => require('./aiCredentials.support').healthCheckMock());
jest.mock('@google-cloud/secret-manager', () => require('./aiCredentials.support').secretManagerMock());

const secretManager = require('../../ai/credentials/secretManager');
const store = require('../../ai/credentials/store');
// The mocked module, so this is the very `jest.fn()` the support file owns.
const { resetCredentialState } = require('./aiCredentials.support');

beforeEach(resetCredentialState);

/**
 * A credential that cannot be READ is a different fact from one that is absent,
 * and conflating them is what produced the reported symptom: "CDL scanning fails
 * with Not configured even though providers and credentials exist."
 *
 * `readSecret` returns null only for NOT_FOUND and re-throws everything else, so
 * `PERMISSION_DENIED` — a runtime service account without
 * `roles/secretmanager.secretAccessor` — is the case these tests pin.
 */
describe('an unreadable credential is not an absent one', () => {
    const original = process.env.GROQ_API_KEY;

    /** A Secret Manager that exists, holds the secret, and refuses to serve it. */
    const denyingClient = {
        accessSecretVersion: async () => {
            const error = new Error('7 PERMISSION_DENIED: Permission denied on resource');
            error.code = 7;
            throw error;
        },
    };

    beforeEach(() => {
        // Reads are cached for 60 seconds; an earlier test's success would
        // otherwise answer before the denying client is ever consulted.
        secretManager.clearCache();
    });

    afterAll(() => {
        secretManager.clearCache();
        if (original === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = original;
    });

    it('reports the field as unreadable rather than missing', async () => {
        const read = await store.readCredentials('gemini', { client: denyingClient });

        expect(read.complete).toBe(false);
        expect(read.unreadable).toEqual(['apiKey']);
        // The distinction the console depends on: nothing is *missing*, so
        // telling an operator to add a key would be wrong.
        expect(read.missing).toEqual([]);
    });

    it('does not throw, so the router can still try the next provider', async () => {
        await expect(store.readCredentials('gemini', { client: denyingClient }))
            .resolves.toMatchObject({ complete: false });
    });

    /**
     * The defect this whole stage exists for. The Groq fallback triggered on
     * `missing` alone, and a refused read throws before a field is ever recorded
     * as missing — so the deploy binding sat there, working, and was never
     * consulted. A rollback path that only survives the rarer of two faults is
     * not a rollback path.
     */
    it('falls back to the legacy Groq binding when the managed read is refused', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('groq', { client: denyingClient });

        expect(resolved.complete).toBe(true);
        expect(resolved.values.apiKey).toBe('legacy-key');
        // Distinguished from a plain `legacy-env` so the console can say this is
        // a fault being masked, not a migration state to leave alone.
        expect(resolved.source).toBe('legacy-env-after-read-failure');
    });

    it('still refuses to extend that fallback to another provider', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const resolved = await store.resolveCredentials('mistral', { client: denyingClient });

        expect(resolved.complete).toBe(false);
        expect(resolved.source).toBeNull();
        expect(resolved.unreadable).toEqual(['apiKey']);
    });

    it('lets an operator still reveal the legacy value when the managed read fails', async () => {
        process.env.GROQ_API_KEY = 'legacy-key';

        const revealed = await store.revealCredential('groq', 'apiKey', { client: denyingClient });

        expect(revealed.value).toBe('legacy-key');
        expect(revealed.source).toBe('legacy-env-after-read-failure');
    });

    it('never puts the Secret Manager resource name in what it returns', async () => {
        const read = await store.readCredentials('gemini', { client: denyingClient });

        expect(JSON.stringify(read)).not.toMatch(/PERMISSION_DENIED/);
        expect(JSON.stringify(read)).not.toMatch(/projects\//);
    });
});

/**
 * A flat 30-minute quota cooldown is the right answer for a spent daily
 * allowance and badly the wrong one for a per-minute cap. Measured live: the
 * Gemini free tier allows 20 requests per minute and its 429 body says "Please
 * retry in 44.26781542s" — so resting it for half an hour removed the
 * highest-priority provider from every lane for forty times longer than the
 * vendor asked.
 */
describe('quota cooldown sizing', () => {
    it('rests for the vendor stated wait plus a small buffer', () => {
        expect(store.quotaCooldownMs(44268)).toBe(44268 + store.QUOTA_COOLDOWN_BUFFER_MS);
    });

    it('keeps the flat window when the vendor stated nothing', () => {
        expect(store.quotaCooldownMs(null)).toBe(store.QUOTA_COOLDOWN_MS);
        expect(store.quotaCooldownMs(undefined)).toBe(store.QUOTA_COOLDOWN_MS);
        expect(store.quotaCooldownMs(0)).toBe(store.QUOTA_COOLDOWN_MS);
    });

    it('never rests longer than the flat window, however long the vendor claims', () => {
        expect(store.quotaCooldownMs(6 * 60 * 60 * 1000)).toBe(store.QUOTA_COOLDOWN_MS);
    });

    it('never rests for an unusably short moment', () => {
        expect(store.quotaCooldownMs(1)).toBe(store.QUOTA_COOLDOWN_FLOOR_MS);
    });
});

describe('cooldown', () => {
    it('reports no cooldown for a healthy provider', () => {
        expect(store.cooldownState({}).active).toBe(false);
    });

    it('reports an active cooldown until it expires', () => {
        const future = { cooldownUntil: Date.now() + 60000, cooldownReason: 'quota' };
        expect(store.cooldownState(future)).toMatchObject({ active: true, reason: 'quota' });

        const past = { cooldownUntil: Date.now() - 1, cooldownReason: 'quota' };
        expect(store.cooldownState(past).active).toBe(false);
    });

    it('gives an exhausted quota a longer rest than an ordinary failure', () => {
        expect(store.QUOTA_COOLDOWN_MS).toBeGreaterThan(store.FAILURE_COOLDOWN_MS);
    });
});

/**
 * A provider's text lane and its image lane reach different models, in different
 * request shapes, on different vendor entitlements. They fail independently, and
 * one health scalar could describe neither:
 *
 *  - any success set `health: 'healthy'`, so blog articles generating normally
 *    kept resetting the badge while every CDL photograph was being rejected;
 *  - the failure counter was shared, so three rejected images cooled the provider
 *    out of the *text* lane too.
 */
describe('health and cooldown are tracked per lane', () => {
    async function fail(providerId, lane, category = 'provider_request_rejected') {
        await store.recordProviderOutcome(providerId, { success: false, lane, category });
    }

    it('does not let a text success hide a broken vision lane', async () => {
        await fail('gemini', 'vision');
        await store.recordProviderOutcome('gemini', { success: true, lane: 'text' });

        const config = await store.readConfig('gemini');

        expect(config.laneHealth).toMatchObject({ vision: 'degraded', text: 'healthy' });
        // The summary scalar reports the worst lane, so the console cannot show
        // a green badge for a provider with a broken capability.
        expect(config.health).toBe('degraded');
    });

    it('counts failures per lane rather than in one shared tally', async () => {
        await fail('mistral', 'vision');
        await fail('mistral', 'vision');
        await fail('mistral', 'text');

        const config = await store.readConfig('mistral');

        expect(config.laneFailures).toMatchObject({ vision: 2, text: 1 });
    });

    it('cools only the failing lane, leaving the working one routable', async () => {
        await fail('groq', 'vision');
        await fail('groq', 'vision');
        await fail('groq', 'vision');

        const config = await store.readConfig('groq');

        expect(store.cooldownState(config, Date.now(), 'vision').active).toBe(true);
        // The whole point: three rejected images must not stop this provider
        // writing an article.
        expect(store.cooldownState(config, Date.now(), 'text').active).toBe(false);
        // With no lane the console still sees that something is resting.
        expect(store.cooldownState(config, Date.now()).active).toBe(true);
    });

    it('keeps a quota cooldown provider-wide, because an allowance is not per lane', async () => {
        await store.recordProviderOutcome('cerebras', {
            success: false, lane: 'text', category: 'rate_limited',
        });

        const config = await store.readConfig('cerebras');

        expect(store.cooldownState(config, Date.now(), 'text').active).toBe(true);
        expect(store.cooldownState(config, Date.now(), 'vision').active).toBe(true);
        expect(config.laneHealth.text).toBe('quota');
    });

    it('clears every lane when an operator clears the cooldown', async () => {
        await fail('sambanova', 'vision');
        await fail('sambanova', 'vision');
        await fail('sambanova', 'vision');
        await store.clearCooldown('sambanova');

        const config = await store.readConfig('sambanova');

        expect(store.cooldownState(config, Date.now()).active).toBe(false);
    });

    it('clears every version rest with the cooldown, too', async () => {
        await store.recordProviderOutcome('mistral', {
            success: true, lane: 'vision', versionRests: [{ model: 'ministral-14b-2512', until: Date.now() + 60000, reason: 'removed' }],
        });
        await store.clearCooldown('mistral');

        const config = await store.readConfig('mistral');

        expect(config.versionRest).toBeUndefined();
        expect(store.restingModels(config, 'vision').size).toBe(0);
    });

    it('records when a lane\'s run of failures began, and keeps it while the run lasts', async () => {
        const clock = jest.spyOn(Date, 'now');
        clock.mockReturnValue(1000);
        await fail('gemini', 'vision');
        clock.mockReturnValue(2000);
        await fail('gemini', 'vision');
        await fail('gemini', 'text');
        expect((await store.readConfig('gemini')).laneFailedAt).toEqual({ vision: 1000, text: 2000 });

        // A success ends the run; the next failure begins a new one.
        clock.mockReturnValue(3000);
        await store.recordProviderOutcome('gemini', { success: true, lane: 'vision' });
        clock.mockReturnValue(4000);
        await fail('gemini', 'vision');
        expect((await store.readConfig('gemini')).laneFailedAt).toEqual({ vision: 4000, text: 2000 });
        clock.mockRestore();
    });

    it('reports the worst lane, and unknown when nothing has been recorded', () => {
        expect(store.worstLaneHealth({ text: 'healthy', vision: 'quota' })).toBe('quota');
        expect(store.worstLaneHealth({ text: 'healthy', vision: 'degraded' })).toBe('degraded');
        expect(store.worstLaneHealth({ text: 'healthy' })).toBe('healthy');
        expect(store.worstLaneHealth({})).toBe('unknown');
        expect(store.worstLaneHealth(undefined)).toBe('unknown');
    });
});

/**
 * A failed model version rests in the lane it failed in, recorded with the
 * provider's one outcome write for the turn.
 */
describe('version rests', () => {
    const until = () => Date.now() + 60000;

    it('stores each rest under a safe key, with its model and lane', async () => {
        await store.recordProviderOutcome('groq', {
            success: false, lane: 'text', category: 'rate_limited',
            versionRests: [{ model: 'openai/gpt-oss-20b', until: until(), reason: 'rate_limited' }],
        });

        const config = await store.readConfig('groq');
        const [key] = Object.keys(config.versionRest);

        // A slash or a dot in a model id never becomes part of a field path.
        expect(key).toMatch(/^text_[a-f0-9]{16}$/);
        expect(key).toBe(store.versionRestKey('text', 'openai/gpt-oss-20b'));
        expect(config.versionRest[key]).toMatchObject({ model: 'openai/gpt-oss-20b', lane: 'text', reason: 'rate_limited' });
        expect([...store.restingModels(config, 'text').keys()]).toEqual(['openai/gpt-oss-20b']);
    });

    it('adds a rest beside the ones already stored rather than replacing them', async () => {
        const rest = (model) => ({ success: false, lane: 'vision', category: 'model_unavailable', versionRests: [{ model, until: until(), reason: 'removed' }] });
        await store.recordProviderOutcome('cloudflare', rest('first-version'));
        await store.recordProviderOutcome('cloudflare', rest('second-version'));

        const config = await store.readConfig('cloudflare');

        expect([...store.restingModels(config, 'vision').keys()].sort()).toEqual(['first-version', 'second-version']);
    });

    it('writes nothing to the rests when a turn found none', async () => {
        await store.recordProviderOutcome('openrouter', {
            success: false, lane: 'vision', category: 'model_unavailable', versionRests: [{ model: 'kept', until: until(), reason: 'removed' }],
        });
        await store.recordProviderOutcome('openrouter', { success: true, lane: 'text' });

        const config = await store.readConfig('openrouter');

        expect([...store.restingModels(config, 'vision').keys()]).toEqual(['kept']);
    });

    it('clears a version\'s rest when it answers, and only that one', async () => {
        await store.recordProviderOutcome('huggingface', {
            success: false, lane: 'vision', category: 'model_unavailable',
            versionRests: [
                { model: 'answered-later', until: until(), reason: 'removed' },
                { model: 'still-gone', until: until(), reason: 'removed' },
            ],
        });
        await store.recordProviderOutcome('huggingface', { success: true, lane: 'vision', clearRestFor: 'answered-later' });

        const config = await store.readConfig('huggingface');

        expect([...store.restingModels(config, 'vision').keys()]).toEqual(['still-gone']);
        expect(store.hasVersionRest(config, 'vision', 'answered-later')).toBe(false);
    });

    it('reads a rest only in its own lane, and only until it ends', () => {
        const config = {
            versionRest: {
                a: { model: 'photo-only', lane: 'vision', until: Date.now() + 60000 },
                b: { model: 'over', lane: 'vision', until: Date.now() - 1 },
            },
        };

        expect([...store.restingModels(config, 'vision').keys()]).toEqual(['photo-only']);
        expect(store.restingModels(config, 'text').size).toBe(0);
        expect(store.restingModels({}, 'vision').size).toBe(0);
    });
});
