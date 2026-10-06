/**
 * Daily themes, publication slots and America/Chicago date handling.
 *
 * One article publishes every calendar day. The day's theme rotates through the
 * three, so each comes round every third day; when the day's theme has nothing
 * it may publish (no current sources, only repeats, a refused draft), the next
 * run offers the day to the next theme. It was three a day, one per theme, until
 * the owner chose fewer articles in October 2026.
 *
 * The unique key for a publication is `${publicationDate}_${themeId}`, which is
 * what makes the whole pipeline idempotent: a scheduler retry, a duplicate
 * delivery or a catch-up run for a missed slot all compute the same key and the
 * second write is refused. The scheduler closes the day once any of its keys
 * holds an article.
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

/** Local hour at or after which the day's article may publish. */
const PUBLISH_HOUR = 7;

/**
 * The three themes. Distinct by design: three different subjects, not one story
 * written three ways.
 */
const THEMES = Object.freeze([
    {
        id: 'industry-news',
        slotIndex: 0,
        name: 'Industry news and regulation',
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

/** The day's themes in the order they are offered the day: its own first, then the rest. */
function themesInOrderFor(publicationDate) {
    // Days since the epoch, as the SafeHaul theme already counts them to rotate
    // its features: stateless, and the same answer on every run of the day.
    const day = Math.floor(Date.parse(`${publicationDate}T00:00:00Z`) / 86400000);
    return THEMES.map((_, offset) => THEMES[(day + offset) % THEMES.length]);
}

/**
 * Which slot is due at this instant: one, or none before `PUBLISH_HOUR`.
 *
 * Each hourly run from `PUBLISH_HOUR` offers the day to one theme: the first run
 * to the day's own, the next run to the next theme in the rotation, and so on.
 * A theme with nothing to publish passes the day on an hour later instead of
 * holding it, and a run makes one attempt at most, which fits the function's
 * timeout. The scheduler does nothing once any of the day's slots holds an
 * article. It never reaches into a previous day — yesterday's missed article is
 * not published today under today's date.
 *
 * @param {Date|number} [at]
 * @returns {Array<{ themeId: string, publicationDate: string, key: string, slotIndex: number }>}
 */
function dueSlots(at = Date.now()) {
    const hour = localHourFor(at);
    if (hour < PUBLISH_HOUR) return [];
    const publicationDate = publicationDateFor(at);
    const theme = themesInOrderFor(publicationDate)[(hour - PUBLISH_HOUR) % THEMES.length];

    return [{
        themeId: theme.id,
        publicationDate,
        key: slotKey(publicationDate, theme.id),
        slotIndex: theme.slotIndex,
    }];
}

/** Every slot for a date, due or not: what the scheduler reads to know whether the day has its article. */
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
    PUBLISH_HOUR,
    THEMES,
    THEME_IDS: Object.freeze(THEMES.map((theme) => theme.id)),
    getTheme,
    publicationDateFor,
    localHourFor,
    slotKey,
    themesInOrderFor,
    dueSlots,
    allSlotsFor,
};
