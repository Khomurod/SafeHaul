/**
 * Contract freeze for the public application container — the submission contract.
 * Split from the 2203-line original on 2026-09-01 for the source-size
 * standard (PA-2); the shared harness lives in
 * PublicApplyHandler.contract.support.jsx, and every describe keeps its
 * original title so full test names are unchanged.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Every registration delegates to the shared support module, so the harness
// lives once; `vi.mock` is hoisted per file, which is why each suite repeats
// this block (see the support header, and the `CA-3` deadlock rule it cites).
vi.mock('@/context/DataContext', async () => (await import('./PublicApplyHandler.contract.support')).dataContextMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./PublicApplyHandler.contract.support')).toastProviderMock());
vi.mock('@shared/components/feedback', async () => (await import('./PublicApplyHandler.contract.support')).feedbackMock());
vi.mock('@lib/firebase', async () => (await import('./PublicApplyHandler.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/runtime/e2eMode', async () => (await import('./PublicApplyHandler.contract.support')).e2eModeMock());
vi.mock('@lib/submissionQueue', async () => (await import('./PublicApplyHandler.contract.support')).submissionQueueMock());
vi.mock('@lib/applicationId', async () => (await import('./PublicApplyHandler.contract.support')).applicationIdMock());
vi.mock('../../services/publicProfileService', async () => (await import('./PublicApplyHandler.contract.support')).publicProfileServiceMock());
vi.mock('./postApplyDocsStorage', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).postApplyDocsStorageMock(await importOriginal()));
vi.mock('@sentry/react', async () => (await import('./PublicApplyHandler.contract.support')).sentryMock());
vi.mock('react-router-dom', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).reactRouterDomMock(await importOriginal()));
vi.mock('@shared/components/layout/Stepper', async () => (await import('./PublicApplyHandler.contract.support')).stepperMock());

import { PublicApplyHandler } from './PublicApplyHandler';
import {
  showSuccess,
  showError,
  callableSpy,
  httpsCallableSpy,
  enqueueSpy,
  dequeueSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  savePostApplySessionSpy,
  generateIdSpy,
  profileOverride,
  SIGNED_DRAFT,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderWithCompleteDraft,
  renderResumedAtStep,
  chooseManualIntake,
  submit,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

describe('PublicApplyHandler submission contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileOverride.current = null;
    localStorage.clear();
    sessionStorage.clear();
    isQueueSupportedSpy.mockReturnValue(true);
    initQueueSpy.mockResolvedValue(undefined);
    enqueueSpy.mockResolvedValue('queue-1');
    dequeueSpy.mockResolvedValue(undefined);
    callableSpy.mockResolvedValue({ data: {} });
    // Restored explicitly: `clearAllMocks` forgets calls but keeps implementations, and
    // one case below holds this promise open on purpose.
    generateIdSpy.mockImplementation(async () => 'generated-app-id');
    stubDraftCallables();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('calls submitGuestApplication with the exact top-level payload shape', async () => {
    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(httpsCallableSpy).toHaveBeenCalledWith({}, 'submitGuestApplication');

    const payload = callableSpy.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ['companyId', 'email', 'formData', 'phone', 'signature'].sort(),
    );
    expect(payload.companyId).toBe('company-1');
    expect(payload.email).toBe('ada@example.com');
    expect(payload.phone).toBe('5555551234');
    expect(payload.signature).toBe('data:image/png;base64,AAAA');
  });

  it('keeps the frozen formData envelope: ids, source, status, arrays and lifecycle', async () => {
    await renderWithCompleteDraft();
    await submit();
    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));

    const { formData } = callableSpy.mock.calls[0][0];
    expect(formData.applicantId).toBe('generated-app-id');
    expect(formData.applicationId).toBe('generated-app-id');
    expect(formData.confirmationNumber).toBe('CONF-123');
    expect(formData.companyId).toBe('company-1');
    expect(formData.companyName).toBe('Acme Freight');
    expect(formData.sourceType).toBe('Public Application');
    expect(formData.sourceSlug).toBe('acme');
    expect(formData.status).toBe('New Application');
    expect(formData.signatureType).toBe('drawn');
    expect(formData.recruiterCode).toBeNull();
    // Arrays are always arrays, never undefined.
    for (const key of ['employers', 'violations', 'accidents', 'schools', 'military']) {
      expect(Array.isArray(formData[key])).toBe(true);
    }
    expect(formData.lifecycle).toMatchObject({
      status: 'pending',
      clientVersion: '2.0-bulletproof',
      isGuest: true,
    });
    // No serverTimestamp sentinels are sent from the client.
    expect(formData.submittedAt).toBeUndefined();
    expect(formData.createdAt).toBeUndefined();
  });

  it('queues before submitting and dequeues only after the callable succeeds', async () => {
    const order = [];
    enqueueSpy.mockImplementation(async () => { order.push('enqueue'); return 'queue-1'; });
    callableSpy.mockImplementation(async () => { order.push('submit'); return { data: {} }; });
    dequeueSpy.mockImplementation(async () => { order.push('dequeue'); });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(order).toEqual(['enqueue', 'submit', 'dequeue']));
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'generated-app-id' }),
      'company-1',
      // The slug travels with the entry: when a replay finally lands, the queue is
      // what has to close out that application's local draft, and by then nothing
      // else remembers which application it was. The draft's identity goes with it,
      // so a replay landing after the applicant has started a new application closes
      // the one that was submitted rather than their newer work.
      {
        type: 'guest',
        userId: null,
        applySlug: 'acme',
        // Null for this fixture, and correctly so: it is a draft written before drafts
        // were named, so nothing can prove which application it is and the late close
        // will refuse to touch anything rather than guess. The named case is below.
        applyDraftId: null,
        // Nothing had been discarded on this page when the entry was queued, and the
        // replay compares against exactly that.
        applyDiscardMark: null,
      },
    );
  });

  it('retries the callable three times, then falls back to the queued screen', async () => {
    callableSpy.mockRejectedValue(new Error('offline'));

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Application Saved' })).toBeInTheDocument(), {
      timeout: 10_000,
    });
    expect(callableSpy).toHaveBeenCalledTimes(3);
    expect(dequeueSpy).not.toHaveBeenCalled();
  }, 20_000);

  it('surfaces an error instead of the queued screen when the queue is unavailable', async () => {
    isQueueSupportedSpy.mockReturnValue(false);
    callableSpy.mockRejectedValue(new Error('offline'));

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Failed to submit application. Please try again.'),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole('heading', { name: 'Application Saved' })).toBeNull();
  }, 20_000);

  it('clears the local draft and the pending recruiter code on success', async () => {
    sessionStorage.setItem('pending_application_recruiter', 'REC-9');
    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('draft_acme')).toBeNull());
    expect(sessionStorage.getItem('pending_application_recruiter')).toBeNull();
    expect(callableSpy.mock.calls[0][0].formData.recruiterCode).toBe('REC-9');
  });

  it('prefers server-generated ids and stores the confirmation number', async () => {
    callableSpy.mockResolvedValue({
      data: { applicationId: 'server-app-id', confirmationNumber: 'SERVER-1' },
    });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(sessionStorage.getItem('lastConfirmationNumber')).toBe('SERVER-1'));
    expect(savePostApplySessionSpy).toHaveBeenCalledWith('company-1', {
      applicationId: 'server-app-id',
      confirmationNumber: 'SERVER-1',
      slug: 'acme',
      docs: {},
    });
  });

  it('submits once even when the submit action fires repeatedly', async () => {
    let release;
    callableSpy.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: {} }); }));

    await renderWithCompleteDraft();
    await submit();
    await submit();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());
  });

  it('blocks submission and returns to the upload step when a required document is missing', async () => {
    await renderWithCompleteDraft({ 'medical-card-upload': null });
    await submit();

    expect(callableSpy).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Please upload required documents before submitting: Medical Card.',
    );
    expect(screen.getByTestId('current-step')).toHaveTextContent('2');
  });

  /**
   * A draft never stores `ssn`, so an applicant who resumed part-way through has
   * never been asked for it: the step that collects it never ran its validation,
   * and before this the application submitted without a field the company
   * requires. The server refuses it independently; these cases are about the
   * applicant being told which field and taken to it.
   */
  const MISSING_SSN_MESSAGE =
    'Please re-enter your Social Security Number to submit. '
    + 'It is not saved with your progress for security.';

  /**
   * `lastStep` on purpose in each of these.
   *
   * The wizard opens on page one by default, so a test that asserts "sent back to
   * page one" from step 0 asserts nothing — it would pass with the gate deleted.
   * Resuming at a later step is also the real scenario: the applicant who never
   * passes back through page one is exactly the one whose SSN is gone.
   */
  it('blocks submission and returns to page one when a resumed application has no SSN', async () => {
    await renderResumedAtStep(5, { ssn: '' });
    await submit();

    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    // 0 = the contact step, which is where the field is collected.
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('treats whitespace as missing, not as an answer', async () => {
    await renderResumedAtStep(5, { ssn: '   ' });
    await submit();

    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('routes to the earliest incomplete page when both the SSN and an upload are missing', async () => {
    await renderResumedAtStep(5, { ssn: '', 'medical-card-upload': null });
    await submit();

    // Page one, not the upload step: one round trip through the form instead of
    // two. The upload gate then stops them on the way back through.
    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    expect(showError).not.toHaveBeenCalledWith(
      'Please upload required documents before submitting: Medical Card.',
    );
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('submits without an SSN when the company marks it optional', async () => {
    profileOverride.current = {
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
        ssn: { hidden: false, required: false },
      },
    };
    await renderWithCompleteDraft({ ssn: '' });
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(showError).not.toHaveBeenCalled();
  });

  it('submits without an SSN when the company hides the question', async () => {
    profileOverride.current = {
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
        // Hidden AND required: a question nobody is shown cannot be one they must
        // answer, so hidden has to win — otherwise this configuration produces an
        // application that can never be submitted.
        ssn: { hidden: true, required: true },
      },
    };
    await renderWithCompleteDraft({ ssn: '' });
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(showError).not.toHaveBeenCalled();
  });

  it('blocks submission and returns to the consent step when the signature is missing', async () => {
    await renderWithCompleteDraft({ signature: '' });
    await submit();

    expect(callableSpy).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('Please complete the electronic signature.');
    // 8 = consent index with no custom questions.
    expect(screen.getByTestId('current-step')).toHaveTextContent('8');
  });

  it('rejects an invalid email and phone before any network call', async () => {
    await renderWithCompleteDraft({ email: 'not-an-email' });
    await submit();
    expect(showError).toHaveBeenCalledWith('Invalid Email Address.');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('reports a failed local draft save instead of silently losing it', async () => {
    await renderWithCompleteDraft();
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    fireEvent.click(screen.getByText('probe-save-draft'));
    expect(setItem).toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Could not save progress locally. Your data is still here — please continue filling the form.',
    );
    expect(showSuccess).not.toHaveBeenCalledWith('Progress saved.');
    setItem.mockRestore();
  });

  it('records the recruiter code from either query parameter', async () => {
    localStorage.setItem('draft_acme', JSON.stringify(SIGNED_DRAFT));
    render(
      <MemoryRouter initialEntries={['/apply/acme?recruiter=FROM-LONG']}>
        <Routes>
          <Route path="/apply/:slug" element={<PublicApplyHandler />} />
        </Routes>
      </MemoryRouter>,
    );
    await chooseManualIntake();
    expect(sessionStorage.getItem('pending_application_recruiter')).toBe('FROM-LONG');
    expect(sessionStorage.getItem('pending_application_company')).toBe('company-1');
  });
});

/**
 * Autosave, resume and start-over.
 *
 * The rule every one of these protects: **saving must never be able to stop an
 * applicant.** The feature exists because drivers on bad connections were losing
 * everything they had typed, so a version of it that blocks them on a bad
 * connection would be a worse bargain than not having it.
 */
