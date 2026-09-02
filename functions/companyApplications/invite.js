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
 * ## What the exchange hands back
 *
 * Everything the ordinary resumed session already needs — the answers, the applicant
 * key, and a freshly minted **resume** token. A carrier-prepared draft carries no
 * identity HMAC (the carrier does not know the driver's Social Security Number), so
 * without that token the driver's own autosave would be refused by the ordinary
 * ownership rules. Minting it here is what makes the rest of the wizard behave
 * exactly like any other resumed application.
 *
 * It also stamps `inviteClaimedAt`. That is the fact submission reads to decide
 * whether locked employers apply: a driver who never opened the link never saw the
 * carrier's employers, and must not be refused for leaving out rows nobody showed
 * them.
 */

const crypto = require('crypto');
const { onCall: onCallV2, HttpsError: HttpsErrorV2 } = require('firebase-functions/v2/https');
const { LIMITS, functions, runtime } = require('../drafts/runtime');
const { db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../shared/companyTenant');
const { assertCompanyAccessForRequest } = require('../shared/companyAccess');
const draft = require('../shared/applicationDraft');
const prepared = require('../shared/companyPreparedDraft');
const { applicantKeyOf, clientIp, docId, text } = require('../drafts/identity');

/**
 * How long a link works.
 *
 * Long enough that a driver who is asked on Friday can finish the following week;
 * short enough that a link left in a sent-mail folder is not a standing key to
 * someone's application. Independent of the draft's own 30-day retention, and
 * always the shorter of the two.
 */
const INVITE_DAYS = 14;

/** Prior hashes kept live through a regeneration, so an open tab is not killed. */
const MAX_PRIOR_INVITE_HASHES = 2;

/** Tight: an invite token is a bearer credential and guessing it is the attack. */
const EXCHANGE_LIMIT = Object.freeze({ limit: 10, windowSeconds: 60 });

function hashInvite(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function inviteMatches(storedHash, token) {
    const expected = Buffer.from(String(storedHash || ''), 'utf8');
    const actual = Buffer.from(hashInvite(token), 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

/** Now, or before the last regeneration — a link in flight is not cut off mid-open. */
function inviteNamesDraft(data, token) {
    if (inviteMatches(data?.inviteTokenHash, token)) return true;
    const prior = Array.isArray(data?.priorInviteTokenHashes) ? data.priorInviteTokenHashes : [];
    return prior.some((hash) => inviteMatches(hash, token));
}

function inviteExpiresAt(now = Date.now()) {
    return new Date(now + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

function inviteStillValid(data, now = Date.now()) {
    const expires = data?.inviteTokenExpiresAt?.toDate?.()?.getTime?.();
    return typeof expires === 'number' ? expires > now : false;
}

/**
 * Mint (or regenerate) the link for one prepared application.
 *
 * The raw token is returned exactly once. Regenerating keeps the previous hash
 * alive for the same reason resume tokens do — a driver who opened the old link a
 * moment ago should not find it dead mid-page — while the newest link is the one
 * that will still work tomorrow.
 */
exports.mintApplicationInvite = onCallV2({ cors: true }, async (request) => {
    const companyId = docId(request.data?.companyId, 100);
    const applicantKey = applicantKeyOf(request.data?.applicantKey);
    if (!companyId || !applicantKey) {
        throw new HttpsErrorV2('invalid-argument', 'companyId and applicantKey are required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'mintApplicationInvite');

    const token = crypto.randomBytes(32).toString('hex');
    const ref = draft.draftsCollection(companyId).doc(applicantKey);

    const outcome = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (!doc.exists || !prepared.isCompanyPrepared(doc.data())) return { missing: true };
        const data = doc.data() || {};

        const priorHashes = [
            typeof data.inviteTokenHash === 'string' ? data.inviteTokenHash : null,
            ...(Array.isArray(data.priorInviteTokenHashes) ? data.priorInviteTokenHashes : []),
        ].filter(Boolean).slice(0, MAX_PRIOR_INVITE_HASHES);

        transaction.set(ref, {
            inviteTokenHash: hashInvite(token),
            priorInviteTokenHashes: priorHashes,
            inviteTokenExpiresAt: inviteExpiresAt(),
            invitedAt: draft.serverTimestamp(),
            // `sent` records that a link exists. The driver taking it over is a
            // separate, later fact and must not be walked back by a regeneration.
            status: data.status === prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS
                ? prepared.PREPARED_STATUSES.DRIVER_IN_PROGRESS
                : prepared.PREPARED_STATUSES.SENT,
            updatedAt: draft.serverTimestamp(),
            expiresAt: draft.expiresAt(),
        }, { merge: true });
        return { missing: false };
    });

    if (outcome.missing) {
        throw new HttpsErrorV2('not-found', 'No prepared application was found.');
    }

    return { inviteToken: token, applicantKey, expiresInDays: INVITE_DAYS };
});

/**
 * The driver's browser, opening the link.
 *
 * Unauthenticated by necessity — the driver has no account and never will. Every
 * refusal is the same shape, because "that link expired" and "that link is wrong"
 * are different facts an attacker would happily learn.
 */
exports.exchangeApplicationInvite = functions
    .runWith(runtime)
    .https.onCall(async (data, context) => {
        const companyId = docId(data?.companyId, 100);
        const applicantKey = applicantKeyOf(data?.applicantKey);
        const inviteToken = text(data?.inviteToken, 128);
        if (!companyId || !inviteToken) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId and inviteToken are required.');
        }

        const allowed = await checkRateLimit(
            `invite_exchange_${clientIp(context)}`,
            EXCHANGE_LIMIT.limit, EXCHANGE_LIMIT.windowSeconds, 'closed',
        );
        if (!allowed) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please wait a moment.');
        }

        await assertCompanyAcceptingIntake(db, companyId);

        const collection = draft.draftsCollection(companyId);
        let candidate = null;
        if (applicantKey) {
            // The link carries the key, so this is one read. It is a hint and not a
            // claim: the token hash on that document still has to match.
            const doc = await collection.doc(applicantKey).get();
            if (doc.exists && inviteNamesDraft(doc.data(), inviteToken)) candidate = doc;
        }
        if (!candidate) {
            const recent = await collection
                .where('origin', '==', prepared.ORIGIN_COMPANY)
                .orderBy('updatedAt', 'desc')
                .limit(50)
                .get();
            candidate = recent.docs.find((doc) => inviteNamesDraft(doc.data(), inviteToken)) || null;
        }

        if (!candidate
            || !prepared.isCompanyPrepared(candidate.data())
            || !inviteStillValid(candidate.data())) {
            throw new functions.https.HttpsError('not-found', 'That application link could not be opened.');
        }

        // A resume token per open, so the driver's autosave is authorized the way
        // every other resumed session is. The superseded hash stays live for the
        // same reason it does on a resume lookup: a second tab must not be killed.
        const resumeToken = draft.mintResumeToken();
        const restored = await db.runTransaction(async (transaction) => {
            const fresh = await transaction.get(candidate.ref);
            if (!fresh.exists) return null;
            const stored = fresh.data() || {};
            const prior = [
                typeof stored.resumeTokenHash === 'string' ? stored.resumeTokenHash : null,
                ...(Array.isArray(stored.priorResumeTokenHashes) ? stored.priorResumeTokenHashes : []),
            ].filter(Boolean).slice(0, 2);

            transaction.set(candidate.ref, {
                resumeTokenHash: resumeToken.hash,
                priorResumeTokenHashes: prior,
                // The fact submission reads to decide whether the locked employers
                // apply: this driver was actually shown them.
                inviteClaimedAt: stored.inviteClaimedAt || draft.serverTimestamp(),
                updatedAt: draft.serverTimestamp(),
                expiresAt: draft.expiresAt(),
            }, { merge: true });
            return stored;
        });

        if (!restored) {
            throw new functions.https.HttpsError('not-found', 'That application link could not be opened.');
        }

        return {
            opened: true,
            applicantKey: candidate.id,
            resumeToken: resumeToken.token,
            formData: restored.formData || {},
            lockedEmployers: Array.isArray(restored.lockedEmployers) ? restored.lockedEmployers : [],
            preparedBy: restored.preparedBy?.name || null,
        };
    });

exports.__private = {
    EXCHANGE_LIMIT,
    INVITE_DAYS,
    MAX_PRIOR_INVITE_HASHES,
    hashInvite,
    inviteExpiresAt,
    inviteMatches,
    inviteNamesDraft,
    inviteStillValid,
};
