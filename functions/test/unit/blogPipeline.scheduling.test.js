/**
 * Blog pipeline: scheduling, idempotency and duplicate prevention.
 *
 * The slot machinery and the two things that must never happen twice — a retry
 * republishing, and two runs producing the same article.
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
const dedupe = require('../../blog/pipeline/dedupe');
const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const { publishDueSlots } = require('../../blog/scheduler');
const {
    NEWS_ITEM, mockGenerateArticle, mockPosts, researchFetch,
    resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

describe('themes and scheduling', () => {
    it('defines exactly three themes with distinct slots', () => {
        expect(themes.THEMES).toHaveLength(3);
        expect(new Set(themes.THEMES.map((theme) => theme.id)).size).toBe(3);
        expect(new Set(themes.THEMES.map((theme) => theme.slotIndex)).size).toBe(3);
    });

    it('covers the three required subject areas', () => {
        expect(themes.THEME_IDS).toEqual(['industry-news', 'recruitment', 'safehaul-education']);
    });

    it('derives the publication date in America/Chicago, not UTC', () => {
        // 04:00 UTC on 2 August is still 23:00 on 1 August in Chicago.
        expect(themes.publicationDateFor(new Date('2026-08-02T04:00:00Z'))).toBe('2026-08-01');
        expect(themes.publicationDateFor(new Date('2026-08-02T06:00:00Z'))).toBe('2026-08-02');
    });

    it('handles the spring-forward transition without losing or duplicating a date', () => {
        // 2026-03-08 is the US spring-forward day; 02:00 local does not exist.
        const before = new Date('2026-03-08T07:30:00Z'); // 01:30 CST
        const after = new Date('2026-03-08T08:30:00Z'); // 03:30 CDT
        expect(themes.publicationDateFor(before)).toBe('2026-03-08');
        expect(themes.publicationDateFor(after)).toBe('2026-03-08');
        expect(themes.localHourFor(before)).toBe(1);
        expect(themes.localHourFor(after)).toBe(3);
    });

    it('handles the fall-back transition without creating a duplicate slot', () => {
        // 2026-11-01: 01:30 local happens twice. Both must map to the same date
        // and therefore to the same slot keys.
        const first = new Date('2026-11-01T06:30:00Z'); // 01:30 CDT
        const second = new Date('2026-11-01T07:30:00Z'); // 01:30 CST
        expect(themes.publicationDateFor(first)).toBe('2026-11-01');
        expect(themes.publicationDateFor(second)).toBe('2026-11-01');
        // The day the scheduler checks for an article is the same day both times.
        expect(themes.allSlotsFor(themes.publicationDateFor(first)).map((slot) => slot.key))
            .toEqual(themes.allSlotsFor(themes.publicationDateFor(second)).map((slot) => slot.key));
    });

    it('opens the day at 07:00 and offers it to one theme per hourly run, in rotation', () => {
        // 2 August 2026 in Chicago, CDT. Its own theme is industry news.
        const at = (utc) => themes.dueSlots(new Date(`2026-08-02T${utc}Z`)).map((slot) => slot.themeId);

        expect(at('11:15:00')).toEqual([]); // 06:15, before the day opens
        expect(at('12:15:00')).toEqual(['industry-news']); // 07:15
        expect(at('13:15:00')).toEqual(['recruitment']); // 08:15
        expect(at('14:15:00')).toEqual(['safehaul-education']); // 09:15
        expect(at('15:15:00')).toEqual(['industry-news']); // 10:15, round again
        expect(at('23:30:00')).toHaveLength(1); // 18:30, still open, still one
    });

    it('starts each day with the next theme, so each comes round every third day', () => {
        const firstOf = (date) => themes.dueSlots(new Date(`${date}T12:15:00Z`))[0].themeId;

        expect(['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map(firstOf))
            .toEqual(['industry-news', 'recruitment', 'safehaul-education', 'industry-news']);
    });

    it('keys a slot on publication date and theme', () => {
        expect(themes.slotKey('2026-08-02', 'recruitment')).toBe('2026-08-02_recruitment');
        expect(() => themes.slotKey('not-a-date', 'recruitment')).toThrow();
        expect(() => themes.slotKey('2026-08-02', 'invented-theme')).toThrow();
    });
});

describe('idempotency and retry safety', () => {
    const slot = { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 };
    const context = () => ({ store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') });

    it('publishes an article for an empty slot', async () => {
        const result = await generate.runSlot(slot, context());

        expect(result.outcome).toBe(generate.OUTCOME.PUBLISHED);
        expect(mockPosts.size).toBe(1);
        expect(mockPosts.has('2026-08-02_industry-news')).toBe(true);

        // The article keeps the ids of the AI transactions behind it, so it can
        // still be joined to the Logs tab after its ledger row has expired.
        const stored = mockPosts.get('2026-08-02_industry-news');
        expect(stored.generation.generationTransactionId).toBeTruthy();
        expect(stored.generation.verificationTransactionId).toBeTruthy();
    });

    it('does not publish a second article for the same date and theme on retry', async () => {
        await generate.runSlot(slot, context());
        const retry = await generate.runSlot(slot, context());

        expect(retry.outcome).toBe(generate.OUTCOME.SKIPPED_SLOT_TAKEN);
        expect(mockPosts.size).toBe(1);
    });

    it('refuses a create that races another run for the same slot', async () => {
        // Simulate the slot being filled between the pre-check and the write.
        const post = { title: 'Existing', slug: 'existing', theme: 'industry-news', publicationDate: '2026-08-02', status: 'published' };
        const first = await store.createPost(post);
        const second = await store.createPost(post);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(mockPosts.size).toBe(1);
    });

    it('publishes one article a day, and nothing more once it has', async () => {
        const morning = await publishDueSlots({ now: Date.parse('2026-08-02T12:30:00Z'), fetchImpl: researchFetch() });
        const evening = await publishDueSlots({ now: Date.parse('2026-08-02T23:30:00Z'), fetchImpl: researchFetch() });

        expect(morning).toMatchObject({ dueCount: 1, attempted: 1, published: 1 });
        expect(evening).toMatchObject({ attempted: 0, published: 0 });
        expect([...mockPosts.keys()]).toEqual(['2026-08-02_industry-news']);
    });

    it('passes the day to the next theme each hour until one publishes', async () => {
        // No feed answers, so neither sourced theme can publish; the SafeHaul
        // theme, written from the capability package, can.
        const noFeeds = async () => ({ ok: false, status: 404, text: async () => '' });
        const run = async (utc) => (await publishDueSlots({
            now: Date.parse(`2026-08-02T${utc}Z`),
            fetchImpl: noFeeds,
        })).results.map((entry) => [entry.slot.themeId, entry.outcome]);

        expect(await run('12:30:00')).toEqual([['industry-news', 'skipped_no_sources']]);
        expect(await run('13:30:00')).toEqual([['recruitment', 'skipped_no_sources']]);
        expect(await run('14:30:00')).toEqual([['safehaul-education', 'published']]);
        expect(await run('15:30:00')).toEqual([]);
    });

    it('does nothing once any of the day\'s slots holds an article, a deleted one included', async () => {
        mockPosts.set('2026-08-02_recruitment', { title: 'Deleted', theme: 'recruitment', publicationDate: '2026-08-02', status: 'deleted' });

        const summary = await publishDueSlots({ now: Date.parse('2026-08-02T12:30:00Z'), fetchImpl: researchFetch() });

        expect(summary).toMatchObject({ attempted: 0, published: 0 });
        expect(mockGenerateArticle).not.toHaveBeenCalled();
    });

    it('publishes the day\'s article on a later run when the morning missed it', async () => {
        // Nothing published in the morning. A run at 13:00 still publishes.
        const summary = await publishDueSlots({
            now: Date.parse('2026-08-02T18:00:00Z'),
            fetchImpl: researchFetch(),
        });

        expect(summary.published).toBe(1);
        expect(mockPosts.has('2026-08-02_industry-news')).toBe(true);
    });

    it('never publishes for a previous calendar day', async () => {
        await publishDueSlots({ now: Date.parse('2026-08-02T23:30:00Z'), fetchImpl: researchFetch() });
        const ids = [...mockPosts.keys()];

        expect(ids.every((id) => id.startsWith('2026-08-02_'))).toBe(true);
    });

    it('publishes even when one publisher is unreachable', async () => {
        // researchFetch answers only the Federal Register; every other source
        // returns 503. Publication must still happen.
        const summary = await publishDueSlots({
            now: Date.parse('2026-08-02T12:30:00Z'),
            fetchImpl: researchFetch(),
        });

        expect(summary.published).toBe(1);
    });
});

describe('duplicate prevention', () => {
    it('looks back 60 days', () => {
        expect(store.DUPLICATE_WINDOW_DAYS).toBe(60);
    });

    it('catches a repeat by shared source URL', () => {
        const verdict = dedupe.checkForDuplicate(
            { title: 'A completely different headline', sourceUrls: ['https://example.com/story?utm_source=x'] },
            [{ id: 'p1', title: 'Old', normalizedTitle: 'old', sourceUrls: ['https://www.example.com/story/'], topicTokens: [] }],
        );
        expect(verdict).toMatchObject({ duplicate: true, reason: 'shared-source-url' });
    });

    it('catches a repeat by normalized title', () => {
        const verdict = dedupe.checkForDuplicate(
            { title: 'FMCSA Revises  Hours-of-Service Rule!!', sourceUrls: [] },
            [{ id: 'p1', title: 'x', normalizedTitle: 'fmcsa revises hours of service rule', sourceUrls: [], topicTokens: [] }],
        );
        expect(verdict).toMatchObject({ duplicate: true, reason: 'normalized-title' });
    });

    it('catches the same event reported by a different publisher', () => {
        const verdict = dedupe.checkForDuplicate(
            { title: 'Agency revises hours-of-service recordkeeping requirements', sourceUrls: ['https://other.example/a'] },
            [{
                id: 'p1',
                title: 'FMCSA revises hours-of-service recordkeeping requirements',
                normalizedTitle: 'fmcsa revises hours of service recordkeeping requirements',
                sourceUrls: ['https://federalregister.gov/b'],
                topicTokens: dedupe.topicTokens('FMCSA revises hours-of-service recordkeeping requirements'),
            }],
        );
        expect(verdict.duplicate).toBe(true);
        expect(verdict.reason).toBe('topic-similarity');
    });

    it('allows a genuinely different topic', () => {
        const verdict = dedupe.checkForDuplicate(
            { title: 'How to cut driver turnover in the first ninety days', sourceUrls: ['https://example.com/retention'] },
            [{
                id: 'p1',
                title: 'FMCSA revises hours-of-service recordkeeping',
                normalizedTitle: 'fmcsa revises hours of service recordkeeping',
                sourceUrls: ['https://federalregister.gov/b'],
                topicTokens: dedupe.topicTokens('FMCSA revises hours-of-service recordkeeping'),
            }],
        );
        expect(verdict.duplicate).toBe(false);
    });

    it('rejects a candidate that repeats recent coverage', async () => {
        mockPosts.set('2026-07-30_industry-news', {
            title: NEWS_ITEM.title,
            normalizedTitle: dedupe.normalizeTitle(NEWS_ITEM.title),
            theme: 'industry-news',
            status: 'published',
            publicationDate: '2026-07-30',
            sources: [{ url: NEWS_ITEM.url }],
            topicTokens: dedupe.topicTokens(NEWS_ITEM.title),
            sourceFingerprint: 'x',
        });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            // Only the already-covered item is on offer.
            { store, fetchImpl: researchFetch([NEWS_ITEM]), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_ALL_DUPLICATES);
        expect(mockGenerateArticle).not.toHaveBeenCalled();
    });

    it('still treats a deleted post as covered, so the topic is not rewritten', async () => {
        mockPosts.set('2026-07-30_industry-news', {
            title: NEWS_ITEM.title,
            normalizedTitle: dedupe.normalizeTitle(NEWS_ITEM.title),
            theme: 'industry-news',
            // Deleted, but duplicate prevention must still see it.
            status: 'deleted',
            publicationDate: '2026-07-30',
            sources: [{ url: NEWS_ITEM.url }],
            topicTokens: dedupe.topicTokens(NEWS_ITEM.title),
            sourceFingerprint: 'x',
        });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch([NEWS_ITEM]), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_ALL_DUPLICATES);
    });

    it('does not catch a short headline that shares fewer than three terms', () => {
        // A documented limitation, asserted so it cannot change silently.
        // Token overlap needs MIN_SHARED_TOKENS significant terms in common, so
        // two short headlines about the same rule can slip through when they
        // share only two. The canonical-URL and fingerprint checks are what
        // catch that case in practice; this is the residual gap.
        const verdict = dedupe.checkForDuplicate(
            { title: 'FMCSA Recordkeeping Amendment Draws Carrier Comment', sourceUrls: ['https://a.example/1'] },
            [{
                id: 'p1',
                title: 'FMCSA Revises Hours-of-Service Recordkeeping Rule',
                normalizedTitle: dedupe.normalizeTitle('FMCSA Revises Hours-of-Service Recordkeeping Rule'),
                sourceUrls: ['https://b.example/2'],
                topicTokens: dedupe.topicTokens('FMCSA Revises Hours-of-Service Recordkeeping Rule'),
            }],
        );
        expect(verdict.duplicate).toBe(false);
        expect(dedupe.MIN_SHARED_TOKENS).toBe(3);
    });

    it('requires the day\'s articles to cover distinct subjects', () => {
        expect(dedupe.themesAreDistinct([
            { theme: 'industry-news', title: 'FMCSA revises hours-of-service recordkeeping requirements' },
            { theme: 'recruitment', title: 'Cutting driver turnover in the first ninety days' },
            { theme: 'safehaul-education', title: 'Electronic signatures for driver qualification paperwork' },
        ])).toBe(true);

        expect(dedupe.themesAreDistinct([
            { theme: 'industry-news', title: 'FMCSA revises hours-of-service recordkeeping requirements' },
            { theme: 'recruitment', title: 'FMCSA revises hours-of-service recordkeeping rules' },
            { theme: 'safehaul-education', title: 'Electronic signatures for driver qualification paperwork' },
        ])).toBe(false);

        expect(dedupe.themesAreDistinct([
            { theme: 'industry-news', title: 'A' },
            { theme: 'industry-news', title: 'B' },
        ])).toBe(false);
    });
});
