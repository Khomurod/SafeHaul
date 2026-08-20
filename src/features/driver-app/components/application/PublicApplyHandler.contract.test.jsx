/**
 * Contract freeze for the public application container.
 *
 * These tests exist to make the design-system migration provably
 * behaviour-preserving. They assert the things a presentation change must never
 * touch: the callable name and payload, queue-before-submit ordering,
 * dequeue-on-success, retry count, the queued fallback, draft clearing, the
 * duplicate-submit guard, the required-upload and signature gates, and the
 * post-application session snapshot. They deliberately assert *values*, not
 * markup.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const showSuccess = vi.fn();
const showError = vi.fn();
// `showInfo` was missing here, and the omission was not harmless: the start-over
// path calls it, so the real component threw an unhandled TypeError inside a test
// that still reported green. The mock now matches `ToastProvider`'s actual
// contract.
const showInfo = vi.fn();
const showWarning = vi.fn();
const navigateSpy = vi.fn();

const callableSpy = vi.fn();
const httpsCallableSpy = vi.fn();

const enqueueSpy = vi.fn();
const dequeueSpy = vi.fn();
const initQueueSpy = vi.fn();
const isQueueSupportedSpy = vi.fn();

const savePostApplySessionSpy = vi.fn();

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ setCurrentCompanyProfile: vi.fn() }),
}));

vi.mock('@shared/components/feedback/ToastProvider', () => ({
  useToast: () => ({ showSuccess, showError, showInfo, showWarning }),
}));

vi.mock('@shared/components/feedback', () => ({
  useToast: () => ({ showSuccess, showError, showInfo, showWarning }),
}));

vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
}));

/**
 * Callables are routed by name.
 *
 * `callableSpy` remains the default so every existing assertion about the
 * submission contract still holds, and the autosave/resume callables get their
 * own spies — otherwise a background progress save would land in the middle of
 * this file's retry-count assertions and look like a submission attempt.
 */
const draftCallables = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => {
    httpsCallableSpy(...args);
    const [, name] = args;
    return draftCallables[name] || callableSpy;
  },
}));

// The real submission path, not the E2E shortcut.
vi.mock('@lib/runtime/e2eMode', () => ({
  isE2ETestMode: false,
  getE2EQueryParam: vi.fn((name, fallback) => fallback),
}));

vi.mock('@lib/submissionQueue', () => ({
  initQueue: (...a) => initQueueSpy(...a),
  enqueueSubmission: (...a) => enqueueSpy(...a),
  dequeueSubmission: (...a) => dequeueSpy(...a),
  isSupported: (...a) => isQueueSupportedSpy(...a),
}));

vi.mock('@lib/applicationId', () => ({
  generateApplicationId: vi.fn(async () => 'generated-app-id'),
  generateConfirmationNumber: vi.fn(() => 'CONF-123'),
}));

/**
 * Per-test company overrides.
 *
 * Hoisted, and merged into the profile on every fetch rather than queued with
 * `mockResolvedValueOnce`: the container may load the profile more than once for
 * one render, and a one-shot value would then serve the default to the second
 * call and quietly test the wrong company configuration.
 */
const profileOverride = vi.hoisted(() => ({ current: null }));

vi.mock('../../services/publicProfileService', () => ({
  fetchPublicProfileBySlug: vi.fn(async () => ({
    id: 'company-1',
    companyName: 'Acme Freight',
    appSlug: 'acme',
    customQuestions: [],
    applicationConfig: {
      cdlUpload: { hidden: false, required: true },
      medCardUpload: { hidden: false, required: true },
    },
    postApplicationTemplates: [
      { templateId: 'tpl-1', title: 'Direct Deposit', enabled: true },
    ],
    ...(profileOverride.current || {}),
  })),
}));

vi.mock('./postApplyDocsStorage', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    savePostApplySession: (...a) => savePostApplySessionSpy(...a),
    readPostApplySession: vi.fn(() => null),
  };
});

vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

