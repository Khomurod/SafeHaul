// The two draft-sync effects the guest apply page installs once its company is
// known: reconciling the server copy on load, and flushing a dirty local copy
// when the connection returns. Split out of `publicApplyBootstrap.js` on
// 2026-09-08 for the source-size standard — the company load and the draft sync
// are different subjects, and the reconciliation grew when it learned to ask
// whose application this browser is holding.
//
// Both return their effect's own cleanup, and both take this tab's refs as the
// ref OBJECTS, so capture/re-read semantics are unchanged from when the bodies
// were inline in the component.
import {
  readApplicationDraft,
  saveApplicationDraft,
  draftSyncState,
  sameDraftData,
} from './applicationDraftStorage';
import { reconcileApplicationDraft } from './reconcileApplicationDraft';
import { INVITE_OUTCOMES } from './publicApplyInvite';

/**
 * The server-draft reconciliation, once the company is known.
 *
 * The local copy is normally the same or newer, so this matters in two cases:
 * storage was partially cleared and the token outlived the draft, or the draft
 * was discarded or has expired server-side — in which case the hook drops the
 * stale token rather than retrying it on every load. Returns the
 * effect's own cleanup, exactly as the inline body did.
 */
export function reconcileServerDraftOnLoad({
  slug,
  // The exchange's verdict, so this can tell whose application it is holding.
  // `PublicApplyHandler` also gates the effect on it not being `pending`, which is
  // the ordering half; this is the identity half. See `publicApplyInvite.js` for
  // why the two are separate mechanisms.
  invite,
  resetGenerationRef,
  restoredFromDraftRef,
  draftIdRef,
  discardGuardsRef,
  latestDraftRef,
  restoreFromStoredToken,
  setFormData,
  setCurrentStep,
  setIntakeMode,
}) {
    let current = true;
    const generation = resetGenerationRef.current;
    restoreFromStoredToken().then((restored) => {
      if (!current || !restored) return;
      // Discarded while this fetch was open. The read itself succeeded, so nothing
      // looks wrong, and writing its result back would put the discarded answers
      // into storage *after* the reset cleared them — to be restored on the next
      // load. Checked by generation rather than by mark, because reacting to the
      // discard adopted the mark already.
      if (resetGenerationRef.current !== generation) return;

      // Another writer moved the shared token slot while this fetch was open, so
      // what came back is a different application than the link opened. Abandoned
      // rather than reset: the invited answers are already on screen and in the
      // slot, and nothing here is written back. The key is available at all only
      // because `restoreFromStoredToken` now returns it — it used to be dropped,
      // which meant no caller COULD ask this question.
      if (invite?.status === INVITE_OUTCOMES.OPENED
        && restored.applicantKey && restored.applicantKey !== invite.applicantKey) return;

      const guards = discardGuardsRef.current;
      // This used to be `{ ...prev, ...restored.formData }`, which made the server
      // copy win every field it held whether or not it was the newer one. That
      // destroyed the local backup with the very failure it exists to survive: a
      // save fails, the driver refreshes, and the older server values come back
      // over their edits with nothing said.
      //
      // The local copy is re-read here rather than relied upon through `prev`, so
      // the decision does not depend on the order two effects happen to run in.
      // All of this outside the updater: a `setFormData` updater has to stay pure,
      // because React may invoke it more than once, and one of the steps below
      // writes to storage.
      const resolved = reconcileApplicationDraft({
        /**
         * Withheld when a link opened somebody else's application in this browser.
         *
         * This is the contamination itself. The local copy is one slot per company
         * slug, and a dirty one wins outright (`local-unsynced`) — so a previous
         * applicant's answers, unioned employer rows and whole upload descriptors
         * beat the answers the carrier prepared for the driver who just clicked
         * the link, and were then written back and autosaved onto the carrier's
         * draft.
         *
         * `null` is a supported input and means "this browser has no local copy of
         * this application", which is exactly true: the copy it has belongs to
         * someone else. The reconciler then takes the server body, and the
         * ordinary server-won write-back replaces the foreign slot contents — so
         * no new writer is introduced to a slot whose naming and sequence rules
         * are as intricate as these.
         */
        local: invite?.foreignSlot ? null : readApplicationDraft(slug),
        server: restored,
        live: latestDraftRef.current.formData,
      });
      if (!resolved) return;

      // A discard this tab has not noticed yet — no `storage` event delivered, or
      // one it was suspended through — is caught here, where the generation check
      // above cannot see it.
      if (guards.discardedElsewhere()) {
        guards.handleDiscardedElsewhere();
        return;
      }

      // Write the outcome back locally when the **server** copy won.
      //
      // Otherwise the next navigation would write that server content out as if it
      // were unacknowledged local work: the copy would read as dirty, and a further
      // advance from a third device would then lose to content that came from the
      // server in the first place. Same reasoning as the explicit Continue path in
      // `applyRestoredDraft`.
      //
      // When *local* won the sequences are deliberately left alone — that copy
      // really does hold work the server has not seen, and is still owed a save.
      if (resolved.source === 'server') {
        // Synced only if the merged body really is the server's body. The reconciler
        // overlays anything typed since page load, and the server fetch is a round
        // trip an applicant can type through — so marking the whole merged body
        // synced would claim the server holds an edit it has never seen. Close the
        // tab there and the next load, finding a clean local copy, would hand back
        // the older server value: the silent loss this mechanism exists to prevent,
        // through a two-second window.
        //
        // Keys only the local copy has count the same way, for the same reason.
        const serverSeq = Number.isInteger(restored.clientSeq) ? restored.clientSeq : null;
        const holdsMoreThanServer = !sameDraftData(resolved.formData, restored.formData);
        const reconciled = saveApplicationDraft(slug, resolved.formData, holdsMoreThanServer
          // One above the server's position, with the synced position left at it:
          // dirty, so the next navigation or reconnect sends it, while a later
          // genuine server advance is still recognised by `clientSeq !== syncedSeq`.
          ? {
            lastStep: resolved.stepIndex,
            localSeq: (serverSeq ?? 0) + 1,
            syncedSeq: serverSeq ?? 0,
            draftId: draftIdRef.current,
          }
          : {
            lastStep: resolved.stepIndex,
            localSeq: serverSeq ?? undefined,
            synced: true,
            draftId: draftIdRef.current,
          });
        if (reconciled.draftId) draftIdRef.current = reconciled.draftId;
      }

      // Restored content, whichever copy won: both the local draft and the server
      // draft are *stored* copies of the application, so a discard elsewhere means
      // what is on screen is the discarded application. Only answers typed in this
      // tab and never stored survive one.
      restoredFromDraftRef.current = true;
      // `resolved.formData` already carries anything typed since load, so it goes
      // last; `prev` still supplies the wizard's untouched defaults.
      setFormData((prev) => ({ ...prev, ...resolved.formData }));
      // `Math.max`: never move an applicant *backwards* from where they already
      // are in this session.
      setCurrentStep((prev) => Math.max(prev, restored.stepIndex));
      setIntakeMode('manual');
    }).catch(() => {
      // Handled inside the hook. Nothing here may interrupt the apply page.
    });
    return () => { current = false; };
}

