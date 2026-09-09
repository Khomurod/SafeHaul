/**
 * The link a carrier sends a driver, and what the driver's browser exchanges it for.
 *
 * ## Why this is not the resume token
 *
 * A resume token is minted for the driver's own save-and-return loop, lives only in
 * their browser, and is rotated freely — `findResumableApplication` rotates it on a
 * live draft before the applicant has chosen anything. A link the carrier copies
 * into an email or a text message is a different object with a different blast
 * radius: it travels through channels the carrier controls, sits in sent-mail
 * archives, and must keep working for days without being invalidated by whatever the
 * driver's browser happens to do. So it is its own token, with its own hash, its own
 * rotation and its own, shorter, expiry.
 *
 * Only the SHA-256 is stored, as everywhere else here: a leaked database row is not
 * a usable link.
 *
 * The token algebra those two questions are asked with — which hashes open a
 * draft, and until when — lives in `./inviteTokens.js`, together with the account
 * of the defect that made composing them independently a revival rather than a
 * retirement.
 *
 * ## What the exchange hands back, and why it depends on whose words are in the draft
 *
 * While the draft is still `prepared` or `sent` the answers are the CARRIER's own,
 * so the link hands over everything an ordinary resumed session needs: the answers,
 * the applicant key, and a freshly minted **resume** token. A carrier-prepared
 * draft carries no identity HMAC (the carrier does not know the driver's Social
 * Security Number), so without that token the driver's own autosave would be
 * refused by the ordinary ownership rules. Minting it here is what makes the rest
 * of the wizard behave exactly like any other resumed application.
 *
 * Once the driver has saved — `driver_in_progress` — the answers are theirs, and
 * `shared/companyPreparedDraft.js` says the carrier stops being able to read them.
 * That cutoff was enforced at only one of the two doors: `companyApplications/read.js`
 * consulted `companyMayReadAnswers`, while this file consulted `isCompanyPrepared`,
 * which tests `origin` — a field recording who *created* the draft, which
 * deliberately never changes. So a carrier could mint a link, exchange it itself,
 * and recover exactly the answers the cutoff had just withheld, plus a resume token
 * that could rewrite them. The driver's first save does not clear
 * `inviteTokenHash` either, so the ORIGINAL link already did this — gating the mint
 * would not have closed it. Found and fixed 2026-09-08.
 *
 * So the link is **tiered**, and since 2026-09-09 the tier is decided by
 * `companyMayReadAnswers` — the very predicate the other door has always used.
 * Two questions composed into one boundary is the shape of every defect this file
 * records, so there is now one question.
 *
 * Opened with no identity claim and the answers not the carrier's, it returns
 * `requiresIdentity` and writes nothing: a carrier holding this link can neither
 * read the driver's answers nor displace the token their browser is saving with.
 * (It used to rotate that token on every open, demoting the driver's to a prior
 * hash, which grants liveness but never write authorization — so a carrier opening
 * its own link a few times could silently stop the driver's autosave.)
 *
 * **The claim is checked against the draft this link names**, in `./inviteIdentity.js`.
 * The original plan delegated that to `findResumableApplication`, and neither half
 * of the delegation worked: the client had no screen for `requiresIdentity` at all,
 * so the driver was dropped into the fresh-application chooser, and the lookup
 * queries `identityKey ==` — which autosave was erasing on every save issued
 * without an SSN in memory. Both measured in production on 2026-09-09 against the
 * reported application. A link that already resolved the document has no business
 * asking "does any draft here match this identity"; it asks "is this that
 * applicant".
 *
 * ## A continuation link is not only for an application the carrier prepared
 *
 * Whose words are in the draft decides what the link hands over. It never decided
 * whether the link opens — but `isCompanyPrepared` was part of both the mint gate
 * and the resolution predicate, so a driver who started an application themselves
 * and stopped could not be sent back to it at all. `/company/drivers/unfinished`
 * is a list of exactly those people. Minting now works for any live draft, and a
 * draft the driver authored is always in the identity tier, because the carrier
 * never wrote a word of it.
 *
 * ## `inviteClaimedAt` is stamped by the driver's first save, not by the exchange
 *
 * It is the fact submission reads to decide whether locked employers apply: a
 * driver who never opened the link never saw the carrier's employers and must not
 * be refused for leaving out rows nobody showed them. Stamping it on the exchange
 * let the CARRIER arm that refusal by opening its own link once — after which a
 * driver who applied at `/apply/:slug` instead of through the link would be blocked
 * at submission by rows they had never been shown. So the exchange records *which*
 * resume token it minted (`inviteResumeTokenHash`), and `drafts/save.js` stamps the
 * claim when a save presents that token — which proves both that the link was
 * opened and that the session holding the carrier's answers is the one saving.
 */

