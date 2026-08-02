/**
 * Contract freeze for the PEV (Previous Employment Verification) tab.
 *
 * Written BEFORE the design-system migration. This tab had **no test coverage at
 * all**, while owning a callable payload, an activity-log write, a Firestore
 * employer update, a Storage upload path, a signed-URL callable, clipboard and
 * window-opening behaviour, and an optimistic local-override cache. Every one of
 * those is asserted here by value, not by markup, so the migration is provably
 * behaviour-preserving.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const dataMock = vi.hoisted(() => ({ value: { currentCompanyProfile: {} } }));
const fsMocks = vi.hoisted(() => ({ updateDoc: vi.fn() }));
const storageMocks = vi.hoisted(() => ({ uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
const fnMocks = vi.hoisted(() => ({ callable: vi.fn(), httpsCallable: vi.fn() }));
const activityMocks = vi.hoisted(() => ({ logActivity: vi.fn() }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: activityMocks.logActivity }));
vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments) => segments.join('/')),
  updateDoc: fsMocks.updateDoc,
}));
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => path),
  uploadBytes: storageMocks.uploadBytes,
  getDownloadURL: storageMocks.getDownloadURL,
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => {
    fnMocks.httpsCallable(...args);
    return fnMocks.callable;
  },
}));

// The request modal and the VOE preview are exercised by their own tests. Here
// they stand in for the two steps of the initiation flow so the tab's own
// payload/ordering contract is what is under test.
vi.mock('../modals/PEVRequestModal', () => ({
  PEVRequestModal: ({ employer, onClose, onProceed }) => (
    <div data-testid="request-modal" data-employer={employer?.companyName} data-index={employer?.index}>
      <button type="button" onClick={onClose}>request-close</button>
      <button type="button" onClick={() => onProceed('email', { email: 'hr@acme.test' })}>proceed-email</button>
      <button type="button" onClick={() => onProceed('fax', { fax: '5125550100' })}>proceed-fax</button>
      <button type="button" onClick={() => onProceed('manual', {})}>proceed-manual</button>
    </div>
  ),
}));
vi.mock('../modals/VOEPreviewModal', () => ({
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
}));

import { PEVTab } from './PEVTab';

/**
 * A factory, not a shared constant, and deliberately so: `handleFinalSend` and
 * `handleUploadResult` take a shallow `[...employers]` copy and then mutate the
 * employer objects inside it, which are the very objects handed in through
 * `appData`. A shared fixture would therefore carry one test's "Sent" status
 * into the next. That in-place mutation of a prop is a real (pre-existing) smell
 * — it is recorded in the roadmap rather than changed here, because the employer
 * data shape and the Firestore write are frozen contracts for this campaign.
 */
