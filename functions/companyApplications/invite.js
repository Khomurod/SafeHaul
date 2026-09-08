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
 * ## Validity belongs to a TOKEN, not to the document
 *
 * This is the shape of a defect found on 2026-09-08, and the reason the code below
 * looks the way it does. Matching accepted the current hash *or* any prior hash,
 * while validity read a single document-level `inviteTokenExpiresAt` that every
 * mint rewrote unconditionally — two independent questions composed into one
 * answer. So regenerating did not retire the old link, it **revived** it: a link
 * that had been dead for a week opened again, with a fresh resume token, for
 * another fourteen days. The panel meanwhile told the recruiter that "creating a
 * new one retires this one".
 *
 * So each accepted hash now carries its own expiry, and `liveInviteFor` asks both
 * questions of one entry — which is what makes the old composition impossible to
 * write again. The prior hash is kept for the reason it always claimed: a driver
 * who opened the old link a moment ago should not find it dead mid-page. That is a
 * minutes-scale concern, so it is a minutes-scale grace.
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
const { functions, runtime } = require('../drafts/runtime');
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

/**
 * How long the link a regeneration replaced keeps working.
 *
 * The whole reason to keep a prior hash at all is the driver who is mid-page on the
 * old link at the moment the recruiter presses "Create a new link". Ten minutes
 * covers that and nothing else. It is a ceiling and never an extension: a prior
 * entry expires at `min(its own expiry, now + this)`, so replacing a link that had
 * two minutes left does not give it ten.
 */
const INVITE_GRACE_MS = 10 * 60 * 1000;

/** Prior hashes kept live through a regeneration. One, as the brief has always said. */
const MAX_PRIOR_INVITE_HASHES = 1;

/** Tight: an invite token is a bearer credential and guessing it is the attack. */
const EXCHANGE_LIMIT = Object.freeze({ limit: 10, windowSeconds: 60 });

/**
 * Minting is cheap for a recruiter and useful to an attacker who has a session:
 * every regeneration retires the driver's live link, so an unbounded loop is a way
 * to keep an application permanently unopenable. Generous for real proofreading.
 */
const MINT_LIMIT = Object.freeze({ limit: 20, windowSeconds: 300 });

function hashInvite(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function inviteMatches(storedHash, token) {
    const expected = Buffer.from(String(storedHash || ''), 'utf8');
    const actual = Buffer.from(hashInvite(token), 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

/**
 * Milliseconds, from whatever the store handed back.
 *
 * Firestore returns a `Timestamp` with `toDate()`; a value written in the same
 * process — and everything in the test double — is a plain `Date`. Reading only
 * one of the two shapes measures the other as "no expiry", which fails in whichever
 * direction the reader happens to default to. Both are read, and anything else is
 * `null`, which every caller below treats as expired.
 */
function expiryMillis(value) {
    if (value && typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date ? date.getTime() : null;
    }
    if (value instanceof Date) return value.getTime();
    return typeof value === 'number' ? value : null;
}

/**
 * Every hash that could open this draft, newest first, each with its own expiry.
 *
 * `priorInviteTokenHashes` is the legacy shape: bare strings, with no expiry of
 * their own. There is no honest expiry to give them — the only one that ever
 * existed was the document-level field a later mint had already rewritten, which
 * is the defect — so they are not returned at all, i.e. treated as dead. The worst
 * case is one driver, mid-open at the moment of deployment, being asked for a fresh
 * link; the alternative is honouring exactly the amnesty this change removes.
 */
function inviteEntries(data) {
    const source = data || {};
    const entries = [];
    if (typeof source.inviteTokenHash === 'string') {
        entries.push({ hash: source.inviteTokenHash, expiresAt: source.inviteTokenExpiresAt });
    }
    if (Array.isArray(source.priorInvites)) {
        for (const entry of source.priorInvites) {
            if (entry && typeof entry.hash === 'string') {
                entries.push({ hash: entry.hash, expiresAt: entry.expiresAt });
            }
        }
    }
    return entries;
}

/**
 * Does this token open this draft, right now?
 *
 * One function on purpose. "Does the token name the draft" and "is the expiry in
 * the future" used to be two, and composing them independently is precisely what
 * let an expired token ride on a newer token's expiry. Asked of a single entry, the
 * expired case cannot be expressed.
 *
 * A hash that matches but has expired returns `null` rather than continuing the
 * scan: the token *is* that entry, and that entry is dead. (Two entries cannot
 * share a hash — each is 32 random bytes.)
 *
 * @returns {{hash: string, expiresAt: *}|null} the live entry, or null
 */
function liveInviteFor(data, token, now = Date.now()) {
    for (const entry of inviteEntries(data)) {
        if (!inviteMatches(entry.hash, token)) continue;
        const expires = expiryMillis(entry.expiresAt);
        return typeof expires === 'number' && expires > now ? entry : null;
    }
    return null;
}

function inviteExpiresAt(now = Date.now()) {
    return new Date(now + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The entries a mint carries forward, each capped at the grace window.
 *
 * Reads `inviteEntries`, so the hash being replaced is first and therefore the one
 * that survives `slice`. An entry already past its expiry is dropped rather than
 * extended — that is the difference between a grace and a revival.
 */
function carriedPriorInvites(data, now = Date.now()) {
    const graceEnd = now + INVITE_GRACE_MS;
    const carried = [];
    for (const entry of inviteEntries(data)) {
        const expires = expiryMillis(entry.expiresAt);
        if (typeof expires !== 'number' || expires <= now) continue;
        carried.push({ hash: entry.hash, expiresAt: new Date(Math.min(expires, graceEnd)) });
        if (carried.length >= MAX_PRIOR_INVITE_HASHES) break;
    }
    return carried;
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
        if (!doc.exists || !prepared.isCompanyPrepared(doc.data())) return { missing: true };
        const data = doc.data() || {};

        transaction.set(ref, {
            inviteTokenHash: hashInvite(token),
            priorInvites: carriedPriorInvites(data, now),
            // Emptied rather than left behind: the legacy list is no longer read,
            // and a stale copy of it is exactly the amnesty this change removes.
            priorInviteTokenHashes: [],
            inviteTokenExpiresAt: inviteExpiresAt(now),
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
        const opens = (doc) => Boolean(
            doc && prepared.isCompanyPrepared(doc.data()) && liveInviteFor(doc.data(), inviteToken),
        );
        let candidate = null;
        if (applicantKey) {
            // The link carries the key, so this is one read. It is a hint and not a
            // claim: the token still has to name a live invite on that document.
            const doc = await collection.doc(applicantKey).get();
            if (doc.exists && opens(doc)) candidate = doc;
        }
        if (!candidate) {
            const recent = await collection
                .where('origin', '==', prepared.ORIGIN_COMPANY)
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
    INVITE_GRACE_MS,
    MAX_PRIOR_INVITE_HASHES,
    MINT_LIMIT,
    carriedPriorInvites,
    expiryMillis,
    hashInvite,
    inviteEntries,
    inviteExpiresAt,
    inviteMatches,
    liveInviteFor,
};
