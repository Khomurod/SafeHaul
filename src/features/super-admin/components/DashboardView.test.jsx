/**
 * Contract freeze + defect proof for the migrated Super Admin `DashboardView`.
 *
 * The three metrics, their order, the fields they read and the "..." / "Error"
 * placeholders are the contract; the migration is presentation-only.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import { DashboardView } from './DashboardView';

const NO_ERRORS = { companies: false, users: false, apps: false };

function renderView(props = {}) {
    return render(
        <DashboardView
            stats={{ companyCount: 12, userCount: 34, appCount: 56 }}
            statsLoading={false}
            statsError={NO_ERRORS}
            {...props}
        />,
    );
}

describe('DashboardView — frozen metric contract', () => {
    it('shows the three platform totals in order, reading the exact stat fields', () => {
        renderView();
        const labels = screen.getAllByText(/Total (Companies|Users|Applications)/)
            .map((n) => n.textContent);
        expect(labels).toEqual(['Total Companies', 'Total Users', 'Total Applications']);
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('34')).toBeInTheDocument();
        expect(screen.getByText('56')).toBeInTheDocument();
    });

    it('keeps the "..." placeholder while loading', () => {
        renderView({ statsLoading: true });
        expect(screen.getAllByText('...')).toHaveLength(3);
    });

    it('keeps the "Error" value per failed metric, independently', () => {
        renderView({ statsError: { companies: true, users: false, apps: false } });
        expect(screen.getAllByText('Error')).toHaveLength(1);
        // The other two still show their real values.
        expect(screen.getByText('34')).toBeInTheDocument();
        expect(screen.getByText('56')).toBeInTheDocument();
    });

    it('renders a cached company count of 0 rather than treating it as missing', () => {
        renderView({ stats: { companyCount: 0, userCount: 0, appCount: 0 } });
        expect(screen.getAllByText('0')).toHaveLength(3);
    });
});

describe('DashboardView — failure is announced, not colour-only (defect)', () => {
    it('names the failed metrics in a live region', () => {
        renderView({ statsError: { companies: true, users: false, apps: true } });
        expect(screen.getByRole('status')).toHaveTextContent(
            '2 of 3 platform totals failed to load: Total Companies, Total Applications.',
        );
    });

    it('announces the loading state', () => {
        renderView({ statsLoading: true });
        expect(screen.getByRole('status')).toHaveTextContent('Loading platform totals.');
    });

    it('announces success without naming failures', () => {
        renderView();
        expect(screen.getByRole('status')).toHaveTextContent('Platform totals loaded.');
    });

    it('has no accessibility violations in the error state', async () => {
        const { container } = renderView({ statsError: { companies: true, users: true, apps: true } });
        expect((await axe(container)).violations).toEqual([]);
    });
});
