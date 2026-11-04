// PEVTab: the record of attempts on each employer card, and "Record attempt".
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `PEVTab.contract.support.jsx`; the registrations below delegate to it. No
// test here queues a `*Once` value, so the harness's clear is the right reset.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./PEVTab.contract.support')).toastProviderMock());
vi.mock('@/context/DataContext', async () => (await import('./PEVTab.contract.support')).dataContextMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./PEVTab.contract.support')).activityLoggerMock());
vi.mock('@lib/firebase', async () => (await import('./PEVTab.contract.support')).libFirebaseMock());
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./PEVTab.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./PEVTab.contract.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./PEVTab.contract.support')).firebaseFunctionsMock());
vi.mock('../modals/PEVRequestModal', async () => (await import('./PEVTab.contract.support')).pevRequestModalMock());
vi.mock('../modals/VOEPreviewModal', async () => (await import('./PEVTab.contract.support')).voePreviewModalMock());

import { PEVTab } from './PEVTab';
import { makeRenderTab, resetHarness, toastMocks, fnMocks } from './PEVTab.contract.support';

const renderTab = makeRenderTab(PEVTab);

beforeEach(resetHarness);
afterEach(cleanup);

const HISTORY = [
  { action: 'Sent via Portal', method: 'Email', recipient: 'hr@legacy.test', timestamp: '2026-10-01T10:00:00.000Z' },
  { action: 'Employer opened the link', timestamp: '2026-10-02T15:00:00.000Z' },
  { action: 'First reminder could not be sent', attempt: 'reminder', ok: false, timestamp: '2026-10-06T09:00:00.000Z' },
  { action: 'First reminder emailed', attempt: 'reminder', ok: true, timestamp: '2026-10-07T09:00:00.000Z' },
  {
    action: 'Phone call', attempt: 'call', ok: true, note: 'Left a voicemail with HR',
    recordedBy: 'Rita Recruiter', timestamp: '2026-10-05T12:00:00.000Z',
  },
];

const legacyRow = (verification) => ({
  name: 'Legacy Hauling', employerId: 'bbbbbbbbbbbb', city: 'Dallas', state: 'TX', verification,
});

/** The card of the one employer rendered. */
const card = () => screen.getAllByRole('listitem')[0];

describe('the attempt list on the card', () => {
  it('shows the newest three entries, newest first, and how many more the history holds', () => {
    renderTab({ employers: [legacyRow({ status: 'Sent', method: 'Email', history: HISTORY })] });

    const list = within(card()).getByRole('list', { name: 'Attempts' });
    const items = within(list).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('First reminder emailed');
    expect(items[1]).toContain('First reminder could not be sent');
    expect(items[2]).toContain('Phone call — Left a voicemail with HR');
    expect(within(card()).getByText('2 earlier entries in View History')).toBeInTheDocument();
  });

  it('shows nothing for an employer with no history', () => {
    renderTab({ employers: [{ companyName: 'Acme Freight', city: 'Austin', state: 'TX' }] });
    expect(within(card()).queryByRole('list', { name: 'Attempts' })).not.toBeInTheDocument();
  });
});

describe('Record attempt', () => {
  it('is offered once a request exists, until the result is in', () => {
    renderTab({
      employers: [
        { companyName: 'Acme Freight', city: 'Austin', state: 'TX' },
        legacyRow({ status: 'Sent', history: [] }),
        { ...legacyRow({ status: 'No Response (Good Faith Documented)', history: [] }), name: 'Late Carrier' },
        { ...legacyRow({ status: 'Completed', history: [] }), name: 'Done Carrier' },
      ],
    });

    const names = screen.queryAllByRole('button', { name: /^Record attempt for / }).map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Record attempt for Legacy Hauling', 'Record attempt for Late Carrier']);
  });

  it('records a fax through the server and shows the row it returns', async () => {
    const returned = {
      status: 'Sent',
      history: [{ action: 'Fax', attempt: 'fax', ok: true, note: 'Faxed to 512-555-0100', timestamp: '2026-11-02T12:00:00.000Z' }],
    };
    fnMocks.callable.mockResolvedValue({ data: { success: true, verification: returned } });
    renderTab({ employers: [legacyRow({ status: 'Sent', history: [] })] });

    fireEvent.click(screen.getByRole('button', { name: 'Record attempt for Legacy Hauling' }));
    const dialog = screen.getByRole('dialog', { name: 'Record an attempt — Legacy Hauling' });
    fireEvent.change(within(dialog).getByLabelText(/^Attempt/), { target: { value: 'fax' } });
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-11-02' } });
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: '  Faxed to 512-555-0100 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record attempt' }));

    await waitFor(() => expect(within(card()).getByText(/Faxed to 512-555-0100/)).toBeInTheDocument());
    expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordVerificationAttempt');
    expect(fnMocks.callable).toHaveBeenCalledWith({
      companyId: 'co-1',
      collectionName: 'applications',
      applicationId: 'app-1',
      employerIndex: 0,
      employerId: 'bbbbbbbbbbbb',
      employerName: 'Legacy Hauling',
      kind: 'fax',
      date: '2026-11-02',
      note: 'Faxed to 512-555-0100',
    });
    expect(toastMocks.showSuccess).toHaveBeenCalledWith('Attempt recorded.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for the text of a note before calling the server', async () => {
    renderTab({ employers: [legacyRow({ status: 'Sent', history: [] })] });

    fireEvent.click(screen.getByRole('button', { name: 'Record attempt for Legacy Hauling' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Attempt/), { target: { value: 'note' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record attempt' }));

    await waitFor(() => expect(within(dialog).getByText('Write the note.')).toBeInTheDocument());
    expect(fnMocks.callable).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server\'s reason when it refuses', async () => {
    fnMocks.callable.mockRejectedValue(Object.assign(
      new Error('Send a verification request to this employer first.'),
      { code: 'functions/failed-precondition' },
    ));
    renderTab({ employers: [legacyRow({ status: 'Sent', history: [] })] });

    fireEvent.click(screen.getByRole('button', { name: 'Record attempt for Legacy Hauling' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record attempt' }));

    await waitFor(() => expect(within(dialog).getByText('Send a verification request to this employer first.')).toBeInTheDocument());
    expect(toastMocks.showSuccess).not.toHaveBeenCalled();
  });

  it('says only that it failed when the server gives no reason to show', async () => {
    fnMocks.callable.mockRejectedValue(Object.assign(new Error('INTERNAL'), { code: 'functions/internal' }));
    renderTab({ employers: [legacyRow({ status: 'Sent', history: [] })] });

    fireEvent.click(screen.getByRole('button', { name: 'Record attempt for Legacy Hauling' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record attempt' }));

    await waitFor(() => expect(screen.getByText('The attempt could not be recorded. Please try again.')).toBeInTheDocument());
  });
});

describe('the history dialog', () => {
  it('shows a recorded attempt\'s note and who recorded it, dated by its day', () => {
    renderTab({ employers: [legacyRow({ status: 'Sent', history: HISTORY })] });

    fireEvent.click(screen.getByRole('button', { name: /View History/i }));
    const dialog = screen.getByRole('dialog', { name: 'Verification History' });
    expect(within(dialog).getByText('Left a voicemail with HR')).toBeInTheDocument();
    const day = new Date('2026-10-05T12:00:00.000Z').toLocaleDateString();
    expect(within(dialog).getByText(`${day} · recorded by Rita Recruiter`)).toBeInTheDocument();
  });

  it('opens day 30\'s record of attempts from the no-response entry, signed on the press', async () => {
    const tab = { opener: 'the dossier', location: { href: '' }, close: vi.fn() };
    const openSpy = vi.fn(() => tab);
    vi.stubGlobal('open', openSpy);
    fnMocks.callable.mockResolvedValue({ data: { url: 'https://signed.test/attempts.pdf' } });
    const attemptRecordPath = 'companies/co-1/applications/app-1/pev_requests/PEV_ATTEMPTS_Legacy_Hauling_req-1234.pdf';
    renderTab({
      employers: [legacyRow({
        status: 'No Response (Good Faith Documented)',
        history: [
          ...HISTORY,
          { action: 'No Response (Good Faith Documented)', attemptRecordPath, timestamp: '2026-11-01T06:00:00.000Z' },
        ],
      })],
    });

    fireEvent.click(screen.getByRole('button', { name: /View History/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'View Attempt Record' }));

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.href).toBe('https://signed.test/attempts.pdf'));
    expect(fnMocks.callable).toHaveBeenCalledWith({ storagePath: attemptRecordPath });
    expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getSignedPevUrl');
    vi.unstubAllGlobals();
  });
});
