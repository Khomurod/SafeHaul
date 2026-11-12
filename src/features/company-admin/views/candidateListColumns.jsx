import React from 'react';
import { Avatar, Badge, Button, defineTableColumns } from '@/design-system/components';
import { formatPhoneNumber, toTitleCase } from '@shared/utils/helpers';
import { initialsOf } from '@shared/utils/initials';
import { toUsStateCode } from '@shared/utils/usStates';
import { StatusBadge } from '@shared/components/badges/StatusBadge';
import { dossierStatusLabel } from '../components/modals/driver-dossier/dossierStatusLabel';

/**
 * The candidate list's columns and their pure display helpers (the list-page
 * standard, `src/design-system/patterns/list-toolbar/README.md`): the driver's
 * initials, the Driver (the name, a Stale mark, the number as the call button
 * under it), Status, Freight · State, Applied (Added on a lead list), Last call
 * and Assignee. The Applied column's order is not a column concern: the page
 * passes it to `DataTable` as `sort`.
 *
 * Every list shows the same columns at the same widths, so moving between All,
 * Assigned to me and Unassigned never moves a column: 972px of columns, 1,028px
 * with a lead list's selection column, which a 1366px window's 1,030px of
 * content still holds. A wider page shares the rest out among them. Nothing is
 * cut short: a long value wraps inside its column.
 *
 * On a phone each driver is a card (`mobileRole`): the initials leading, the
 * name and number as its title, the status in its corner, the facts inline
 * (a Stale mark first, "Reefer · IL", "Applied Jul 11, 2026", "Last call: Left
 * Voicemail", each left out when empty) and the assignee on a line of its own.
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

/** The name the record holds, as written; '' for a record with none. */
const writtenNameOf = (item) => nameAsWritten(
    item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' '),
);

export const getCandidateName = (item) => writtenNameOf(item) || 'Unknown Driver';

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
// ('new' covers 'New' + 'New Application', 'hired' covers 'Hired' + 'Approved', ...);
// 'in_process' to its APPLICATION_IN_PROCESS_STATUSES, which the dashboard counts too.
export const APPLICATION_PIPELINE_TABS = [
    { id: 'all', label: 'All Applications' },
    { id: 'new', label: 'New' },
    { id: 'in_process', label: 'In process' },
    { id: 'hired', label: 'Hired' },
    { id: 'terminated', label: 'Terminated' },
    { id: 'declined', label: 'Declined' },
];

// Segment ids map to the lead vocabulary in `features/companies/hooks/dashboardSearch.js`
// ('new' covers 'New', 'New Application' and 'New Lead', 'declined' 'Declined' and 'Rejected').
export const LEAD_PIPELINE_TABS = [
    { id: 'all', label: 'All Leads' },
    { id: 'new', label: 'New' },
    { id: 'attempting', label: 'Attempting to Contact' },
    { id: 'in_process', label: 'In Process' },
    { id: 'interested', label: 'Interested' },
    { id: 'declined', label: 'Declined' },
];

/**
 * An empty value: a dash, which a phone card leaves out (`DataTable` reads a
 * plain '—' as no value), so a card never shows "Last call: —".
 */
const NONE = '—';

/** A person's initials disc, or an empty ring holding the place of nobody. */
const personDisc = (name, size) => {
    const initials = initialsOf(name);
    return initials
        ? <Avatar size={size} tone="brand">{initials}</Avatar>
        : <Avatar size={size} tone="placeholder" />;
};

/**
 * "Stale", not "Stale CA1": the Status beside it says Contact Attempt 1, and
 * the name keeps the room. Not focusable, so where it is drawn changes no Tab
 * stop.
 */
const staleMark = (level) => (
    <span title="More than 48 hours in Contact Attempt 1">
        <Badge tone={level === 'severe' ? 'danger' : 'warning'}>Stale</Badge>
    </span>
);

/**
 * The freight types and the state, read together: "Reefer · IL", the state
 * quieter than the freight it qualifies. Either alone when the other is
 * missing.
 */
function freightAndState(item) {
    const freight = freightOf(item);
    const state = stateOf(item);
    if (!freight || !state) return freight || state || NONE;
    return (
        <span>
            {freight}
            <span className="text-ds-content-muted">{` · ${state}`}</span>
        </span>
    );
}

/**
 * The first fact on a phone's card. A stale lead's mark leads that line there
 * (`md:hidden`: the table is cards under 768px), where the name and number
 * keep the title to themselves; in the table it stays beside the name.
 */
