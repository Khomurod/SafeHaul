// PEVTab contract, part 1 of 2: the feature gate, the employer-list
// presentation, and the initiation flow with its callable payload, activity
// log, Firestore write and optimistic override.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `PEVTab.contract.support.jsx`; the registrations below delegate to it. See
// that file's header for the scope of this contract freeze.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./PEVTab.contract.support')).toastProviderMock());
vi.mock('@/context/DataContext', async () => (await import('./PEVTab.contract.support')).dataContextMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./PEVTab.contract.support')).activityLoggerMock());
vi.mock('@lib/firebase', async () => (await import('./PEVTab.contract.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./PEVTab.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./PEVTab.contract.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./PEVTab.contract.support')).firebaseFunctionsMock());
vi.mock('../modals/PEVRequestModal', async () => (await import('./PEVTab.contract.support')).pevRequestModalMock());
vi.mock('../modals/VOEPreviewModal', async () => (await import('./PEVTab.contract.support')).voePreviewModalMock());

import { PEVTab } from './PEVTab';
import {
    makeRenderTab,
    resetHarness,
    toastMocks,
    dataMock,
    fsMocks,
    fnMocks,
    activityMocks,
} from './PEVTab.contract.support';

const renderTab = makeRenderTab(PEVTab);

beforeEach(resetHarness);

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
