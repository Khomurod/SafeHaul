/**
 * Website leads — the read path.
 *
 * `landing_leads` holds two generations of leads, read together:
 *
 * - **from the home page's contact form**, written by `submitWebsiteLead`
 *   (`./websiteLead.js`) since that form was rebuilt; and
 * - **from the removed marketing site**, captured between 2026-06 and 2026-08 and
 *   deliberately kept when that site and its capture were retired.
 *
 * The old capture's lesson is the new one's ordering: forwarding straight to
 * Telegram lost the customer whenever Telegram failed, so a lead is **written
 * first and delivered second**, and a failed delivery is a stored lead with
 * `delivery.status = 'failed'`. Nothing retries a delivery; every lead is on the
 * Website Leads screen whatever its delivery says.
 *
 * `landing_leads` has no Firestore rule match, so it is Admin-SDK only — the
 * documents carry third-party contact details, and the screen reaches them
 * through `listLandingLeads`, never directly.
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
            message: data.message || null,
            sourceSite: data.sourceSite || null,
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
