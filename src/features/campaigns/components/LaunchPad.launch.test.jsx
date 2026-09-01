// LaunchPad, part 1 of 2: the legacy confirm-then-launch contract, and the
// migrated flow's validation, confirmation dialog, launch payload and result
// branches.
// The shared harness lives in `LaunchPad.support.jsx`; the registrations
// below delegate to it. All campaign fixtures are artificial.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import { BrowserRouter } from 'react-router-dom';

vi.mock('@lib/firebase', async () => (await import('./LaunchPad.support')).libFirebaseMock());
vi.mock('firebase/functions', async () => (await import('./LaunchPad.support')).firebaseFunctionsMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./LaunchPad.support')).toastProviderMock());
vi.mock('@lib/runtime/e2eMode', async () => (await import('./LaunchPad.support')).e2eModeMock());

import { LaunchPad } from './LaunchPad';
import {
    makeRenderPad,
    resetMigratedHarness,
    openConfirm,
    confirmLaunch,
    mockCampaign,
    validCampaign,
    callable,
    toast,
} from './LaunchPad.support';

const renderPad = makeRenderPad(LaunchPad);

describe('LaunchPad', () => {
    beforeEach(() => {
        vi.mocked(httpsCallable).mockReturnValue(
            vi.fn().mockResolvedValue({ data: { success: true, targetCount: 10, sessionId: 'abc' } })
        );
    });



    it('requires confirmation before launching', async () => {
        const initBulkSession = vi.fn().mockResolvedValue({ data: { success: true, targetCount: 5, sessionId: 'sess1' } });
        vi.mocked(httpsCallable).mockReturnValue(initBulkSession);

        render(
            <BrowserRouter>
                <LaunchPad companyId="123" campaign={mockCampaign} />
            </BrowserRouter>
        );

        fireEvent.click(screen.getByText('Launch Immediately'));
        expect(screen.getByText('Confirm campaign launch')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Confirm Launch'));
        expect(initBulkSession).toHaveBeenCalledTimes(1);
    });

    it('renders launch immediately button', () => {
        render(
            <BrowserRouter>
                <LaunchPad companyId="123" campaign={mockCampaign} />
            </BrowserRouter>
        );

        expect(screen.getByText('Launch Immediately')).toBeInTheDocument();
        // Ensure schedule input is NOT present
        expect(screen.queryByLabelText(/Schedule/i)).not.toBeInTheDocument();
    });
});

// --- Design-system migration coverage ------------------------------------
// Freezes the migrated presentation (Card/Button/Badge, accessible confirm

// --- Design-system migration coverage ------------------------------------
// Freezes the migrated presentation (Card/Button/Badge, accessible confirm
// dialog, announced launching state) and re-verifies every launch contract.
describe('LaunchPad — migrated launch flow', () => {
    beforeEach(resetMigratedHarness);

    describe('validation', () => {
        it('blocks launching with no audience and states it with an icon and text', () => {
            renderPad({ campaign: { ...validCampaign, matchCount: 0 } });

            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent('Pre-Flight Checks Failed');
            expect(alert).toHaveTextContent('No audience selected');
            expect(screen.getByRole('button', { name: /Launch Immediately/ })).toBeDisabled();
        });

        it('blocks launching with an empty message', () => {
            renderPad({ campaign: { ...validCampaign, messageConfig: { method: 'sms', message: '' } } });

            expect(screen.getByRole('alert')).toHaveTextContent('Message content is empty');
            expect(screen.getByRole('button', { name: /Launch Immediately/ })).toBeDisabled();
        });

        it('lists both failures together', () => {
            renderPad({ campaign: { name: 'x', matchCount: 0, messageConfig: {} } });
            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent('No audience selected');
            expect(alert).toHaveTextContent('Message content is empty');
        });

        it('shows an all-clear status with the estimated duration when valid', () => {
            renderPad();
            const status = screen.getAllByRole('status').find(n => n.textContent.includes('All Systems Go'));
            expect(status).toBeTruthy();
            // 40 recipients * 3s = 120s = 2 min
            expect(status).toHaveTextContent('Est. Duration: ~2 min');
            expect(screen.getByRole('button', { name: /Launch Immediately/ })).toBeEnabled();
        });

        it('rounds the estimated duration up', () => {
            renderPad({ campaign: { ...validCampaign, matchCount: 25 } });
            // 25 * 3 = 75s -> ceil(1.25) = 2 min
            expect(screen.getByText('Est. Duration: ~2 min')).toBeInTheDocument();
        });

        it('reports a missing company id without calling the backend', async () => {
            renderPad({ companyId: '' });
            openConfirm();
            await confirmLaunch();

            expect(toast.showError).toHaveBeenCalledWith('Company ID missing');
            expect(callable).not.toHaveBeenCalled();
        });
    });

    describe('confirmation dialog', () => {
        it('is an accessible dialog named and described by its own copy', () => {
            renderPad();
            openConfirm();

            const dialog = screen.getByRole('dialog', { name: 'Confirm campaign launch' });
            expect(dialog).toHaveAttribute('aria-modal', 'true');
            expect(dialog).toHaveAccessibleDescription(/Send to 40 recipients via SMS/);
        });

        it('closes on Escape without launching', () => {
            renderPad();
            openConfirm();

            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(callable).not.toHaveBeenCalled();
        });

        it('cancels without launching and restores focus to the trigger', () => {
            renderPad();
            const trigger = screen.getByRole('button', { name: /Launch Immediately/ });
            trigger.focus();
            openConfirm();

            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(callable).not.toHaveBeenCalled();
            expect(trigger).toHaveFocus();
        });

        it('previews the message truncated to 280 characters with an ellipsis', () => {
            const long = 'A'.repeat(400);
            renderPad({ campaign: { ...validCampaign, messageConfig: { method: 'sms', message: long } } });
            openConfirm();

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText(`${'A'.repeat(280)}…`)).toBeInTheDocument();
        });

        it('does not add an ellipsis to a short message', () => {
            renderPad();
            openConfirm();
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('Artificial outreach message.')).toBeInTheDocument();
        });

        it('names the email method in the confirmation', () => {
            renderPad({ campaign: { ...validCampaign, messageConfig: { method: 'email', message: 'Hi' } } });
            openConfirm();
            expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/via Email/);
        });
    });

    describe('launch payload', () => {
        it('calls initBulkSession with the exact payload and strips rawData from filters', async () => {
            renderPad({
                campaign: {
                    ...validCampaign,
                    filters: { status: ['new'], recruiterId: 'all', rawData: [{ firstName: 'Artificial' }] },
                },
            });
            openConfirm();
            await confirmLaunch();

            expect(vi.mocked(httpsCallable)).toHaveBeenCalledWith({}, 'initBulkSession');
            expect(callable).toHaveBeenCalledWith({
                companyId: 'co-1',
                sessionName: 'Artificial Campaign',
                filters: { status: ['new'], recruiterId: 'all' },
                rawData: [{ firstName: 'Artificial' }],
                config: { method: 'sms', message: 'Artificial outreach message.' },
                scheduledFor: null,
            });
        });

        it('sends null rawData when the filters carry none', async () => {
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(callable.mock.calls[0][0].rawData).toBeNull();
            expect(callable.mock.calls[0][0].filters).toEqual({ status: ['new'] });
        });

        it('tolerates absent filters', async () => {
            renderPad({ campaign: { ...validCampaign, filters: undefined } });
            openConfirm();
            await confirmLaunch();

            expect(callable.mock.calls[0][0].filters).toEqual({});
            expect(callable.mock.calls[0][0].rawData).toBeNull();
        });
    });

    describe('result branches', () => {
        it('reports success with the session id and calls onLaunchSuccess', async () => {
            const { onLaunchSuccess } = renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showSuccess).toHaveBeenCalledWith(
                'Campaign launched! Targeting 40 drivers. Session: session-...',
            );
            expect(onLaunchSuccess).toHaveBeenCalledTimes(1);
        });

        it('appends the excluded count when the backend filtered recipients', async () => {
            callable.mockResolvedValue({ data: { success: true, targetCount: 30, filteredCount: 10, sessionId: 'session-xyz98765' } });
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showSuccess).toHaveBeenCalledWith(
                'Campaign launched! Targeting 30 drivers (10 excluded — already messaged). Session: session-...',
            );
        });

        it('surfaces a backend failure message', async () => {
            callable.mockResolvedValue({ data: { success: false, message: 'Quota exceeded' } });
            const { onLaunchSuccess } = renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showError).toHaveBeenCalledWith('Quota exceeded');
            expect(onLaunchSuccess).not.toHaveBeenCalled();
        });

        it('falls back to a generic failure message', async () => {
            callable.mockResolvedValue({ data: { success: false } });
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showError).toHaveBeenCalledWith('Launch failed');
        });

        it.each([
            ['bulk-actions-queue not found', 'Campaign infrastructure not ready. Please contact support.'],
            ['PROCESS_BULK_BATCH_URL missing', 'Campaign worker URL is not configured on the server. Please contact support.'],
            ['some other backend failure', 'some other backend failure'],
        ])('maps the %s error to a friendly message', async (thrown, expected) => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            callable.mockRejectedValue(new Error(thrown));
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showError).toHaveBeenCalledWith(expected);
            consoleError.mockRestore();
        });

        it('falls back when the thrown error carries no message', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            callable.mockRejectedValue(new Error(''));
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(toast.showError).toHaveBeenCalledWith('Failed to launch campaign');
            consoleError.mockRestore();
        });
    });

});
