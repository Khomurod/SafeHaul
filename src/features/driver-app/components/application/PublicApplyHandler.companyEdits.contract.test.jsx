/**
 * Contract for the public application container — a Company Admin's edits.
 *
 * The carrier can edit an application the driver is filling in. The driver's page
 * takes those edits on load, on a refused save and on a refused submission, tells
 * the driver which answers changed, and never signs or sends a copy that is behind
 * them; see `companyEditsSync.js`. The shared harness is
 * `PublicApplyHandler.contract.support.jsx`; the wizard is a probe that shows the
 * answers these cases are about.
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
// The shared probe, plus what these cases read: the answers the carrier edits,
// the notice, whether the copy is signed, and a way to sign it again.
vi.mock('@shared/components/layout/Stepper', async () => {
  const probe = (await import('./PublicApplyHandler.contract.support')).stepperMock();
  const Probe = probe.default;
  return {
    ...probe,
    default: (props) => (
      <div>
        <Probe {...props} />
        <span data-testid="first-name">{props.formData.firstName || ''}</span>
        <span data-testid="employers">{JSON.stringify(props.formData.employers || [])}</span>
        <span data-testid="notice">{JSON.stringify(props.formData._companyNotice || [])}</span>
        <span data-testid="signed">{props.formData.signature ? 'signed' : 'unsigned'}</span>
        <button type="button" onClick={() => props.updateFormData('signature', 'data:image/png;base64,BBBB')}>probe-sign</button>
      </div>
    ),
  };
});

import { PublicApplyHandler } from './PublicApplyHandler';
import {
  callableSpy,
  dequeueSpy,
  enqueueSpy,
  findResumableSpy,
  generateIdSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  profileOverride,
  resumeDraftSpy,
  saveProgressSpy,
  showError,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, renderWithCompleteDraft, chooseManualIntake, submit } = makeRenderers({
  PublicApplyHandler, MemoryRouter, Route, Routes,
});

/** A revision is the edit's time in milliseconds. */
const R = 1791300000000;
const OLD_ROW = ['Acme', '214-555-0100'];
const CORRECTED_ROW = ['Acme', '214-555-0199'];
const REVIEW_STEP = '7';
const CARRIER_UPDATED = Object.assign(
  new Error('Your carrier updated your application after this page loaded. Check the changes on the Review page, then sign again.'),
  {
    code: 'functions/failed-precondition',
    details: { issues: [{ code: 'carrier-updated', semanticStep: 'review', fieldId: null }] },
  },
);

/** The server copy as `resumeApplicationDraft` answers it. */
const draftReply = (formData, { companyRevision = 0, companyEdits = {} } = {}) => ({
  data: {
    restored: true,
    draft: {
      applicantKey: 'key-1', formData, lastStep: 2, lastSemanticStep: 'license', clientSeq: 4,
      companyRevision, companyEdits,
    },
  },
});

/** Each call answered in turn, the last answer repeating. No `*Once` queue. */
const inTurn = (spy, ...answers) => {
  let calls = 0;
  spy.mockImplementation(async () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  });
};

