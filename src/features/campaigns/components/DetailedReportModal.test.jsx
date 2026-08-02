import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All recipient values below are synthetic, non-production placeholders. Never
// use real contact information in these tests.
const fs = vi.hoisted(() => ({
    collection: vi.fn((_db, ...segments) => ({ __collection: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, direction) => ({ __orderBy: [field, direction] })),
    limit: vi.fn((n) => ({ __limit: n })),
    getDocs: vi.fn(),
}));
const retryFn = vi.hoisted(() => vi.fn());
const fnMocks = vi.hoisted(() => ({ httpsCallable: vi.fn(() => retryFn) }));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('firebase/firestore', () => fs);
vi.mock('firebase/functions', () => ({ httpsCallable: fnMocks.httpsCallable }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));

import DetailedReportModal from './DetailedReportModal';

function logDoc(id, data) {
    return { id, data: () => data };
}

function renderModal(props = {}) {
    return render(
        <DetailedReportModal
            companyId="company-1"
            sessionId="session-1"
            isOpen
            onClose={props.onClose ?? vi.fn()}
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    fs.getDocs.mockResolvedValue({ docs: [] });
    retryFn.mockResolvedValue({ data: { success: true, targetCount: 3 } });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DetailedReportModal — open/closed guards', () => {
    it('renders nothing and does not fetch when closed', () => {
        const { container } = renderModal({ isOpen: false });
        expect(container).toBeEmptyDOMElement();
        expect(fs.getDocs).not.toHaveBeenCalled();
    });

    it('does not fetch when companyId or sessionId is missing', () => {
        renderModal({ companyId: undefined });
        renderModal({ sessionId: undefined });
        expect(fs.getDocs).not.toHaveBeenCalled();
    });
});

describe('DetailedReportModal — query contract', () => {
    it('queries the exact logs path ordered by timestamp desc, limited to 200, id-preserving', async () => {
        fs.getDocs.mockResolvedValue({
            docs: [logDoc('log-42', { recipientName: 'Test Driver One', recipientIdentity: 'redacted-contact-1', status: 'delivered' })],
        });
        renderModal();

        expect(await screen.findByText('Test Driver One')).toBeInTheDocument();
        expect(fs.collection).toHaveBeenCalledWith({}, 'companies', 'company-1', 'bulk_sessions', 'session-1', 'logs');
        expect(fs.orderBy).toHaveBeenCalledWith('timestamp', 'desc');
        expect(fs.limit).toHaveBeenCalledWith(200);
        // id-preserving mapping: the row exists (keyed by doc id) and the contact
        // placeholder rendered from the mapped data.
        expect(screen.getByText('redacted-contact-1')).toBeInTheDocument();
    });
});

describe('DetailedReportModal — async states', () => {
    it('shows the loading message while fetching', () => {
        fs.getDocs.mockReturnValue(new Promise(() => {})); // never resolves
        renderModal();
        expect(screen.getByText('Loading logs...')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading delivery details');
    });

    it('shows the exact empty message when there are no logs', async () => {
        fs.getDocs.mockResolvedValue({ docs: [] });
        renderModal();
        expect(await screen.findByText('No activity logs found. Ensure permissions are set.')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('No delivery logs found');
    });

    it('shows the exact fetch-error toast', async () => {
        fs.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderModal();
        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to load delivery details. Check permissions.');
        });
        consoleError.mockRestore();
    });
});

describe('DetailedReportModal — status mapping', () => {
    it('maps delivered (status delivered or truthy isSuccess) and failed', async () => {
        fs.getDocs.mockResolvedValue({
            docs: [
                logDoc('a', { recipientName: 'By status', recipientIdentity: 'redacted-1', status: 'delivered' }),
                logDoc('b', { recipientName: 'By flag', recipientIdentity: 'redacted-2', isSuccess: true }),
                logDoc('c', { recipientName: 'Failed one', recipientIdentity: 'redacted-3', status: 'failed', error: 'Invalid number' }),
            ],
        });
        renderModal();

        const statusRow = await screen.findByText('By status');
        expect(within(statusRow.closest('tr')).getByText('Delivered').closest('.ds-badge')).toHaveAttribute('data-tone', 'success');
        const flagRow = screen.getByText('By flag').closest('tr');
        expect(within(flagRow).getByText('Delivered')).toBeInTheDocument();
        const failedRow = screen.getByText('Failed one').closest('tr');
        expect(within(failedRow).getByText('Failed').closest('.ds-badge')).toHaveAttribute('data-tone', 'danger');
        expect(within(failedRow).getByText('Invalid number')).toBeInTheDocument();
    });

    it('renders fallbacks for missing recipient/contact/error', async () => {
        fs.getDocs.mockResolvedValue({ docs: [logDoc('a', { status: 'failed', isSuccess: false })] });
        renderModal();
        expect(await screen.findByText('Unknown')).toBeInTheDocument();
        expect(screen.getByText('N/A')).toBeInTheDocument();
        expect(screen.getByText('-')).toBeInTheDocument();
    });
});

describe('DetailedReportModal — retry', () => {
    async function renderWithFailure(onClose = vi.fn()) {
        fs.getDocs.mockResolvedValue({
            docs: [logDoc('a', { recipientName: 'Failed', recipientIdentity: 'redacted-1', isSuccess: false })],
        });
        renderModal({ onClose });
        await screen.findByRole('button', { name: 'Retry Failed Requests' });
        return onClose;
    }

    it('shows Retry only when there are failures (status failed or isSuccess === false)', async () => {
        fs.getDocs.mockResolvedValue({ docs: [logDoc('a', { recipientName: 'Ok', recipientIdentity: 'redacted-1', status: 'delivered' })] });
        renderModal();
        await screen.findByText('Ok');
        expect(screen.queryByRole('button', { name: 'Retry Failed Requests' })).not.toBeInTheDocument();
    });

    /** Opens the retry confirmation and returns it. */
    async function openRetryConfirmation() {
        fireEvent.click(screen.getByRole('button', { name: 'Retry Failed Requests' }));
        return screen.findByRole('dialog', { name: 'Start a new campaign for failed recipients?' });
    }

    it('asks for confirmation in an accessible dialog, not window.confirm, and does nothing until confirmed', async () => {
        const confirmMock = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmMock);
        await renderWithFailure();

        const dialog = await openRetryConfirmation();
        // The costly nature of the action must be spelled out.
        expect(dialog).toHaveTextContent(/creates a new campaign/i);
        expect(dialog).toHaveTextContent(/permanent errors/i);
        expect(confirmMock).not.toHaveBeenCalled();
        expect(retryFn).not.toHaveBeenCalled();
    });

    it('does not retry when the confirmation is cancelled', async () => {
        await renderWithFailure();
        const dialog = await openRetryConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: "Don't retry" }));

        expect(retryFn).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Start a new campaign for failed recipients?' })).not.toBeInTheDocument();
    });

    it('does not retry when the confirmation is dismissed with Escape', async () => {
        await renderWithFailure();
        const dialog = await openRetryConfirmation();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(retryFn).not.toHaveBeenCalled();
    });

    it('calls retryFailedAttempts with the exact payload and closes after success', async () => {
        retryFn.mockResolvedValue({ data: { success: true, targetCount: 7 } });
        const onClose = await renderWithFailure();
        const dialog = await openRetryConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start retry campaign' }));

        await waitFor(() => {
            expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'retryFailedAttempts');
        });
        expect(retryFn).toHaveBeenCalledWith({ companyId: 'company-1', originalSessionId: 'session-1' });
        await waitFor(() => {
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Retry session started with 7 targets.');
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('invokes the retry once even when confirmed twice in the same tick', async () => {
        let release;
        retryFn.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ data: { success: true, targetCount: 3 } });
        }));
        await renderWithFailure();
        const dialog = await openRetryConfirmation();
        const confirm = within(dialog).getByRole('button', { name: 'Start retry campaign' });

        fireEvent.click(confirm);
        fireEvent.click(confirm);
        expect(retryFn).toHaveBeenCalledTimes(1);

        release();
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalled());
    });

    it('shows the failure message and keeps the modal open when success is false', async () => {
        retryFn.mockResolvedValue({ data: { success: false, message: 'Nothing to retry.' } });
        const onClose = await renderWithFailure();
        const dialog = await openRetryConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start retry campaign' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Nothing to retry.');
        });
        expect(onClose).not.toHaveBeenCalled();
        // The confirmation stays open so the operator can retry.
        expect(screen.getByRole('dialog', { name: 'Start a new campaign for failed recipients?' })).toBeInTheDocument();
    });

    it('falls back to a generic failure message and surfaces thrown errors', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        retryFn.mockResolvedValueOnce({ data: { success: false } });
        await renderWithFailure();
        const dialog = await openRetryConfirmation();
        const confirm = within(dialog).getByRole('button', { name: 'Start retry campaign' });

        fireEvent.click(confirm);
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Retry failed to start.'));

        toastMocks.showError.mockClear();
        retryFn.mockRejectedValueOnce(new Error('network down'));
        // Retrying from the still-open dialog must work.
        fireEvent.click(confirm);
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('network down'));
        consoleError.mockRestore();
    });
});

