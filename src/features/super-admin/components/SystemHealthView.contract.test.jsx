/**
 * Contract + a11y proof for `SystemHealthView`: the hourly AI and blog
 * watcher's alerts, and nothing else.
 *
 * The Deep Diagnostic, "Sync Backend Structure" and the one-off SMS history
 * backfill are not offered anywhere: the first would write test users and
 * records into the live database, the second schema defaults into every live
 * record. Sync Public Profiles and its output log live on the Maintenance page
 * (`MaintenanceView.contract.test.jsx`).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

// The Telegram alerts card loads its own settings and has its own suite,
// `alerts/TelegramAlertsCard.test.jsx`.
vi.mock('./alerts/TelegramAlertsCard', () => ({
    TelegramAlertsCard: () => <section data-testid="telegram-alerts-card" />,
}));

import { SystemHealthView } from './SystemHealthView';

describe('SystemHealthView — the watcher and its alerts', () => {
    it('gives the Telegram alerts card its place', () => {
        render(<SystemHealthView />);
        expect(screen.getByTestId('telegram-alerts-card')).toBeInTheDocument();
    });

    it('offers no maintenance action: those are on the Maintenance page', () => {
        render(<SystemHealthView />);
        for (const name of [/Sync Public Profiles/, /Deep Diagnostic/, /Sync Backend Structure/, /Backfill SMS History/, /Reset/]) {
            expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        }
        expect(screen.queryByRole('log')).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});

describe('SystemHealthView — heading structure and accessibility', () => {
    it('has exactly one h2 (the h1 lives in the Super Admin masthead)', () => {
        const { container } = render(<SystemHealthView />);
        const h2s = [...container.querySelectorAll('h2')];
        expect(h2s).toHaveLength(1);
        expect(h2s[0]).toHaveTextContent('System Health');
        expect(container.querySelector('h1')).toBeNull();
    });

    it('has no jsdom axe violations', async () => {
        const { container } = render(<SystemHealthView />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
