/**
 * Company-specific legal wording: list, publish, revert.
 *
 * The wording itself is versioned and content-addressed by
 * `shared/companyAgreementWording.js`; these callables are the only way it is
 * read or changed. No Firestore rule grants a client any access to
 * `companies/{id}/legal_agreements` (default deny, pinned by
 * `firestoreRules.surfaces.security.test.js`), which is what makes the
 * "publish only ever adds a version" guarantee hold — nobody can edit a version
 * in place from a browser.
 *
 * WHO MAY DO WHAT
 * ---------------
 * Reading is for the company's admins and super admins: a company should be
 * able to see the exact text its applicants are shown, and its history.
 * Publishing and reverting are SUPER ADMIN ONLY. Legal wording is a platform
 * responsibility; a company asks for a change and a super admin makes it.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { assertCompanyAdminStrict } = require('./shared/companyAccess');
const { AGREEMENTS, resolveAgreementSet } = require('./shared/legalAgreements');
const {
    normalizeWordingDocs,
    publishWordingVersion,
    revertToPlatformWording,
} = require('./shared/companyAgreementWording');

function requireAuth(context) {
    if (!context.auth || !context.auth.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    }
    return context.auth;
}

function isSuperAdminToken(token) {
    return token?.globalRole === 'super_admin' || token?.roles?.globalRole === 'super_admin';
}

function requireSuperAdmin(context) {
    const auth = requireAuth(context);
    if (!isSuperAdminToken(auth.token)) {
        throw new functions.https.HttpsError('permission-denied', 'Only a super admin may change legal wording.');
    }
    return auth;
}

function requireCompanyId(data) {
    const companyId = data && typeof data.companyId === 'string' ? data.companyId.trim() : '';
    if (!companyId || companyId.includes('/')) {
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
    }
    return companyId;
}

function requireAgreementId(data) {
    const agreementId = data && typeof data.agreementId === 'string' ? data.agreementId.trim() : '';
    if (!AGREEMENTS[agreementId]) {
        throw new functions.https.HttpsError('invalid-argument', 'Unknown agreement.');
    }
    return agreementId;
}

async function readWordingDocs(companyId) {
    const snap = await db.collection('companies').doc(companyId).collection('legal_agreements').get();
    const raw = {};
    for (const doc of snap.docs || []) raw[doc.id] = doc.data();
    return normalizeWordingDocs(raw);
}

async function readCompanyName(companyId) {
    const snap = await db.collection('companies').doc(companyId).get();
    return (snap.exists && snap.data() && snap.data().companyName) || 'Unknown Company';
}

/**
 * Every agreement with its platform wording, the company's current wording (if
 * any) and the company's version history — what the settings screen shows.
 */
async function describeCompanyAgreements(companyId) {
    const [wording, companyName] = await Promise.all([readWordingDocs(companyId), readCompanyName(companyId)]);
    const platform = resolveAgreementSet({ companyName });
    return platform.map((agreement) => {
        const doc = wording[agreement.id] || null;
        const versions = doc
            ? Object.entries(doc.versions)
                .map(([id, entry]) => ({ id, body: entry.body, createdAt: entry.createdAt, createdBy: entry.createdBy, note: entry.note }))
                .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            : [];
        return {
            id: agreement.id,
            title: agreement.title,
            presentedOn: agreement.presentedOn,
            platformVersion: agreement.version,
            platformBody: agreement.body,
            currentVersion: doc && doc.currentVersion ? doc.currentVersion : null,
            currentBody: doc && doc.currentVersion ? doc.versions[doc.currentVersion].body : null,
            versions,
        };
    });
}

exports.listCompanyAgreementWording = functions
    .runWith({ memory: '128MB', timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
        const auth = requireAuth(context);
        const companyId = requireCompanyId(data);
        if (!isSuperAdminToken(auth.token)) {
            await assertCompanyAdminStrict(auth.uid, companyId);
        }
        return { companyId, agreements: await describeCompanyAgreements(companyId) };
    });

exports.publishCompanyAgreementWording = functions
    .runWith({ memory: '128MB', timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
        const auth = requireSuperAdmin(context);
        const companyId = requireCompanyId(data);
        const agreementId = requireAgreementId(data);
        const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : null;

        const ref = db.collection('companies').doc(companyId).collection('legal_agreements').doc(agreementId);
        const existing = await ref.get();
        let next;
        try {
            next = publishWordingVersion(existing.exists ? existing.data() : null, agreementId, data.body, {
                createdBy: auth.uid,
                note,
            });
        } catch (err) {
            throw new functions.https.HttpsError('invalid-argument', err.message);
        }
        // A plain set: every version already stored is carried forward untouched,
        // and the version ids are hashes of their text, so nothing here can
        // rewrite what an earlier applicant was shown.
        await ref.set(next);
        return { companyId, agreementId, currentVersion: next.currentVersion, agreements: await describeCompanyAgreements(companyId) };
    });

exports.revertCompanyAgreementWording = functions
    .runWith({ memory: '128MB', timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
        requireSuperAdmin(context);
        const companyId = requireCompanyId(data);
        const agreementId = requireAgreementId(data);
        const ref = db.collection('companies').doc(companyId).collection('legal_agreements').doc(agreementId);
        const existing = await ref.get();
        const next = revertToPlatformWording(existing.exists ? existing.data() : null, agreementId);
        if (next) await ref.set(next);
        return { companyId, agreementId, currentVersion: null, agreements: await describeCompanyAgreements(companyId) };
    });

module.exports.describeCompanyAgreements = describeCompanyAgreements;
