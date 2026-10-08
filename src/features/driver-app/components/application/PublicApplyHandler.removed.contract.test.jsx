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
import { screen, waitFor, fireEvent } from '@testing-library/react';
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
  initQueueSpy,
  isQueueSupportedSpy,
  generateIdSpy,
  profileOverride,
  saveProgressSpy,
  resumeDraftSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, chooseManualIntake } = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

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

  it('leaves a restore that failed for any other reason as it was', async () => {
    resumeDraftSpy.mockRejectedValue(Object.assign(new Error('gone'), { code: 'functions/not-found' }));
    await renderTabHoldingTheApplication();

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBeNull());
    expect(screen.getByTestId('current-step')).toHaveTextContent('3');
    expect(showInfo).not.toHaveBeenCalledWith(REMOVED);
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
  });
});
