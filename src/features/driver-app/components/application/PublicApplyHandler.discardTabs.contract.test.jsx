/**
 * Contract freeze for the public application container — discards observed by an idle or restoring tab.
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
  profileGate,
  saveProgressSpy,
  findResumableSpy,
  startNewSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler,
  renderWithCompleteDraft,
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

  it('stops showing the discarded answers', async () => {
    const step = await renderRestoredTab();
    expect(step).toHaveTextContent('3');

    discardInAnotherTab();

    // Back to the screen a first-time visitor gets: the wizard holding the
    // discarded answers is gone, not merely rewound.
    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(screen.queryByTestId('current-step')).not.toBeInTheDocument();
    expect(showInfo).toHaveBeenCalledWith(
      'That saved application was discarded in another tab. Starting fresh.',
    );
    // And nothing was written back on the way out.
    expect(localStorage.getItem('draft_acme')).toBeNull();
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('says submitted, not discarded, when that is what happened', async () => {
    // Both cases delete the same three things, and a tab reacting to either sees only
    // a changed mark. Telling an applicant who has just successfully applied that
    // their application was discarded is misinformation about the one action they
    // cannot undo, so the mark carries which it was.
    const step = await renderRestoredTab();
    expect(step).toHaveTextContent('3');

    discardInAnotherTab('submit:mark-1');

    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(showInfo).toHaveBeenCalledWith(
      'That application was submitted in another tab. Starting fresh.',
    );
  });

  it('abandons a submission discarded while it was in flight', async () => {
    // Between the guard at the top of the submit and the callable there is an id
    // generation, a queue write and, on a retry, a backoff wait. A discard landing in
    // that window used to get through, because the reaction exempts a submission in
    // flight so that it cannot wipe one that has landed.
    let releaseId;
    generateIdSpy.mockImplementation(() => new Promise((resolve) => {
      releaseId = () => resolve('generated-app-id');
    }));
    await renderWithCompleteDraft();

    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(generateIdSpy).toHaveBeenCalled());
    // Discarded while this tab waits for its application id.
    localStorage.setItem(DISCARD_KEY, 'discard:mid-flight');
    releaseId();

    // No application was created, the queue entry that was written for guaranteed
    // delivery is gone, and the applicant is told.
    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(callableSpy).not.toHaveBeenCalled();
    expect(dequeueSpy).toHaveBeenCalledWith('queue-1');
    expect(screen.queryByText('Application Submitted!')).not.toBeInTheDocument();
  });

  it('abandons a submission when the discard arrives as a real event', async () => {
    // The event path, not the silent one, and they are not the same: an event delivered
    // while a submission is in flight is *exempted* — the reaction must not wipe one
    // that has landed — and that exemption adopts the new mark, so a comparison made
    // afterwards reads clean. Only the reset counter still remembers.
    let releaseId;
    generateIdSpy.mockImplementation(() => new Promise((resolve) => {
      releaseId = () => resolve('generated-app-id');
    }));
    await renderWithCompleteDraft();

    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(generateIdSpy).toHaveBeenCalled());
    discardInAnotherTab('discard:mid-flight-event');
    releaseId();

    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(callableSpy).not.toHaveBeenCalled();
    expect(dequeueSpy).toHaveBeenCalledWith('queue-1');
    expect(screen.queryByText('Application Submitted!')).not.toBeInTheDocument();
  });

  it('does not promise a queued submission that will never be sent', async () => {
    // The discard lands while the last attempt is still out, so the loop exits by
    // rejection rather than through the pre-attempt check. Showing the queued screen
    // then would have the applicant waiting for a submission the replay guard is going
    // to refuse.
    let rejectLast;
    let attempts = 0;
    callableSpy.mockImplementation(() => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new Error('offline'));
      return new Promise((_resolve, reject) => { rejectLast = () => reject(new Error('offline')); });
    });
    await renderWithCompleteDraft();

    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(attempts).toBe(3), { timeout: 5000 });
    discardInAnotherTab('discard:during-last-attempt');
    rejectLast();

    await waitFor(() => expect(showInfo).toHaveBeenCalled());
    expect(screen.queryByText(/submitted automatically/i)).not.toBeInTheDocument();
    expect(dequeueSpy).toHaveBeenCalledWith('queue-1');
  });

  it('stamps a queued entry with the mark from before the submission began', async () => {
    // The abort dequeues, but a dequeue can fail — its catch says so out loud. What
    // makes that failure harmless is the baseline the entry carries: if it recorded the
    // *adopted* mark, the replay would find nothing changed and send the discarded
    // answers hours later.
    let releaseId;
    generateIdSpy.mockImplementation(() => new Promise((resolve) => {
      releaseId = () => resolve('generated-app-id');
    }));
    await renderWithCompleteDraft();

    fireEvent.click(screen.getByText('probe-submit'));
    await waitFor(() => expect(generateIdSpy).toHaveBeenCalled());
    // Arrives as a real event, so the in-flight exemption adopts it.
    discardInAnotherTab('discard:during-submit');
    releaseId();

    await waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      // Null: nothing had been discarded when the applicant pressed Submit.
      expect.objectContaining({ applyDiscardMark: null }),
    );
  });

  it('does not restore a draft discarded before its listener existed', async () => {
    // A mark written between this tab's first render and the effect that installs the
    // listener: no event is delivered, so the reset counter never moves. The mark this
    // tab loaded with is still the evidence.
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z', draftId: 'draft-a' },
      data: { firstName: 'Ada', phone: '5551234' },
    }));

    let releaseProfile;
    profileGate.current = new Promise((resolve) => { releaseProfile = resolve; });
    renderHandler();

    // No `storage` event at all, and the stored copy survives — the case a Start Over
    // from a tab holding no name of its own produces.
    localStorage.setItem(DISCARD_KEY, 'discard:no-event');
    releaseProfile();
    profileGate.current = null;

    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(screen.queryByTestId('current-step')).not.toBeInTheDocument();
  });

  it('leaves another application in the slot alone when it starts over', async () => {
    // `startOver` awaits the server, and another tab can write a different application
    // into the shared slot while it does. That draft is unsent work.
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
      meta: { localSeq: 2, syncedSeq: 2, savedAt: '2026-08-19T10:00:00.000Z', draftId: 'draft-mine' },
      data: { firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234' },
    }));
    // The other tab's application lands during the server round trip.
    startNewSpy.mockImplementation(async () => {
      localStorage.setItem('draft_acme', JSON.stringify({
        v: 1,
        lastStep: 0,
        meta: { localSeq: 1, syncedSeq: 0, savedAt: null, draftId: 'draft-theirs' },
        data: { firstName: 'Someone else' },
      }));
      return { data: { discarded: true } };
    });

    renderHandler();
    await screen.findByText('probe-next');
    fireEvent.click(screen.getByText('probe-next'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a new application' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it and start over' }));

    await waitFor(() => expect(showInfo).toHaveBeenCalledWith('Starting a new application.'));
    expect(localStorage.getItem('draft_acme')).toContain('draft-theirs');
  });

  it('keeps a named slot when it started over without a local draft of its own', async () => {
    // Reachable when this tab's own local writes are refused — a full quota — so it
    // reaches the resume prompt having stored nothing and holding no name. Having none
    // is not a licence to clear somebody else's, which is what the arm this pins did.
    findResumableSpy.mockResolvedValue({
      data: {
        resumable: true,
        resumeToken: 'resume-token-1',
        startedAt: '2026-08-14T09:00:00Z',
        lastSemanticStep: 'license',
      },
    });

    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    let refuseDraftWrites = true;
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (refuseDraftWrites && key === 'draft_acme') throw new Error('QuotaExceededError');
      realSetItem(key, value);
    });
    // The other tab's application lands while the server call is in flight.
    startNewSpy.mockImplementation(async () => {
      refuseDraftWrites = false;
      realSetItem('draft_acme', JSON.stringify({
        v: 1,
        lastStep: 0,
        meta: { localSeq: 1, syncedSeq: 0, savedAt: null, draftId: 'draft-theirs' },
        data: { firstName: 'Someone else' },
      }));
      return { data: { discarded: true } };
    });

    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-next'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a new application' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it and start over' }));

    await waitFor(() => expect(showInfo).toHaveBeenCalledWith('Starting a new application.'));
    expect(localStorage.getItem('draft_acme')).toContain('draft-theirs');
    setItem.mockRestore();
  });

  it('does not restore a draft discarded while the page was still loading', async () => {
    // The narrowest window in the flow: the mark arrives before the profile does, so the
    // reaction runs with nothing on screen to reset — and adopts the mark, which makes
    // every later guard read clean. Restoring afterwards would put the discarded answers
    // up with nothing left to notice.
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1,
      lastStep: 3,
      meta: { localSeq: 4, syncedSeq: 4, savedAt: '2026-08-19T10:00:00.000Z', draftId: 'draft-a' },
      data: { firstName: 'Ada', phone: '5551234' },
    }));

    let releaseProfile;
    profileGate.current = new Promise((resolve) => { releaseProfile = resolve; });
    renderHandler();

    // Discarded while the profile is still in flight — and the stored copy survives,
    // which is the case that matters: a Start Over from a tab holding no name of its own
    // leaves a named slot alone, so the draft is still sitting there to be restored.
    const mark = 'discard:while-loading';
    localStorage.setItem(DISCARD_KEY, mark);
    window.dispatchEvent(new StorageEvent('storage', { key: DISCARD_KEY, newValue: mark }));
    releaseProfile();
    profileGate.current = null;

    // The intake chooser, not a wizard holding the discarded answers.
    await waitFor(() => expect(screen.getByText('Fill Out Manually')).toBeInTheDocument());
    expect(screen.queryByTestId('current-step')).not.toBeInTheDocument();
  });

  it('does not name the answers it keeps after the ended application', async () => {
    // The kept answers are becoming a new application — the toast says so — so they
    // must not be written under the name of the one that just ended, or a queued
    // submission for it would later delete them.
    // Typed here, never restored — the keep branch. Its own first write names the
    // application, and that is the name that must not survive the discard.
    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(localStorage.getItem('draft_acme')).not.toBeNull());
    const firstName = JSON.parse(localStorage.getItem('draft_acme')).meta.draftId;
    expect(firstName).toBeTruthy();

    discardInAnotherTab();

    await waitFor(() => expect(showInfo).toHaveBeenCalledWith(
      'The saved application was discarded in another tab. Your answers here will start a new one.',
    ));
    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(localStorage.getItem('draft_acme')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('draft_acme')).meta.draftId).not.toBe(firstName);
  });
});
