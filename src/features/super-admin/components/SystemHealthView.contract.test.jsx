/**
 * Contract freeze + a11y proof for `SystemHealthView`, written with its
 * design-system migration (2026-07-28).
 *
 * The whole diagnostic engine lives in `useSystemHealth`, which this migration
 * does not touch. What this file freezes is the *view's* half of the contract —
 * which control invokes which hook function, with which argument, in which
 * status, and every user-facing string:
 *
 *  - `runDiagnostics(false)` to start, `runDiagnostics(true)` to resume,
 *    `pauseDiagnostics()` to pause, `resetDiagnostics()` to reset.
 *  - Reset is offered only for `paused` / `error` / `success`.
 *  - Reset after a *successful* run discards nothing, so it is not guarded —
 *    exactly as before the migration. Reset from `paused` / `error` is guarded,
 *    and the guard keeps the original wording.
 *  - The three maintenance actions call `runSystemRepair`,
 *    `runBackfillProfiles` and `runSmsBackfill`, and their labels change with
 *    their own status exactly as before (`Repairing...`, `Syncing...`,
 *    `Profiles Synced ✓`, `Backfilling SMS...`, `SMS Backfilled ✓`).
 *  - Log lines render the `HH:MM:SS` slice of the ISO timestamp and the message.
 *
 * The migration replaces the blocking `window.confirm`, the colour-only status,
 * the width-only progress `<div>`, the `title`-only action descriptions and the
 * hand-rolled dark console palette. No hook call, argument or string changes.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({ current: {} }));

vi.mock('../hooks/useSystemHealth', () => ({
    useSystemHealth: () => hookState.current,
}));

import { SystemHealthView } from './SystemHealthView';

const STEP = { id: 'init', label: '1. Initializing Environment' };

function baseHook(overrides = {}) {
    return {
        runDiagnostics: vi.fn(),
        pauseDiagnostics: vi.fn(),
        resetDiagnostics: vi.fn(),
        runSystemRepair: vi.fn(),
        repairStatus: 'idle',
        runBackfillProfiles: vi.fn(),
        backfillStatus: 'idle',
        runSmsBackfill: vi.fn(),
        smsBackfillStatus: 'idle',
        status: 'idle',
        progress: 0,
        logs: [],
        currentStep: STEP,
        ...overrides,
    };
}

function renderView(overrides = {}) {
    hookState.current = baseHook(overrides);
    const utils = render(<SystemHealthView />);
    return { ...utils, hook: hookState.current };
}

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no layout, so `scrollIntoView` is not implemented.
    Element.prototype.scrollIntoView = vi.fn();
});

describe('SystemHealthView — diagnostic control contract', () => {
    it('starts a fresh run with runDiagnostics(false)', () => {
        const { hook } = renderView();
        fireEvent.click(screen.getByRole('button', { name: /Start Deep Diagnostic/ }));
        expect(hook.runDiagnostics).toHaveBeenCalledWith(false);
    });

    it('offers Pause while running and calls pauseDiagnostics', () => {
        const { hook } = renderView({ status: 'running', progress: 35 });
        expect(screen.queryByRole('button', { name: /Start Deep Diagnostic/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Pause Test/ }));
        expect(hook.pauseDiagnostics).toHaveBeenCalledTimes(1);
    });

    it('resumes a paused run with runDiagnostics(true)', () => {
        const { hook } = renderView({ status: 'paused', progress: 35 });
        fireEvent.click(screen.getByRole('button', { name: /Resume Test/ }));
        expect(hook.runDiagnostics).toHaveBeenCalledWith(true);
    });

    it.each(['paused', 'error', 'success'])('offers Reset when status is %s', (status) => {
        renderView({ status });
        expect(screen.getByRole('button', { name: /Reset/ })).toBeInTheDocument();
    });

    it.each(['idle', 'running'])('does not offer Reset when status is %s', (status) => {
        renderView({ status });
        expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument();
    });
});

describe('SystemHealthView — reset guard (blocking confirm replaced)', () => {
    it('resets immediately after a successful run, with no confirmation', () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        const { hook } = renderView({ status: 'success', progress: 100 });
        fireEvent.click(screen.getByRole('button', { name: /Reset/ }));

        expect(hook.resetDiagnostics).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it.each(['paused', 'error'])('guards reset from %s with an accessible dialog, not window.confirm', (status) => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);

        const { hook } = renderView({ status, progress: 40 });
        fireEvent.click(screen.getByRole('button', { name: /Reset/ }));

        const dialog = screen.getByRole('dialog');
        // Original `window.confirm` wording, preserved verbatim.
        expect(within(dialog).getByText('This will clear saved test progress. Continue?')).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(hook.resetDiagnostics).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
        expect(hook.resetDiagnostics).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('does not reset when the guard is cancelled', () => {
        const { hook } = renderView({ status: 'paused' });
        fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
        expect(hook.resetDiagnostics).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('SystemHealthView — maintenance action contract', () => {
    it('wires each action to its own hook function', () => {
        const { hook } = renderView();
        fireEvent.click(screen.getByRole('button', { name: /Sync Backend Structure/ }));
        fireEvent.click(screen.getByRole('button', { name: /Sync Public Profiles/ }));
        fireEvent.click(screen.getByRole('button', { name: /Backfill SMS History/ }));

        expect(hook.runSystemRepair).toHaveBeenCalledTimes(1);
        expect(hook.runBackfillProfiles).toHaveBeenCalledTimes(1);
        expect(hook.runSmsBackfill).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['repairStatus', 'Repairing...'],
        ['backfillStatus', 'Syncing...'],
        ['smsBackfillStatus', 'Backfilling SMS...'],
    ])('%s=running shows "%s" and disables its own button only', (key, label) => {
        renderView({ [key]: 'running' });
        const button = screen.getByRole('button', { name: new RegExp(label.replace('...', '\\.\\.\\.')) });
        expect(button).toBeDisabled();

        // The other two stay available — there was never a shared lock.
        const enabled = screen.getAllByRole('button').filter((b) => !b.disabled);
        expect(enabled.length).toBeGreaterThan(0);
    });

    it.each([
        ['backfillStatus', 'Profiles Synced ✓'],
        ['smsBackfillStatus', 'SMS Backfilled ✓'],
    ])('%s=success keeps the frozen success label "%s"', (key, label) => {
        renderView({ [key]: 'success' });
        expect(screen.getByRole('button', { name: new RegExp(label.replace('✓', '✓')) })).toBeInTheDocument();
    });

    it('keeps the repair label unchanged on success (it never had a success label)', () => {
        renderView({ repairStatus: 'success' });
        expect(screen.getByRole('button', { name: /Sync Backend Structure/ })).toBeInTheDocument();
    });

    it('announces a maintenance failure, which was previously silent on screen', () => {
        renderView({ repairStatus: 'error' });
        expect(screen.getByText('Failed — see the output log')).toBeInTheDocument();
    });

    it('exposes each action description as an accessible description, not a title tooltip', () => {
        const { container } = renderView();
        const button = screen.getByRole('button', { name: /Sync Backend Structure/ });
        const describedBy = button.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(
            'Force database structure to match Schema Config',
        );
        expect(button).not.toHaveAttribute('title');
    });
});

describe('SystemHealthView — status and progress presentation', () => {
    it('shows "Ready" for idle rather than the raw status word', () => {
        renderView({ status: 'idle' });
        expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it.each([
        ['running', 'Running'],
        ['paused', 'Paused'],
        ['success', 'Success'],
        ['error', 'Error'],
    ])('gives %s a text status, not colour alone', (status, label) => {
        renderView({ status });
        expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('exposes progress through a real progressbar with the step in its value text', () => {
        renderView({ status: 'running', progress: 41, currentStep: STEP });
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '41');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-valuetext', '41% complete — 1. Initializing Environment');
        expect(screen.getByText('41% Complete')).toBeInTheDocument();
    });

    it('falls back to "Waiting..." when there is no current step', () => {
        renderView({ currentStep: undefined });
        expect(screen.getByText('Waiting...')).toBeInTheDocument();
    });
});

describe('SystemHealthView — output log', () => {
    it('renders the HH:MM:SS slice and the message for each line', () => {
        renderView({
            logs: [
                { id: 1, time: '2026-07-28T09:41:07.123Z', message: '✅ Storage Write Access Verified.', type: 'success' },
                { id: 2, time: '2026-07-28T09:41:09.400Z', message: '❌ FAILURE: boom', type: 'error' },
            ],
        });

        expect(screen.getByText('09:41:07')).toBeInTheDocument();
        expect(screen.getByText('✅ Storage Write Access Verified.')).toBeInTheDocument();
        expect(screen.getByText('09:41:09')).toBeInTheDocument();
        expect(screen.getByText('❌ FAILURE: boom')).toBeInTheDocument();
    });

    it('keeps the frozen empty-log message', () => {
        renderView();
        expect(screen.getByText('Waiting for diagnostic or repair start...')).toBeInTheDocument();
    });

    it('puts the log in a named, keyboard-focusable region so it can be scrolled without a mouse', () => {
        renderView();
        const log = screen.getByRole('log');
        expect(log).toHaveAttribute('tabindex', '0');
        expect(log).toHaveAccessibleName('System Output Log');
    });
});

describe('SystemHealthView — heading structure and accessibility', () => {
    it('has exactly one h2 (the h1 lives in the Super Admin masthead) and no h2 panel headings', () => {
        const { container } = renderView({ status: 'paused' });
        const h2s = [...container.querySelectorAll('h2')];
        expect(h2s).toHaveLength(1);
        expect(h2s[0]).toHaveTextContent('System Health & Diagnostics');
        expect(container.querySelector('h1')).toBeNull();
    });

    it.each([
        ['idle', {}],
        ['running', { status: 'running', progress: 20 }],
        ['error with logs', { status: 'error', logs: [{ id: 1, time: '2026-07-28T09:41:07.123Z', message: 'boom', type: 'error' }] }],
        ['success', { status: 'success', progress: 100, backfillStatus: 'success' }],
    ])('has no jsdom axe violations (%s)', async (_name, overrides) => {
        const { container } = renderView(overrides);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations with the reset guard open', async () => {
        const { container } = renderView({ status: 'paused' });
        fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
