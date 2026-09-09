import { useCallback, useState } from 'react';

import {
    INVITE_OUTCOMES,
    adoptOpenedApplication,
    openPreparedApplication,
} from '../components/application/publicApplyInvite';

/**
 * "Confirm it's you", and the two ways it gets answered.
 *
 * ## What this owns
 *
 * A continuation link whose application the driver has already started opens
 * nothing by itself — `exchangeApplicationInvite` returns `requiresIdentity` and
 * writes nothing, because the party holding a copy of that link may be the
 * carrier. This hook owns the question that follows: *is this that applicant*,
 * and what happens when the answer is yes.
 *
 * There are two ways to yes, and only one of them asks the driver anything:
 *
 * 1. **This browser already holds the resume token for that draft.** Then nothing
 *    is asked. `reconcileServerDraftOnLoad` calls `markIdentitySatisfied` when the
 *    stored token resolves the very application the link named, and the driver
 *    sees their work restored — which is what they clicked the link for. The
 *    strongest resume path is the one that asks for nothing, and a replacement
 *    link must not take it away.
 *
 * 2. **They answer the confirmation screen.** The same link is exchanged again
 *    with the claim attached, and the server checks it against the draft the token
 *    named — see `functions/companyApplications/inviteIdentity.js`.
 *
 * ## Why it is its own hook
 *
 * `PublicApplyHandler` went over the source-size limit when this arrived, and this
 * is the seam rather than a convenient cut: everything here is one subject with
 * one outcome, and none of it is needed by a page that followed no link. It also
 * keeps the busy/error state of a form OUT of `inviteOutcome`, which the
 * reconciliation effect depends on — a keystroke-driven rewrite of that object
 * would refetch the server draft on every character typed. The same reasoning
 * `inviteProblemDismissed` is kept separate for.
 */
export function useInviteIdentityCheck({
    slug,
    companyId,
    searchParams,
    inviteOutcome,
    setInviteOutcome,
    dismissed,
    adoptResumeToken,
    restoredFromDraftRef,
    draftIdRef,
    setFormData,
    setCurrentStep,
    setIntakeMode,
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    /**
     * This browser already holds the token for the application the link named, so
     * the confirmation screen has nothing to ask.
     *
     * Recorded as `opened` with the key it resolved, because that is what is true:
     * the application IS open on this device. It carries no `payload`, and nothing
     * reads one off an outcome it did not produce — `adoptOpenedApplication` is
     * only ever called with a reply that had answers in it.
     *
     * `foreignSlot: false` is likewise a fact rather than a default: the stored
     * token resolving this same key is exactly the evidence that this browser's
     * leftovers belong to this applicant.
     *
     * The accepted cost: the reconciliation effect depends on `inviteOutcome`, so
     * changing it here runs that effect once more — one extra `resumeApplicationDraft`
     * read, on a reconciliation that is idempotent. A second piece of state would
     * avoid it and would have to be kept in step with this one, which is how a
     * boundary ends up with two answers to one question. Bounded at one repeat: the
     * guard below only fires from `requires_identity`, so the second run changes
     * nothing.
     */
    const markSatisfied = useCallback(() => {
        setError(null);
        setInviteOutcome((previous) => (
            previous.status === INVITE_OUTCOMES.REQUIRES_IDENTITY
                ? {
                    status: INVITE_OUTCOMES.OPENED,
                    applicantKey: previous.applicantKey,
                    foreignSlot: false,
                }
                : previous
        ));
    }, [setInviteOutcome]);

    /**
     * The driver's answer.
     *
     * On success the application is taken on through exactly the path a carrier's
     * own link uses — one function, so the two cannot drift. A refused claim leaves
     * the screen up with the server's sentence, because the driver may simply have
     * mistyped and sending them to "ask for a new link" would not help. A link that
     * has *since* died is a different fact, and becomes the outcome the
     * link-problem screen renders.
     */
    const confirm = useCallback(async (identity) => {
        if (!companyId) return;
        setBusy(true);
        setError(null);
        try {
            const outcome = await openPreparedApplication({
                slug, companyId, searchParams, identity,
            });
            if (outcome.status !== INVITE_OUTCOMES.OPENED) {
                setError(outcome.claimError || null);
                if (!outcome.claimError) setInviteOutcome(outcome);
                return;
            }
            adoptOpenedApplication({
                outcome,
                companyId,
                adoptResumeToken,
                restoredFromDraftRef,
                draftIdRef,
                setFormData,
                setCurrentStep,
                setIntakeMode,
            });
            // Last, so the screen does not come down until the answers are on it.
            setInviteOutcome(outcome);
        } finally {
            setBusy(false);
        }
    }, [
        companyId, slug, searchParams, setInviteOutcome, adoptResumeToken,
        restoredFromDraftRef, draftIdRef, setFormData, setCurrentStep, setIntakeMode,
    ]);

    return {
        markIdentitySatisfied: markSatisfied,
        onConfirmIdentity: confirm,
        /**
         * The screen, or nothing.
         *
         * Dismissed by the same flag as the link-problem screen, because it offers
         * the same explicit way out: starting a fresh application is a choice the
         * driver makes and never a fallback that happens to them. Until 2026-09-09
         * this outcome had no screen at all, and that fall-through to the intake
         * chooser is the reported bug.
         */
        identityCheck: inviteOutcome.status === INVITE_OUTCOMES.REQUIRES_IDENTITY && !dismissed
            ? { busy, error }
            : null,
    };
}

export default useInviteIdentityCheck;
