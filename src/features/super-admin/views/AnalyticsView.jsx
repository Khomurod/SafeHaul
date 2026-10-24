import React, { useId, useState } from 'react';
import { Icon, BarChart3, Download, Users, Phone, TrendingUp, ArrowUpRight, User, RefreshCw } from '@design-system/icons';
import { useAnalytics } from '@features/analytics';
import { downloadCsv, toCsvText } from '@shared/utils/csvExport';
import {
    Badge, Button, Card, DataTable, MetricCard, TabList, TabPanel,
} from '@/design-system/components';
import { ResponsiveGrid, Section, Stack } from '@/design-system/layouts';
import { ErrorState, LoadingState } from '@design-system/patterns';

/**
 * The Super Admin Dashboard's Activity section: calls logged across every
 * company in a chosen period, read from each company's `stats_daily`. It was
 * the separate Analytics screen; the Dashboard's `<h2>` now heads it, so its
 * own title is an `<h3>` and its cards' titles are `<h4>`s.
 *
 * Presentation only — `useAnalytics` owns the data. Frozen contracts: the
 * `7d`/`30d`/`90d` range values, the CSV export column order, header text,
 * filename patterns (`recruiter_performance_{range}.csv` /
 * `company_performance_{range}.csv`), the top-5 slices, the `callsMade > 20`
 * High/Low rule, and every frozen string.
 *
 * Figures are shown, and exported, only once they have been read: while they
 * load and when the read fails the section keeps its title and range control
 * and says which, rather than showing zeros. `stats_daily` counts logged calls
 * and nothing else, so every figure here is calls.
 *
 * Fixed here:
 *  - "Total Actions" (a table column and a CSV column) was the calls added up a
 *    second time; it had no other source and is gone, and the chart's summary
 *    says calls. "Last Active" was never filled, so every recruiter read
 *    "Unknown" ("N/A" in the CSV); it is the last day in the period the
 *    recruiter logged a call. A failed read showed a screen of zeros; it is an
 *    announced error with Try again.
 *  - The export joined raw values with commas into a `data:` URL: "Last Active"
 *    ("10/14/2026, 4:05 PM") split into two columns, a comma or quote in a name
 *    shifted the row, a name beginning `=` ran as a formula, and the file ended at
 *    the first `#` in any name. It now writes through `csvExport.js`, as the
 *    website-leads export does: every cell escaped, saved as a UTF-8 Blob.
 *  - A "Platform Health 100%" card showed a constant that measured nothing. It
 *    is gone; the other three cards are the figures `useAnalytics` reads.
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
 *  - Both data tables lacked captions and `scope`. They are now `DataTable`s,
 *    which caption them and give each row a row header.
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
                        {`Daily activity trend across ${data.length} days, ${total} calls in total, peaking at ${dataPeak}.`}
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

            {/* The same figures in a form assistive technology can actually read.
                Carries `ds-native-table` like every other approved table: the
                guard has no hidden-table exemption, because deciding whether a
                class list is hidden at *every* breakpoint is not decidable
                (`sr-only xl:not-sr-only` is hidden on a phone and visible on a
                desktop). Measured before doing it — `sr-only` keeps
                `position:absolute` and `clip:rect(0,0,0,0)`, so the contract
                changes this table's box and nothing a user can see. */}
            <table className="sr-only ds-native-table">
                <caption>Daily activity trend</caption>
                <thead>
                    <tr><th scope="col">Date</th><th scope="col">Calls</th></tr>
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

