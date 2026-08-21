import { useCallback, useRef, useState } from 'react';

import {
    buildSemanticStepOrder,
    resolveWizardStepIndex,
} from '@shared/components/layout/Stepper';
import { markDraftSynced } from '../components/application/applicationDraftStorage';
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
 * ## Why the lookup has to happen before the first save, not alongside it
 *
 * This hook owns the order of those two calls, rather than leaving it to the
 * caller, because getting it wrong loses exactly the data the feature protects.
 * Firing both on the first Next — which is what the obvious implementation does —
 * has three failure modes, all of them intermittent:
 *
 * 1. The save creates the draft, the lookup matches *that* draft, and a
 *    first-time applicant is asked whether they would like to continue the
 *    application they are in the middle of filling in.
 * 2. A returning applicant on a new device, same email: the save merges into
 *    their existing draft and overwrites `lastStep` with page one before the
 *    prompt appears — so "continue where I left off" returns them to the
 *    beginning.
 * 3. A returning applicant on a new device, *different* email: the save derives a
 *    different document id, and the server's at-most-one-draft rule hard-deletes
 *    the older draft. The work they came back for is gone before they were asked
 *    about it.
 *
 * So: no server write for an identity happens until the resume question has been
 * answered. The gate is installed by the save path itself, so every caller —
 * Next, "Save as Draft", anything added later — is covered without having to know
 * about it. The applicant is not waiting on any of this: the local draft was
 * written synchronously and the wizard has already advanced.
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
/**
 * @param {object} options
 * @param {() => boolean} [options.hasBeenDiscarded] Whether this application has been
 *   discarded — by Start Over or by a completed submission — since this browser
 *   loaded it. Consulted immediately before anything crosses the wire, because by
 *   then the answer may have changed: the applicant can discard in another tab while
 *   a save is queued here, and a save that lands afterwards recreates the very
 *   application they asked to be rid of.
 */
