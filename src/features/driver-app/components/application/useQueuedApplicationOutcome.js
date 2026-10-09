/**
 * The end of this page's queued submission, whenever it comes.
 *
 * A submission the page could not deliver waits in the offline queue, and the
 * queue may send it minutes or days later, from any page of the site on this
 * device (`queuedApplicationOutcome.js`). This page takes the end up when it is
 * about the application on screen: sent, it shows the confirmation number and
 * the forms that follow, as a direct submission does; refused, or out of
 * attempts, it says why and goes to the page to fix, the answers untouched. An
 * end that came while no page was open is read when the page has loaded.
 *
 * "The application on screen" is the draft's own opaque name, never the slug
 * alone: by the time an end arrives the applicant may have started another
 * application on the same page, which a stale success screen would hide.
 */
import { useCallback, useEffect, useRef } from 'react';
import { dequeueSubmission } from '@lib/submissionQueue';
import { refusalStepIndex } from './publicApplyRefusal';
import { QUEUED_APPLICATION_EVENT, takeEndedEntries } from './queuedApplicationOutcome';

const NOT_SENT = 'Your application could not be sent. Check your connection, then press Submit again.';

export function useQueuedApplicationOutcome({
  slug,
  sandbox,
  ready,
  hasCustomQuestions,
  draftIdRef,
  setSubmissionStatus,
  setSubmittedApplicationId,
  setSubmittedConfirmationNumber,
  setPostSubmitDocs,
  setCurrentStep,
  showError,
}) {
  const take = useCallback((detail) => {
    if (!detail || !draftIdRef.current || draftIdRef.current !== detail.applyDraftId) return false;
    if (detail.outcome === 'sent') {
      sessionStorage.setItem('lastConfirmationNumber', detail.confirmationNumber || '');
      setSubmittedApplicationId(detail.applicationId || '');
      setSubmittedConfirmationNumber(detail.confirmationNumber || '');
      setPostSubmitDocs({});
      setSubmissionStatus('success');
      return true;
    }
    const step = refusalStepIndex({ details: { issues: detail.issues } }, hasCustomQuestions);
    if (step !== null) setCurrentStep(step);
    setSubmissionStatus('error');
    showError(detail.message || NOT_SENT);
    return true;
  }, [draftIdRef, hasCustomQuestions, setSubmissionStatus, setSubmittedApplicationId, setSubmittedConfirmationNumber, setPostSubmitDocs, setCurrentStep, showError]);

  // The handler changes with its inputs; the listener and the first read use the latest.
  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    if (!slug || sandbox) return undefined;
    const listener = (event) => {
      const detail = event.detail;
      if (detail?.slug !== slug || !takeRef.current(detail)) return;
      // Told: a refusal or a failure is not kept for a later visit too.
      if (detail.outcome !== 'sent' && detail.entryId) dequeueSubmission(detail.entryId).catch(() => false);
    };
    window.addEventListener(QUEUED_APPLICATION_EVENT, listener);
    return () => window.removeEventListener(QUEUED_APPLICATION_EVENT, listener);
  }, [slug, sandbox]);

  useEffect(() => {
    if (!ready || !slug || sandbox) return;
    let live = true;
    takeEndedEntries(slug)
      .then((ended) => {
        if (!live) return;
        const mine = ended.find((detail) => draftIdRef.current && detail.applyDraftId === draftIdRef.current);
        if (mine) takeRef.current(mine);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [ready, slug, sandbox, draftIdRef]);
}
