/**
 * Autosave, resume and start-over for an in-progress driver application.
 *
 * ## The problem
 *
 * Nothing existed server-side until an applicant pressed Submit on the ninth
 * page. A driver filling the form on a phone at a truck stop who lost signal, or
 * closed the tab, or hit a failing CDL scan, lost everything they had typed —
 * while the licence and medical-card images they had already uploaded sat in
 * Cloud Storage connected to nobody.
 *
 * ## The shape of the fix
 *
 * `saveApplicationProgress` after each successful Next, into a server-only
 * subcollection keyed by the **existing** deterministic applicant key. Two
 * further callables let a returning applicant find and restore that draft, and a
 * fourth discards it deliberately.
 *
 * See `./shared/applicationDraft.js` for why drafts do not live in
 * `applications` (four triggers, one of which emails the applicant to say their
 * application was received) and why no Social Security Number is stored.
 *
 * ## Why resuming is two callables, not one
 *
 * `findResumableApplication` answers only "is there something to continue?" and
 * `resumeApplicationDraft` exchanges a token for the data. Splitting them means
 * the answer to a *matching* attempt carries no application data at all, so a
 * wrong guess learns nothing beyond a boolean — and that boolean is identical
 * whether nothing exists or something exists and the guess did not match it.
 *
 * ## What a resume actually requires
 *
 * The applicant's last name, date of birth and Social Security Number — combined
 * into a keyed HMAC, never stored raw — **and** an email or phone that the stored
 * draft already holds. Knowing three facts about a person is not enough; the bar
 * is three facts plus one of their contact details. Both halves are rate-limited
 * fail-closed, per caller and per identity, and every attempt is audited without
 * recording what was attempted.
 *
 * App Check is deliberately absent from this project (it broke real drivers'
 * uploads in production), so these guards are the compensating controls, in the
 * same spirit as the rest of the guest intake surface.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const { generateApplicantKey } = require('./shared/buildApplicationDoc');
const draft = require('./shared/applicationDraft');
// The staff-facing read is 2nd generation; the guest-facing callables above are
// 1st, matching `submitGuestApplication` and the rest of the intake surface.
const { onCall: onCallV2, HttpsError: HttpsErrorV2 } = require('firebase-functions/v2/https');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');

/**
 * Rate limits.
 *
 * Saving is generous because a careful applicant legitimately saves nine or ten
 * times over twenty minutes and being throttled mid-application is the failure
 * this whole feature exists to prevent. Matching is tight because it is the only
 * surface where a wrong answer would be interesting to an attacker, and it is
 * limited per identity as well as per caller so that spreading attempts across
 * addresses does not spread the budget with them.
 */
const LIMITS = Object.freeze({
    save: { limit: 40, windowSeconds: 60 },
    match: { limit: 6, windowSeconds: 60 },
    matchPerIdentity: { limit: 12, windowSeconds: 3600 },
    resume: { limit: 10, windowSeconds: 60 },
    startOver: { limit: 5, windowSeconds: 300 },
});

/**
 * Ceiling on the browser's local write counter.
 *
 * One draft is a handful of pages, so a legitimate counter is in the tens. The
 * bound exists because the value arrives from an unauthenticated caller, not
 * because a real applicant could approach it.
 */
const MAX_CLIENT_SEQ = 100000;

const FUNCTION_TIMEOUT_SECONDS = 30;
const runtime = { memory: '256MB', timeoutSeconds: FUNCTION_TIMEOUT_SECONDS };

/**
 * Only the two callables that derive the identity HMAC bind the secret.
 *
 * `resumeApplicationDraft` and `startNewApplication` authorize off the resume
 * token alone and read `identityKey` as a *stored* value, so they never call
 * `buildIdentityKey` and have no use for the key. Binding a secret to a function
 * that does not read it widens the blast radius for nothing — and here it did
 * measurable harm: every `secrets: [...]` binding makes the Firebase CLI ensure
 * the runtime service account can read that secret, and each function that names
 * it is another chance to need an IAM change mid-deploy.
 */
const runtimeWithIdentityKey = { ...runtime, secrets: ['SMS_ENCRYPTION_KEY'] };

