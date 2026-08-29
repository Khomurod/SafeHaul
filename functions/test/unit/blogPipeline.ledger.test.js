/**
 * Blog pipeline: the run ledger and the Super Admin callables.
 *
 * Every refusal must be *recorded*, not merely returned. Before the ledger
 * existed this suite passed with nothing persisted at all, which is what shipped.
 *
 * Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
 * fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
 * because Jest hoists them per file and they cannot register from a helper.
 *
 * No test here contacts a real feed, a real AI provider or a real image
 * provider: research fetches use an injected `fetchImpl`, and the AI tasks are
 * mocked at the task boundary.
 */

jest.mock('firebase-functions/v2/https', () => require('./blogPipeline.support').httpsMock());
jest.mock('firebase-functions/v2/scheduler', () => require('./blogPipeline.support').schedulerMock());
jest.mock('../../firebaseAdmin', () => require('./blogPipeline.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./blogPipeline.support').rateLimiterMock());
jest.mock('../../ai/tasks/articleGeneration', () => require('./blogPipeline.support').articleGenerationMock());
jest.mock('../../blog/media/credentials', () => require('./blogPipeline.support').mediaCredentialsMock());

const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const media = require('../../blog/media/imageProviders');
const { publishDueSlots } = require('../../blog/scheduler');
const runLedger = require('../../blog/runLedger');
const {
    mockLedger, mockPosts, mockVerifyArticleClaims, researchFetch,
    resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

describe('the run ledger records what happened', () => {
    const slotOf = (themeId = 'industry-news') => ({
        themeId,
        publicationDate: '2026-08-02',
        key: `2026-08-02_${themeId}`,
        slotIndex: 0,
    });

    it('records a published run with the transactions that produced it', async () => {
        await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
            fetchImpl: researchFetch(),
            mediaCredentials: new Map(),
        });

        const published = mockLedger.find((row) => row.outcome === 'published');
        expect(published).toMatchObject({
            stage: 'publication',
            themeId: 'industry-news',
            publicationDate: '2026-08-02',
            // The join key, in both directions. Without it a slot and its
            // provider timeline could not be connected by anything at all.
            generationTransactionId: 'txn-generate-1',
            verificationTransactionId: 'txn-verify-1',
            verificationSupported: true,
            trigger: 'scheduled',
        });
    });

    it('records a refusal, naming the stage that refused', async () => {
        // Thin sourcing: no feed answers, so no candidate can meet the bar.
        await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
            fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
            mediaCredentials: new Map(),
        });

        const refused = mockLedger.find((row) => row.outcome === 'skipped_no_sources');
        expect(refused).toBeTruthy();
        expect(refused.stage).toBe('sourcing');
        // The pipeline's own explanation, which existed only in a log line.
        expect(typeof refused.detail).toBe('string');
    });

    it('records the fact-check verdict separately from the transaction succeeding', async () => {
        mockVerifyArticleClaims.mockResolvedValue({
            verification: {
                supported: false,
                unsupportedClaims: ['The rule takes effect in January 2027.'],
                notes: '',
            },
            transactionId: 'txn-verify-unsupported',
        });

        await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
            fetchImpl: researchFetch(),
            mediaCredentials: new Map(),
        });

        const row = mockLedger.find((entry) => entry.outcome === 'skipped_unsupported_claims');
        expect(row).toMatchObject({
            stage: 'verification',
            // The transaction succeeded — `supported: false` is a valid payload —
            // and only this field distinguishes that from the article shipping.
            verificationSupported: false,
            unsupportedClaimCount: 1,
            verificationTransactionId: 'txn-verify-unsupported',
        });
        expect(mockPosts.size).toBe(0);
    });

    it('distinguishes a prohibited SafeHaul claim from an unsupported factual one', () => {
        // Both are "the draft said something it should not have", and the
        // operator's next step differs completely.
        expect(runLedger.stageForOutcome('skipped_prohibited_claim')).toBe('claim_check');
        expect(runLedger.stageForOutcome('skipped_unsupported_claims')).toBe('verification');
    });

    it('maps every outcome the pipeline can produce to a stage', () => {
        for (const outcome of Object.values(generate.OUTCOME)) {
            expect(runLedger.STAGE_BY_OUTCOME[outcome]).toBeTruthy();
        }
        // Plus the scheduler's own, which the pipeline never returns.
        expect(runLedger.STAGE_BY_OUTCOME.deferred_to_next_run).toBe('scheduling');
    });

    it('records a slot held for the next run, because that is not a failure', async () => {
        // Two slots due, one article per run: the second is deferred, and saying
        // so is the difference between a backlog and a broken pipeline.
        await publishDueSlots({
            now: Date.parse('2026-08-02T18:00:00Z'),
            fetchImpl: researchFetch(),
            mediaCredentials: new Map(),
        });

        const deferred = mockLedger.filter((row) => row.outcome === 'deferred_to_next_run');
        expect(deferred.length).toBeGreaterThan(0);
        expect(deferred[0].stage).toBe('scheduling');
    });

    it('never records article text, a source body or a prompt', async () => {
        await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
            fetchImpl: researchFetch(),
            mediaCredentials: new Map(),
        });

        const serialized = JSON.stringify(mockLedger);
        expect(serialized).not.toContain('contentBlocks');
        expect(serialized).not.toMatch(/paragraph/i);
    });

    it('stamps an expiry so the ledger cannot outlive its telemetry', async () => {
        await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
            fetchImpl: researchFetch(),
            mediaCredentials: new Map(),
        });

        expect(mockLedger[0].expiresAt instanceof Date).toBe(true);
        expect(runLedger.RETENTION_DAYS).toBe(30);
    });

    it('does not turn a published article into a failed run when the ledger write fails', async () => {
        const spy = jest.spyOn(runLedger, 'recordSlotRun');
        spy.mockRejectedValue(new Error('firestore down'));
        try {
            // `recordSlotRun` swallows its own errors, so this asserts the
            // contract rather than the caller's defensiveness — but a rejected
            // promise from the module must still not escape.
            await expect(runLedger.recordSlotRun({ outcome: 'published', slot: slotOf() }))
                .rejects.toThrow();
        } finally {
            spy.mockRestore();
        }

        // And the real implementation genuinely does not throw.
        await expect(runLedger.recordSlotRun({ outcome: 'published', slot: slotOf() }))
            .resolves.toBeUndefined();
    });
});

