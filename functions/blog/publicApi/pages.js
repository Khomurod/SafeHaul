/**
 * The public blog's HTML pages: the shared shell, the article page, the
 * index, and the not-found page. Extracted verbatim from `publicApi.js`,
 * whose header states the security posture: all text escaped at render time,
 * bodies rebuilt from sanitized structured blocks, no generation metadata.
 */

const { escapeHtml, renderBlocksToHtml, safeUrl } = require('../pipeline/sanitize');
const { getTheme, THEMES } = require('../pipeline/themes');
const {
    ORIGIN,
    SITE_NAME,
    SECTION_NAME,
    AUTHOR,
    articleUrl,
    formatDisplayDate,
    isoDate,
    readingMinutes,
    safeImageSrc,
    renderJsonLd,
} = require('./rendering');

/**
 * The image element plus its required attribution.
 *
 * Attribution is rendered whenever the provider requires it *or* whenever we
 * have it, because crediting a photographer who did not demand it costs
 * nothing and omitting one who did is a licence breach.
 */
function renderFigure(image) {
    if (!image) return '';
    const src = safeImageSrc(image.imageUrl);
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

    // An ordered list, because the styling numbers them: sources are a numbered
    // apparatus in a specification, not a bulleted aside.
    return items ? `<section class="news-sources"><h2>Sources</h2><ol>${items}</ol></section>` : '';
}


/** The shared page shell. Styled by the five sheets in web/assets/css. */
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
<meta name="theme-color" content="#14161A">
<link rel="icon" type="image/svg+xml" href="/assets/images/logo.svg">
<!-- Both faces are self-hosted and news-foundation.css declares them, so they
     are preloaded here. THESE FIVE FILES ARE ONE STYLESHEET AND THIS ORDER IS THE
     CASCADE: they were cut out of the retired marketing site's 3447-line sheet at
     its own section boundaries, in its source order, so re-ordering these tags
     makes a late override lose to an early rule it used to beat. The version
     query moves on all five together or a visitor gets a mixed stylesheet. -->
<link rel="preload" href="/assets/fonts/archivo-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/geist-mono-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/news-foundation.css?v=1">
<link rel="stylesheet" href="/assets/css/news-chrome.css?v=1">
<link rel="stylesheet" href="/assets/css/news-article.css?v=1">
<link rel="stylesheet" href="/assets/css/news-footer.css?v=1">
<link rel="stylesheet" href="/assets/css/news-responsive.css?v=1">
${extraHead}
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<!--
  EVERY LINK HERE MUST RESOLVE ON THIS SITE. This used to carry the marketing
  site's six links (/, /#features, /#why-safehaul, /#pricing, /#faq); those pages
  are gone, and an article whose header is full of 404s reads as an abandoned
  site. /news is home now, which is why the logo points there.

  DELIBERATELY WITHOUT A MOBILE TOGGLE: these pages ship no JavaScript, and a
  toggle wired to nothing is a control that does not work. news-responsive.css
  keeps the links reachable below 900px with a :not(:has(.mobile-menu-toggle))
  rule on .navbar. That rule and this omission are one decision — change either
  and the blog loses its navigation on a phone.
-->
<nav id="navbar" class="navbar">
  <div class="nav-container">
    <a href="/news" class="logo-link" aria-label="SafeHaul News &amp; Insights">
      <img src="/assets/images/logo.svg" alt="" class="logo" width="152" height="132">
      <span class="logo-text">SafeHaul</span>
    </a>
    <div class="nav-links">
      <a href="/news" class="nav-link" aria-current="page">News &amp; Insights</a>
      <a href="#footer" class="nav-link">Contact</a>
    </div>
    <div class="nav-cta">
      <a href="https://app.safehaul.io" rel="noopener" class="btn btn-primary">Log in</a>
    </div>
  </div>
</nav>
<main id="main">
${bodyHtml}
</main>
<footer id="footer" class="footer-section">
  <div class="footer-grid">
    <div class="footer-brand">
      <a href="/news" class="logo-link" aria-label="SafeHaul News &amp; Insights">
        <img src="/assets/images/logo-mono.svg" alt="" class="footer-logo" width="152" height="132">
        <span class="logo-text">SafeHaul</span>
      </a>
      <p>Driver hiring and DOT compliance software for trucking carriers.</p>
    </div>
    <!-- The Product column went with the marketing pages it linked. The Privacy
      Policy link did NOT: that page outlived the site, is served standalone from
      web/privacy.html, and is the only public statement of how SafeHaul handles
      personal data. Remove it and this link in the same change — a policy link
      that 404s is worse than no link at all. -->
    <nav class="footer-links" aria-label="Resources">
      <h2 class="footer-heading">Resources</h2>
      <a href="/news">News &amp; Insights</a>
      <a href="/news/feed.xml">Article feed</a>
      <a href="/privacy.html">Privacy Policy</a>
      <a href="https://app.safehaul.io" rel="noopener">Log in</a>
    </nav>
    <div class="footer-contact">
      <h2 class="footer-heading">Contact</h2>
      <a href="mailto:info@safehaul.io">info@safehaul.io</a>
    </div>
  </div>
  <div class="footer-bottom">
    <p>&copy; 2026 SafeHaul. All rights reserved.</p>
    <p class="footer-disclaimer">SafeHaul supports your compliance process. It is not a law firm and nothing
    here is advice about your regulatory obligations.</p>
  </div>
