/**
 * Landing-page lead store.
 *
 * ## Why leads are stored at all
 *
 * Before this module, `submitLandingLead` validated a submission and forwarded
 * it straight to Telegram. If Telegram was unreachable the endpoint returned
 * 502 and the lead was gone — no record, no retry, nothing to reconcile. A
 * marketing form that can lose a customer during someone else's outage is not
 * finished.
 *
 * So the order is now: **write the lead, then attempt delivery.** A delivery
 * failure downgrades to a stored lead with `delivery.status = 'failed'`, which
 * Super Admin → Landing Page Settings lists and can retry.
 *
 * ## Two-step capture
 *
 * Step one asks only for a name and a work email and creates the record. Step
 * two adds qualification fields. The visitor receives an opaque reference token
 * that authorises exactly one completion of exactly one lead, and nothing else.
 *
 * The token is generated with `crypto.randomBytes(32)`, stored only as a
 * SHA-256 hash, compared in constant time, expires in 30 minutes, and is
 * single-use. A leaked or guessed token therefore cannot enumerate leads, read
 * one back, or overwrite a completed one — the completion path only ever writes
 * qualification fields onto a record that is still awaiting them.
 *
 * `landing_leads` has no Firestore rule match, so it is Admin-SDK only.
 */

const crypto = require('crypto');
const { admin, db } = require('../firebaseAdmin');

const LEADS_COLLECTION = 'landing_leads';

/** How long a step-one reference stays completable. */
const COMPLETION_WINDOW_MS = 30 * 60 * 1000;

const LEAD_STAGES = Object.freeze({
    CONTACT: 'contact',
    QUALIFIED: 'qualified',
});

const DELIVERY_STATUS = Object.freeze({
    PENDING: 'pending',
    DELIVERED: 'delivered',
    FAILED: 'failed',
    DISABLED: 'disabled',
});

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a timing
 * signal, so the lengths are checked first against a value that is always the
 * same size for well-formed input.
 */
function digestsMatch(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
}

/**
 * Splits the opaque reference the browser holds into its two parts.
 *
 * Format is `{documentId}.{secret}`. Anything else is rejected without a
 * Firestore read, so a malformed reference costs nothing.
 */
function parseReference(reference) {
    const text = String(reference || '');
    const separator = text.indexOf('.');
    if (separator <= 0 || separator === text.length - 1) return null;

    const leadId = text.slice(0, separator);
    const secret = text.slice(separator + 1);

    // Firestore ids are alphanumeric; the secret is hex. Validating the shape
    // keeps a hostile reference from reaching `doc()` as a path fragment.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(leadId)) return null;
    if (!/^[a-f0-9]{64}$/.test(secret)) return null;

    return { leadId, secret };
}

/**
 * Creates a lead from step one.
 *
 * @param {{fullName: string, workEmail: string}} contact
 * @param {object} context Request metadata: hashed source address, page, UTM.
 * @returns {Promise<{leadId: string, reference: string}>}
 */
async function createLead(contact, context = {}) {
    const secret = crypto.randomBytes(32).toString('hex');
    const now = admin.firestore.Timestamp.now();

    const docRef = await db.collection(LEADS_COLLECTION).add({
        fullName: contact.fullName,
        workEmail: contact.workEmail,
        // Stored lowercased and separately so a future duplicate check is an
        // equality query rather than a scan.
        emailLower: String(contact.workEmail || '').toLowerCase(),

        companyName: null,
        companySize: null,
        phone: null,
        primaryGoal: null,

        stage: LEAD_STAGES.CONTACT,
        completionTokenHash: hashToken(secret),
        completionExpiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + COMPLETION_WINDOW_MS),
        completedAt: null,

        // Attribution. `sourceAddressHash` is a SHA-256 prefix computed by the
        // caller — the raw IP is never stored.
        sourceAddressHash: context.sourceAddressHash || null,
        sourcePage: context.sourcePage || null,
        referrer: context.referrer || null,
        utmSource: context.utmSource || null,
        utmMedium: context.utmMedium || null,
        utmCampaign: context.utmCampaign || null,

        delivery: {
            status: DELIVERY_STATUS.PENDING,
            attempts: 0,
            code: null,
            deliveredAt: null,
        },

        createdAt: now,
        updatedAt: now,
    });

    return { leadId: docRef.id, reference: `${docRef.id}.${secret}` };
}

