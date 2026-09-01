import React from 'react';
import { IconButton, defineTableColumns } from '@/design-system/components';
import {
    Phone, User, Briefcase, MapPin, Calendar, ArrowUp, ArrowDown
} from 'lucide-react';
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
                                <button
                                    type="button"
                                    onClick={(e) => handlePhoneClick(e, item)}
                                    aria-label={`Call ${name} at ${formatPhoneNumber(getFieldValue(item.phone))}`}
                                    className="min-h-8 text-ds-xs rounded-ds-sm px-2 inline-flex items-center gap-1 transition-colors border text-ds-content-secondary border-ds-border-subtle hover:bg-ds-surface-subtle hover:text-ds-content focus-visible:outline-none focus-visible:shadow-ds-focus"
                                >
                                    <Phone size={12} aria-hidden="true" />
                                    {formatPhoneNumber(getFieldValue(item.phone))}
                                </button>
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
                            <Briefcase size={12} className="text-ds-content-muted" aria-hidden="true" />
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
                                    <MapPin size={12} className="text-ds-content-muted" aria-hidden="true" /> {item.state}
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
                    <Calendar size={12} className="text-ds-content-muted" aria-hidden="true" />
                    Added Date
                    <span className="inline-flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                        {/* Up arrow = Earliest first (asc) */}
                        <button
                            type="button"
                            onClick={() => handleDateSort('asc')}
                            title="Earliest first"
                            aria-label="Sort by earliest added date"
                            aria-pressed={isDateSorted && sortConfig.direction === 'asc'}
                            className={`h-6 w-6 inline-flex items-center justify-center rounded-ds-sm leading-none transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${isDateSorted && sortConfig.direction === 'asc'
                                ? 'text-ds-action-primary'
                                : 'text-ds-content-muted hover:bg-ds-surface hover:text-ds-content'
                                }`}
                        >
                            <ArrowUp size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        {/* Down arrow = Latest first (desc) */}
                        <button
                            type="button"
                            onClick={() => handleDateSort('desc')}
                            title="Latest first"
                            aria-label="Sort by latest added date"
                            aria-pressed={isDateSorted && sortConfig.direction === 'desc'}
                            className={`h-6 w-6 inline-flex items-center justify-center rounded-ds-sm leading-none transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${isDateSorted && sortConfig.direction === 'desc'
                                ? 'text-ds-action-primary'
                                : 'text-ds-content-muted hover:bg-ds-surface hover:text-ds-content'
                                }`}
                        >
                            <ArrowDown size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
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
                        <Calendar size={12} className="text-ds-content-muted" aria-hidden="true" />
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
                        <User size={12} aria-hidden="true" /> Unassigned
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
                            <Phone aria-hidden="true" />
                        </IconButton>
                    </div>
                );
            },
        });

        return defineTableColumns(cols);
}