/**
 * The answer to a matching attempt that did not succeed.
 *
 * One shape, whether nothing exists, something exists under a different contact
 * detail, or the applicant has already submitted. A response that varied would
 * turn this into a lookup service: "does a driver with this name and SSN have an
 * application at this carrier" is not a question an unauthenticated caller may
 * ask, and it is not a question SafeHaul should answer differently by accident.
 */
const NO_MATCH = Object.freeze({ resumable: false });

function clientIp(context) {
    return context.rawRequest?.ip || 'unknown_guest';
}

/** Trims and bounds a string that arrived from a browser. */
function text(value, max = 200) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * A Firestore document id that came from a browser.
 *
 * `CollectionReference.doc()` accepts a *path*, not just an id, so an id
 * containing slashes reaches a different document than the one the code reads as
 * written. Nothing else lives under `companies/{id}/application_drafts`, and a
 * resume still needs a 256-bit token, so this was not exploitable — but a
 * client-controlled path segment should not be reachable at all, and this repo
 * whitelists ids against path injection everywhere else it accepts one.
 *
 * Returns '' for anything that is not a plain id, which every caller treats as a
 * missing argument.
 */
function docId(value, max = 100) {
    const trimmed = text(value, max);
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : '';
}

/** The deterministic applicant key: 20 lowercase hex characters. */
function applicantKeyOf(value) {
    const trimmed = text(value, 64);
    return /^[a-f0-9]{1,64}$/.test(trimmed) ? trimmed : '';
}

/**
 * The identity HMAC, or null when it cannot be computed.
 *
 * `buildIdentityKey` throws when `SMS_ENCRYPTION_KEY` is absent or the wrong
 * length, which is right — a misconfiguration should be loud. But letting it
 * escape a *save* would mean an unreadable secret silently costs the applicant
 * their draft entirely, when the same-device resume path needs no identity key at
 * all. So the fault is logged and the draft is saved without one: cross-device
 * matching is degraded, which is the lesser loss by a wide margin.
 */
function identityKeyOrNull(parts, where) {
    try {
        return draft.buildIdentityKey(parts);
    } catch (error) {
        console.error(`[applicationDrafts] ${where}: identity key unavailable: ${error?.message || 'unknown'}`);
        return null;
    }
}

/**
 * Writes a value-free record of a matching attempt.
 *
 * Deliberately records the *outcome and the company*, never the name, the date of
 * birth, the SSN, the identity hash or the contact detail. What matters
 * operationally is "how many resume attempts is this company's apply page
 * seeing, and how many matched" — a pattern that would be visible in a spike and
 * is not otherwise recoverable, since the drafts themselves expire.
 */
async function recordMatchAttempt(companyId, outcome) {
    try {
        await db.collection('companies').doc(String(companyId))
            .collection('application_draft_audit')
            .add({
                action: 'resume_match_attempted',
                outcome,
                at: draft.serverTimestamp(),
                expiresAt: draft.expiresAt(),
            });
    } catch (error) {
        // Auditing a *read attempt* must never deny the applicant their
        // application. This is deliberately different from the original-PDF
        // access audit, which refuses when it cannot record: that path releases a
        // document containing a full SSN, and this one releases a boolean.
        console.error(`[applicationDrafts] Could not record a match attempt: ${error?.message || 'unknown'}`);
    }
}

// ---------------------------------------------------------------------------
// Save progress
// ---------------------------------------------------------------------------

/**
 * Saves everything entered so far. Called after each successful Next.
 *
 * Idempotent by construction: the document id is the deterministic applicant key,
 * so repeated clicks, a retried request and a replayed save all merge into one
 * document rather than producing duplicates.
 *
 * Returns a resume token on the first save. The browser keeps it, so returning on
 * the same device needs no identity matching at all — the strongest resume path
 * is also the one that asks the applicant for nothing.
 */
