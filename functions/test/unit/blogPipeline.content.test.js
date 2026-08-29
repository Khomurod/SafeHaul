/**
 * Blog pipeline: sanitization and image licensing.
 *
 * What survives the sanitizer, and what licence an image must carry to ship.
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

const sanitize = require('../../blog/pipeline/sanitize');
const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const media = require('../../blog/media/imageProviders');
const {
    draftArticle, mockGenerateArticle, mockPosts, researchFetch,
    resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

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
