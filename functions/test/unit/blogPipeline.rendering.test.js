/**
 * Blog pipeline: the public rendering surface.
 *
 * What `serveBlogPublic` emits — pages, feed, sitemap and the JSON endpoint.
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

const store = require('../../blog/store');
const publicApi = require('../../blog/publicApi');
const {
    mockPosts, resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

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

/**
 * The run ledger.
 *
 * Every assertion in this suite used to be made on `runSlot`'s **return value**,
 * which meant the whole suite passed with nothing persisted anywhere. That is
 * precisely what shipped: nine outcomes, recorded only as a `console.log`, so
 * publication failure was rendered in the product as absence and "yesterday's
 * 07:00 article is missing" had no answer.
 *
 * These assertions are therefore about the *row*, not the return.
 */
