/**
 * Contract freeze + defect proof for the migrated Super Admin `DashboardView`.
 *
 * The four metrics, their order, the fields they read and the "..." / "Error"
 * placeholders are the contract. "Total Applications" read the leads' count, and
 * a count's failure was the list's flag: each count now has its own.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

// The temporary historical-migration panel is a separate unit with its own
// contract test, calls Firebase on mount, and carries its own live region. Stubbed
// here so this suite keeps testing exactly what it always tested — the three
// metrics and the dashboard's own announcements — rather than two components at
// once.
vi.mock('./HistoricalMigrationPanel', () => ({
    HistoricalMigrationPanel: () => <div data-testid="historical-migration-panel" />,
}));

import { DashboardView } from './DashboardView';

const NO_ERRORS = {
    companies: false, users: false, apps: false,
    companyCount: false, userCount: false, appCount: false, leadCount: false,
};

function renderView(props = {}) {
    return render(
        <DashboardView
            stats={{ companyCount: 12, userCount: 34, appCount: 56, leadCount: 78 }}
            statsLoading={false}
            statsError={NO_ERRORS}
            {...props}
        />,
    );
}

describe('DashboardView — frozen metric contract', () => {
    it('shows the four platform totals in order, reading the exact stat fields', () => {
        renderView();
        const labels = screen.getAllByText(/Total (Companies|Users|Applications|Leads)/)
            .map((n) => n.textContent);
        expect(labels).toEqual(['Total Companies', 'Total Users', 'Total Applications', 'Total Leads']);
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('34')).toBeInTheDocument();
        expect(screen.getByText('56')).toBeInTheDocument();
        expect(screen.getByText('78')).toBeInTheDocument();
    });

    it('keeps the "..." placeholder while loading', () => {
        renderView({ statsLoading: true });
        expect(screen.getAllByText('...')).toHaveLength(4);
    });

    it('shows "Error" for a count that failed, by its own flag', () => {
        renderView({ statsError: { ...NO_ERRORS, appCount: true } });
        expect(screen.getAllByText('Error')).toHaveLength(1);
        // The others still show their real values.
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('34')).toBeInTheDocument();
        expect(screen.getByText('78')).toBeInTheDocument();
    });

    it('does not take a list that failed to load for its count', () => {
        renderView({ statsError: { ...NO_ERRORS, companies: true, apps: true } });
        expect(screen.queryByText('Error')).toBeNull();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('56')).toBeInTheDocument();
    });

    it('renders a cached company count of 0 rather than treating it as missing', () => {
        renderView({ stats: { companyCount: 0, userCount: 0, appCount: 0, leadCount: 0 } });
        expect(screen.getAllByText('0')).toHaveLength(4);
    });
});

describe('DashboardView — failure is announced, not colour-only (defect)', () => {
    it('names the failed metrics in a live region', () => {
        renderView({ statsError: { ...NO_ERRORS, companyCount: true, appCount: true } });
        expect(screen.getByRole('status')).toHaveTextContent(
            '2 of 4 platform totals failed to load: Total Companies, Total Applications.',
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
        const { container } = renderView({ statsError: { ...NO_ERRORS, companyCount: true, userCount: true, appCount: true, leadCount: true } });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('DashboardView — temporary historical-migration action', () => {
    // The panel decides for itself whether to appear; the view's only job is to
    // give it a place. If this mount is ever dropped, the migration becomes
    // unreachable from the UI.
    it('gives the temporary migration panel a place below the metrics', () => {
        renderView();
        expect(screen.getByTestId('historical-migration-panel')).toBeInTheDocument();
    });
});
