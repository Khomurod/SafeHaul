/**
 * Blog pipeline: scheduling, duplicate prevention, sourcing, sanitization,
 * image licensing and the public rendering surface.
 *
 * No test here contacts a real feed, a real AI provider or a real image
 * provider: research fetches use an injected `fetchImpl`, and the AI tasks are
 * mocked at the task boundary.
 */

jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return {
        HttpsError,
        onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
        onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    };
});

jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: jest.fn((_opts, fn) => fn),
}));

/** An in-memory Firestore standing in for the blog_posts collection. */
const mockPosts = new Map();

jest.mock('../../firebaseAdmin', () => {
    const serverTimestamp = () => ({ toDate: () => new Date('2026-08-02T12:00:00Z') });
    return {
        admin: { firestore: { FieldValue: { serverTimestamp, delete: () => '__delete__' } } },
        db: {
            collection: (name) => {
                const makeQuery = (filters = [], order = null, limit = null) => ({
                    where: (field, op, value) => makeQuery([...filters, { field, op, value }], order, limit),
                    orderBy: (field, direction) => makeQuery(filters, { field, direction }, limit),
                    limit: (count) => makeQuery(filters, order, count),
                    get: async () => {
                        let rows = [...mockPosts.entries()].map(([id, data]) => ({ id, data }));
                        for (const filter of filters) {
                            rows = rows.filter(({ data }) => {
                                const actual = data[filter.field];
                                if (filter.op === '==') return actual === filter.value;
                                if (filter.op === '>=') return String(actual) >= String(filter.value);
                                return true;
                            });
                        }
                        if (order) {
                            rows.sort((a, b) => String(b.data[order.field] ?? '').localeCompare(String(a.data[order.field] ?? '')));
                            if (order.direction === 'asc') rows.reverse();
                        }
                        if (limit) rows = rows.slice(0, limit);
                        return {
                            empty: rows.length === 0,
                            docs: rows.map((row) => ({ id: row.id, data: () => row.data })),
                        };
                    },
                });

                return {
                    ...makeQuery(),
                    doc: (id) => ({
                        get: async () => ({
                            exists: mockPosts.has(id),
                            data: () => mockPosts.get(id),
                        }),
                        create: async (data) => {
                            if (mockPosts.has(id)) {
                                const error = new Error('ALREADY_EXISTS');
                                error.code = 6;
                                throw error;
                            }
                            mockPosts.set(id, { ...data, publishedAt: serverTimestamp() });
                        },
                        update: async (patch) => {
                            mockPosts.set(id, { ...(mockPosts.get(id) || {}), ...patch });
                        },
                        set: async (patch) => {
                            mockPosts.set(id, { ...(mockPosts.get(id) || {}), ...patch });
                        },
                    }),
                    add: async () => {},
                };
            },
        },
    };
});

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

// AI tasks are mocked at the task boundary. Routing has its own suite.
const mockGenerateArticle = jest.fn();
const mockVerifyArticleClaims = jest.fn();
const mockSelectTopic = jest.fn();
jest.mock('../../ai/tasks/articleGeneration', () => {
    const actual = jest.requireActual('../../ai/tasks/articleGeneration');
    return {
        ...actual,
        generateArticle: (...args) => mockGenerateArticle(...args),
        verifyArticleClaims: (...args) => mockVerifyArticleClaims(...args),
        selectTopic: (...args) => mockSelectTopic(...args),
    };
});

jest.mock('../../blog/media/credentials', () => ({
    readAllMediaCredentials: jest.fn().mockResolvedValue(new Map()),
    writeMediaSecret: jest.fn(),
    destroyMediaSecret: jest.fn(),
    buildMediaSecretId: jest.requireActual('../../blog/media/credentials').buildMediaSecretId,
}));

const themes = require('../../blog/pipeline/themes');
const dedupe = require('../../blog/pipeline/dedupe');
const sanitize = require('../../blog/pipeline/sanitize');
const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const media = require('../../blog/media/imageProviders');
const knowledge = require('../../ai/knowledge/safehaulCapabilities');
const publicApi = require('../../blog/publicApi');
const { publishDueSlots } = require('../../blog/scheduler');
const research = require('../../blog/research/fetchSources');

