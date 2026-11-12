import React, { useMemo } from 'react';
import { CheckCircle2, Copy, Icon } from '@design-system/icons';
import { Avatar, Badge, Button, DataTable } from '@/design-system/components';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { initialsOf } from '@shared/utils/initials';

const codeOf = (link) => link.code;

function when(value) {
    const date = typeof value?.toDate === 'function' ? value.toDate() : null;
    return date ? date.toLocaleDateString('en-US', { dateStyle: 'medium' }) : null;
}

/** One of what a link brought in, or a quiet dash while it is unknown. */
function broughtIn(count, field) {
    return count
        ? <span className="tabular-nums">{count[field]}</span>
        : <span className="text-ds-content-muted">—</span>;
}

/** What a link brings in, in the order the columns read it. */
const BROUGHT_IN = [
    { field: 'leads', label: 'Leads' },
    { field: 'applications', label: 'Applications' },
    { field: 'hired', label: 'Hired' },
];

/**
 * Under 768px the table is one card per link. From 768px the referring
 * driver's column takes what the others leave (the table is at least 920px):
 *
 * - from 1440px the day a link was made, and by whom, has a column of its own
 *   (`CREATED_QUERY`);
 * - under 1440px it is read under the code, in a Link column wide enough for
 *   "by Rae Recruiter" from 1320px (`LINK_ROOMY_QUERY`), a step narrower below,
 *   so the driver keeps room for a name;
 * - under 1280px the driver's column keeps the `xl` width and the table scrolls
 *   inside its card rather than crushing the name (`DRIVER_FLEX_QUERY`).
 *
 * The driver's column absorbs a scrollbar or a collapsed sidebar, so none of
 * these can crowd the fixed columns.
 */
const CARDS_QUERY = '(max-width: 767px)';
const CREATED_QUERY = '(min-width: 1440px)';
const LINK_ROOMY_QUERY = '(min-width: 1320px)';
const DRIVER_FLEX_QUERY = '(min-width: 1280px)';

/** The day a link was made, and by whom, one under the other. */
function Made({ link, dateClassName }) {
    return (
        <span>
            <span className={`block ${dateClassName}`}>{when(link.createdAt) || '—'}</span>
            {link.createdByName && <span className="block text-ds-xs text-ds-content-muted">by {link.createdByName}</span>}
        </span>
    );
}

/** The referring driver: the initials, the name, and the phone as it was typed. */
function Referrer({ link }) {
    const initials = initialsOf(link.referrerName);
    return (
        <div className="flex min-w-0 items-center gap-ds-2">
            {initials ? <Avatar size="sm" tone="brand">{initials}</Avatar> : <Avatar size="sm" tone="placeholder" />}
            <div className="min-w-0">
                <p className="font-semibold text-ds-content [overflow-wrap:anywhere]">{link.referrerName}</p>
                {/* Free text a staff member typed, so it is read, not dialled. */}
                {link.referrerPhone && <p className="text-ds-sm text-ds-content-secondary max-md:text-ds-body">{link.referrerPhone}</p>}
            </div>
        </div>
    );
}

/** Whether the link is on, and the day a switched-off one was switched off. */
function LinkStatus({ link }) {
    if (link.active) return <Badge tone="success" icon={CheckCircle2}>Active</Badge>;
    const off = when(link.deactivatedAt);
    return (
        <div className="flex flex-col items-start gap-ds-1 max-md:items-end">
            <Badge tone="neutral">Deactivated</Badge>
            {off && <p className="text-ds-xs text-ds-content-muted">{off}</p>}
        </div>
    );
}

/**
 * Copy and Deactivate, for a link that is on (the column draws nothing for a
 * switched-off one). Both always appear together, so they line up from row to
 * row. On a phone's card they share its
 * width, each at the full control height.
 */
function LinkActions({ link, cards, onCopy, onDeactivate }) {
    const size = cards ? 'md' : 'sm';
    return (
        <div className="flex items-center justify-end gap-ds-2 max-md:grid max-md:w-full max-md:grid-cols-2">
            <Button variant="secondary" size={size} aria-label={`Copy the link for ${link.referrerName}`} onClick={() => onCopy(link)}>
                <Icon icon={Copy} />
                Copy
            </Button>
            <Button
                variant="secondary"
                tone="danger"
                size={size}
                aria-label={`Deactivate the link for ${link.referrerName}`}
                onClick={() => onDeactivate(link)}
            >
                Deactivate
            </Button>
        </div>
    );
}

/**
 * Referral links, switched-on ones first. On a phone each link is a card: a
 * recruiter copies one link at a time.
 *
 * What a link is and where it stands sit in their columns; what can be done
 * with it, Copy and Deactivate, sits in the last one, as on every list. A
 * switched-off link has nothing left to do. The day a link was made, and by
 * whom, has a column of its own where the page is wide enough, and is read
 * under the code where it is not.
 *
 * The card reads the same facts in a shorter shape: the driver and the status,
 * the code with the day and its maker, then what the link brought in, each
 * number under its name, and the two actions side by side.
 */
