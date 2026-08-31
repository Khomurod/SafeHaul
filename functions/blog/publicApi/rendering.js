/**
 * The public blog's rendering vocabulary: the site constants, the URL, date
 * and reading-time helpers, the BlogPosting JSON-LD, and the card shape the
 * landing page consumes. Extracted verbatim from `publicApi.js`, whose header
 * states the security posture everything here serves under.
 */

const { safeUrl, wordCount } = require('../pipeline/sanitize');
const { getTheme } = require('../pipeline/themes');

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
 * Reading time, in whole minutes, from the article's own blocks.
 *
 * Derived at render time rather than stored, so it can never disagree with the
 * body a reader is looking at. 220 words per minute is the usual estimate for
 * prose read on a screen; a floor of one minute keeps a short explainer from
 * claiming "0 min read".
 */
function readingMinutes(post) {
    return Math.max(1, Math.round(wordCount(post.contentBlocks) / 220));
}

/**
 * A usable image `src`, or null.
 *
 * `safeUrl` builds a `URL` with no base, so it rejects every root-relative path —
 * including `/assets/images/news-fallback.svg`, which is what
 * `functions/blog/media/imageProviders.js` stores as FALLBACK_IMAGE. `renderCard`
 * therefore dropped the illustration from every post that fell back, leaving the
 * index a ragged mix of entries with and without a figure. `renderFigure` papered
 * over the same problem by falling back to the raw stored value, which would
 * happily emit a `javascript:` src.
 *
 * One helper for both: an absolute http(s) URL, or one of our own root-relative
 * asset paths. The `(?!\/)` matters — without it `//evil.example/x` is a
 * protocol-relative URL that passes as a path.
 */
function safeImageSrc(value) {
    const absolute = safeUrl(value);
    if (absolute) return absolute;
    const raw = typeof value === 'string' ? value.trim() : '';
    return /^\/(?!\/)[A-Za-z0-9._~\-/]*$/.test(raw) ? raw : null;
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

module.exports = {
    ORIGIN,
    SITE_NAME,
    SECTION_NAME,
    AUTHOR,
    LATEST_LIMIT,
    INDEX_LIMIT,
    CACHE_CONTROL,
    NO_STORE,
    articleUrl,
    formatDisplayDate,
    isoDate,
    readingMinutes,
    safeImageSrc,
    renderJsonLd,
    toCard,
};
