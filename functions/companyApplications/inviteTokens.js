/**
 * The algebra of an invite token: which hashes open a draft, and until when.
 *
 * Split out of `invite.js` on 2026-09-09 for the source-size standard, and it is
 * the right seam: everything here is a pure function of a stored document and a
 * presented token, with no Firestore, no callable and no policy. `invite.js` is
 * the two callables and the decisions they make.
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
 */

const crypto = require('crypto');

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

module.exports = {
    INVITE_DAYS,
    INVITE_GRACE_MS,
    MAX_PRIOR_INVITE_HASHES,
    EXCHANGE_LIMIT,
    MINT_LIMIT,
    carriedPriorInvites,
    expiryMillis,
    hashInvite,
    inviteEntries,
    inviteExpiresAt,
    inviteMatches,
    liveInviteFor,
};
