/**
 * Blog pipeline: sourcing requirements and claim verification.
 *
 * What an article must cite, and what it may not assert. Claims are checked
 * against the verified capability package, not against the model's confidence.
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

const themes = require('../../blog/pipeline/themes');
const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const knowledge = require('../../ai/knowledge/safehaulCapabilities');
const research = require('../../blog/research/fetchSources');
const {
    draftArticle, mockGenerateArticle, mockPosts, mockVerifyArticleClaims,
    researchFetch, resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

describe('sourcing requirements', () => {
    it('requires an official source for a regulatory article', () => {
        const theme = themes.getTheme('industry-news');
        expect(theme.requiresPrimarySource).toBe(true);

        const secondaryOnly = [
            { sourceId: 'ttnews', url: 'https://ttnews.com/a' },
            { sourceId: 'freightwaves', url: 'https://freightwaves.com/b' },
        ];
        expect(generate.sourcingIsSufficient(secondaryOnly, theme).ok).toBe(false);

        const withPrimary = [{ sourceId: 'federal-register-fmcsa', url: 'https://federalregister.gov/a' }, ...secondaryOnly];
        expect(generate.sourcingIsSufficient(withPrimary, theme).ok).toBe(true);
    });

    it('requires corroboration for a news article where practical', () => {
        const theme = themes.getTheme('industry-news');
        expect(theme.minSources).toBe(2);

        // A single trade report is not enough.
        expect(generate.sourcingIsSufficient([{ sourceId: 'ttnews' }], theme).ok).toBe(false);
        // Two are.
        expect(generate.sourcingIsSufficient(
            [{ sourceId: 'federal-register-fmcsa' }, { sourceId: 'ttnews' }], theme,
        ).ok).toBe(true);
        // And a lone official source already satisfies the intent: an article
        // written from the rule itself is better evidenced than one written
        // from two summaries of it.
        expect(generate.sourcingIsSufficient([{ sourceId: 'federal-register-fmcsa' }], theme).ok).toBe(true);
        expect(generate.sourcingIsSufficient([], theme).ok).toBe(false);
    });

    it('publishes nothing when no current item matches the theme', async () => {
        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            {
                store,
                // Every source unreachable.
                fetchImpl: async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) }),
                now: Date.parse('2026-08-02T13:00:00Z'),
            },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_NO_SOURCES);
        expect(mockPosts.size).toBe(0);
    });

    it('saves the title, publisher, URL and date of every source', async () => {
        await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        const post = mockPosts.get('2026-08-02_industry-news');
        expect(post.sources.length).toBeGreaterThan(0);
        for (const source of post.sources) {
            expect(typeof source.title).toBe('string');
            expect(typeof source.publisher).toBe('string');
            expect(source.url).toMatch(/^https?:\/\//);
            expect(source).toHaveProperty('publishedAt');
        }
    });

    it('lists only official feeds and public APIs as sources', () => {
        const { SOURCES } = require('../../blog/research/sources');
        for (const source of SOURCES) {
            expect(['rss', 'atom', 'json_api']).toContain(source.kind);
            expect(source.url).toMatch(/^https:\/\//);
            expect(typeof source.licenceNote).toBe('string');
        }
        expect(SOURCES.some((source) => source.tier === 'primary')).toBe(true);
    });

    it('identifies SafeHaul in its research requests', async () => {
        const calls = [];
        await research.fetchSource(
            { id: 'fmcsa-newsroom', url: 'https://example.gov/feed', kind: 'rss' },
            {
                fetchImpl: async (url, options) => {
                    calls.push(options.headers['User-Agent']);
                    return { ok: true, status: 200, text: async () => '<rss></rss>' };
                },
            },
        );
        expect(calls[0]).toMatch(/SafeHaulNewsBot/);
    });

    it('respects a publisher refusing the request rather than retrying around it', async () => {
        const result = await research.fetchSource(
            { id: 'ttnews', url: 'https://example.com/feed', kind: 'rss' },
            { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) },
        );
        expect(result.items).toEqual([]);
        expect(result.error).toBe('http-403');
    });
});

describe('claim verification against the knowledge package', () => {
    it('rejects an article claiming a feature SafeHaul does not have', async () => {
        mockGenerateArticle.mockResolvedValue({
            article: draftArticle({
                blocks: [
                    ...draftArticle().blocks,
                    { type: 'paragraph', text: 'SafeHaul sends automated expiry reminders for every driver document, so nothing lapses.' },
                ],
            }),
            providerId: 'groq',
            model: 'm',
            fallbackCount: 0,
        });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_PROHIBITED_CLAIM);
        expect(mockPosts.size).toBe(0);
    });

    it('rejects a "free forever" claim, which the pricing contradicts', () => {
        expect(knowledge.checkClaims('SafeHaul is free forever for small fleets.').ok).toBe(false);
    });

    it('rejects an App Check claim, which was deliberately removed', () => {
        expect(knowledge.checkClaims('Every endpoint is protected by Firebase App Check.').ok).toBe(false);
    });

    it('rejects a claim that SafeHaul runs background checks', () => {
        expect(knowledge.checkClaims('SafeHaul runs an MVR check on every applicant.').ok).toBe(false);
    });

    it('accepts an article that only describes verified capability', () => {
        expect(knowledge.checkClaims(
            'SafeHaul stores driver documents per driver, and a completed document is sealed so later alteration is detectable.',
        ).ok).toBe(true);
    });

    it('refuses to publish when the verification step cannot run', async () => {
        mockVerifyArticleClaims.mockRejectedValue(new Error('providers down'));

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS);
        expect(mockPosts.size).toBe(0);
    });

    it('refuses to publish an article with an unsupported factual claim', async () => {
        mockVerifyArticleClaims.mockResolvedValue({
            verification: {
                supported: false,
                unsupportedClaims: ['The rule takes effect in January 2027.'],
                notes: '',
            },
            transactionId: 'txn-verify-unsupported',
        });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS);
    });

    it('records the knowledge package version on every published post', async () => {
        await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(mockPosts.get('2026-08-02_industry-news').knowledgeVersion).toBe(knowledge.KNOWLEDGE_VERSION);
    });

    it('does not offer planned or retired features as material to write from', () => {
        const briefing = knowledge.buildKnowledgeBriefing();
        const names = briefing.features.map((feature) => feature.name);

        expect(names).not.toContain('Automated document-expiry monitoring and alerts');
        expect(names).not.toContain('Telegram application intake');
        expect(briefing.doNotClaim.join(' ')).toMatch(/expiry monitoring/i);
    });
});
