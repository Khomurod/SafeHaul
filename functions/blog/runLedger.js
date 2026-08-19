/**
 * The publication run ledger.
 *
 * ## Why this exists
 *
 * The pipeline had nine outcomes and recorded none of them. `runSlot` returned
 * `{ outcome, detail }`, `publishDueSlots` collected those into an array, and the
 * array was discarded after one `console.log`. Nothing in Firestore recorded a
 * refusal, so the only surface an operator could look at was `blog_posts` — which
 * by definition holds the runs that *succeeded*.
 *
 * Publication failure was therefore rendered as absence. "Yesterday's 07:00
 * article is missing" had no answer in the product: not whether it was refused
 * for thin sourcing, refused for an unsupported claim, lost a create race, or
 * never ran at all.
 *
 * Worse, the two AI transactions the run made *were* recorded, as successes —
 * because a telemetry success means "a provider answered in a valid shape",
 * which is recorded before the caller ever sees the answer. So the Logs tab
 * showed `article_generation: Success` and `article_fact_check: Success` for a
 * run that published nothing, and a fact-check verdict of `supported: false` is
 * itself a perfectly valid payload. Two green rows, no article.
 *
 * One row per slot per run closes both gaps: it names the stage that refused,
 * and it carries the AI transaction ids so a slot and its provider timeline can
 * be joined in either direction.
 *
 * ## What it deliberately does not hold
 *
 * No article text, no draft, no source body, no prompt, no provider response.
 * `detail` is the pipeline's own short explanation — a bar that was not met, a
 * validation problem, the router's provider/category trail — and is truncated.
 * Everything here is safe to show an operator and nothing is worth keeping
 * beyond the retention window.
 */

const { admin, db } = require('../firebaseAdmin');

const COLLECTION = 'blog_runs';

/**
 * 30 days, matching `ai_telemetry`.
 *
 * The two are read together — a ledger row names the transactions that produced
 * it — so a ledger that outlived its telemetry would keep pointing at timelines
 * that no longer exist. The TTL policy is declared in `firestore.indexes.json`;
 * without it `expiresAt` is an ordinary field and nothing is ever deleted.
 */
const RETENTION_DAYS = 30;

/** Longest a stored explanation may be. Long enough to act on, short enough to scan. */
const MAX_DETAIL_CHARS = 300;

/**
 * Which stage of the pipeline an outcome belongs to.
 *
 * Derived from the outcome in one place rather than stamped at each of the
 * fourteen `return` sites in `pipeline/generate.js`. A field set by hand at every
 * exit is a field one new exit forgets, and the whole value of this ledger is
 * that the stage is always present.
 */
const STAGE = Object.freeze({
    SCHEDULING: 'scheduling',
    SOURCING: 'sourcing',
    GENERATION: 'generation',
    VALIDATION: 'validation',
    CLAIM_CHECK: 'claim_check',
    VERIFICATION: 'verification',
    ORIGINALITY: 'originality',
    IMAGE: 'image',
    PUBLICATION: 'publication',
});

const STAGE_BY_OUTCOME = Object.freeze({
    published: STAGE.PUBLICATION,
    skipped_slot_taken: STAGE.PUBLICATION,
    deferred_to_next_run: STAGE.SCHEDULING,
    skipped_no_sources: STAGE.SOURCING,
    // A repeat is an originality judgement, even though it is made before a word
    // is written.
    skipped_all_duplicates: STAGE.ORIGINALITY,
    skipped_not_original: STAGE.ORIGINALITY,
    failed_generation: STAGE.GENERATION,
    skipped_validation: STAGE.VALIDATION,
    // Deliberately distinct from `verification`. The deterministic SafeHaul claim
    // check and the source-backed AI fact-check refuse for different reasons and
    // an operator's next step differs: one means the draft over-claimed about
    // SafeHaul, the other that a factual claim was not supported by its sources.
    skipped_prohibited_claim: STAGE.CLAIM_CHECK,
    skipped_unsupported_claims: STAGE.VERIFICATION,
});

const KNOWN_STAGES = new Set(Object.values(STAGE));

/**
 * The stage a result belongs to.
 *
 * Derived from the outcome, unless the pipeline named one explicitly. The
 * override exists for exactly one case today and it is a real one: an image with
 * incomplete licence metadata is refused with the `skipped_validation` outcome,
 * and calling that a validation problem would hide the only stage an operator
 * could act on. The outcome vocabulary is a published contract, so the stage
 * carries the extra precision rather than the outcome list growing a synonym.
 */
function stageFor(outcome, explicit) {
    if (typeof explicit === 'string' && KNOWN_STAGES.has(explicit)) return explicit;
    return STAGE_BY_OUTCOME[outcome] || STAGE.GENERATION;
}

function stageForOutcome(outcome) {
    return STAGE_BY_OUTCOME[outcome] || STAGE.GENERATION;
}

