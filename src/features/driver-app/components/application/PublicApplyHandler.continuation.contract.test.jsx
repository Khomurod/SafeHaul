/**
 * The reported bug, as a test: a replacement link must not open a fresh application.
 *
 * ## What was measured in production on 2026-09-09
 *
 * A carrier-prepared application for a driver who had reached the consent step. The
 * recruiter pressed "Create a replacement link"; the driver opened it; the page
 * rendered **"How would you like to start your driver application?"** with
 * "Upload CDL for Auto-Fill" and "Fill Out Manually" — the fresh-application
 * chooser — and no mention of the application they had spent an hour on. The
 * exchange returned 200 both times they tried.
 *
 * The cause was on this side of the wire: `exchangeApplicationInvite` answers
 * `requiresIdentity` once the answers behind a link are the driver's own, that
 * outcome matched no branch in `resolveApplyStatusScreen`, and the chooser is what
 * sits at the bottom of that function. The code comment standing in for the missing
 * screen claimed the driver "is asked for their details by the ordinary resume flow
 * underneath" — a flow that only triggers on the first Next of page one, inside the
 * blank application the chooser had just started.
 *
 * So the first case here is written as the negative the report describes, and the
 * rest are the outcomes a driver actually needs: their answers back, their step
 * back, and a way forward when the details genuinely do not match.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  exchangeInviteSpy,
  resumeDraftSpy,
  saveProgressSpy,
  isQueueSupportedSpy,
  initQueueSpy,
  callableSpy,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler } = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/** A replacement link in the URL, naming the application it opens. */
const LINK = '?invite=invite-token-2&k=applicant-key-1';

/** The reply for a link whose application the driver has already taken over. */
const NEEDS_IDENTITY = { data: { opened: true, requiresIdentity: true, applicantKey: 'applicant-key-1' } };

/** The reply once the claim has been verified against that same draft. */
const CONTINUED = {
  data: {
    opened: true,
    requiresIdentity: false,
    applicantKey: 'applicant-key-1',
    resumeToken: 'resume-token-9',
    formData: {
      firstName: 'Dana',
      lastName: 'Alvarez',
      email: 'dana@example.test',
      phone: '5555550143',
      cdlNumber: 'DRIVER-OWN-4471',
    },
    lastStep: 5,
    lastSemanticStep: 'employment',
    clientSeq: 7,
    lockedEmployers: [],
    preparedBy: null,
  },
};

/** Every field the confirmation screen asks for, filled in. */
function fillTheClaim() {
  fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: 'Alvarez' } });
  fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: '1988-03-11' } });
  fireEvent.change(screen.getByLabelText(/Social Security Number/i), { target: { value: '123-45-6789' } });
  fireEvent.change(screen.getByLabelText(/Email or phone number/i), { target: { value: 'dana@example.test' } });
}

const confirmButton = () => screen.getByRole('button', { name: /Continue my application/i });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  isQueueSupportedSpy.mockReturnValue(true);
  initQueueSpy.mockResolvedValue(undefined);
  callableSpy.mockResolvedValue({ data: {} });
  stubDraftCallables();
});