/**
 * Applies step-two qualification to an existing lead.
 *
 * Returns a discriminated result rather than throwing, because every failure
 * here is answered to the public endpoint with the same generic response — the
 * caller must not be able to tell a wrong token from an expired one.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, lead: object|null, leadId: string|null}>}
 */
async function completeLead(reference, qualification) {
    const parsed = parseReference(reference);
    if (!parsed) return { ok: false, reason: 'malformed-reference', lead: null, leadId: null };

    const docRef = db.collection(LEADS_COLLECTION).doc(parsed.leadId);
    const snap = await docRef.get();
    if (!snap.exists) return { ok: false, reason: 'not-found', lead: null, leadId: null };

    const data = snap.data() || {};

    const presented = hashToken(parsed.secret);

    if (!digestsMatch(data.completionTokenHash, presented)) {
        // The live hash is cleared on completion, so a replay of a *legitimate*
        // reference lands here too. Checking the consumed hash separates "this
        // was a real token, used already" from "this token was never valid" —
        // a distinction worth having in the server logs, and one the public
        // endpoint deliberately does not expose, since it answers both the same.
        if (digestsMatch(data.consumedTokenHash, presented)) {
            return { ok: false, reason: 'already-completed', lead: null, leadId: null };
        }
        return { ok: false, reason: 'token-mismatch', lead: null, leadId: null };
    }

    if (data.stage === LEAD_STAGES.QUALIFIED) {
        return { ok: false, reason: 'already-completed', lead: null, leadId: null };
    }

    const expiresAt = data.completionExpiresAt;
    if (expiresAt && typeof expiresAt.toMillis === 'function' && Date.now() > expiresAt.toMillis()) {
        return { ok: false, reason: 'expired', lead: null, leadId: null };
    }

    const update = {
        companyName: qualification.companyName || null,
        companySize: qualification.companySize || null,
        phone: qualification.phone || null,
        primaryGoal: qualification.primaryGoal || null,
        stage: LEAD_STAGES.QUALIFIED,
        completedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        // Burn the live token so the reference cannot be reused, and keep the
        // digest under a different name purely so a replay can be recognised.
        completionTokenHash: null,
        consumedTokenHash: presented,
    };

    await docRef.update(update);

    return {
        ok: true,
        reason: null,
        leadId: parsed.leadId,
        lead: {
            fullName: data.fullName,
            workEmail: data.workEmail,
            companyName: update.companyName,
            companySize: update.companySize,
            phone: update.phone,
            primaryGoal: update.primaryGoal,
        },
    };
}

/** Records the outcome of a delivery attempt against one lead. Best-effort. */
async function recordDelivery(leadId, status, code = null) {
    if (!leadId) return;
    try {
        await db.collection(LEADS_COLLECTION).doc(leadId).update({
            'delivery.status': status,
            'delivery.code': code,
            'delivery.attempts': admin.firestore.FieldValue.increment(1),
            'delivery.deliveredAt': status === DELIVERY_STATUS.DELIVERED
                ? admin.firestore.Timestamp.now()
                : null,
            updatedAt: admin.firestore.Timestamp.now(),
        });
    } catch (error) {
        console.warn('[landingLeads] delivery status not recorded', {
            message: error?.message || 'unknown',
        });
    }
}

/**
 * Lists recent leads for the Super Admin table.
 *
 * Ordered by `createdAt` alone, so it needs no composite index — a detail worth
 * keeping, because a missing composite index makes a Firestore query fail
 * outright rather than degrade.
 *
 * The completion token hash is never returned; it is an authentication secret,
 * not lead data.
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

/** Reads one lead for a delivery retry. Returns only what a message needs. */
async function readLeadForRetry(leadId) {
    const snap = await db.collection(LEADS_COLLECTION).doc(String(leadId)).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
        id: snap.id,
        stage: data.stage || LEAD_STAGES.CONTACT,
        fullName: data.fullName || null,
        workEmail: data.workEmail || null,
        companyName: data.companyName || null,
        companySize: data.companySize || null,
        phone: data.phone || null,
        primaryGoal: data.primaryGoal || null,
        sourcePage: data.sourcePage || null,
        utmSource: data.utmSource || null,
    };
}

module.exports = {
    COMPLETION_WINDOW_MS,
    DELIVERY_STATUS,
    LEADS_COLLECTION,
    LEAD_STAGES,
    completeLead,
    createLead,
    digestsMatch,
    hashToken,
    listLeads,
    parseReference,
    readLeadForRetry,
    recordDelivery,
};
