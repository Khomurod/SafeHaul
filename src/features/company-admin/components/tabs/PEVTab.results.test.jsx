// PEVTab contract, part 2 of 2: result viewing (signed URLs and direct
// opens), the copy-link action, the result upload path, the verification
// history dialog, and resend.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `PEVTab.contract.support.jsx`; the registrations below delegate to it. See
// that file's header for the scope of this contract freeze.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

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
    fsMocks,
    storageMocks,
    fnMocks,
} from './PEVTab.contract.support';

const renderTab = makeRenderTab(PEVTab);

beforeEach(resetHarness);

afterEach(cleanup);

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