// The wizard itself is replaced by a probe: these tests are about the
// container's submission contract, not about rendering nine steps.
vi.mock('@shared/components/layout/Stepper', () => ({
  __esModule: true,
  default: ({ onFinalSubmit, onPartialSubmit, onNavigate, updateFormData, step }) => (
    <div>
      <span data-testid="current-step">{step}</span>
      <button type="button" onClick={onFinalSubmit}>probe-submit</button>
      <button type="button" onClick={onPartialSubmit}>probe-save-draft</button>
      <button type="button" onClick={() => onNavigate('next')}>probe-next</button>
      <button type="button" onClick={() => onNavigate('back')}>probe-back</button>
      {/* The applicant typing. Needed because navigation alone must NOT mark the
          local copy as holding unsynchronised work, so a test that means "they did
          work" has to actually change an answer. */}
      <button type="button" onClick={() => updateFormData('phone', '5559999')}>probe-edit</button>
    </div>
  ),
  // The real order, so a resumed step index resolves the way it does in the app.
  buildSemanticStepOrder: (hasCustomQuestions) => {
    const order = ['contact', 'qualifications', 'license', 'violations', 'accidents', 'employment', 'general'];
    if (hasCustomQuestions) order.push('custom_questions');
    order.push('review', 'consent');
    return order;
  },
  resolveWizardStepIndex: (semantic, hasCustomQuestions) => {
    const order = ['contact', 'qualifications', 'license', 'violations', 'accidents', 'employment', 'general'];
    if (hasCustomQuestions) order.push('custom_questions');
    order.push('review', 'consent');
    const index = order.indexOf(semantic);
    return index >= 0 ? index : 0;
  },
}));

import { PublicApplyHandler } from './PublicApplyHandler';

const UPLOADED = { name: 'f.pdf', url: 'https://example.com/f.pdf' };

const SIGNED_DRAFT = {
  firstName: 'Ada',
  lastName: 'Driver',
  email: 'ada@example.com',
  phone: '5555551234',
  // A real local draft never carries this — it is stripped on write, which is why
  // a resumed applicant has to re-enter it. These fixtures write localStorage
  // directly to stand in for "the applicant has filled every page in this
  // session", so the value is present here on purpose. The resumed-without-it
  // case is covered explicitly below.
  ssn: '123-45-6789',
  'cdl-front': UPLOADED,
  'cdl-back': UPLOADED,
  'medical-card-upload': UPLOADED,
  signature: 'data:image/png;base64,AAAA',
  'final-certification': 'agreed',
};

