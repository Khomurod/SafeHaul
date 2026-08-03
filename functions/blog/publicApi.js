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
const { escapeHtml, renderBlocksToHtml, isValidSlug, safeUrl } = require('./pipeline/sanitize');
const { getTheme } = require('./pipeline/themes');

const ORIGIN = 'https://safehaul.io';
const SITE_NAME = 'SafeHaul';
const SECTION_NAME = 'SafeHaul News & Insights';
const AUTHOR = 'SafeHaul Editorial Team';

/** Cards on the landing page and in the index. */
const LATEST_LIMIT = 3;
const INDEX_LIMIT = 30;

/**
 * Public caching. Short enough that a deletion disappears quickly, long enough
 * to absorb crawler traffic. `s-maxage` targets the CDN; `stale-while-revalidate`
 * keeps the page fast while it refreshes behind the request.
 */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=60';
const NO_STORE = 'no-store';

function applyCommonHeaders(res, { contentType, cacheControl = CACHE_CONTROL }) {
    res.set('Content-Type', contentType);
    res.set('Cache-Control', cacheControl);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
}

function articleUrl(slug) {
    return `${ORIGIN}/news/${slug}`;
}

function formatDisplayDate(publicationDate) {
    // Parsed as UTC noon so the displayed date matches `publicationDate`
    // regardless of the renderer's own timezone.
    const parsed = new Date(`${publicationDate}T12:00:00Z`);
    return Number.isNaN(parsed.getTime())
        ? publicationDate
        : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** ISO 8601 timestamp for metadata. */
function isoDate(post) {
    return post.publishedAt || `${post.publicationDate}T12:00:00.000Z`;
}

/**
 * The image element plus its required attribution.
 *
 * Attribution is rendered whenever the provider requires it *or* whenever we
 * have it, because crediting a photographer who did not demand it costs
 * nothing and omitting one who did is a licence breach.
 */
function renderFigure(image) {
    if (!image) return '';
    const src = safeUrl(image.imageUrl) || image.imageUrl;
    if (!src) return '';

    const credit = image.attributionText
        ? `<figcaption class="news-credit">${escapeHtml(image.attributionText)}${
            image.licenceUrl
                ? ` · <a href="${escapeHtml(image.licenceUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(image.licenceName || 'Licence')}</a>`
                : ''
        }</figcaption>`
        : '';

    return `<figure class="news-figure">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(image.altText || '')}" loading="lazy" width="1200" height="630">
        ${credit}
    </figure>`;
}

function renderSourceList(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return '';
    const items = sources.map((source) => {
        const url = safeUrl(source.url);
        if (!url) return '';
        return `<li><a href="${escapeHtml(url)}" rel="nofollow noopener" target="_blank">${escapeHtml(source.title)}</a>`
            + ` — ${escapeHtml(source.publisher)}${source.publishedAt ? `, ${escapeHtml(String(source.publishedAt).slice(0, 10))}` : ''}</li>`;
    }).filter(Boolean).join('');

    return items ? `<section class="news-sources"><h2>Sources</h2><ul>${items}</ul></section>` : '';
}

/** BlogPosting JSON-LD. Built from a plain object and serialized, so no injection. */
function renderJsonLd(post) {
    const data = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.seo?.metaDescription || post.excerpt,
        image: post.image?.imageUrl ? [post.image.imageUrl] : undefined,
        datePublished: isoDate(post),
        dateModified: post.modifiedAt || isoDate(post),
        author: { '@type': 'Organization', name: AUTHOR, url: ORIGIN },
        publisher: {
            '@type': 'Organization',
            name: SITE_NAME,
            url: ORIGIN,
            logo: { '@type': 'ImageObject', url: `${ORIGIN}/assets/images/logo.svg` },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl(post.slug) },
        articleSection: getTheme(post.theme)?.name || SECTION_NAME,
        isAccessibleForFree: true,
    };

    // `<` cannot appear in a JSON string here, but escaping it is the standard
    // defence against a `</script>` sequence closing the block early.
    return `<script type="application/ld+json">${
        JSON.stringify(data).replace(/</g, '\\u003c')
    }</script>`;
}

/** The shared page shell. The landing site's own stylesheet is reused. */
function renderPage({ title, description, canonical, bodyHtml, extraHead = '', ogImage = null, ogType = 'website' }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="${escapeHtml(ogType)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
<link rel="alternate" type="application/atom+xml" title="${escapeHtml(SECTION_NAME)}" href="${ORIGIN}/news/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css?v=5">
${extraHead}
</head>
<body>
<nav id="navbar">
  <div class="nav-container">
    <a href="/" class="nav-logo"><img src="/assets/images/logo.svg" alt="SafeHaul" height="32"></a>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/news" aria-current="page">News &amp; Insights</a>
      <a href="/#faq">FAQ</a>
    </div>
    <div class="nav-cta">
      <a href="https://app.safehaul.io" target="_blank" rel="noopener" class="btn btn-ghost">Login</a>
    </div>
  </div>
</nav>
<main id="main">
${bodyHtml}
</main>
<footer id="footer">
  <div class="footer-container">
    <p>&copy; 2026 SafeHaul. <a href="/privacy.html">Privacy Policy</a> · <a href="/news">News &amp; Insights</a> · <a href="/news/feed.xml">Feed</a></p>
  </div>
</footer>
</body>
</html>`;
}