/**
 * The reconnect flush: sends the local copy when the connection returns and
 * it is actually owed a save. Returns the effect's own cleanup.
 *
 * Without this, the only triggers for a server save are Next and "Save as Draft"
 * — so an applicant who lost signal, typed a page, and regained signal while
 * sitting on that page kept their work locally and never sent it. Nothing was
 * lost (the submission carries the full form), but the server draft stayed
 * behind, which is the copy a recruiter sees and the one that survives a lost
 * device.
 *
 * Only when the local copy is actually owed a save. A clean draft needs no round
 * trip, and a legacy draft counts as owed because nothing is known about whether
 * the server has its contents.
 */
export function listenForReconnectFlush({
  slug,
  discardGuardsRef,
  latestDraftRef,
  draftIdRef,
  saveDraftToServer,
}) {
    const flush = () => {
      // The longest-delayed writer there is: the applicant may have discarded in
      // another tab at any point while this one waited for a connection.
      const guards = discardGuardsRef.current;
      if (guards.discardedElsewhere()) {
        guards.handleDiscardedElsewhere();
        return;
      }
      const state = draftSyncState(slug);
      if (!state?.dirty) return;
      const { formData: latest, currentStep: step } = latestDraftRef.current;
      saveDraftToServer({
        formData: latest,
        stepIndex: step,
        localSeq: state.localSeq,
        // Which application this owes a save for. The acknowledgement is scoped to it,
        // because a reconnect can be minutes after the fact.
        draftId: draftIdRef.current,
      });
    };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
}
