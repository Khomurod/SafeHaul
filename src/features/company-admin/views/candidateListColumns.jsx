import React from 'react';
import { Badge, Button, defineTableColumns } from '@/design-system/components';
import { formatPhoneNumber, toTitleCase } from '@shared/utils/helpers';
import { applicationStatusLabel } from '@shared/utils/applicationStatus';
import { toUsStateCode } from '@shared/utils/usStates';
import { StatusBadge } from '@shared/components/badges/StatusBadge';

/**
 * The candidate list's columns and their pure display helpers. One fact per
 * cell, one line per record (the list-page standard,
 * `src/design-system/patterns/list-toolbar/README.md`): Driver, Phone, Status,
 * Freight, State, Applied, Last call, Recruiter. The Applied column's order is
 * not a column concern: the page passes it to `DataTable` as `sort`.
 *
 * Each list fits the 1,134px a 1440px window leaves it: Applications 1,112px.
 * A lead list's Driver column is `xl`, because a stale first attempt ("Stale")
 * sits beside the name there. Company Leads (1,124px with its selection column)
 * leaves out State, which its filter and the dossier still show; My Leads
 * (1,036px) leaves out Recruiter, which would name the reader on every row. A
 * longer value is shortened with an ellipsis (`truncate`) rather than widening
 * a column.
 */

/**
 * A name as the driver wrote it ("McDonald", "de la Cruz"). Only a name typed
 * all in capitals or all in small letters is put in title case.
 */
export const nameAsWritten = (text) => {
    const name = String(text ?? '').trim().replace(/\s+/g, ' ');
    const oneCase = name === name.toLowerCase() || name === name.toUpperCase();
    return oneCase ? toTitleCase(name) : name;
};

export const getCandidateName = (item) => nameAsWritten(
    item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' '),
) || 'Unknown Driver';

// ── A record's Added Date, which the column shows and its header sorts by ──
// The day the record was created, which the date filter searches by; an
// application without one shows its submission day.
export const addedDateOf = (item) => item.createdAt || item.submittedAt;

// ── Format a Firestore timestamp as "Jul 11, 2026" ──
export const formatAddedDate = (item) => {
    const ts = addedDateOf(item);
    if (!ts) return null;
    try {
        const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return null;
    }
};

/** The freight types a record lists, as one line ("Dry Van, Reefer"). */
export const freightOf = (item) => {
    const { driverType } = item;
    if (Array.isArray(driverType)) return driverType.filter(Boolean).join(', ');
    return typeof driverType === 'string' ? driverType.trim() : '';
};

/** A US state by its postal code ("Texas" and "TX" both read "TX"); any other region as stored. */
export const stateOf = (item) => toUsStateCode(item.state) || String(item.state ?? '').trim();

/**
 * The last call's outcome without the "Connected / " every answered call
 * starts with ("Not Interested" says the call connected); the stored label
 * stays whole.
 */
export const lastCallOf = (item) => String(item.lastCallOutcome ?? '').replace(/^Connected \/\s*/, '').trim();

/**
 * The assignee's name from the company's team, else the name the record
 * stored; '' for a record with no assignee. A name left on an unassigned record
 * is a leftover: unassigning once stored "Unassigned" as the name.
 */
export const recruiterOf = (item, teamNames) => {
    if (!item.assignedTo) return '';
    return teamNames.get(item.assignedTo) || item.assignedToName || '';
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

/** An empty cell, said quietly. */
const quiet = (text = '—') => <span className="text-ds-content-muted">{text}</span>;

/** A value that may be cut short: the whole of it on hover. */
const clipped = (value) => (value ? <span title={value}>{value}</span> : quiet());

/**
 * @param {object} ctx
 * @param {(event: object, item: object) => void} ctx.handlePhoneClick
 * @param {'applications'|'company_leads'|'my_leads'} [ctx.scope]
 * @param {Array<{ id: string, name?: string }>} [ctx.teamMembers] `useCompanyTeam`'s team
 */
export function buildCandidateColumns({ handlePhoneClick, scope, teamMembers = [] }) {
    const isApplications = scope === 'applications';
    const teamNames = new Map(teamMembers.filter((m) => m?.id && m.name).map((m) => [m.id, m.name]));

    return defineTableColumns([
        {
            key: 'identity',
            header: 'Driver',
            rowHeader: true,
            width: isApplications ? 'lg' : 'xl',
            render: (item) => {
                const name = getCandidateName(item);
                const stale = staleContactMeta(item);
                return (
                    <span className="flex min-w-0 items-center gap-ds-2">
                        <span className="truncate font-semibold text-ds-content" title={name}>{name}</span>
                        {/* "Stale", not "Stale CA1": the Status beside it says
                            Contact Attempt 1, and the name keeps the room. */}
                        {stale && (
                            <span className="shrink-0" title="More than 48 hours in Contact Attempt 1">
                                <Badge tone={stale === 'severe' ? 'danger' : 'warning'}>Stale</Badge>
                            </span>
                        )}
                    </span>
                );
            },
        },
        {
            // The number is the call button: it opens the same call log the
            // row's phone always did.
            key: 'phone',
            header: 'Phone',
            width: 'md',
            stopPropagation: true,
            render: (item) => {
                if (!item.phone) return quiet();
                const phone = formatPhoneNumber(item.phone);
                return (
                    <Button
                        variant="link"
                        size="sm"
                        // At the start of a card's value column, with the other
                        // values, rather than stretched across it and centred.
                        className="justify-self-start"
                        onClick={(e) => handlePhoneClick(e, item)}
                        aria-label={`Call ${getCandidateName(item)} at ${phone}`}
                    >
                        <span className="tabular-nums">{phone}</span>
                    </Button>
                );
            },
        },
        {
            key: 'status',
            header: 'Status',
            // `lg`: the widest status a list shows ("Contact Attempt 1") is a
            // non-wrapping badge.
            width: 'lg',
            // An application shows one name per pipeline group ("New Application"
            // reads "New"), the names its segments use; a lead's status as stored.
            render: (item) => (
                <StatusBadge status={(isApplications ? applicationStatusLabel(item.status) : item.status) || 'New'} />
            ),
        },
        {
            key: 'freight',
            header: 'Freight',
            width: 'sm',
            truncate: true,
            render: (item) => clipped(freightOf(item)),
        },
        ...(scope === 'company_leads' ? [] : [{
            key: 'state',
            header: 'State',
            width: 'xs',
            truncate: true,
            render: (item) => clipped(stateOf(item)),
        }]),
        {
            // The page owns the order (newest first unless the header is
            // pressed); the table draws the header's one sort arrow.
            key: 'addedDate',
            header: isApplications ? 'Applied' : 'Added',
            sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
            // `md`: "Dec 22, 2026" is about 97px, on one line.
            width: 'md',
            render: (item) => {
                const date = formatAddedDate(item);
                return date ? <span className="whitespace-nowrap tabular-nums">{date}</span> : quiet();
            },
        },
        {
            key: 'lastCall',
            header: 'Last call',
            // `md`: "Not Interested", "Left Voicemail" and the like whole.
            width: 'md',
            truncate: true,
            render: (item) => {
                const outcome = lastCallOf(item);
                return outcome ? <span title={item.lastCallOutcome}>{outcome}</span> : quiet();
            },
        },
        ...(scope === 'my_leads' ? [] : [{
            key: 'assignee',
            header: 'Recruiter',
            width: 'sm',
            truncate: true,
            render: (item) => {
                if (!item.assignedTo) return quiet('Unassigned');
                return clipped(recruiterOf(item, teamNames));
            },
        }]),
    ]);
}
