/**
 * Contract freeze + defect proof for the migrated Super Admin `AnalyticsView`.
 *
 * The CSV export is the risky part — column order, header text and filename
 * pattern are a real downstream contract — so those are frozen before any
 * presentation change. The rest proves the tab/date-range selection is no
 * longer communicated by colour alone and that the trend chart is reachable
 * without sight.
 *
 * All company and recruiter names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Captured once, before any spy exists. Re-binding inside the helper would bind
// the *spy* on the second call and recurse until the stack blew.
const REAL_CREATE_ELEMENT = document.createElement.bind(document);

const useAnalytics = vi.fn();
vi.mock('@features/analytics', () => ({ useAnalytics: () => useAnalytics() }));

import { AnalyticsView } from './AnalyticsView';

const STATS = {
    summary: { totalCalls: 42, activeRecruiters: 3 },
    dailyTrend: [
        { date: '2026-07-01', value: 4 },
        { date: '2026-07-02', value: 9 },
        { date: '2026-07-03', value: 2 },
    ],
    companyPerformance: [
        { companyId: 'c1', companyName: 'Artificial Freight Co', callsMade: 30, actions: 55 },
        { companyId: 'c2', companyName: 'Second Artificial Carrier', callsMade: 5, actions: 8 },
    ],
    userPerformance: [
        { userId: 'u1', userName: 'Artificial Recruiter', companyName: 'Artificial Freight Co', callsMade: 21, lastActive: { seconds: 1700000000, toDate: () => new Date(1700000000000) } },
    ],
};

const setDateRange = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    useAnalytics.mockReturnValue({ loading: false, stats: STATS, dateRange: '30d', setDateRange });
});

afterEach(() => {
    // The export helper spies on document.createElement; leaving it installed
    // breaks every later render.
    vi.restoreAllMocks();
});

describe('AnalyticsView — frozen export contract', () => {
    /** Captures the anchor the export builds without letting jsdom navigate. */
    function captureExport() {
        const captured = {};
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const node = REAL_CREATE_ELEMENT(tag);
            if (tag === 'a') {
                node.click = () => { captured.href = node.getAttribute('href'); captured.download = node.getAttribute('download'); };
            }
            return node;
        });
        return captured;
    }

    it('exports companies with the exact headers, order and filename', () => {
        const captured = captureExport();
        render(<AnalyticsView />);

        fireEvent.click(screen.getByRole('button', { name: /Export Companies/ }));

        expect(captured.download).toBe('company_performance_30d.csv');
        const decoded = decodeURI(captured.href);
        expect(decoded).toContain('Company Name,Calls Made,Total Actions');
        expect(decoded).toContain('Artificial Freight Co,30,55');
    });

    it('exports recruiters with the exact headers, order and filename', () => {
        const captured = captureExport();
        render(<AnalyticsView />);

        fireEvent.click(screen.getByRole('tab', { name: 'Recruiter Stats' }));
        fireEvent.click(screen.getByRole('button', { name: /Export Recruiters/ }));

        expect(captured.download).toBe('recruiter_performance_30d.csv');
        expect(decodeURI(captured.href)).toContain('Recruiter Name,Company,Calls Made,Last Active');
    });

    it('keeps the exact date-range values', () => {
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('button', { name: '7D' }));
        expect(setDateRange).toHaveBeenCalledWith('7d');
        fireEvent.click(screen.getByRole('button', { name: '90D' }));
        expect(setDateRange).toHaveBeenCalledWith('90d');
    });

    it('keeps the callsMade > 20 High/Low engagement rule', () => {
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('tab', { name: 'Company Performance' }));

        const high = screen.getByText('Artificial Freight Co').closest('tr');
        const low = screen.getByText('Second Artificial Carrier').closest('tr');
        expect(within(high).getByText('High')).toBeInTheDocument();
        expect(within(low).getByText('Low')).toBeInTheDocument();
    });
});

