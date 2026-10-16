/**
 * Contract freeze + defect proof for `AnalyticsView`, the Dashboard's Activity
 * section.
 *
 * The CSV export is the risky part — column order, header text and filename
 * pattern are a real downstream contract — so those are frozen before any
 * presentation change. Its figures are the ones `stats_daily` holds: calls, and
 * the last day a recruiter logged one; "Total Actions" only ever repeated the
 * calls and is gone. The rest proves the tab/date-range selection is no longer
 * communicated by colour alone, that the trend chart is reachable without
 * sight, and that a failed read is an error with a retry, never zeros.
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
const REAL_CREATE_OBJECT_URL = URL.createObjectURL;
const REAL_REVOKE_OBJECT_URL = URL.revokeObjectURL;

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
        { companyId: 'c1', companyName: 'Artificial Freight Co', callsMade: 30 },
        { companyId: 'c2', companyName: 'Second Artificial Carrier', callsMade: 5 },
    ],
    userPerformance: [
        // The hook's shape: the Chicago day (a stats_daily id) of the last call.
        { userId: 'u1', userName: 'Artificial Recruiter', companyName: 'Artificial Freight Co', callsMade: 21, lastActive: '2026-11-03' },
    ],
};

const setDateRange = vi.fn();
const reload = vi.fn();

/** The hook's answer: loaded, no error, the fixture figures, unless overridden. */
function analytics(overrides = {}) {
    return { loading: false, error: null, stats: STATS, dateRange: '30d', setDateRange, reload, ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
    useAnalytics.mockReturnValue(analytics());
});

afterEach(() => {
    // The export helper spies on document.createElement; leaving it installed
    // breaks every later render.
    vi.restoreAllMocks();
    URL.createObjectURL = REAL_CREATE_OBJECT_URL;
    URL.revokeObjectURL = REAL_REVOKE_OBJECT_URL;
});

describe('AnalyticsView — frozen export contract', () => {
    /** Captures the file the export saves, and its name, without letting the browser navigate. */
    function captureExport() {
        const captured = {};
        URL.createObjectURL = (blob) => { captured.blob = blob; return 'blob:stub'; };
        URL.revokeObjectURL = () => {};
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const node = REAL_CREATE_ELEMENT(tag);
            if (tag === 'a') {
                node.click = () => { captured.download = node.download; };
            }
            return node;
        });
        return captured;
    }

    /** The saved file's rows, without the BOM that tells Excel it is UTF-8. */
    async function savedRows(captured) {
        const text = await captured.blob.text();
        expect(text.startsWith('\uFEFF')).toBe(true);
        return text.slice(1).split('\r\n');
    }

    it('exports companies with the exact headers, order and filename', async () => {
        const captured = captureExport();
        render(<AnalyticsView />);

        fireEvent.click(screen.getByRole('button', { name: /Export Companies/ }));

        expect(captured.download).toBe('company_performance_30d.csv');
        // No "Total Actions" column: it was the calls again, under another name.
        expect(await savedRows(captured)).toEqual([
            '"Company Name","Calls Made"',
            '"Artificial Freight Co","30"',
            '"Second Artificial Carrier","5"',
        ]);
    });

    it('exports recruiters with the exact headers, order and filename, Last Active as the day of the last call', async () => {
        const captured = captureExport();
        render(<AnalyticsView />);

        fireEvent.click(screen.getByRole('tab', { name: 'Recruiter Stats' }));
        fireEvent.click(screen.getByRole('button', { name: /Export Recruiters/ }));

        expect(captured.download).toBe('recruiter_performance_30d.csv');
        // It always said "N/A": nothing filled it.
        expect(await savedRows(captured)).toEqual([
            '"Recruiter Name","Company","Calls Made","Last Active"',
            '"Artificial Recruiter","Artificial Freight Co","21","2026-11-03"',
        ]);
    });

    it('keeps a comma, a quote, a # and a formula in a name inside its own cell', async () => {
        useAnalytics.mockReturnValue(analytics({
            stats: {
                ...STATS,
                companyPerformance: [
                    { companyId: 'c3', companyName: 'Artificial Carrier #2, "East"', callsMade: 4 },
                    { companyId: 'c4', companyName: '=HYPERLINK("http://example.test","x")', callsMade: 1 },
                ],
            },
        }));
        const captured = captureExport();
        render(<AnalyticsView />);

        fireEvent.click(screen.getByRole('button', { name: /Export Companies/ }));

        // In a `data:` URL the file ended at the first `#`; the second row was lost.
        expect(await savedRows(captured)).toEqual([
            '"Company Name","Calls Made"',
            '"Artificial Carrier #2, ""East""","4"',
            `"'=HYPERLINK(""http://example.test"",""x"")","1"`,
        ]);
    });

    it('shows no Total Actions column: stats_daily counts calls and nothing else', () => {
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('tab', { name: 'Company Performance' }));

        const table = screen.getByRole('table', { name: 'Company performance for the selected period' });
        expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
            .toEqual(['Company', 'Calls Made', 'Engagement']);
        expect(within(table).queryByText('Total Actions')).not.toBeInTheDocument();
    });

    it("shows each recruiter's Last Active as the day of their last call", () => {
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('tab', { name: 'Recruiter Stats' }));

        const row = screen.getByRole('rowheader', { name: 'Artificial Recruiter' }).closest('tr');
        expect(within(row).getByText('Nov 3, 2026')).toBeInTheDocument();
        expect(within(row).queryByText('Unknown')).not.toBeInTheDocument();
    });

    it('shows no Platform Health card: nothing measured it', () => {
        render(<AnalyticsView />);
        expect(screen.queryByText('Platform Health')).not.toBeInTheDocument();
        expect(screen.getByText('Total Calls')).toBeInTheDocument();
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
        const tablist = screen.getByRole('tablist', { name: 'Activity views' });
        expect(within(tablist).getByRole('tab', { name: 'Activity Overview' })).toHaveAttribute('aria-selected', 'true');
        expect(within(tablist).getByRole('tab', { name: 'Recruiter Stats' })).toHaveAttribute('aria-selected', 'false');
    });

    it('moves between tabs with the arrow keys', () => {
        render(<AnalyticsView />);
        const tablist = screen.getByRole('tablist', { name: 'Activity views' });

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
            screen.getByRole('img', { name: /Daily activity trend across 3 days, 15 calls in total, peaking at 9\./ }),
        ).toBeInTheDocument();
    });

    it('also exposes the underlying figures as a table', () => {
        render(<AnalyticsView />);
        const table = screen.getByRole('table', { name: 'Daily activity trend' });
        expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Date', 'Calls']);
        expect(within(table).getByText('2026-07-02')).toBeInTheDocument();
    });

    it('keeps the frozen empty-chart message', () => {
        useAnalytics.mockReturnValue(analytics({ stats: { ...STATS, dailyTrend: [] } }));
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
        useAnalytics.mockReturnValue(analytics({
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 0 },
                { date: 'd3', value: 0 },
            ]),
        }));
        const { container } = render(<AnalyticsView />);
        expect(
            screen.getByRole('img', { name: /peaking at 0\./ }),
        ).toBeInTheDocument();
        // Geometry floors at 5: value 0 sits on the baseline (y = height - padding = 180).
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,180 780,180');
    });

    it('reports the real peak when it is below the floor, and geometry still uses 5', () => {
        useAnalytics.mockReturnValue(analytics({
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 4 },
                { date: 'd3', value: 0 },
            ]),
        }));
        const { container } = render(<AnalyticsView />);
        // Real peak is 4 — previously mis-announced as 5.
        expect(screen.getByRole('img', { name: /peaking at 4\./ })).toBeInTheDocument();
        // Middle point y = 200 - (4/5 * 160) - 20 = 52. Dividing by 4 (the peak)
        // instead of the floor of 5 would put it at y = 20.
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,52 780,180');
    });

    it('reports the real peak when it equals the floor of 5', () => {
        useAnalytics.mockReturnValue(analytics({
            stats: trendStats([
                { date: 'd1', value: 1 },
                { date: 'd2', value: 5 },
                { date: 'd3', value: 3 },
            ]),
        }));
        render(<AnalyticsView />);
        expect(screen.getByRole('img', { name: /peaking at 5\./ })).toBeInTheDocument();
    });

    it('reports the real peak when it is above the floor', () => {
        useAnalytics.mockReturnValue(analytics({
            stats: trendStats([
                { date: 'd1', value: 0 },
                { date: 'd2', value: 9 },
                { date: 'd3', value: 0 },
            ]),
        }));
        const { container } = render(<AnalyticsView />);
        expect(screen.getByRole('img', { name: /peaking at 9\./ })).toBeInTheDocument();
        // Peak 9 (above the floor) drives both text and geometry: middle point
        // y = 200 - (9/9*160) - 20 = 20, endpoints on the baseline at 180.
        const points = container.querySelector('polyline').getAttribute('points');
        expect(points).toBe('20,180 400,20 780,180');
    });
});

