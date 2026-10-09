// The guest application's draft lifecycle, split out of
// `PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
// (PA-1c): the synchronous per-step local write, the restore-and-mark-synced
// path behind Continue, the post-submission close, Start Over with its
// quota-ordering rules, and the explicit Save-as-Draft. Bodies verbatim; the
// refs arrive as the ref objects, so ownership semantics are unchanged.
import { useCallback, useEffect, useRef } from 'react';
import {
  readApplicationDraft,
  saveApplicationDraft,
  clearApplicationDraft,
  writeDiscardMark,
} from './applicationDraftStorage';
import { closeDraftAfterSubmission } from '../../services/applicationDraftService';
import { companyFieldsAfter, withCompanyNotice } from './companyEditsSync';

/** The `storagePath` of every uploaded file among the answers, a custom question's included. */
export function storedFilePaths(formData) {
  const values = [
    ...Object.values(formData || {}),
    ...Object.values(formData?.customAnswers || {}),
  ];
  return new Set(values
    .filter((value) => value && typeof value === 'object' && typeof value.storagePath === 'string')
    .map((value) => value.storagePath));
}

export function useDraftLifecycle({
  slug,
  sandbox,
  formData,
  currentStep,
  draftIdRef,
  restoredFromDraftRef,
  discardMarkRef,
  discardedElsewhere,
  handleDiscardedElsewhere,
  continueExisting,
  startOver,
  forgetDraftOwnership,
  saveDraftToServer,
  setFormData,
  setCurrentStep,
  setIntakeMode,
  showSuccess,
  showError,
  showInfo,
  sendFile,
}) {
  /**
   * The local copy, written synchronously on every step change.
   *
   * First, and synchronously, on purpose: it cannot fail for a network reason and
   * it cannot delay the applicant. The server copy follows in the background,
   * so a driver on a bad connection still has everything they typed when they
   * come back to this browser — which is the case this whole feature exists for.
   *
   * This used to be gated behind the E2E test flag, so in production nothing was
   * written per step at all and `lastStep` was never recorded. Three lines, and
   * `e2e/guest-draft-resume.spec.cjs` had been proving the mechanism worked the
   * whole time.
   */
  const persistLocalDraft = useCallback((stepIndex) => {
    if (!slug || sandbox) return null;
    // The returned sequence identifies exactly this write. It travels with the
    // server save so that, when the save lands, only *this* content is marked
    // synced — see `markDraftSynced`.
    const { localSeq, draftId } = saveApplicationDraft(slug, formData, {
      lastStep: stepIndex,
      // What *this* tab owns, so a slot another tab filled first does not lend this
      // write its name. Null means "I own none", which mints a new one.
      draftId: draftIdRef.current,
    });
    if (draftId) draftIdRef.current = draftId;
    return localSeq;
  }, [slug, sandbox, formData, draftIdRef]);

  /**
   * A file this tab sent is kept with the page as soon as it is among the answers.
   * The local copy is otherwise written only when the step changes, so a reload
   * between an upload and Continue cost the driver the document they had just
   * sent. Only an upload that landed starts this write, never answers replaced
   * wholesale (a restore, Start Over, the reset after submitting), and never for an
   * application discarded elsewhere, which this tab must not bring back.
   *
   * The CDL auto-fill's photo lands outside `handleFileUpload`, with the answers
   * read from it, so the auto-fill asks for the next answers to be kept instead
   * (`keepNextAnswers`), photo or no photo.
   */
  const landedRef = useRef(new Set());
  const keepNextRef = useRef(false);
  const handleFileUpload = useCallback(async (fieldName, file, options) => {
    const stored = await sendFile(fieldName, file, options);
    if (stored?.storagePath) landedRef.current.add(stored.storagePath);
    return stored;
  }, [sendFile]);
  const keepNextAnswers = useCallback(() => { keepNextRef.current = true; }, []);
  useEffect(() => {
    const landed = landedRef.current;
    if (!landed.size && !keepNextRef.current) return;
    const answered = storedFilePaths(formData);
    const arrived = [...landed].filter((path) => answered.has(path));
    if (!arrived.length && !keepNextRef.current) return;
    keepNextRef.current = false;
    arrived.forEach((path) => landed.delete(path));
    if (!discardedElsewhere()) persistLocalDraft(currentStep);
  }, [formData, currentStep, discardedElsewhere, persistLocalDraft]);

  /**
   * Where Continue goes after Edit on the Review page.
   *
   * Review's Edit buttons are the wizard's only numeric jumps. The step they open
   * is remembered with the Review step it was opened from, and Continue on that
   * same step returns to Review instead of walking every later page again. The
   * edited step still validates first: a step calls `onNavigate('next')` only once
   * its own checks pass. Any other navigation forgets it, and so does the end of
   * that application: a discard (here or in another tab) or a Start Over changes
   * the discard mark, and the wizard they reset is a new application whose page
   * one must not jump to the old Review. A later page the edit left incomplete is
   * still caught: the submission pre-flight and the server check the whole
   * application and route the applicant to what is missing.
   */
  const reviewReturnRef = useRef(null);

  const handleNavigate = (direction) => {
    let nextStep = currentStep;
    const reviewReturn = reviewReturnRef.current;
    reviewReturnRef.current = null;
    if (direction === 'next') {
      const returnsToReview = reviewReturn?.editedStep === currentStep
        && reviewReturn.discardMark === discardMarkRef.current;
      nextStep = returnsToReview ? reviewReturn.reviewStep : currentStep + 1;
    } else if (direction === 'back') nextStep = Math.max(0, currentStep - 1);
    else if (typeof direction === 'number') {
      nextStep = direction;
      reviewReturnRef.current = { editedStep: direction, reviewStep: currentStep, discardMark: discardMarkRef.current };
    }

    // Before the step moves, not just before the write. Advancing and then
    // refusing to persist would leave the applicant a page further on with nothing
    // recorded; this way the click does nothing except explain itself, and their
    // next one behaves normally.
    if (discardedElsewhere()) {
      handleDiscardedElsewhere();
      return;
    }

    setCurrentStep(nextStep);
    const localSeq = persistLocalDraft(nextStep);
    // Only forward: going back is not new information, and a save on every Back
    // click would spend the applicant's rate-limit budget on nothing.
    //
    // One call, not two. The hook runs the resume lookup itself before its first
    // server write and holds the write until the applicant has answered the
    // prompt — see its header for the three ways a save racing that lookup loses
    // the draft it was supposed to protect.
    if (direction === 'next') {
      saveDraftToServer({ formData, stepIndex: nextStep, localSeq, draftId: draftIdRef.current });
    }
    // Scrolling is owned by `Stepper`, which focuses the new step's heading.
    // A second scroll here raced that one and made step transitions
    // non-deterministic (see the Stepper header comment).
  };


  /**
   * Applies a restored draft to the wizard.
   *
   * Merged over whatever is already there rather than replacing it: an applicant
   * who typed a page before being recognised should not lose those keystrokes to
   * the restore, and the stored answers are the ones that matter for every field
   * they have not touched this session.
   */
  const applyRestoredDraft = useCallback((restored) => {
    if (!restored) return;
    // Nothing of this application was on this device before, so every answer a
    // Company Admin edited is new to the driver here. See `companyEditsSync.js`.
    const answers = withCompanyNotice(restored.formData, companyFieldsAfter(restored.companyEdits, 0));
    setFormData((prev) => ({ ...prev, ...answers }));
    setCurrentStep(restored.stepIndex);
    setIntakeMode('manual');
    // Written straight back to the local copy, so a reload after a restore does
    // not fall back to a staler draft than the one just loaded.
    //
    // Recorded as **already synced**: this copy *is* the server's copy. Letting it
    // advance the sequence as an ordinary write would mark it as holding
    // unacknowledged work, and the next page load would then prefer it over a
    // server draft that had genuinely moved on since.
    //
    // `synced: true` rather than a number, because a server draft written before
    // `clientSeq` existed has none to adopt — and it still must not be treated as
    // unsynced local work.
    const written = saveApplicationDraft(slug, { ...formData, ...answers }, {
      lastStep: restored.stepIndex,
      localSeq: Number.isInteger(restored.clientSeq) ? restored.clientSeq : undefined,
      synced: true,
      draftId: draftIdRef.current,
    });
    if (written.draftId) draftIdRef.current = written.draftId;
    // What is on screen now came out of the stored draft, which decides what a
    // discard elsewhere costs this tab.
    restoredFromDraftRef.current = true;
    showSuccess('Your saved application has been restored.');
  }, [slug, formData, showSuccess, draftIdRef, restoredFromDraftRef, setFormData, setCurrentStep, setIntakeMode]);

  const handleContinueExisting = useCallback(async () => {
    applyRestoredDraft(await continueExisting());
  }, [continueExisting, applyRestoredDraft]);

  /**
   * Closes the draft's life once the application has actually been submitted.
   *
   * The server discards the draft on submission (`discardDraftForApplication`), so
   * afterwards the resume token is a credential for a document that no longer
   * exists and the same in-memory staleness applies: a second tab still holding
   * these answers would otherwise autosave them back and put an applicant who has
   * already applied into the recruiter's "started, incomplete" list.
   *
   * The queued path deliberately does not call this. That submission has not
   * reached the server yet, so its draft is still the live record of the
   * application, and the offline queue owns getting it the rest of the way.
   */
  const finishDraftLifecycle = useCallback(() => {
    if (!slug) return;
    if (sandbox) {
      // A sandbox application is a disposable demo: nothing to tell other tabs, no
      // token to drop, and no other application can be sharing the slot.
      clearApplicationDraft(slug);
      return;
    }
    // The same writes the offline queue performs when a submission it was holding
    // finally lands, from one place so the two cannot drift — scoped, as there, to the
    // application this tab actually submitted.
    discardMarkRef.current = closeDraftAfterSubmission(slug, { draftId: draftIdRef.current })
      ?? discardMarkRef.current;
    // This application is finished, so its name must not carry into the next one.
    draftIdRef.current = null;
    // This tab's own save queue goes too, and adopting the mark above is exactly why
    // it has to be said explicitly: `hasBeenDiscarded` stays false here, so a payload
    // already waiting behind an in-flight save would still be drained — and, with the
    // token now cleared, sent token-less, which the server accepts as a first save.
    // The result would be a fresh unfinished draft for somebody who has just
    // submitted. The request already on the wire is refused server-side, because it
    // carries the token of the draft submission deleted.
    forgetDraftOwnership();
  }, [slug, sandbox, forgetDraftOwnership, discardMarkRef, draftIdRef]);

  const handleStartOver = useCallback(async () => {
    if (!(await startOver())) return;
    // The local copy goes first, and the order is deliberate. A genuinely new
    // application must not find the old one on the next reload — but clearing it also
    // *frees space*, and the mark below is the only thing that tells the other tabs
    // anything. Writing the mark while a large draft still fills the quota can fail,
    // and by then `startOver` has already removed the shared resume token: the other
    // tab would see neither a token nor a changed mark, and its next save would be
    // accepted as a token-less first save, recreating what was just deleted.
    //
    // Scoped to what this tab was working on, because `startOver` awaited the server:
    // another tab can have written a different application into that slot in the
    // meantime, and that draft is unsent work.
    // An empty or unnamed slot is nobody else's work — an unnamed draft is one written
    // before drafts were named, and it is almost certainly the copy just discarded. A
    // *named* one is removed only when it is the name this tab was working on: having no
    // name of its own is not a licence to clear somebody's, which is the case a Start
    // Over chosen from a server-only prompt produces, where this tab never wrote a local
    // draft at all.
    const inSlot = readApplicationDraft(slug)?.meta?.draftId || null;
    if (!inSlot || inSlot === draftIdRef.current) {
      clearApplicationDraft(slug);
    }
    // Adopted as this tab's own mark in the same breath, which is what keeps this tab
    // from mistaking its own discard for somebody else's and resetting the new
    // application it is about to begin.
    discardMarkRef.current = writeDiscardMark(slug) ?? discardMarkRef.current;
    restoredFromDraftRef.current = false;
    // The discarded application's name goes too. Keeping it would name the *new*
    // application after the one just deleted, and anything still holding that name —
    // a queued submission, most of all — would act on the wrong draft.
    draftIdRef.current = null;
    showInfo('Starting a new application.');
  }, [startOver, slug, showInfo, discardMarkRef, draftIdRef, restoredFromDraftRef]);

  const handlePartialSubmit = () => {
    // SEC-2/DL-1 live in applicationDraftStorage: ssn/signature are stripped and a
    // QuotaExceededError is surfaced (false) rather than silently swallowed.
    //
    // `lastStep` is recorded now. It was omitted, so an explicit "Save as Draft"
    // saved the answers and forgot where the applicant was — and the restore path
    // ignored the field anyway, so they landed back on page one either way.
    // `.ok`, not the return value itself: this used to be a bare boolean and is
    // now `{ ok, localSeq }`, so testing the object would make every quota
    // failure look like a success.
    if (discardedElsewhere()) {
      handleDiscardedElsewhere();
      return;
    }
    const { ok, localSeq, draftId } = saveApplicationDraft(slug, formData, {
      lastStep: currentStep,
      draftId: draftIdRef.current,
    });
    if (draftId) draftIdRef.current = draftId;
    if (ok) {
      saveDraftToServer({ formData, stepIndex: currentStep, localSeq, draftId: draftIdRef.current });
      showSuccess("Progress saved.");
    } else {
      showError("Could not save progress locally. Your data is still here — please continue filling the form.");
    }
  };

  return {
    persistLocalDraft,
    handleFileUpload,
    keepNextAnswers,
    handleNavigate,
    handleContinueExisting,
    finishDraftLifecycle,
    handleStartOver,
    handlePartialSubmit,
  };
}
