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
// =====================================================================
// Shared harness for the PublicApplyHandler contract suites, split from the
// 2203-line original on 2026-09-01 for the source-size standard (PA-2).
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below. This module must
// not import the component or any module the suites mock (react-router-dom
// included -- the component transitively imports several) -- loading either
// here fires a mock factory that is itself awaiting this module, which
// deadlocks vitest silently (learned on `CA-3`). Each suite imports the
// component and the router pieces itself and passes them to `makeRenderers`.
// The `vi.hoisted` wrappers the original needed are gone for the same reason:
// with delegating factories the values resolve at mock-instantiation time.
// =====================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, expect } from 'vitest';


export const showSuccess = vi.fn();
export const showError = vi.fn();
// `showInfo` was missing here, and the omission was not harmless: the start-over
// path calls it, so the real component threw an unhandled TypeError inside a test
// that still reported green. The mock now matches `ToastProvider`'s actual
// contract.
export const showInfo = vi.fn();
export const showWarning = vi.fn();
export const navigateSpy = vi.fn();

export const callableSpy = vi.fn();
export const httpsCallableSpy = vi.fn();

export const enqueueSpy = vi.fn();
export const dequeueSpy = vi.fn();
export const initQueueSpy = vi.fn();
export const isQueueSupportedSpy = vi.fn();

export const savePostApplySessionSpy = vi.fn();

/**
 * Fresh function identities on every call, exactly like the real provider.
 *
 * `ToastProvider` defines `showSuccess`/`showError`/`showInfo`/`showWarning` inline
 * and passes a fresh object as its context value, so anything closing over them is
 * unstable across renders. A double handing out stable references hides a whole
 * class of bug: naming such a closure as an effect dependency turns a load-once
 * effect into a per-render one, and this suite would report green while the browser
 * re-fetched the draft on a loop. The calls still land on the module-level spies, so
 * every assertion about them is unaffected.
 */
const toastApi = () => ({
  showSuccess: (...args) => showSuccess(...args),
  showError: (...args) => showError(...args),
  showInfo: (...args) => showInfo(...args),
  showWarning: (...args) => showWarning(...args),
});

/**
 * Callables are routed by name.
 *
 * `callableSpy` remains the default so every existing assertion about the
 * submission contract still holds, and the autosave/resume callables get their
 * own spies — otherwise a background progress save would land in the middle of
 * this file's retry-count assertions and look like a submission attempt.
 */
export const draftCallables = {};

// Spied rather than a bare mock, so a test can hold the submission open at the exact
// await where a discard from another tab used to slip through.
export const generateIdSpy = vi.fn(async () => 'generated-app-id');

/**
 * Per-test company overrides.
 *
 * Hoisted, and merged into the profile on every fetch rather than queued with
 * `mockResolvedValueOnce`: the container may load the profile more than once for
 * one render, and a one-shot value would then serve the default to the second
 * call and quietly test the wrong company configuration.
 */
export const profileOverride = { current: null };

/**
 * Lets a test hold the profile fetch open.
 *
 * The load effect does its local-draft restore after this await, so holding it is the
 * only way to reproduce a discard that lands while a tab is still starting up.
 */
export const profileGate = { current: null };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const dataContextMock = () => ({
  useData: () => ({ setCurrentCompanyProfile: vi.fn() }),
});

export const toastProviderMock = () => ({
  useToast: () => toastApi(),
});

export const feedbackMock = () => ({
  useToast: () => toastApi(),
});

export const libFirebaseMock = () => ({ db: {}, functions: {}, storage: {} });

export const firebaseFirestoreMock = () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
});

export const firebaseFunctionsMock = () => ({
  httpsCallable: (...args) => {
    httpsCallableSpy(...args);
    const [, name] = args;
    return draftCallables[name] || callableSpy;
  },
});

// The real submission path, not the E2E shortcut.
export const e2eModeMock = () => ({
  isE2ETestMode: false,
  getE2EQueryParam: vi.fn((name, fallback) => fallback),
});

export const submissionQueueMock = () => ({
  initQueue: (...a) => initQueueSpy(...a),
  enqueueSubmission: (...a) => enqueueSpy(...a),
  dequeueSubmission: (...a) => dequeueSpy(...a),
  isSupported: (...a) => isQueueSupportedSpy(...a),
});

export const applicationIdMock = () => ({
  generateApplicationId: (...a) => generateIdSpy(...a),
  generateConfirmationNumber: vi.fn(() => 'CONF-123'),
});

export const publicProfileServiceMock = () => ({
  fetchPublicProfileBySlug: vi.fn(async () => {
    if (profileGate.current) await profileGate.current;
    return {
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
    };
  }),
});

export const postApplyDocsStorageMock = (actual) => ({
  ...actual,
  savePostApplySession: (...a) => savePostApplySessionSpy(...a),
  readPostApplySession: vi.fn(() => null),
});

export const sentryMock = () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() });

export const reactRouterDomMock = (actual) => ({ ...actual, useNavigate: () => navigateSpy });


// The wizard itself is replaced by a probe: these tests are about the
// container's submission contract, not about rendering nine steps.
export const stepperMock = () => ({
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
});

// --- fixtures and helpers, verbatim ----------------------------------------


export const UPLOADED = { name: 'f.pdf', url: 'https://example.com/f.pdf' };

export const SIGNED_DRAFT = {
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

/**
 * The render helpers, built per suite: the suite imports the component and
 * the (mocked) router module itself and passes them in, so this module never
 * touches a mocked import.
 */
export const makeRenderers = ({ PublicApplyHandler, MemoryRouter, Route, Routes }) => {
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
  const renderWithCompleteDraft = async (overrides = {}) => {
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
  const renderResumedAtStep = async (stepIndex, overrides = {}) => {
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
  const chooseManualIntake = async () => {
    fireEvent.click(await screen.findByText('Fill Out Manually'));
    await screen.findByText('probe-submit');
  }

  const submit = async () => {
    fireEvent.click(screen.getByText('probe-submit'));
  }

  return { renderHandler, renderWithCompleteDraft, renderResumedAtStep, chooseManualIntake, submit };
};

/** Registered per test so a background autosave never lands in a submission assertion. */
export const saveProgressSpy = vi.fn();
export const findResumableSpy = vi.fn();
export const resumeDraftSpy = vi.fn();
export const startNewSpy = vi.fn();

export function stubDraftCallables() {
  draftCallables.saveApplicationProgress = saveProgressSpy;
  draftCallables.findResumableApplication = findResumableSpy;
  draftCallables.resumeApplicationDraft = resumeDraftSpy;
  draftCallables.startNewApplication = startNewSpy;
  saveProgressSpy.mockResolvedValue({ data: { saved: true, applicantKey: 'key-1', resumeToken: 'token-1' } });
  findResumableSpy.mockResolvedValue({ data: { resumable: false } });
  resumeDraftSpy.mockResolvedValue({ data: { restored: false } });
  startNewSpy.mockResolvedValue({ data: { discarded: true } });
}
