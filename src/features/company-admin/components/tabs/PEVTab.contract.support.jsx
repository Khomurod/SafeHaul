/**
 * Contract freeze for the PEV (Previous Employment Verification) tab.
 *
 * Written BEFORE the design-system migration. This tab had **no test coverage at
 * all**, while owning a callable payload, an activity-log write, a Firestore
 * employer update, a Storage upload path, a signed-URL callable, clipboard and
 * window-opening behaviour, and an optimistic local-override cache. Every one of
 * those is asserted here by value, not by markup, so the migration is provably
 * behaviour-preserving.
 *
 * =====================================================================
 * Shared harness for the PEVTab contract suites.
 *
 * `vi.mock` is hoisted per file, so each suite keeps its own registrations,
 * whose factories delegate to the `*Mock()` functions below. This module must
 * not import `PEVTab` or any module the suites mock — the tab transitively
 * imports the mocked firebase modules, and loading either here fires a mock
 * factory that is itself awaiting this module, which deadlocks vitest
 * silently (learned on `CA-3`). Each suite imports the tab itself and passes
 * it to `makeRenderTab`.
 * =====================================================================
 */
import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

export const toastMocks = { showSuccess: vi.fn(), showError: vi.fn() };
export const dataMock = { value: { currentCompanyProfile: {} } };
export const fsMocks = { updateDoc: vi.fn(), getDoc: vi.fn() };
/**
 * What the application document holds, for the read that precedes every mirror
 * write.
 *
 * `PEVTab.writeVerification` re-reads the document before writing, because
 * writing a snapshot of `appData.employers` back over the whole array erases
 * anything that changed on another row since the dossier loaded — including the
 * `employerId` `sendVerificationRequest` stamps, which is what a completed
 * verification is filed against. So the harness has to have a stored document,
 * not only a prop; `makeRenderTab` seeds it from the same rows it renders, and
 * `updateDoc` writes into it so a second action in one test sees the first.
 */
export const storedDoc = { employers: [] };
export const storageMocks = { uploadBytes: vi.fn(), getDownloadURL: vi.fn() };
export const fnMocks = { callable: vi.fn(), httpsCallable: vi.fn() };
export const activityMocks = { logActivity: vi.fn() };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const toastProviderMock = () => ({ useToast: () => toastMocks });
export const dataContextMock = () => ({ useData: () => dataMock.value });
export const activityLoggerMock = () => ({ logActivity: activityMocks.logActivity });
export const libFirebaseMock = () => ({ db: {}, storage: {}, functions: {} });
export const firebaseFirestoreMock = () => ({
  doc: vi.fn((_db, ...segments) => segments.join('/')),
  updateDoc: fsMocks.updateDoc,
  getDoc: fsMocks.getDoc,
});
export const firebaseStorageMock = () => ({
  ref: vi.fn((_storage, path) => path),
  uploadBytes: storageMocks.uploadBytes,
  getDownloadURL: storageMocks.getDownloadURL,
});
export const firebaseFunctionsMock = () => ({
  httpsCallable: (...args) => {
    fnMocks.httpsCallable(...args);
    return fnMocks.callable;
  },
});

// The request modal and the VOE preview are exercised by their own tests. Here
// they stand in for the two steps of the initiation flow so the tab's own
// payload/ordering contract is what is under test.
export const pevRequestModalMock = () => ({
  PEVRequestModal: ({ employer, onClose, onProceed }) => (
    <div data-testid="request-modal" data-employer={employer?.companyName} data-index={employer?.index}>
      <button type="button" onClick={onClose}>request-close</button>
      <button type="button" onClick={() => onProceed('email', { email: 'hr@acme.test' })}>proceed-email</button>
      <button type="button" onClick={() => onProceed('fax', { fax: '5125550100' })}>proceed-fax</button>
      <button type="button" onClick={() => onProceed('manual', {})}>proceed-manual</button>
    </div>
  ),
});
export const voePreviewModalMock = () => ({
  VOEPreviewModal: ({ employer, onClose, onSend }) => (
    <div
      data-testid="preview-modal"
      data-method={employer?.deliveryMethod}
      data-contact={JSON.stringify(employer?.contactInfo || {})}
    >
      <button type="button" onClick={onClose}>preview-back</button>
      <button type="button" onClick={onSend}>preview-send</button>
    </div>
  ),
});

// --- fixtures and helpers, verbatim ----------------------------------------

/**
 * A factory, not a shared constant.
 *
 * It was that way because `handleFinalSend` and `handleUploadResult` took a
 * shallow `[...employers]` copy and then mutated the employer objects inside it —
 * the very objects handed in through `appData` — so a shared fixture carried one
 * test's "Sent" status into the next. That in-place mutation of a prop is gone as
 * of 2026-09-09: `writeVerification` re-reads the document and replaces the row,
 * so nothing reaches back into the prop. The factory stays, because a fixture
 * shared between tests is a bad idea whether or not anything mutates it.
 */
export const makeEmployers = () => [
  {
    companyName: 'Acme Freight',
    city: 'Austin',
    state: 'TX',
    startDate: '2020-01',
    endDate: '2022-06',
  },
  {
    name: 'Legacy Hauling',
    city: 'Dallas',
    state: 'TX',
    startDate: '2018-03',
    endDate: '2019-12',
    verification: {
      status: 'Sent',
      method: 'Email',
      verificationUrl: 'https://portal.test/v/tok-1',
      history: [
        { action: 'Sent via Portal', method: 'Email', recipient: 'hr@legacy.test', timestamp: '2026-07-01T10:00:00.000Z' },
      ],
    },
  },
];

/**
 * The original `renderTab`, verbatim, except the tab arrives as an argument:
 * each suite imports it after its own hoisted mocks.
 */
export const makeRenderTab = (PEVTab) => (overrides = {}) => {
  const appData = { firstName: 'Maria', lastName: 'Garcia', employers: makeEmployers(), ...overrides };
  // The stored document the mirror write re-reads. Seeded from the same rows the
  // tab is rendered with, so "what is on screen" and "what is stored" agree
  // unless a test deliberately makes them differ.
  storedDoc.employers = JSON.parse(JSON.stringify(appData.employers || []));
  return render(
    <PEVTab
      companyId="co-1"
      applicationId="app-1"
      collectionName="applications"
      appData={appData}
    />,
  );
};

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
  vi.clearAllMocks();
  dataMock.value = { currentCompanyProfile: {} };
  fnMocks.callable.mockResolvedValue({
    data: { success: true, token: 'tok-9', verificationUrl: 'https://portal.test/v/tok-9' },
  });
  storedDoc.employers = [];
  fsMocks.getDoc.mockImplementation(async () => ({
    exists: () => true,
    data: () => ({ employers: storedDoc.employers }),
  }));
  // Writes land in the stored document too, so two actions in one test compose.
  fsMocks.updateDoc.mockImplementation(async (_ref, patch) => {
    if (Array.isArray(patch?.employers)) storedDoc.employers = patch.employers;
  });
  activityMocks.logActivity.mockResolvedValue(undefined);
}
