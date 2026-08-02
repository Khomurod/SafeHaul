import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { LaunchPad } from './LaunchPad';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

// Mock dependencies. The real `initBulkSession` callable is never reached — every
// test drives a stub — and all campaign fixtures are artificial.
vi.mock('@lib/firebase', () => ({
    functions: {},
    db: {}
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn(),
}));

const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
// Mock useToast
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({
        showSuccess: toast.showSuccess,
        showError: toast.showError
    })
}));

// E2E flags are module constants, so they are exposed through a getter the tests
// can flip per case.
const e2e = vi.hoisted(() => ({ enabled: false, param: '' }));
vi.mock('@lib/runtime/e2eMode', () => ({
    get isE2ETestMode() { return e2e.enabled; },
    getE2EQueryParam: () => e2e.param,
}));

describe('LaunchPad', () => {
    beforeEach(() => {
        vi.mocked(httpsCallable).mockReturnValue(
            vi.fn().mockResolvedValue({ data: { success: true, targetCount: 10, sessionId: 'abc' } })
        );
    });

    const mockCampaign = {
        name: 'Test Campaign',
        matchCount: 10,
        filters: { status: ['new'] },
        messageConfig: { message: 'Hi' }
    };

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
// dialog, announced launching state) and re-verifies every launch contract.
describe('LaunchPad — migrated launch flow', () => {
    const validCampaign = {
        name: 'Artificial Campaign',
        matchCount: 40,
        filters: { status: ['new'] },
        messageConfig: { method: 'sms', message: 'Artificial outreach message.' },
    };

    let callable;

    beforeEach(() => {
        vi.clearAllMocks();
        e2e.enabled = false;
        e2e.param = '';
        callable = vi.fn().mockResolvedValue({ data: { success: true, targetCount: 40, sessionId: 'session-abcdef123' } });
        vi.mocked(httpsCallable).mockReturnValue(callable);
    });

    const renderPad = (props = {}) => {
        const onLaunchSuccess = props.onLaunchSuccess ?? vi.fn();
        const utils = render(
            <BrowserRouter>
                <LaunchPad
                    companyId={props.companyId === undefined ? 'co-1' : props.companyId}
                    campaign={props.campaign || validCampaign}
                    onLaunchSuccess={onLaunchSuccess}
                />
            </BrowserRouter>,
        );
        return { onLaunchSuccess, ...utils };
    };

    const openConfirm = () => fireEvent.click(screen.getByRole('button', { name: /Launch Immediately/ }));
    const confirmLaunch = async () => {
        await React.act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
        });
    };

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

    describe('duplicate-launch protection and state resets', () => {
        it('ignores a second confirm while a launch is in flight', async () => {
            let resolveLaunch;
            callable.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));
            renderPad();
            openConfirm();

            const confirm = screen.getByRole('button', { name: 'Confirm Launch' });
            fireEvent.click(confirm);
            fireEvent.click(confirm);
            fireEvent.click(confirm);
            expect(callable).toHaveBeenCalledTimes(1);

            await React.act(async () => {
                resolveLaunch({ data: { success: true, targetCount: 1, sessionId: 'session-1' } });
            });
        });

        it('announces the launching state while in flight', async () => {
            let resolveLaunch;
            callable.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));
            renderPad();
            openConfirm();
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));

            await waitFor(() => {
                const announced = screen.getAllByRole('status').some(n => n.textContent.includes('Launching campaign'));
                expect(announced).toBe(true);
            });

            await React.act(async () => {
                resolveLaunch({ data: { success: true, targetCount: 1, sessionId: 'session-1' } });
            });
        });

        it('resets loading, the lock and the dialog after a failure', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            callable.mockRejectedValueOnce(new Error('temporary outage'));
            renderPad();
            openConfirm();
            await confirmLaunch();

            // Dialog closed, button usable again.
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            const trigger = screen.getByRole('button', { name: /Launch Immediately/ });
            expect(trigger).toBeEnabled();

            // The lock released, so a retry reaches the backend again.
            callable.mockResolvedValueOnce({ data: { success: true, targetCount: 40, sessionId: 'session-2' } });
            openConfirm();
            await confirmLaunch();
            expect(callable).toHaveBeenCalledTimes(2);
            consoleError.mockRestore();
        });
    });

    describe('dismissal is blocked while a launch is in flight', () => {
        // The backdrop is the Modal overlay (the dialog's parent). It dismisses
        // only when the mousedown starts and ends on the overlay itself, so the
        // event must target that element directly.
        const clickBackdrop = () => {
            const overlay = screen.getByRole('dialog').parentElement;
            fireEvent.mouseDown(overlay);
        };

        it('closes on Escape before launching', () => {
            renderPad();
            openConfirm();

            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(callable).not.toHaveBeenCalled();
        });

        it('closes on a backdrop click before launching', () => {
            renderPad();
            openConfirm();

            clickBackdrop();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(callable).not.toHaveBeenCalled();
        });

        it('ignores Escape and backdrop clicks while the callable is pending', async () => {
            let resolveLaunch;
            callable.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));
            renderPad();
            openConfirm();

            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
            expect(callable).toHaveBeenCalledTimes(1);

            // In flight: neither dismissal route may hide the in-progress state.
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            clickBackdrop();
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            // Duplicate-launch protection is unchanged by the new props.
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
            expect(callable).toHaveBeenCalledTimes(1);

            await React.act(async () => {
                resolveLaunch({ data: { success: true, targetCount: 40, sessionId: 'session-1' } });
            });
        });

        it('closes through the existing finally path once the launch succeeds', async () => {
            let resolveLaunch;
            callable.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));
            renderPad();
            openConfirm();

            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            await React.act(async () => {
                resolveLaunch({ data: { success: true, targetCount: 40, sessionId: 'session-1' } });
            });

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Launch Immediately/ })).toBeEnabled();
        });

        it('closes through the existing finally path once the launch fails', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            let rejectLaunch;
            callable.mockReturnValue(new Promise((_resolve, reject) => { rejectLaunch = reject; }));
            renderPad();
            openConfirm();

            fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            await React.act(async () => {
                rejectLaunch(new Error('temporary outage'));
            });

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(toast.showError).toHaveBeenCalledWith('temporary outage');
            expect(screen.getByRole('button', { name: /Launch Immediately/ })).toBeEnabled();
            consoleError.mockRestore();
        });

        it('restores normal dismissal after a completed launch', async () => {
            renderPad();
            openConfirm();
            await confirmLaunch();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            // Not launching any more, so Escape dismisses again.
            openConfirm();
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    describe('E2E mock mode', () => {
        it('short-circuits the backend and still reports success', async () => {
            e2e.enabled = true;
            e2e.param = 'mock';
            const { onLaunchSuccess } = renderPad();
            openConfirm();
            await confirmLaunch();

            expect(callable).not.toHaveBeenCalled();
            expect(toast.showSuccess).toHaveBeenCalledWith('Campaign launched! Targeting 40 drivers.');
            expect(onLaunchSuccess).toHaveBeenCalledTimes(1);
        });

        it('uses the real path when the mock flag is absent', async () => {
            e2e.enabled = true;
            e2e.param = '';
            renderPad();
            openConfirm();
            await confirmLaunch();

            expect(callable).toHaveBeenCalledTimes(1);
        });
    });

    describe('accessibility', () => {
        // The "region" rule is scoped out: LaunchPad renders inside the
        // CampaignEditor's <main> landmark in the app (and in the e2e axe pass),
        // which is absent in this isolated unit render.
        const axeOptions = { rules: { region: { enabled: false } } };

        it('has no violations on the ready state', async () => {
            const { container } = renderPad();
            expect((await axe(container, axeOptions)).violations).toEqual([]);
        });

        it('has no violations on the blocked state', async () => {
            const { container } = renderPad({ campaign: { name: 'x', matchCount: 0, messageConfig: {} } });
            expect((await axe(container, axeOptions)).violations).toEqual([]);
        });

        it('has no violations with the confirmation dialog open', async () => {
            const { container, baseElement } = renderPad();
            openConfirm();
            expect((await axe(baseElement, axeOptions)).violations).toEqual([]);
            expect(container).toBeTruthy();
        });
    });
});
