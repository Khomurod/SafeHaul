/**
 * The end of this page's queued submission, whenever it comes.
 *
 * A submission the page could not deliver waits in the offline queue, and the
 * queue may send it minutes or days later, from any page of the site on this
 * device, in this tab or another (`queuedApplicationOutcome.js`). This page takes
 * the end up when it is about the application on screen: sent, it shows the
 * confirmation number and the forms that follow, as a direct submission does;
 * refused, or out of attempts, it says why and goes to the page to fix, by the
 * company's settings as they are now, the answers untouched. An end that came
 * while no page was open is read when the page has loaded.
 *
 * "The application on screen" is the draft's own opaque name, never the slug
 * alone: by the time an end arrives the applicant may have started another
 * application on the same page, which a stale success screen would hide.
 */
import { useCallback, useEffect, useRef } from 'react';
import { dequeueSubmission } from '@lib/submissionQueue';
import { refusalStepNow } from './publicApplyRefusal';
import { keepConfirmation, subscribeToQueuedApplications, takeEndedEntries } from './queuedApplicationOutcome';

const NOT_SENT = 'Your application could not be sent. Check your connection, then press Submit again.';

export function useQueuedApplicationOutcome({
  slug,
  sandbox,
  ready,
  company,
  setCompany,
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
      // Kept in this tab too: the queue may have sent it from another.
      keepConfirmation(detail);
      sessionStorage.setItem('lastConfirmationNumber', detail.confirmationNumber || '');
      setSubmittedApplicationId(detail.applicationId || '');
      setSubmittedConfirmationNumber(detail.confirmationNumber || '');
      setPostSubmitDocs({});
      setSubmissionStatus('success');
      return true;
    }
    const refusal = { details: { issues: detail.issues } };
    const routed = detail.outcome === 'refused'
      ? refusalStepNow(refusal, { slug, sandbox, company, setCompany })
      : Promise.resolve(null);
    routed.then((step) => {
      if (step !== null) setCurrentStep(step);
      setSubmissionStatus('error');
      showError(detail.message || NOT_SENT);
    });
    return true;
  }, [slug, sandbox, company, setCompany, draftIdRef, setSubmissionStatus, setSubmittedApplicationId, setSubmittedConfirmationNumber, setPostSubmitDocs, setCurrentStep, showError]);

  // The handler changes with its inputs; the listener and the first read use the latest.
  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    if (!slug || sandbox) return undefined;
    return subscribeToQueuedApplications((detail) => {
      if (detail?.slug !== slug || !takeRef.current(detail)) return;
      // Told: a refusal or a failure is not kept for a later visit too.
      if (detail.outcome !== 'sent' && detail.entryId) dequeueSubmission(detail.entryId).catch(() => false);
    });
  }, [slug, sandbox]);

  useEffect(() => {
    if (!ready || !slug || sandbox) return;
    let live = true;
    takeEndedEntries(slug, draftIdRef.current)
      .then(([newest]) => {
        if (live && newest) takeRef.current(newest);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [ready, slug, sandbox, draftIdRef]);
}
