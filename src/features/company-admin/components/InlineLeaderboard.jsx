// src/features/company-admin/components/InlineLeaderboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Calendar, Medal, RefreshCw, Trophy } from 'lucide-react';
import {
    Badge,
    Card,
    DataTable,
    IconButton,
    defineTableColumns,
} from '@/design-system/components';
import { db } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';

const E2E_LEADERBOARD = Object.freeze([
    {
        id: 'e2e-recruiter-1',
        name: 'Jordan Recruiter',
        dials: 18,
        connected: 7,
        callback: 3,
        voicemail: 5,
    },
    {
        id: 'e2e-recruiter-2',
        name: 'Casey Coordinator',
        dials: 11,
        connected: 4,
        callback: 2,
        voicemail: 3,
    },
]);

function getChicagoToday() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(new Date());
}

function getInitials(name) {
    return name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}

function Rank({ index }) {
    if (index < 3) {
        const labels = ['First place', 'Second place', 'Third place'];
        const tones = ['warning', 'neutral', 'warning'];
        return (
            <Badge tone={tones[index]} icon={Medal}>
                {labels[index]}
            </Badge>
        );
    }

    return <span className="text-ds-body font-bold text-ds-content-muted">{index + 1}</span>;
}

export function InlineLeaderboard({ companyId }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [leaderboard, setLeaderboard] = useState([]);
    const [startDate, setStartDate] = useState(getChicagoToday);
    const [endDate, setEndDate] = useState(getChicagoToday);

    const fetchData = useCallback(async (rangeStart, rangeEnd) => {
        setLoading(true);
        setError('');

        if (isE2ETestMode) {
            setLeaderboard([...E2E_LEADERBOARD]);
            setLoading(false);
            return;
        }

        try {
            const statsRef = collection(db, 'companies', companyId, 'stats_daily');
            const statsQuery = query(
                statsRef,
                where('__name__', '>=', rangeStart),
                where('__name__', '<=', rangeEnd),
                orderBy('__name__'),
            );

            const snapshot = await getDocs(statsQuery);
            const userTotals = {};

            snapshot.forEach((snapshotDocument) => {
                const data = snapshotDocument.data();
                const byUser = data.byUser || {};
                Object.keys(byUser).forEach((userId) => {
                    const userData = byUser[userId];
                    if (!userTotals[userId]) {
                        userTotals[userId] = {
                            id: userId,
                            name: userData.name || 'Unknown Recruiter',
                            dials: 0,
                            connected: 0,
                            voicemail: 0,
                            callback: 0,
                            notInt: 0,
                            notQual: 0,
                        };
                    }
                    userTotals[userId].dials += userData.dials || 0;
                    userTotals[userId].connected += userData.connected || 0;
                    userTotals[userId].voicemail += userData.voicemail || 0;
                    userTotals[userId].callback += userData.callback || 0;
                    userTotals[userId].notInt += userData.notInt || 0;
                    userTotals[userId].notQual += userData.notQual || 0;
                });
            });

            setLeaderboard(
                Object.values(userTotals).sort((first, second) => second.dials - first.dials),
            );
        } catch (fetchError) {
            console.error('Failed to fetch performance:', fetchError);
            setError('Failed to load performance data.');
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        if (companyId) {
            const today = getChicagoToday();
            fetchData(today, today);
        }
    }, [companyId, fetchData]);

    const rows = useMemo(
        () => leaderboard.slice(0, 10).map((agent, index) => ({ ...agent, rank: index })),
        [leaderboard],
    );
    const totalDials = leaderboard.reduce((total, agent) => total + agent.dials, 0);

    const columns = useMemo(() => defineTableColumns([
        {
            key: 'rank',
            header: 'Rank',
            align: 'center',
            width: 'sm',
            priority: 'primary',
            render: (agent) => <Rank index={agent.rank} />,
        },
        {
            key: 'recruiter',
            header: 'Recruiter',
            rowHeader: true,
            width: 'lg',
            priority: 'primary',
            render: (agent) => (
                <div className="flex items-center gap-3">
                    <span
                        className="w-8 h-8 rounded-ds-md flex items-center justify-center text-ds-xs font-bold bg-ds-status-info-bg text-ds-status-info-fg"
                        aria-hidden="true"
                    >
                        {getInitials(agent.name)}
                    </span>
                    <span className="min-w-0">
                        <span className="block text-ds-body font-semibold text-ds-content truncate">
                            {agent.name}
                        </span>
                        {agent.rank === 0 && <Badge tone="warning">MVP</Badge>}
                    </span>
                </div>
            ),
        },
        ...[
            ['dials', 'Dials'],
            ['connected', 'Connected'],
            ['callback', 'Callback'],
            ['voicemail', 'Voicemail'],
        ].map(([key, header]) => ({
            key,
            header,
            align: 'end',
            width: 'xs',
            priority: key === 'dials' ? 'primary' : 'secondary',
            render: (agent) => (
                <span className="font-semibold text-ds-content-secondary">
                    {agent[key].toLocaleString()}
                </span>
            ),
        })),
    ]), []);

    return (
        <Card padding="none" aria-labelledby="team-leaderboard-title">
            <div className="p-4 border-b border-ds-border-subtle flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <span className="w-10 h-10 inline-flex items-center justify-center bg-ds-status-warning-bg rounded-ds-md text-ds-status-warning-fg" aria-hidden="true">
                        <Trophy size={20} />
                    </span>
                    <div>
                        <h2 id="team-leaderboard-title" className="text-ds-heading-md font-bold text-ds-content">
                            Team Leaderboard
                        </h2>
                        <p className="text-ds-xs text-ds-content-muted">
                            <span className="font-semibold text-ds-content-link">{totalDials}</span>
                            {' '}total calls in the selected range
                        </p>
                    </div>
                </div>

                <form
                    className="flex items-center gap-2 flex-wrap"
                    onSubmit={(event) => {
                        event.preventDefault();
                        fetchData(startDate, endDate);
                    }}
                >
                    <div className="flex items-center gap-2 bg-ds-surface-subtle px-3 py-1 rounded-ds-md border border-ds-border-subtle text-ds-xs">
                        <Calendar size={14} className="text-ds-content-muted" aria-hidden="true" />
                        <input
                            type="date"
                            aria-label="Leaderboard start date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="min-h-9 bg-transparent font-medium text-ds-content-secondary outline-none cursor-pointer focus-visible:shadow-ds-focus rounded-ds-sm"
                        />
                        <span className="text-ds-content-muted" aria-hidden="true">–</span>
                        <input
                            type="date"
                            aria-label="Leaderboard end date"
                            value={endDate}
                            onChange={(event) => setEndDate(event.target.value)}
                            className="min-h-9 bg-transparent font-medium text-ds-content-secondary outline-none cursor-pointer focus-visible:shadow-ds-focus rounded-ds-sm"
                        />
                    </div>
                    <IconButton
                        label="Refresh leaderboard"
                        variant="primary"
                        type="submit"
                        loading={loading}
                    >
                        <RefreshCw size={16} aria-hidden="true" />
                    </IconButton>
                </form>
            </div>

            <div className="min-h-[260px]">
                <DataTable
                    ariaLabel="Team leaderboard"
                    data={rows}
                    columns={columns}
                    density="compact"
                    minWidth="standard"
                    mobilePresentation="scroll"
                    mobileHint="Swipe horizontally to view all performance columns."
                    embedded
                    isLoading={loading}
                    loadingLabel="Loading performance data"
                    empty={{
                        icon: Trophy,
                        title: 'No activity yet',
                        description: 'Make some calls to see team performance.',
                    }}
                    error={error
                        ? { message: error, onRetry: () => fetchData(startDate, endDate) }
                        : undefined}
                />
            </div>
        </Card>
    );
}
