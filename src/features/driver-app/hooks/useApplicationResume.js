import { useCallback, useRef, useState } from 'react';

import {
    buildSemanticStepOrder,
    resolveWizardStepIndex,
} from '@shared/components/layout/Stepper';
import {
    clearResumeToken,
    findResumableApplication,
    readResumeToken,
    resumeApplicationDraft,
    saveApplicationProgress,
    startNewApplication,
    writeResumeToken,
} from '../services/applicationDraftService';

/**
 * Server-side autosave, and the "continue your existing application?" flow.
 *
 * ## The rule this hook is built around
 *
 * **Saving must never be able to stop an applicant.** The local draft is written
 * by the caller first and synchronously; everything here is background work whose
 * failure is logged and otherwise invisible. The feature exists because drivers
 * were losing work on bad connections, and a version of it that blocked them on a
 * bad connection would be a worse trade than not having it at all.
 *
 * ## Why resuming is offered after the first page rather than before it
 *
 * The identity a resume is matched on — last name, date of birth and Social
 * Security Number — is collected on page one. There is nothing to match against
 * until it has been filled in, so the prompt appears on the first Next: the
 * applicant has typed enough to be recognised and has not yet spent time on
 * page two.
 *
 * A device that already holds a resume token skips the question entirely and
 * restores on load. The strongest path is the one that asks the applicant for
 * nothing.
 */
