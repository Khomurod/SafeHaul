/**
 * Serves the legal agreements the public application must display.
 *
 * WHY THE SERVER OWNS THIS TEXT
 * -----------------------------
 * `buildSubmissionSnapshot` resolves agreement wording from the registry on the
 * SERVER at submission time. If the browser rendered its own copy of that text,
 * the two could differ — and we would preserve, and bind a signature to, wording
 * the driver never actually saw. Serving the text from the same registry that
 * freezes it is what makes "this is what they agreed to" a true statement.
 *
 * It also means legal wording can be corrected by deploying functions alone,
 * without shipping a frontend build, and a stale cached bundle cannot show
 * superseded disclosures.
 *
 * PUBLIC BY DESIGN
 * ----------------
 * The apply page is unauthenticated, so this callable is too. It exposes only
 * the carrier's public name and fixed legal boilerplate — the same material any
 * visitor to the apply page already sees. It reveals nothing about applicants.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const {
    CURRENT_AGREEMENT_VERSION,
    resolveAgreementSet,
} = require('./shared/legalAgreements');
const { applyCompanyWording, normalizeWordingDocs } = require('./shared/companyAgreementWording');

/**
 * The company's own agreement wording, if it has published any.
 *
 * Read from `companies/{id}/legal_agreements`, which no client can reach. A
 * failure here must not fail the apply page — the platform wording is always a
 * legitimate thing to present — so it degrades to "no company wording" and says
 * so in the log. `submitGuestApplication` reads the same collection through this
 * same function, so the text served and the text frozen come from one place.
 */
async function loadCompanyAgreementWording(companyId) {
    try {
        const snap = await db.collection('companies').doc(companyId).collection('legal_agreements').get();
        const raw = {};
        for (const doc of snap.docs || []) raw[doc.id] = doc.data();
        return normalizeWordingDocs(raw);
    } catch (err) {
        console.error('[applicationAgreements] Company wording lookup error:', err);
        return {};
    }
}

/**
 * Resolve the carrier name exactly as `submitGuestApplication` does: the company
 * document first, then the public projection the apply page actually renders
 * from.
 *
 * These two resolutions MUST agree. If they drift, the driver reads one
 * carrier's name and the snapshot preserves another's.
 * `applicationAgreements.test.js` pins that precedence.
 */
async function resolveAgreementCompanyName(companyId, companyData) {
    let companyName = (companyData && companyData.companyName) || 'Unknown Company';
    try {
        const publicSnap = await db.collection('public_profiles').doc(companyId).get();
        if (publicSnap.exists) {
            const publicData = publicSnap.data() || {};
            companyName = publicData.companyName || companyName;
        }
    } catch (err) {
        // A missing or unreadable projection is not fatal: the company document's
        // name is still correct. Failing the whole apply page over it would be worse.
        console.error('[getApplicationAgreements] Public profile lookup error:', err);
    }
    return companyName;
}

exports.getApplicationAgreements = functions
    .runWith({ memory: '128MB', timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
        const { checkRateLimit } = require('./shared/rateLimiter');
        const clientIp = (context && context.rawRequest && context.rawRequest.ip) || 'unknown';
        // Read-only public boilerplate, so the ceiling is generous — but an open
        // endpoint still must not be a free amplification target. Fails OPEN so a
        // limiter outage cannot block applicants from reading what they must sign.
        const allowed = await checkRateLimit(`guest_agreements_${clientIp}`, 30, 60, 'open');
        if (!allowed) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many requests. Please wait a moment and try again.'
            );
        }

        const companyId = data && typeof data.companyId === 'string' ? data.companyId.trim() : '';
        if (!companyId) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
        }

        let companyData = null;
        try {
            const companySnap = await db.collection('companies').doc(companyId).get();
            if (companySnap.exists) companyData = companySnap.data() || {};
        } catch (err) {
            console.error('[getApplicationAgreements] Company lookup error:', err);
        }

        const companyName = await resolveAgreementCompanyName(companyId, companyData);

        // Throws on an unknown id/version rather than substituting wording we
        // cannot vouch for. Surfaced as `internal` — the applicant can retry, and
        // showing a partial agreement set would be worse than showing none.
        let agreements;
        try {
            const wording = await loadCompanyAgreementWording(companyId);
            agreements = applyCompanyWording(resolveAgreementSet({ companyName }), wording, { companyName });
        } catch (err) {
            console.error('[getApplicationAgreements] Could not resolve agreement set:', err);
            throw new functions.https.HttpsError(
                'internal',
                'Could not load the required agreements. Please try again.'
            );
        }

        return {
            agreementVersion: CURRENT_AGREEMENT_VERSION,
            companyName,
            agreements: agreements.map((agreement) => ({
                id: agreement.id,
                version: agreement.version,
                title: agreement.title,
                body: agreement.body,
                requiresSignature: agreement.requiresSignature,
                presentedOn: agreement.presentedOn,
                companyWording: Boolean(agreement.companyWording),
            })),
        };
    });

module.exports.resolveAgreementCompanyName = resolveAgreementCompanyName;
module.exports.loadCompanyAgreementWording = loadCompanyAgreementWording;