function firstFact(item) {
    const facts = freightAndState(item);
    const stale = staleContactMeta(item);
    if (!stale) return facts;
    return (
        <span>
            <span className="mr-ds-2 md:hidden">{staleMark(stale)}</span>
            {facts === NONE ? <span className="max-md:hidden">{NONE}</span> : facts}
        </span>
    );
}

/**
 * @param {object} ctx
 * @param {(event: object, item: object) => void} ctx.handlePhoneClick
 * @param {'applications'|'company_leads'|'my_leads'|'unassigned_leads'} [ctx.scope]
 * @param {Array<{ id: string, name?: string }>} [ctx.teamMembers] `useCompanyTeam`'s team
 */
export function buildCandidateColumns({ handlePhoneClick, scope, teamMembers = [] }) {
    const isApplications = scope === 'applications';
    const teamNames = new Map(teamMembers.filter((m) => m?.id && m.name).map((m) => [m.id, m.name]));

    return defineTableColumns([
        {
            // The disc names no one a screen reader needs (`Avatar` is hidden
            // from it): the name beside it does.
            key: 'initials',
            header: '',
            headerLabel: 'Initials',
            mobileRole: 'lead',
            render: (item) => personDisc(writtenNameOf(item), 'sm'),
        },
        {
            key: 'identity',
            header: 'Driver',
            rowHeader: true,
            width: 'xl',
            render: (item) => {
                const name = getCandidateName(item);
                const stale = staleContactMeta(item);
                const phone = item.phone ? formatPhoneNumber(item.phone) : '';
                return (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-ds-2 gap-y-0">
                        <span className="min-w-0 break-words font-semibold text-ds-content">{name}</span>
                        {/* Beside the name in the table; on a phone's card it
                            leads the facts line instead (`firstFact`). */}
                        {stale && (
                            <span className="shrink-0 max-md:hidden">{staleMark(stale)}</span>
                        )}
                        {/* The number is the call button, on a line of its own: it
                            opens the same call log the row's phone always did, and
                            not the dossier the rest of the row opens. */}
                        {phone && (
                            <span className="flex basis-full">
                                <Button
                                    variant="link"
                                    onClick={(e) => handlePhoneClick(e, item)}
                                    aria-label={`Call ${name} at ${phone}`}
                                >
                                    <span className="tabular-nums">{phone}</span>
                                </Button>
                            </span>
                        )}
                    </span>
                );
            },
        },
        {
            key: 'status',
            header: 'Status',
            // `lg`: the widest status a list shows ("Contact Attempt 1") is a
            // non-wrapping badge.
            width: 'lg',
            mobileRole: 'status',
            // The dossier's name for the stored status: one per stage ("New
            // Application" and a lead's "New Lead" read "New", "Rejected"
            // "Declined"), the names the segments use.
            render: (item) => <StatusBadge status={dossierStatusLabel(item.status) || 'New'} />,
        },
        {
            key: 'freightState',
            header: 'Freight · State',
            width: 'sm',
            mobileRole: 'meta',
            render: firstFact,
        },
        {
            // The page owns the order (newest first unless the header is
            // pressed); the table draws the header's one sort arrow.
            key: 'addedDate',
            header: isApplications ? 'Applied' : 'Added',
            sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
            // `md`: "Dec 22, 2026" is about 97px, on one line.
            width: 'md',
            mobileRole: 'meta',
            mobileLabel: isApplications ? 'Applied' : 'Added',
            render: (item) => {
                const date = formatAddedDate(item);
                return date ? <span className="whitespace-nowrap tabular-nums">{date}</span> : NONE;
            },
        },
        {
            key: 'lastCall',
            header: 'Last call',
            width: 'sm',
            mobileRole: 'meta',
            mobileLabel: 'Last call:',
            render: (item) => {
                const outcome = lastCallOf(item);
                return outcome ? <span title={item.lastCallOutcome}>{outcome}</span> : NONE;
            },
        },
        {
            // "Assigned to" is what the pickers and the filter say; a header
            // names the person. Shown on every list, Assigned to me and
            // Unassigned included, so a column never moves between them.
            key: 'assignee',
            header: 'Assignee',
            width: 'md',
            mobileRole: 'line',
            render: (item) => {
                const name = item.assignedTo ? recruiterOf(item, teamNames) : '';
                if (item.assignedTo && !name) return NONE;
                return (
                    <span className="flex min-w-0 items-center gap-ds-2">
                        {personDisc(name, 'xs')}
                        <span className={`min-w-0 break-words${name ? '' : ' text-ds-content-muted'}`}>
                            {name || 'Unassigned'}
                        </span>
                    </span>
                );
            },
        },
    ]);
}
