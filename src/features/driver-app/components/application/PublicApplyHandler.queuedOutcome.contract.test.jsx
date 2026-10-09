/**
 * The end of a submission the page queued, on the page that queued it.
 *
 * The queue sends from this device only, and often after the page stopped
 * waiting. When it ends, the page that shows that application takes it up:
 * sent, the confirmation number and the forms that follow, as a direct
 * submission; refused, the server's sentence and the page to fix, by the
 * company's settings as they are now; whichever tab of the site the queue ran
 * in. An end that came while no page was open is said when the page is next
 * opened. A rate limit on the direct attempt is said there and then, never
 * queued.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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
import { QUEUED_APPLICATION_EVENT } from './queuedApplicationOutcome';
import {
  showError,
  callableSpy,
  enqueueSpy,
  dequeueSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  updateQueueEntrySpy,
  queuedEntries,
  generateIdSpy,
  profileOverride,
  savePostApplySessionSpy,
  SIGNED_DRAFT,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, submit } = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/** This page's application, by its draft's name, resuming on the Consent step. */
async function renderNamedDraft() {
  localStorage.setItem('draft_acme', JSON.stringify({
    v: 1,
    lastStep: 8,
    meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-10-09T10:00:00.000Z', draftId: 'draft-x' },
    data: SIGNED_DRAFT,
  }));
  renderHandler();
  await screen.findByText('probe-submit');
}

/** Every direct attempt fails to reach the server, so the page shows it queued. */
async function queueIt() {
  callableSpy.mockRejectedValue(new Error('offline'));
  await submit();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Not sent yet' })).toBeInTheDocument(), { timeout: 10_000 });
}

const announce = (detail) => act(() => {
  window.dispatchEvent(new CustomEvent(QUEUED_APPLICATION_EVENT, { detail: { slug: 'acme', entryId: 'queue-1', ...detail } }));
});

