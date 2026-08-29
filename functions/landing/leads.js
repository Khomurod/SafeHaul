/**
 * Website-lead archive — read only.
 *
 * ## What this is, and what it used to be
 *
 * `landing_leads` holds the leads captured by the marketing site's contact form
 * between 2026-06 and 2026-08. That site has been removed and lead capture
 * retired by owner decision; **the records were deliberately kept**, and this
 * module is the only way anything reads them.
 *
 * Everything that WROTE to this collection is gone: two-step capture, the
 * completion tokens, Telegram delivery, and the delivery-retry path. What that
 * machinery was for is worth stating once, because a future rebuild will face the
 * same problem. Capture used to forward straight to Telegram, so an outage at
 * Telegram lost the customer; the fix was to **write the lead first and attempt
 * delivery second**, downgrading a failure to a stored lead with
 * `delivery.status = 'failed'` that could be retried. Any rebuilt capture should
 * start from that ordering rather than rediscover it.
 *
 * ## Why the delivery fields are still returned
 *
 * They are historical facts about deliveries that already happened or already
 * failed, and dropping them would quietly rewrite the record. Nothing retries
 * them any more.
 *
 * `landing_leads` has no Firestore rule match, so it is Admin-SDK only — the
 * documents carry third-party contact details, and the archive screen reaches
 * them through `listLandingLeads`, never directly.
 */

const { db } = require('../firebaseAdmin');

const LEADS_COLLECTION = 'landing_leads';

/**
 * Lists stored leads, newest first.
 *
 * The cap is deliberate and applies to the CSV export too: the archive screen
 * asks for everything it can get, and "everything" on an unbounded collection is
 * how a read-only screen becomes an outage.
 */
async function listLeads(limit = 50) {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const snapshot = await db.collection(LEADS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(capped)
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        return {
            id: doc.id,
            fullName: data.fullName || null,
            workEmail: data.workEmail || null,
            companyName: data.companyName || null,
            companySize: data.companySize || null,
            phone: data.phone || null,
            primaryGoal: data.primaryGoal || null,
            stage: data.stage || null,
            sourcePage: data.sourcePage || null,
            utmSource: data.utmSource || null,
            delivery: {
                status: data.delivery?.status || null,
                code: data.delivery?.code || null,
                attempts: data.delivery?.attempts || 0,
            },
            createdAt: data.createdAt?.toMillis?.() || null,
        };
    });
}

module.exports = { listLeads, LEADS_COLLECTION };
