/**
 * What is left of an unfinished application a Company Admin deleted: a mark that
 * lets the tokens it handed out say so.
 *
 * A driver may still have the application open on their own device, holding its
 * resume token, or hold the link the carrier sent. With the draft gone, each of
 * those used to meet the answer a stranger gets: a save that looks like a dropped
 * connection, a link that does not open. The mark is the difference. It keeps the
 * hashes of every token the draft held, and a caller presenting one of them is
 * told the application was removed, so their page can say so and let them start
 * again (`purge.js`).
 *
 * Only the holder of such a token is told. Anyone else gets the answer they got
 * before, so the mark does not turn an email and phone into a way of learning
 * that somebody applied. A new application by the same driver, at the same key,
 * holds new tokens, so the mark never stands in its way.
 *
 * Kept in `application_draft_audit`, under `removed_{applicantKey}`: denied to
 * every client by the rules, and gone with the collection's 30-day TTL, which is
 * as long as the deleted draft could have lived.
 */

const { db } = require('../firebaseAdmin');
const draft = require('../shared/applicationDraft');
const { inviteEntries } = require('../companyApplications/inviteTokens');

/** Every token a draft holds, its prior ones and its links', with room to spare. */
const MAX_MARK_HASHES = 24;

function removalMarkRef(companyId, applicantKey) {
    return db.collection('companies').doc(String(companyId))
        .collection('application_draft_audit').doc(`removed_${applicantKey}`);
}

/**
 * The hashes of every token that could still name this draft: the resume token
 * and the ones it replaced, the one a link's opening minted, and every live link.
 * Each is a SHA-256 of a random token, so the mark holds nothing anyone typed.
 */
function tokenHashesOf(data) {
    const stored = data || {};
    const hashes = [
        stored.resumeTokenHash,
        ...(Array.isArray(stored.priorResumeTokenHashes) ? stored.priorResumeTokenHashes : []),
        stored.inviteResumeTokenHash,
        ...inviteEntries(stored).map((entry) => entry.hash),
    ];
    return [...new Set(hashes.filter((hash) => typeof hash === 'string' && hash))];
}

/**
 * The mark to write for a draft being deleted, on top of any earlier mark at the
 * same key: a driver whose application was deleted, who applied again and had
 * that one deleted too, holds tokens from both.
 */
function removalMark(previous, data) {
    const earlier = Array.isArray(previous?.tokenHashes) ? previous.tokenHashes : [];
    return {
        action: 'draft_removed',
        tokenHashes: [...new Set([...tokenHashesOf(data), ...earlier])].slice(0, MAX_MARK_HASHES),
        removedAt: draft.serverTimestamp(),
        expiresAt: draft.expiresAt(),
    };
}

/**
 * Was the application this token belonged to deleted by its company?
 *
 * Asked only once the token has opened nothing, of the keys the caller named:
 * the one its email and phone derive, and the one its browser says the token
 * belongs to. A mark that cannot be read answers no, which is the answer the
 * caller would have had without marks.
 */
async function removedForToken(companyId, applicantKeys, token) {
    if (!companyId || !token) return false;
    const keys = [...new Set(applicantKeys.filter(Boolean))];
    try {
        const marks = await Promise.all(keys.map((key) => removalMarkRef(companyId, key).get()));
        return marks.some((mark) => mark.exists
            && (mark.data()?.tokenHashes || []).some((hash) => draft.resumeTokenMatches(hash, token)));
    } catch (error) {
        console.error(`[applicationDrafts] Could not read a removal mark: ${error?.message || 'unknown'}`);
        return false;
    }
}

module.exports = { MAX_MARK_HASHES, removalMark, removalMarkRef, removedForToken, tokenHashesOf };
