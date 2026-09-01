// The guest application's cross-tab discard machinery and the server resume
// flow, split out of `PublicApplyHandler.jsx` on 2026-09-01 for the
// source-size standard (PA-1c). This hook owns the four refs that give a tab
// its identity (the discard mark it loaded with, whether the screen came out
// of a stored draft, the reset generation, and the draft's own name), the two
// discard callbacks with the guards ref the long-lived writers read through,
// the storage-event subscription — and the `useApplicationResume` call, which
// lives HERE because the pair is circular: the resume hook needs
// `discardedElsewhere`, and reacting to a discard needs the resume hook's
// `forgetDraftOwnership`. Bodies verbatim.
import { useRef, useCallback, useEffect } from 'react';
import { useApplicationResume } from '../../hooks/useApplicationResume';
import { clearResumeToken } from '../../services/applicationDraftService';
import {
  clearApplicationDraft,
  readDiscardMark,
  discardMarkReason,
  subscribeToDiscardMark,
} from './applicationDraftStorage';

export function useDiscardAwareResume({
  slug,
  sandbox,
  companyId,
  hasCustomQuestions,
  submissionStatus,
  showInfo,
  setFormData,
  setCurrentStep,
  setIntakeMode,
}) {
  /**
   * The discard mark this tab loaded with.
   *
   * `null` means "no discard had happened when I started", which is the ordinary
   * case. Anything else is the mark of a discard that had already occurred, and
   * adopting it is what stops this tab from treating old history as news.
   */
  const discardMarkRef = useRef(readDiscardMark(slug));
  /**
   * Whether what is on screen came out of a stored draft.
   *
   * Decides what a discard elsewhere costs this tab. If these answers were
   * *restored*, they **are** the discarded application and must go. If the
   * applicant typed them here, they are their own work and a discard somewhere else
   * is no reason to destroy them — they simply become the start of a new
   * application.
   */
  const restoredFromDraftRef = useRef(false);
  /**
   * Bumped every time a discard is observed.
   *
   * The mark alone is not enough for work that is already in flight. Reacting to a
   * discard *adopts* the new mark — it has to, or the tab would react to its own
   * history forever — so an asynchronous step that started before the reset finds
   * the mark comparison clean again and carries on writing. A counter captured
   * before the await and re-read after it asks the question that actually matters:
   * "did anything get discarded while I was waiting?"
   */
  const resetGenerationRef = useRef(0);
  /**
   * Which application *this tab* is working on, by the draft's own opaque name.
   *
   * Deliberately a ref rather than a read of storage when it is needed. `localStorage`
   * is shared, so by the time an offline submission finally lands the value there may
   * belong to an application another tab began — and stamping a queued submission with
   * somebody else's identity would let it close out their unsent work. Remembered when
   * this tab writes or restores a draft, which is exactly when it takes one on.
   */
  const draftIdRef = useRef(null);

  /**
   * Has this application been discarded since this tab loaded it?
   *
   * Read fresh from storage every time rather than cached: the whole point is that
   * another tab may have changed it a moment ago.
   */
  const discardedElsewhere = useCallback(() => {
    if (!slug || sandbox) return false;
    // Any change means this application's life ended somewhere. Deliberately not
    // narrowed by the draft's name: two tabs on the same application hold different
    // local names, so a name test makes a tab ignore the very discard it must react to.
    return readDiscardMark(slug) !== discardMarkRef.current;
  }, [slug, sandbox]);

  /**
   * Server-side autosave and the "continue your existing application?" flow.
   *
   * Sandbox is excluded: a sandbox application is a disposable demo and there is
   * nothing to come back to.
   */
  const {
    resumePrompt,
    resumeBusy,
    resumeError,
    saveProgressToServer: saveDraftToServer,
    restoreFromStoredToken,
    continueExisting,
    startOver,
    forgetDraftOwnership,
  } = useApplicationResume({
    slug,
    companyId,
    sandbox,
    hasCustomQuestions,
    hasBeenDiscarded: discardedElsewhere,
  });

  /**
   * Reacts to this application being discarded somewhere else.
   *
   * Two ways in, deliberately: the `storage` event, which arrives within
   * milliseconds and is how the screen updates on its own, and a check before every
   * write, which is what makes the delayed, queued and offline-reconnect cases
   * deterministic rather than dependent on an event this tab might have been
   * suspended through.
   *
   * What it costs this tab depends on where its answers came from — see
   * `restoredFromDraftRef`.
   */
  const handleDiscardedElsewhere = useCallback(() => {
    // A submitted application is finished, and nothing about a discarded *draft*
    // may reach back into it. Resetting here would throw away the success screen,
    // the confirmation number and the post-submission documents checklist — the
    // one moment in this flow where the applicant has something they cannot get
    // back. A submission in flight is left alone for the same reason.
    // Bumped before the exemption, not after it: in-flight work has to abort in this
    // case too. A submitted application must not have a draft written back for it
    // either, which is the other half of the same rule.
    const mark = readDiscardMark(slug);

    resetGenerationRef.current += 1;

    if (submissionStatus === 'submitting' || submissionStatus === 'success' || submissionStatus === 'queued') {
      discardMarkRef.current = readDiscardMark(slug);
      return;
    }

    // The reason decides the wording, and the applicant is owed the true one.
    const submitted = discardMarkReason(mark) === 'submit';
    // Adopted first, so nothing below can re-enter this.
    discardMarkRef.current = mark;
    // Whatever happens to the answers, the application they belonged to is over, so its
    // name must not carry into the next draft this tab writes — in the branch below
    // that keeps the answers just as much as in the one that clears them, because there
    // the code is saying outright that they will start a new application.
    draftIdRef.current = null;
    // This browser owns nothing now: the next save must ask the resume question
    // again rather than silently creating.
    forgetDraftOwnership();
    clearResumeToken(slug);

    if (restoredFromDraftRef.current) {
      // These answers *are* the discarded application. Keeping them on screen
      // would be showing the applicant the thing they just deleted.
      restoredFromDraftRef.current = false;
      // The stored copy goes with them, and only here: in the other branch the slot
      // holds this tab's own application, and deleting that would destroy the backup
      // of work the applicant is still typing.
      clearApplicationDraft(slug);
      setFormData({});
      setCurrentStep(0);
      setIntakeMode(null);
      showInfo(submitted
        ? 'That application was submitted in another tab. Starting fresh.'
        : 'That saved application was discarded in another tab. Starting fresh.');
      return;
    }

    // Typed here, so it is the applicant's own work and stays. It is simply no
    // longer attached to the draft that was deleted.
    showInfo(submitted
      ? 'That application was submitted in another tab. Your answers here will start a new one.'
      : 'The saved application was discarded in another tab. Your answers here will start a new one.');
  }, [slug, submissionStatus, forgetDraftOwnership, showInfo, setFormData, setCurrentStep, setIntakeMode]);

  /**
   * A stable handle on the two discard callbacks.
   *
   * Neither is stable itself: `handleDiscardedElsewhere` closes over `showInfo`,
   * which `ToastProvider` rebuilds on every render. Naming them as effect
   * dependencies therefore re-runs those effects on every render — which, for the
   * server-reconciliation effect below, means re-fetching the draft and rewriting
   * the local copy over and over instead of once on load. Same reasoning as
   * `latestDraftRef`.
   */
  const discardGuardsRef = useRef({ discardedElsewhere, handleDiscardedElsewhere });
  discardGuardsRef.current = { discardedElsewhere, handleDiscardedElsewhere };

  /**
   * Notices a discard from another tab while this one is sitting idle.
   *
   * Sandbox is excluded along with everything else about resuming: a sandbox
   * application is a disposable demo with nothing to discard.
   */
  useEffect(() => {
    if (!slug || sandbox) return undefined;
    return subscribeToDiscardMark(slug, () => discardGuardsRef.current.handleDiscardedElsewhere());
  }, [slug, sandbox]);

  return {
    discardMarkRef,
    restoredFromDraftRef,
    resetGenerationRef,
    draftIdRef,
    discardedElsewhere,
    handleDiscardedElsewhere,
    discardGuardsRef,
    resumePrompt,
    resumeBusy,
    resumeError,
    saveDraftToServer,
    restoreFromStoredToken,
    continueExisting,
    startOver,
    forgetDraftOwnership,
  };
}