exports.saveApplicationProgress = functions
    .runWith(runtimeWithIdentityKey)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        if (!companyId) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
        }

        const allowed = await checkRateLimit(
            `draft_save_${clientIp(context)}`, LIMITS.save.limit, LIMITS.save.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many saves. Please continue and try again shortly.');
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const email = text(data?.email, 200);
        const phone = text(data?.phone, 40);
        if (!email && !phone) {
            // Without one of these there is no deterministic key, and a draft
            // with no identity is one nobody can ever come back to.
            throw new functions.https.HttpsError('invalid-argument', 'An email or phone is required before progress can be saved.');
        }

        const formData = data?.formData && typeof data.formData === 'object' ? data.formData : {};
        if (!draft.withinPayloadBudget(formData)) {
            throw new functions.https.HttpsError('invalid-argument', 'That is too much data for one draft.');
        }

        const { applicantKey, applicantKeyFull } = generateApplicantKey(companyId, email, phone);
        const identityKey = identityKeyOrNull({
            companyId,
            lastName: data?.lastName,
            dob: data?.dob,
            ssn: data?.ssn,
        }, 'saveApplicationProgress');

        const ref = draft.draftsCollection(companyId).doc(applicantKey);
        const existing = await ref.get();
        const token = existing.exists && existing.data()?.resumeTokenHash
            ? null
            : draft.mintResumeToken();

        const update = {
            companyId,
            applicantKey,
            applicantKeyFull,
            // Stored so a later resume can require the applicant to present one
            // of them. Both are already in the draft's own form data; keeping the
            // normalized copies out here is what lets the match happen without
            // reading the whole document.
            contactEmail: email.toLowerCase(),
            contactPhone: phone.replace(/\D/g, ''),
            // The SSN itself is never stored — see ./shared/applicationDraft.js.
            identityKey: identityKey || null,
            formData: draft.sanitizeDraftData(formData),
            lastStep: Number.isInteger(data?.lastStep) ? Math.max(0, Math.min(20, data.lastStep)) : 0,
            lastSemanticStep: text(data?.lastSemanticStep, 40) || null,
            // The browser's write counter for the copy this save carries. Stored
            // so a later resume can tell the browser whether the server still
            // holds the copy *it* synced, or whether another device has advanced
            // it since — the alternative being to compare a phone's clock with a
            // Firestore timestamp, which is not a comparison worth trusting.
            // Bounded like `lastStep`: it is a counter from an unauthenticated
            // caller and nothing reads it as anything but an integer.
            clientSeq: Number.isInteger(data?.clientSeq)
                ? Math.max(0, Math.min(MAX_CLIENT_SEQ, data.clientSeq))
                : null,
            status: 'in_progress',
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        };
        if (!existing.exists) update.createdAt = draft.serverTimestamp();
        if (token) update.resumeTokenHash = token.hash;

        await ref.set(update, { merge: true });

        // At most one live draft per identity per company. A returning applicant
        // who types a different email produces a second key, and leaving both
        // would make "continue" a coin flip.
        if (identityKey) await supersedeOtherDrafts(companyId, identityKey, applicantKey);

        return {
            saved: true,
            applicantKey,
            // Only on the first save. A token is minted once and never returned
            // again, so a later response cannot leak one to a different browser.
            resumeToken: token ? token.token : null,
        };
    });

/**
 * Retires any other live draft for the same person in the same company.
 *
 * Deleted rather than tombstoned: an applicant who retyped their email has one
 * application in progress, not two, and an abandoned duplicate holding a name and
 * a date of birth is not worth keeping to record that they changed their mind.
 */
async function supersedeOtherDrafts(companyId, identityKey, keepApplicantKey) {
    try {
        const snapshot = await draft.draftsCollection(companyId)
            .where('identityKey', '==', identityKey)
            .get();

        const stale = snapshot.docs.filter((doc) => doc.id !== keepApplicantKey);
        await Promise.all(stale.map((doc) => doc.ref.delete()));
    } catch (error) {
        // A tidy-up failure must not fail the save it follows. The match below
        // takes the most recently updated draft, so a straggler is at worst
        // noise, and it expires on its own.
        console.error(`[applicationDrafts] Could not supersede older drafts: ${error?.message || 'unknown'}`);
    }
}

// ---------------------------------------------------------------------------
// Find and resume
// ---------------------------------------------------------------------------

/**
 * Is there an unfinished application to continue?
 *
 * Answers with a short-lived token or with `NO_MATCH`, and nothing else. See the
 * file header for why the two are indistinguishable.
 */
