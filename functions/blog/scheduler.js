/**
 * Blog publication scheduler.
 *
 * Runs hourly rather than once a day, on purpose. Each run asks "does today have
 * its article yet" and, if not, offers the day to one theme, the next in the
 * rotation each hour (`dueSlots`). That single design choice gives four
 * properties the requirements ask for, without extra machinery:
 *
 *  - **Idempotent.** A day that holds an article is skipped, and the create is
 *    keyed on the document id, so a duplicate invocation cannot double-publish.
 *  - **Retry-safe.** A retried run recomputes the same slot keys and loses the
 *    create race rather than adding a second article.
 *  - **Recovers from an outage.** If every AI provider was down at 07:00, the
 *    08:00 run publishes the day's article. The day stays open for the rest of
 *    the local day.
 *  - **One article a day.** A run does nothing once any of the day's slots holds
 *    an article, and makes one attempt at most.
 *
 * It never reaches into a previous day: yesterday's missed article is not
 * published today under today's date.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { dueSlots, allSlotsFor, TIMEZONE, THEMES } = require('./pipeline/themes');
const { runSlot, OUTCOME } = require('./pipeline/generate');
const store = require('./store');
const mediaStore = require('./media/credentials');
const { recordSlotRun } = require('./runLedger');

/**
 * Whether the day already has its article: any of its three slots filled. A
 * deleted article counts, because `slotIsFilled` sees its tombstone; deleting
 * the day's article does not invite a second one (docs/news-and-insights.md).
 */
async function dayIsTaken(publicationDate) {
    const day = allSlotsFor(publicationDate);
    return (await store.unfilledSlots(day)).length < day.length;
}

/**
 * Does the work. Exported separately from the scheduled wrapper so it can be
 * driven directly by tests and by the manual catch-up callable.
 */
async function publishDueSlots({
    now = Date.now(), fetchImpl, aiDeps, mediaCredentials, trigger = 'scheduled',
} = {}) {
    const slots = dueSlots(now);
    if (slots.length === 0 || await dayIsTaken(slots[0].publicationDate)) {
        return { attempted: 0, published: 0, results: [], dueCount: slots.length };
    }

    const credentials = mediaCredentials || await mediaStore.readAllMediaCredentials();
    const results = [];
    let published = 0;

    for (const slot of slots) {
        let result;
        try {
            result = await runSlot(slot, { store, mediaCredentials: credentials, fetchImpl, aiDeps, now });
        } catch (error) {
            // Recorded as a failed generation rather than failing the run, so the
            // ledger says so. Message only: article drafts and provider bodies
            // never reach a log.
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

        // The ledger row. Every outcome, not only the failures and not only the
        // successes: a refusal used to exist nowhere but this console line, so
        // "yesterday's 07:00 article is missing" had no answer in the product.
        // `recordSlotRun` never throws — a ledger write must not turn a published
        // article into a failed run.
        await recordSlotRun({
            outcome: result.outcome,
            slot: { key: slot.key, themeId: slot.themeId, publicationDate: slot.publicationDate },
            detail: result.detail || null,
            slug: result.post?.slug || null,
            stage: result.stage || null,
            trigger,
            transactions: result.transactions,
            verification: result.verification,
            providerId: result.providerId,
            model: result.model,
            fallbackCount: result.fallbackCount,
        });

        // Counts and outcomes only.
        console.log(
            `[blog/scheduler] ${slot.key} -> ${result.outcome}${result.detail ? ` (${result.detail})` : ''}`,
        );
    }

    return { attempted: results.length, published, results, dueCount: slots.length };
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
module.exports.THEMES = THEMES;
