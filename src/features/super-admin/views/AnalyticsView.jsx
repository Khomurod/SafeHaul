import React, { useId, useRef, useState } from 'react';
import {
    BarChart3, Download, Users, Phone,
    Zap, TrendingUp, ArrowUpRight, User
} from 'lucide-react';
import { useAnalytics } from '@features/analytics';
import { Badge, Button, Card, MetricCard } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

/**
 * Platform-wide analytics for Super Admin.
 *
 * Migrated to the design system 2026-07-28. Presentation only — `useAnalytics`
 * is untouched, the `7d`/`30d`/`90d` range values, the CSV export column order,
 * header text, filename patterns (`recruiter_performance_{range}.csv` /
 * `company_performance_{range}.csv`), the `data:text/csv;charset=utf-8` link
 * technique, the top-5 slices, the `callsMade > 20` High/Low rule, and every
 * frozen string are unchanged.
 *
 * Fixed here:
 *  - The three view tabs were raw buttons with no tab semantics: the selected
 *    tab was conveyed by border+text colour only, with no `aria-selected` and no
 *    arrow-key movement. They are now a real WAI-ARIA tab interface.
 *  - The date-range control had the same problem — selection by colour only. It
 *    is now a radiogroup-style set with `aria-pressed`.
 *  - `text-[10px]` on the chart axis labels and the recruiter company name
 *    (below the 12px floor) removed.
 *  - The trend chart was an unlabelled `<svg>` — completely invisible to
 *    assistive technology. It now has `role="img"` with a summarising name plus
 *    a visually-hidden table of the same figures, so the data is reachable
 *    without sight. The summary's "peaking at N" now reports the real data peak,
 *    not the chart's visual scaling floor of 5, which previously over-reported a
 *    quiet period's peak (e.g. a peak of 2 announced as 5). The floor still
 *    governs the SVG geometry so a tiny peak is not stretched to full height.
 *  - The loading state was an unannounced `<div>`.
 *  - Both data tables lacked captions and `scope`.
 *  - The hardcoded chart hexes (`#2563eb`, `#f3f4f6`) now derive from tokens via
 *    `currentColor`, so the chart follows the theme like everything else.
 *
 * Feature-owned exception: the SVG polyline/area geometry and its viewBox math
 * stay feature-owned. Replacing them with a charting primitive would change the
 * rendering, and the design system has no approved chart contract. Only the
 * colours, labels and surrounding card are standardised.
 */