exports.findResumableApplication = functions
    .runWith(runtimeWithIdentityKey)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        if (!companyId) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId is required.');
        }

        const allowed = await checkRateLimit(
            `draft_match_${clientIp(context)}`, LIMITS.match.limit, LIMITS.match.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const identityKey = identityKeyOrNull({
            companyId,
            lastName: data?.lastName,
            dob: data?.dob,
            ssn: data?.ssn,
        }, 'findResumableApplication');
        if (!identityKey) {
            // A partial identity matches nothing, and says so without spending
            // the per-identity budget of whoever it half-resembles.
            return NO_MATCH;
        }

        // Per identity as well as per caller, so attempts spread across addresses
        // do not spread the budget with them. Keyed on the HMAC, so the limiter
        // never holds a name or an SSN either.
        const identityAllowed = await checkRateLimit(
            `draft_match_id_${identityKey.slice(0, 32)}`,
            LIMITS.matchPerIdentity.limit,
            LIMITS.matchPerIdentity.windowSeconds,
            'closed',
        );
        if (!identityAllowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        let snapshot;
        try {
            snapshot = await draft.draftsCollection(companyId)
                .where('identityKey', '==', identityKey)
                .orderBy('updatedAt', 'desc')
                .limit(5)
                .get();
        } catch (error) {
            console.error(`[applicationDrafts] Draft lookup failed: ${error?.message || 'unknown'}`);
            // Fail closed *into* the normal flow: an applicant whose lookup broke
            // should be able to fill the form, not be blocked by a diagnostic.
            await recordMatchAttempt(companyId, 'lookup_failed');
            return NO_MATCH;
        }

        const candidate = snapshot.docs.find((doc) => draft.contactMatches(doc.data(), {
            email: data?.email,
            phone: data?.phone,
        }));

        if (!candidate) {
            await recordMatchAttempt(companyId, snapshot.empty ? 'no_draft' : 'contact_mismatch');
            return NO_MATCH;
        }

        // A fresh token per successful match, so a token cannot be harvested from
        // one browser and replayed from another indefinitely.
        const token = draft.mintResumeToken();
        await candidate.ref.set({
            resumeTokenHash: token.hash,
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        }, { merge: true });

        await recordMatchAttempt(companyId, 'matched');

        const stored = candidate.data() || {};
        return {
            resumable: true,
            resumeToken: token.token,
            // Enough to write "you started this on 14 August, at the License
            // step" and nothing more. No name, no email, no field values: the
            // applicant has not yet chosen to restore anything.
            startedAt: stored.createdAt?.toDate?.()?.toISOString?.() || null,
            updatedAt: stored.updatedAt?.toDate?.()?.toISOString?.() || null,
            lastSemanticStep: stored.lastSemanticStep || null,
        };
    });

/**
 * Exchanges a resume token for the saved answers.
 *
 * The token is the authorization: it was issued either to the browser that
 * created the draft or to one that satisfied the identity-and-contact match, so
 * this callable does not re-ask those questions.
 */
exports.resumeApplicationDraft = functions
    .runWith(runtime)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        const applicantKey = applicantKeyOf(data?.applicantKey);
        const resumeToken = text(data?.resumeToken, 128);

        if (!companyId || !resumeToken) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId and resumeToken are required.');
        }

        const allowed = await checkRateLimit(
            `draft_resume_${clientIp(context)}`, LIMITS.resume.limit, LIMITS.resume.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        const doc = await findByToken(companyId, applicantKey, resumeToken);
        if (!doc) {
            // Same answer for an unknown key, a wrong token and an expired
            // draft. "That token is wrong" and "that application does not exist"
            // are different facts an attacker would happily learn.
            throw new functions.https.HttpsError('not-found', 'That saved application could not be found.');
        }

        return { restored: true, draft: draft.toClientDraft(doc) };
    });

/**
 * Locates a draft by resume token, in constant-ish time.
 *
 * When the applicant key is known the document is read directly. When it is not —
 * a browser that kept a token but lost the key — the recent drafts are scanned,
 * bounded, and compared in constant time.
 */
async function findByToken(companyId, applicantKey, resumeToken) {
    const collection = draft.draftsCollection(companyId);

    if (applicantKey) {
        const doc = await collection.doc(applicantKey).get();
        if (!doc.exists) return null;
        return draft.resumeTokenMatches(doc.data()?.resumeTokenHash, resumeToken) ? doc : null;
    }

    const snapshot = await collection.orderBy('updatedAt', 'desc').limit(50).get();
    return snapshot.docs.find(
        (doc) => draft.resumeTokenMatches(doc.data()?.resumeTokenHash, resumeToken),
    ) || null;
}

// ---------------------------------------------------------------------------
// Start over
// ---------------------------------------------------------------------------

