// The post-submission Required Documents flow, split out of
// `PublicApplyHandler.jsx` on 2026-09-01 for the source-size standard
// (PA-1c): per-template checklist state persisted to the session snapshot,
// the start-new-application reset, and opening a post-application template
// through the signing room (E2E and production paths). Bodies verbatim.
import { useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { buildPostApplyDocErrorMessage } from './publicApplyHelpers';
import {
  DOC_STATUS,
  savePostApplySession,
  clearPostApplySession,
  markRequestSigned,
  setSigningReturnPath,
} from './postApplyDocsStorage';

export function usePostSubmitDocuments({
  slug,
  sandbox,
  company,
  submittedApplicationId,
  submittedConfirmationNumber,
  openingTemplateId,
  setOpeningTemplateId,
  setPostSubmitDocs,
  setSubmissionStatus,
  setSubmittedApplicationId,
  setSubmittedConfirmationNumber,
  setFormData,
  setCurrentStep,
  draftIdRef,
  navigate,
  showError,
  showSuccess,
}) {
  /** Update one template's checklist state and persist the session snapshot. */
  const updatePostSubmitDoc = useCallback((templateId, patch) => {
    setPostSubmitDocs((prev) => {
      const next = { ...prev, [templateId]: { ...(prev[templateId] || {}), ...patch } };
      if (company?.id && submittedApplicationId && !sandbox) {
        savePostApplySession(company.id, {
          applicationId: submittedApplicationId,
          confirmationNumber:
            submittedConfirmationNumber || sessionStorage.getItem('lastConfirmationNumber') || '',
          slug,
          docs: next,
        });
      }
      return next;
    });
  }, [company?.id, submittedApplicationId, submittedConfirmationNumber, slug, sandbox, setPostSubmitDocs]);

  const handleStartNewApplication = useCallback(() => {
    if (company?.id) clearPostApplySession(company.id);
    sessionStorage.removeItem('lastConfirmationNumber');
    setSubmissionStatus(null);
    setSubmittedApplicationId('');
    setSubmittedConfirmationNumber('');
    setPostSubmitDocs({});
    setFormData({});
    setCurrentStep(0);
    // A genuinely new application. `finishDraftLifecycle` has already forgotten the
    // submitted one's name; this is here so the invariant holds from either direction,
    // including a queued submission that has not landed yet.
    draftIdRef.current = null;
  }, [company?.id, draftIdRef, setPostSubmitDocs, setSubmissionStatus, setSubmittedApplicationId, setSubmittedConfirmationNumber, setFormData, setCurrentStep]);

  const handleOpenPostApplicationTemplate = async (template) => {
    if (!template?.templateId || !company?.id || !submittedApplicationId) {
      showError('Could not open this form yet. Please refresh and try again.');
      return;
    }

    const confirmationNumber = submittedConfirmationNumber || sessionStorage.getItem('lastConfirmationNumber') || '';
    if (!confirmationNumber) {
      showError('Missing confirmation number. Please refresh and try again.');
      return;
    }

    // One document at a time; also guards rapid double-clicks (the backend is
    // additionally idempotent per application+template, so even a race cannot
    // create duplicate signing requests).
    if (openingTemplateId) return;

    const returnPath = sandbox ? '/sandbox/apply' : `/apply/${slug}`;

    try {
      setOpeningTemplateId(template.templateId);
      updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.OPENING, error: null });

      if (isE2ETestMode) {
        const requestId = `e2e-post-app-req-${template.templateId}`;
        setSigningReturnPath(company.id, requestId, returnPath);
        updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.IN_PROGRESS, requestId });
        navigate(`/sign/${company.id}/${requestId}?token=e2e-token&e2eSign=mock`);
        return;
      }

      const createSigningRequest = httpsCallable(functions, 'createPostApplicationSigningRequest', { timeout: 60000 });
      const { data } = await createSigningRequest({
        companyId: company.id,
        applicationId: submittedApplicationId,
        confirmationNumber,
        templateId: template.templateId,
        appBaseUrl: window.location.origin,
      });

      // Idempotent backend: an already-signed document reports completion
      // instead of minting a duplicate request.
      if (data?.alreadyCompleted && data?.requestId) {
        markRequestSigned(company.id, data.requestId);
        updatePostSubmitDoc(template.templateId, {
          status: DOC_STATUS.COMPLETED,
          requestId: data.requestId,
          error: null,
        });
        showSuccess('This document is already completed.');
        return;
      }

      if (!data?.requestId || !data?.accessToken) {
        throw new Error('Could not generate signing link.');
      }

      setSigningReturnPath(company.id, data.requestId, returnPath);
      updatePostSubmitDoc(template.templateId, {
        status: DOC_STATUS.IN_PROGRESS,
        requestId: data.requestId,
      });
      navigate(`/sign/${company.id}/${data.requestId}?token=${data.accessToken}`);
    } catch (error) {
      // Structured diagnostics (ids + code only — never tokens, SSNs, or signatures).
      console.error('[PublicApplyHandler] Post-application e-doc launch failed:', {
        code: error?.code || 'unknown',
        templateId: template.templateId,
        companyId: company.id,
        message: error?.message,
      });
      const friendly = buildPostApplyDocErrorMessage(error);
      updatePostSubmitDoc(template.templateId, { status: DOC_STATUS.ERROR, error: friendly });
      showError(friendly);
    } finally {
      setOpeningTemplateId('');
    }
  };

  return {
    handleStartNewApplication,
    handleOpenPostApplicationTemplate,
  };
}
