/**
 * What the signing room says when its link does not lead to a document to sign:
 * the server's reason on the public pages' shared screen, the sender by name, a
 * retry only where one can help, and — never the consent again — a document that
 * is already signed. Artificial data only.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@shared/components/feedback';

const getEnvelopeFn = vi.fn();
const fetchPublicCompanyName = vi.fn(async () => 'Acme Freight');

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => getEnvelopeFn) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/services/publicCompanyName', () => ({
    fetchPublicCompanyName: (...args) => fetchPublicCompanyName(...args),
}));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: vi.fn(() => '') }));
vi.mock('@shared/hooks', () => ({ useIsMobile: () => false }));

import SigningRoom from './SigningRoom';

const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });
const SIGNED_KEY = 'signing_signed_v1:co1:req1';

function renderRoom() {
    return render(
        <ToastProvider>
            <MemoryRouter initialEntries={['/sign/co1/req1?token=link-token']}>
                <Routes>
                    <Route path="/sign/:companyId/:requestId" element={<SigningRoom />} />
                </Routes>
            </MemoryRouter>
        </ToastProvider>,
    );
}

const heading = (name) => screen.findByRole('heading', { level: 1, name });

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('close', vi.fn());
});

afterEach(() => {
    expect(window.close).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a signing link that does not open', () => {
    it("shows the server's reason and names the company, with no retry for an expired link", async () => {
        getEnvelopeFn.mockRejectedValueOnce(refusal('deadline-exceeded', 'This signing link has expired. Please request a new one.'));
        renderRoom();

        expect(await heading('This link has expired')).toHaveFocus();
        expect(screen.getByText(/ask Acme Freight for a new link/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
        expect(fetchPublicCompanyName).toHaveBeenCalledWith('co1');
    });

    it('says a refused token may be replaced or already signed', async () => {
        getEnvelopeFn.mockRejectedValueOnce(refusal('permission-denied', 'Invalid Access Token.'));
        renderRoom();

        await heading('This link could not be opened');
        expect(screen.getByText(/replaced by a newer link, or the document may already be signed/))
            .toHaveTextContent(/Open the newest message from Acme Freight/);
    });

    it('still explains the link when the company name cannot be read', async () => {
        fetchPublicCompanyName.mockResolvedValueOnce(null);
        getEnvelopeFn.mockRejectedValueOnce(refusal('not-found', 'Document not found.'));
        renderRoom();

        await heading('This link is not valid');
        expect(screen.getByText(/ask the sender for a new one/)).toBeInTheDocument();
    });

    it('offers Try again only when the link could not be checked, and loads again', async () => {
        getEnvelopeFn
            .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch')))
            .mockResolvedValueOnce({ data: { title: 'Artificial Lease', recipientName: 'Pat Example', status: 'sent', fields: [] } });
        renderRoom();

        await heading('We could not check this link');
        expect(screen.getByRole('alert')).toHaveTextContent('This document could not be opened. Check your internet connection and try again.');
        // Nobody to name yet: the connection that failed would fail this read too.
        expect(fetchPublicCompanyName).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await heading('Electronic Signature Consent')).toBeInTheDocument();
        expect(getEnvelopeFn).toHaveBeenCalledTimes(2);
    });

    it('never puts the access token on the screen', async () => {
        getEnvelopeFn.mockRejectedValueOnce(refusal('permission-denied', 'Invalid Access Token.'));
        const { container } = renderRoom();
        await heading('This link could not be opened');
        expect(container.textContent).not.toContain('link-token');
    });
});

describe('a document already signed', () => {
    it.each([
        ['the server says signed', { status: 'signed' }],
        ['the seal is still being made', { status: 'pending_seal', title: 'Artificial Lease', fields: [] }],
        ['the seal failed', { status: 'error_sealing', title: 'Artificial Lease', fields: [] }],
    ])('is shown as signed, never with the consent again, when %s', async (_label, data) => {
        getEnvelopeFn.mockResolvedValueOnce({ data });
        renderRoom();

        await heading('This document is already signed');
        expect(screen.queryByText('Electronic Signature Consent')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /I Agree/ })).not.toBeInTheDocument();
    });

    it('is shown as signed, with the day, when this device signed it and the used link is refused', async () => {
        localStorage.setItem(SIGNED_KEY, '2026-11-02T15:00:00.000Z');
        getEnvelopeFn.mockRejectedValueOnce(refusal('permission-denied', 'Invalid Access Token.'));
        renderRoom();

        await heading('This document is already signed');
        expect(screen.getByText(/It was signed on November 2, 2026\./)).toBeInTheDocument();
    });

    it('reads any other refusal as the link problem it is, whatever this device signed', async () => {
        localStorage.setItem(SIGNED_KEY, '2026-11-02T15:00:00.000Z');
        getEnvelopeFn.mockRejectedValueOnce(refusal('deadline-exceeded', 'This signing link has expired. Please request a new one.'));
        renderRoom();

        await heading('This link has expired');
    });
});

describe('declining to sign electronically', () => {
    it('says what happened instead of trying to close the tab, and can go back', async () => {
        getEnvelopeFn.mockResolvedValueOnce({ data: { title: 'Artificial Lease', recipientName: 'Pat Example', status: 'sent', fields: [] } });
        renderRoom();
        await heading('Electronic Signature Consent');

        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(await heading('You did not agree to sign electronically')).toHaveFocus();
        expect(screen.getByText(/You can close this tab\./)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /I Agree - Proceed to Sign/ })).toBeInTheDocument());
    });
});
