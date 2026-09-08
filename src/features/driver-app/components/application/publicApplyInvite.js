import { exchangeApplicationInvite, readResumeToken } from '../../services/applicationDraftService';

/**
 * Opening the link a carrier sent, and deciding whose leftovers this browser holds.
 *
 * Split out of `publicApplyBootstrap.js` on 2026-09-08 — for the source-size
 * standard, and because it is one job with one question at the end of it: whose
 * application is this browser holding?
 *
 * ## The contamination this exists to stop
 *
 * The invite branch itself was already careful: it never merged the local draft
 * and returned before the local restore, which
 * `publicApplyBootstrap.invite.test.js` pins. The leak came in through a
 * *different* effect. `loadPublicApplyCompany` sets the company before it awaits
 * the exchange, and `reconcileServerDraftOnLoad` fires as soon as `company?.id`
 * exists — so it read the SHARED resume-token slot and the SHARED local draft
 * while the exchange was still open. Either ordering lost:
 *
 *   - token read before the invite stored its own → the PREVIOUS applicant's
 *     server draft was fetched, merged, and applied over the invited answers;
 *   - token read after → the server side was right, but `local` was still the
 *     previous applicant's draft, and a dirty local copy wins outright
 *     (`reconcileApplicationDraft`, `local-unsynced`).
 *
 * Upload descriptors are exactly the field class that survives that merge — they
 * are handed to the winner whole — which is why the reported symptom was a new
 * driver's application carrying a previous driver's stored document information.
 * And it persisted: the merged body was written back stamped with the invite's
 * draft name, then autosaved onto the carrier's draft.
 *
 * ## Two mechanisms, two defects — deliberately not collapsed
 *
 * `PublicApplyHandler` gates the reconcile effect until the outcome here is no
 * longer `pending`, which fixes the ORDERING. `foreignSlot` below fixes the
 * IDENTITY. Gating alone would not be enough, because after a successful exchange
 * the reconcile still has to run — the exchange returns no `lastStep`, so it is
 * the only thing that restores an invited driver's page, and their own newer
 * unsynced local work must still be able to win.
 *
 * ## What identifies the applicant a slot belongs to
 *
 * The `applicantKey` already stored beside the resume token, which is the server's
 * own name for the draft this browser holds a credential for. Nothing new is
 * invented and no key is renamed: per-applicant storage keys were considered and
 * rejected, because a driver correcting their own email legitimately changes
 * `sha256(company:email:phone)`, so every slot would need renaming in shared
 * storage at the worst possible moment — and the discard mark must stay
 * un-namespaced (naming it was tried and silently restored the bug it was meant
 * to fix).
 *
 * Read BEFORE the invite adopts its own token, or the comparison answers itself.
 */

/** What opening a link can come to. `absent` means no link was followed at all. */
export const INVITE_OUTCOMES = Object.freeze({
    ABSENT: 'absent',
    OPENED: 'opened',
    REQUIRES_IDENTITY: 'requires_identity',
    UNOPENABLE: 'unopenable',
    INVALID: 'invalid',
    THROTTLED: 'throttled',
    CLOSED: 'closed',
    UNAVAILABLE: 'unavailable',
});

/**
 * A callable failure, as one of the outcomes above.
 *
 * `unopenable` is deliberately one bucket for wrong, expired, already-submitted,
 * superseded and discarded. The server answers all of them with `not-found` and a
 * byte-identical message on purpose — "that link expired" and "that link is
 * wrong" are different facts an attacker would happily learn — and collapsing
 * them here is what keeps that promise on this side of the wire too.
 *
 * Everything else is separated only along the line the driver can act on:
 * try again, or ask the carrier for a new link.
 */
export function classifyInviteFailure(error) {
    switch (error?.code) {
        case 'functions/not-found':
            return INVITE_OUTCOMES.UNOPENABLE;
        case 'functions/invalid-argument':
            return INVITE_OUTCOMES.INVALID;
        case 'functions/resource-exhausted':
            return INVITE_OUTCOMES.THROTTLED;
        case 'functions/failed-precondition':
            return INVITE_OUTCOMES.CLOSED;
        default:
            // `unavailable`, `internal`, `deadline-exceeded`, an offline reject, and
            // anything a future runtime invents. All of them are "try again", which
            // is the only thing that distinguishes them from the cases above.
            return INVITE_OUTCOMES.UNAVAILABLE;
    }
}

/**
 * Exchange the link in the URL, if there is one.
 *
 * Stores nothing and sets no wizard state — the caller owns both, so that the
 * order in which they happen stays visible in one place.
 *
 * @returns {Promise<{status: string, applicantKey?: string, foreignSlot?: boolean,
 *   payload?: object, message?: string}>}
 */
export async function openPreparedApplication({ slug, companyId, searchParams }) {
    const inviteToken = searchParams.get('invite');
    if (!inviteToken) return { status: INVITE_OUTCOMES.ABSENT };

    // Captured before anything adopts a token of its own.
    const slotOwner = readResumeToken(slug)?.applicantKey || null;

    let payload;
    try {
        payload = await exchangeApplicationInvite({
            companyId,
            applicantKey: searchParams.get('k') || null,
            inviteToken,
        });
    } catch (error) {
        return { status: classifyInviteFailure(error), message: error?.message || null };
    }

    if (!payload?.opened) return { status: INVITE_OUTCOMES.UNOPENABLE };

    if (payload.requiresIdentity) {
        // The driver has already started this one, so the link alone no longer
        // opens it — see `functions/companyApplications/invite.js`. There is no
        // token and no answers in this reply, so there is nothing to adopt.
        return { status: INVITE_OUTCOMES.REQUIRES_IDENTITY, applicantKey: payload.applicantKey };
    }

    return {
        status: INVITE_OUTCOMES.OPENED,
        applicantKey: payload.applicantKey,
        /**
         * This browser's stored draft belongs to somebody else.
         *
         * An absent owner counts as foreign on this path *only* because a link was
         * followed: the link names one specific applicant, so an unclaimed slot is
         * not evidence that its contents are theirs — and the carrier's prepared
         * answers are the stronger claim, which is the behaviour already pinned.
         * With no link followed, an absent owner means "mine", exactly as before,
         * and an ordinary driver-started application is untouched by any of this.
         *
         * The cost, stated where it happens: the previous applicant loses their
         * LOCAL backup of this slug. Their server copy is untouched and still
         * reachable by identity match on their next visit. That is a bounded loss
         * of a backup, against one person's employer rows and CDL upload landing
         * inside another person's signed DOT application.
         */
        foreignSlot: slotOwner !== payload.applicantKey,
        payload,
    };
}

export default openPreparedApplication;