</footer>
</body>
</html>`;
}

function renderArticlePage(post) {
    const description = post.seo?.metaDescription || post.excerpt;
    const theme = getTheme(post.theme);

    const minutes = readingMinutes(post);
    const themeName = theme?.name || SECTION_NAME;

    // The revision block. A specification carries its metadata in the sheet
    // margin, and at 1200px and up stylesheet section 16 moves this there; below
    // that it is `display: none`, because the same three facts are already in the
    // header above and repeating them in the body would be noise, not fallback.
    const revisionBlock = `<aside class="news-article-meta" aria-hidden="true">
    <dl>
      <dt>Section</dt><dd>${escapeHtml(themeName)}</dd>
      <dt>Published</dt><dd>${escapeHtml(formatDisplayDate(post.publicationDate))}</dd>
      <dt>Author</dt><dd>${escapeHtml(AUTHOR)}</dd>
      <dt>Reading time</dt><dd>${minutes} min</dd>
    </dl>
  </aside>`;

    const body = `<article class="news-article">
  <p class="news-back"><a href="/news">&larr; All News &amp; Insights</a></p>
  <header class="news-article-header">
    <p class="news-eyebrow">${escapeHtml(themeName)}</p>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="news-meta">
      <time datetime="${escapeHtml(isoDate(post))}">${escapeHtml(formatDisplayDate(post.publicationDate))}</time>
      · ${escapeHtml(AUTHOR)} · ${minutes} min read
    </p>
  </header>
  ${revisionBlock}
  ${renderFigure(post.image)}
  <div class="news-body">
${renderBlocksToHtml(post.contentBlocks)}
  </div>
  ${renderSourceList(post.sources)}
  <aside class="news-about">
    <h2>About SafeHaul</h2>
    <p>SafeHaul is a hiring and compliance platform for US trucking carriers, covering
    driver applications, qualification documents, electronic signatures and previous-employment
    verification. <a href="https://app.safehaul.io" rel="noopener">Sign in to SafeHaul</a>.</p>
  </aside>
  <p class="news-disclaimer"><em>This article is general information, not legal advice.
  Confirm how any regulation applies to your operation.</em></p>
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

/**
 * One article as a ruled entry rather than a boxed card.
 *
 * The class names were shared with a homepage strip that `landing/assets/js/main.js`
 * built by hand; that site is gone, but several of them are test-enforced and
 * `web/assets/css/news-article.css` is written against them, so they are still
 * fixed even where the styling changed underneath them. Intrinsic dimensions are declared
 * because every pipeline image is 1200×630 and a card that resizes as its image
 * arrives moves the entry below it.
 */
function renderCard(post) {
    const image = safeImageSrc(post.image?.imageUrl);
    return `<article class="news-card">
  ${image ? `<a href="/news/${escapeHtml(post.slug)}" class="news-card-image" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(image)}" alt="${escapeHtml(post.image.altText || '')}" width="1200" height="630" loading="lazy" decoding="async"></a>` : ''}
  <div class="news-card-body">
    <p class="news-eyebrow">${escapeHtml(getTheme(post.theme)?.name || SECTION_NAME)}</p>
    <h2><a href="/news/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
    <p class="news-card-excerpt">${escapeHtml(post.excerpt)}</p>
    <p class="news-meta"><time datetime="${escapeHtml(isoDate(post))}">${escapeHtml(formatDisplayDate(post.publicationDate))}</time></p>
    <a class="news-read-more" href="/news/${escapeHtml(post.slug)}">Read Article</a>
  </div>
</article>`;
}

/**
 * The index.
 *
 * A sticky rail on the left carrying the three sections the pipeline publishes
 * into, and the ruled entries on the right with the first given a larger figure.
 *
 * The rail is a SIBLING of `.news-grid`, not a replacement for it: a test asserts
 * `.news-grid` still collapses to two columns at 1024px and one at 768px, so its
 * own column behaviour has to survive. The asymmetry lives in the wrapper.
 */
function renderIndexPage(posts) {
    const rail = `<nav class="news-rail" aria-label="What we publish">
    <h2>Sections</h2>
    <ul>${THEMES.map((theme, index) => (
        `<li><span class="n">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(theme.name)}</span></li>`
    )).join('')}</ul>
  </nav>`;

    const body = `<section class="news-index">
  <header class="news-index-header">
    <h1>${escapeHtml(SECTION_NAME)}</h1>
    <p>Trucking news and regulation, recruiting and retention guidance, and practical
    explanations of the compliance problems carriers deal with. Published daily,
    every factual claim traced to a named source.</p>
  </header>
  <div class="news-index-layout">
    ${rail}
    ${posts.length
        ? `<div class="news-grid">${posts.map(renderCard).join('\n')}</div>`
        : '<p class="news-empty">The first articles are on their way. Please check back shortly.</p>'}
  </div>
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

module.exports = {
    renderFigure,
    renderSourceList,
    renderPage,
    renderArticlePage,
    renderCard,
    renderIndexPage,
    renderNotFoundPage,
};