const makeEmployers = () => [
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

const renderTab = (overrides = {}) => render(
  <PEVTab
    companyId="co-1"
    applicationId="app-1"
    collectionName="applications"
    appData={{ firstName: 'Maria', lastName: 'Garcia', employers: makeEmployers(), ...overrides }}
  />,
);

beforeEach(() => {
  vi.clearAllMocks();
  dataMock.value = { currentCompanyProfile: {} };
  fnMocks.callable.mockResolvedValue({
    data: { success: true, token: 'tok-9', verificationUrl: 'https://portal.test/v/tok-9' },
  });
  fsMocks.updateDoc.mockResolvedValue(undefined);
  activityMocks.logActivity.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('PEVTab feature gate', () => {
  it('shows the paywall and no verification UI when the pev feature is off', () => {
    dataMock.value = { currentCompanyProfile: { features: { pev: false } } };
    renderTab();

    expect(screen.getByText('PEV Module Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Acme Freight')).toBeNull();
  });

  it('renders the verification centre when the flag is absent or true', () => {
    renderTab();
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
    cleanup();

    dataMock.value = { currentCompanyProfile: { features: { pev: true } } };
    renderTab();
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
  });
});

describe('PEVTab employer presentation', () => {
  it('falls back from companyName to name', () => {
    renderTab();
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
    expect(screen.getByText('Legacy Hauling')).toBeInTheDocument();
  });

  it('defaults an employer with no verification to Not Started', () => {
    renderTab();
    expect(screen.getByText('Not Started')).toBeInTheDocument();
  });

  it('counts totals, completed and pending from the merged statuses', () => {
    renderTab({
      employers: [
        { companyName: 'A', verification: { status: 'Completed', history: [] } },
        { companyName: 'B', verification: { status: 'Sent', history: [] } },
        { companyName: 'C', verification: { status: 'Requested', history: [] } },
        { companyName: 'D' },
      ],
    });

    // Total 4, Completed 1, and 'Sent' + 'Requested' both count as pending.
    expect(screen.getByText('Total Employers').closest('*')).toBeTruthy();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows the no-employer empty copy', () => {
    renderTab({ employers: [] });
    expect(screen.getByText('No historical employers detected in this application.')).toBeInTheDocument();
  });

  it('keeps the FMCSA 391.23(a)(2) compliance note', () => {
    renderTab();
    expect(screen.getByText(/FMCSA 391\.23\(a\)\(2\) requires investigation of employment history/)).toBeInTheDocument();
  });
});

describe('PEVTab initiation flow and callable payload', () => {
  const initiateFirst = () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /Initiate PEV/i })[0]);
  };

  it('passes the employer and its index into the request modal', () => {
    initiateFirst();
    const modal = screen.getByTestId('request-modal');
    expect(modal).toHaveAttribute('data-employer', 'Acme Freight');
    expect(modal).toHaveAttribute('data-index', '0');
  });

  it('carries the delivery method and contact info into the preview', () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));

    const preview = screen.getByTestId('preview-modal');
    expect(preview).toHaveAttribute('data-method', 'email');
    expect(JSON.parse(preview.getAttribute('data-contact'))).toEqual({ email: 'hr@acme.test' });
    expect(screen.queryByTestId('request-modal')).toBeNull();
  });

  it('returns from the preview to the request modal, not to the list', () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-back'));

    expect(screen.getByTestId('request-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-modal')).toBeNull();
  });

  it('sends the exact sendVerificationRequest payload for email delivery', async () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(fnMocks.callable).toHaveBeenCalled());
    expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'sendVerificationRequest');
    expect(fnMocks.callable).toHaveBeenCalledWith({
      companyId: 'co-1',
      applicationId: 'app-1',
      collectionName: 'applications',
      employerIndex: 0,
      employerName: 'Acme Freight',
      employerEmail: 'hr@acme.test',
      applicantName: 'Maria Garcia',
      employmentStartDate: '2020-01',
      employmentEndDate: '2022-06',
      deliveryMethod: 'email',
    });
  });

  it('sends employerEmail as null for fax and manual delivery', async () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-fax'));
    fireEvent.click(screen.getByText('preview-send'));
    await waitFor(() => expect(fnMocks.callable).toHaveBeenCalled());
    expect(fnMocks.callable.mock.calls[0][0]).toMatchObject({ employerEmail: null, deliveryMethod: 'fax' });

    cleanup();
    vi.clearAllMocks();
    fnMocks.callable.mockResolvedValue({ data: { success: true, token: 't', verificationUrl: 'u' } });

    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /Initiate PEV/i })[0]);
    fireEvent.click(screen.getByText('proceed-manual'));
    fireEvent.click(screen.getByText('preview-send'));
    await waitFor(() => expect(fnMocks.callable).toHaveBeenCalled());
    expect(fnMocks.callable.mock.calls[0][0]).toMatchObject({ employerEmail: null, deliveryMethod: 'manual' });
  });

  it('logs the activity with the frozen argument list and entry text', async () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(activityMocks.logActivity).toHaveBeenCalled());
    expect(activityMocks.logActivity).toHaveBeenCalledWith(
      'co-1',
      'applications',
      'app-1',
      'PEV_REQUEST',
      'Initiated Email verification for Acme Freight (Sent to: hr@acme.test) | Portal: https://portal.test/v/tok-9',
      'pev',
    );
  });

  it('writes the employer array back with the frozen verification and history shape', async () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(fsMocks.updateDoc).toHaveBeenCalled());
    const [path, payload] = fsMocks.updateDoc.mock.calls[0];
    expect(path).toBe('companies/co-1/applications/app-1');

    const written = payload.employers[0].verification;
    expect(written.status).toBe('Sent');
    expect(written.method).toBe('Email');
    expect(written.token).toBe('tok-9');
    expect(written.verificationUrl).toBe('https://portal.test/v/tok-9');
    expect(written.history.at(-1)).toMatchObject({
      action: 'Sent via Portal',
      method: 'Email',
      recipient: 'hr@acme.test',
      verificationUrl: 'https://portal.test/v/tok-9',
      token: 'tok-9',
    });
    expect(typeof written.history.at(-1).timestamp).toBe('string');
  });

  it('maps the three delivery-method values to their frozen method labels', async () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /Initiate PEV/i })[0]);
    fireEvent.click(screen.getByText('proceed-manual'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(fsMocks.updateDoc).toHaveBeenCalled());
    expect(fsMocks.updateDoc.mock.calls[0][1].employers[0].verification.method).toBe('Manual');
    expect(activityMocks.logActivity.mock.calls[0][4]).toContain('Initiated Manual verification');
    expect(activityMocks.logActivity.mock.calls[0][4]).toContain('Sent to: Manual Download');
  });

  it('applies the optimistic local override so the row updates before a refetch', async () => {
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    // appData never changes in this test — only the local override can move the
    // first employer off 'Not Started'.
    await waitFor(() => expect(screen.queryByText('Not Started')).toBeNull());
    expect(toastMocks.showSuccess).toHaveBeenCalledWith(
      'Verification request sent to Acme Freight via Email (hr@acme.test)',
    );
  });

  it('surfaces a failed callable result and writes nothing', async () => {
    fnMocks.callable.mockResolvedValue({ data: { success: false, error: 'no smtp' } });
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(
      'Verification request failed: no smtp. Please check your email settings.',
    ));
    expect(fsMocks.updateDoc).not.toHaveBeenCalled();
    expect(activityMocks.logActivity).not.toHaveBeenCalled();
  });

  it('surfaces a thrown callable error with the frozen copy', async () => {
    fnMocks.callable.mockRejectedValue(new Error('boom'));
    initiateFirst();
    fireEvent.click(screen.getByText('proceed-email'));
    fireEvent.click(screen.getByText('preview-send'));

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Failed to initiate verification.'));
  });
});

