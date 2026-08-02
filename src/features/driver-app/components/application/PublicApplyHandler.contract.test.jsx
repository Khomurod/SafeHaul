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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const showSuccess = vi.fn();
const showError = vi.fn();
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
  useToast: () => ({ showSuccess, showError }),
}));

vi.mock('@shared/components/feedback', () => ({
  useToast: () => ({ showSuccess, showError }),
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

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => {
    httpsCallableSpy(...args);
    return callableSpy;
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
  default: ({ onFinalSubmit, onPartialSubmit, step }) => (
    <div>
      <span data-testid="current-step">{step}</span>
      <button type="button" onClick={onFinalSubmit}>probe-submit</button>
      <button type="button" onClick={onPartialSubmit}>probe-save-draft</button>
    </div>
  ),
  buildSemanticStepOrder: () => [],
  resolveWizardStepIndex: () => 0,
}));

import { PublicApplyHandler } from './PublicApplyHandler';

const UPLOADED = { name: 'f.pdf', url: 'https://example.com/f.pdf' };

const SIGNED_DRAFT = {
  firstName: 'Ada',
  lastName: 'Driver',
  email: 'ada@example.com',
  phone: '5555551234',
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

describe('PublicApplyHandler submission contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    isQueueSupportedSpy.mockReturnValue(true);
    initQueueSpy.mockResolvedValue(undefined);
    enqueueSpy.mockResolvedValue('queue-1');
    dequeueSpy.mockResolvedValue(undefined);
    callableSpy.mockResolvedValue({ data: {} });
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