function ActivityTrendChart({ data }) {
    const titleId = useId();

    if (!data || data.length === 0) {
        return (
            <p className="flex h-48 items-center justify-center text-ds-sm text-ds-content-muted">
                No data available
            </p>
        );
    }
    const height = 200;
    const width = 800;
    const padding = 20;

    // The real activity peak, used only for the accessible summary. Reported
    // truthfully even when it is 0 (all-zero days) or below the visual floor,
    // so screen-reader users hear the actual number rather than the scale.
    const dataPeak = data.reduce((peak, d) => Math.max(peak, d.value || 0), 0);
    // The visual scale is floored at 5 so a quiet period does not stretch a tiny
    // peak to full height. Geometry uses this floored maximum; the accessible
    // text above must not — that is the defect this separation fixes.
    const maxValue = Math.max(dataPeak, 5);
    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
        const y = height - ((d.value / maxValue) * (height - padding * 2)) - padding;
        return `${x},${y}`;
    }).join(' ');

    const total = data.reduce((sum, d) => sum + (d.value || 0), 0);

    return (
        <div className="w-full">
            <div className="h-64 w-full overflow-hidden text-ds-content-link">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="h-full w-full overflow-visible"
                    role="img"
                    aria-labelledby={titleId}
                >
                    <title id={titleId}>
                        {`Daily activity trend across ${data.length} days, ${total} actions in total, peaking at ${dataPeak}.`}
                    </title>
                    {[0, 0.25, 0.5, 0.75, 1].map(tick => (
                        <line
                            key={tick}
                            x1={padding}
                            y1={height - (tick * (height - padding * 2)) - padding}
                            x2={width - padding}
                            y2={height - (tick * (height - padding * 2)) - padding}
                            stroke="var(--ds-color-border-subtle)"
                            strokeWidth="1"
                        />
                    ))}
                    <polyline
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        points={points}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <polygon
                        fill="currentColor"
                        points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
                        opacity="0.1"
                    />
                    <text x={padding} y={height} className="fill-current text-ds-xs opacity-60">{data[0]?.date}</text>
                    <text x={width / 2} y={height} className="fill-current text-ds-xs opacity-60">{data[Math.floor(data.length / 2)]?.date}</text>
                    <text x={width - padding} y={height} className="fill-current text-ds-xs opacity-60">{data[data.length - 1]?.date}</text>
                </svg>
            </div>

            {/* The same figures in a form assistive technology can actually read. */}
            <table className="sr-only">
                <caption>Daily activity trend</caption>
                <thead>
                    <tr><th scope="col">Date</th><th scope="col">Actions</th></tr>
                </thead>
                <tbody>
                    {data.map((d, i) => (
                        <tr key={`${d.date}-${i}`}><td>{d.date}</td><td>{d.value}</td></tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const TABS = [
    { id: 'overview', label: 'Activity Overview' },
    { id: 'companies', label: 'Company Performance' },
    { id: 'users', label: 'Recruiter Stats' },
];

const DATE_RANGES = ['7d', '30d', '90d'];

export function AnalyticsView() {
    const { loading, stats, dateRange, setDateRange } = useAnalytics();
    const [activeTab, setActiveTab] = useState('overview');
    const tabRefs = useRef({});
    const tabsId = useId();

    const handleExport = () => {
        let headers = [];
        let rows = [];
        let filename = "export.csv";

        if (activeTab === 'users') {
            headers = ['Recruiter Name', 'Company', 'Calls Made', 'Last Active'];
            rows = stats.userPerformance.map(u => [
                u.userName,
                u.companyName,
                u.callsMade,
                u.lastActive ? new Date(u.lastActive.seconds * 1000).toLocaleString() : 'N/A'
            ]);
            filename = `recruiter_performance_${dateRange}.csv`;
        } else {
            headers = ['Company Name', 'Calls Made', 'Total Actions'];
            rows = stats.companyPerformance.map(c => [c.companyName, c.callsMade, c.actions]);
            filename = `company_performance_${dateRange}.csv`;
        }

        const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Roving focus: a tablist must respond to Arrow/Home/End, not just clicks.
    const onTabKeyDown = (event) => {
        const index = TABS.findIndex((t) => t.id === activeTab);
        let next = null;
        if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
        if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
        if (event.key === 'Home') next = TABS[0];
        if (event.key === 'End') next = TABS[TABS.length - 1];
        if (!next) return;
        event.preventDefault();
        setActiveTab(next.id);
        tabRefs.current[next.id]?.focus();
    };

    if (loading) {
        return (
            <p role="status" className="p-ds-12 text-center text-ds-content-muted">
                Loading analytics...
            </p>
        );
    }

    return (
        <Stack gap="lg" className="flex h-full flex-col">

            {/* 1. Header & Controls */}
            <Card
                as="header"
                padding="md"
                className="flex shrink-0 flex-col items-start justify-between gap-ds-4 md:flex-row md:items-center"
            >
                <div>
                    <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <BarChart3 className="text-ds-content-link" aria-hidden="true" /> Platform Analytics
                    </h2>
                    <p className="text-ds-sm text-ds-content-muted">Monitor usage and performance across all companies.</p>
                </div>

                <div className="flex flex-wrap gap-ds-2">
                    <div
                        role="group"
                        aria-label="Date range"
                        className="flex rounded-ds-md bg-ds-surface-subtle p-1"
                    >
                        {DATE_RANGES.map(range => (
                            <Button
                                key={range}
                                size="sm"
                                variant={dateRange === range ? 'primary' : 'ghost'}
                                aria-pressed={dateRange === range}
                                onClick={() => setDateRange(range)}
                            >
                                {range.toUpperCase()}
                            </Button>
                        ))}
                    </div>

                    <Button variant="primary" onClick={handleExport}>
                        <Download size={16} aria-hidden="true" /> Export {activeTab === 'users' ? 'Recruiters' : 'Companies'}
                    </Button>
                </div>
            </Card>

            {/* 2. Summary Cards */}
            <ResponsiveGrid minItemWidth="220px" className="shrink-0">
                <MetricCard label="Total Calls" value={stats.summary.totalCalls} tone="info" icon={<Phone size={20} aria-hidden="true" />} />
                <MetricCard label="Active Companies" value={stats.companyPerformance.length} tone="accent" icon={<Users size={20} aria-hidden="true" />} />
                <MetricCard label="Active Recruiters" value={stats.summary.activeRecruiters} tone="warning" icon={<User size={20} aria-hidden="true" />} />
                <MetricCard label="Platform Health" value="100%" tone="success" icon={<Zap size={20} aria-hidden="true" />} />
            </ResponsiveGrid>

            {/* 3. Tabs & Content */}
            <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                    role="tablist"
                    aria-label="Analytics views"
                    onKeyDown={onTabKeyDown}
                    className="flex overflow-x-auto border-b border-ds-border-subtle px-ds-6 pt-ds-2"
                >
                    {TABS.map((tab) => {
                        const selected = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                id={`${tabsId}-tab-${tab.id}`}
                                aria-selected={selected}
                                aria-controls={`${tabsId}-panel-${tab.id}`}
                                tabIndex={selected ? 0 : -1}
                                ref={(node) => { tabRefs.current[tab.id] = node; }}
                                onClick={() => setActiveTab(tab.id)}
                                className={`whitespace-nowrap border-b-2 px-ds-4 py-ds-3 text-ds-sm font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                    selected
                                        ? 'border-ds-action-primary text-ds-content-link'
                                        : 'border-transparent text-ds-content-muted hover:text-ds-content'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div
                    role="tabpanel"
                    id={`${tabsId}-panel-${activeTab}`}
                    aria-labelledby={`${tabsId}-tab-${activeTab}`}
                    tabIndex={0}
                    className="flex-1 overflow-auto bg-ds-canvas p-ds-6 focus-visible:outline-none focus-visible:shadow-ds-focus"
                >

                    {activeTab === 'overview' && (
                        <Stack gap="lg">
                            <Card padding="lg">
                                <h3 className="mb-ds-6 flex items-center gap-ds-2 text-ds-sm font-bold text-ds-content">
                                    <TrendingUp size={16} className="text-ds-content-link" aria-hidden="true" /> Daily Activity Trend
                                </h3>
                                <ActivityTrendChart data={stats.dailyTrend} />
                            </Card>

                            <div className="grid grid-cols-1 gap-ds-6 md:grid-cols-2">
                                <Card padding="lg">
                                    <h3 className="mb-ds-4 text-ds-sm font-bold text-ds-content">Top Companies (By Calls)</h3>
                                    <Stack gap="md">
                                        {stats.companyPerformance.slice(0, 5).map((comp, i) => (
                                            <div key={i} className="flex items-center justify-between gap-ds-3">
                                                <div className="flex min-w-0 items-center gap-ds-3">
                                                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ds-status-info-bg text-ds-xs font-bold text-ds-status-info-fg">
                                                        {i + 1}
                                                    </span>
                                                    <span className="truncate text-ds-sm font-medium text-ds-content-secondary">{comp.companyName}</span>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-ds-2">
                                                    <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-ds-surface-subtle">
                                                        <span
                                                            className="block h-full rounded-full bg-ds-action-primary"
                                                            style={{ width: `${(comp.callsMade / (stats.summary.totalCalls || 1)) * 100}%` }}
                                                        />
                                                    </span>
                                                    <span className="text-ds-xs font-bold text-ds-content-secondary">{comp.callsMade} calls</span>
                                                </div>
                                            </div>
                                        ))}
                                        {stats.companyPerformance.length === 0 && <p className="text-ds-xs italic text-ds-content-muted">No data yet.</p>}
                                    </Stack>
                                </Card>

                                <Card padding="lg">
                                    <h3 className="mb-ds-4 text-ds-sm font-bold text-ds-content">Top Recruiters (By Calls)</h3>
                                    <Stack gap="md">
                                        {stats.userPerformance.slice(0, 5).map((user, i) => (
                                            <div key={i} className="flex items-center justify-between gap-ds-3">
                                                <div className="flex min-w-0 items-center gap-ds-3">
                                                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ds-status-accent-bg text-ds-xs font-bold text-ds-status-accent-fg">
                                                        {i + 1}
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-ds-sm font-medium text-ds-content-secondary">{user.userName}</span>
                                                        <span className="block truncate text-ds-xs text-ds-content-muted">{user.companyName}</span>
                                                    </span>
                                                </div>
                                                <span className="shrink-0 text-ds-xs font-bold text-ds-content-secondary">{user.callsMade} calls</span>
                                            </div>
                                        ))}
                                        {stats.userPerformance.length === 0 && <p className="text-ds-xs italic text-ds-content-muted">No data yet.</p>}
                                    </Stack>
                                </Card>
                            </div>
                        </Stack>
                    )}

                    {activeTab === 'companies' && (
                        <Card padding="none" className="overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                                <caption className="sr-only">Company performance for the selected period</caption>
                                <thead className="bg-ds-surface-subtle text-ds-xs font-bold uppercase text-ds-content-secondary">
                                    <tr>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4">Company</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4 text-center">Calls Made</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4 text-center">Total Actions</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4 text-right">Engagement</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ds-border-subtle">
                                    {stats.companyPerformance.map((comp) => (
                                        <tr key={comp.companyId} className="transition-colors hover:bg-ds-surface-subtle">
                                            <th scope="row" className="px-ds-6 py-ds-4 text-left font-medium text-ds-content">{comp.companyName}</th>
                                            <td className="px-ds-6 py-ds-4 text-center tabular-nums text-ds-content-secondary">{comp.callsMade}</td>
                                            <td className="px-ds-6 py-ds-4 text-center tabular-nums text-ds-content-secondary">{comp.actions}</td>
                                            <td className="px-ds-6 py-ds-4 text-right">
                                                <Badge tone={comp.callsMade > 20 ? 'success' : 'warning'} icon={ArrowUpRight}>
                                                    {comp.callsMade > 20 ? 'High' : 'Low'}
                                                </Badge>
                                            </td>
                                        </tr>
                                    ))}
                                    {stats.companyPerformance.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="p-ds-6 text-center italic text-ds-content-muted">No data found for this period.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </Card>
                    )}

                    {activeTab === 'users' && (
                        <Card padding="none" className="overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                                <caption className="sr-only">Recruiter performance for the selected period</caption>
                                <thead className="bg-ds-surface-subtle text-ds-xs font-bold uppercase text-ds-content-secondary">
                                    <tr>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4">Recruiter Name</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4">Company</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4 text-center">Calls Made</th>
                                        <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-4 text-right">Last Active</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ds-border-subtle">
                                    {stats.userPerformance.map((user) => (
                                        <tr key={user.userId} className="transition-colors hover:bg-ds-surface-subtle">
                                            <th scope="row" className="px-ds-6 py-ds-4 text-left font-bold text-ds-content">{user.userName}</th>
                                            <td className="px-ds-6 py-ds-4 text-ds-content-secondary">{user.companyName}</td>
                                            <td className="px-ds-6 py-ds-4 text-center font-mono font-bold tabular-nums text-ds-content-link">{user.callsMade}</td>
                                            <td className="px-ds-6 py-ds-4 text-right text-ds-sm text-ds-content-muted">
                                                {user.lastActive?.toDate
                                                    ? user.lastActive.toDate().toLocaleString()
                                                    : 'Unknown'}
                                            </td>
                                        </tr>
                                    ))}
                                    {stats.userPerformance.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="p-ds-6 text-center italic text-ds-content-muted">No activity found for this period.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </Card>
                    )}
                </div>
            </Card>
        </Stack>
    );
}