describe('AnalyticsView — selection is never colour-only (defects)', () => {
    it('exposes a real tab interface with aria-selected', () => {
        render(<AnalyticsView />);
        const tablist = screen.getByRole('tablist', { name: 'Analytics views' });
        expect(within(tablist).getByRole('tab', { name: 'Activity Overview' })).toHaveAttribute('aria-selected', 'true');
        expect(within(tablist).getByRole('tab', { name: 'Recruiter Stats' })).toHaveAttribute('aria-selected', 'false');
    });

    it('moves between tabs with the arrow keys', () => {
        render(<AnalyticsView />);
        const tablist = screen.getByRole('tablist', { name: 'Analytics views' });

        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: 'Company Performance' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(tablist, { key: 'End' });
        expect(screen.getByRole('tab', { name: 'Recruiter Stats' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(tablist, { key: 'Home' });
        expect(screen.getByRole('tab', { name: 'Activity Overview' })).toHaveAttribute('aria-selected', 'true');
    });

    it('marks the selected date range with aria-pressed', () => {
        render(<AnalyticsView />);
        expect(screen.getByRole('button', { name: '30D' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '7D' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('AnalyticsView — chart is reachable without sight (defect)', () => {
    it('names the trend chart and summarises it', () => {
        render(<AnalyticsView />);
        expect(
            screen.getByRole('img', { name: /Daily activity trend across 3 days, 15 actions in total, peaking at 9\./ }),
        ).toBeInTheDocument();
    });

    it('also exposes the underlying figures as a table', () => {
        render(<AnalyticsView />);
        const table = screen.getByRole('table', { name: 'Daily activity trend' });
        expect(within(table).getByText('2026-07-02')).toBeInTheDocument();
    });

    it('keeps the frozen empty-chart message', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: { ...STATS, dailyTrend: [] },
            dateRange: '30d',
            setDateRange,
        });
        render(<AnalyticsView />);
        expect(screen.getByText('No data available')).toBeInTheDocument();
    });
});

describe('AnalyticsView — accessible peak reports real data, not the scale floor (defect)', () => {
    /** The polyline geometry floors the visual scale at 5; the sr summary must not. */
    function trendStats(dailyTrend) {
        return { ...STATS, dailyTrend };
    }

    it('reports 0 for all-zero data while the visual scale stays floored at 5', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 0 },
                { date: 'd3', value: 0 },
            ]),
            dateRange: '30d',
            setDateRange,
        });
        const { container } = render(<AnalyticsView />);
        expect(
            screen.getByRole('img', { name: /peaking at 0\./ }),
        ).toBeInTheDocument();
        // Geometry floors at 5: value 0 sits on the baseline (y = height - padding = 180).
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,180 780,180');
    });

    it('reports the real peak when it is below the floor, and geometry still uses 5', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 4 },
                { date: 'd3', value: 0 },
            ]),
            dateRange: '30d',
            setDateRange,
        });
        const { container } = render(<AnalyticsView />);
        // Real peak is 4 — previously mis-announced as 5.
        expect(screen.getByRole('img', { name: /peaking at 4\./ })).toBeInTheDocument();
        // Middle point y = 200 - (4/5 * 160) - 20 = 52. Dividing by 4 (the peak)
        // instead of the floor of 5 would put it at y = 20.
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,52 780,180');
    });

    it('reports the real peak when it equals the floor of 5', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: trendStats([
                { date: 'd1', value: 1 },
                { date: 'd2', value: 5 },
                { date: 'd3', value: 3 },
            ]),
            dateRange: '30d',
            setDateRange,
        });
        render(<AnalyticsView />);
        expect(screen.getByRole('img', { name: /peaking at 5\./ })).toBeInTheDocument();
    });

    it('reports the real peak when it is above the floor', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 9 },
                { date: 'd3', value: 0 },
            ]),
            dateRange: '30d',
            setDateRange,
        });
        const { container } = render(<AnalyticsView />);
        expect(screen.getByRole('img', { name: /peaking at 9\./ })).toBeInTheDocument();
        // Peak 9 (above the floor) drives both text and geometry: middle point
        // y = 200 - (9/9*160) - 20 = 20, endpoints on the baseline at 180.
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,20 780,180');
    });
});

describe('AnalyticsView — states', () => {
    it('announces loading', () => {
        useAnalytics.mockReturnValue({ loading: true, stats: STATS, dateRange: '30d', setDateRange });
        render(<AnalyticsView />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading analytics...');
    });

    it('keeps the frozen empty-table messages', () => {
        useAnalytics.mockReturnValue({
            loading: false,
            stats: { ...STATS, companyPerformance: [], userPerformance: [] },
            dateRange: '30d',
            setDateRange,
        });
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('tab', { name: 'Company Performance' }));
        expect(screen.getByText('No data found for this period.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Recruiter Stats' }));
        expect(screen.getByText('No activity found for this period.')).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<AnalyticsView />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