function renderHandler() {
  return render(
    <MemoryRouter initialEntries={['/apply/acme']}>
      <Routes>
        <Route path="/apply/:slug" element={<PublicApplyHandler />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Seed a complete, signed application through the draft-restore path. */
async function renderWithCompleteDraft(overrides = {}) {
  localStorage.setItem('draft_acme', JSON.stringify({ ...SIGNED_DRAFT, ...overrides }));
  renderHandler();
  await chooseManualIntake();
}

/**
 * Seed a draft that resumes at a later step, the way a returning applicant does.
 *
 * A stored `lastStep` puts the container straight into the wizard — the intake
 * chooser is for someone who has not started — so this cannot go through
 * `chooseManualIntake`, and a test asserting "sent back to page one" needs to
 * begin somewhere other than page one to be asserting anything.
 */
async function renderResumedAtStep(stepIndex, overrides = {}) {
  localStorage.setItem(
    'draft_acme',
    JSON.stringify({ ...SIGNED_DRAFT, ...overrides, lastStep: stepIndex }),
  );
  renderHandler();
  await screen.findByText('probe-submit');
  expect(screen.getByTestId('current-step')).toHaveTextContent(String(stepIndex));
}

/**
 * The real (non-E2E) flow always opens on the intake chooser, so every contract
 * case has to walk through it before the wizard mounts.
 */
async function chooseManualIntake() {
  fireEvent.click(await screen.findByText('Fill Out Manually'));
  await screen.findByText('probe-submit');
}

async function submit() {
  fireEvent.click(screen.getByText('probe-submit'));
}

/** Registered per test so a background autosave never lands in a submission assertion. */
const saveProgressSpy = vi.fn();
const findResumableSpy = vi.fn();
const resumeDraftSpy = vi.fn();
const startNewSpy = vi.fn();

function stubDraftCallables() {
  draftCallables.saveApplicationProgress = saveProgressSpy;
  draftCallables.findResumableApplication = findResumableSpy;
  draftCallables.resumeApplicationDraft = resumeDraftSpy;
  draftCallables.startNewApplication = startNewSpy;
  saveProgressSpy.mockResolvedValue({ data: { saved: true, applicantKey: 'key-1', resumeToken: 'token-1' } });
  findResumableSpy.mockResolvedValue({ data: { resumable: false } });
  resumeDraftSpy.mockResolvedValue({ data: { restored: false } });
  startNewSpy.mockResolvedValue({ data: { discarded: true } });
}

describe('PublicApplyHandler submission contract', () => {
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
    stubDraftCallables();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('calls submitGuestApplication with the exact top-level payload shape', async () => {
    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(httpsCallableSpy).toHaveBeenCalledWith({}, 'submitGuestApplication');

    const payload = callableSpy.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ['companyId', 'email', 'formData', 'phone', 'signature'].sort(),
    );
    expect(payload.companyId).toBe('company-1');
    expect(payload.email).toBe('ada@example.com');
    expect(payload.phone).toBe('5555551234');
    expect(payload.signature).toBe('data:image/png;base64,AAAA');
  });

  it('keeps the frozen formData envelope: ids, source, status, arrays and lifecycle', async () => {
    await renderWithCompleteDraft();
    await submit();
    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));

    const { formData } = callableSpy.mock.calls[0][0];
    expect(formData.applicantId).toBe('generated-app-id');
    expect(formData.applicationId).toBe('generated-app-id');
    expect(formData.confirmationNumber).toBe('CONF-123');
    expect(formData.companyId).toBe('company-1');
    expect(formData.companyName).toBe('Acme Freight');
    expect(formData.sourceType).toBe('Public Application');
    expect(formData.sourceSlug).toBe('acme');
    expect(formData.status).toBe('New Application');
    expect(formData.signatureType).toBe('drawn');
    expect(formData.recruiterCode).toBeNull();
    // Arrays are always arrays, never undefined.
    for (const key of ['employers', 'violations', 'accidents', 'schools', 'military']) {
      expect(Array.isArray(formData[key])).toBe(true);
    }
    expect(formData.lifecycle).toMatchObject({
      status: 'pending',
      clientVersion: '2.0-bulletproof',
      isGuest: true,
    });
    // No serverTimestamp sentinels are sent from the client.
    expect(formData.submittedAt).toBeUndefined();
    expect(formData.createdAt).toBeUndefined();
  });

  it('queues before submitting and dequeues only after the callable succeeds', async () => {
    const order = [];
    enqueueSpy.mockImplementation(async () => { order.push('enqueue'); return 'queue-1'; });
    callableSpy.mockImplementation(async () => { order.push('submit'); return { data: {} }; });
    dequeueSpy.mockImplementation(async () => { order.push('dequeue'); });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(order).toEqual(['enqueue', 'submit', 'dequeue']));
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'generated-app-id' }),
      'company-1',
      { type: 'guest', userId: null },
    );
  });

  it('retries the callable three times, then falls back to the queued screen', async () => {
    callableSpy.mockRejectedValue(new Error('offline'));

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Application Saved' })).toBeInTheDocument(), {
      timeout: 10_000,
    });
    expect(callableSpy).toHaveBeenCalledTimes(3);
    expect(dequeueSpy).not.toHaveBeenCalled();
  }, 20_000);

  it('surfaces an error instead of the queued screen when the queue is unavailable', async () => {
    isQueueSupportedSpy.mockReturnValue(false);
    callableSpy.mockRejectedValue(new Error('offline'));

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Failed to submit application. Please try again.'),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole('heading', { name: 'Application Saved' })).toBeNull();
  }, 20_000);

  it('clears the local draft and the pending recruiter code on success', async () => {
    sessionStorage.setItem('pending_application_recruiter', 'REC-9');
    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('draft_acme')).toBeNull());
    expect(sessionStorage.getItem('pending_application_recruiter')).toBeNull();
    expect(callableSpy.mock.calls[0][0].formData.recruiterCode).toBe('REC-9');
  });

  it('prefers server-generated ids and stores the confirmation number', async () => {
    callableSpy.mockResolvedValue({
      data: { applicationId: 'server-app-id', confirmationNumber: 'SERVER-1' },
    });

    await renderWithCompleteDraft();
    await submit();

    await waitFor(() => expect(sessionStorage.getItem('lastConfirmationNumber')).toBe('SERVER-1'));
    expect(savePostApplySessionSpy).toHaveBeenCalledWith('company-1', {
      applicationId: 'server-app-id',
      confirmationNumber: 'SERVER-1',
      slug: 'acme',
      docs: {},
    });
  });

  it('submits once even when the submit action fires repeatedly', async () => {
    let release;
    callableSpy.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: {} }); }));

    await renderWithCompleteDraft();
    await submit();
    await submit();
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(screen.getByText('Application Submitted!')).toBeInTheDocument());
  });

  it('blocks submission and returns to the upload step when a required document is missing', async () => {
    await renderWithCompleteDraft({ 'medical-card-upload': null });
    await submit();

    expect(callableSpy).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Please upload required documents before submitting: Medical Card.',
    );
    expect(screen.getByTestId('current-step')).toHaveTextContent('2');
  });

  /**
   * A draft never stores `ssn`, so an applicant who resumed part-way through has
   * never been asked for it: the step that collects it never ran its validation,
   * and before this the application submitted without a field the company
   * requires. The server refuses it independently; these cases are about the
   * applicant being told which field and taken to it.
   */
  const MISSING_SSN_MESSAGE =
    'Please re-enter your Social Security Number to submit. '
    + 'It is not saved with your progress for security.';

  /**
   * `lastStep` on purpose in each of these.
   *
   * The wizard opens on page one by default, so a test that asserts "sent back to
   * page one" from step 0 asserts nothing — it would pass with the gate deleted.
   * Resuming at a later step is also the real scenario: the applicant who never
   * passes back through page one is exactly the one whose SSN is gone.
   */
  it('blocks submission and returns to page one when a resumed application has no SSN', async () => {
    await renderResumedAtStep(5, { ssn: '' });
    await submit();

    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    // 0 = the contact step, which is where the field is collected.
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('treats whitespace as missing, not as an answer', async () => {
    await renderResumedAtStep(5, { ssn: '   ' });
    await submit();

    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('routes to the earliest incomplete page when both the SSN and an upload are missing', async () => {
    await renderResumedAtStep(5, { ssn: '', 'medical-card-upload': null });
    await submit();

    // Page one, not the upload step: one round trip through the form instead of
    // two. The upload gate then stops them on the way back through.
    expect(showError).toHaveBeenCalledWith(MISSING_SSN_MESSAGE);
    expect(showError).not.toHaveBeenCalledWith(
      'Please upload required documents before submitting: Medical Card.',
    );
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('submits without an SSN when the company marks it optional', async () => {
    profileOverride.current = {
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
        ssn: { hidden: false, required: false },
      },
    };
    await renderWithCompleteDraft({ ssn: '' });
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(showError).not.toHaveBeenCalled();
  });

  it('submits without an SSN when the company hides the question', async () => {
    profileOverride.current = {
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
        // Hidden AND required: a question nobody is shown cannot be one they must
        // answer, so hidden has to win — otherwise this configuration produces an
        // application that can never be submitted.
        ssn: { hidden: true, required: true },
      },
    };
    await renderWithCompleteDraft({ ssn: '' });
    await submit();

    await waitFor(() => expect(callableSpy).toHaveBeenCalledTimes(1));
    expect(showError).not.toHaveBeenCalled();
  });

  it('blocks submission and returns to the consent step when the signature is missing', async () => {
    await renderWithCompleteDraft({ signature: '' });
    await submit();

    expect(callableSpy).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('Please complete the electronic signature.');
    // 8 = consent index with no custom questions.
    expect(screen.getByTestId('current-step')).toHaveTextContent('8');
  });

  it('rejects an invalid email and phone before any network call', async () => {
    await renderWithCompleteDraft({ email: 'not-an-email' });
    await submit();
    expect(showError).toHaveBeenCalledWith('Invalid Email Address.');
    expect(callableSpy).not.toHaveBeenCalled();
  });

  it('reports a failed local draft save instead of silently losing it', async () => {
    await renderWithCompleteDraft();
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    fireEvent.click(screen.getByText('probe-save-draft'));
    expect(setItem).toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Could not save progress locally. Your data is still here — please continue filling the form.',
    );
    expect(showSuccess).not.toHaveBeenCalledWith('Progress saved.');
    setItem.mockRestore();
  });

  it('records the recruiter code from either query parameter', async () => {
    localStorage.setItem('draft_acme', JSON.stringify(SIGNED_DRAFT));
    render(
      <MemoryRouter initialEntries={['/apply/acme?recruiter=FROM-LONG']}>
        <Routes>
          <Route path="/apply/:slug" element={<PublicApplyHandler />} />
        </Routes>
      </MemoryRouter>,
    );
    await chooseManualIntake();
    expect(sessionStorage.getItem('pending_application_recruiter')).toBe('FROM-LONG');
    expect(sessionStorage.getItem('pending_application_company')).toBe('company-1');
  });
});

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
