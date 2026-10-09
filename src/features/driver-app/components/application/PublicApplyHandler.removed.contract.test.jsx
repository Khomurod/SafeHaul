/**
 * Contract freeze for the public application container — an application its
 * company deleted (`functions/drafts/purge.js`).
 *
 * The server tells the holder of the deleted draft's token so, and nobody else:
 * a save answers `removed: true`, a restore answers `not-found` with
 * `details.reason: 'removed'`. The page then ends the application the way a
 * discard does, through a `removed:` mark every tab reads, but it also clears
 * answers typed in this tab: its saves made the application that was deleted.
 * The shared harness is in PublicApplyHandler.contract.support.jsx.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, fireEvent } from '@testing-library/react';
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
import {
  showInfo,
  callableSpy,
  enqueueSpy,
  dequeueSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  generateIdSpy,
  profileOverride,
  saveProgressSpy,
  resumeDraftSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler, renderWithCompleteDraft, chooseManualIntake, submit,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

const REMOVED = 'The company removed this unfinished application. You can start a new one.';
const MARK_KEY = 'apply_discarded_acme';
const TOKEN_KEY = 'apply_resume_acme';

const removedRefusal = () => Object.assign(new Error('That saved application could not be found.'), {
  code: 'functions/not-found',
  details: { reason: 'removed' },
});

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
  generateIdSpy.mockImplementation(async () => 'generated-app-id');
  stubDraftCallables();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** A tab holding this application's token and a stored copy of it, at step 3. */
async function renderTabHoldingTheApplication() {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ resumeToken: 'token-old', applicantKey: 'key-old' }));
  localStorage.setItem('draft_acme', JSON.stringify({
    v: 1,
    lastStep: 3,
    meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-10-08T10:00:00.000Z' },
    data: { firstName: 'Ada', email: 'ada@example.com', phone: '5551234567' },
  }));
  renderHandler();
  await screen.findByText('probe-next');
}

/** The restore on load, for a tab holding the application's token. */
const RESTORED = { data: { restored: true, draft: {
  applicantKey: 'key-old', formData: { firstName: 'Ada', email: 'ada@example.com', phone: '5551234567' }, lastStep: 3, clientSeq: 4,
} } };
const REMOVED_SAVE = { data: { saved: false, removed: true, applicantKey: null, resumeToken: null } };
const toldRemoved = () => showInfo.mock.calls.filter(([message]) => message === REMOVED).length;
const heldToken = () => JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')?.resumeToken;
const announce = (mark) => {
  localStorage.setItem(MARK_KEY, mark);
  window.dispatchEvent(new StorageEvent('storage', { key: MARK_KEY, newValue: mark }));
};

/** Ended as a discard is, but for every answer, with the true reason. */
async function expectEnded() {
  await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
  expect(showInfo).toHaveBeenCalledWith(REMOVED);
  expect(localStorage.getItem('draft_acme')).toBeNull();
  expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  expect(localStorage.getItem(MARK_KEY)).toMatch(/^removed:/);
}

describe('an application its company deleted', () => {
  it('ends in the tab whose save is told so', async () => {
    resumeDraftSpy.mockResolvedValue({ data: { restored: true, draft: {
      applicantKey: 'key-old', formData: { firstName: 'Ada', email: 'ada@example.com', phone: '5551234567' }, lastStep: 3, clientSeq: 4,
    } } });
    saveProgressSpy.mockResolvedValue({ data: { saved: false, removed: true, applicantKey: null, resumeToken: null } });
    await renderTabHoldingTheApplication();

    fireEvent.click(screen.getByText('probe-next'));

    await expectEnded();
  });

  it('ends in the tab whose restore on load is told so', async () => {
    resumeDraftSpy.mockRejectedValue(removedRefusal());
    await renderTabHoldingTheApplication();

    await expectEnded();
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('clears answers typed in this tab too, unlike a discard elsewhere', async () => {
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-edit'));

    localStorage.setItem(MARK_KEY, 'removed:mark-1');
    window.dispatchEvent(new StorageEvent('storage', { key: MARK_KEY, newValue: 'removed:mark-1' }));

    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(showInfo).toHaveBeenCalledWith(REMOVED);
  });

  it('acts once: a late refusal for the token it gave up leaves the new application alone', async () => {
    let refuseRestore;
    resumeDraftSpy.mockImplementation(() => new Promise((_resolve, reject) => {
      refuseRestore = () => reject(removedRefusal());
    }));
    let saves = 0;
    saveProgressSpy.mockImplementation(async () => {
      saves += 1;
      return saves === 1 ? REMOVED_SAVE : { data: { saved: true, applicantKey: 'key-new', resumeToken: 'token-new' } };
    });
    await renderTabHoldingTheApplication();

    fireEvent.click(screen.getByText('probe-next'));
    await expectEnded();
    const mark = localStorage.getItem(MARK_KEY);
    // The driver starts again, and the new application saves under a token of its own.
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(heldToken()).toBe('token-new'));

    // The restore sent on load, with the old token, is refused only now.
    refuseRestore();

    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(toldRemoved()).toBe(1);
    expect(localStorage.getItem(MARK_KEY)).toBe(mark);
    expect(heldToken()).toBe('token-new');
    expect(screen.getByTestId('current-step')).toHaveTextContent('1');
  });

  it('catches up on the mark another tab wrote first, rather than writing a second', async () => {
    resumeDraftSpy.mockResolvedValue(RESTORED);
    let answerSave;
    saveProgressSpy.mockImplementation(() => new Promise((resolve) => { answerSave = () => resolve(REMOVED_SAVE); }));
    await renderTabHoldingTheApplication();
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());

    // Another tab was told while this save was out; this one has not read its mark.
    localStorage.setItem(MARK_KEY, 'removed:first');
    answerSave();

    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(toldRemoved()).toBe(1);
    expect(localStorage.getItem(MARK_KEY)).toBe('removed:first');
  });

  it('takes a queued submission off its screen, since the queue will not send it', async () => {
    callableSpy.mockRejectedValue(new Error('offline'));
    await renderWithCompleteDraft();
    await submit();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Not sent yet' })).toBeInTheDocument(), {
      timeout: 10_000,
    });

    announce('removed:mark-1');

    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Not sent yet' })).not.toBeInTheDocument();
    expect(toldRemoved()).toBe(1);
  }, 20_000);

  it('leaves a queued submission on its screen for a discard elsewhere, as before', async () => {
    callableSpy.mockRejectedValue(new Error('offline'));
    await renderWithCompleteDraft();
    await submit();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Not sent yet' })).toBeInTheDocument(), {
      timeout: 10_000,
    });

    announce('discard:mark-1');

    // Nothing to wait for when nothing should happen: let React render whatever
    // the event set, then look.
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50); }));
    expect(screen.getByRole('heading', { name: 'Not sent yet' })).toBeInTheDocument();
    expect(showInfo).not.toHaveBeenCalled();
  }, 20_000);

  it('leaves a restore that failed for any other reason as it was', async () => {
    resumeDraftSpy.mockRejectedValue(Object.assign(new Error('gone'), { code: 'functions/not-found' }));
    await renderTabHoldingTheApplication();

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBeNull());
    expect(screen.getByTestId('current-step')).toHaveTextContent('3');
    expect(showInfo).not.toHaveBeenCalledWith(REMOVED);
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
  });
});