/**
 * Discards an unfinished application so a genuinely new one can begin.
 *
 * A hard delete, as the owner chose. It happens in a transaction and the delete
 * is the only write, so there is never a window in which two live drafts exist
 * for one person and never a half-removed one: either the old draft is gone or
 * nothing changed.
 *
 * Submitted applications are untouchable here. This callable can only reach the
 * draft collection, so an applicant pressing "start over" cannot remove a record
 * they have already signed — the immutable submission and its preserved PDF are
 * in a different collection with different rules.
 */
exports.startNewApplication = functions
    .runWith(runtime)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        const applicantKey = applicantKeyOf(data?.applicantKey);
        const resumeToken = text(data?.resumeToken, 128);

        if (!companyId || !resumeToken) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId and resumeToken are required.');
        }

        const allowed = await checkRateLimit(
            `draft_start_over_${clientIp(context)}`,
            LIMITS.startOver.limit, LIMITS.startOver.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        const doc = await findByToken(companyId, applicantKey, resumeToken);
        if (!doc) {
            throw new functions.https.HttpsError('not-found', 'That saved application could not be found.');
        }

        const identityKey = doc.data()?.identityKey || null;

        await db.runTransaction(async (transaction) => {
            // Re-read inside the transaction: a concurrent save could have
            // touched this document between the token check and here, and the
            // delete must apply to what is actually there.
            const fresh = await transaction.get(doc.ref);
            if (fresh.exists) transaction.delete(doc.ref);
        });

        // Any sibling draft for the same person goes too, or "start over" would
        // leave one behind for the next visit to find.
        if (identityKey) await supersedeOtherDrafts(companyId, identityKey, null);

        await recordMatchAttempt(companyId, 'discarded');

        return { discarded: true };
    });

// ---------------------------------------------------------------------------
// Recruiter view
// ---------------------------------------------------------------------------

/**
 * Unfinished applications, for the company's own staff.
 *
 * This is the half of the feature that turns "the data is not lost" into
 * something a carrier can act on. Without it a draft is only ever useful to the
 * applicant who returns on their own, and a recruiter watching applications drop
 * off at the licence page still has nothing to call.
 *
 * ## What it shows, and what it does not
 *
 * Enough to recognise and contact someone: name, email, phone, how far they got
 * and when. Not the answers themselves. A recruiter has no need to read a
 * half-finished DOT questionnaire, and an unfinished application is not a record
 * the applicant has agreed to file — they have signed nothing and consented to
 * nothing. Reading one is a decision the applicant has not yet made, so the
 * summary is deliberately a contact list rather than a preview.
 *
 * There is no Social Security Number to withhold: drafts never store one.
 *
 * A second generation callable, unlike the guest-facing ones, because it is an
 * authenticated staff read with no rate-limit-by-IP consideration.
 */
exports.listApplicationDrafts = onCallV2({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    if (!companyId) {
        throw new HttpsErrorV2('invalid-argument', 'companyId is required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'listApplicationDrafts');

    try {
        const snapshot = await draft.draftsCollection(companyId)
            .orderBy('updatedAt', 'desc')
            .limit(200)
            .get();

        return {
            drafts: snapshot.docs.map((doc) => {
                const data = doc.data() || {};
                const form = data.formData || {};
                return {
                    applicantKey: doc.id,
                    // From the draft's own answers, which is where the applicant
                    // typed them; the normalized contact copies alongside exist
                    // for matching, not for display.
                    firstName: typeof form.firstName === 'string' ? form.firstName.slice(0, 80) : '',
                    lastName: typeof form.lastName === 'string' ? form.lastName.slice(0, 80) : '',
                    email: data.contactEmail || '',
                    phone: data.contactPhone || '',
                    lastSemanticStep: data.lastSemanticStep || null,
                    lastStep: Number.isInteger(data.lastStep) ? data.lastStep : 0,
                    startedAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
                    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
                };
            }),
            retentionDays: draft.RETENTION_DAYS,
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`[listApplicationDrafts] ${error?.message || 'unknown error'}`);
        throw new HttpsErrorV2('internal', 'The list could not be loaded.');
    }
});

exports.__private = {
    LIMITS, NO_MATCH, findByToken, supersedeOtherDrafts, text, docId, applicantKeyOf,
};
