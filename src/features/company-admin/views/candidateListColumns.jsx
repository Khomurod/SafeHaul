import React from 'react';
import { Chip, IconButton, defineTableColumns } from '@/design-system/components';
import {
    Icon as DsIcon,
    Phone, User, Briefcase, MapPin, Calendar, ArrowUp, ArrowDown,
} from '@design-system/icons';
import { getFieldValue, formatPhoneNumber, toTitleCase } from '@shared/utils/helpers';
import { StatusBadge } from '@shared/components/badges/StatusBadge';

/**
 * The candidate list's column definitions and their pure display helpers,
 * extracted verbatim from `views/CompanyCandidatesListPage.jsx`. The view
 * memoises `buildCandidateColumns(ctx)` with its ORIGINAL dependency array,
 * so capture semantics are unchanged: `handleDateSort` and `handlePhoneClick`
 * arrive through `ctx` exactly as the inline closure captured them.
 */

// ── Status pill styling ──

// ── Call outcome pill ──
export const getOutcomePillStyle = (outcome) => {
    const o = (outcome || '').toLowerCase();
    if (o.includes('connected') || o.includes('spoke') || o.includes('interested'))
        return 'bg-ds-status-success-bg text-ds-status-success-fg border-ds-status-success-border';
    if (o.includes('callback'))
        return 'bg-ds-status-info-bg text-ds-status-info-fg border-ds-status-info-border';
    if (o.includes('voicemail'))
        return 'bg-ds-status-warning-bg text-ds-status-warning-fg border-ds-status-warning-border';
    if (o.includes('no answer'))
        return 'bg-ds-status-danger-bg text-ds-status-danger-fg border-ds-status-danger-border';
    if (o.includes('not interested'))
        return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
    return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
};

export const getCandidateName = (item) => item.fullName
    ? toTitleCase(item.fullName)
    : toTitleCase(`${item.firstName || 'Unknown'} ${item.lastName || 'Driver'}`.trim());

// ── Format Firestore timestamp to MM/DD/YYYY ──
export const formatAddedDate = (item) => {
    const ts = item.submittedAt || item.createdAt;
    if (!ts) return null;
    try {
        const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    } catch {
        return null;
    }
};

/** >48h in Contact Attempt 1 (uses statusEnteredAt only). */
export function staleContactMeta(item) {
    if (!item || item.status !== 'Contact Attempt 1') return null;
    const ts = item.statusEnteredAt;
    if (!ts || (typeof ts.seconds !== 'number' && !ts.toDate)) return null;
    try {
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        const hours = (Date.now() - d.getTime()) / 3600000;
        if (hours <= 48) return null;
        return hours >= 72 ? 'severe' : 'warn';
    } catch {
        return null;
    }
}

// Segment ids map to APPLICATION_STATUS_GROUPS in @shared/utils/applicationStatus
// ('new' covers 'New' + 'New Application', 'hired' covers 'Hired' + 'Approved', ...).
export const APPLICATION_PIPELINE_TABS = [
    { id: 'all', label: 'All Applications' },
    { id: 'new', label: 'New' },
    { id: 'hired', label: 'Hired' },
    { id: 'terminated', label: 'Terminated' },
    { id: 'declined', label: 'Declined' },
];

export const LEAD_PIPELINE_TABS = [
    { id: 'all', label: 'All Leads' },
    { id: 'attempting', label: 'Attempting to Contact' },
    { id: 'in_process', label: 'In Process' },
    { id: 'interested', label: 'Interested' },
];

