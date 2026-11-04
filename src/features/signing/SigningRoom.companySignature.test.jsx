// The company signature in the signing room: a fixed image the signer sees and
// never fills, outside the progress count and the "next field" path, and never
// part of what is submitted. Every value below is artificial.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@shared/components/feedback';

const callables = vi.hoisted(() => ({ getPublicEnvelope: vi.fn(), submitPublicEnvelope: vi.fn() }));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('react-pdf', () => ({
    Document: ({ children, onLoadSuccess }) => {
        React.useEffect(() => {
            onLoadSuccess?.({ numPages: 1 });
        }, [onLoadSuccess]);
        return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ onLoadSuccess, onRenderSuccess, pageNumber }) => {
        React.useEffect(() => {
            onLoadSuccess?.({ getViewport: () => ({ width: 850, height: 1100 }) });
            onRenderSuccess?.();
        }, [onLoadSuccess, onRenderSuccess, pageNumber]);
        return <div data-testid="pdf-page" />;
    },
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));
vi.mock('signature_pad', () => ({
    default: class MockSignaturePad {
        clear() {}
        isEmpty() { return false; }
        toDataURL() { return 'data:image/png;base64,mock-ink'; }
        off() {}
    },
}));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: false,
    getE2EQueryParam: () => '',
}));
vi.mock('@shared/hooks', () => ({
    useIsMobile: () => false,
}));

import SigningRoom from './SigningRoom';

const COMPANY_SIGNATURE_URL = 'https://files.example.test/company-signature.png';

const envelope = (companySignature = {}) => ({
    data: {
        title: 'Employment Agreement',
        recipientName: 'Test Signer',
        status: 'sent',
        pdfUrl: 'https://example.com/doc.pdf',
        fields: [
            { id: 'text1', type: 'text', label: 'Name', pageNumber: 1, required: true, xPosition: 10, yPosition: 10, width: 20, height: 5 },
            // Placed between the two fields the signer fills, so "next field"
            // would land on it if it were not skipped.
            {
                id: 'cs1', type: 'company_signature', label: 'Company Signature', pageNumber: 1, xPosition: 10, yPosition: 20,
                width: 25, height: 8, required: false, readOnly: true, prefillPolicy: 'locked', defaultValue: '',
                companySignatureUrl: COMPANY_SIGNATURE_URL,
                ...companySignature,
            },
            { id: 'sig1', type: 'signature', label: 'Signature', pageNumber: 1, required: true, xPosition: 10, yPosition: 40, width: 20, height: 8 },
        ],
    },
});

async function openRoom() {
    const utils = render(
        <ToastProvider>
            <MemoryRouter initialEntries={['/sign/co1/req1?token=valid-token']}>
                <Routes>
                    <Route path="/sign/:companyId/:requestId" element={<SigningRoom />} />
                </Routes>
            </MemoryRouter>
        </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('Employment Agreement')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /I Agree - Proceed to Sign/i }));
    await waitFor(() => expect(utils.container.querySelector('[data-signer-input="text1"]')).toBeTruthy());
    return utils;
}

const progress = () => screen.getAllByRole('status').find((node) => /remaining|left|complete|Done/i.test(node.textContent));

beforeEach(() => {
    vi.resetAllMocks();
    try { localStorage.clear(); } catch { /* best effort */ }
    callables.getPublicEnvelope.mockResolvedValue(envelope());
    callables.submitPublicEnvelope.mockResolvedValue({ data: { success: true } });
});

describe('SigningRoom — the company signature', () => {
    it('shows the company signature as a fixed image the signer cannot operate', async () => {
        const { container } = await openRoom();

        const image = screen.getByRole('img', { name: 'Company signature' });
        expect(image).toHaveAttribute('src', COMPANY_SIGNATURE_URL);
        const overlay = container.querySelector('[data-field-id="cs1"]');
        expect(overlay).toContainElement(image);
        expect(overlay.querySelector('button, input, [tabindex]')).toBeNull();
    });

    it('is not counted among the fields left to complete', async () => {
        await openRoom();
        // Name and signature; not the company signature.
        expect(progress()).toHaveTextContent('2');
    });

    it('is skipped by Enter, which goes from the name to the signature', async () => {
        const { container } = await openRoom();
        const name = container.querySelector('[data-signer-input="text1"]');
        name.focus();
        fireEvent.keyDown(name, { key: 'Enter' });
        // The signature is a button, so the room scrolls to it; the company
        // signature is never the target.
        await waitFor(() => expect(container.querySelector('[data-field-id="sig1"]').className).toMatch(/ring-ds-focus/));
        expect(container.querySelector('[data-field-id="cs1"]').className).not.toMatch(/ring-ds-focus/);
    });

    it('is never submitted', async () => {
        const { container } = await openRoom();
        fireEvent.change(container.querySelector('[data-signer-input="text1"]'), { target: { value: 'Ann' } });
        fireEvent.click(screen.getByRole('button', { name: /Tap to sign/i }));
        await screen.findByRole('dialog', { name: /Draw your signature/i });
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        await waitFor(() => expect(progress()).toHaveTextContent(/complete|Done/));

        fireEvent.click(screen.getAllByRole('button', { name: /Finish & Submit/i })[0]);

        await waitFor(() => expect(screen.getByText('Document Signed!')).toBeInTheDocument());
        const { fieldValues } = callables.submitPublicEnvelope.mock.calls[0][0];
        expect(fieldValues).toEqual({ text1: 'Ann', sig1: 'data:image/png;base64,mock-ink' });
    });

    it('never holds up the signer, even stored as required', async () => {
        callables.getPublicEnvelope.mockResolvedValue(envelope({ required: true }));
        const { container } = await openRoom();
        fireEvent.change(container.querySelector('[data-signer-input="text1"]'), { target: { value: 'Ann' } });
        fireEvent.click(screen.getByRole('button', { name: /Tap to sign/i }));
        await screen.findByRole('dialog', { name: /Draw your signature/i });
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));

        fireEvent.click(screen.getAllByRole('button', { name: /Finish & Submit/i })[0]);

        await waitFor(() => expect(screen.getByText('Document Signed!')).toBeInTheDocument());
        expect(callables.submitPublicEnvelope).toHaveBeenCalledTimes(1);
    });

    it('shows nothing, and no error, when its image link is missing', async () => {
        callables.getPublicEnvelope.mockResolvedValue(envelope({ companySignatureUrl: undefined }));
        const { container } = await openRoom();

        expect(screen.queryByRole('img', { name: 'Company signature' })).not.toBeInTheDocument();
        expect(container.querySelector('[data-field-id="cs1"]')).toBeNull();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(progress()).toHaveTextContent('2');
    });
});