export function useApplicationResume({
    slug,
    companyId,
    sandbox,
    hasCustomQuestions,
    hasBeenDiscarded,
}) {
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
    /** True once a save has landed, so this browser owns the draft for this identity. */
    const ownsDraftRef = useRef(false);
    /** Set while a save is in flight; the newest payload waits in `pendingRef`. */
    const savingRef = useRef(false);
    /**
     * The newest unsaved payload.
     *
     * Overlapping saves used to be dropped outright, which quietly lost the last
     * step of a fast clicker — and the last step before someone abandons the form
     * is the one worth having. The newest payload now waits its turn instead, and
     * an older one it replaced is not worth sending.
     */
    const pendingRef = useRef(null);
    /**
     * Resolves when the resume question has been settled.
     *
     * `{ promise, resolve }` while a decision is outstanding, `null` otherwise.
     * The value is `'proceed'` (save the payload) or `'discard'` (drop it — the
     * applicant restored a draft, and the payload predates the restore).
     */
    const gateRef = useRef(null);
    /**
     * Held in a ref, not read from the closure.
     *
     * `sendSave` is a `useCallback` that half the hook depends on; taking the
     * predicate as a dependency would rebuild it whenever the caller re-created its
     * function, and rebuilding it re-creates `saveProgressToServer`, which the
     * wizard's effects depend on.
     */
    const discardedRef = useRef(hasBeenDiscarded);
    discardedRef.current = hasBeenDiscarded;

    const enabled = Boolean(slug && companyId && !sandbox);

    const settleGate = useCallback((decision) => {
        const gate = gateRef.current;
        gateRef.current = null;
        if (gate) gate.resolve(decision);
    }, []);

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
     * Asks the server whether this applicant has something to continue.
     *
     * Resolves to `'proceed'` or `'discard'` — see `gateRef`. Never throws: an
     * applicant whose lookup failed should carry on filling the form, and a
     * failed lookup must not also block their progress from being saved.
     */
    const runResumeLookup = useCallback(async (formData) => {
        askedRef.current = true;

        // A device holding a token has already restored, or is about to. Asking
        // would be asking a question we know the answer to.
        if (readResumeToken(slug)) return 'proceed';

        const found = await findResumableApplication({
            companyId,
            lastName: formData?.lastName || '',
            dob: formData?.dob || '',
            ssn: formData?.ssn || '',
            email: formData?.email || '',
            phone: formData?.phone || '',
        });
        if (!found?.resumable) return 'proceed';

        // Discarded while the lookup was open. Installing a prompt now would offer a
        // draft that no longer exists, and both answers to it fail: Continue and
        // Start Over each throw against the deleted document, leaving the gate shut
        // and this tab's autosave wedged for good. The reset that ran during the
        // lookup could not settle a gate that did not exist yet, so the check has to
        // happen here.
        if (discardedRef.current?.()) return 'discard';

        const gate = {};
        gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
        gateRef.current = gate;
        setPromptError(null);
        setPrompt({
            resumeToken: found.resumeToken,
            startedAt: found.startedAt || null,
            updatedAt: found.updatedAt || null,
            lastSemanticStep: found.lastSemanticStep || null,
        });
        return gate.promise;
    }, [companyId, slug]);

    /** One round trip. Swallows everything: see the file header. */
    const sendSave = useCallback(async ({ formData, stepIndex, localSeq, draftId }) => {
        // The last check before the wire, and the reason it is *here* rather than at
        // the call sites: a payload can wait in `pendingRef` behind another save, so
        // the moment it was composed and the moment it is sent are different
        // moments, and the application may have been discarded in between.
        if (discardedRef.current?.()) return;
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
            // Proof that this browser owns the draft it is writing. Creating one is
            // public — an applicant on page one has nothing to prove yet — but
            // *changing* an existing draft now requires this, or the identity bar,
            // because company id plus email plus phone derive the document id and
            // knowing them used to be enough to overwrite somebody's application.
            resumeToken: stored?.resumeToken || null,
            // The key this browser believes its token belongs to, so the server can
            // resolve it with one read instead of a bounded scan. A hint, not a
            // claim: the server still verifies the token hash on whatever document
            // that key names, so naming somebody else's proves nothing. It matters
            // when an applicant corrects a contact field *and* an identity field
            // before the same save — then neither the new document id nor the new
            // identity HMAC can find the draft the token actually opens.
            resumeApplicantKey: stored?.applicantKey || null,
            // The local write counter for exactly this content. The server stores
            // it and a later resume hands it back, which is how the browser tells
            // "the server holds my copy" from "another device moved on" — without
            // either side comparing a phone clock to a server one.
            clientSeq: Number.isInteger(localSeq) ? localSeq : null,
            formData: draftPayload(formData),
        });
        if (result?.saved) ownsDraftRef.current = true;
        if (result?.saved && Number.isInteger(localSeq)) {
            // The only place a save is known to have landed, so the only place
            // sync may be recorded. `markDraftSynced` refuses when the local copy
            // has moved on since: a late save must never declare newer local work
            // acknowledged.
            // Named as well as numbered: a response can arrive after a Start Over, and
            // the new draft's counter starts again from zero, so the sequence alone can
            // match an application this save never touched.
            markDraftSynced(slug, localSeq, { draftId });
        }
        if (result?.resumeToken) {
            // Adopted even when this browser already had one, which it did not used
            // to be. The server returns a token *only* for a draft it just created,
            // so a returned token always belongs to the draft this save wrote — and
            // an applicant who corrects their email writes a new draft while the old
            // one is retired underneath them. Keeping the old token left the browser
            // holding a credential for a deleted document: cross-session resume was
            // gone, and now that changing an existing draft requires proof of
            // ownership, background saves would be refused as well.
            writeResumeToken(slug, {
                resumeToken: result.resumeToken,
                applicantKey: result.applicantKey,
            });
        }
    }, [companyId, slug, hasCustomQuestions]);

    /**
     * Saves progress in the background.
     *
     * Returns nothing and throws nothing. The applicant has already moved on by
     * the time this settles, and there is no failure of it they could act on.
     */
    const saveProgressToServer = useCallback(async (input) => {
        if (!enabled) return;
        if (savingRef.current) {
            // Newest wins. See `pendingRef`.
            pendingRef.current = input;
            return;
        }
        savingRef.current = true;
        try {
            // The first server write for this identity waits behind the resume
            // question, whichever call site triggered it.
            if (!askedRef.current && !ownsDraftRef.current) {
                const decision = await runResumeLookup(input?.formData);
                if (decision === 'discard') {
                    // The applicant restored a draft. This payload is what they
                    // had typed before being recognised, and writing it would put
                    // page one back over the answers they just asked for.
                    pendingRef.current = null;
                    return;
                }
            }
            let next = input;
            while (next) {
                pendingRef.current = null;
                await sendSave(next);
                // Re-read rather than trusting the loop entry: the previous send was
                // a round trip, and a discard elsewhere during it makes whatever
                // queued behind it stale too. `sendSave` refuses on its own as well;
                // this stops the loop instead of spinning through payloads it will
                // drop one by one.
                if (discardedRef.current?.()) break;
                next = pendingRef.current;
            }
        } finally {
            savingRef.current = false;
            pendingRef.current = null;
        }
    }, [enabled, runResumeLookup, sendSave]);

    /**
     * Restores from a token this browser already holds, on page load.
     *
     * @returns {Promise<{ formData: object, stepIndex: number }|null>}
     */
    const restoreFromStoredToken = useCallback(async () => {
        if (!enabled) return null;
        const stored = readResumeToken(slug);
        if (!stored) return null;
        // This browser holds the draft, so there is nothing to be asked about.
        askedRef.current = true;
        ownsDraftRef.current = true;
        try {
            const result = await resumeApplicationDraft({
                companyId,
                applicantKey: stored.applicantKey,
                resumeToken: stored.resumeToken,
            });
            if (!result?.draft) return null;
            return {
                formData: result.draft.formData || {},
                stepIndex: stepIndexFor(result.draft),
                // Carried through so the page can reconcile the two copies rather
                // than assume the server holds the newer one.
                clientSeq: Number.isInteger(result.draft.clientSeq) ? result.draft.clientSeq : null,
            };
        } catch {
            // An expired or discarded draft. Drop the token rather than retrying
            // it on every load, and let the applicant start normally — including
            // being offered a match, since this browser no longer owns anything.
            clearResumeToken(slug);
            askedRef.current = false;
            ownsDraftRef.current = false;
            return null;
        }
    }, [enabled, companyId, slug, stepIndexFor]);

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
            ownsDraftRef.current = true;
            // Drops the queued save, which holds pre-restore answers.
            settleGate('discard');
            return {
                formData: result.draft.formData || {},
                stepIndex: stepIndexFor(result.draft),
                clientSeq: Number.isInteger(result.draft.clientSeq) ? result.draft.clientSeq : null,
            };
        } catch {
            // The dialog stays open with the message, because the applicant asked
            // for something specific and silently continuing without it would
            // look like their answers had been lost twice. The gate stays shut:
            // they have not chosen yet, and a save now could still collapse the
            // draft they are trying to open.
            setPromptError('That saved application could not be opened. You can start a new one instead.');
            return null;
        } finally {
            setBusy(false);
        }
    }, [prompt, companyId, slug, stepIndexFor, settleGate]);

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
            // Only if it is still the token this just retired. The call above is a
            // round trip, and `localStorage` is shared: another tab can have saved in
            // the meantime and been issued a token for *its* application, and taking
            // that away would cost the applicant the ownership proof for work nobody
            // discarded.
            if (readResumeToken(slug)?.resumeToken === prompt.resumeToken) {
                clearResumeToken(slug);
            }
            setPrompt(null);
            // The queued save is now the beginning of the new application.
            settleGate('proceed');
            return true;
        } catch {
            setPromptError('That application could not be removed. Please try again.');
            return false;
        } finally {
            setBusy(false);
        }
    }, [prompt, companyId, slug, settleGate]);

    /**
     * Forgets that this browser owns a draft.
     *
     * Called when the application was discarded elsewhere. Without it the two refs
     * still say "already asked, already owns", so this tab would skip the resume
     * question and quietly create a new draft on its next save — which is how the
     * discarded answers came back. Cleared, it behaves like a browser that owns
     * nothing: the next save asks first.
     */
    const forgetDraftOwnership = useCallback(() => {
        askedRef.current = false;
        ownsDraftRef.current = false;
        pendingRef.current = null;
        setPrompt(null);
        setPromptError(null);
        // Anything waiting on the resume question is released as a discard: the
        // payload it holds belongs to an application that no longer exists.
        settleGate('discard');
    }, [settleGate]);

    return {
        resumePrompt: prompt,
        resumeBusy: busy,
        resumeError: promptError,
        saveProgressToServer,
        restoreFromStoredToken,
        continueExisting,
        startOver,
        forgetDraftOwnership,
    };
}

export default useApplicationResume;