describe('PEVTab result viewing', () => {
  const openSpy = vi.fn();
  beforeEach(() => {
    openSpy.mockReset();
    vi.stubGlobal('open', openSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a full https result URL directly without calling the signed-url callable', async () => {
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Completed', resultUrl: 'https://files.test/r.pdf', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View Result/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://files.test/r.pdf', '_blank', 'noopener,noreferrer'));
    expect(fnMocks.httpsCallable).not.toHaveBeenCalledWith(expect.anything(), 'getSignedPevUrl');
  });

  it('exchanges a storage path for a signed URL with the frozen payload', async () => {
    fnMocks.callable.mockResolvedValue({ data: { url: 'https://signed.test/x.pdf' } });
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Completed', resultUrl: 'companies/co-1/pev/x.pdf', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View Result/i }));

    await waitFor(() => expect(fnMocks.callable).toHaveBeenCalledWith({ storagePath: 'companies/co-1/pev/x.pdf' }));
    expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getSignedPevUrl');
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed.test/x.pdf', '_blank', 'noopener,noreferrer'));
  });

  it('reports a missing storage object with its own message', async () => {
    const err = new Error('nope');
    err.code = 'functions/not-found';
    fnMocks.callable.mockRejectedValue(err);
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Completed', resultUrl: 'companies/co-1/pev/x.pdf', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View Result/i }));

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(
      'The result file was not found in storage. It may have been deleted.',
    ));
  });

  it('reports any other signed-url failure with the generic message', async () => {
    fnMocks.callable.mockRejectedValue(new Error('offline'));
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Completed', resultUrl: 'companies/co-1/pev/x.pdf', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View Result/i }));

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Failed to open the verification result.'));
  });

  it('reports a callable that resolves without a url', async () => {
    fnMocks.callable.mockResolvedValue({ data: {} });
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Completed', resultUrl: 'companies/co-1/pev/x.pdf', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View Result/i }));

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Could not retrieve the document URL.'));
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('PEVTab copy link', () => {
  it('copies the verification URL and confirms with the frozen toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Copy Link/i }));

    expect(writeText).toHaveBeenCalledWith('https://portal.test/v/tok-1');
    expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification link copied to clipboard!');
    vi.unstubAllGlobals();
  });

  it('does not offer Copy Link once the verification is Completed', () => {
    renderTab({
      employers: [{
        companyName: 'A',
        verification: { status: 'Completed', verificationUrl: 'https://portal.test/v/done', history: [] },
      }],
    });
    expect(screen.queryByRole('button', { name: /Copy Link/i })).toBeNull();
  });
});

describe('PEVTab result upload', () => {
  it('uploads to the frozen storage path and records the result', async () => {
    storageMocks.uploadBytes.mockResolvedValue(undefined);
    storageMocks.getDownloadURL.mockResolvedValue('https://files.test/uploaded.pdf');
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { container } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Upload Result/i }));

    const input = container.querySelector('input[type="file"]');
    const file = new File(['x'], 'result.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(storageMocks.uploadBytes).toHaveBeenCalled());
    expect(storageMocks.uploadBytes.mock.calls[0][0]).toBe(
      'companies/co-1/applications/app-1/pev_results/1700000000000_result.pdf',
    );

    await waitFor(() => expect(fsMocks.updateDoc).toHaveBeenCalled());
    const written = fsMocks.updateDoc.mock.calls[0][1].employers[1].verification;
    expect(written.status).toBe('Completed');
    expect(written.resultUrl).toBe('https://files.test/uploaded.pdf');
    expect(written.history.at(-1)).toMatchObject({
      action: 'Result Uploaded',
      fileName: 'result.pdf',
      url: 'https://files.test/uploaded.pdf',
    });
    expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification result uploaded successfully.');
    Date.now.mockRestore();
  });

  it('accepts pdf and image files only', () => {
    const { container } = renderTab();
    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '.pdf,image/*');
  });

  it('reports an upload failure with the frozen copy', async () => {
    storageMocks.uploadBytes.mockRejectedValue(new Error('nope'));
    const { container } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Upload Result/i }));
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['x'], 'r.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Failed to upload verification result.'));
  });

  it('does nothing when the picker is dismissed with no file', () => {
    const { container } = renderTab();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [] } });
    expect(storageMocks.uploadBytes).not.toHaveBeenCalled();
  });
});