const crypto = require('crypto');
const { onCall: onCallV2, HttpsError: HttpsErrorV2 } = require('firebase-functions/v2/https');
const { LIMITS, functions, runtimeWithIdentityKey } = require('../drafts/runtime');
const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../shared/companyTenant');
const { assertCompanyAccessForRequest } = require('../shared/companyAccess');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const {
    applicantKeyOf, clientIp, docId, recordMatchAttempt, text,
} = require('../drafts/identity');
const {
    CLAIM_OUTCOMES, readClaim, verifyInviteIdentityClaim,
} = require('./inviteIdentity');
const {
    EXCHANGE_LIMIT, INVITE_DAYS, MINT_LIMIT,
    carriedPriorInvites, hashInvite, inviteExpiresAt, liveInviteFor,
} = require('./inviteTokens');

/**
 * The prior-hash list a rotation leaves behind. Liveness only, never authorization
 * — see `tokenNamesDraft` in `drafts/identity.js`.
 */
function priorResumeHashes(stored) {
    return [
        typeof stored.resumeTokenHash === 'string' ? stored.resumeTokenHash : null,
        ...(Array.isArray(stored.priorResumeTokenHashes) ? stored.priorResumeTokenHashes : []),
    ].filter(Boolean).slice(0, 2);
}

/** The lock list as stored, untouched. */
function storedLocks(stored) {
    return Array.isArray(stored.lockedEmployers) ? stored.lockedEmployers : [];
}

/**
 * Mint (or regenerate) the link for one prepared application.
 *
 * The raw token is returned exactly once. Regenerating retires the link it
 * replaces — after the short grace above — which is what the recruiter is told.
 */