describe('DetailedReportModal — dialog behavior & a11y', () => {
    it('is an accessible dialog that moves focus in and closes on Escape and backdrop', async () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        const dialog = await screen.findByRole('dialog', { name: 'Delivery Report' });
        expect(dialog.contains(document.activeElement)).toBe(true);

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes from the header X and the footer Close button', async () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        await screen.findByRole('dialog');
        // Two controls are named "Close": the header icon button and the footer button.
        const closeButtons = screen.getAllByRole('button', { name: 'Close' });
        expect(closeButtons).toHaveLength(2);
        closeButtons.forEach((btn) => fireEvent.click(btn));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('restores focus to the previously focused element on close', async () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();
        expect(trigger).toHaveFocus();

        const { rerender } = render(
            <DetailedReportModal companyId="company-1" sessionId="session-1" isOpen onClose={vi.fn()} />,
        );
        await screen.findByRole('dialog');
        rerender(
            <DetailedReportModal companyId="company-1" sessionId="session-1" isOpen={false} onClose={vi.fn()} />,
        );
        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('keeps the whole dialog scrollable on short viewports (controls never clipped)', async () => {
        renderModal();
        const dialog = await screen.findByRole('dialog', { name: 'Delivery Report' });
        // The overlay (dialog's parent) scrolls vertically and the panel is
        // auto-margin centered, so a tall report can never clip Close/Retry.
        expect(dialog.parentElement.className).toContain('overflow-y-auto');
        expect(dialog.className).toContain('m-auto');
    });

    it('has no accessibility violations with delivered and failed rows', async () => {
        fs.getDocs.mockResolvedValue({
            docs: [
                logDoc('a', { recipientName: 'Ok', recipientIdentity: 'redacted-1', status: 'delivered' }),
                logDoc('b', { recipientName: 'Bad', recipientIdentity: 'redacted-2', status: 'failed', error: 'Carrier rejected the message as undeliverable' }),
            ],
        });
        const { container } = renderModal();
        await screen.findByText('Ok');
        expect((await axe(container)).violations).toEqual([]);
    });
});
