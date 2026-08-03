/**
 * Duplicate prevention.
 *
 * Three articles a day for a year is a thousand articles, and the same handful
 * of stories recur constantly in trade coverage. Without this, the blog would
 * publish the same hours-of-service explainer every few weeks in slightly
 * different words — which is worse than publishing nothing, because it looks
 * like padding to a reader and like doorway content to a search engine.
 *
 * Four independent checks, because each catches something the others miss:
 *  1. **Canonical source URL** — the strongest signal. The same underlying
 *     article, however it was retitled.
 *  2. **Normalized title** — the same headline with different punctuation,
 *     casing or filler words.
 *  3. **Topic fingerprint** — the significant terms of the subject, so the same
 *     event reported by two publishers is caught even with no shared URL.
 *  4. **Token overlap** — a similarity ratio, for a rewrite that shares
 *     substance but neither headline nor source.
 *
 * All four look back over the window the store provides, including tombstoned
 * posts: a deleted article still means the topic was covered.
 */

const crypto = require('crypto');

/**
 * Words carrying no topical signal. Kept deliberately short — an aggressive
 * stop list makes distinct topics look identical.
 */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'as', 'at', 'by', 'for',
    'from', 'in', 'into', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can',
    'could', 'should', 'may', 'might', 'must', 'this', 'that', 'these', 'those', 'it',
    'its', 'what', 'when', 'where', 'who', 'how', 'why', 'new', 'now', 'more', 'about',
    'says', 'said', 'after', 'before', 'over', 'under', 'up', 'down', 'out',
]);

/** Similarity at or above this is treated as the same topic. */
const SIMILARITY_THRESHOLD = 0.6;

/** Below this many shared significant tokens, similarity is not meaningful. */
const MIN_SHARED_TOKENS = 3;

/**
 * Lowercases, strips punctuation and collapses whitespace, so "FMCSA Announces
 * New Rule!" and "fmcsa announces new rule" compare equal.
 */
function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Significant terms of a piece of text. */
function topicTokens(text) {
    const tokens = normalizeTitle(text)
        .split(' ')
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
    return [...new Set(tokens)];
}

/**
 * Strips the parts of a URL that vary without changing the destination:
 * scheme, `www.`, tracking parameters, fragment and trailing slash.
 */
function canonicalizeUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch {
        return '';
    }
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
}

/**
 * A stable fingerprint of a topic, from its canonical sources and title terms.
 * Two runs seeing the same story produce the same fingerprint.
 */
function sourceFingerprint({ title, sourceUrls = [] }) {
    const canonical = sourceUrls.map(canonicalizeUrl).filter(Boolean).sort();
    const tokens = topicTokens(title).sort();
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({ canonical, tokens }))
        .digest('hex')
        .slice(0, 32);
}

/** Jaccard similarity of two token sets. */
function tokenSimilarity(tokensA, tokensB) {
    const a = new Set(tokensA);
    const b = new Set(tokensB);
    if (a.size === 0 || b.size === 0) return 0;

    let shared = 0;
    for (const token of a) if (b.has(token)) shared += 1;
    if (shared < MIN_SHARED_TOKENS) return 0;

    return shared / (a.size + b.size - shared);
}

/**
 * Decides whether a candidate topic repeats something recent.
 *
 * @param {object} candidate `{ title, sourceUrls }`
 * @param {Array} recentPosts from `store.recentForDeduplication()`
 * @returns {{ duplicate: boolean, reason: string|null, matchedId: string|null, similarity: number }}
 */
function checkForDuplicate(candidate, recentPosts = []) {
    const candidateTitle = normalizeTitle(candidate.title);
    const candidateTokens = topicTokens(candidate.title);
    const candidateUrls = new Set((candidate.sourceUrls || []).map(canonicalizeUrl).filter(Boolean));
    const candidateFingerprint = sourceFingerprint(candidate);

    let closest = { similarity: 0, id: null };

    for (const post of recentPosts) {
        if (post.sourceFingerprint && post.sourceFingerprint === candidateFingerprint) {
            return { duplicate: true, reason: 'source-fingerprint', matchedId: post.id, similarity: 1 };
        }

        if (candidateTitle && post.normalizedTitle && post.normalizedTitle === candidateTitle) {
            return { duplicate: true, reason: 'normalized-title', matchedId: post.id, similarity: 1 };
        }

        for (const url of post.sourceUrls || []) {
            if (candidateUrls.has(canonicalizeUrl(url))) {
                return { duplicate: true, reason: 'shared-source-url', matchedId: post.id, similarity: 1 };
            }
        }

        const similarity = tokenSimilarity(
            candidateTokens,
            post.topicTokens?.length ? post.topicTokens : topicTokens(post.title),
        );
        if (similarity > closest.similarity) closest = { similarity, id: post.id };
    }

    if (closest.similarity >= SIMILARITY_THRESHOLD) {
        return {
            duplicate: true,
            reason: 'topic-similarity',
            matchedId: closest.id,
            similarity: Number(closest.similarity.toFixed(3)),
        };
    }

    return { duplicate: false, reason: null, matchedId: null, similarity: Number(closest.similarity.toFixed(3)) };
}

/**
 * Picks the first candidate that is not a repeat.
 *
 * Returning null is a legitimate outcome: if every candidate repeats something
 * recent, the correct action is to publish nothing for that slot rather than
 * invent a topic to fill it.
 */
function selectFreshCandidate(candidates, recentPosts) {
    for (const candidate of candidates) {
        const verdict = checkForDuplicate(candidate, recentPosts);
        if (!verdict.duplicate) return { candidate, verdict };
    }
    return { candidate: null, verdict: null };
}

/** Whether the day's articles cover three genuinely different subjects. */
function themesAreDistinct(posts) {
    const themes = posts.map((post) => post.theme);
    if (new Set(themes).size !== themes.length) return false;

    for (let i = 0; i < posts.length; i += 1) {
        for (let j = i + 1; j < posts.length; j += 1) {
            const similarity = tokenSimilarity(
                topicTokens(posts[i].title),
                topicTokens(posts[j].title),
            );
            if (similarity >= SIMILARITY_THRESHOLD) return false;
        }
    }
    return true;
}

module.exports = {
    SIMILARITY_THRESHOLD,
    MIN_SHARED_TOKENS,
    normalizeTitle,
    topicTokens,
    canonicalizeUrl,
    sourceFingerprint,
    tokenSimilarity,
    checkForDuplicate,
    selectFreshCandidate,
    themesAreDistinct,
};
