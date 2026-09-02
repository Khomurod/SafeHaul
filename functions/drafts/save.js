/**
 * Autosave: what a first save writes, and what it refuses to write.
 *
 * Part of the guest application-draft surface. The runtime options and limits
 * are in `./runtime`; `applicationDrafts.js` is the deployment surface that
 * re-exports the handlers by name.
 */

const { LIMITS, MAX_CLIENT_SEQ, functions, runtimeWithIdentityKey } = require('./runtime');
const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../shared/companyTenant');
const { generateApplicantKey } = require('../shared/buildApplicationDoc');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const {
    applicantKeyOf, clientIp, docId, identityKeyOrNull, mayModifyExistingDraft,
    recordMatchAttempt, supersedeOtherDrafts, text, tokenOpensALiveDraft,
} = require('./identity');
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

        /**
         * The existence check, the authorization decision and the write, in one
         * transaction.
         *
         * A standalone `get` followed by a later `set` leaves a window the document
         * can change inside, and both ways through it defeat the rule this check
         * exists to enforce. Two first saves for the same person can each observe no
         * document, each mint a token, and overwrite each other — leaving one browser
         * holding a token the stored hash no longer matches, so its later saves are
         * refused. And a save that read "exists, authorized" can commit *after* Start
         * Over deleted the draft, resurrecting an application the applicant had just
         * discarded. Neither is hypothetical: the browser fires saves in the
         * background while the applicant is still pressing buttons.
         *
         * Nothing but the draft write happens in here. The refusal path returns a
         * flag and the rate-limit and audit writes happen outside, because they are
         * not transactional writes and a retried transaction would double-count them.
         */
        const attempt = await db.runTransaction(async (transaction) => {
            const existing = await transaction.get(ref);
            const presentedToken = text(data?.resumeToken, 128);

            // A token that opens nothing means this payload predates a deletion —
            // Start Over in another tab, or a submission. Checked before the
            // ownership rules and independently of them, because the identity bar
            // would otherwise wave the same stale payload through: the applicant's
            // own name, date of birth and SSN are in it, so it authorizes fine and
            // overwrites whatever replaced the draft it was written against.
            if (presentedToken && !(await tokenOpensALiveDraft(transaction, {
                companyId,
                target: existing,
                identityKey,
                resumeToken: presentedToken,
                claimedApplicantKey: applicantKeyOf(data?.resumeApplicantKey),
            }))) {
                return { refused: true, stale: true, token: null };
            }

            // Changing an existing draft needs proof of ownership; creating one does
            // not, because an applicant on page one has nothing to prove it with yet.
            if (existing.exists) {
                const authorizedBy = mayModifyExistingDraft(existing, {
                    resumeToken: presentedToken,
                    identityKey,
                    email,
                    phone,
                });
                if (!authorizedBy) return { refused: true, token: null };
            }

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
                /**
                 * A carrier-prepared application becomes the driver's the moment
                 * they save one page of it. That is a one-way door: it is what
                 * ends the carrier's read of the answers it wrote (see
                 * `shared/companyPreparedDraft.js`), so it must not be reversible
                 * by a later save, and it must never be *set* by anything but a
                 * real driver save landing here. An ordinary driver-authored
                 * draft keeps `in_progress` exactly as before.
                 */
                status: prepared.isCompanyPrepared(existing.exists ? existing.data() : null)
                    ? prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS
                    : 'in_progress',
                updatedAt: draft.serverTimestamp(),
                expiresAt: draft.expiresAt(),
            };
            if (!existing.exists) update.createdAt = draft.serverTimestamp();
            if (token) update.resumeTokenHash = token.hash;

            transaction.set(ref, update, { merge: true });
            return { refused: false, token };
        });

        if (attempt.refused) {
            // Refusals get their own budget, and it deliberately never changes
            // the reply: telling a caller they had exceeded a *refusal* budget
            // would itself confirm that their earlier attempts were refusals.
            // What it bounds is the audit writes one caller can cause, so a
            // probe loop cannot become unbounded writes. The first attempts are
            // recorded, which is all a spike needs to be visible, and the save
            // limit above already bounds how fast attempts can arrive.
            //
            // Per *targeted draft* as well as per caller, so spreading attempts
            // across addresses does not spread the budget with them.
            //
            // Keyed on the draft being attacked, not on the identity the caller
            // claims — that was the first attempt and it does not hold: the caller
            // supplies the identity facts, so omitting or varying the SSN yields a
            // null or a fresh key on every request while every one of them still
            // targets the same document. The applicant key cannot be varied
            // without targeting a different draft, because it *is* the company,
            // email and phone that address this one. It is already a hash, so the
            // limiter holds no email, phone, name or SSN.
            //
            // Its own key, never the resume-match budget: sharing that one would
            // let a stranger's refused writes exhaust what the real applicant
            // needs to find their own draft.
            const withinProbeBudget = (await Promise.all([
                checkRateLimit(
                    `draft_write_denied_${clientIp(context)}`,
                    LIMITS.match.limit, LIMITS.match.windowSeconds, 'closed',
                ),
                checkRateLimit(
                    `draft_write_denied_target_${applicantKey}`,
                    LIMITS.matchPerIdentity.limit,
                    LIMITS.matchPerIdentity.windowSeconds,
                    'closed',
                ),
            ])).every(Boolean);
            if (withinProbeBudget) {
                // Two different operational facts: somebody wrote to a draft they
                // could not prove they own, versus a browser holding a token for a
                // draft that had already gone. The second is ordinary multi-tab life
                // and should not read as an attack in the audit trail.
                await recordMatchAttempt(
                    companyId,
                    attempt.stale ? 'stale_token' : 'unauthorized_write',
                    'draft_write_refused',
                );
            }
            // Deliberately the same shape a network failure produces. The client
            // treats it as "not synced", keeps its local copy, and tells the
            // applicant nothing — there is nothing they could do about it, and a
            // message would confirm to a stranger that this draft exists.
            return { saved: false, applicantKey: null, resumeToken: null };
        }

        // At most one live draft per identity per company. A returning applicant
        // who types a different email produces a second key, and leaving both
        // would make "continue" a coin flip.
        //
        // Gated on the caller's own resume token, because this deletes documents.
        // See `supersedeOtherDrafts` for why "knows the identity" is not enough.
        const supersedeToken = text(data?.resumeToken, 128);
        if (identityKey && supersedeToken) {
            // Per draft, never per identity. See `supersedeOtherDrafts`.
            await supersedeOtherDrafts(companyId, identityKey, applicantKey, {
                resumeToken: supersedeToken,
            });
        }

        return {
            saved: true,
            applicantKey,
            // Only on the first save. A token is minted once and never returned
            // again, so a later response cannot leak one to a different browser.
            resumeToken: attempt.token ? attempt.token.token : null,
        };
    });