export function buildCandidateColumns({ sortConfig, handleDateSort, handlePhoneClick }) {
        const cols = [
            // Identity Cell: Name + Phone/Email
            {
                key: 'identity',
                header: 'Driver / Contact',
                rowHeader: true,
                width: 'xl',
                priority: 'primary',
                render: (item) => {
                    const name = getCandidateName(item);
                    const stale = staleContactMeta(item);

                    return (
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-ds-body font-semibold text-ds-content">{name}</p>
                                {stale && (
                                    <span
                                        className={`text-ds-xs font-bold uppercase px-2 py-0.5 rounded-ds-full border ${stale === 'severe'
                                            ? 'bg-ds-status-danger-bg text-ds-status-danger-fg border-ds-status-danger-border'
                                            : 'bg-ds-status-warning-bg text-ds-status-warning-fg border-ds-status-warning-border'
                                            }`}
                                    >
                                        Stale CA1
                                    </span>
                                )}
                            </div>
                            <div className="mt-1">
                                {/* `sm` is 36px on the shared control scale. The
                                    hand-written chip was 32px, so this is the one
                                    place the migration rounds UP rather than down:
                                    it was the only site with a real touch target,
                                    and putting it on the scale should not cost it.
                                    Measured off the baselines: the row pitch stays
                                    92px, because the two-line stack had the slack. */}
                                <Chip
                                    size="sm"
                                    icon={Phone}
                                    onClick={(e) => handlePhoneClick(e, item)}
                                    aria-label={`Call ${name} at ${formatPhoneNumber(getFieldValue(item.phone))}`}
                                >
                                    {formatPhoneNumber(getFieldValue(item.phone))}
                                </Chip>
                            </div>
                        </div>
                    );
                },
            },
        ];

        // Status pill
        cols.push({
            key: 'status',
            header: 'Status',
            align: 'center',
            width: 'sm',
            priority: 'primary',
            /*
             * `StatusBadge`, not a fourth hand-built pill. The local one was
             * tokenised — which is why the colour rules never flagged it — but it
             * was still a second badge contract, and it had its *own*
             * status-to-tone mapping that disagreed with the dossier's: this
             * screen called "Hired" purple while the dossier called it green.
             * One adapter now, so a status is the same colour wherever it
             * appears. It also stops wrapping: `Badge` is `white-space: nowrap`
             * and sized to its content, so "New Application" no longer breaks
             * across two lines inside a stretched pill.
             */
            render: (item) => <StatusBadge status={item.status || 'New'} />,
        });


        // Qualifications: Position + Type + Experience + State
        cols.push({
            key: 'qualifications',
            header: 'Position / Type',
            width: 'lg',
            priority: 'secondary',
            render: (item) => {
                const position = item.positionApplyingTo || 'Driver';
                const types = Array.isArray(item.driverType) && item.driverType.length > 0
                    ? item.driverType.join(', ')
                    : (typeof item.driverType === 'string' && item.driverType ? item.driverType : 'Unspecified');

                return (
                    <div>
                        <div className="flex items-center gap-1.5 text-ds-body font-semibold text-ds-content">
                            <DsIcon icon={Briefcase} size="xs" className="text-ds-content-muted" />
                            {position}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {(item.experience || item['experience-years']) && (
                                <span className="text-ds-xs text-ds-content-secondary font-medium bg-ds-surface-subtle px-1.5 py-0.5 rounded-ds-sm">
                                    {item.experience || item['experience-years']} Exp
                                </span>
                            )}
                            {item.state && (
                                <span className="flex items-center gap-0.5 text-ds-xs text-ds-content-secondary font-medium bg-ds-surface-subtle px-1.5 py-0.5 rounded-ds-sm">
                                    <DsIcon icon={MapPin} size="xs" className="text-ds-content-muted" /> {item.state}
                                </span>
                            )}
                        </div>
                        <p className="text-ds-xs text-ds-content-muted font-medium mt-0.5 truncate" title={types}>
                            {types}
                        </p>
                    </div>
                );
            },
        });

        // Added Date — with inline sort arrows
        const isDateSorted = sortConfig.key === 'date';
        cols.push({
            key: 'addedDate',
            header: (
                <span className="inline-flex items-center justify-center gap-1">
                    <DsIcon icon={Calendar} size="xs" className="text-ds-content-muted" />
                    Added Date
                    <span className="inline-flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                        {/* Up arrow = Earliest first (asc). `pressed` rather than a
                            colour utility: the active direction used to be marked
                            with `text-ds-action-primary`, which loses to the
                            variant's own `color` and would have left the table
                            with nothing on screen saying how it is sorted. */}
                        <IconButton
                            label="Sort by earliest added date"
                            variant="ghost"
                            size="xs"
                            onClick={() => handleDateSort('asc')}
                            title="Earliest first"
                            pressed={isDateSorted && sortConfig.direction === 'asc'}
                        >
                            <DsIcon icon={ArrowUp} size="xs" />
                        </IconButton>
                        {/* Down arrow = Latest first (desc) */}
                        <IconButton
                            label="Sort by latest added date"
                            variant="ghost"
                            size="xs"
                            onClick={() => handleDateSort('desc')}
                            title="Latest first"
                            pressed={isDateSorted && sortConfig.direction === 'desc'}
                        >
                            <DsIcon icon={ArrowDown} size="xs" />
                        </IconButton>
                    </span>
                </span>
            ),
            align: 'center',
            width: 'md',
            priority: 'secondary',
            render: (item) => {
                const dateStr = formatAddedDate(item);
                if (!dateStr) {
                    return <span className="text-ds-xs text-ds-content-muted italic">—</span>;
                }
                return (
                    <span className="inline-flex items-center gap-1 text-ds-xs text-ds-content-secondary font-medium">
                        <DsIcon icon={Calendar} size="xs" className="text-ds-content-muted" />
                        {dateStr}
                    </span>
                );
            },
        });

        // Last Call
        cols.push({
            key: 'lastCall',
            header: 'Last Call',
            align: 'center',
            width: 'xs',
            priority: 'tertiary',
            render: (item) => {
                if (!item.lastCallOutcome) {
                    return <span className="text-ds-xs text-ds-content-muted italic">—</span>;
                }
                return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-ds-full text-ds-xs font-semibold border ${getOutcomePillStyle(item.lastCallOutcome)}`}>
                        {item.lastCallOutcome}
                    </span>
                );
            },
        });

        // Assignee
        cols.push({
            key: 'assignee',
            header: 'Recruiter',
            width: 'md',
            priority: 'secondary',
            render: (item) => {
                if (item.assignedToName) {
                    return (
                        <span className="inline-flex items-center gap-1.5 text-ds-xs font-medium text-ds-content bg-ds-surface-subtle px-2 py-1 rounded-ds-full border border-ds-border-subtle">
                            <span className="w-5 h-5 bg-ds-status-accent-bg text-ds-status-accent-fg rounded-ds-full flex items-center justify-center text-ds-xs font-bold" aria-hidden="true">
                                {item.assignedToName.charAt(0)}
                            </span>
                            {item.assignedToName}
                        </span>
                    );
                }
                return (
                    <span className="text-ds-xs text-ds-content-muted italic flex items-center gap-1">
                        <DsIcon icon={User} size="xs" /> Unassigned
                    </span>
                );
            },
        });

        // Actions — hover reveal
        cols.push({
            key: 'actions',
            header: '',
            headerLabel: 'Actions',
            align: 'center',
            width: 'actions',
            priority: 'actions',
            stopPropagation: true,
            render: (item) => {
                const name = getCandidateName(item);
                return (
                    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200">
                        {/*
                          `IconButton size="sm"` — 36px, which is exactly the
                          `h-9 w-9` this had chosen by hand, so the row height does
                          not move. The accessible name is record-specific, which is
                          the rule for a row action.
                        */}
                        <IconButton
                            variant="ghost"
                            size="sm"
                            label={`Call ${name}`}
                            onClick={(e) => handlePhoneClick(e, item)}
                        >
                            <DsIcon icon={Phone} />
                        </IconButton>
                    </div>
                );
            },
        });

        return defineTableColumns(cols);
}
