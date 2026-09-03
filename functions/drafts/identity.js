/**
 * Turning what a browser sent into an identity the store can be asked about,
 * and recording the attempt.
 *
 * Every negative property this surface has to hold lives here: a wrong guess and
 * a non-existent application answer identically, matching needs a keyed identity
 * AND a contact detail the draft already holds, and one company cannot reach
 * another's drafts.
 *
 * Part of the guest application-draft surface. The runtime options and limits
 * are in `./runtime`; `applicationDrafts.js` is the deployment surface that
 * re-exports the handlers by name.
 */

const { db } = require('../firebaseAdmin');
const draft = require('../shared/applicationDraft');
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
 * May this caller modify a draft that already exists?
 *
 * **Creating a draft and changing one are different situations.** The callable is
 * public because the application is public, and creating a draft where none exists
 * has to stay that way — an applicant on page one has nothing to prove ownership
 * with yet. But an *existing* unfinished application is somebody's work, and until
 * now a caller who knew only a company id, an email and a phone could overwrite it,
 * because those three derive the document id and nothing else was checked.
 *
 * Two proofs are accepted, and they are the two that already exist:
 *
 * 1. **The resume token** for that draft. This is the normal path: the browser is
 *    handed one on the first save and keeps it, so ordinary autosave and
 *    same-device resume present it without the applicant doing anything.
 * 2. **The identity HMAC plus a contact detail the draft already holds** — the
 *    same bar `findResumableApplication` requires to *read* the draft. A caller who
 *    clears that bar can already retrieve the whole draft by design, so allowing
 *    them to write it is not a new exposure. It is what keeps a browser that lost
 *    its token from losing its autosave.
 *
 * Neither proof is obtainable from contact information alone.
 */
function mayModifyExistingDraft(doc, { resumeToken, identityKey, email, phone }) {
    const stored = doc.data() || {};

    if (resumeToken && draft.resumeTokenMatches(stored.resumeTokenHash, resumeToken)) {
        return 'token';
    }
    if (identityKey && stored.identityKey && stored.identityKey === identityKey
        && draft.contactMatches(stored, { email, phone })) {
        return 'identity';
    }
    return null;
}

/**
 * Does the token this caller presented still open a live draft?
 *
 * A browser presents a resume token to say "I am writing the draft I already own".
 * When that draft no longer exists the sentence is no longer true, and the payload
 * carrying it was composed against something that has since been deleted — by Start
 * Over in another tab, or by the applicant submitting. Writing it anyway is how a
 * discarded application comes back, and the client cannot help here: the request may
 * already have been on the wire when the draft went away.
 *
 * Refusing on that basis is safe because a legitimate save never trips it:
 *
 *  - ordinary autosave presents the token of the very document it is writing;
 *  - an applicant who corrects their email writes a *new* key while still holding
 *    the previous draft's token — and that draft is alive right up until this same
 *    save retires it, so the token resolves;
 *  - a genuine first save presents no token at all and never reaches this.
 *
 * Cheapest question first, and each step **falls through** rather than deciding: the
 * document being written, then the identity's own drafts (one indexed query, normally
 * one document), then the bounded recent-drafts scan.
 *
 * The fall-through is the part that matters. An applicant who corrects a contact
 * field *and* an identity field before the same save changes both the document id and
 * the identity HMAC at once, so neither of the first two questions can see the still
 * live draft their token belongs to. Returning "stale" there would refuse every
 * subsequent save and silently kill server autosave and cross-session resume for that
 * applicant — the opposite of what this rule is for. The scan is bounded, so a very
 * old draft at a busy company can still fall outside it; that is the same window
 * `resumeApplicationDraft` already accepts when a browser presents a token without a
 * key, and it errs towards refusing a write rather than towards accepting a stale one.
 *
 * All of it inside the caller's transaction, so the answer and the write it authorizes
 * cannot disagree.
 */
/**
 * How many superseded token hashes a draft remembers.
 *
 * Only for the liveness question below — never for authorization. Two is enough for the
 * case it exists to serve, one other device reaching the resume prompt while this one is
 * mid-save; a token rotated further back than that is old enough that refusing the write
 * is the safer answer.
 */
const MAX_PRIOR_TOKEN_HASHES = 2;

/** The prior-hash list a draft should carry once its token is rotated. */
function priorHashesAfterRotation(stored) {
    const prior = Array.isArray(stored?.priorResumeTokenHashes) ? stored.priorResumeTokenHashes : [];
    const rotated = typeof stored?.resumeTokenHash === 'string' ? stored.resumeTokenHash : null;
    return (rotated ? [rotated, ...prior] : prior)
        .filter((hash) => typeof hash === 'string' && hash)
        .slice(0, MAX_PRIOR_TOKEN_HASHES);
}

/**
 * Does this token name this draft — now, or before its last rotation?
 *
 * The prior generations answer *liveness only*: "the draft this payload was written
 * against still exists". They authorize nothing. Changing an existing draft still
 * requires the current token hash or the full identity, which is what keeps a harvested
 * old token from becoming a write capability.
 *
 * They are needed because a resume *lookup* rotates the token on a live draft before the
 * applicant has chosen anything. A second device merely reaching the prompt — and then
 * closing it — would otherwise make the first device's next save look like a write
 * against a deleted draft, and every save after it, silently ending server autosave for
 * an applicant who deleted nothing.
 */
function tokenNamesDraft(doc, resumeToken) {
    const data = doc?.data?.() || {};
    if (draft.resumeTokenMatches(data.resumeTokenHash, resumeToken)) return true;
    const prior = Array.isArray(data.priorResumeTokenHashes) ? data.priorResumeTokenHashes : [];
    return prior.some((hash) => draft.resumeTokenMatches(hash, resumeToken));
}