function shortText(value, limit = MAX_DETAIL_CHARS) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, limit) : null;
}

/**
 * Records one slot's result from one run.
 *
 * Never throws. A ledger write failing must not turn a published article into a
 * failed run, nor a refusal into an exception — the same rule the telemetry
 * module follows, for the same reason.
 *
 * @param {object} entry
 * @param {string} entry.outcome one of the pipeline's OUTCOME values
 * @param {object} entry.slot `{ key, themeId, publicationDate }`
 * @param {string} [entry.detail] the pipeline's own short explanation
 * @param {string} [entry.trigger] `scheduled` or `manual`
 * @param {object} [entry.transactions] `{ generation, verification }` ids
 * @param {object} [entry.verification] `{ supported, unsupportedClaimCount }`
 */
async function recordSlotRun(entry) {
    try {
        const now = Date.now();
        const outcome = shortText(entry?.outcome, 40) || 'failed_generation';

        await db.collection(COLLECTION).add({
            outcome,
            stage: stageFor(outcome, entry?.stage),
            slotKey: shortText(entry?.slot?.key, 60),
            themeId: shortText(entry?.slot?.themeId, 40),
            publicationDate: shortText(entry?.slot?.publicationDate, 10),
            detail: shortText(entry?.detail),
            slug: shortText(entry?.slug, 200),
            trigger: entry?.trigger === 'manual' ? 'manual' : 'scheduled',
            // The join key in both directions. `runAiTask` mints one per call and
            // returns it; the pipeline used to drop it, so a slot and its provider
            // timeline could not be connected by anything at all.
            generationTransactionId: shortText(entry?.transactions?.generation, 64),
            verificationTransactionId: shortText(entry?.transactions?.verification, 64),
            // The fact-check *verdict*, which is not the same fact as whether the
            // fact-check transaction succeeded. `supported: false` is a valid
            // response, so the transaction is a success and the article is
            // correctly refused — and only this field says so.
            verificationSupported: typeof entry?.verification?.supported === 'boolean'
                ? entry.verification.supported
                : null,
            unsupportedClaimCount: Number.isInteger(entry?.verification?.unsupportedClaimCount)
                ? entry.verification.unsupportedClaimCount
                : null,
            providerId: shortText(entry?.providerId, 40),
            model: shortText(entry?.model, 120),
            fallbackCount: Number.isInteger(entry?.fallbackCount) ? entry.fallbackCount : null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(now + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        });
    } catch (error) {
        // Message only, and only to the server log.
        console.error(`[blog/runLedger] Could not record ${entry?.slot?.key || 'a slot'}: ${error?.message || 'unknown'}`);
    }
}

/** Default and maximum page sizes for the console. */
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/**
 * The most recent ledger rows, newest first.
 *
 * Deliberately a single `orderBy` with no server-side equality filter: the
 * console's filters (stage, theme, outcome) run over the returned page, so this
 * needs no composite index and cannot acquire one by accident. The page size is
 * bounded and `truncated` is reported honestly rather than implying completeness.
 */
async function readRecentSlotRuns(limit = DEFAULT_PAGE) {
    const size = Math.min(MAX_PAGE, Math.max(1, Number(limit) || DEFAULT_PAGE));
    try {
        const snapshot = await db.collection(COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(size)
            .get();

        const entries = snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                outcome: data.outcome || null,
                stage: data.stage || null,
                slotKey: data.slotKey || null,
                themeId: data.themeId || null,
                publicationDate: data.publicationDate || null,
                detail: data.detail || null,
                slug: data.slug || null,
                trigger: data.trigger || null,
                generationTransactionId: data.generationTransactionId || null,
                verificationTransactionId: data.verificationTransactionId || null,
                verificationSupported: typeof data.verificationSupported === 'boolean'
                    ? data.verificationSupported
                    : null,
                unsupportedClaimCount: Number.isInteger(data.unsupportedClaimCount)
                    ? data.unsupportedClaimCount
                    : null,
                providerId: data.providerId || null,
                model: data.model || null,
                fallbackCount: Number.isInteger(data.fallbackCount) ? data.fallbackCount : null,
                at: data.createdAt?.toDate?.()?.toISOString?.() || null,
            };
        });

        return { entries, truncated: entries.length === size };
    } catch (error) {
        console.error(`[blog/runLedger] Could not read the ledger: ${error?.message || 'unknown'}`);
        return { entries: [], truncated: false, unavailable: true };
    }
}

module.exports = {
    COLLECTION,
    RETENTION_DAYS,
    DEFAULT_PAGE,
    MAX_PAGE,
    STAGE,
    STAGE_BY_OUTCOME,
    stageForOutcome,
    stageFor,
    recordSlotRun,
    readRecentSlotRuns,
};
