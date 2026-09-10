import { exchangeApplicationInvite, readResumeToken } from '../../services/applicationDraftService';
import { clearPostApplySession } from './postApplyDocsStorage';

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
 * the reconcile still has to run: the driver's own newer unsynced local work must
 * still be able to win. (Until 2026-09-09 it was also the ONLY thing that restored
 * an invited driver's page, because the exchange returned no `lastStep`. It does
 * now — a driver who confirms their identity to continue must land on the page they
 * were on, not back at the start — so the reconcile's `Math.max` is what keeps the
 * two from arguing.)
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
 * A refused identity claim, as the driver is told about it.
 *
 * Its own outcome rather than one of the statuses above, because it is not a
 * verdict on the *link* — the link opened, resolved a live application, and asked
 * a question. Collapsing it into `unopenable` would tell somebody who mistyped
 * their date of birth to go and ask for a new link, which would not help.
 *
 * `permission-denied` is the server's answer to a claim that did not match, and it
 * carries the sentence to show. Anything else is the link failing, so it is
 * classified as one.
 */
export function classifyClaimFailure(error) {
    if (error?.code === 'functions/permission-denied') {
        return {
            status: INVITE_OUTCOMES.REQUIRES_IDENTITY,
            claimError: error.message || 'Those details do not match this application.',
        };
    }
    if (error?.code === 'functions/resource-exhausted') {
        return {
            status: INVITE_OUTCOMES.REQUIRES_IDENTITY,
            claimError: 'Too many attempts. Please wait a minute and try again.',
        };
    }
    return { status: classifyInviteFailure(error), message: error?.message || null };
}

/**
 * Exchange the link in the URL, if there is one.
 *
 * Stores nothing and sets no wizard state — the caller owns both, so that the
 * order in which they happen stays visible in one place.
 *
 * @param {object} options
 * @param {object} [options.identity] The driver's claim, when they are answering
 *   the confirmation screen rather than opening the link for the first time. The
 *   server decides what it proves; this only carries it.
 * @returns {Promise<{status: string, applicantKey?: string, foreignSlot?: boolean,
 *   payload?: object, message?: string, claimError?: string}>}
 */
