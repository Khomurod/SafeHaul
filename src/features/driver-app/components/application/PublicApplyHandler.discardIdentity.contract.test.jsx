/**
 * Contract freeze for the public application container — a draft's identity across discards, submissions and the queue.
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
  resumeDraftSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler,
  chooseManualIntake,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

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

  /** Renders a tab whose answers came out of the stored draft. */
  async function renderRestoredTab() {
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z' },
      data: { firstName: 'Ada', phone: '5551234' },
    }));
    renderHandler();
    await screen.findByText('probe-next');
    return screen.getByTestId('current-step');
  }

  it('leaves another application in the slot alone when it submits', async () => {
    // Two tabs, two different applications for the same page — reachable exactly
    // because a discard elsewhere lets a tab keep what it typed and start a new one.
    // Submitting here must not delete the other tab's unsent backup.
    const named = (draftId, firstName) => JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z', draftId },
      data: {
        firstName,
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
    });
    localStorage.setItem('draft_acme', named('draft-a', 'Ada'));
    renderHandler();
    await screen.findByText('probe-submit');

    // The other tab writes its own application over the slot.
    localStorage.setItem('draft_acme', named('draft-b', 'Someone else'));

    fireEvent.click(screen.getByText('probe-submit'));
    await screen.findByText('Application Submitted!');

    // Their work is still there, and they are still told what happened.
    expect(localStorage.getItem('draft_acme')).toContain('draft-b');
    expect(localStorage.getItem(DISCARD_KEY)).toMatch(/^submit:/);
  });

  it('does not name the next application after the one just discarded', async () => {
    // Start Over ends an application, so the next draft must not inherit its name — a
    // queued submission still holding that name would otherwise take the new draft for
    // the one it submitted and delete it.
    findResumableSpy.mockResolvedValue({
      data: {
        resumable: true,
        resumeToken: 'resume-token-1',
        startedAt: '2026-08-14T09:00:00Z',
        lastSemanticStep: 'license',
      },
    });
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 1,
      meta: { localSeq: 2, syncedSeq: 2, savedAt: '2026-08-19T10:00:00.000Z', draftId: 'draft-old' },
      data: { firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234' },
    }));

    // A stored `lastStep` opens straight into the wizard — the intake chooser is for
    // somebody who has not started.
    renderHandler();
    await screen.findByText('probe-next');
    fireEvent.click(screen.getByText('probe-next'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a new application' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it and start over' }));
    await waitFor(() => expect(localStorage.getItem('draft_acme')).toBeNull());

    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(localStorage.getItem('draft_acme')).not.toBeNull());
    expect(localStorage.getItem('draft_acme')).not.toContain('draft-old');
  });

  it('carries the name of the draft it submitted into the offline queue', async () => {
    // The entry outlives the tab that made it, and by the time a replay lands another
    // tab's application may occupy this slug. The name is what lets the close tell
    // them apart, so it has to reach the queue.
    callableSpy.mockRejectedValue(new Error('offline'));
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z', draftId: 'draft-x' },
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

    fireEvent.click(screen.getByText('probe-submit'));

    await waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ applySlug: 'acme', applyDraftId: 'draft-x' }),
    );
  });

  it('does not carry the discarded answers into the fresh start', async () => {
    await renderRestoredTab();
    discardInAnotherTab();
    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());

    // Starting again from the chooser: page one, and the next save carries none of
    // the restored answers.
    fireEvent.click(screen.getByText('Fill Out Manually'));
    await screen.findByText('probe-next');
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');

    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const { formData } = saveProgressSpy.mock.calls[0][0];
    expect(formData.firstName).toBeUndefined();
    expect(formData.phone).toBe('5559999');
  });

  it('keeps answers the applicant typed in this tab, and starts a new application with them', async () => {
    // This tab never restored anything, so what is on screen is the applicant's own
    // work. Destroying it because another tab discarded a *different* copy would be
    // the data loss this whole feature exists to prevent.
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-edit'));

    discardInAnotherTab();

    await waitFor(() => expect(showInfo).toHaveBeenCalledWith(
      'The saved application was discarded in another tab. Your answers here will start a new one.',
    ));
    // Still on the page they were on, with what they typed.
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');

    // And the next step saves it as a *new* application rather than dropping it.
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5559999');
    // With no token, because the discarded draft's token is gone.
    expect(saveProgressSpy.mock.calls[0][0].resumeToken).toBeNull();
  });

  it('refuses to write even if the event never arrived', async () => {
    // A tab that was suspended, or an event lost: the mark comparison before every
    // write is what makes this deterministic rather than dependent on the event.
    await renderRestoredTab();

    localStorage.removeItem('draft_acme');
    localStorage.setItem(DISCARD_KEY, 'discard-silent');

    fireEvent.click(screen.getByText('probe-next'));

    // The guard fires on the navigation itself, so the same reset happens.
    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(localStorage.getItem('draft_acme')).toBeNull();
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('drops a save that was already queued when the discard landed', async () => {
    // The delayed case. One save is in flight, a second queues behind it, and the
    // discard happens while the first is still open — so the queued payload is
    // composed against an application that no longer exists by the time its turn
    // comes.
    let releaseFirstSave;
    saveProgressSpy.mockImplementation(() => new Promise((resolve) => {
      releaseFirstSave = () => resolve({ data: { saved: true, applicantKey: 'key-1', resumeToken: 'token-1' } });
    }));

    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(1));

    // A second navigation queues behind the open request.
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));

    discardInAnotherTab();
    releaseFirstSave();

    // The queued payload is never sent.
    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(saveProgressSpy).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the connection returns after a discard', async () => {
    await renderRestoredTab();
    // Dirty local copy, the state the reconnect flush exists for.
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 9, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z' },
      data: { firstName: 'Ada', phone: '5559999' },
    }));

    localStorage.setItem(DISCARD_KEY, 'discard-offline');
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('fetches the server draft once, not once per render', async () => {
    // A guard against the shape of mistake this change nearly shipped. The discard
    // callbacks close over `showInfo`, which `ToastProvider` rebuilds every render,
    // so naming them as dependencies of the reconciliation effect turned a
    // load-once fetch into a per-render one — re-reading the draft and rewriting the
    // local copy on a loop. It surfaced as a *sequence* being one too high, three
    // files away from the cause.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-1', applicantKey: 'key-1',
    }));
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 2,
      meta: { localSeq: 5, syncedSeq: 5, savedAt: '2026-08-19T10:00:00.000Z' },
      data: { phone: '5551234' },
    }));
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: {
          applicantKey: 'key-1',
          formData: { phone: '5551234' },
          lastStep: 2,
          lastSemanticStep: 'license',
          clientSeq: 5,
        },
      },
    });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    // Navigation only — no answer changes — so nothing here may dirty the copy or
    // re-fetch anything.
    fireEvent.click(screen.getByText('probe-back'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(screen.getByTestId('current-step')).toBeInTheDocument());

    expect(resumeDraftSpy).toHaveBeenCalledTimes(1);
    // And the restored copy is still recorded as synced. This is the assertion that
    // actually caught the loop: each re-run reconciled again and wrote the result
    // back as *unacknowledged* work, one sequence above the server's.
    const stored = JSON.parse(localStorage.getItem('draft_acme'));
    expect(stored.meta.localSeq).toBe(stored.meta.syncedSeq);
  });

  it('does not write the server copy back after a discard mid-fetch', async () => {
    // The subtlest writer of the four. Fetching the server draft is a round trip and
    // the discard can land while it is open: the read succeeded, so nothing failed,
    // and reconciliation would then write the discarded answers back into storage
    // *after* the reset had cleared them — ready to be restored on the next load.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-1', applicantKey: 'key-1',
    }));
    let releaseServer;
    resumeDraftSpy.mockImplementation(() => new Promise((resolve) => {
      releaseServer = () => resolve({
        data: {
          restored: true,
          draft: {
            applicantKey: 'key-1',
            formData: { firstName: 'Ada', cdlNumber: 'FROM-SERVER' },
            lastStep: 3,
            lastSemanticStep: 'license',
            clientSeq: 9,
          },
        },
      });
    }));

    renderHandler();
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    // Discarded while the fetch is still open, then the fetch completes.
    discardInAnotherTab('discard-mid-fetch');
    releaseServer();

    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    // Nothing of the server copy reached storage.
    const stored = localStorage.getItem('draft_acme');
    expect(stored === null || !stored.includes('FROM-SERVER')).toBe(true);
  });
});
