import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const callables = vi.hoisted(() => ({
    pauseBulkSession: vi.fn(),
    resumeBulkSession: vi.fn(),
    cancelBulkSession: vi.fn(),
    retryFailedAttempts: vi.fn(),
}));
const httpsCallableMock = vi.hoisted(() => vi.fn((_fns, name) => callables[name]));
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const useDataMock = vi.hoisted(() => vi.fn(() => ({ currentCompanyProfile: { id: 'company123' } })));

vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@/context/DataContext', () => ({ useData: () => useDataMock() }));
vi.mock('./CampaignResultsTable', () => ({
    CampaignResultsTable: (props) => (
        <div data-testid="results-table" data-company={props.companyId} data-campaign={props.campaignId} />
    ),
}));

import { CampaignDetails } from './CampaignDetails';

function makeCampaign(overrides = {}) {
    return {
        id: '123',
        companyId: 'company123',
        name: 'Test Campaign',
        status: 'active',
        createdAt: { toDate: () => new Date('2023-01-01') },
        updatedAt: { toDate: () => new Date('2023-01-02') },
        progress: { processedCount: 50, totalCount: 100, successCount: 45, failedCount: 5 },
        messageConfig: { message: 'Hello World', method: 'SMS' },
        ...overrides,
    };
}

function renderDetails(campaign = makeCampaign(), onClose = vi.fn()) {
    return { onClose, ...render(<CampaignDetails campaign={campaign} onClose={onClose} />) };
}