export function ReferralLinksTable({ links, counts, loading, error, onCopy, onDeactivate }) {
    const cards = useMediaQuery(CARDS_QUERY);
    const createdColumn = useMediaQuery(CREATED_QUERY);
    const linkRoomy = useMediaQuery(LINK_ROOMY_QUERY);
    const driverFlex = useMediaQuery(DRIVER_FLEX_QUERY);
    const columns = useMemo(() => {
        const referrer = {
            key: 'referrer',
            header: 'Referring driver',
            rowHeader: true,
            width: driverFlex ? 'auto' : 'xl',
            render: (link) => <Referrer link={link} />,
        };
        const status = { key: 'status', header: 'Status', width: 'sm', render: (link) => <LinkStatus link={link} /> };
        const actions = {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            // No label on a card: its buttons are the card's last line.
            mobileLabel: '',
            // `xl`: Copy and Deactivate side by side.
            width: 'xl',
            // Nothing at all for a switched-off link, so a card can leave the cell out.
            render: (link) => (link.active
                ? <LinkActions link={link} cards={cards} onCopy={onCopy} onDeactivate={onDeactivate} />
                : null),
        };

        if (cards) {
            return [
                referrer,
                { ...status, mobileRole: 'status' },
                {
                    key: 'link',
                    header: 'Link',
                    mobileRole: 'line',
                    render: (link) => (
                        <p className="flex flex-wrap items-baseline gap-x-ds-3 gap-y-ds-1 text-ds-content-secondary">
                            <span className="font-mono text-ds-content">{link.code}</span>
                            <span>{[when(link.createdAt), link.createdByName && `by ${link.createdByName}`].filter(Boolean).join(' ')}</span>
                        </p>
                    ),
                },
                {
                    key: 'broughtIn',
                    header: 'Leads · Applications · Hired',
                    mobileRole: 'line',
                    render: (link) => (
                        <dl className="grid grid-cols-3 divide-x divide-ds-border-subtle rounded-ds-lg border border-ds-border-subtle bg-ds-surface-subtle">
                            {BROUGHT_IN.map(({ field, label }) => (
                                <div key={field} className="flex min-w-0 flex-col px-ds-3 py-ds-2">
                                    <dt className="text-ds-xs text-ds-content-secondary">{label}</dt>
                                    <dd className="text-ds-heading-sm font-semibold text-ds-content">{broughtIn(counts[link.code], field)}</dd>
                                </div>
                            ))}
                        </dl>
                    ),
                },
                // A switched-off link has nothing to do, and its card ends at
                // what it brought in: the design system drops an empty actions cell.
                { ...actions, mobileRole: 'actions' },
            ];
        }

        const code = (link) => <span className="font-mono text-ds-sm">{link.code}</span>;
        return [
            referrer,
            ...(createdColumn ? [
                { key: 'link', header: 'Link', width: 'sm', render: code },
                {
                    key: 'created',
                    header: 'Created',
                    // `sm`: "by Rae Recruiter" on one line beside the tight padding.
                    width: 'sm',
                    render: (link) => <Made link={link} dateClassName="text-ds-body" />,
                },
            ] : [{
                key: 'link',
                header: 'Link',
                // The code, then the day it was made and by whom.
                width: linkRoomy ? 'md' : 'sm',
                render: (link) => (
                    <div className="flex flex-col items-start gap-ds-1">
                        {code(link)}
                        <Made link={link} dateClassName="text-ds-sm" />
                    </div>
                ),
            }]),
            // What the link brought in, a number to a column, ending at the right.
            ...BROUGHT_IN.map(({ field, label }) => ({
                key: field,
                header: label,
                align: 'end',
                width: field === 'applications' ? 'sm' : 'xs',
                render: (link) => broughtIn(counts[link.code], field),
            })),
            status,
            actions,
        ];
    }, [cards, counts, createdColumn, driverFlex, linkRoomy, onCopy, onDeactivate]);

    return (
        <DataTable
            ariaLabel="Referral links"
            density="comfortable"
            // 12px between columns, as C2 draws this list: the room goes to the
            // driver's name.
            cellPadding="tight"
            mobilePresentation="cards"
            embedded
            data={links}
            columns={columns}
            getRowId={codeOf}
            isLoading={loading}
            loadingLabel="Loading referral links"
            error={error}
            empty={{
                title: 'No referral links yet',
                description: 'Create one for a driver who sends you others: whoever applies through it is assigned to you.',
            }}
        />
    );
}

export default ReferralLinksTable;
