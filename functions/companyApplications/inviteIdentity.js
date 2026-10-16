/**
 * Proving that the person who opened a continuation link is the applicant.
 *
 * ## Why this file exists
 *
 * `invite.js` describes a **tiered** link: while the answers are the carrier's own
 * the exchange hands over everything, and once they are the driver's it hands over
 * nothing and answers `requiresIdentity`. This file is the check behind that
 * answer; on the site, `ApplyIdentityCheckScreen` renders it, where the intake
 * chooser would hide the driver's own half-finished application.
 *
 * The link already names the draft — `exchangeApplicationInvite` resolves it from
 * the token before deciding anything — so the claim is checked **against the one
 * draft the token opened**, and nothing else. A global lookup
 * (`findResumableApplication`, which queries `identityKey ==`) would throw that
 * away, need a composite index, need the applicant to guess which contact detail
 * the carrier used, and could not answer at all for a draft whose stored identity
 * was lost. `drafts/identity.js` (`identityKeyForSave`) keeps a save from erasing
 * that identity; this file also covers the drafts that hold none.
 *
 * ## What the driver has to prove, and why those facts
 *
 * The threat is the *carrier*: it minted the link, it may still hold a copy, and
 * the exchange is unauthenticated by necessity. So the bar has to be something the
 * carrier cannot obtain from SafeHaul. It knows the contact details (they key the
 * draft and the worklist shows them) and, for an application it prepared, whatever
 * it typed. It does not know the Social Security Number — that is the premise the
 * whole draft model rests on — and it is never shown a driver-owned draft's date of
 * birth.
 *
 * The claim is therefore last name, date of birth, Social Security Number, and a
 * contact detail already on the record: exactly the sentence `InviteLinkPanel`
 * has been showing recruiters all along.
 *
 * ## Two tiers of *checking*, because production has both shapes
 *
 * - **`hmac`** — the draft holds an `identityKey`. The claim is verified by
 *   recomputing it. This subsumes the name and date of birth (both are inputs) and
 *   is a real check on the SSN. Every draft written after `identityKeyForSave`
 *   reaches this tier and stays in it.
 *
 * - **`answers`** — a draft the driver started holds no `identityKey`, because a
 *   save erased it or because it predates the field (a prepared one is refused
 *   instead; see below). There is nothing to verify an SSN against, so
 *   the name and date of birth are checked against the draft's own answers and a
 *   well-formed SSN is required. **A successful check then establishes the
 *   `identityKey`**, so a draft passes through this tier at most once — and it is
 *   better authorized than the ordinary first save that would have written the same
 *   value, because it also had to present a live invite token and match two stored
 *   answers.
 *
 *   Both of those answers, and the tier refuses rather than checking whichever it
 *   has: the date of birth is the one compared fact the carrier is never shown, so
 *   waiving it when the draft does not hold one leaves a check made entirely of
 *   things the carrier already knows.
 *
 * Honest about its own limit: in the `answers` tier the SSN is *required* and not
 * *verified* — any nine digits pass — so the tier is exactly as strong as the date
 * of birth the carrier is never shown. That holds only for a draft the driver
 * started. On one the carrier **prepared**, the carrier typed the last name, the
 * date of birth and the contact detail itself, so the tier would compare nothing
 * it does not already know. A prepared draft with no HMAC is therefore refused as
 * `unverifiable`: the driver continues on the device that holds their resume
 * token, which asks nothing, or starts a new application. The proper
 * fix for a driver who has lost that device is out-of-band delivery (App Brief §12).
 *
 * A draft that does not hold both of those facts cannot be verified at all, and
 * this says so (`unverifiable`) rather than guessing. That is the state the task
 * calls "essential identity information never existed": the safest useful
 * behaviour is to tell the driver we cannot confirm it is theirs and let them start
 * a new application, never to hand the answers over and never to duplicate the
 * record. It costs a driver who is on a new device AND has typed almost nothing
 * yet — their own device still resumes with no question asked, because it holds the
 * resume token — and what it buys is that a link cannot be turned into the answers
 * by whoever minted it.
 */

const draft = require('../shared/applicationDraft');
const { isCompanyPrepared } = require('../shared/companyPreparedDraft');
const { identityKeyOrNull, text } = require('../drafts/identity');

/**
 * Why a claim was refused. Never returned to a browser verbatim — the client
 * collapses every refusal into one sentence — but recorded in the audit trail,
 * where the difference between "wrong details" and "nothing to check against" is
 * the difference between an attack and a limitation.
 */
const CLAIM_OUTCOMES = Object.freeze({
    OK: 'ok',
    CONTACT_MISMATCH: 'contact_mismatch',
    IDENTITY_MISMATCH: 'identity_mismatch',
    IDENTITY_INCOMPLETE: 'identity_incomplete',
    UNVERIFIABLE: 'unverifiable',
});