beforeEach(() => {
    vi.clearAllMocks();
    useDataMock.mockReturnValue({ currentCompanyProfile: { id: 'company123' } });
    callables.pauseBulkSession.mockResolvedValue({ data: {} });
    callables.resumeBulkSession.mockResolvedValue({ data: { success: true } });
    callables.cancelBulkSession.mockResolvedValue({ data: {} });
    callables.retryFailedAttempts.mockResolvedValue({ data: { success: true, targetCount: 3 } });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('CampaignDetails — guards & context', () => {
    it('returns null without a campaign', () => {
        const { container } = render(<CampaignDetails campaign={null} onClose={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('blocks a cross-tenant campaign', () => {
        renderDetails(makeCampaign({ companyId: 'other-co' }));
        expect(screen.getByText(/belongs to a different company/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
    });

    it('shows the missing-company state when no id can be resolved', () => {
        useDataMock.mockReturnValue({ currentCompanyProfile: null });
        renderDetails(makeCampaign({ companyId: undefined }));
        expect(screen.getByText(/Company context is missing/i)).toBeInTheDocument();
    });

    it('passes effectiveCompanyId (falling back to context) and campaign id to the results table', () => {
        renderDetails(makeCampaign({ companyId: undefined }));
        const table = screen.getByTestId('results-table');
        expect(table).toHaveAttribute('data-company', 'company123');
        expect(table).toHaveAttribute('data-campaign', '123');
    });
});

describe('CampaignDetails — rendering', () => {
    it('renders name, capitalized status, progress, stats, message, method, and id', () => {
        renderDetails();
        expect(screen.getByText('Test Campaign')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('50 / 100 leads processed')).toBeInTheDocument();
        expect(screen.getByText('50% Complete')).toBeInTheDocument();
        expect(screen.getByText('Hello World')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
        expect(screen.getByText('123')).toBeInTheDocument();

        const progressbar = screen.getByRole('progressbar', { name: 'Campaign progress' });
        expect(progressbar).toHaveAttribute('aria-valuenow', '50');
        expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    });

    it('computes audience/sent/failed from progress', () => {
        renderDetails();
        expect(screen.getByText('Audience').closest('.ds-card')).toHaveTextContent('100');
        expect(screen.getByText('Sent').closest('.ds-card')).toHaveTextContent('45');
        expect(screen.getByText('Failed').closest('.ds-card')).toHaveTextContent('5');
    });

    it('falls back to matchCount / zeros when there is no progress', () => {
        renderDetails(makeCampaign({ progress: undefined, matchCount: 42, status: 'draft' }));
        expect(screen.getByText('Audience').closest('.ds-card')).toHaveTextContent('42');
        expect(screen.getByText('Sent').closest('.ds-card')).toHaveTextContent('0');
        expect(screen.queryByText(/leads processed/)).not.toBeInTheDocument();
    });

    it('shows the failure reason for a failed campaign', () => {
        renderDetails(makeCampaign({ status: 'failed', error: 'Provider rejected the batch', progress: { processedCount: 10, totalCount: 10, successCount: 5, failedCount: 5 } }));
        expect(screen.getByText('Why this campaign failed')).toBeInTheDocument();
        expect(screen.getByText('Provider rejected the batch')).toBeInTheDocument();
    });

    it('falls back to the default message copy', () => {
        renderDetails(makeCampaign({ messageConfig: {} }));
        expect(screen.getByText('No message content defined.')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
    });
});

describe('CampaignDetails — action visibility', () => {
    it.each(['active', 'queued', 'scheduled'])('shows Pause + Cancel for a live %s campaign', (status) => {
        renderDetails(makeCampaign({ status, progress: { processedCount: 1, totalCount: 2, successCount: 1, failedCount: 0 } }));
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Details & Cancel' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry Failed' })).not.toBeInTheDocument();
    });

    it('shows Resume + Cancel for a paused campaign (no Pause)', () => {
        renderDetails(makeCampaign({ status: 'paused' }));
        expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Details & Cancel' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    });

    it('shows Retry Failed only on a non-active campaign with failures', () => {
        renderDetails(makeCampaign({ status: 'completed', progress: { processedCount: 10, totalCount: 10, successCount: 8, failedCount: 2 } }));
        expect(screen.getByRole('button', { name: 'Retry Failed' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Details & Cancel' })).not.toBeInTheDocument();
    });

    it('shows no lifecycle actions for a completed campaign without failures', () => {
        renderDetails(makeCampaign({ status: 'completed', progress: { processedCount: 10, totalCount: 10, successCount: 10, failedCount: 0 } }));
        expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Details & Cancel' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry Failed' })).not.toBeInTheDocument();
    });
});

describe('CampaignDetails — callables & outcomes', () => {
    it('pauses with the exact payload and closes on success', async () => {
        const { onClose } = renderDetails();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(httpsCallableMock).toHaveBeenCalledWith({}, 'pauseBulkSession'));
        expect(callables.pauseBulkSession).toHaveBeenCalledWith({ companyId: 'company123', sessionId: '123' });
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Campaign paused.'));
        expect(onClose).toHaveBeenCalled();
    });

    it('resumes with the exact payload and closes on success', async () => {
        const { onClose } = renderDetails(makeCampaign({ status: 'paused' }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(callables.resumeBulkSession).toHaveBeenCalledWith({ companyId: 'company123', sessionId: '123' }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Campaign resumed.'));
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps the view open and shows the message when resume returns success:false', async () => {
        callables.resumeBulkSession.mockResolvedValue({ data: { success: false, message: 'Already completed.' } });
        const { onClose } = renderDetails(makeCampaign({ status: 'paused' }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Already completed.'));
        expect(onClose).not.toHaveBeenCalled();
    });

    const failedCampaign = () => makeCampaign({
        status: 'completed',
        progress: { processedCount: 10, totalCount: 10, successCount: 6, failedCount: 4 },
    });

    it('cancels only after confirmation, with the exact payload', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);
        const { onClose } = renderDetails();

        fireEvent.click(screen.getByRole('button', { name: 'Details & Cancel' }));

        // The bare `confirm(...)` is gone; nothing fires until the dialog is confirmed.
        const dialog = await screen.findByRole('dialog', { name: 'Cancel this campaign?' });
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(callables.cancelBulkSession).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel campaign' }));
        await waitFor(() => expect(callables.cancelBulkSession).toHaveBeenCalledWith({ companyId: 'company123', sessionId: '123' }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Campaign cancelled.'));
        expect(onClose).toHaveBeenCalled();
    });

    it('does not cancel when the confirmation is dismissed', async () => {
        renderDetails();
        fireEvent.click(screen.getByRole('button', { name: 'Details & Cancel' }));
        const dialog = await screen.findByRole('dialog', { name: 'Cancel this campaign?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep sending' }));
        expect(callables.cancelBulkSession).not.toHaveBeenCalled();
    });

    it('retries failed recipients with the exact payload and reports the target count', async () => {
        callables.retryFailedAttempts.mockResolvedValue({ data: { success: true, targetCount: 9 } });
        const { onClose } = renderDetails(failedCampaign());

        fireEvent.click(screen.getByRole('button', { name: 'Retry Failed' }));
        const dialog = await screen.findByRole('dialog', { name: 'Start a new campaign for failed recipients?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Start retry campaign' }));

        await waitFor(() => expect(callables.retryFailedAttempts).toHaveBeenCalledWith({ companyId: 'company123', originalSessionId: '123' }));
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Retry session started with 9 targets.'));
        expect(onClose).toHaveBeenCalled();
    });

    it('does not retry when the confirmation is cancelled', async () => {
        renderDetails(failedCampaign());
        fireEvent.click(screen.getByRole('button', { name: 'Retry Failed' }));
        const dialog = await screen.findByRole('dialog', { name: 'Start a new campaign for failed recipients?' });
        fireEvent.click(within(dialog).getByRole('button', { name: "Don't retry" }));
        expect(callables.retryFailedAttempts).not.toHaveBeenCalled();
    });

    it('surfaces retry failure branches (success:false and thrown)', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.retryFailedAttempts.mockResolvedValueOnce({ data: { success: false } });
        renderDetails(failedCampaign());

        fireEvent.click(screen.getByRole('button', { name: 'Retry Failed' }));
        const dialog = await screen.findByRole('dialog', { name: 'Start a new campaign for failed recipients?' });
        const confirm = within(dialog).getByRole('button', { name: 'Start retry campaign' });

        fireEvent.click(confirm);
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Retry failed to start.'));

        toastMocks.showError.mockClear();
        callables.retryFailedAttempts.mockRejectedValueOnce(new Error('callable exploded'));
        // The dialog stays open on failure, so the retry is reachable again.
        fireEvent.click(confirm);
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('callable exploded'));
        consoleError.mockRestore();
    });

    it('reports a pause error via the toast', async () => {
        callables.pauseBulkSession.mockRejectedValueOnce(new Error('pause failed'));
        const { onClose } = renderDetails();
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('pause failed'));
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('CampaignDetails — a11y & close', () => {
    it('closes from the accessible back button', () => {
        const { onClose } = renderDetails();
        fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderDetails(makeCampaign({ status: 'failed', error: 'Provider rejected the batch', progress: { processedCount: 10, totalCount: 10, successCount: 5, failedCount: 5 } }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