describe('a replacement link for a driver who already started', () => {
  it('does NOT open the fresh-application chooser', async () => {
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);

    renderHandler(LINK);

    // The whole of the reported symptom, asserted as an absence.
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    expect(screen.queryByText('Fill Out Manually')).not.toBeInTheDocument();
    expect(screen.queryByText(/How would you like to start/i)).not.toBeInTheDocument();
  });

  it('says which company the application belongs to', async () => {
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);

    renderHandler(LINK);

    expect(await screen.findByText(/already started an application for Acme Freight/i))
      .toBeInTheDocument();
  });

  it('returns the driver to the same application, at the step they left', async () => {
    exchangeInviteSpy.mockImplementation(async (payload) => (
      payload?.identity ? CONTINUED : NEEDS_IDENTITY.data && NEEDS_IDENTITY
    ));

    renderHandler(LINK);
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    fillTheClaim();
    fireEvent.click(confirmButton());

    // The wizard, not the chooser, and not page one.
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('5'));
    expect(screen.queryByText('Fill Out Manually')).not.toBeInTheDocument();

    // The claim went to the server; the client never decides.
    const [claimed] = exchangeInviteSpy.mock.calls.at(-1);
    expect(claimed.identity).toEqual({
      lastName: 'Alvarez',
      dob: '1988-03-11',
      ssn: '123-45-6789',
      contact: 'dana@example.test',
    });
    // The same link, not a new one: a confirmation is a second exchange of the
    // token the driver already holds.
    expect(claimed.inviteToken).toBe('invite-token-2');
  });

  it('adopts the resume token, or the driver’s own autosave is refused from here on', async () => {
    exchangeInviteSpy.mockImplementation(async (payload) => (payload?.identity ? CONTINUED : NEEDS_IDENTITY));

    renderHandler(LINK);
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    fillTheClaim();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('5'));

    expect(JSON.parse(localStorage.getItem('apply_resume_acme'))).toMatchObject({
      resumeToken: 'resume-token-9',
      applicantKey: 'applicant-key-1',
    });
  });

  it('keeps the screen up with the server’s sentence when the details do not match', async () => {
    exchangeInviteSpy.mockImplementation(async (payload) => {
      if (!payload?.identity) return NEEDS_IDENTITY;
      throw Object.assign(new Error('Those details do not match this application.'), {
        code: 'functions/permission-denied',
      });
    });

    renderHandler(LINK);
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    fillTheClaim();
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/do not match this application/i)).toBeInTheDocument();
    // Still the confirmation screen, and still not a fresh application: somebody
    // who mistyped a date needs to try again, not to start over.
    expect(screen.getByRole('heading', { name: /Confirm it’s you/i })).toBeInTheDocument();
    expect(screen.queryByText('Fill Out Manually')).not.toBeInTheDocument();
  });

  it('spends no attempt on a claim that is obviously incomplete', async () => {
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);

    renderHandler(LINK);
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: 'Alvarez' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText('Enter your date of birth.')).toBeInTheDocument();
    // One call: the open. The rate-limited callable is not asked a question the
    // browser can already answer.
    expect(exchangeInviteSpy).toHaveBeenCalledTimes(1);
  });

  it('lets the driver start a new application instead, as a decision they make', async () => {
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);

    renderHandler(LINK);
    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    fireEvent.click(screen.getByRole('button', { name: /Start a new application instead/i }));

    // Now — and only now — the chooser.
    expect(await screen.findByText('Fill Out Manually')).toBeInTheDocument();
  });

  it('asks nothing at all when this browser already holds the draft’s token', async () => {
    // The commonest case by far: the driver clicks their replacement link on the
    // same phone they started on. Asking them to retype their Social Security
    // Number to see work that is already restored on screen would be asking a
    // question we know the answer to.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-1', applicantKey: 'applicant-key-1',
    }));
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: {
          applicantKey: 'applicant-key-1',
          formData: { firstName: 'Dana', lastName: 'Alvarez', cdlNumber: 'DRIVER-OWN-4471' },
          lastStep: 5,
          lastSemanticStep: 'employment',
          clientSeq: 7,
        },
      },
    });

    renderHandler(LINK);

    await waitFor(() => expect(screen.getByTestId('current-step')).toHaveTextContent('5'));
    expect(screen.queryByRole('heading', { name: /Confirm it’s you/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Fill Out Manually')).not.toBeInTheDocument();
  });

  it('still asks when this browser holds a DIFFERENT applicant’s token', async () => {
    // A shared browser at a truck stop. The previous applicant's leftovers must
    // not be merged into the application this link named, and must not be taken
    // as evidence that the person holding the link is the person who owns it.
    localStorage.setItem('apply_resume_acme', JSON.stringify({
      resumeToken: 'resume-token-other', applicantKey: 'somebody-else',
    }));
    exchangeInviteSpy.mockResolvedValue(NEEDS_IDENTITY);
    resumeDraftSpy.mockResolvedValue({
      data: {
        restored: true,
        draft: {
          applicantKey: 'somebody-else',
          formData: { firstName: 'Marcus', lastName: 'Iyer', cdlNumber: 'NOT-DANAS' },
          lastStep: 2,
        },
      },
    });

    renderHandler(LINK);

    await screen.findByRole('heading', { name: /Confirm it’s you/i });
    // And nothing of theirs was written back under this application's name.
    expect(saveProgressSpy).not.toHaveBeenCalled();
  });
});

describe('a link that will not open at all', () => {
  it('still says so, and still offers the way forward it always did', async () => {
    // Unchanged behaviour, asserted here because the identity screen now sits in
    // the same position: a dead link must not be mistaken for a request to
    // confirm anything, and the chooser must still not be a silent fallback.
    exchangeInviteSpy.mockImplementation(async () => {
      throw Object.assign(new Error('nope'), { code: 'functions/not-found' });
    });

    renderHandler(LINK);

    await screen.findByRole('heading', { name: /This link could not be opened/i });
    expect(screen.queryByRole('heading', { name: /Confirm it’s you/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Fill Out Manually')).not.toBeInTheDocument();
  });
});