describe('AnalyticsView — the Activity section of the Dashboard', () => {
    it('is titled by an h3 under the Dashboard h2, its cards by h4s', () => {
        const { container } = render(<AnalyticsView />);
        expect(container.querySelector('h1, h2')).toBeNull();
        const section = screen.getByRole('region', { name: 'Activity' });
        expect(within(section).getByRole('heading', { level: 3, name: 'Activity' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent.trim())).toEqual([
            'Daily Activity Trend', 'Top Companies (By Calls)', 'Top Recruiters (By Calls)',
        ]);
    });
});

describe('AnalyticsView — states', () => {
    it('announces loading, keeping the range control and offering no export of figures not yet read', () => {
        useAnalytics.mockReturnValue(analytics({ loading: true }));
        render(<AnalyticsView />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading activity…');
        expect(screen.getByRole('group', { name: 'Date range' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Total Calls')).not.toBeInTheDocument();
    });

    it('says a failed read failed, instead of showing zeros, and offers to read again', () => {
        useAnalytics.mockReturnValue(analytics({
            error: new Error('unavailable'),
            // What the hook still holds after a failure: never shown as figures.
            stats: { summary: { totalCalls: 0, activeRecruiters: 0 }, dailyTrend: [], companyPerformance: [], userPerformance: [] },
        }));
        render(<AnalyticsView />);

        const alert = screen.getByRole('alert');
        expect(within(alert).getByRole('heading', { level: 4, name: 'Activity could not be loaded' })).toBeInTheDocument();
        expect(screen.queryByText('Total Calls')).not.toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();

        fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('keeps the range control while a read has failed, so another period can be asked for', () => {
        useAnalytics.mockReturnValue(analytics({ error: new Error('unavailable') }));
        render(<AnalyticsView />);
        fireEvent.click(screen.getByRole('button', { name: '7D' }));
        expect(setDateRange).toHaveBeenCalledWith('7d');
    });

    it('keeps the frozen empty-table messages', () => {
        useAnalytics.mockReturnValue(analytics({
            stats: { ...STATS, companyPerformance: [], userPerformance: [] },
        }));
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

    it('has no accessibility violations when the read failed', async () => {
        useAnalytics.mockReturnValue(analytics({ error: new Error('unavailable') }));
        const { container } = render(<AnalyticsView />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
