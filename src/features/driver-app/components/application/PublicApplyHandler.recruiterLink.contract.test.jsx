/**
 * Contract for the public application container — a recruiter's personal link.
 *
 * `/apply/<slug>?r=<code>` (or `?recruiter=<uid>` from older links) assigns the
 * driver to that recruiter when they submit. The code travels in the answers as
 * `recruiterCode`, so it stays with an application the driver saves and continues
 * later — in a new session on this browser, from a continuation link, or on
 * another device matched by identity — and the submission sends it from there.
 * The link clicked last names the recruiter, as it names the referral.
 * One of the container's contract suites; the shared harness lives in
 * PublicApplyHandler.contract.support.jsx. All fixtures are artificial.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Every registration delegates to the shared support module, so the harness
// lives once; `vi.mock` is hoisted per file, which is why each suite repeats
// this block (see the support header, and the `CA-3` deadlock rule it cites).
vi.mock('@/context/DataContext', async () => (await import('./PublicApplyHandler.contract.support')).dataContextMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./PublicApplyHandler.contract.support')).toastProviderMock());
vi.mock('@shared/components/feedback', async () => (await import('./PublicApplyHandler.contract.support')).feedbackMock());
vi.mock('@lib/firebase', async () => (await import('./PublicApplyHandler.contract.support')).libFirebaseMock());
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/runtime/e2eMode', async () => (await import('./PublicApplyHandler.contract.support')).e2eModeMock());
vi.mock('@lib/submissionQueue', async () => (await import('./PublicApplyHandler.contract.support')).submissionQueueMock());
vi.mock('@lib/applicationId', async () => (await import('./PublicApplyHandler.contract.support')).applicationIdMock());
vi.mock('../../services/publicProfileService', async () => (await import('./PublicApplyHandler.contract.support')).publicProfileServiceMock());
vi.mock('./postApplyDocsStorage', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).postApplyDocsStorageMock(await importOriginal()));
vi.mock('react-router-dom', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).reactRouterDomMock(await importOriginal()));
vi.mock('@shared/components/layout/Stepper', async () => (await import('./PublicApplyHandler.contract.support')).stepperMock());

import { PublicApplyHandler } from './PublicApplyHandler';
import {
  callableSpy,
  exchangeInviteSpy,
  findResumableSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  profileOverride,
  resumeDraftSpy,
  saveProgressSpy,
  SIGNED_DRAFT,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, chooseManualIntake, submit } = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/** The recruiter code the submission sent, once it has been sent. */
async function submittedRecruiterCode() {
  await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
  return callableSpy.mock.calls[0][0].formData.recruiterCode;
}

/** What the local copy holds, once "Finish later" has written it. */
async function finishLater() {
  fireEvent.click(screen.getByText('probe-save-draft'));
  let stored;
  await waitFor(() => {
    stored = JSON.parse(localStorage.getItem('draft_acme'));
    expect(stored?.data).toBeTruthy();
  });
  return stored;
}

/** A complete application the server kept, as another device or session gets it back. */
const serverDraft = (formData, lastStep = 7) => ({
  data: {
    restored: true,
    draft: { applicantKey: 'applicant-key-1', formData, lastStep, lastSemanticStep: 'review', clientSeq: 4 },
  },
});

/** Page one typed on another device, then the first Next, which asks whether to continue. */
async function typePageOneElsewhereAndContinue(query = '') {
  localStorage.setItem('draft_acme', JSON.stringify({
    firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
  }));
  renderHandler(query);
  await chooseManualIntake();
  fireEvent.click(screen.getByText('probe-next'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /Continue where I left off/i }));
  await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('7'));
}

const MATCH = {
  resumable: true,
  resumeToken: 'resume-token-1',
  startedAt: '2026-08-14T09:00:00Z',
  lastSemanticStep: 'review',
};

describe('a recruiter\'s personal link names the recruiter until the application is submitted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileOverride.current = null;
    localStorage.clear();
    sessionStorage.clear();
    isQueueSupportedSpy.mockReturnValue(true);
    initQueueSpy.mockResolvedValue(undefined);
    callableSpy.mockResolvedValue({ data: {} });
    stubDraftCallables();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([
    ['r', '?r=link-1', 'link-1'],
    ['recruiter', '?recruiter=FROM-LONG', 'FROM-LONG'],
  ])('keeps the `%s` code in the answers, which the local copy and every server save carry', async (_name, query, code) => {
    renderHandler(query);
    await chooseManualIntake();

    expect((await finishLater()).data.recruiterCode).toBe(code);
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls.at(-1)[0].formData.recruiterCode).toBe(code);
  });

  it('still names the recruiter when the driver reopens the plain link in a later session', async () => {
    // Saved by an earlier visit through `?r=link-1`; this tab never saw the link.
    localStorage.setItem('draft_acme', JSON.stringify({ ...SIGNED_DRAFT, recruiterCode: 'link-1' }));
    renderHandler();
    await chooseManualIntake();
    await submit();

    expect(await submittedRecruiterCode()).toBe('link-1');
  });

  it('names the recruiter of the link opened last', async () => {
    localStorage.setItem('draft_acme', JSON.stringify({ ...SIGNED_DRAFT, recruiterCode: 'link-1' }));
    renderHandler('?r=link-2');
    await chooseManualIntake();
    await submit();

    expect(await submittedRecruiterCode()).toBe('link-2');
  });

  it('sends no recruiter when no link ever named one', async () => {
    localStorage.setItem('draft_acme', JSON.stringify(SIGNED_DRAFT));
    renderHandler();
    await chooseManualIntake();
    await submit();

    expect(await submittedRecruiterCode()).toBeNull();
  });

  it('still names the recruiter after a continuation link brings back the server copy', async () => {
    // This browser holds the draft's own token, so the link asks nothing.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-1', applicantKey: 'applicant-key-1',
    }));
    exchangeInviteSpy.mockResolvedValue({ data: { opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1' } });
    resumeDraftSpy.mockResolvedValue(serverDraft({ ...SIGNED_DRAFT, recruiterCode: 'link-1' }));

    renderHandler('?invite=invite-token-2&k=applicant-key-1');
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('7'));
    await submit();

    expect(await submittedRecruiterCode()).toBe('link-1');
  });

  it('still names the recruiter after another device continues the application by identity', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    resumeDraftSpy.mockResolvedValue(serverDraft({ ...SIGNED_DRAFT, recruiterCode: 'link-1' }));

    await typePageOneElsewhereAndContinue();
    await submit();

    expect(await submittedRecruiterCode()).toBe('link-1');
  });

  it('names the recruiter of the link opened on the other device, and owes the server that change', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    resumeDraftSpy.mockResolvedValue(serverDraft({ ...SIGNED_DRAFT, recruiterCode: 'link-1' }));

    await typePageOneElsewhereAndContinue('?r=link-2');

    const stored = JSON.parse(localStorage.getItem('draft_acme'));
    expect(stored.data.recruiterCode).toBe('link-2');
    // Not the server's copy any more, so not recorded as synced with it.
    expect(stored.meta.localSeq).toBeGreaterThan(stored.meta.syncedSeq);

    await submit();
    expect(await submittedRecruiterCode()).toBe('link-2');
  });
});
