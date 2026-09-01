/**
 * Contract freeze for the public application container — starting over, and discards racing writes.
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
  showInfo,
  callableSpy,
  enqueueSpy,
  dequeueSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  generateIdSpy,
  profileOverride,
  saveProgressSpy,
  findResumableSpy,
  startNewSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler,
  chooseManualIntake,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

describe('starting over', () => {
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
    findResumableSpy.mockResolvedValue({ data: MATCH });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  async function openPrompt() {
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
    }));
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-next'));
    return screen.findByRole('dialog');
  }

  it('asks a second time before deleting anything', async () => {
    const dialog = await openPrompt();

    fireEvent.click(within(dialog).getByRole('button', { name: /Start a new application/i }));

    // Choosing "start a new application" is a request to be asked, not a
    // deletion: `ConfirmDialog` routes Escape to cancel, so making the discard
    // the cancel action would delete a driver's work on a stray keypress.
    await waitFor(() => expect(screen.getByRole('dialog').textContent)
      .toMatch(/Start a new application\?/));
    expect(startNewSpy).not.toHaveBeenCalled();
  });

  it('deletes only on the explicit confirmation', async () => {
    const dialog = await openPrompt();
    fireEvent.click(within(dialog).getByRole('button', { name: /Start a new application/i }));
    const confirm = await screen.findByRole('dialog');

    fireEvent.click(within(confirm).getByRole('button', { name: /Delete it and start over/i }));

    await waitFor(() => expect(startNewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', resumeToken: 'resume-token-1' }),
    ));
    // The local copy goes too, or the next reload restores what they just
    // asked to be rid of.
    await waitFor(() => expect(localStorage.getItem('draft_acme')).toBeNull());
  });

  it('saves the new application once the old one is discarded', async () => {
    const dialog = await openPrompt();
    fireEvent.click(within(dialog).getByRole('button', { name: /Start a new application/i }));
    const confirm = await screen.findByRole('dialog');
    expect(saveProgressSpy).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: /Delete it and start over/i }));

    // The payload held back by the resume question is the beginning of the new
    // application, so it is sent rather than dropped — and only after the delete,
    // so it cannot be superseded by the draft it replaces.
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));
    expect(startNewSpy.mock.invocationCallOrder[0])
      .toBeLessThan(saveProgressSpy.mock.invocationCallOrder[0]);
  });

  it('escaping the first dialog deletes nothing', async () => {
    const dialog = await openPrompt();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.getByRole('dialog').textContent)
      .toMatch(/Start a new application\?/));
    expect(startNewSpy).not.toHaveBeenCalled();
  });

  it('can be backed out of, keeping the saved application', async () => {
    const dialog = await openPrompt();
    fireEvent.click(within(dialog).getByRole('button', { name: /Start a new application/i }));
    const confirm = await screen.findByRole('dialog');

    fireEvent.click(within(confirm).getByRole('button', { name: /Keep my saved application/i }));

    await waitFor(() => expect(screen.getByRole('dialog').textContent)
      .toMatch(/Continue your existing application\?/));
    expect(startNewSpy).not.toHaveBeenCalled();
  });

  it('reports a failed discard rather than pretending it worked', async () => {
    startNewSpy.mockRejectedValue(Object.assign(new Error('nope'), { code: 'functions/internal' }));
    const dialog = await openPrompt();
    fireEvent.click(within(dialog).getByRole('button', { name: /Start a new application/i }));
    const confirm = await screen.findByRole('dialog');

    fireEvent.click(within(confirm).getByRole('button', { name: /Delete it and start over/i }));

    await waitFor(() => expect(screen.getByRole('dialog').textContent)
      .toMatch(/could not be removed/i));
    // And nothing local was cleared, so the applicant still has their answers.
    expect(localStorage.getItem('draft_acme')).not.toBeNull();
  });
});

/**
 * Two tabs, one application.
 *
 * Start Over deletes the server draft, the resume token and the local draft, and
 * `localStorage` is shared, so a tab that *reloads* afterwards already starts clean.
 * What used to survive was the other tab's **memory**: it still held the answers and
 * still believed it owned a draft, so its next navigation wrote them back to storage
 * and its next save recreated on the server the very application the applicant had
 * asked to be rid of.
 *
 * The other tab is simulated the way the browser does it — the discard mark appears
 * in `localStorage` and a `storage` event fires. Real browsers do not fire that event
 * in the tab that wrote the value, which is why the acting tab never resets itself.
 */
/**
 * Two tabs, one application.
 *
 * Start Over deletes the server draft, the resume token and the local draft, and
 * `localStorage` is shared, so a tab that *reloads* afterwards already starts clean.
 * What used to survive was the other tab's **memory**: it still held the answers and
 * still believed it owned a draft, so its next navigation wrote them back to storage
 * and its next save recreated on the server the very application the applicant had
 * asked to be rid of.
 *
 * The other tab is simulated the way the browser does it — the discard mark appears
 * in `localStorage` and a `storage` event fires. Real browsers do not fire that event
 * in the tab that wrote the value, which is why the acting tab never resets itself.
 */