const seedLocal = (data, { localSeq = 4, syncedSeq = 4 } = {}) => {
  localStorage.setItem('draft_acme', JSON.stringify({
    v: 1, lastStep: 2, meta: { localSeq, syncedSeq, savedAt: '2026-08-19T10:00:00.000Z' }, data,
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  profileOverride.current = null;
  localStorage.clear();
  sessionStorage.clear();
  isQueueSupportedSpy.mockReturnValue(true);
  initQueueSpy.mockResolvedValue(undefined);
  enqueueSpy.mockResolvedValue('queue-1');
  dequeueSpy.mockResolvedValue(undefined);
  callableSpy.mockResolvedValue({ data: { applicationId: 'app-1', confirmationNumber: 'CONF-1' } });
  generateIdSpy.mockImplementation(async () => 'generated-app-id');
  stubDraftCallables();
  // This browser's own draft, so its saves and the edits fetch carry a token.
  localStorage.setItem('apply_resume_acme', JSON.stringify({ resumeToken: 'resume-token-1', applicantKey: 'key-1' }));
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('a Company Admin\'s edits, on the driver\'s page', () => {
  it('are taken on load, named, and said by the next save', async () => {
    seedLocal({ firstName: 'Ada', employers: [OLD_ROW] });
    inTurn(resumeDraftSpy, draftReply(
      { firstName: 'Adah', employers: [CORRECTED_ROW] },
      { companyRevision: R, companyEdits: { firstName: R, employers: R } },
    ));

    renderHandler();
    await waitFor(() => expect(screen.getByTestId('first-name')).toHaveTextContent('Adah'));
    // Replaced, not merged: the driver's older row does not come back beside it.
    expect(screen.getByTestId('employers')).toHaveTextContent(JSON.stringify([CORRECTED_ROW]));
    expect(screen.getByTestId('notice')).toHaveTextContent('["employers","firstName"]');

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalled());
    const sent = saveProgressSpy.mock.calls[0][0];
    expect(sent.seenRevision).toBe(R);
    expect(sent.formData.employers).toEqual([CORRECTED_ROW]);
    expect(sent.formData).not.toHaveProperty('_companyRevision');
    expect(sent.formData).not.toHaveProperty('_companyNotice');
  });

  it('are fetched when a save is refused for them, and the next save is current', async () => {
    seedLocal({ firstName: 'Ada' });
    inTurn(
      resumeDraftSpy,
      draftReply({ firstName: 'Ada' }),
      draftReply({ firstName: 'Adah' }, { companyRevision: R, companyEdits: { firstName: R } }),
    );
    inTurn(
      saveProgressSpy,
      { data: { saved: false, companyUpdated: true, applicantKey: null, resumeToken: null } },
      { data: { saved: true, applicantKey: 'key-1', resumeToken: null } },
    );

    renderHandler();
    await waitFor(() => expect(resumeDraftSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('probe-edit'));
    fireEvent.click(screen.getByText('probe-next'));

    await waitFor(() => expect(screen.getByTestId('first-name')).toHaveTextContent('Adah'));
    expect(saveProgressSpy.mock.calls[0][0].seenRevision).toBe(0);
    expect(screen.getByTestId('notice')).toHaveTextContent('["firstName"]');

    fireEvent.click(screen.getByText('probe-next'));
    await waitFor(() => expect(saveProgressSpy).toHaveBeenCalledTimes(2));
    expect(saveProgressSpy.mock.calls[1][0].seenRevision).toBe(R);
    expect(saveProgressSpy.mock.calls[1][0].formData).toMatchObject({ firstName: 'Adah', phone: '5559999' });
  });

  it('send a submission back to Review, unsigned, when they change an answer', async () => {
    inTurn(
      resumeDraftSpy,
      { data: { restored: false } },
      draftReply({ firstName: 'Adah' }, { companyRevision: R, companyEdits: { firstName: R } }),
    );
    inTurn(callableSpy, CARRIER_UPDATED, { data: { applicationId: 'app-1', confirmationNumber: 'CONF-1' } });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent(REVIEW_STEP));
    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(CARRIER_UPDATED.message);
    expect(screen.getByTestId('first-name')).toHaveTextContent('Adah');
    expect(screen.getByTestId('signed')).toHaveTextContent('unsigned');
    expect(screen.getByTestId('notice')).toHaveTextContent('["firstName"]');

    // Signed again over the carrier's answers, the submission is current.
    fireEvent.click(screen.getByText('probe-sign'));
    await submit();
    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(2));
    expect(callableSpy.mock.calls[1][0]).toMatchObject({ seenRevision: R });
    expect(callableSpy.mock.calls[1][0].formData.firstName).toBe('Adah');
    // Said once, beside the answers, and never sent or queued as one.
    expect(callableSpy.mock.calls[1][0].formData).not.toHaveProperty('_companyRevision');
    expect(callableSpy.mock.calls[1][0].formData).not.toHaveProperty('_companyNotice');
    expect(enqueueSpy.mock.calls.at(-1)[0]).not.toHaveProperty('_companyNotice');
  });

  it('let a submission through at once when none of them changes an answer', async () => {
    inTurn(
      resumeDraftSpy,
      { data: { restored: false } },
      draftReply({ firstName: 'Ada' }, { companyRevision: R, companyEdits: { firstName: R } }),
    );
    inTurn(callableSpy, CARRIER_UPDATED, { data: { applicationId: 'app-1', confirmationNumber: 'CONF-1' } });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(2));
    expect(callableSpy.mock.calls[0][0].seenRevision).toBe(0);
    expect(callableSpy.mock.calls[1][0].seenRevision).toBe(R);
    expect(showError).not.toHaveBeenCalledWith(CARRIER_UPDATED.message);
  });

  it('still let it through when they arrive on the last of the three attempts', async () => {
    inTurn(
      resumeDraftSpy,
      { data: { restored: false } },
      draftReply({ firstName: 'Ada' }, { companyRevision: R, companyEdits: { firstName: R } }),
    );
    inTurn(
      callableSpy,
      new Error('offline'),
      new Error('offline'),
      CARRIER_UPDATED,
      { data: { applicationId: 'app-1', confirmationNumber: 'CONF-1' } },
    );

    await renderWithCompleteDraft();
    await submit();

    // The retry for the edits is not one of the three: nothing went wrong with delivery.
    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(4), { timeout: 10_000 });
    expect(callableSpy.mock.calls[3][0].seenRevision).toBe(R);
    expect(showError).not.toHaveBeenCalled();
  }, 20_000);

  it('never stop a submission when they cannot be fetched', async () => {
    inTurn(resumeDraftSpy, { data: { restored: false } }, new Error('offline'));
    inTurn(callableSpy, CARRIER_UPDATED, { data: { applicationId: 'app-1', confirmationNumber: 'CONF-1' } });

    await renderWithCompleteDraft();
    await submit();

    // What the driver signed is what is on screen, so it goes as signed.
    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(2));
    expect(callableSpy.mock.calls[1][0].seenRevision).toBeNull();
    expect(callableSpy.mock.calls[1][0].signature).toBe('data:image/png;base64,AAAA');
  });

  it('are all named when the driver continues their application on a new device', async () => {
    localStorage.removeItem('apply_resume_acme');
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Ada', lastName: 'Driver', email: 'ada@example.com', phone: '5555551234',
    }));
    findResumableSpy.mockResolvedValue({ data: {
      resumable: true, resumeToken: 'resume-token-1', startedAt: '2026-08-14T09:00:00Z', lastSemanticStep: 'license',
    } });
    inTurn(resumeDraftSpy, draftReply(
      { firstName: 'Adah', employers: [CORRECTED_ROW] },
      { companyRevision: R, companyEdits: { employers: R } },
    ));

    renderHandler();
    await chooseManualIntake();
    fireEvent.click(screen.getByText('probe-next'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Continue where I left off/i }));

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('["employers"]'));
    expect(JSON.parse(localStorage.getItem('draft_acme')).data._companyRevision).toBe(R);
  });
});
