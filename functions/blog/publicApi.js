/**
 * Public blog rendering: article pages, the index, a sitemap, a feed and the
 * JSON endpoint the static landing page calls.
 *
 * Server-rendered rather than client-rendered, because articles are created
 * after deployment and a crawler must receive complete HTML with correct
 * metadata on the first request. Committing static files would mean a deploy
 * per article, which is exactly what an automatically-published blog cannot do.
 *
 * Security posture for everything in this file:
 *  - only `status === 'published'` posts are ever returned, so a deleted post is
 *    indistinguishable from one that never existed;
 *  - slugs from the URL are validated against the pattern the generator can
 *    produce, then used only for an equality query;
 *  - all text is escaped at render time — the article body is rebuilt from
 *    sanitized structured blocks, never from stored HTML;
 *  - no generation metadata, provider name, model or validation detail is
 *    exposed;
 *  - responses set an explicit content type and cache policy, and carry the
 *    same hardening headers as the landing site.
 */

const { onRequest } = require('firebase-functions/v2/https');

const store = require('./store');
const { isValidSlug } = require('./pipeline/sanitize');
const {
    ORIGIN,
    SECTION_NAME,
    AUTHOR,
    LATEST_LIMIT,
    INDEX_LIMIT,
    CACHE_CONTROL,
    NO_STORE,
    renderJsonLd,
    toCard,
} = require('./publicApi/rendering');
const {
    renderPage,
    renderArticlePage,
    renderIndexPage,
    renderNotFoundPage,
} = require('./publicApi/pages');
const { renderAtomFeed, renderSitemap } = require('./publicApi/feeds');

function applyCommonHeaders(res, { contentType, cacheControl = CACHE_CONTROL }) {
    res.set('Content-Type', contentType);
    res.set('Cache-Control', cacheControl);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
}

/**
 * Routes every public blog request.
 *
 * One function rather than five, because Firebase Hosting rewrites are matched
 * by path and a single handler keeps the rewrite list short and its ordering
 * obvious.
 */
async function handlePublicBlogRequest(req, res) {
    // Read-only surface. Anything other than GET or HEAD is refused before any
    // query runs.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        applyCommonHeaders(res, { contentType: 'text/plain; charset=utf-8', cacheControl: NO_STORE });
        res.set('Allow', 'GET, HEAD');
        res.status(405).send('Method Not Allowed');
        return;
    }

    const path = String(req.path || '/').replace(/\/+$/, '') || '/news';

    try {
        if (path === '/news/feed.xml' || path === '/news/feed') {
            const posts = await store.listPublished({ limit: 20 });
            applyCommonHeaders(res, { contentType: 'application/atom+xml; charset=utf-8' });
            res.status(200).send(renderAtomFeed(posts));
            return;
        }

        if (path === '/sitemap.xml' || path === '/news/sitemap.xml') {
            const entries = await store.listPublishedSlugs({ limit: 500 });
            applyCommonHeaders(res, { contentType: 'application/xml; charset=utf-8' });
            res.status(200).send(renderSitemap(entries));
            return;
        }

        // Not the live path. Firebase Hosting resolves `/robots.txt` before it
        // consults `rewrites` — a rewrite to this function was deployed and
        // never fired, returning an empty 404 on both public sites. The served
        // file is the static `web/robots.txt`, and a test pins the two to
        // the same bytes. This branch stays as the backstop for a direct hit on
        // the function's own URL, where no static file exists.
        if (path === '/robots.txt') {
            applyCommonHeaders(res, { contentType: 'text/plain; charset=utf-8' });
            res.status(200).send([
                'User-agent: *',
                'Allow: /',
                '',
                `Sitemap: ${ORIGIN}/sitemap.xml`,
                '',
            ].join('\n'));
            return;
        }

        if (path === '/api/news/latest') {
            const limit = Math.min(Math.max(Number(req.query?.limit) || LATEST_LIMIT, 1), 12);
            const posts = await store.listPublished({ limit });
            applyCommonHeaders(res, { contentType: 'application/json; charset=utf-8' });
            // Same-origin through the Hosting rewrite, but the landing site is
            // also served from the .web.app hostname, so the read-only card
            // feed is explicitly public.
            res.set('Access-Control-Allow-Origin', '*');
            res.status(200).json({ posts: posts.map(toCard) });
            return;
        }

        if (path === '/news') {
            const posts = await store.listPublished({ limit: INDEX_LIMIT });
            applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8' });
            res.status(200).send(renderIndexPage(posts));
            return;
        }

        const match = /^\/news\/([^/]+)$/.exec(path);
        if (match) {
            const slug = decodeURIComponent(match[1]);
            // An invalid slug is answered with the same 404 as an unknown one,
            // so probing tells an attacker nothing.
            if (!isValidSlug(slug)) {
                applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8', cacheControl: NO_STORE });
                res.status(404).send(renderNotFoundPage());
                return;
            }

            const post = await store.findPublishedBySlug(slug);
            if (!post) {
                applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8', cacheControl: NO_STORE });
                res.status(404).send(renderNotFoundPage());
                return;
            }

            applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8' });
            res.status(200).send(renderArticlePage(post));
            return;
        }

        applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8', cacheControl: NO_STORE });
        res.status(404).send(renderNotFoundPage());
    } catch (error) {
        // Message only. A stack trace or a query detail must not reach a public
        // response.
        console.error(`[blog/publicApi] ${req.method} ${path} failed: ${error?.message || 'unknown'}`);
        applyCommonHeaders(res, { contentType: 'text/html; charset=utf-8', cacheControl: NO_STORE });
        res.status(500).send(renderPage({
            title: `${SECTION_NAME} is temporarily unavailable`,
            description: 'Please try again shortly.',
            canonical: `${ORIGIN}/news`,
            extraHead: '<meta name="robots" content="noindex, follow">',
            bodyHtml: '<section class="news-index"><h1>Temporarily unavailable</h1><p>Please try again shortly.</p></section>',
        }));
    }
}

exports.serveBlogPublic = onRequest({
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 20,
    maxInstances: 10,
}, (req, res) => handlePublicBlogRequest(req, res));

exports.__test = {
    handlePublicBlogRequest,
    renderArticlePage,
    renderIndexPage,
    renderAtomFeed,
    renderSitemap,
    renderNotFoundPage,
    renderJsonLd,
    toCard,
    ORIGIN,
    SECTION_NAME,
    AUTHOR,
    CACHE_CONTROL,
};