/** A generated draft long enough to clear the minimum word count. */
function draftArticle(overrides = {}) {
    // Long enough to clear the production MIN_WORD_COUNT of 450. The threshold
    // is deliberately not lowered for the sake of a fixture.
    const paragraph = ('Carriers need to understand the practical effect of this change on their daily '
        + 'operations, because the compliance burden falls on the fleet rather than on the agency that '
        + 'issued the rule. Safety managers should read the amended text closely and compare it with '
        + 'the records they retain today. ').repeat(6);
    return {
        title: 'FMCSA Updates Hours-of-Service Documentation Requirements for 2026',
        metaDescription: 'The agency has revised what carriers must retain to show hours-of-service compliance. Here is what changed and what fleets should do next.',
        excerpt: 'A revision to hours-of-service recordkeeping changes what carriers must retain. We explain the change and the practical steps for a fleet.',
        imageQuery: 'semi truck highway',
        imageAltText: 'A semi truck travelling on an interstate highway at dusk',
        blocks: [
            { type: 'heading', level: 2, text: 'What changed' },
            { type: 'paragraph', text: paragraph },
            { type: 'heading', level: 2, text: 'Who it affects' },
            { type: 'paragraph', text: paragraph },
            { type: 'list', items: ['Interstate carriers', 'Owner-operators', 'Safety managers'] },
            { type: 'heading', level: 2, text: 'What to do next' },
            { type: 'paragraph', text: paragraph },
        ],
        ...overrides,
    };
}

const SECOND_ITEM = {
    title: 'FMCSA Recordkeeping Amendment Draws Carrier Comment',
    url: 'https://www.federalregister.gov/documents/2026/07/31/example-comment',
    summary: 'Carriers respond to the amended 49 CFR 395 recordkeeping requirements.',
    publishedAt: '2026-07-31',
};

const NEWS_ITEM = {
    title: 'FMCSA Revises Hours-of-Service Recordkeeping Rule',
    url: 'https://www.federalregister.gov/documents/2026/07/30/example-rule',
    summary: 'The agency amends 49 CFR 395 recordkeeping requirements effective October 2026.',
    publishedAt: '2026-07-30',
};

/** A feed fetch that answers the Federal Register API and nothing else. */
function researchFetch(items = [NEWS_ITEM, SECOND_ITEM]) {
    return async (url) => {
        if (url.includes('federalregister.gov')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    results: items.map((item) => ({
                        title: item.title,
                        html_url: item.url,
                        abstract: item.summary,
                        publication_date: item.publishedAt,
                        type: 'Rule',
                    })),
                }),
                text: async () => '',
            };
        }
        // Every other source is unreachable in this test, which also exercises
        // the "one publisher down must not stop publication" path.
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPosts.clear();
    mockGenerateArticle.mockResolvedValue({
        article: draftArticle(),
        providerId: 'groq',
        model: 'llama-3.3-70b-versatile',
        fallbackCount: 0,
    });
    mockVerifyArticleClaims.mockResolvedValue({ supported: true, unsupportedClaims: [], notes: '' });
    mockSelectTopic.mockResolvedValue({ selectedIndex: 0, angle: 'Explain the recordkeeping change.' });
});