/**
 * The live draft this token names, or null.
 *
 * The liveness question above, answered with the document rather than a boolean
 * — because *which* document it is matters when the answer came from falling
 * through. An applicant correcting their email writes to a different id than the
 * draft their token belongs to, and anything the CARRIER recorded on that draft
 * has to travel with the applicant rather than stay behind on a key nobody will
 * write to again. See `drafts/save.js`.
 */
async function liveDraftForToken(transaction, {
    companyId, target, identityKey, resumeToken, claimedApplicantKey,
}) {
    if (target?.exists && tokenNamesDraft(target, resumeToken)) {
        return target;
    }

    const matching = (docs) => docs.find((doc) => tokenNamesDraft(doc, resumeToken)) || null;

    // The browser tells us which key it thinks its token belongs to. A hint, never a
    // claim: the token hash on that document still has to match, so naming somebody
    // else's draft proves nothing and gains nothing. What it buys is one read instead
    // of a scan — and correctness for the case the scan can miss, where an applicant
    // corrected a contact field and an identity field at once and the owned draft is
    // old enough to sit outside the recent window.
    if (claimedApplicantKey && claimedApplicantKey !== target?.id) {
        const claimed = await transaction.get(
            draft.draftsCollection(companyId).doc(claimedApplicantKey),
        );
        if (claimed.exists && tokenNamesDraft(claimed, resumeToken)) return claimed;
    }

    if (identityKey) {
        const siblings = await transaction.get(
            draft.draftsCollection(companyId).where('identityKey', '==', identityKey),
        );
        const sibling = matching(siblings.docs);
        if (sibling) return sibling;
    }

    const recent = await transaction.get(
        draft.draftsCollection(companyId).orderBy('updatedAt', 'desc').limit(50),
    );
    return matching(recent.docs);
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
async function recordMatchAttempt(companyId, outcome, action = 'resume_match_attempted') {
    try {
        await db.collection('companies').doc(String(companyId))
            .collection('application_draft_audit')
            .add({
                // Named separately from the lookup, because the operational
                // question this collection answers is "how many resume attempts is
                // this apply page seeing, and how many matched". A refused *write*
                // filed under the same action would inflate that count and hide
                // what is actually a different signal.
                action,
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

/**
 * Retires the caller's *own* other live draft for the same person and company.
 *
 * Deleted rather than tombstoned: an applicant who retyped their email has one
 * application in progress, not two, and an abandoned duplicate holding a name and
 * a date of birth is not worth keeping to record that they changed their mind.
 *
 * **Only a draft whose resume token the caller presents is retired**, and that
 * precision is the security property. This used to run on the identity alone,
 * which made it a delete primitive: anyone who knew a name, a date of birth and an
 * SSN could save under an email of their own and have the real applicant's draft
 * superseded.
 *
 * "Holds a token for *some* draft with this identity" is not sufficient either,
 * and that is the subtle version of the same attack: the same three facts let a
 * stranger create their own draft, which inherits the victim's identity key, and
 * the token minted for it would then unlock the deletion on the next save. The
 * only claim that cannot be manufactured from identity facts is a token for the
 * specific draft being deleted — you may retire an application you own.
 *
 * The legitimate case is exactly that. A browser whose applicant corrects their
 * email writes a new key and presents the token it was given for the old one, so
 * the old one goes; a device that resumed holds that draft's token for the same
 * reason. A straggler nobody can prove they own is left to the 30-day TTL, which
 * is a duplicate in a list, not somebody's deleted work.
 *
 * ## Per draft, never per identity — including for Start Over
 *
 * It is tempting to let `startNewApplication` sweep the identity outright, on the
 * grounds that it resolved a live draft of that identity by token before deleting
 * anything. That reasoning does not hold, and trying it reintroduced the exact
 * primitive this gate exists to remove: knowing a name, a date of birth and an SSN
 * is enough to *create* a draft that inherits the victim's identity HMAC and to be
 * handed a valid token for it — after which "I own a draft with this identity" is
 * true of an attacker, and a sweep authorized by it deletes the victim's work.
 *
 * So there is no ownership-proven mode. A draft is retired only by a caller holding
 * that draft's own token, whoever is asking and whatever they are asking for.
 *
 * @param {{ resumeToken?: string }} [proof]
 */
async function supersedeOtherDrafts(companyId, identityKey, keepApplicantKey, proof = {}) {
    const { resumeToken } = proof;
    try {
        const snapshot = await draft.draftsCollection(companyId)
            .where('identityKey', '==', identityKey)
            .get();

        const stale = snapshot.docs.filter((doc) => doc.id !== keepApplicantKey);
        const owned = stale.filter(
            (doc) => draft.resumeTokenMatches(doc.data()?.resumeTokenHash, resumeToken),
        );
        await Promise.all(owned.map((doc) => doc.ref.delete()));
    } catch (error) {
        // A tidy-up failure must not fail the save it follows. The match below
        // takes the most recently updated draft, so a straggler is at worst
        // noise, and it expires on its own.
        console.error(`[applicationDrafts] Could not supersede older drafts: ${error?.message || 'unknown'}`);
    }
}

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

module.exports = {
    MAX_PRIOR_TOKEN_HASHES,
    applicantKeyOf,
    clientIp,
    docId,
    findByToken,
    identityKeyOrNull,
    mayModifyExistingDraft,
    priorHashesAfterRotation,
    recordMatchAttempt,
    supersedeOtherDrafts,
    text,
    tokenNamesDraft,
    liveDraftForToken,
};
