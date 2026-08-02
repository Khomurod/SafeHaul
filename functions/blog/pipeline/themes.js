/**
 * Daily themes, publication slots and America/Chicago date handling.
 *
 * Three articles publish every calendar day, one per theme. The unique key for
 * a publication is `${publicationDate}:${themeId}`, which is what makes the
 * whole pipeline idempotent: a scheduler retry, a duplicate delivery or a
 * catch-up run for a missed slot all compute the same key and the second write
 * is refused.
 *
 * ## Why the timezone work is done with Intl and not arithmetic
 *
 * The audience is the US trucking industry, so the publication day is the
 * America/Chicago calendar day. Deriving that by subtracting a fixed offset
 * from UTC is wrong twice a year: on the spring-forward day one local hour does
 * not exist, and on the fall-back day one local hour happens twice. Either
 * mistake produces a duplicate slot or a missing date.
 *
 * `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'` asks the platform's
 * own timezone database what the local wall-clock date and hour are at a given
 * instant, which is correct across both transitions by construction. The repo
 * already uses this approach in `functions/statsAggregator.js`.
 */

const TIMEZONE = 'America/Chicago';

/**
 * The three themes. Distinct by design: the day's three articles must cover
 * three different subjects, not one story written three ways.
 */
const THEMES = Object.freeze([
    {
        id: 'industry-news',
        slotIndex: 0,
        name: 'Industry news and regulation',
        /** Local hour at or after which this slot may publish. */
        publishHour: 7,
        description: 'Trucking news, regulation, safety, freight-market or industry developments.',
        topics: ['regulation', 'compliance', 'safety', 'freight-market', 'enforcement', 'economics', 'infrastructure'],
        requiresSources: true,
        /** A claim about a rule needs the body that issued it. */
        requiresPrimarySource: true,
        minSources: 2,
        editorialAngle: 'Report what changed, who it affects, and what a carrier should do about it. Separate the facts from your reading of them.',
    },
    {
        id: 'recruitment',
        slotIndex: 1,
        name: 'Recruiting and retention',
        publishHour: 12,
        description: 'Driver recruitment, retention and fleet-growth guidance.',
        topics: ['recruitment', 'driver-retention', 'labor-market', 'wages', 'fleet-operations'],
        requiresSources: true,
        requiresPrimarySource: false,
        minSources: 1,
        editorialAngle: 'Give practical guidance a recruiter or fleet manager can act on this week. Support any figure with a named source.',
    },
    {
        id: 'safehaul-education',
        slotIndex: 2,
        name: 'SafeHaul and product education',
        publishHour: 17,
        description: 'A SafeHaul capability, use case, or an explanation of an industry problem SafeHaul addresses.',
        topics: ['fleet-operations', 'compliance', 'recruitment'],
        // This theme is written from the approved capability package rather
        // than from the news, so it does not require external sources.
        requiresSources: false,
        requiresPrimarySource: false,
        minSources: 0,
        editorialAngle: 'Explain a real problem a carrier has, then how SafeHaul helps. Only describe capabilities in the approved knowledge package, and state limitations plainly.',
    },
]);

const THEMES_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

function getTheme(themeId) {
    return THEMES_BY_ID.get(themeId) || null;
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    hour12: false,
});

/**
 * The America/Chicago calendar date at an instant, as `YYYY-MM-DD`.
 *
 * @param {Date|number} [at]
 * @returns {string}
 */
function publicationDateFor(at = Date.now()) {
    // en-CA formats as YYYY-MM-DD, which is why it is used here rather than
    // reassembling parts by hand.
    return dateFormatter.format(at instanceof Date ? at : new Date(at));
}

/**
 * The America/Chicago local hour at an instant, 0–23.
 *
 * @param {Date|number} [at]
 * @returns {number}
 */
function localHourFor(at = Date.now()) {
    const formatted = hourFormatter.format(at instanceof Date ? at : new Date(at));
    // en-GB with hour12:false yields "24" at midnight on some platforms.
    const hour = Number(formatted.replace(/[^\d]/g, ''));
    return hour === 24 ? 0 : hour;
}

/**
 * The unique publication key. This is the document id in Firestore, so
 * uniqueness is enforced by the database rather than by a check-then-write.
 *
 * @param {string} publicationDate `YYYY-MM-DD`
 * @param {string} themeId
 */
function slotKey(publicationDate, themeId) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) {
        throw new Error(`Invalid publication date "${publicationDate}".`);
    }
    if (!THEMES_BY_ID.has(themeId)) {
        throw new Error(`Unknown blog theme "${themeId}".`);
    }
    return `${publicationDate}_${themeId}`;
}

/**
 * Which slots are due at this instant.
 *
 * A slot is due once its local hour has arrived and stays due for the rest of
 * the local day, which is what lets a later run fill a slot missed because
 * every provider was down at the time. It never reaches into a previous day —
 * yesterday's missed article is not published today under today's date.
 *
 * @param {Date|number} [at]
 * @returns {Array<{ themeId: string, publicationDate: string, key: string, slotIndex: number }>}
 */
function dueSlots(at = Date.now()) {
    const publicationDate = publicationDateFor(at);
    const hour = localHourFor(at);

    return THEMES
        .filter((theme) => hour >= theme.publishHour)
        .map((theme) => ({
            themeId: theme.id,
            publicationDate,
            key: slotKey(publicationDate, theme.id),
            slotIndex: theme.slotIndex,
        }));
}

/** Every slot for a date, due or not. Used by the console and by tests. */
function allSlotsFor(publicationDate) {
    return THEMES.map((theme) => ({
        themeId: theme.id,
        publicationDate,
        key: slotKey(publicationDate, theme.id),
        slotIndex: theme.slotIndex,
    }));
}

module.exports = {
    TIMEZONE,
    THEMES,
    THEME_IDS: Object.freeze(THEMES.map((theme) => theme.id)),
    getTheme,
    publicationDateFor,
    localHourFor,
    slotKey,
    dueSlots,
    allSlotsFor,
};
