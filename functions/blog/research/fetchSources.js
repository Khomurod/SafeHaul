/**
 * Fetches and normalizes research feeds.
 *
 * A deliberately small RSS/Atom reader rather than a dependency: the shapes we
 * accept are narrow, and a parser that cannot resolve external entities or
 * follow references has far less surface than a general-purpose XML library.
 * Feed text is treated as untrusted input throughout — it is escaped before it
 * reaches a prompt and never interpreted as markup.
 */

const { SOURCES, USER_AGENT, KIND, getSource } = require('./sources');

const FETCH_TIMEOUT_MS = 12000;
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_FEED_BYTES = 3 * 1024 * 1024;
const MAX_TITLE_CHARS = 300;
const MAX_SUMMARY_CHARS = 1200;

/** Decodes the small set of XML entities feeds actually use. */
function decodeEntities(text) {
    return String(text)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => {
            const point = Number(code);
            return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
        })
        .replace(/&amp;/g, '&');
}

/** Strips tags and collapses whitespace. Feed summaries routinely contain HTML. */
function stripMarkup(text) {
    return decodeEntities(String(text).replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function firstTag(xml, ...names) {
    for (const name of names) {
        const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
        if (match) return stripMarkup(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    }
    return '';
}

/** Atom puts the URL in an attribute rather than element text. */
function firstLink(xml) {
    const element = firstTag(xml, 'link');
    if (element && /^https?:\/\//i.test(element)) return element;
    const attr = /<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(xml);
    return attr ? decodeEntities(attr[1]) : '';
}

function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Splits a feed into item blocks and normalizes each one.
 *
 * @returns {Array<{ title, url, summary, publishedAt }>}
 */
function parseFeed(xml) {
    const blocks = String(xml).match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) || [];
    const items = [];

    for (const block of blocks.slice(0, MAX_ITEMS_PER_SOURCE)) {
        const title = firstTag(block, 'title').slice(0, MAX_TITLE_CHARS);
        const url = firstLink(block);
        if (!title || !/^https?:\/\//i.test(url)) continue;

        items.push({
            title,
            url,
            summary: firstTag(block, 'description', 'summary', 'content').slice(0, MAX_SUMMARY_CHARS),
            publishedAt: parseDate(
                firstTag(block, 'pubDate', 'published', 'updated', 'dc:date'),
            ),
        });
    }
    return items;
}

/** The Federal Register API returns JSON, not a feed. */
function parseFederalRegister(payload) {
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results.slice(0, MAX_ITEMS_PER_SOURCE).map((entry) => ({
        title: String(entry.title || '').slice(0, MAX_TITLE_CHARS),
        url: entry.html_url || entry.pdf_url || '',
        summary: String(entry.abstract || entry.action || '').slice(0, MAX_SUMMARY_CHARS),
        publishedAt: parseDate(entry.publication_date),
        documentType: entry.type || null,
    })).filter((item) => item.title && /^https?:\/\//i.test(item.url));
}

/**
 * Fetches one source. Never throws: a single unreachable publisher must not
 * stop the day's publication, so failures are reported as an empty item list
 * with a reason.
 */
async function fetchSource(source, { fetchImpl } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    if (typeof doFetch !== 'function') {
        return { sourceId: source.id, items: [], error: 'no-fetch-implementation' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await doFetch(source.url, {
            method: 'GET',
            headers: {
                'User-Agent': USER_AGENT,
                Accept: source.kind === KIND.JSON_API
                    ? 'application/json'
                    : 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            },
            signal: controller.signal,
            redirect: 'follow',
        });

        if (!response.ok) {
            // A 403 or 429 here is a publisher telling us to back off. It is
            // recorded and respected, not retried around.
            return { sourceId: source.id, items: [], error: `http-${response.status}` };
        }

        if (source.kind === KIND.JSON_API) {
            const payload = await response.json();
            return { sourceId: source.id, items: parseFederalRegister(payload), error: null };
        }

        const text = await response.text();
        if (text.length > MAX_FEED_BYTES) {
            return { sourceId: source.id, items: [], error: 'feed-too-large' };
        }
        return { sourceId: source.id, items: parseFeed(text), error: null };
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return { sourceId: source.id, items: [], error: aborted ? 'timeout' : 'fetch-failed' };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetches every requested source and returns a flat, decorated item list.
 *
 * @param {object} [options]
 * @param {string[]} [options.sourceIds] defaults to every registered source
 * @param {number} [options.maxAgeDays] drops items older than this
 * @returns {Promise<{ items: Array, errors: Array }>}
 */
async function gatherSourceItems({ sourceIds, maxAgeDays = 10, fetchImpl, now = Date.now() } = {}) {
    const selected = sourceIds
        ? sourceIds.map(getSource).filter(Boolean)
        : SOURCES;

    const results = await Promise.all(selected.map((source) => fetchSource(source, { fetchImpl })));

    const cutoff = now - (maxAgeDays * 24 * 60 * 60 * 1000);
    const items = [];
    const errors = [];

    for (const result of results) {
        if (result.error) {
            errors.push({ sourceId: result.sourceId, error: result.error });
            continue;
        }
        const source = getSource(result.sourceId);
        for (const item of result.items) {
            // An undated item is kept: some government feeds omit a date, and
            // dropping them would silently lose primary sources.
            if (item.publishedAt && item.publishedAt.getTime() < cutoff) continue;
            items.push({
                ...item,
                sourceId: source.id,
                publisher: source.publisher,
                tier: source.tier,
                topics: source.topics,
                publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
                retrievedAt: new Date(now).toISOString(),
            });
        }
    }

    return { items, errors };
}

module.exports = {
    gatherSourceItems,
    fetchSource,
    parseFeed,
    parseFederalRegister,
    stripMarkup,
    decodeEntities,
    FETCH_TIMEOUT_MS,
    MAX_ITEMS_PER_SOURCE,
};
