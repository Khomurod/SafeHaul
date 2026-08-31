/**
 * The runtime options these callables deploy with, and the limits they enforce.
 *
 * **The `firebase-functions/v1` import belongs in this file, beside the
 * `secrets:` literal.** `test/unit/secretBindingGenerations.test.js` asks, of the
 * file declaring a binding, which generation it imports, and refuses a binding
 * that turns up under a generation `EXPECTED` does not list. These are the guest
 * callables and they are 1st generation; the staff-facing read in `list.js` is
 * 2nd. Keeping each `secrets:` declaration next to its own generation import is
 * what stops a split reporting one under the other.
 */

const functions = require('firebase-functions/v1');

/**
 * Rate limits.
 *
 * Saving is generous because a careful applicant legitimately saves nine or ten
 * times over twenty minutes and being throttled mid-application is the failure
 * this whole feature exists to prevent. Matching is tight because it is the only
 * surface where a wrong answer would be interesting to an attacker, and it is
 * limited per identity as well as per caller so that spreading attempts across
 * addresses does not spread the budget with them.
 */
const LIMITS = Object.freeze({
    save: { limit: 40, windowSeconds: 60 },
    match: { limit: 6, windowSeconds: 60 },
    matchPerIdentity: { limit: 12, windowSeconds: 3600 },
    resume: { limit: 10, windowSeconds: 60 },
    startOver: { limit: 5, windowSeconds: 300 },
});

/**
 * Ceiling on the browser's local write counter.
 *
 * One draft is a handful of pages, so a legitimate counter is in the tens. The
 * bound exists because the value arrives from an unauthenticated caller, not
 * because a real applicant could approach it.
 */
const MAX_CLIENT_SEQ = 100000;

const FUNCTION_TIMEOUT_SECONDS = 30;
const runtime = { memory: '256MB', timeoutSeconds: FUNCTION_TIMEOUT_SECONDS };

/**
 * Only the two callables that derive the identity HMAC bind the secret.
 *
 * `resumeApplicationDraft` and `startNewApplication` authorize off the resume
 * token alone and read `identityKey` as a *stored* value, so they never call
 * `buildIdentityKey` and have no use for the key. Binding a secret to a function
 * that does not read it widens the blast radius for nothing — and here it did
 * measurable harm: every `secrets: [...]` binding makes the Firebase CLI ensure
 * the runtime service account can read that secret, and each function that names
 * it is another chance to need an IAM change mid-deploy.
 */
const runtimeWithIdentityKey = { ...runtime, secrets: ['SMS_ENCRYPTION_KEY'] };

/**
 * The answer to a matching attempt that did not succeed.
 *
 * One shape, whether nothing exists, something exists under a different contact
 * detail, or the applicant has already submitted. A response that varied would
 * turn this into a lookup service: "does a driver with this name and SSN have an
 * application at this carrier" is not a question an unauthenticated caller may
 * ask, and it is not a question SafeHaul should answer differently by accident.
 */
const NO_MATCH = Object.freeze({ resumable: false });

module.exports = {
    LIMITS,
    MAX_CLIENT_SEQ,
    NO_MATCH,
    functions,
    runtime,
    runtimeWithIdentityKey,
};