exports.mintApplicationInvite = onCallV2({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    const applicantKey = applicantKeyOf(request.data?.applicantKey);
    if (!companyId || !applicantKey) {
        throw new HttpsErrorV2('invalid-argument', 'companyId and applicantKey are required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'mintApplicationInvite');

    // Both of these were missing until 2026-09-08, which made this the only one of
    // the five prepared-application callables with neither.
    await assertCompanyAcceptingIntake(db, companyId);
    const allowed = await checkRateLimit(
        `company_invite_${companyId}_${request.auth.uid}`,
        MINT_LIMIT.limit, MINT_LIMIT.windowSeconds, 'closed',
    );
    if (!allowed) {
        throw new HttpsErrorV2('resource-exhausted', 'Too many links in a row. Wait a moment and try again.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const ref = draft.draftsCollection(companyId).doc(applicantKey);
    const now = Date.now();

    const outcome = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (!doc.exists) return { missing: true };
        const data = doc.data() || {};

        transaction.set(ref, {
            inviteTokenHash: hashInvite(token),
            priorInvites: carriedPriorInvites(data, now),
            // Emptied rather than left behind: the legacy list is no longer read,
            // and a stale copy of it is exactly the amnesty this change removes.
            priorInviteTokenHashes: [],
            inviteTokenExpiresAt: inviteExpiresAt(now),
            invitedAt: draft.serverTimestamp(),
            /**
             * The status a link changes, and the status it must not.
             *
             * `sent` records that a link exists for an application the CARRIER
             * prepared. The driver taking it over is a separate, later fact and must
             * not be walked back by a regeneration — so `driver_in_progress` stands.
             *
             * A draft the DRIVER started has no such life-cycle: it is
             * `in_progress`, the answers were never the carrier's, and writing
             * `sent` over it would tell `companyMayReadAnswers` that the carrier
             * authored answers it has never seen. Its status is left exactly as it
             * is; the invite fields alone are what a continuation link needs.
             */
            ...(prepared.isCompanyPrepared(data)
                ? {
                    status: data.status === prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS
                        ? prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS
                        : prepared.PREPARED_STATUSES.SENT,
                }
                : {}),
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        }, { merge: true });
        return { missing: false, driverOwned: !prepared.companyMayReadAnswers(data) };
    });

    if (outcome.missing) {
        throw new HttpsErrorV2('not-found', 'No unfinished application was found.');
    }

    return {
        inviteToken: token,
        applicantKey,
        expiresInDays: INVITE_DAYS,
        // Whether the link will ask the driver to confirm who they are. The panel
        // says so rather than implying the recruiter can open it themselves — and it
        // comes from the same predicate the exchange decides with, so the sentence
        // cannot drift from the behaviour the way the expiry copy once did.
        requiresIdentity: outcome.driverOwned,
    };
});

/**
 * The driver's browser, opening the link.
 *
 * Unauthenticated by necessity — the driver has no account and never will. Every
 * refusal is the same shape, because "that link expired" and "that link is wrong"
 * are different facts an attacker would happily learn.
 */
exports.exchangeApplicationInvite = functions
    // Binds `SMS_ENCRYPTION_KEY`, because the identity claim below derives the same
    // HMAC the draft stores. The literal lives in `drafts/runtime.js`, which imports
    // 1st generation — the generation this callable deploys under — so
    // `secretBindingGenerations.test.js` still sees one generation per binding site.
    .runWith(runtimeWithIdentityKey)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        const applicantKey = applicantKeyOf(data?.applicantKey);
        const inviteToken = text(data?.inviteToken, 128);
        if (!companyId || !inviteToken) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId and inviteToken are required.');
        }
        const claim = readClaim(data?.identity);

        const allowed = await checkRateLimit(
            `invite_exchange_${clientIp(context)}`,
            EXCHANGE_LIMIT.limit, EXCHANGE_LIMIT.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const collection = draft.draftsCollection(companyId);
        /**
         * Does this token open this document?
         *
         * `isCompanyPrepared` used to be part of this question, which made a
         * continuation link something only a carrier-prepared application could
         * have — so "Started (unfinished)", the list of drafts a driver began and
         * abandoned, had no way to send anybody back to their own work. Whose words
         * are in the draft decides what the link HANDS OVER, below; it has no
         * business deciding whether the link opens at all.
         */
        const opens = (doc) => Boolean(doc && liveInviteFor(doc.data(), inviteToken));
        let candidate = null;
        if (applicantKey) {
            // The link carries the key, so this is one read. It is a hint and not a
            // claim: the token still has to name a live invite on that document.
            const doc = await collection.doc(applicantKey).get();
            if (doc.exists && opens(doc)) candidate = doc;
        }
        if (!candidate) {
            // No `origin` filter either, for the same reason, which also drops this
            // path's dependency on the `origin`/`updatedAt` composite index.
            const recent = await collection
                .orderBy('updatedAt', 'desc')
                .limit(50)
                .get();
            candidate = recent.docs.find((doc) => opens(doc)) || null;
        }

        if (!candidate) {
            throw new functions.https.HttpsError('not-found', 'That application link could not be opened.');
        }

        // A resume token per open, so the driver's autosave is authorized the way
        // every other resumed session is. The superseded hash stays live for the
        // same reason it does on a resume lookup: a second tab must not be killed.
        //
        // Everything is re-read inside the transaction rather than taken from the
        // candidate: the driver's first save can land between the two, and it is
        // the one fact that decides whether this open hands over answers at all.
        const resumeToken = draft.mintResumeToken();
        const outcome = await db.runTransaction(async (transaction) => {
            const fresh = await transaction.get(candidate.ref);
            if (!fresh.exists) return null;
            const stored = fresh.data() || {};

            /**
             * One predicate for both doors, at last.
             *
             * `companyApplications/read.js` has always asked `companyMayReadAnswers`
             * — the carrier authored these answers AND the driver has not written
             * over them — while this file asked its own narrower question. Two
             * questions composed into one boundary is the shape of the defect this
             * whole file keeps recording, so there is now one.
             */
            if (!prepared.companyMayReadAnswers(stored)) {
                if (!claim) {
                    // Theirs. Nothing is written — not the token, not the claim — so
                    // a carrier holding this link cannot read the driver's answers,
                    // cannot rewrite them, and cannot displace the token the
                    // driver's own browser is saving with.
                    return { requiresIdentity: true };
                }

                const verdict = verifyInviteIdentityClaim({ companyId, stored, claim });
                if (verdict.outcome !== CLAIM_OUTCOMES.OK) {
                    return { refused: verdict.outcome };
                }

                const prior = priorResumeHashes(stored);
                transaction.set(candidate.ref, {
                    resumeTokenHash: resumeToken.hash,
                    priorResumeTokenHashes: prior,
                    // Establishes the HMAC when the draft had none, so the next
                    // replacement link is verified rather than merely checked
                    // against two answers. Never cleared: a null here would be the
                    // erasure `identityKeyForSave` exists to stop.
                    ...(verdict.identityKey ? { identityKey: verdict.identityKey } : {}),
                    // Which token the claim belongs to, exactly as the hand-over
                    // branch does — `drafts/save.js` stamps `inviteClaimedAt` when a
                    // save presents it. A driver-authored draft has no locked
                    // employers, so for one this changes nothing.
                    inviteResumeTokenHash: resumeToken.hash,
                    updatedAt: draft.serverTimestamp(),
                    expiresAt: draft.expiresAt(),
                }, { merge: true });
                // Deliberately NO `reconcileLockedEmployers` here. It may only run
                // while the employer rows are provably the carrier's; reconciling
                // against answers the driver supplied would make deleting a locked
                // row enough to delete its lock, which is the whole thing the lock
                // prevents.
                return {
                    requiresIdentity: false, stored, healedLocks: storedLocks(stored), tier: verdict.tier,
                };
            }

            const prior = priorResumeHashes(stored);

            /**
             * The last moment the employer rows are provably the carrier's.
             *
             * A lock whose row the carrier deleted is an invisible requirement the
             * driver is blocked on at submission and cannot satisfy. `prepare.js`
             * stops that being written from now on, but drafts already carrying one
             * need healing — and it has to happen before the driver can influence
             * the rows, or "delete the row" would become "delete the lock", which
             * is the whole thing the lock prevents. Here, in the transaction that
             * hands the application over, is exactly that moment: the status is
             * still `prepared` or `sent`, so nobody but the carrier has written a
             * word of it.
             */
            const healedLocks = prepared.reconcileLockedEmployers(
                stored.lockedEmployers, stored.formData,
            );

            transaction.set(candidate.ref, {
                resumeTokenHash: resumeToken.hash,
                priorResumeTokenHashes: prior,
                lockedEmployers: healedLocks,
                // Which token the claim belongs to. `drafts/save.js` stamps
                // `inviteClaimedAt` when a save presents this one, and clears this
                // field doing so — see the header for why the claim is not stamped
                // here.
                inviteResumeTokenHash: resumeToken.hash,
                updatedAt: draft.serverTimestamp(),
                expiresAt: draft.expiresAt(),
            }, { merge: true });
            return { requiresIdentity: false, stored, healedLocks, tier: 'author' };
        });

        if (!outcome) {
            throw new functions.https.HttpsError('not-found', 'That application link could not be opened.');
        }

        if (outcome.refused) {
            /**
             * A refused claim, spent against a budget kept per targeted draft.
             *
             * The link is a bearer credential, so whoever holds it was already told
             * `requiresIdentity` and knows an application is there — saying "those
             * details do not match" therefore discloses nothing new, and saying
             * nothing would leave a driver who mistyped their date of birth with no
             * way to tell that from a dead link. What must be bounded is guessing:
             * the per-IP limit above does not stop a distributed attempt at one
             * draft, so the draft itself carries a budget. Keyed on the applicant
             * key, which is already a hash and cannot be varied without addressing
             * a different application.
             */
            const withinBudget = await checkRateLimit(
                `invite_identity_denied_${candidate.id}`,
                LIMITS.matchPerIdentity.limit, LIMITS.matchPerIdentity.windowSeconds, 'closed',
            );
            // Inside the budget, as `drafts/save.js` does it: what the budget bounds
            // is the audit writes one caller can cause, so recording first would
            // have made a probe loop unbounded writes — which is the thing it is
            // there to stop. The first attempts are recorded, which is all a spike
            // needs to be visible.
            if (withinBudget) {
                await recordMatchAttempt(companyId, outcome.refused, 'invite_identity_refused');
            } else {
                throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
            }
            throw new functions.https.HttpsError(
                'permission-denied',
                outcome.refused === CLAIM_OUTCOMES.UNVERIFIABLE
                    ? 'We cannot confirm this application belongs to you from what has been saved so far.'
                    : 'Those details do not match this application.',
            );
        }

        if (outcome.requiresIdentity) {
            // `applicantKey` is already in the link's own query string, so saying it
            // back discloses nothing. Everything else is withheld, including who
            // prepared it and how far the driver got.
            return { opened: true, requiresIdentity: true, applicantKey: candidate.id };
        }

        const restored = outcome.stored;
        /**
         * A confirmed identity is an authentication event and is recorded; an
         * ordinary hand-over is not.
         *
         * The distinction is the operational question this collection answers —
         * "how many people are being asked to prove who they are, and how often does
         * it fail" — and auditing every open would drown it in rows for the tier
         * where nothing was proved. The value-free rule holds: the tier that
         * verified, never what was presented. `author` is the hand-over.
         */
        if (outcome.tier !== 'author') {
            await recordMatchAttempt(companyId, outcome.tier, 'invite_identity_confirmed');
        }
        return {
            opened: true,
            requiresIdentity: false,
            applicantKey: candidate.id,
            resumeToken: resumeToken.token,
            formData: restored.formData || {},
            // Where the driver actually was. Withheld until 2026-09-09, which was
            // survivable only because a carrier-prepared draft is always on page
            // one: a driver confirming their identity to continue their own
            // application would otherwise be handed their answers and dropped back
            // at the start of the wizard.
            lastStep: Number.isInteger(restored.lastStep) ? restored.lastStep : 0,
            lastSemanticStep: typeof restored.lastSemanticStep === 'string'
                ? restored.lastSemanticStep
                : null,
            // So the browser can reconcile its own copy against this one instead of
            // assuming one of them is newer — see `reconcileApplicationDraft`.
            clientSeq: Number.isInteger(restored.clientSeq) ? restored.clientSeq : null,
            // The healed list, so the rows the wizard renders as locked are exactly
            // the rows submission will enforce.
            lockedEmployers: outcome.healedLocks,
            preparedBy: restored.preparedBy?.name || null,
        };
    });

/**
 * Re-exported for the suites, from wherever each piece now lives. The expiry suite
 * reads this object rather than the module that defines each function, so the split
 * above is invisible to it — which is the point: a test that pins BEHAVIOUR should
 * not fail because a file was divided.
 */
exports.__private = {
    ...require('./inviteTokens'),
    ...require('./inviteIdentity'),
    priorResumeHashes,
};