describe('an application discarded in another tab', () => {
  const DISCARD_KEY = 'apply_discarded_acme';

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

  /** Exactly what another tab's Start Over leaves behind for this one to notice. */
  function discardInAnotherTab(mark = 'discard-1') {
    localStorage.removeItem('draft_acme');
    localStorage.removeItem('apply_resume_acme');
    localStorage.setItem(DISCARD_KEY, mark);
    window.dispatchEvent(new StorageEvent('storage', { key: DISCARD_KEY, newValue: mark }));
  }

  // (`renderRestoredTab`, the wrapper's other helper, lives only in the two
  // discard suites whose cases render a restored tab — none here do.)

  it('refuses to submit answers that were discarded elsewhere', async () => {
    // The most consequential place to miss a discard. A submission writes an
    // application and freezes an immutable snapshot, so letting the discarded answers
    // through here would make permanent exactly what the applicant deleted.
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z' },
      data: {
        firstName: 'Ada',
        lastName: 'Driver',
        email: 'ada@example.com',
        phone: '5555551234',
        ssn: '123-45-6789',
        'cdl-front': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
        'cdl-back': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
        'medical-card-upload': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
        signature: 'data:image/png;base64,AAAA',
        'final-certification': 'agreed',
      },
    }));
    renderHandler();
    await screen.findByText('probe-submit');

    // Discarded silently — no `storage` event, the case a suspended tab produces.
    localStorage.removeItem('draft_acme');
    localStorage.setItem(DISCARD_KEY, 'discard-before-submit');

    fireEvent.click(screen.getByText('probe-submit'));

    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(callableSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Application Submitted!')).not.toBeInTheDocument();
  });

  it('still records the discard when storage was full until the draft was cleared', async () => {
    // Ordering, and it is load-bearing. `startOver` has already removed the shared
    // resume token by this point, so the mark is the only thing left telling the other
    // tabs anything. Writing it while a large draft still fills the quota fails — and
    // then the other tab sees neither a token nor a changed mark, and its next save is
    // accepted as a token-less first save that recreates what was just deleted.
    findResumableSpy.mockResolvedValue({
      data: {
        resumable: true,
        resumeToken: 'resume-token-1',
        startedAt: '2026-08-14T09:00:00Z',
        lastSemanticStep: 'license',
      },
    });
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
    }));

    // Quota is exhausted for as long as the draft is still there.
    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (localStorage.getItem('draft_acme') !== null && key !== 'draft_acme') {
        throw new Error('QuotaExceededError');
      }
      realSetItem(key, value);
    });

    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-next'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a new application' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it and start over' }));

    await waitFor(() => expect(localStorage.getItem('draft_acme')).toBeNull());
    // The mark landed, because the draft was cleared first.
    await waitFor(() => expect(localStorage.getItem(DISCARD_KEY)).not.toBeNull());
    setItem.mockRestore();
  });

  it('drops its own queued save when the application is submitted', async () => {
    // Submission deletes the draft server-side, so anything still queued in this tab
    // must not be sent. Writing the discard mark is not enough on its own: this tab
    // *adopts* that mark, so its own staleness check stays false, and the queued
    // payload would go out token-less — which the server accepts as a first save,
    // creating a fresh unfinished draft for somebody who has just applied.
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada',
      lastName: 'Driver',
      email: 'ada@example.com',
      phone: '5555551234',
      ssn: '123-45-6789',
      'cdl-front': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      'cdl-back': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      'medical-card-upload': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      signature: 'data:image/png;base64,AAAA',
      'final-certification': 'agreed',
    }));

    // One autosave in flight, and another queued behind it.
    let releaseSave;
    saveProgressSpy.mockImplementation(() => new Promise((resolve) => {
      releaseSave = () => resolve({ data: { saved: true, applicantKey: 'key-1', resumeToken: 'token-1' } });
    }));

    renderHandler();
    await chooseManualIntake();
    // Two forward steps: the first save goes out and stays open, the second queues
    // behind it. No answer is edited, so the submission itself stays valid.
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('probe-next'));

    // Submit, then let the in-flight save land.
    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());
    releaseSave();

    // The queued payload was never sent.
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());
    expect(saveProgressSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves a submitted application completely alone', async () => {
    // The one place a late signal must do nothing: the success screen, the
    // confirmation number and the documents checklist are the only things in this
    // flow the applicant cannot get back.
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada',
      lastName: 'Driver',
      email: 'ada@example.com',
      phone: '5555551234',
      ssn: '123-45-6789',
      'cdl-front': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      'cdl-back': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      'medical-card-upload': { name: 'f.pdf', url: 'https://example.com/f.pdf' },
      signature: 'data:image/png;base64,AAAA',
      'final-certification': 'agreed',
    }));
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());

    discardInAnotherTab('discard-after-submit');

    // Still submitted, and not reset to a blank wizard.
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());
    expect(showInfo).not.toHaveBeenCalledWith(
      'That saved application was discarded in another tab. Starting fresh.',
    );
  });});
