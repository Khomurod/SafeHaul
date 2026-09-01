/**
 * Contract freeze for the public application container — per-step progress saves and the continue-existing flow.
 * Split from the 2203-line original on 2026-09-01 for the source-size
 * standard (PA-2); the shared harness lives in
 * PublicApplyHandler.contract.support.jsx, and every describe keeps its
 * original title so full test names are unchanged.
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
  initQueueSpy,
  isQueueSupportedSpy,
  profileOverride,
  saveProgressSpy,
  findResumableSpy,
  resumeDraftSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler,
  chooseManualIntake,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/**
 * Autosave, resume and start-over.
 *
 * The rule every one of these protects: **saving must never be able to stop an
 * applicant.** The feature exists because drivers on bad connections were losing
 * everything they had typed, so a version of it that blocks them on a bad
 * connection would be a worse bargain than not having it.
 */
describe('progress is saved as the applicant advances', () => {
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

  async function openWizard(draft = { firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234' }) {
    localStorage.setItem('draft_acme', JSON.stringify(draft));
    renderHandler();
    await chooseManualIntake();
  }

  it('saves to the server on every forward step', async () => {
    await openWizard();

    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const [payload] = saveProgressSpy.mock.calls[0];
    expect(payload.companyId).toBe('company-1');
    expect(payload.lastStep).toBe(1);
    expect(payload.lastSemanticStep).toBe('qualifications');
  });

  it('does not spend a save on going backwards', async () => {
    await openWizard();
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('probe-back'));

    // Going back is not new information, and a save per Back click would spend
    // the applicant's rate-limit budget on nothing.
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));
  });

  it('writes the local copy first, so a failed server save loses nothing visible', async () => {
    saveProgressSpy.mockRejectedValue(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
    await openWizard();

    fireEvent.click(screen.getByText('probe-next'));

    // The step advanced and the local draft holds the step, despite the server
    // call failing. The applicant is never told, because there is nothing they
    // could do and nothing was lost.
    await waitFor(() => expect(screen.getByTestId('current-step').textContent).toBe('1'));
    expect(JSON.parse(localStorage.getItem('draft_acme')).lastStep).toBe(1);
    expect(showError).not.toHaveBeenCalled();
  });

  it('records the step when the applicant saves a draft explicitly', async () => {
    await openWizard();

    fireEvent.click(screen.getByText('probe-save-draft'));

    // `lastStep` was omitted here, so an explicit save recorded the answers and
    // forgot the page — and the restore path ignored the field anyway.
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Progress saved.'));
    expect(JSON.parse(localStorage.getItem('draft_acme'))).toHaveProperty('lastStep');
    expect(saveProgressSpy).toHaveBeenCalled();
  });

  it('restores the saved step on a revisit, not just the answers', async () => {
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', lastStep: 4,
    }));
    renderHandler();

    // Restoring the answers and then showing page one made a returning applicant
    // click Next past forms that were already filled in, which reads as
    // "nothing was saved".
    await waitFor(() => expect(screen.getByTestId('current-step').textContent).toBe('4'));
  });

  it('never sends a signature to the draft callable', async () => {
    await openWizard({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
      signature: 'data:image/png;base64,AAAA',
    });

    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const [payload] = saveProgressSpy.mock.calls[0];
    // Stripped three times over: the local draft never persists it, the hook
    // removes it from what is transmitted, and the server removes it again on
    // arrival. A signature is a biometric with no part in a draft.
    expect(JSON.stringify(payload.formData)).not.toContain('data:image');
    expect(payload.formData).not.toHaveProperty('signature');
    expect(payload.formData).not.toHaveProperty('ssn');
  });
});

