/**
 * Contract + a11y proof for `SystemHealthView`.
 *
 * The Deep Diagnostic, "Sync Backend Structure" and the one-off SMS history
 * backfill were removed (2026-10-11): the first wrote test users and records into
 * the live database, the second wrote schema defaults into every live record. What
 * stays is frozen here: the Public Profiles action and its labels, its announced
 * outcome, the output log, and the heading structure.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({ current: {} }));

vi.mock('../hooks/useSystemHealth', () => ({
    useSystemHealth: () => hookState.current,
}));

// The Telegram alerts card loads its own settings and has its own suite,
// `alerts/TelegramAlertsCard.test.jsx`.
vi.mock('./alerts/TelegramAlertsCard', () => ({ TelegramAlertsCard: () => null }));

import { SystemHealthView } from './SystemHealthView';

function renderView(overrides = {}) {
    hookState.current = { runBackfillProfiles: vi.fn(), backfillStatus: 'idle', logs: [], ...overrides };
    const utils = render(<SystemHealthView />);
    return { ...utils, hook: hookState.current };
}

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no layout, so `scrollIntoView` is not implemented.
    Element.prototype.scrollIntoView = vi.fn();
});

describe('SystemHealthView — what is gone', () => {
    it('offers no diagnostic, structure sync or SMS backfill', () => {
        renderView();
        for (const name of [/Deep Diagnostic/, /Sync Backend Structure/, /Backfill SMS History/, /Reset/]) {
            expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        }
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});

describe('SystemHealthView — the Public Profiles action', () => {
    it('runs runBackfillProfiles', () => {
        const { hook } = renderView();
        fireEvent.click(screen.getByRole('button', { name: /Sync Public Profiles/ }));
        expect(hook.runBackfillProfiles).toHaveBeenCalledTimes(1);
    });

    it('shows "Syncing..." and disables itself while running', () => {
        renderView({ backfillStatus: 'running' });
        expect(screen.getByRole('button', { name: /Syncing\.\.\./ })).toBeDisabled();
    });

    it('keeps the frozen success label and announces the outcome', () => {
        renderView({ backfillStatus: 'success' });
        expect(screen.getByRole('button', { name: /Profiles Synced ✓/ })).toBeInTheDocument();
        expect(screen.getByText('Profiles synced')).toBeInTheDocument();
    });

    it('announces a failure', () => {
        renderView({ backfillStatus: 'error' });
        expect(screen.getByText('Failed — see the output log')).toBeInTheDocument();
    });

    it('exposes its description as an accessible description, not a title tooltip', () => {
        const { container } = renderView();
        const button = screen.getByRole('button', { name: /Sync Public Profiles/ });
        const describedBy = button.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(
            'Force-sync all company data to public_profiles (fixes broken driver app links)',
        );
        expect(button).not.toHaveAttribute('title');
    });
});

describe('SystemHealthView — output log', () => {
    it('renders the HH:MM:SS slice and the message for each line', () => {
        renderView({
            logs: [
                { id: 1, time: '2026-07-28T09:41:07.123Z', message: '✅ Backfill Complete: 12 profiles', type: 'success' },
                { id: 2, time: '2026-07-28T09:41:09.400Z', message: '❌ Backfill Failed: boom', type: 'error' },
            ],
        });

        expect(screen.getByText('09:41:07')).toBeInTheDocument();
        expect(screen.getByText('✅ Backfill Complete: 12 profiles')).toBeInTheDocument();
        expect(screen.getByText('09:41:09')).toBeInTheDocument();
        expect(screen.getByText('❌ Backfill Failed: boom')).toBeInTheDocument();
    });

    it('says it is waiting while the log is empty', () => {
        renderView();
        expect(screen.getByText('Waiting for a maintenance action...')).toBeInTheDocument();
    });

    it('puts the log in a named, keyboard-focusable region so it can be scrolled without a mouse', () => {
        renderView();
        const log = screen.getByRole('log');
        expect(log).toHaveAttribute('tabindex', '0');
        expect(log).toHaveAccessibleName('System Output Log');
    });
});

describe('SystemHealthView — heading structure and accessibility', () => {
    it('has exactly one h2 (the h1 lives in the Super Admin masthead)', () => {
        const { container } = renderView();
        const h2s = [...container.querySelectorAll('h2')];
        expect(h2s).toHaveLength(1);
        expect(h2s[0]).toHaveTextContent('System Health');
        expect(container.querySelector('h1')).toBeNull();
    });

    it.each([
        ['idle', {}],
        ['running', { backfillStatus: 'running' }],
        ['error with logs', { backfillStatus: 'error', logs: [{ id: 1, time: '2026-07-28T09:41:07.123Z', message: 'boom', type: 'error' }] }],
        ['success', { backfillStatus: 'success' }],
    ])('has no jsdom axe violations (%s)', async (_name, overrides) => {
        const { container } = renderView(overrides);
        expect((await axe(container)).violations).toEqual([]);
    });
});
