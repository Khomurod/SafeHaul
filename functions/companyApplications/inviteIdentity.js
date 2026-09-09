/**
 * Proving that the person who opened a continuation link is the applicant.
 *
 * ## Why this file exists, and what was actually broken
 *
 * `invite.js` describes a **tiered** link: while the answers are the carrier's own
 * the exchange hands over everything, and once they are the driver's it hands over
 * nothing and answers `requiresIdentity`. The second tier was a sentence, not a
 * mechanism. Three things were missing, all measured in production on 2026-09-09:
 *
 * 1. **Nothing rendered it.** `requires_identity` reached
 *    `resolveApplyStatusScreen`, matched no branch, and fell through to the intake
 *    chooser — so the driver was shown "How would you like to start your driver
 *    application?" with no indication that their own half-finished application was
 *    sitting behind the link they had just opened. That is the reported symptom.
 *
 * 2. **The verification it delegated to could not run.** The plan was
 *    `findResumableApplication`, which queries `identityKey ==`. But autosave wrote
 *    `identityKey: identityKey || null` on every save and the HMAC needs a Social
 *    Security Number, which a draft deliberately never stores — so the first save
 *    after a page reload erased it. `MICHAEL SIMS`, the reported application, held
 *    `identityKey: null` at the consent step. The lookup could never have matched
 *    it. Fixed in `drafts/identity.js` (`identityKeyForSave`); this file is what
 *    covers the drafts already in that state.
 *
 * 3. **A global lookup is the wrong question.** The link already names the draft —
 *    `exchangeApplicationInvite` resolved it from the token before deciding
 *    anything. Asking "does any draft at this company match this identity" throws
 *    that away, needs a composite index, needs the applicant to guess which contact
 *    detail the carrier used, and cannot answer at all for a draft whose stored
 *    identity was lost. So the claim is checked **against the one draft the token
 *    opened**, and nothing else.
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
 * - **`answers`** — the draft holds no `identityKey`, because a save erased it or
 *   because it predates the field. There is nothing to verify an SSN against, so
 *   the name and date of birth are checked against the draft's own answers and a
 *   well-formed SSN is required. **A successful check then establishes the
 *   `identityKey`**, so a draft passes through this tier at most once — and it is
 *   better authorized than the ordinary first save that would have written the same
 *   value, because it also had to present a live invite token and match two stored
 *   answers.
 *
 * Honest about its own limit: in the `answers` tier the SSN is *required* and not
 * *verified*. It still moves the bar from "knows what it typed" to "knows the
 * driver's Social Security Number", and a carrier that has that can impersonate
 * the driver anywhere in this product.
 *
 * A draft holding neither a last name nor a date of birth cannot be verified at
 * all, and this says so (`unverifiable`) rather than guessing. That is the state
 * the task calls "essential identity information never existed": the safest useful
 * behaviour is to tell the driver we cannot confirm it is theirs and let them start
 * a new application, never to hand the answers over and never to duplicate the
 * record.
 */

const draft = require('../shared/applicationDraft');
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

    // Nothing on file to verify against: check what the draft does hold.
    if (draft.normalizeSsn(claim.ssn).length !== 9) {
        return refuse(CLAIM_OUTCOMES.IDENTITY_INCOMPLETE);
    }

    const answers = stored?.formData || {};
    const storedLastName = draft.normalizeName(answers.lastName);
    const storedDob = draft.normalizeDob(answers.dob);
    if (!storedLastName && !storedDob) return refuse(CLAIM_OUTCOMES.UNVERIFIABLE);

    if (storedLastName && draft.normalizeName(claim.lastName) !== storedLastName) {
        return refuse(CLAIM_OUTCOMES.IDENTITY_MISMATCH);
    }
    if (storedDob && draft.normalizeDob(claim.dob) !== storedDob) {
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