describe('continuing an existing application', () => {
  const MATCH = {
    resumable: true,
    resumeToken: 'resume-token-1',
    startedAt: '2026-08-14T09:00:00Z',
    lastSemanticStep: 'license',
  };

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

  async function openAndAdvance() {
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
    }));
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-next'));
  }

  it('offers to continue after the first forward step', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    await openAndAdvance();

    // The identity a resume is matched on is collected on page one, so the first
    // Next is the first moment there is anything to match.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Continue your existing application\?/);
  });

  it('says when the application was started and nothing else about it', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    await openAndAdvance();
    const dialog = await screen.findByRole('dialog');

    // Recognised is not identified: the matching bar is a bar, and whatever this
    // dialog says is said to whoever cleared it.
    expect(dialog.textContent).toMatch(/August 14/);
    expect(dialog.textContent).not.toMatch(/ada@example\.com/);
    expect(dialog.textContent).not.toMatch(/Ada/);
  });

  it('asks only once, however many times Next is clicked', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    await openAndAdvance();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('probe-next'));
    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(findResumableSpy).toHaveBeenCalledTimes(1));
  });

  it('does not ask when nothing matches', async () => {
    findResumableSpy.mockResolvedValue({ data: { resumable: false } });
    await openAndAdvance();

    await waitFor(() => expect(findResumableSpy).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the applicant carry on when the lookup fails', async () => {
    findResumableSpy.mockRejectedValue(new Error('offline'));
    await openAndAdvance();

    await waitFor(() => expect(screen.getByTestId('current-step').textContent).toBe('1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restores the answers and the step on Continue', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: {
          applicantKey: 'key-9',
          formData: { firstName: 'Ada', cdlNumber: 'D9988776' },
          lastStep: 2,
          lastSemanticStep: 'license',
        },
      },
    });
    await openAndAdvance();
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /Continue where I left off/i }));

    await waitFor(() => expect(screen.getByTestId('current-step').textContent).toBe('2'));
    expect(showSuccess).toHaveBeenCalledWith('Your saved application has been restored.');
    // Written straight back locally, so a reload does not fall back to a staler
    // draft than the one just restored. The answers now sit under `data`, beside
    // the sync metadata that lets the two copies be reconciled.
    const stored = JSON.parse(localStorage.getItem('draft_acme'));
    expect(stored.data.cdlNumber).toBe('D9988776');
    // And it is recorded as already synced, because it *is* the server's copy:
    // marking it as unacknowledged work would make the next load prefer it over a
    // server draft that had genuinely moved on.
    expect(stored.meta.localSeq).toBe(stored.meta.syncedSeq);
  });

  it('writes nothing to the server while the resume question is unanswered', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    await openAndAdvance();
    await screen.findByRole('dialog');

    // The load-bearing ordering. A save racing the lookup is how the draft the
    // applicant came back for gets lost: it overwrites `lastStep` with page one
    // when the email matches, and the server's at-most-one-draft rule hard-deletes
    // the older draft when it does not.
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('does not overwrite the restored draft with what was typed before it', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: {
          applicantKey: 'key-9',
          formData: { firstName: 'Ada', cdlNumber: 'D9988776' },
          lastStep: 2,
          lastSemanticStep: 'license',
        },
      },
    });
    await openAndAdvance();
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /Continue where I left off/i }));
    await waitFor(() => expect(screen.getByTestId('current-step').textContent).toBe('2'));

    // The queued payload predates the restore and holds page one. Sending it
    // would put the applicant back at the start of the draft they just reopened.
    expect(saveProgressSpy).not.toHaveBeenCalled();

    // The next forward step saves normally, from the restored answers.
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));
    expect(saveProgressSpy.mock.calls[0][0].formData.cdlNumber).toBe('D9988776');
  });

  it('saves the newest step when saves overlap', async () => {
    findResumableSpy.mockResolvedValue({ data: { resumable: false } });
    let release;
    saveProgressSpy.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ data: { saved: true, applicantKey: 'key-1', resumeToken: null } });
    }));
    await openAndAdvance();
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('probe-next'));
    fireEvent.click(screen.getByText('probe-next'));
    release();

    // An overlapping save used to be dropped outright, which quietly lost the
    // last step of a fast clicker — and the last step before someone abandons the
    // form is the one worth having.
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(2));
    expect(saveProgressSpy.mock.calls[1][0].lastStep).toBe(3);
  });

  it('keeps the dialog open with a message when the restore fails', async () => {
    findResumableSpy.mockResolvedValue({ data: MATCH });
    resumeDraftSpy.mockRejectedValue(Object.assign(new Error('gone'), { code: 'functions/not-found' }));
    await openAndAdvance();
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /Continue where I left off/i }));

    // The applicant asked for something specific; silently continuing without it
    // would look like their answers had been lost a second time.
    await waitFor(() => expect(screen.getByRole('dialog').textContent)
      .toMatch(/could not be opened/i));
  });
});

/**
 * Reconciling the two draft copies.
 *
 * There are two copies of an unfinished application on purpose: the local one is
 * the immediate backup for weak signal and failed saves, the server one is the
 * persistent primary. Restoring the server copy used to overwrite the local one
 * unconditionally, which destroyed the backup with the exact failure it exists to
 * survive.
 */