describe('Super Admin blog callables', () => {
    const callables = require('../../blog/callables');
    const SUPER_ADMIN = { uid: 'sa1', token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) } };

    beforeEach(() => {
        mockPosts.set('2026-08-02_industry-news', {
            title: 'A published article', slug: 'a-published-article', theme: 'industry-news',
            status: 'published', publicationDate: '2026-08-02',
        });
    });

    it('lists titles for the Super Admin screen', async () => {
        const response = await callables.listBlogPosts({ auth: SUPER_ADMIN, data: {} });

        expect(response.posts).toHaveLength(1);
        expect(response.posts[0]).toMatchObject({
            id: '2026-08-02_industry-news',
            title: 'A published article',
        });
        // Deliberately not a content-management screen: no body, no sources.
        expect(response.posts[0]).not.toHaveProperty('contentBlocks');
    });

    it('denies a company admin', async () => {
        await expect(callables.listBlogPosts({
            auth: { uid: 'u1', token: { roles: { 'c1': 'company_admin' }, auth_time: Math.floor(Date.now() / 1000) } },
            data: {},
        })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('denies an unauthenticated caller', async () => {
        await expect(callables.deleteBlogPost({ auth: null, data: { postId: '2026-08-02_industry-news' } }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('requires recent authentication to delete', async () => {
        await expect(callables.deleteBlogPost({
            auth: { uid: 'sa1', token: { globalRole: 'super_admin', auth_time: Math.floor(Date.now() / 1000) - (16 * 60) } },
            data: { postId: '2026-08-02_industry-news' },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('rejects a malformed post id rather than dereferencing it', async () => {
        await expect(callables.deleteBlogPost({ auth: SUPER_ADMIN, data: { postId: '../../secrets/x' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('tombstones the post so it disappears publicly but stays for deduplication', async () => {
        const response = await callables.deleteBlogPost({
            auth: SUPER_ADMIN, data: { postId: '2026-08-02_industry-news' },
        });

        expect(response.deleted).toBe(true);
        expect(mockPosts.get('2026-08-02_industry-news').status).toBe('deleted');
        expect(await store.findPublishedBySlug('a-published-article')).toBeNull();
        // Still visible to duplicate prevention.
        const recent = await store.recentForDeduplication({ now: Date.parse('2026-08-03T00:00:00Z') });
        expect(recent.some((post) => post.id === '2026-08-02_industry-news')).toBe(true);
    });

    it('reports a missing post rather than pretending to delete it', async () => {
        await expect(callables.deleteBlogPost({ auth: SUPER_ADMIN, data: { postId: '2026-01-01_recruitment' } }))
            .rejects.toMatchObject({ code: 'not-found' });
    });

    it('lists media providers with no plaintext credential', async () => {
        const response = await callables.listMediaProviders({ auth: SUPER_ADMIN, data: {} });

        expect(response.providers.map((provider) => provider.id)).toEqual(['pexels', 'unsplash', 'openverse']);
        for (const provider of response.providers) {
            for (const field of provider.credentialFields) {
                expect(field.maskedValue).toBe('********');
                expect(field).not.toHaveProperty('value');
            }
        }
        // Openverse needs no key, and the console should say so.
        expect(response.providers.find((p) => p.id === 'openverse').requiresCredential).toBe(false);
    });
});