/** The claim as it arrives from a browser: trimmed, bounded, nothing else. */
function readClaim(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const claim = {
        lastName: text(raw.lastName, 200),
        dob: text(raw.dob, 40),
        ssn: text(raw.ssn, 40),
        // One field on the driver's screen, sent as both: `contactMatches` reads an
        // email as an email and a phone as digits, so whichever the carrier keyed
        // the draft with is the one that matches. Asking the driver to guess which
        // of their own details the recruiter typed is a question they cannot answer.
        email: text(raw.contact ?? raw.email, 200),
        phone: text(raw.contact ?? raw.phone, 40),
    };
    // Nothing at all is "no claim was made", which is a different situation from a
    // claim that failed: it is the first open of the link.
    if (!claim.lastName && !claim.dob && !claim.ssn && !claim.email && !claim.phone) return null;
    return claim;
}

/**
 * Does this claim open this draft?
 *
 * @param {object} options
 * @param {string} options.companyId
 * @param {object} options.stored the draft document's data
 * @param {object} options.claim from `readClaim`
 * @returns {{outcome: string, identityKey: ?string, tier: ?string}}
 */
function verifyInviteIdentityClaim({ companyId, stored, claim }) {
    const refuse = (outcome) => ({ outcome, identityKey: null, tier: null });

    // The possession-ish half, and the same bar `findResumableApplication` sets:
    // three facts about a person are not enough without one of their contact
    // details already on the record.
    if (!draft.contactMatches(stored, { email: claim.email, phone: claim.phone })) {
        return refuse(CLAIM_OUTCOMES.CONTACT_MISMATCH);
    }

    // `identityKeyOrNull`, never `buildIdentityKey` directly: the latter throws when
    // `SMS_ENCRYPTION_KEY` is unreadable, and letting that escape would turn a
    // misconfiguration into "your application link is broken" for every driver.
    const computed = identityKeyOrNull({
        companyId,
        lastName: claim.lastName,
        dob: claim.dob,
        ssn: claim.ssn,
    }, 'exchangeApplicationInvite');

    const onFile = typeof stored?.identityKey === 'string' && stored.identityKey
        ? stored.identityKey
        : null;

    if (onFile) {
        // A real check. `buildIdentityKey` returns null for a partial identity or an
        // SSN that is not nine digits, and null never equals a stored hash, so the
        // incomplete case is refused here without a second branch.
        if (!computed || computed !== onFile) return refuse(CLAIM_OUTCOMES.IDENTITY_MISMATCH);
        return { outcome: CLAIM_OUTCOMES.OK, identityKey: computed, tier: 'hmac' };
    }

    // Nothing on file to verify against, and on a draft the carrier prepared nothing
    // the draft holds is a secret from the carrier: it typed the last name, the date
    // of birth and the contact detail itself, and an SSN cannot be checked here. So
    // no claim opens it, and the driver continues on the device whose resume token
    // already does. See the header.
    if (isCompanyPrepared(stored)) return refuse(CLAIM_OUTCOMES.UNVERIFIABLE);

    // A draft the driver started: check what it does hold.
    if (draft.normalizeSsn(claim.ssn).length !== 9) {
        return refuse(CLAIM_OUTCOMES.IDENTITY_INCOMPLETE);
    }

    const answers = stored?.formData || {};
    const storedLastName = draft.normalizeName(answers.lastName);
    const storedDob = draft.normalizeDob(answers.dob);

    // BOTH, and this is the whole strength of the tier. Accepting whichever one the
    // draft happens to hold reads like leniency towards a driver who has not typed
    // much yet, and is actually a hole: with only a last name stored, every fact
    // this compares is a fact the carrier can see on its own worklist — the name and
    // a contact detail — while the two it cannot see are the two nothing verifies
    // here, since an absent stored date of birth is compared against nothing and the
    // SSN is only required to be well-formed. The bar would collapse to "the party
    // that minted the link can read its own screen", which is no bar at all.
    if (!storedLastName || !storedDob) return refuse(CLAIM_OUTCOMES.UNVERIFIABLE);

    if (draft.normalizeName(claim.lastName) !== storedLastName) {
        return refuse(CLAIM_OUTCOMES.IDENTITY_MISMATCH);
    }
    if (draft.normalizeDob(claim.dob) !== storedDob) {
        return refuse(CLAIM_OUTCOMES.IDENTITY_MISMATCH);
    }

    // `computed` can still be null here — an unreadable `SMS_ENCRYPTION_KEY` yields
    // null rather than costing the applicant their draft. The check above already
    // passed on the answers, so the driver gets in; the draft stays in this tier.
    return { outcome: CLAIM_OUTCOMES.OK, identityKey: computed, tier: 'answers' };
}

module.exports = {
    CLAIM_OUTCOMES,
    readClaim,
    verifyInviteIdentityClaim,
};
