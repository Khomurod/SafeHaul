/**
 * A signing session that crosses UTC midnight.
 *
 * `submitPublicEnvelope` stamps Date Signed from the server clock at the moment
 * the submission lands. A document opened at 23:55 and submitted at 00:05 would
 * otherwise be approved showing one day and sealed showing the next — the exact
 * screen-versus-PDF disagreement this feature exists to prevent. The room
 * re-checks against the SERVER's clock (carried on `serverTime`, not the
 * device's) and makes the signer look at the corrected document once.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@shared/components/feedback';

const getEnvelopeFn = vi.fn();
const submitFn = vi.fn();

vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn((_functions, name) =>
        (name === 'submitPublicEnvelope' ? submitFn : getEnvelopeFn)),
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));

vi.mock('react-pdf', () => ({
    Document: ({ children, onLoadSuccess }) => {
        React.useEffect(() => { onLoadSuccess?.({ numPages: 1 }); }, [onLoadSuccess]);
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

vi.mock('react-signature-canvas', () => ({
    default: React.forwardRef(function MockSignatureCanvas(_props, ref) {
        React.useImperativeHandle(ref, () => ({
            clear: vi.fn(),
            isEmpty: () => false,
            toDataURL: () => 'data:image/png;base64,mock-ink',
            getTrimmedCanvas: () => ({ toDataURL: () => 'data:image/png;base64,mock-ink' }),
        }));
        return <canvas />;
    }),
}));

vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: false,
    getE2EQueryParam: vi.fn(() => ''),
}));
vi.mock('@shared/hooks', () => ({ useIsMobile: () => false }));

import SigningRoom from './SigningRoom';

const OPENED_AT = '2026-09-11T23:55:00Z';

/** The envelope as `getPublicEnvelope` returns it: already stamped, plus its own clock. */
function envelopeStampedOnTheEleventh() {
    return {
        data: {
            title: 'Synthetic Agreement',
            recipientName: 'Artificial Person',
            status: 'sent',
            pdfUrl: 'https://example.invalid/doc.pdf',
            serverTime: OPENED_AT,
            fields: [
                {
                    id: 'date_signed',
                    type: 'date',
                    label: 'Date Signed',
                    pageNumber: 1,
                    required: true,
                    readOnly: true,
                    prefillPolicy: 'locked',
                    bindingKey: 'current_date',
                    defaultValue: 'September 11, 2026',
                    xPosition: 10,
                    yPosition: 10,
                    width: 30,
                    height: 5,
                },
            ],
        },
    };
}

async function openAndConsent() {
    const utils = render(
        <ToastProvider>
            <MemoryRouter initialEntries={['/sign/co1/req1?token=synthetic-token']}>
                <Routes>
                    <Route path="/sign/:companyId/:requestId" element={<SigningRoom />} />
                </Routes>
            </MemoryRouter>
        </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText('Synthetic Agreement')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /I Agree - Proceed to Sign/i }));
    await screen.findAllByRole('button', { name: /Finish & Submit/ });
    return utils;
}

describe('SigningRoom — the day rolls over mid-session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getEnvelopeFn.mockResolvedValue(envelopeStampedOnTheEleventh());
        submitFn.mockResolvedValue({ data: { success: true } });
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try { localStorage.clear(); } catch { /* best effort */ }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stops the first submit, corrects the date, and sends it on the second', async () => {
        vi.setSystemTime(new Date(OPENED_AT));
        const { container } = await openAndConsent();
        expect(container.querySelector('[data-field-id="date_signed"]').textContent)
            .toContain('September 11, 2026');

        // Ten minutes later, on the other side of UTC midnight.
        vi.setSystemTime(new Date('2026-09-12T00:05:00Z'));
        fireEvent.click(screen.getAllByRole('button', { name: /Finish & Submit/ })[0]);

        await waitFor(() => {
            expect(container.querySelector('[data-field-id="date_signed"]').textContent)
                .toContain('September 12, 2026');
        });
        expect(submitFn).not.toHaveBeenCalled();
        expect(await screen.findByText(/date has changed/i)).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: /Finish & Submit/ })[0]);
        await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
        expect(submitFn.mock.calls[0][0].fieldValues.date_signed).toBe('September 12, 2026');
    });

    it('submits straight away on the same day, and ignores a wrong device clock', async () => {
        // The device is a day behind. The server said 11 September and still
        // says 11 September, so nothing moves and nothing interrupts the signer.
        vi.setSystemTime(new Date('2026-09-10T23:55:00Z'));
        await openAndConsent();

        fireEvent.click(screen.getAllByRole('button', { name: /Finish & Submit/ })[0]);
        await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
        expect(submitFn.mock.calls[0][0].fieldValues.date_signed).toBe('September 11, 2026');
    });
});
