// LaunchPad, part 2 of 2: duplicate-launch protection and state resets,
// in-flight dismissal blocking, E2E mock mode, and accessibility.
// The shared harness lives in `LaunchPad.support.jsx`; the registrations
// below delegate to it. All campaign fixtures are artificial.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    callable,
    toast,
    e2e,
} from './LaunchPad.support';

const renderPad = makeRenderPad(LaunchPad);

// --- Design-system migration coverage ------------------------------------
// Freezes the migrated presentation (Card/Button/Badge, accessible confirm
// dialog, announced launching state) and re-verifies every launch contract.
describe('LaunchPad — migrated launch flow', () => {
    beforeEach(resetMigratedHarness);

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
