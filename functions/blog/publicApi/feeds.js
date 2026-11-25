/**
 * The public blog's machine-readable surfaces: the Atom feed and the
 * sitemap. Extracted verbatim from `publicApi.js`.
 */

const { escapeHtml } = require('../pipeline/sanitize');
const {
    ORIGIN,
    SECTION_NAME,
    AUTHOR,
    articleUrl,
    isoDate,
} = require('./rendering');

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

module.exports = {
    renderAtomFeed,
    renderSitemap,
};