function renderArticlePage(post) {
    const description = post.seo?.metaDescription || post.excerpt;
    const theme = getTheme(post.theme);

    const body = `<article class="news-article">
  <header class="news-article-header">
    <p class="news-eyebrow">${escapeHtml(theme?.name || SECTION_NAME)}</p>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="news-meta">
      <time datetime="${escapeHtml(isoDate(post))}">${escapeHtml(formatDisplayDate(post.publicationDate))}</time>
      · ${escapeHtml(AUTHOR)}
    </p>
  </header>
  ${renderFigure(post.image)}
  <div class="news-body">
${renderBlocksToHtml(post.contentBlocks)}
  </div>
  ${renderSourceList(post.sources)}
  <aside class="news-about">
    <h2>About SafeHaul</h2>
    <p>SafeHaul is a hiring and compliance platform for US trucking carriers, covering
    driver applications, qualification documents, electronic signatures and previous-employment
    verification. <a href="/#features">See what SafeHaul does</a>.</p>
  </aside>
  <p class="news-disclaimer"><em>This article is general information, not legal advice.
  Confirm how any regulation applies to your operation.</em></p>
  <p class="news-back"><a href="/news">&larr; All News &amp; Insights</a></p>
</article>`;

    return renderPage({
        title: `${post.title} | ${SECTION_NAME}`,
        description,
        canonical: articleUrl(post.slug),
        ogImage: post.image?.imageUrl || null,
        ogType: 'article',
        extraHead: [
            `<meta property="article:published_time" content="${escapeHtml(isoDate(post))}">`,
            `<meta property="article:modified_time" content="${escapeHtml(post.modifiedAt || isoDate(post))}">`,
            `<meta property="article:section" content="${escapeHtml(theme?.name || SECTION_NAME)}">`,
            renderJsonLd(post),
        ].join('\n'),
        bodyHtml: body,
    });
}

function renderCard(post) {
    const image = post.image?.imageUrl ? safeUrl(post.image.imageUrl) : null;
    return `<article class="news-card">
  ${image ? `<a href="/news/${escapeHtml(post.slug)}" class="news-card-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(post.image.altText || '')}" loading="lazy"></a>` : ''}
  <div class="news-card-body">
    <p class="news-eyebrow">${escapeHtml(getTheme(post.theme)?.name || SECTION_NAME)}</p>
    <h2><a href="/news/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
    <p class="news-card-excerpt">${escapeHtml(post.excerpt)}</p>
    <p class="news-meta"><time datetime="${escapeHtml(isoDate(post))}">${escapeHtml(formatDisplayDate(post.publicationDate))}</time></p>
    <a class="news-read-more" href="/news/${escapeHtml(post.slug)}">Read Article</a>
  </div>
</article>`;
}

