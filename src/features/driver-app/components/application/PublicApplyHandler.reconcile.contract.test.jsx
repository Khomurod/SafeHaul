/**
 * Contract freeze for the public application container — reconciling the local and server drafts.
 * Split from the 2203-line original on 2026-09-01 for the source-size
 * standard (PA-2); the shared harness lives in
 * PublicApplyHandler.contract.support.jsx, and every describe keeps its
 * original title so full test names are unchanged.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
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
  callableSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  profileOverride,
  saveProgressSpy,
  resumeDraftSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const {
  renderHandler,
} = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/**
 * Reconciling the two draft copies.
 *
 * There are two copies of an unfinished application on purpose: the local one is
 * the immediate backup for weak signal and failed saves, the server one is the
 * persistent primary. Restoring the server copy used to overwrite the local one
 * unconditionally, which destroyed the backup with the exact failure it exists to
 * survive.
 */
describe('reconciling the local and server drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileOverride.current = null;
    localStorage.clear();
    sessionStorage.clear();
    isQueueSupportedSpy.mockReturnValue(true);
    initQueueSpy.mockResolvedValue(undefined);
    callableSpy.mockResolvedValue({ data: {} });
    stubDraftCallables();
    // A token, so the same-device server restore path runs on load.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-1', applicantKey: 'key-1',
    }));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  /** Seeds an enveloped local draft at a chosen sync position. */
  function seedLocal({ data, lastStep = 2, localSeq, syncedSeq }) {  // eslint-disable-line no-unused-vars
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1, lastStep, meta: { localSeq, syncedSeq, savedAt: '2026-08-19T10:00:00.000Z' }, data,
    }));
  }

  function serverReturns({ formData, lastStep = 2, clientSeq }) {
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: { applicantKey: 'key-1', formData, lastStep, lastSemanticStep: 'license', clientSeq },
      },
    });
  }

  it('keeps newer local work when the server save had failed', async () => {
    // The reported case: the driver corrects their phone, the local copy saves,
    // the server save fails, they refresh. The old number used to come back.
    seedLocal({ data: { firstName: 'Ada', phone: '5551234' }, localSeq: 6, syncedSeq: 4 });
    serverReturns({ formData: { firstName: 'Ada', phone: '5550000' }, clientSeq: 4 });

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');

    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());
    // Advancing forces the current form data into a payload we can read.
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5551234');
  });

  it('presents the resume token with every save, so an update is authorized', async () => {
    // Without this the server refuses the update, because company id plus email
    // plus phone derive the document id and knowing them is not ownership.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].resumeToken).toBe('resume-token-1');
  });

  it('keeps an edit typed during the server fetch marked as unsynchronised', async () => {
    // The server fetch is a round trip, and an applicant can type through it. The
    // reconciler overlays that edit onto the result, so recording the whole merged
    // body as synced would claim the server holds an edit it has never seen — and
    // closing the tab there would hand the older server value back on the next
    // load, which is the silent loss this whole mechanism exists to prevent.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    let releaseServer;
    resumeDraftSpy.mockImplementation(() => new Promise((resolve) => {
      releaseServer = () => resolve({
        data: {
          restored: true,
          draft: {
            applicantKey: 'key-1',
            formData: { phone: '5551234' },
            lastStep: 2,
            lastSemanticStep: 'license',
            clientSeq: 9,
          },
        },
      });
    }));

    renderHandler();
    await screen.findByText('probe-edit');
    // Typed while the fetch is still outstanding.
    fireEvent.click(screen.getByText('probe-edit'));
    releaseServer();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.data.phone).toBe('5559999');
      // Owed to the server, not clean.
      expect(stored.meta.localSeq).toBeGreaterThan(stored.meta.syncedSeq);
      // ...and the synced position still names the server's own sequence, so a
      // later genuine advance from another device is still recognised.
      expect(stored.meta.syncedSeq).toBe(9);
    });
  });

  it('records a server-won copy as clean when it holds nothing extra', async () => {
    // The other direction: with no session edit and nothing local-only, the merged
    // body *is* the server's body, so it must be recorded as synced — otherwise the
    // next navigation writes server content out as unacknowledged local work.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 9 });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.meta.localSeq).toBe(9);
      expect(stored.meta.syncedSeq).toBe(9);
    });
  });

  it('adopts a newly minted token, so a corrected email does not orphan the browser', async () => {
    // The server mints a token only for a draft it just created. An applicant who
    // corrects their email therefore writes a *new* draft and gets a new token,
    // while the old draft is retired underneath them. Keeping the old token left
    // this browser holding a credential for a deleted document — cross-session
    // resume gone, and, now that changing an existing draft requires proof of
    // ownership, its background saves refused too.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });
    saveProgressSpy.mockResolvedValue({
      data: { saved: true, applicantKey: 'key-2', resumeToken: 'resume-token-2' },
    });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('apply_resume_acme'));
      expect(stored.resumeToken).toBe('resume-token-2');
      expect(stored.applicantKey).toBe('key-2');
    });
  });

  it('back navigation does not mark a fully synced copy as unsynced', async () => {
    // Navigation is not applicant information. Advancing the sequence on Back left
    // a synced copy permanently claiming unacknowledged work, and it would then
    // beat genuinely newer work from another device for the life of the draft.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4, lastStep: 3 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });

    renderHandler();
    await screen.findByText('probe-back');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-back'));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.meta.localSeq).toBe(stored.meta.syncedSeq);
    });
  });

  it('a newer server copy still wins after the applicant pressed Back', async () => {
    // The consequence of the bug above, from the driver's seat: they navigated on
    // one device while another device did real work.
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4, lastStep: 3 });
    serverReturns({ formData: { phone: '5559999' }, clientSeq: 9 });

    renderHandler();
    await screen.findByText('probe-back');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());
    fireEvent.click(screen.getByText('probe-back'));

    // Reload with the same inputs: the server copy must still be the newer one.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.meta.localSeq).toBe(stored.meta.syncedSeq);
    });
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5559999');
  });

  it('retries the server copy when the connection returns', async () => {
    // Next and "Save as Draft" are the only other triggers, so an applicant who
    // regained signal while sitting on a page kept their work locally and never
    // sent it.
    seedLocal({ data: { phone: '5551234' }, localSeq: 6, syncedSeq: 4, lastStep: 2 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());
    expect(saveProgressSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5551234');
  });

  it('does not retry on reconnect when nothing is owed', async () => {
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4, lastStep: 2 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    window.dispatchEvent(new Event('online'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });

  it('applies a server draft another device advanced', async () => {
    seedLocal({ data: { firstName: 'Ada', phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { firstName: 'Ada', phone: '5559999' }, clientSeq: 7 });

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');

    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5559999');
  });

  it('loses no field from either copy, whichever one wins', async () => {
    seedLocal({ data: { phone: '5551234', nickname: 'Slim' }, localSeq: 6, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5550000', cdlNumber: 'TX9' }, clientSeq: 4 });

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const { formData } = saveProgressSpy.mock.calls[0][0];
    expect(formData.phone).toBe('5551234');   // local won the overlap
    expect(formData.nickname).toBe('Slim');   // local-only survived
    expect(formData.cdlNumber).toBe('TX9');   // server-only survived
  });

  /**
   * The wiring proof for the nested-merge fix.
   *
   * `reconcileApplicationDraft.test.js` pins the merge itself, field class by field
   * class. These two assert the container actually *uses* it: a flat
   * `{...loser, ...winner}` spread passes every test above, because every value in
   * them is a scalar — and silently destroys a whole answer map or repeating list
   * the moment one exists on both sides.
   */
  it('merges nested answer maps instead of replacing them, when the server wins', async () => {
    seedLocal({
      data: { customAnswers: { q1: 'local one', q3: 'local three' } },
      localSeq: 4,
      syncedSeq: 4,
    });
    serverReturns({
      formData: { customAnswers: { q1: 'server one', q2: 'server two' } },
      clientSeq: 9,
    });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const { formData } = saveProgressSpy.mock.calls[0][0];
    // The server won, so it owns the overlapping key — and the answer only this
    // device has is still there. A flat spread would have dropped `q3`.
    expect(formData.customAnswers).toEqual({
      q1: 'server one', q2: 'server two', q3: 'local three',
    });
  });

  it('unions repeating rows instead of replacing them, when the local copy wins', async () => {
    seedLocal({
      data: { employers: [{ name: 'Local Freight' }] },
      localSeq: 6,
      syncedSeq: 4,
    });
    serverReturns({ formData: { employers: [{ name: 'Server Freight' }] }, clientSeq: 4 });

    renderHandler();
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const { formData } = saveProgressSpy.mock.calls[0][0];
    // Winner's rows first, then the rows only the loser had: an employment record
    // typed on one device is not deleted by a save from the other.
    expect(formData.employers).toEqual([{ name: 'Local Freight' }, { name: 'Server Freight' }]);
  });

  it('reconciles a legacy local draft on progress, since it has no sequence', async () => {
    // Already in real drivers' browsers, written before sync metadata existed.
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', phone: '5551234', lastStep: 6,
    }));
    serverReturns({ formData: { phone: '5550000' }, lastStep: 1, clientSeq: 3 });

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    // The local copy got further, so its values stand.
    expect(saveProgressSpy.mock.calls[0][0].formData.phone).toBe('5551234');
  });

  it('carries the write sequence to the server and records the confirmation', async () => {
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());

    // The sequence travels with the payload, and a successful save marks exactly
    // that write synced — which is what stops the next load preferring a stale copy.
    const sent = saveProgressSpy.mock.calls[0][0];
    expect(Number.isInteger(sent.clientSeq)).toBe(true);
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.meta.syncedSeq).toBe(sent.clientSeq);
    });
  });

  it('leaves the local copy unsynced when the save fails', async () => {
    seedLocal({ data: { phone: '5551234' }, localSeq: 4, syncedSeq: 4 });
    serverReturns({ formData: { phone: '5551234' }, clientSeq: 4 });
    saveProgressSpy.mockRejectedValue(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));

    renderHandler();
    // No intake chooser: a seeded `lastStep` restores straight into the wizard.
    await screen.findByText('probe-next');
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalled());

    // Real work, not just navigation — navigation alone must never mark a synced
    // copy as unsynchronised, which is what the Back-navigation fix is about.
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());

    // Unsynced is the whole point: the next load must prefer this copy.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('draft_acme'));
      expect(stored.meta.localSeq).toBeGreaterThan(stored.meta.syncedSeq);
    });
  });
});