export function useApplicationResume({ slug, companyId, sandbox, hasCustomQuestions }) {
    const [prompt, setPrompt] = useState(null);
    const [busy, setBusy] = useState(false);
    const [promptError, setPromptError] = useState(null);

    /**
     * Whether this browser has already been offered the prompt.
     *
     * A ref, not state: repeated Next clicks on page one must not re-ask, and a
     * state update would not have landed before the second click.
     */
    const askedRef = useRef(false);
    /** Coalesces overlapping saves so a fast clicker cannot queue a pile of them. */
    const savingRef = useRef(false);

    const enabled = Boolean(slug && companyId && !sandbox);

    /**
     * What actually crosses the wire.
     *
     * The signature is a biometric and has no part in a draft: it is captured on
     * the last page, it is not something a resume needs to restore, and it should
     * never leave the browser except as part of a real submission. The SSN travels
     * as its own field for the identity HMAC, so it is stripped here too — the
     * server does not need it inside the form data and will not store it either.
     *
     * The local draft has always stripped exactly these two. The server strips
     * them again on arrival. This is the third of three, and it is the one that
     * means they are never transmitted at all.
     */
    const draftPayload = (formData) => {
        const { ssn: _ssn, signature: _signature, ...rest } = formData || {};
        return rest;
    };

    const stepIndexFor = useCallback((draft) => {
        if (draft?.lastSemanticStep) {
            // Resolved from the semantic id, so a company whose custom-questions
            // step is present (or absent) lands the applicant on the page they
            // were actually on rather than one index off.
            return resolveWizardStepIndex(draft.lastSemanticStep, hasCustomQuestions);
        }
        const order = buildSemanticStepOrder(hasCustomQuestions);
        return Math.max(0, Math.min(order.length - 1, Number(draft?.lastStep) || 0));
    }, [hasCustomQuestions]);

    /**
     * Saves progress in the background.
     *
     * Returns nothing and throws nothing. The applicant has already moved on by
     * the time this settles, and there is no failure of it they could act on.
     */
    const saveProgressToServer = useCallback(async ({ formData, stepIndex }) => {
        if (!enabled || savingRef.current) return;
        savingRef.current = true;
        try {
            const semanticOrder = buildSemanticStepOrder(hasCustomQuestions);
            const stored = readResumeToken(slug);
            const result = await saveApplicationProgress({
                companyId,
                email: formData?.email || '',
                phone: formData?.phone || '',
                // Used only to build the keyed identity, server-side, and never
                // stored — see functions/shared/applicationDraft.js. Sent as its
                // own field rather than inside `formData` precisely so that
                // `formData` can be stripped of it below.
                lastName: formData?.lastName || '',
                dob: formData?.dob || '',
                ssn: formData?.ssn || '',
                lastStep: stepIndex,
                lastSemanticStep: semanticOrder[stepIndex] || null,
                formData: draftPayload(formData),
            });
            if (result?.resumeToken && !stored) {
                writeResumeToken(slug, {
                    resumeToken: result.resumeToken,
                    applicantKey: result.applicantKey,
                });
            }
        } finally {
            savingRef.current = false;
        }
    }, [enabled, companyId, slug, hasCustomQuestions]);

    /**
     * Restores from a token this browser already holds, on page load.
     *
     * @returns {Promise<{ formData: object, stepIndex: number }|null>}
     */
    const restoreFromStoredToken = useCallback(async () => {
        if (!enabled) return null;
        const stored = readResumeToken(slug);
        if (!stored) return null;
        try {
            const result = await resumeApplicationDraft({
                companyId,
                applicantKey: stored.applicantKey,
                resumeToken: stored.resumeToken,
            });
            if (!result?.draft) return null;
            return { formData: result.draft.formData || {}, stepIndex: stepIndexFor(result.draft) };
        } catch {
            // An expired or discarded draft. Drop the token rather than retrying
            // it on every load, and let the applicant start normally.
            clearResumeToken(slug);
            return null;
        }
    }, [enabled, companyId, slug, stepIndexFor]);

    /**
     * Asks the server whether this applicant has something to continue.
     *
     * Called once, on the first forward navigation. Answers nothing to the caller
     * beyond opening the prompt, and never throws: an applicant whose lookup
     * failed should carry on filling the form.
     */
    const offerResumeIfAny = useCallback(async (formData) => {
        if (!enabled || askedRef.current) return;
        askedRef.current = true;

        // A device holding a token has already restored, or is about to. Asking
        // would be asking a question we know the answer to.
        if (readResumeToken(slug)) return;

        const found = await findResumableApplication({
            companyId,
            lastName: formData?.lastName || '',
            dob: formData?.dob || '',
            ssn: formData?.ssn || '',
            email: formData?.email || '',
            phone: formData?.phone || '',
        });
        if (found?.resumable) {
            setPromptError(null);
            setPrompt({
                resumeToken: found.resumeToken,
                startedAt: found.startedAt || null,
                updatedAt: found.updatedAt || null,
                lastSemanticStep: found.lastSemanticStep || null,
            });
        }
    }, [enabled, companyId, slug]);

    /**
     * Continue: restores the saved answers.
     *
     * @returns {Promise<{ formData: object, stepIndex: number }|null>}
     */
    const continueExisting = useCallback(async () => {
        if (!prompt) return null;
        setBusy(true);
        setPromptError(null);
        try {
            const result = await resumeApplicationDraft({
                companyId,
                resumeToken: prompt.resumeToken,
            });
            if (!result?.draft) throw new Error('empty');
            writeResumeToken(slug, {
                resumeToken: prompt.resumeToken,
                applicantKey: result.draft.applicantKey,
            });
            setPrompt(null);
            return { formData: result.draft.formData || {}, stepIndex: stepIndexFor(result.draft) };
        } catch {
            // The dialog stays open with the message, because the applicant asked
            // for something specific and silently continuing without it would
            // look like their answers had been lost twice.
            setPromptError('That saved application could not be opened. You can start a new one instead.');
            return null;
        } finally {
            setBusy(false);
        }
    }, [prompt, companyId, slug, stepIndexFor]);

    /**
     * Start over: discards the unfinished application.
     *
     * The delete happens server-side before this resolves, so an applicant who
     * chose to start fresh does not leave a second live draft behind for the next
     * visit to find and offer.
     */
    const startOver = useCallback(async () => {
        if (!prompt) return false;
        setBusy(true);
        setPromptError(null);
        try {
            await startNewApplication({ companyId, resumeToken: prompt.resumeToken });
            clearResumeToken(slug);
            setPrompt(null);
            return true;
        } catch {
            setPromptError('That application could not be removed. Please try again.');
            return false;
        } finally {
            setBusy(false);
        }
    }, [prompt, companyId, slug]);

    return {
        resumePrompt: prompt,
        resumeBusy: busy,
        resumeError: promptError,
        saveProgressToServer,
        restoreFromStoredToken,
        offerResumeIfAny,
        continueExisting,
        startOver,
    };
}

export default useApplicationResume;