function renderIndexPage(posts) {
    const body = `<section class="news-index">
  <header class="news-index-header">
    <h1>${escapeHtml(SECTION_NAME)}</h1>
    <p>Trucking news and regulation, recruiting and retention guidance, and practical
    explanations of the compliance problems carriers deal with. Published daily.</p>
  </header>
  ${posts.length
        ? `<div class="news-grid">${posts.map(renderCard).join('\n')}</div>`
        : '<p class="news-empty">The first articles are on their way. Please check back shortly.</p>'}
</section>`;

    return renderPage({
        title: `${SECTION_NAME} | Trucking news, recruiting and compliance`,
        description: 'Daily trucking industry news, driver recruiting and retention guidance, and compliance explainers from the SafeHaul editorial team.',
        canonical: `${ORIGIN}/news`,
        bodyHtml: body,
    });
}

function renderNotFoundPage() {
    return renderPage({
        title: `Article not found | ${SECTION_NAME}`,
        description: 'That article is not available.',
        canonical: `${ORIGIN}/news`,
        // A missing or deleted article must not be indexed under its old URL.
        extraHead: '<meta name="robots" content="noindex, follow">',
        bodyHtml: `<section class="news-index">
  <h1>That article is not available</h1>
  <p>It may have been removed. <a href="/news">Browse the latest articles</a>.</p>
</section>`,
    });
}

function renderAtomFeed(posts) {
    const updated = posts[0] ? isoDate(posts[0]) : new Date().toISOString();
    const entries = posts.map((post) => `  <entry>
    <title type="text">${escapeHtml(post.title)}</title>
    <link href="${escapeHtml(articleUrl(post.slug))}"/>
    <id>${escapeHtml(articleUrl(post.slug))}</id>
    <updated>${escapeHtml(post.modifiedAt || isoDate(post))}</updated>
    <published>${escapeHtml(isoDate(post))}</published>
    <summary type="text">${escapeHtml(post.excerpt)}</summary>
    <category term="${escapeHtml(post.theme)}"/>
    <author><name>${escapeHtml(AUTHOR)}</name></author>
  </entry>`).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(SECTION_NAME)}</title>
  <subtitle>Trucking news, recruiting and compliance from SafeHaul</subtitle>
  <link href="${ORIGIN}/news/feed.xml" rel="self"/>
  <link href="${ORIGIN}/news"/>
  <id>${ORIGIN}/news</id>
  <updated>${escapeHtml(updated)}</updated>
  <author><name>${escapeHtml(AUTHOR)}</name></author>
${entries}
</feed>`;
}

function renderSitemap(entries) {
    const staticUrls = [
        { loc: `${ORIGIN}/`, priority: '1.0', changefreq: 'weekly' },
        { loc: `${ORIGIN}/news`, priority: '0.9', changefreq: 'daily' },
        { loc: `${ORIGIN}/privacy.html`, priority: '0.3', changefreq: 'yearly' },
    ];

    const urls = [
        ...staticUrls.map((entry) => `  <url>
    <loc>${escapeHtml(entry.loc)}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`),
        ...entries.map((entry) => `  <url>
    <loc>${escapeHtml(articleUrl(entry.slug))}</loc>
    <lastmod>${escapeHtml((entry.modifiedAt || `${entry.publicationDate}T12:00:00.000Z`).slice(0, 10))}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`),
    ].join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/** The shape the landing page's card strip consumes. Never internal metadata. */
function toCard(post) {
    return {
        title: post.title,
        slug: post.slug,
        url: `/news/${post.slug}`,
        excerpt: post.excerpt,
        publicationDate: post.publicationDate,
        publishedAt: post.publishedAt,
        theme: post.theme,
        themeName: getTheme(post.theme)?.name || null,
        image: post.image
            ? {
                url: post.image.imageUrl,
                altText: post.image.altText,
                attributionText: post.image.attributionText,
                licenceName: post.image.licenceName,
                licenceUrl: post.image.licenceUrl,
                sourceUrl: post.image.sourceUrl,
            }
            : null,
    };
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
        // never fired, returning an empty 404 on both landing sites. The served
        // file is the static `landing/robots.txt`, and a test pins the two to
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