beforeEach(() => {
  vi.clearAllMocks();
  profileOverride.current = null;
  queuedEntries.current = [];
  localStorage.clear();
  sessionStorage.clear();
  isQueueSupportedSpy.mockReturnValue(true);
  initQueueSpy.mockResolvedValue(undefined);
  enqueueSpy.mockResolvedValue('queue-1');
  dequeueSpy.mockResolvedValue(undefined);
  callableSpy.mockResolvedValue({ data: {} });
  generateIdSpy.mockImplementation(async () => 'generated-app-id');
  stubDraftCallables();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('a submission the page queued', () => {
  it('is handed to the queue once every direct attempt has failed', async () => {
    await renderNamedDraft();
    await queueIt();
    expect(updateQueueEntrySpy).toHaveBeenCalledWith('queue-1', { nextRetryAt: expect.any(Number) });
  }, 20_000);

  it('shows its confirmation number once the queue has sent it', async () => {
    await renderNamedDraft();
    await queueIt();

    announce({ outcome: 'sent', applyDraftId: 'draft-x', applicationId: 'app-9', confirmationNumber: 'CONF-9' });

    expect(await screen.findByRole('heading', { name: 'Application Submitted!' })).toBeInTheDocument();
    expect(screen.getByText('CONF-9')).toBeInTheDocument();
    expect(sessionStorage.getItem('lastConfirmationNumber')).toBe('CONF-9');
  }, 20_000);

  it('shows its confirmation number when the queue sent it from another tab, and keeps it in this one', async () => {
    await renderNamedDraft();
    await queueIt();

    // The queue ran in another tab of the site: its news comes through storage.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'safehaul:queued-application',
        newValue: JSON.stringify({
          slug: 'acme', companyId: 'company-1', entryId: 'queue-1', outcome: 'sent',
          applyDraftId: 'draft-x', applicationId: 'app-9', confirmationNumber: 'CONF-9',
        }),
      }));
    });

    expect(await screen.findByRole('heading', { name: 'Application Submitted!' })).toBeInTheDocument();
    expect(screen.getByText('CONF-9')).toBeInTheDocument();
    // This tab's own copy, so a reload here comes back to the same screen.
    expect(savePostApplySessionSpy).toHaveBeenCalledWith('company-1', {
      applicationId: 'app-9', confirmationNumber: 'CONF-9', slug: 'acme', docs: {},
    });
  }, 20_000);

  it('comes back to the page a refusal names, in the server\'s words, and is not kept for later', async () => {
    await renderNamedDraft();
    await queueIt();

    announce({
      outcome: 'refused',
      applyDraftId: 'draft-x',
      message: "The application does not meet this carrier's requirements: Complete the Hours of Service statement.",
      issues: [{ code: 'hours-of-service-required', semanticStep: 'general', fieldId: 'hosDailyHours' }],
    });

    // 6 = General Questions, with no questions of the company's own.
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('6'));
    expect(screen.queryByRole('heading', { name: 'Not sent yet' })).toBeNull();
    expect(showError).toHaveBeenCalledWith("The application does not meet this carrier's requirements: Complete the Hours of Service statement.");
    expect(dequeueSpy).toHaveBeenCalledWith('queue-1');
  }, 20_000);

  it('takes the company\'s current settings with a refusal, as a direct refusal does', async () => {
    await renderNamedDraft();
    await queueIt();
    // The company added a question of its own while this waited, and the server
    // judged the settings as they are now: the page it names is one step later.
    profileOverride.current = { customQuestions: [{ id: 'q1', label: 'Years driving', type: 'text' }] };

    announce({
      outcome: 'refused',
      applyDraftId: 'draft-x',
      message: 'Acknowledge every agreement before submitting.',
      issues: [{ code: 'agreements', semanticStep: 'consent', fieldId: null }],
    });

    // 9 = Consent once the company's questions are a step of their own; 8 without.
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('9'));
    expect(showError).toHaveBeenCalledWith('Acknowledge every agreement before submitting.');
  }, 20_000);

  it('says to submit again when the queue ran out of attempts', async () => {
    await renderNamedDraft();
    await queueIt();

    announce({ outcome: 'failed', applyDraftId: 'draft-x' });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Not sent yet' })).toBeNull());
    expect(showError).toHaveBeenCalledWith('Your application could not be sent. Check your connection, then press Submit again.');
  }, 20_000);

  it('leaves the page alone for an application that is not the one on screen', async () => {
    await renderNamedDraft();
    await queueIt();

    announce({ outcome: 'sent', applyDraftId: 'draft-other', applicationId: 'app-1', confirmationNumber: 'CONF-1' });

    expect(screen.getByRole('heading', { name: 'Not sent yet' })).toBeInTheDocument();
    expect(screen.queryByText('CONF-1')).toBeNull();
  }, 20_000);
});

describe('an end that came while no page was open', () => {
  it('is said when the page is next opened, and taken out of the queue', async () => {
    queuedEntries.current = [{
      id: 'queue-old',
      applySlug: 'acme',
      applyDraftId: 'draft-x',
      applyDiscardMark: null,
      status: 'refused',
      createdAt: 1,
      data: {},
      refusal: {
        message: 'Missing required uploaded documents: CDL Front.',
        issues: [{ code: 'missing-upload', semanticStep: 'license', fieldId: null }],
      },
    }];

    await renderNamedDraft();

    // 2 = License, where the upload is made.
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('2'));
    expect(showError).toHaveBeenCalledWith('Missing required uploaded documents: CDL Front.');
    expect(dequeueSpy).toHaveBeenCalledWith('queue-old');
  });
});

describe('a rate limit on the direct attempt', () => {
  it('is said in the server\'s words, and nothing waits in the queue for it', async () => {
    const limited = Object.assign(new Error('Too many submissions. Please try again in a minute.'), {
      code: 'functions/resource-exhausted',
    });
    callableSpy.mockRejectedValue(limited);
    await renderNamedDraft();

    await submit();

    await waitFor(() => expect(showError).toHaveBeenCalledWith('Too many submissions. Please try again in a minute.'));
    // More attempts would meet the same limit.
    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(dequeueSpy).toHaveBeenCalledWith('queue-1');
    expect(screen.queryByRole('heading', { name: 'Not sent yet' })).toBeNull();
  });
});