export async function openPreparedApplication({ slug, companyId, searchParams, identity }) {
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
            ...(identity ? { identity } : {}),
        });
    } catch (error) {
        // A claim that was refused is a different situation from a link that would
        // not open, and only the caller that made a claim can tell them apart.
        return identity ? classifyClaimFailure(error) : {
            status: classifyInviteFailure(error), message: error?.message || null,
        };
    }

    if (!payload?.opened) return { status: INVITE_OUTCOMES.UNOPENABLE };

    if (payload.requiresIdentity) {
        // The driver has already started this one, so the link alone no longer
        // opens it — see `functions/companyApplications/invite.js`. There is no
        // token and no answers in this reply, so there is nothing to adopt.
        //
        // `applicantKey` is the only thing that comes back, and it was already in
        // the link's own query string. The caller renders the confirmation screen
        // from this and calls again with a claim; the outcome shape below is what a
        // successful claim produces, so both paths land in one place.
        //
        // `foreignSlot` is answered here as well, for the same reason it is
        // answered below: a link names one specific applicant, so this browser's
        // stored leftovers are not evidence of anything until they prove to be that
        // applicant's. A driver whose own device still holds the token for THIS
        // draft is never asked anything at all — see `reconcileServerDraftOnLoad`.
        return {
            status: INVITE_OUTCOMES.REQUIRES_IDENTITY,
            applicantKey: payload.applicantKey,
            foreignSlot: slotOwner !== payload.applicantKey,
        };
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

/**
 * Retire a finished application's confirmation screen, because a live one arrived.
 *
 * `sh_post_apply_${companyId}` is keyed to a COMPANY and lasts 24 hours, and
 * restoring it sets `submissionStatus = 'success'`, which renders above everything
 * the invitation is trying to show — so a new invitation to the same carrier in the
 * same tab would put the PREVIOUS applicant's success screen and documents
 * checklist over it.
 *
 * Cleared rather than merely not restored, or the defect returns through the other
 * door: left in place, a later reload of the bare `/apply/:slug` in this tab brings
 * that success screen back over the invited driver's half-typed application.
 *
 * Safe against a real submitted application by construction, not by luck: a
 * submission DELETES the draft, and the invite hash lives on that document, so an
 * exchange that resolved a live draft proves the application it named has not been
 * submitted. That proof is what makes this callable from the identity path as well
 * as this one — `requiresIdentity` withholds the ANSWERS, but the draft it
 * withholds them from is live, or the exchange would have said `not-found`. A
 * FAILED exchange deliberately touches none of this, which is what protects the
 * driver who re-clicks their own emailed link after submitting.
 */
export function retireStalePostApplySession(companyId) {
    clearPostApplySession(companyId);
    try {
        // A single global key with no company or application scoping, read as the
        // success screen's fallback. Left behind, it shows the previous applicant's
        // confirmation number on the invited driver's own success screen later.
        sessionStorage.removeItem('lastConfirmationNumber');
    } catch {
        /* storage unavailable (privacy mode) — nothing was stored to begin with */
    }
}

/**
 * Take on the application an exchange handed over.
 *
 * One function for the two ways in — a link opened while the answers were still
 * the carrier's, and a driver who confirmed their identity to continue their own
 * work — because they hand over the same reply and must do the same things with
 * it. Written twice, the second one would forget something; the confirmation path
 * would have forgotten to clear a stale success screen, which is a defect this
 * module already records under its own heading.
 *
 * Stores the resume token through the caller's `adoptResumeToken`, never
 * `writeResumeToken` directly: writing the shared slot behind the resume hook's
 * back leaves its ownership refs unset, and that path only ever worked because the
 * resume lookup happened to re-read the slot and find it.
 */
export function adoptOpenedApplication({
    outcome,
    companyId,
    adoptResumeToken,
    restoredFromDraftRef,
    draftIdRef,
    setFormData,
    setCurrentStep,
    setIntakeMode,
}) {
    const { payload } = outcome;
    adoptResumeToken({
        resumeToken: payload.resumeToken,
        applicantKey: outcome.applicantKey,
    });
    restoredFromDraftRef.current = true;
    draftIdRef.current = outcome.applicantKey;
    setFormData((prev) => ({
        ...prev,
        ...payload.formData,
        // Decorative, for rendering the rows as locked. The enforcement copy lives
        // on the draft itself, where the locked party cannot reach it.
        lockedEmployers: payload.lockedEmployers || [],
    }));
    // Where the driver actually was. A carrier's own prepared draft is always page
    // one, so this is a no-op there and load-bearing for a continuation: handing a
    // driver their answers and dropping them at the start of the wizard reads as
    // "nothing was saved", which is the failure the whole draft feature exists to
    // prevent.
    if (Number.isInteger(payload.lastStep)) {
        setCurrentStep((prev) => Math.max(prev, payload.lastStep));
    }
    setIntakeMode('manual');
    sessionStorage.setItem('pending_application_company', companyId);

    // A live invitation retires a finished one's confirmation screen. Shared with
    // the identity path, which has to do it before the answers arrive rather than
    // after — see `retireStalePostApplySession` for why that is sound.
    retireStalePostApplySession(companyId);
}

/**
 * What the rest of the page load may still do, once an invitation did not open.
 *
 * Both callers of `openPreparedApplication` in `publicApplyBootstrap` continue past
 * it — restoring a submission and restoring this browser's local draft — and
 * `requires_identity` is a live invitation waiting on one question, so neither step
 * is harmless there:
 *
 *  - **The submission restore** sets `submissionStatus = 'success'`, which renders
 *    ABOVE the confirmation screen. A 24-hour-old success screen for this carrier
 *    would hide the question permanently, and the driver would be back to the
 *    reported symptom by a second route.
 *  - **The local-draft restore** puts whatever this browser was holding into
 *    `formData`, and when the slot belongs to somebody else that is a previous
 *    applicant's answers — behind the confirmation screen, where the driver cannot
 *    see them, and still in `formData` when the claim succeeds: the adopt spread
 *    keeps every key the target application does not itself have, and autosave
 *    then writes them onto it.
 *
 * One decision, read by both branches, so the E2E path cannot drift from the
 * production one — the file already records a bug that hid in exactly that gap.
 *
 * Every other non-opening outcome is a link that FAILED, and both steps stay: a
 * dead link must not cost the driver their own submission screen or their own
 * local work.
 */
export function permissionsAfterInvite(outcome) {
    const awaitingIdentity = outcome?.status === INVITE_OUTCOMES.REQUIRES_IDENTITY;
    return {
        restoreSubmission: !awaitingIdentity,
        restoreLocalDraft: !(awaitingIdentity && outcome?.foreignSlot),
    };
}

export default openPreparedApplication;
