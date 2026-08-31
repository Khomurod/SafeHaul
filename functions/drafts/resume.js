/**
 * Finding a resumable application, restoring it, and starting over.
 *
 * Part of the guest application-draft surface. The runtime options and limits
 * are in `./runtime`; `applicationDrafts.js` is the deployment surface that
 * re-exports the handlers by name.
 */

const { LIMITS, NO_MATCH, functions, runtime, runtimeWithIdentityKey } = require('./runtime');
const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../shared/companyTenant');
const draft = require('../shared/applicationDraft');
const {
    applicantKeyOf, clientIp, docId, findByToken, identityKeyOrNull,
    priorHashesAfterRotation, recordMatchAttempt, text,
} = require('./identity');
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

        // A fresh token per successful match, so a token cannot be harvested from one
        // browser and replayed from another indefinitely. The superseded hash is kept —
        // see `tokenNamesDraft` — because this rotation happens before the applicant has
        // chosen anything: the device holding the old token has deleted nothing, and its
        // saves must go on being accepted.
        //
        // In a transaction that re-reads the document, because a merge-set *creates* what
        // it cannot find. Start Over deleting this draft between the query above and the
        // write below would otherwise be undone here — resurrected as a stub holding a
        // token and two timestamps and no answers at all, which this call would then
        // offer the applicant as their unfinished application.
        const token = draft.mintResumeToken();
        const rotated = await db.runTransaction(async (transaction) => {
            const fresh = await transaction.get(candidate.ref);
            if (!fresh.exists) return null;
            transaction.set(candidate.ref, {
                resumeTokenHash: token.hash,
                priorResumeTokenHashes: priorHashesAfterRotation(fresh.data()),
                updatedAt: draft.serverTimestamp(),
                expiresAt: draft.expiresAt(),
            }, { merge: true });
            return fresh.data() || {};
        });

        if (!rotated) {
            // Discarded while this lookup was running. Reported exactly as a lookup that
            // found nothing: the applicant has no unfinished application any more, and
            // the answer must not disclose that one existed a moment ago.
            await recordMatchAttempt(companyId, 'no_draft');
            return NO_MATCH;
        }

        await recordMatchAttempt(companyId, 'matched');

        const stored = rotated;
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

        await db.runTransaction(async (transaction) => {
            // Re-read inside the transaction: a concurrent save could have
            // touched this document between the token check and here, and the
            // delete must apply to what is actually there.
            const fresh = await transaction.get(doc.ref);
            if (fresh.exists) transaction.delete(doc.ref);
        });

        // No sibling sweep, and the reason is worth stating because the comment here
        // used to promise one.
        //
        // The only draft this caller can prove they own is the one just deleted: the
        // token they presented resolved to it. A sibling exists precisely because
        // some *other* browser created it without a token, and its own token is the
        // only proof of owning it. Sweeping the identity instead would mean anyone
        // who knows a last name, a date of birth and an SSN could create a draft of
        // their own, be handed a token for it, and use start over to delete the real
        // applicant's work — see `supersedeOtherDrafts`.
        //
        // So start over discards **the application the applicant was offered**, not
        // every application their identity has. A sibling is left to its own
        // browser's start over, to the applicant being offered it on a later visit,
        // or to the 30-day TTL. The draft's `identityKey` is not read here at all any
        // more, which is the honest shape of that: this callable has no business
        // reaching anything the token did not name.

        await recordMatchAttempt(companyId, 'discarded');

        return { discarded: true };
    });
