/**
 * What an article is allowed to draw on, and whether that is enough.
 *
 * The fact package assembled from the candidate list, and the theme's sourcing
 * bar. Extracted from `generate.js`.
 */

const dedupe = require('./dedupe');
const { isPrimary } = require('../research/sources');

/**
 * Assembles the evidence an article is allowed to draw on.
 *
 * Corroborating items are chosen by topic overlap with the lead item, so a
 * two-source article is genuinely about one story rather than two unrelated
 * ones stapled together.
 */
function buildFactPackage(lead, candidates, theme) {
    const sources = [lead];
    const leadTokens = dedupe.topicTokens(`${lead.title} ${lead.summary || ''}`);

    for (const candidate of candidates) {
        if (sources.length >= 4) break;
        if (candidate === lead) continue;
        if (dedupe.canonicalizeUrl(candidate.url) === dedupe.canonicalizeUrl(lead.url)) continue;

        const similarity = dedupe.tokenSimilarity(
            leadTokens,
            dedupe.topicTokens(`${candidate.title} ${candidate.summary || ''}`),
        );
        if (similarity >= 0.15) sources.push(candidate);
    }

    return sources.map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        summary: source.summary,
        publishedAt: source.publishedAt,
        sourceId: source.sourceId,
        tier: source.tier,
        retrievedAt: source.retrievedAt,
        // Regulatory context the model can legitimately explain to a carrier.
        action: source.action || null,
        docketIds: source.docketIds || [],
        cfrReferences: source.cfrReferences || [],
        // Populated for the lead only, by runSlot, after selection.
        fullText: source.fullText || null,
    }));
}

/**
 * Whether the evidence meets the theme's sourcing bar.
 *
 * Two rules, in priority order:
 *
 *  1. A claim about a law, rule or government action needs the body that issued
 *    it. This is absolute — a regulatory article sourced only from trade
 *    coverage is refused however many outlets reported it.
 *  2. Corroboration is required "where practical". Two independent sources is
 *    the target, but a single *primary* source already satisfies the intent: an
 *    article written from the Federal Register notice itself is better evidenced
 *    than one written from two publishers summarising it. Requiring a second
 *    source in that case would refuse the best-sourced article we can produce.
 *
 * A single *secondary* source is never enough.
 */
function sourcingIsSufficient(sources, theme) {
    if (!theme.requiresSources) return { ok: true, reason: null };
    if (sources.length === 0) return { ok: false, reason: 'no sources' };

    const hasPrimary = sources.some((source) => isPrimary(source.sourceId));

    if (theme.requiresPrimarySource && !hasPrimary) {
        return { ok: false, reason: 'no primary or official source' };
    }

    if (sources.length < theme.minSources && !hasPrimary) {
        return {
            ok: false,
            reason: `needs ${theme.minSources} sources or one primary source, has ${sources.length} secondary`,
        };
    }

    return { ok: true, reason: null };
}

module.exports = {
    buildFactPackage,
    sourcingIsSufficient,
};