/** A Chicago calendar day (`YYYY-MM-DD`, a `stats_daily` id) as "Nov 3, 2026". */
function formatDay(dateKey) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${dateKey}T12:00:00Z`));
}

/*
 * The two performance tables. Rows are compared with one another, so on a phone
 * they stay a table that scrolls sideways with the name pinned, rather than
 * cards. Counts line up on the end edge. Every column has a fixed width: the
 * table is fixed-layout, so an `auto` column gets only the space left over,
 * which on a phone is none.
 */
const COMPANY_COLUMNS = [
    {
        key: 'company',
        header: 'Company',
        rowHeader: true,
        width: 'lg',
        render: (comp) => <span className="font-medium text-ds-content [overflow-wrap:anywhere]">{comp.companyName}</span>,
    },
    {
        key: 'calls',
        header: 'Calls Made',
        align: 'end',
        width: 'md',
        render: (comp) => <span className="tabular-nums">{comp.callsMade}</span>,
    },
    {
        key: 'engagement',
        header: 'Engagement',
        align: 'end',
        width: 'md',
        render: (comp) => (
            <Badge tone={comp.callsMade > 20 ? 'success' : 'warning'} icon={ArrowUpRight}>
                {comp.callsMade > 20 ? 'High' : 'Low'}
            </Badge>
        ),
    },
];

const RECRUITER_COLUMNS = [
    {
        key: 'recruiter',
        header: 'Recruiter Name',
        rowHeader: true,
        width: 'lg',
        render: (user) => <span className="text-ds-content [overflow-wrap:anywhere]">{user.userName}</span>,
    },
    {
        key: 'company',
        header: 'Company',
        width: 'xl',
        render: (user) => <span className="[overflow-wrap:anywhere]">{user.companyName}</span>,
    },
    {
        key: 'calls',
        header: 'Calls Made',
        align: 'end',
        width: 'md',
        render: (user) => <span className="tabular-nums">{user.callsMade}</span>,
    },
    {
        key: 'lastActive',
        header: 'Last Active',
        align: 'end',
        width: 'md',
        render: (user) => (
            <span className="text-ds-content-muted">{user.lastActive ? formatDay(user.lastActive) : 'Unknown'}</span>
        ),
    },
];

export function AnalyticsView() {
    const { loading, error, stats, dateRange, setDateRange, reload } = useAnalytics();
    const [activeTab, setActiveTab] = useState('overview');
    const tabsId = useId();
    const headingId = useId();
    const ready = !loading && !error;

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
                // The day of the recruiter's last call, as `stats_daily` names it.
                u.lastActive || 'N/A'
            ]);
            filename = `recruiter_performance_${dateRange}.csv`;
        } else {
            headers = ['Company Name', 'Calls Made'];
            rows = stats.companyPerformance.map(c => [c.companyName, c.callsMade]);
            filename = `company_performance_${dateRange}.csv`;
        }

        // Every cell escaped: a name can hold a comma, a quote, a formula or a `#`.
        downloadCsv(filename, toCsvText([headers, ...rows]));
    };

    return (
        <Section labelledBy={headingId}>
            <Stack gap="lg">

                {/* 1. Header & Controls */}
                <Card
                    as="header"
                    padding="md"
                    className="flex shrink-0 flex-col items-start justify-between gap-ds-4 md:flex-row md:items-center"
                >
                    <div>
                        <h3 id={headingId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                            <Icon icon={BarChart3} size="2xl" className="text-ds-content-link" /> Activity
                        </h3>
                        <p className="text-ds-sm text-ds-content-muted">
                            Calls logged across all companies in the selected period.
                        </p>
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

                        {ready && (
                            <Button variant="primary" onClick={handleExport}>
                                <Icon icon={Download} /> Export {activeTab === 'users' ? 'Recruiters' : 'Companies'}
                            </Button>
                        )}
                    </div>
                </Card>

                {loading && <LoadingState title="Loading activity…" headingLevel={4} />}

                {!loading && error && (
                    <ErrorState
                        title="Activity could not be loaded"
                        description="The figures for this period could not be read, so none are shown. Try again, or choose another period."
                        headingLevel={4}
                        actions={(
                            <Button variant="secondary" onClick={reload}>
                                <Icon icon={RefreshCw} /> Try again
                            </Button>
                        )}
                    />
                )}

                {ready && (
                    <>
                        {/* 2. Summary Cards */}
                        <ResponsiveGrid minItemWidth="220px" className="shrink-0">
                            <MetricCard label="Total Calls" value={stats.summary.totalCalls} tone="info" icon={<Icon icon={Phone} size="xl" />} />
                            <MetricCard label="Active Companies" value={stats.companyPerformance.length} tone="accent" icon={<Icon icon={Users} size="xl" />} />
                            <MetricCard label="Active Recruiters" value={stats.summary.activeRecruiters} tone="warning" icon={<Icon icon={User} size="xl" />} />
                        </ResponsiveGrid>

                        {/* 3. Tabs & Content */}
                        <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <TabList
                                ariaLabel="Activity views"
                                idBase={tabsId}
                                tabs={TABS}
                                activeTab={activeTab}
                                onChange={setActiveTab}
                                className="overflow-x-auto px-ds-6 pt-ds-2"
                            />

                            <TabPanel
                                idBase={tabsId}
                                tabId={activeTab}
                                className="flex-1 overflow-auto bg-ds-canvas p-ds-6"
                            >

                                {activeTab === 'overview' && (
                                    <Stack gap="lg">
                                        <Card padding="lg">
                                            <h4 className="mb-ds-6 flex items-center gap-ds-2 text-ds-sm font-bold text-ds-content">
                                                <Icon icon={TrendingUp} className="text-ds-content-link" /> Daily Activity Trend
                                            </h4>
                                            <ActivityTrendChart data={stats.dailyTrend} />
                                        </Card>

                                        <div className="grid grid-cols-1 gap-ds-6 md:grid-cols-2">
                                            <Card padding="lg">
                                                <h4 className="mb-ds-4 text-ds-sm font-bold text-ds-content">Top Companies (By Calls)</h4>
                                                <Stack gap="md">
                                                    {stats.companyPerformance.slice(0, 5).map((comp, i) => (
                                                        <div key={i} className="flex items-center justify-between gap-ds-3">
                                                            <div className="flex min-w-0 items-center gap-ds-3">
                                                                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-full bg-ds-status-info-bg text-ds-xs font-bold text-ds-status-info-fg">
                                                                    {i + 1}
                                                                </span>
                                                                <span className="truncate text-ds-sm font-medium text-ds-content-secondary">{comp.companyName}</span>
                                                            </div>
                                                            <div className="flex shrink-0 items-center gap-ds-2">
                                                                <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-ds-full bg-ds-surface-subtle">
                                                                    <span
                                                                        className="block h-full rounded-ds-full bg-ds-action-primary"
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
                                                <h4 className="mb-ds-4 text-ds-sm font-bold text-ds-content">Top Recruiters (By Calls)</h4>
                                                <Stack gap="md">
                                                    {stats.userPerformance.slice(0, 5).map((user, i) => (
                                                        <div key={i} className="flex items-center justify-between gap-ds-3">
                                                            <div className="flex min-w-0 items-center gap-ds-3">
                                                                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-full bg-ds-status-accent-bg text-ds-xs font-bold text-ds-status-accent-fg">
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
                                    <DataTable
                                        ariaLabel="Company performance for the selected period"
                                        density="compact"
                                        minWidth="none"
                                        data={stats.companyPerformance}
                                        columns={COMPANY_COLUMNS}
                                        getRowId={(comp) => comp.companyId}
                                        empty={{ title: 'No data found for this period.' }}
                                    />
                                )}

                                {activeTab === 'users' && (
                                    <DataTable
                                        ariaLabel="Recruiter performance for the selected period"
                                        density="compact"
                                        minWidth="none"
                                        data={stats.userPerformance}
                                        columns={RECRUITER_COLUMNS}
                                        getRowId={(user) => user.userId}
                                        empty={{ title: 'No activity found for this period.' }}
                                    />
                                )}
                            </TabPanel>
                        </Card>
                    </>
                )}
            </Stack>
        </Section>
    );
}