describe('themes and scheduling', () => {
    it('defines exactly three daily themes with distinct slots', () => {
        expect(themes.THEMES).toHaveLength(3);
        expect(new Set(themes.THEMES.map((theme) => theme.id)).size).toBe(3);
        expect(new Set(themes.THEMES.map((theme) => theme.slotIndex)).size).toBe(3);
        expect(new Set(themes.THEMES.map((theme) => theme.publishHour)).size).toBe(3);
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
        expect(themes.dueSlots(first).map((slot) => slot.key))
            .toEqual(themes.dueSlots(second).map((slot) => slot.key));
    });

    it('opens each slot at its local hour and keeps it open for the rest of the day', () => {
        const early = new Date('2026-08-02T11:00:00Z'); // 06:00 local, before slot 1
        const morning = new Date('2026-08-02T13:00:00Z'); // 08:00 local
        const evening = new Date('2026-08-02T23:30:00Z'); // 18:30 local

        expect(themes.dueSlots(early)).toHaveLength(0);
        expect(themes.dueSlots(morning).map((slot) => slot.themeId)).toEqual(['industry-news']);
        expect(themes.dueSlots(evening).map((slot) => slot.themeId))
            .toEqual(['industry-news', 'recruitment', 'safehaul-education']);
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

    it('publishes at most one article per scheduler run', async () => {
        // All three slots are due at 18:00 local, but a single run must not put
        // three articles on the site within a minute of each other.
        const summary = await publishDueSlots({
            now: Date.parse('2026-08-02T23:30:00Z'),
            fetchImpl: researchFetch(),
        });

        expect(summary.dueCount).toBe(3);
        expect(summary.published).toBe(1);
        expect(summary.results.some((entry) => entry.outcome === 'deferred_to_next_run')).toBe(true);
    });

    it('fills a slot missed earlier in the day on a later run', async () => {
        // Nothing published at 07:00. The 13:00 run must still fill slot one.
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

    it('runs each due slot even when one publisher is unreachable', async () => {
        // researchFetch answers only the Federal Register; every other source
        // returns 503. Publication must still happen.
        const summary = await publishDueSlots({
            now: Date.parse('2026-08-02T13:00:00Z'),
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
            supported: false,
            unsupportedClaims: ['The rule takes effect in January 2027.'],
            notes: '',
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

describe('sanitization', () => {
    it('escapes script markup instead of rendering it', () => {
        const html = sanitize.renderBlocksToHtml([
            { type: 'paragraph', text: '<script>fetch("//evil")</script>' },
        ]);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('neutralises an event handler by escaping the whole tag', () => {
        const html = sanitize.renderBlocksToHtml([
            { type: 'paragraph', text: '<img src=x onerror="steal()">' },
        ]);
        // The characters survive as text, which is the point: there is no tag
        // for the browser to attach a handler to.
        expect(html).toBe('<p>&lt;img src=x onerror=&quot;steal()&quot;&gt;</p>');
        expect(html).not.toMatch(/<img/);
    });

    it('drops an unsupported block type entirely', () => {
        const html = sanitize.renderBlocksToHtml([
            { type: 'iframe', text: 'https://evil.example' },
            { type: 'paragraph', text: 'kept' },
        ]);
        expect(html).toBe('<p>kept</p>');
    });

    it('refuses a javascript: URL', () => {
        expect(sanitize.safeUrl('javascript:alert(1)')).toBeNull();
        expect(sanitize.safeUrl('data:text/html,<script>x</script>')).toBeNull();
        expect(sanitize.safeUrl('https://example.com/a')).toBe('https://example.com/a');
    });

    it('clamps heading levels so an article cannot introduce a second h1', () => {
        const html = sanitize.renderBlocksToHtml([{ type: 'heading', level: 1, text: 'Title' }]);
        expect(html).toBe('<h2>Title</h2>');
    });

    it('produces a URL-safe slug and rejects a traversal attempt', () => {
        expect(sanitize.slugify('FMCSA Updates Rule — 2026!')).toBe('fmcsa-updates-rule-2026');
        expect(sanitize.isValidSlug('fmcsa-updates-rule-2026')).toBe(true);
        expect(sanitize.isValidSlug('../../etc/passwd')).toBe(false);
        expect(sanitize.isValidSlug('Has-Capitals')).toBe(false);
    });

    it('stores structured blocks rather than model HTML', async () => {
        await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        const post = mockPosts.get('2026-08-02_industry-news');
        expect(Array.isArray(post.contentBlocks)).toBe(true);
        expect(post).not.toHaveProperty('html');
        for (const block of post.contentBlocks) {
            expect(sanitize.BLOCK_TYPES).toContain(block.type);
        }
    });

    it('rejects a draft too short to be worth publishing', async () => {
        mockGenerateArticle.mockResolvedValue({
            article: draftArticle({ blocks: [{ type: 'paragraph', text: 'Too short.' }] }),
            providerId: 'groq', model: 'm', fallbackCount: 0,
        });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        expect(result.outcome).toBe(generate.OUTCOME.SKIPPED_VALIDATION);
    });
});

describe('image licensing', () => {
    it('records provider, source, creator, licence and attribution for every image', async () => {
        await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            { store, fetchImpl: researchFetch(), now: Date.parse('2026-08-02T13:00:00Z') },
        );

        const { image } = mockPosts.get('2026-08-02_industry-news');
        expect(media.isLicenceComplete(image)).toBe(true);
        expect(image).toMatchObject({
            provider: expect.any(String),
            sourceUrl: expect.any(String),
            imageUrl: expect.any(String),
            creator: expect.any(String),
            licenceName: expect.any(String),
            licenceUrl: expect.any(String),
            attributionText: expect.any(String),
            altText: expect.any(String),
        });
        expect(image.retrievedAt).toBeTruthy();
    });

    it('uses the approved local fallback when no media provider is configured', async () => {
        const image = await media.findLicensedImage({
            query: 'truck',
            altText: 'A truck',
            credentials: new Map(),
            fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
        });

        expect(image.provider).toBe('safehaul-local');
        expect(media.isLicenceComplete(image)).toBe(true);
    });

    it('rejects an Openverse item whose licence it cannot identify', () => {
        const provider = media.PROVIDERS_BY_ID.get('openverse');
        const unknown = media.normalizeOpenverse({
            results: [{ license: 'some-unknown-licence', url: 'https://x.example/a.jpg', foreign_landing_url: 'https://x.example/a', creator: 'A' }],
        }, provider);
        expect(unknown).toBeNull();

        const known = media.normalizeOpenverse({
            results: [{ license: 'by', url: 'https://x.example/a.jpg', foreign_landing_url: 'https://x.example/a', creator: 'A', title: 'T' }],
        }, provider);
        expect(known.licenceName).toBe('CC BY');
        expect(known.licenceUrl).toMatch(/creativecommons\.org/);
    });

    it('marks Unsplash as hotlink-only, per its API terms', () => {
        expect(media.PROVIDERS_BY_ID.get('unsplash').allowsHosting).toBe(false);
        expect(media.PROVIDERS_BY_ID.get('unsplash').attributionRequired).toBe(true);
    });

    it('asks Openverse only for commercially usable, modifiable work', () => {
        const url = media.buildSearchUrl(media.PROVIDERS_BY_ID.get('openverse'), 'truck');
        expect(url).toContain('license_type=commercial%2Cmodification');
    });

    it('treats an image with incomplete licence metadata as unusable', () => {
        expect(media.isLicenceComplete({ provider: 'pexels', imageUrl: 'https://x/a.jpg' })).toBe(false);
    });
});

describe('public rendering', () => {
    const PUBLISHED = {
        title: 'FMCSA Updates Hours-of-Service Documentation Requirements',
        slug: 'fmcsa-updates-hours-of-service-documentation',
        excerpt: 'What changed and what fleets should do next.',
        theme: 'industry-news',
        status: 'published',
        publicationDate: '2026-08-02',
        contentBlocks: [
            { type: 'heading', level: 2, text: 'What changed' },
            { type: 'paragraph', text: 'The agency revised recordkeeping requirements.' },
        ],
        image: {
            provider: 'pexels',
            imageUrl: 'https://images.pexels.com/photos/1/truck.jpg',
            sourceUrl: 'https://www.pexels.com/photo/1/',
            creator: 'Jane Photographer',
            licenceName: 'Pexels License',
            licenceUrl: 'https://www.pexels.com/license/',
            attributionText: 'Photo by Jane Photographer on Pexels',
            altText: 'A semi truck on a highway',
        },
        sources: [{ title: 'Federal Register notice', publisher: 'Federal Register', url: 'https://www.federalregister.gov/documents/2026/07/30/x', publishedAt: '2026-07-30' }],
        seo: { metaDescription: 'The agency revised what carriers must retain to show hours-of-service compliance.' },
        generation: { providerId: 'groq', model: 'llama-3.3-70b-versatile', wordCount: 900 },
    };

    function fakeRes() {
        const res = {
            headers: {}, statusCode: null, body: null,
            set(key, value) { this.headers[key] = value; return this; },
            status(code) { this.statusCode = code; return this; },
            send(body) { this.body = body; return this; },
            json(body) { this.body = body; return this; },
        };
        return res;
    }

    const call = async (path, method = 'GET', query = {}) => {
        const res = fakeRes();
        await publicApi.__test.handlePublicBlogRequest({ method, path, query }, res);
        return res;
    };

    beforeEach(() => {
        mockPosts.set('2026-08-02_industry-news', PUBLISHED);
    });

    it('renders an article page with canonical metadata and JSON-LD', async () => {
        const res = await call(`/news/${PUBLISHED.slug}`);

        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toMatch(/text\/html/);
        expect(res.body).toContain(`<link rel="canonical" href="https://safehaul.io/news/${PUBLISHED.slug}">`);
        expect(res.body).toContain('<meta property="og:title"');
        expect(res.body).toContain('<meta property="og:image"');
        expect(res.body).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(res.body).toContain('"@type":"BlogPosting"');
        expect(res.body).toContain('SafeHaul Editorial Team');
        expect(res.body).toContain('<meta property="article:published_time"');
    });

    it('includes descriptive image alt text and the required attribution', async () => {
        const res = await call(`/news/${PUBLISHED.slug}`);

        expect(res.body).toContain('alt="A semi truck on a highway"');
        expect(res.body).toContain('Photo by Jane Photographer on Pexels');
        expect(res.body).toContain('https://www.pexels.com/license/');
    });

    it('links to its sources', async () => {
        const res = await call(`/news/${PUBLISHED.slug}`);
        expect(res.body).toContain('https://www.federalregister.gov/documents/2026/07/30/x');
        expect(res.body).toContain('Federal Register');
    });

    it('states that the article is not legal advice', async () => {
        const res = await call(`/news/${PUBLISHED.slug}`);
        expect(res.body).toMatch(/not legal advice/i);
    });

    it('never exposes generation metadata publicly', async () => {
        const res = await call(`/news/${PUBLISHED.slug}`);
        expect(res.body).not.toContain('llama-3.3-70b-versatile');
        expect(res.body).not.toContain('providerId');
        expect(res.body).not.toContain('wordCount');
    });

    it('serves the index with the published article', async () => {
        const res = await call('/news');
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain(PUBLISHED.title);
        expect(res.body).toContain('Read Article');
    });

    it('returns the latest cards as JSON for the static landing page', async () => {
        const res = await call('/api/news/latest');

        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toMatch(/application\/json/);
        expect(res.body.posts).toHaveLength(1);
        expect(res.body.posts[0]).toMatchObject({
            title: PUBLISHED.title,
            url: `/news/${PUBLISHED.slug}`,
        });
        // Card payloads must not carry internal generation detail either.
        expect(JSON.stringify(res.body)).not.toContain('llama-3.3');
    });

    it('serves a sitemap and an Atom feed containing the article', async () => {
        const sitemap = await call('/sitemap.xml');
        expect(sitemap.statusCode).toBe(200);
        expect(sitemap.headers['Content-Type']).toMatch(/xml/);
        expect(sitemap.body).toContain(`https://safehaul.io/news/${PUBLISHED.slug}`);

        const feed = await call('/news/feed.xml');
        expect(feed.statusCode).toBe(200);
        expect(feed.headers['Content-Type']).toMatch(/atom\+xml/);
        expect(feed.body).toContain(PUBLISHED.title);
    });

    it('serves robots.txt pointing at the sitemap', async () => {
        const res = await call('/robots.txt');
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Sitemap: https://safehaul.io/sitemap.xml');
    });

    it('removes a deleted post from every public surface immediately', async () => {
        await store.softDeletePost('2026-08-02_industry-news');

        const article = await call(`/news/${PUBLISHED.slug}`);
        const index = await call('/news');
        const cards = await call('/api/news/latest');
        const sitemap = await call('/sitemap.xml');
        const feed = await call('/news/feed.xml');

        expect(article.statusCode).toBe(404);
        expect(index.body).not.toContain(PUBLISHED.title);
        expect(cards.body.posts).toHaveLength(0);
        expect(sitemap.body).not.toContain(PUBLISHED.slug);
        expect(feed.body).not.toContain(PUBLISHED.title);
    });

    it('does not expose an unpublished post', async () => {
        mockPosts.set('2026-08-03_recruitment', { ...PUBLISHED, slug: 'draft-post', status: 'draft', publicationDate: '2026-08-03' });

        const res = await call('/news/draft-post');
        expect(res.statusCode).toBe(404);

        const index = await call('/news');
        expect(index.body).not.toContain('draft-post');
    });

    it('answers an invalid slug with the same 404 as an unknown one', async () => {
        const traversal = await call('/news/..%2F..%2Fetc%2Fpasswd');
        const unknown = await call('/news/no-such-article');

        expect(traversal.statusCode).toBe(404);
        expect(unknown.statusCode).toBe(404);
        expect(traversal.body).toContain('noindex');
    });

    it('marks a 404 noindex so a removed article is not indexed at its old URL', async () => {
        const res = await call('/news/gone-away');
        expect(res.body).toContain('<meta name="robots" content="noindex, follow">');
    });

    it('refuses a write method on the public surface', async () => {
        const res = await call('/news', 'POST');
        expect(res.statusCode).toBe(405);
        expect(res.headers.Allow).toBe('GET, HEAD');
    });

    it('sets caching and hardening headers', async () => {
        const res = await call('/news');
        expect(res.headers['Cache-Control']).toBe(publicApi.__test.CACHE_CONTROL);
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('escapes a hostile title rather than rendering it', async () => {
        mockPosts.set('2026-08-04_recruitment', {
            ...PUBLISHED,
            slug: 'hostile-title',
            publicationDate: '2026-08-04',
            title: 'Breaking: <img src=x onerror="alert(1)"> news',
        });

        const res = await call('/news/hostile-title');
        expect(res.body).not.toMatch(/onerror="alert/);
        expect(res.body).toContain('&lt;img');
    });

    it('escapes a closing script sequence inside JSON-LD', () => {
        const json = publicApi.__test.renderJsonLd({
            ...PUBLISHED,
            title: 'Title </script><script>alert(1)</script>',
        });
        expect(json).not.toMatch(/<\/script><script>/);
        expect(json).toContain('\\u003c');
    });

    it('shows an empty state rather than failing when nothing is published', async () => {
        mockPosts.clear();
        const res = await call('/news');
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(/on their way/i);
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