describe('PEVTab verification history', () => {
  it('lists the recorded history entries for the chosen employer', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /View History/i }));

    expect(screen.getByText('Verification History')).toBeInTheDocument();
    expect(screen.getByText('Sent via Portal')).toBeInTheDocument();
    expect(screen.getByText(/Sent to: hr@legacy\.test \(Email\)/)).toBeInTheDocument();
  });

  it('shows the frozen empty copy when there is no history', () => {
    renderTab({
      employers: [{ companyName: 'A', verification: { status: 'Sent', history: [] } }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View History/i }));
    expect(screen.getByText('No history available yet.')).toBeInTheDocument();
  });

  it('offers the uploaded document from a history entry', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    renderTab({
      employers: [{
        companyName: 'A',
        verification: {
          status: 'Completed',
          history: [{ action: 'Result Uploaded', url: 'https://files.test/h.pdf', timestamp: '2026-07-02T10:00:00.000Z' }],
        },
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: /View History/i }));
    fireEvent.click(screen.getByRole('button', { name: /View Uploaded Document/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://files.test/h.pdf', '_blank', 'noopener,noreferrer'));
    vi.unstubAllGlobals();
  });

  // DEFECT-FIX assertion (not a frozen contract): the history dialog read only
  // `companyName`, while the employer list uses `companyName || name`. For a
  // legacy-shaped employer the dialog was therefore titled "Not Specified" —
  // the one place a user checks *which* employer a verification trail belongs
  // to.
  it('names the history after the employer it belongs to, including legacy `name`', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /View History/i }));

    const history = screen.getByRole('dialog', { name: 'Verification History' });
    expect(within(history).getByText('Legacy Hauling')).toBeInTheDocument();
    expect(within(history).queryByText('Not Specified')).toBeNull();
  });
});

describe('PEVTab resend', () => {
  it('reopens the request modal for an already-sent employer', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Resend/i }));

    const modal = screen.getByTestId('request-modal');
    expect(modal).toHaveAttribute('data-index', '1');
  });
});
