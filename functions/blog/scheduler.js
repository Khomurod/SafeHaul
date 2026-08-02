/**
 * Blog publication scheduler.
 *
 * Runs hourly rather than three times a day, on purpose. Each run asks "which
 * of today's slots are due and still empty" and fills them. That single design
 * choice gives four properties the requirements ask for, without extra
 * machinery:
 *
 *  - **Idempotent.** A slot already filled is skipped, and the create is keyed
 *    on the document id, so a duplicate invocation cannot double-publish.
 *  - **Retry-safe.** A retried run recomputes the same slot keys and loses the
 *    create race rather than adding a second article.
 *  - **Recovers from an outage.** If every AI provider was down at 07:00, the
 *    08:00 run fills the morning slot. The slot stays due for the rest of the
 *    local day.
 *  - **Never more than one article per date and theme**, because that pair *is*
 *    the primary key.
 *
 * It never reaches into a previous day: yesterday's missed article is not
 * published today under today's date.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { dueSlots, TIMEZONE, THEMES } = require('./pipeline/themes');
const { runSlot, OUTCOME } = require('./pipeline/generate');
const store = require('./store');
const mediaStore = require('./media/credentials');

/**
 * A run publishes at most one article, even when two slots are outstanding.
 * Filling a backlog all at once would put three articles on the site within a
 * minute of each other; the next hourly run picks up the next one.
 */
const MAX_PUBLISHED_PER_RUN = 1;

/**
 * Does the work. Exported separately from the scheduled wrapper so it can be
 * driven directly by tests and by the manual catch-up callable.
 */
async function publishDueSlots({ now = Date.now(), fetchImpl, aiDeps, mediaCredentials } = {}) {
    const slots = dueSlots(now);
    const outstanding = await store.unfilledSlots(slots);

    if (outstanding.length === 0) {
        return { attempted: 0, published: 0, results: [], dueCount: slots.length };
    }

    const credentials = mediaCredentials || await mediaStore.readAllMediaCredentials();
    const results = [];
    let published = 0;

    // Earliest slot first, so a backlog fills in the order it was meant to run.
    outstanding.sort((a, b) => a.slotIndex - b.slotIndex);

    for (const slot of outstanding) {
        if (published >= MAX_PUBLISHED_PER_RUN) {
            results.push({ outcome: 'deferred_to_next_run', slot: { key: slot.key, themeId: slot.themeId } });
            continue;
        }

        let result;
        try {
            // eslint-disable-next-line no-await-in-loop
            result = await runSlot(slot, { store, mediaCredentials: credentials, fetchImpl, aiDeps, now });
        } catch (error) {
            // One slot failing must not stop the others. Message only: article
            // drafts and provider bodies never reach a log.
            console.error(`[blog/scheduler] slot ${slot.key} threw: ${error?.message || 'unknown'}`);
            result = { outcome: OUTCOME.FAILED_GENERATION, slot, detail: 'unhandled error' };
        }

        if (result.outcome === OUTCOME.PUBLISHED) published += 1;

        results.push({
            outcome: result.outcome,
            slot: { key: slot.key, themeId: slot.themeId, publicationDate: slot.publicationDate },
            detail: result.detail || null,
            slug: result.post?.slug || null,
        });

        // Counts and outcomes only.
        console.log(
            `[blog/scheduler] ${slot.key} -> ${result.outcome}${result.detail ? ` (${result.detail})` : ''}`,
        );
    }

    return { attempted: outstanding.length, published, results, dueCount: slots.length };
}

/**
 * Hourly schedule. The timezone is declared so Cloud Scheduler evaluates the
 * cron in America/Chicago; the pipeline separately derives the publication date
 * in the same zone, so the two cannot disagree about which day it is.
 */
exports.publishScheduledBlogPosts = onSchedule({
    schedule: '15 * * * *',
    timeZone: TIMEZONE,
    timeoutSeconds: 540,
    memory: '512MiB',
    retryCount: 2,
    // The legacy Groq binding is the rollback path for the AI credential
    // migration and must be readable here too.
    secrets: ['GROQ_API_KEY'],
}, async () => {
    const summary = await publishDueSlots();
    console.log(
        `[blog/scheduler] due=${summary.dueCount} outstanding=${summary.attempted} published=${summary.published}`,
    );
});

module.exports.publishDueSlots = publishDueSlots;
module.exports.MAX_PUBLISHED_PER_RUN = MAX_PUBLISHED_PER_RUN;
module.exports.THEMES = THEMES;
