/**
 * Contract freeze for the public application container — the screens either
 * side of the wizard: the link-error screen when the company cannot be loaded,
 * and the Required Documents flow after a submission.
 *
 * Added 2026-09-02 by the `PA-0` coverage audit, which found these two paths
 * characterised nowhere in the browser. The error strings were asserted only as
 * a prop handed to `ApplyLinkErrorScreen`, never as the container's routing;
 * and the production open-document path (`createPostApplicationSigningRequest`)
 * was pinned on the server and driven in the E2E journey's mock branch, while
 * the browser's payload, return path, session snapshot and navigation were not.
 * Same harness as the other suites; the registrations delegate to the support
 * module (see its header for the `CA-3` deadlock rule that shapes them).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
import { isRequestSigned, readSigningReturnPath } from './postApplyDocsStorage';
import {
  showSuccess,
  showError,
  navigateSpy,
  callableSpy,
  httpsCallableSpy,
  enqueueSpy,
  dequeueSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  savePostApplySessionSpy,
  generateIdSpy,
  profileOverride,
  profileOutcome,
  draftCallables,
  SIGNED_DRAFT,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, renderWithCompleteDraft, submit } = makeRenderers({
  PublicApplyHandler, MemoryRouter, Route, Routes,
});

// The container logs both failures below with `console.error`; that is the
// contract (structured diagnostics, no secrets), not noise to assert on.
let consoleError;

const resetHarness = () => {
  vi.clearAllMocks();
  profileOverride.current = null;
  profileOutcome.current = null;
  localStorage.clear();
  sessionStorage.clear();
  isQueueSupportedSpy.mockReturnValue(true);
  initQueueSpy.mockResolvedValue(undefined);
  enqueueSpy.mockResolvedValue('queue-1');
  dequeueSpy.mockResolvedValue(undefined);
  callableSpy.mockResolvedValue({ data: {} });
  generateIdSpy.mockImplementation(async () => 'generated-app-id');
  stubDraftCallables();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
};

const teardownHarness = () => {
  consoleError.mockRestore();
  localStorage.clear();
  sessionStorage.clear();
};

describe('the application cannot load', () => {
  beforeEach(resetHarness);
  afterEach(teardownHarness);

  it('shows the link-error screen when the company does not exist', async () => {
    profileOutcome.current = () => null;

    renderHandler();

    await screen.findByText('Company not found.');
    expect(screen.getByRole('heading', { level: 1, name: 'Link Error' })).toBeInTheDocument();
    expect(screen.queryByText('Fill Out Manually')).toBeNull();
    expect(screen.queryByText('probe-submit')).toBeNull();
  });

  it('shows the link-error screen when the profile service fails', async () => {
    profileOutcome.current = () => { throw new Error('service unavailable'); };

    renderHandler();

    await screen.findByText('Unable to load application.');
    expect(screen.getByRole('heading', { level: 1, name: 'Link Error' })).toBeInTheDocument();
    expect(screen.queryByText('Fill Out Manually')).toBeNull();
  });

  it('records no company and calls no callable while the link is broken', async () => {
    profileOutcome.current = () => null;

    renderHandler();
    await screen.findByText('Company not found.');

    expect(sessionStorage.getItem('pending_application_company')).toBeNull();
    expect(httpsCallableSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('leaves a saved local draft alone when the company cannot be loaded', async () => {
    const stored = JSON.stringify({ ...SIGNED_DRAFT, lastStep: 3 });
    localStorage.setItem('draft_acme', stored);
    profileOutcome.current = () => { throw new Error('service unavailable'); };

    renderHandler();
    await screen.findByText('Unable to load application.');

    // A load failure is not a reason to lose the applicant's work: the draft is
    // still there for the visit that succeeds.
    expect(localStorage.getItem('draft_acme')).toBe(stored);
  });
});

describe('the Required Documents that follow a submission', () => {
  const createSigningRequestSpy = vi.fn();
  const PERMISSION_DENIED_MESSAGE =
    'We could not verify your application for this document. Please refresh the page and try again.';

  beforeEach(() => {
    resetHarness();
    callableSpy.mockResolvedValue({
      data: { applicationId: 'server-app-id', confirmationNumber: 'SERVER-1' },
    });
    draftCallables.createPostApplicationSigningRequest = createSigningRequestSpy;
    createSigningRequestSpy.mockReset();
    createSigningRequestSpy.mockResolvedValue({ data: { requestId: 'req-1', accessToken: 'tok-1' } });
  });

  afterEach(() => {
    delete draftCallables.createPostApplicationSigningRequest;
    teardownHarness();
  });

  /** Submit the complete draft and return the checklist's open action. */
  const submitAndFindOpenAction = async () => {
    await renderWithCompleteDraft();
    await submit();
    await screen.findByText('Application Submitted!');
    return screen.getByRole('button', { name: 'Open Direct Deposit' });
  };

  const openDocument = async () => {
    fireEvent.click(await submitAndFindOpenAction());
  };

  it('asks the server for a signing request naming the application it just submitted', async () => {
    await openDocument();

    await waitFor(() => expect(createSigningRequestSpy).toHaveBeenCalledTimes(1));
    expect(httpsCallableSpy).toHaveBeenCalledWith(
      expect.anything(), 'createPostApplicationSigningRequest', { timeout: 60000 },
    );
    expect(createSigningRequestSpy).toHaveBeenCalledWith({
      companyId: 'company-1',
      applicationId: 'server-app-id',
      confirmationNumber: 'SERVER-1',
      templateId: 'tpl-1',
      appBaseUrl: window.location.origin,
    });
  });

  it('records where to come back to, then sends the applicant to sign with the token', async () => {
    await openDocument();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/sign/company-1/req-1?token=tok-1'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    // Written BEFORE the navigation — the signing room offers "return to
    // documents" only when a path was stored for its exact request.
    expect(readSigningReturnPath('company-1', 'req-1')).toBe('/apply/acme');
    expect(savePostApplySessionSpy).toHaveBeenLastCalledWith('company-1', {
      applicationId: 'server-app-id',
      confirmationNumber: 'SERVER-1',
      slug: 'acme',
      docs: { 'tpl-1': { status: 'in_progress', requestId: 'req-1', error: null } },
    });
  });

  it('marks an already-signed document complete without opening anything', async () => {
    createSigningRequestSpy.mockResolvedValue({ data: { alreadyCompleted: true, requestId: 'req-9' } });

    await openDocument();

    /*
     * Wait on the RENDER, not on the toast. The callable resolving fires
     * `showSuccess` and schedules a state update in the same continuation, but
     * only the first of those has happened when the toast spy is called — the
     * re-render lands a tick later. Waiting on the spy and then reading the DOM
     * synchronously is two different moments, and on a loaded CI runner the gap
     * opens: this failed there on 2026-09-05 while passing locally every time,
     * alone and in a full run, which is exactly the signature the repository's
     * own notes record for the `EditUserBodies` leak.
     *
     * The disabled button and the progress line are rendered from one and the
     * same `docStates` entry, so waiting on either one waits for both.
     */
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Direct Deposit' })).toBeDisabled();
    });
    expect(showSuccess).toHaveBeenCalledWith('This document is already completed.');
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(isRequestSigned('company-1', 'req-9')).toBe(true);
    expect(screen.getByTestId('required-documents-progress')).toHaveTextContent('1 of 1 completed');
    expect(savePostApplySessionSpy).toHaveBeenLastCalledWith('company-1', expect.objectContaining({
      docs: { 'tpl-1': { status: 'completed', requestId: 'req-9', error: null } },
    }));
  });

  it('reports a refusal in plain words and leaves the document retryable', async () => {
    createSigningRequestSpy.mockRejectedValue(
      Object.assign(new Error('PERMISSION_DENIED'), { code: 'functions/permission-denied' }),
    );

    await openDocument();

    // Same shape as the test above, fixed with it: the row's message is the
    // rendered half of the state update the toast only announces.
    const row = await screen.findByTestId('post-apply-doc-tpl-1');
    await waitFor(() => {
      expect(within(row).getByText(PERMISSION_DENIED_MESSAGE)).toBeInTheDocument();
    });
    expect(showError).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(within(row).getByRole('button', { name: /Retry/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open Direct Deposit' })).toBeEnabled();
    expect(savePostApplySessionSpy).toHaveBeenLastCalledWith('company-1', expect.objectContaining({
      docs: { 'tpl-1': { status: 'error', error: PERMISSION_DENIED_MESSAGE } },
    }));
    // The diagnostic names ids and the code, never the token or the answers.
    expect(consoleError).toHaveBeenCalledWith(
      '[PublicApplyHandler] Post-application e-doc launch failed:',
      { code: 'functions/permission-denied', templateId: 'tpl-1', companyId: 'company-1', message: 'PERMISSION_DENIED' },
    );
  });

  it('treats a response without a link as a failure, not a blank navigation', async () => {
    createSigningRequestSpy.mockResolvedValue({ data: {} });

    await openDocument();

    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not generate signing link.'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('opens one document at a time, however quickly the action is pressed', async () => {
    let release;
    createSigningRequestSpy.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ data: { requestId: 'req-1', accessToken: 'tok-1' } });
    }));

    const open = await submitAndFindOpenAction();
    fireEvent.click(open);
    fireEvent.click(open);
    fireEvent.click(open);

    await waitFor(() => expect(createSigningRequestSpy).toHaveBeenCalledTimes(1));
    expect(open).toBeDisabled();
    release();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(createSigningRequestSpy).toHaveBeenCalledTimes(1);
  });
});
