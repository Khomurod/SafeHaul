/**
 * Which stories are candidates for a slot.
 *
 * The relevance gate, the per-theme candidate list and its ordering. Extracted
 * from `generate.js`; `runSlot` consumes `buildCandidates` and never looks at
 * an item this module refused.
 */

const dedupe = require('./dedupe');

/** Candidate stories considered per slot. */
const MAX_CANDIDATES = 12;

/**
 * Whether an item is actually about road freight.
 *
 * ## Why a feed's topics are not enough
 *
 * `gatherSourceItems` stamps every item with **its source's** declared topics,
 * not topics derived from the item itself. `federal-register-dot` queries the
 * whole Department of Transportation, so an FAA airspace notice, an FRA
 * locomotive rule and a TVA environmental finding all arrive tagged
 * `regulation, compliance, freight-market` and all pass a theme-topic filter.
 *
 * That is not a hypothetical. On 2026-08-03 the twelve top candidates for the
 * industry-news slot were, in order: high-speed train noise standards, three VHF
 * omnidirectional range amendments, Class D/E airspace over Morgantown WV, a TVA
 * categorical exclusion, an unleaded aviation gasoline transition plan,
 * locomotive engineer certification, and Jet Route J-24. Not one concerned
 * trucking. A trucking publication that runs an article about jet routes is
 * worse than one that runs nothing, so this gate is deliberately applied before
 * anything reaches an editor or a model.
 *
 * A keyword gate is crude, and it is chosen over asking a model precisely
 * because it is deterministic, free, and cannot be talked into approving an
 * aviation notice. It is a floor on relevance, not a judgement of newsworthiness
 * — that judgement stays with topic selection, further down.
 *
 * If this proves too narrow the fix is to add terms here, not to remove the
 * gate: the failure it prevents is publishing off-topic content under
 * SafeHaul's name.
 */
const ROAD_FREIGHT_PATTERN = new RegExp([
    'truck', 'trucking', 'motor carrier', 'motor-carrier', 'commercial motor vehicle', '\\bcmv\\b',
    'tractor[- ]trailer', 'semi[- ]trailer', '\\bfmcsa\\b', 'hours of service', '\\bhos\\b',
    'commercial driver', '\\bcdl\\b', 'electronic logging', '\\beld\\b', 'drayage',
    'freight broker', 'for-hire carrier', 'owner[- ]operator', 'fleet safety', 'roadside inspection',
    'driver qualification', 'drug and alcohol clearinghouse', 'unified carrier registration',
    'hazardous materials transport', 'interstate trucking', 'highway freight', 'driver shortage',
].join('|'), 'i');

function isRoadFreightRelevant(item) {
    return ROAD_FREIGHT_PATTERN.test(`${item?.title || ''} ${item?.summary || ''}`);
}

/**
 * Builds the candidate list for a theme from gathered items.
 *
 * For a regulatory theme, candidates are ordered primary-source-first, because
 * an article about a rule should be written from the rule.
 */
function buildCandidates(items, theme) {
    const wanted = new Set(theme.topics);
    const relevant = items
        .filter((item) => item.topics.some((topic) => wanted.has(topic)))
        // Feed topics are coarse; the item must be about road freight itself.
        .filter(isRoadFreightRelevant);

    const seen = new Set();
    const deduped = [];
    for (const item of relevant) {
        const key = dedupe.canonicalizeUrl(item.url) || dedupe.normalizeTitle(item.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    deduped.sort((a, b) => {
        if (theme.requiresPrimarySource && a.tier !== b.tier) return a.tier === 'primary' ? -1 : 1;
        // A ten-page rule supports an article; a one-page exemption withdrawal
        // does not, however recent it is. Federal Register documents carry
        // `pageLength`, so prefer substance before recency where it is known.
        // Without this, the freshest candidate is routinely a one-paragraph
        // notice and the resulting draft is honestly too short to publish.
        const weightA = Number.isFinite(a.pageLength) ? a.pageLength : 0;
        const weightB = Number.isFinite(b.pageLength) ? b.pageLength : 0;
        if (theme.requiresPrimarySource && weightA !== weightB) return weightB - weightA;
        const dateA = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const dateB = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return dateB - dateA;
    });

    return deduped.slice(0, MAX_CANDIDATES);
}

module.exports = {
    MAX_CANDIDATES,
    ROAD_FREIGHT_PATTERN,
    isRoadFreightRelevant,
    buildCandidates,
};
