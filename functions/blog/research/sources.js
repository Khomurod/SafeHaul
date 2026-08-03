/**
 * The approved research source registry.
 *
 * The blog is a factual publication about a regulated industry, so where a
 * claim comes from matters more than how fluent the sentence is. An AI model
 * that generates text is not thereby a trustworthy source of current events;
 * everything factual in a SafeHaul article must trace to an entry in this list.
 *
 * Rules encoded here:
 *  - Official government feeds and APIs are `primary`. A regulatory claim needs
 *    at least one of them, enforced in `../pipeline/factPackage.js`.
 *  - Trade publications are `secondary`. They can corroborate and can suggest
 *    what is newsworthy, but cannot on their own support a claim about a rule.
 *  - Only RSS, Atom and official JSON APIs are listed. There is no arbitrary
 *    HTML scraping, no paywall circumvention and no republication: SafeHaul
 *    reads headlines and summaries to decide what to write about, then writes
 *    its own article and links back.
 */

const TIER = Object.freeze({
    /** Government or the body that issued the thing being reported. */
    PRIMARY: 'primary',
    /** Reputable trade press with a public feed. */
    SECONDARY: 'secondary',
});

const KIND = Object.freeze({
    RSS: 'rss',
    ATOM: 'atom',
    JSON_API: 'json_api',
});

/**
 * Requests identify SafeHaul honestly, so a publisher who wants to block us
 * can. Anonymous scraping of a source that has asked not to be scraped is
 * exactly what this registry exists to prevent.
 */
const USER_AGENT = 'SafeHaulNewsBot/1.0 (+https://safehaul.io/news; editorial@safehaul.io)';

const SOURCES = Object.freeze([
    {
        id: 'federal-register-fmcsa',
        publisher: 'Federal Register',
        description: 'Rules, proposed rules and notices issued by the Federal Motor Carrier Safety Administration.',
        tier: TIER.PRIMARY,
        kind: KIND.JSON_API,
        // The Federal Register's documented public API. No key required.
        url: 'https://www.federalregister.gov/api/v1/documents.json'
            + '?per_page=20&order=newest'
            + '&conditions[agencies][]=federal-motor-carrier-safety-administration',
        topics: ['regulation', 'compliance', 'safety'],
        licenceNote: 'US Government work; documents are in the public domain. SafeHaul links and summarises rather than republishing.',
    },
    {
        id: 'federal-register-dot',
        publisher: 'Federal Register',
        description: 'Department of Transportation rules and notices.',
        tier: TIER.PRIMARY,
        kind: KIND.JSON_API,
        url: 'https://www.federalregister.gov/api/v1/documents.json'
            + '?per_page=20&order=newest'
            + '&conditions[agencies][]=transportation-department',
        topics: ['regulation', 'compliance', 'freight-market'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'fmcsa-newsroom',
        publisher: 'FMCSA',
        description: 'FMCSA press releases and announcements.',
        tier: TIER.PRIMARY,
        kind: KIND.RSS,
        url: 'https://www.fmcsa.dot.gov/newsroom/feed',
        topics: ['regulation', 'safety', 'enforcement'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'dot-briefing-room',
        publisher: 'US Department of Transportation',
        description: 'Department-level announcements affecting motor carriers.',
        tier: TIER.PRIMARY,
        kind: KIND.RSS,
        url: 'https://www.transportation.gov/briefing-room.xml',
        topics: ['regulation', 'infrastructure', 'freight-market'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'bls-news-releases',
        publisher: 'Bureau of Labor Statistics',
        description: 'Employment and wage releases, used for driver labour-market figures.',
        tier: TIER.PRIMARY,
        kind: KIND.RSS,
        url: 'https://www.bls.gov/feed/bls_latest.rss',
        topics: ['labor-market', 'recruitment', 'wages'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'bts-news',
        publisher: 'Bureau of Transportation Statistics',
        description: 'Freight volume and transportation indicator releases.',
        tier: TIER.PRIMARY,
        kind: KIND.RSS,
        url: 'https://www.bts.gov/newsroom/rss.xml',
        topics: ['freight-market', 'economics'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'ntsb-news',
        publisher: 'National Transportation Safety Board',
        description: 'Highway safety investigations and recommendations.',
        tier: TIER.PRIMARY,
        kind: KIND.RSS,
        url: 'https://www.ntsb.gov/news/Pages/newsroom.aspx/_vti_bin/RSS.svc/news',
        topics: ['safety', 'investigation'],
        licenceNote: 'US Government work; public domain.',
    },
    {
        id: 'ttnews',
        publisher: 'Transport Topics',
        description: 'Trucking industry trade coverage.',
        tier: TIER.SECONDARY,
        kind: KIND.RSS,
        url: 'https://www.ttnews.com/rss.xml',
        topics: ['freight-market', 'regulation', 'fleet-operations'],
        licenceNote: 'Public RSS feed. Headline and summary used to identify topics; SafeHaul writes original copy and links to the source.',
    },
    {
        id: 'freightwaves',
        publisher: 'FreightWaves',
        description: 'Freight market and carrier economics coverage.',
        tier: TIER.SECONDARY,
        kind: KIND.RSS,
        url: 'https://www.freightwaves.com/news/feed',
        topics: ['freight-market', 'economics', 'fleet-operations'],
        licenceNote: 'Public RSS feed. Topic identification and attribution only.',
    },
    {
        id: 'ccj',
        publisher: 'Commercial Carrier Journal',
        description: 'Fleet operations, maintenance and compliance coverage.',
        tier: TIER.SECONDARY,
        kind: KIND.RSS,
        url: 'https://www.ccjdigital.com/rss/all.xml',
        topics: ['fleet-operations', 'compliance', 'recruitment'],
        licenceNote: 'Public RSS feed. Topic identification and attribution only.',
    },
    {
        id: 'overdrive',
        publisher: 'Overdrive',
        description: 'Owner-operator and driver-facing coverage.',
        tier: TIER.SECONDARY,
        kind: KIND.RSS,
        url: 'https://www.overdriveonline.com/rss/all.xml',
        topics: ['recruitment', 'driver-retention', 'regulation'],
        licenceNote: 'Public RSS feed. Topic identification and attribution only.',
    },
]);

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

function getSource(id) {
    return BY_ID.get(id) || null;
}

function primarySources() {
    return SOURCES.filter((source) => source.tier === TIER.PRIMARY);
}

/** Sources whose declared topics overlap the ones a theme cares about. */
function sourcesForTopics(topics) {
    const wanted = new Set(topics);
    return SOURCES.filter((source) => source.topics.some((topic) => wanted.has(topic)));
}

function isPrimary(sourceId) {
    return getSource(sourceId)?.tier === TIER.PRIMARY;
}

module.exports = {
    TIER,
    KIND,
    SOURCES,
    USER_AGENT,
    getSource,
    getSourceIds: () => SOURCES.map((source) => source.id),
    primarySources,
    sourcesForTopics,
    isPrimary,
};
