import React, { useMemo } from 'react';
import { Copy, Icon } from '@design-system/icons';
import { Badge, Button, DataTable } from '@/design-system/components';

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

/**
 * Referral links, switched-on ones first. On a phone each link is a card: a
 * recruiter copies one link at a time.
 *
 * What a link is and where it stands sit in their columns; what can be done
 * with it, Copy and Deactivate, sits in the last one, as on every list. A
 * switched-off link has nothing left to do.
 */
export function ReferralLinksTable({ links, counts, loading, error, onCopy, onDeactivate }) {
    const columns = useMemo(() => [
        {
            key: 'referrer',
            header: 'Referring driver',
            rowHeader: true,
            width: 'lg',
            render: (link) => (
                <div className="min-w-0">
                    <p className="font-semibold text-ds-content [overflow-wrap:anywhere]">{link.referrerName}</p>
                    {link.referrerPhone && <p className="text-ds-xs text-ds-content-muted">{link.referrerPhone}</p>}
                </div>
            ),
        },
        {
            key: 'link',
            header: 'Link',
            width: 'sm',
            render: (link) => <span className="font-mono text-ds-sm">{link.code}</span>,
        },
        {
            key: 'created',
            header: 'Created',
            width: 'md',
            render: (link) => (
                <div className="text-ds-sm">
                    <p>{when(link.createdAt) || '—'}</p>
                    {link.createdByName && <p className="text-ds-xs text-ds-content-muted">by {link.createdByName}</p>}
                </div>
            ),
        },
        // What the link brought in, a number to a column, ending at the right.
        { key: 'leads', header: 'Leads', align: 'end', width: 'xs', render: (link) => broughtIn(counts[link.code], 'leads') },
        {
            key: 'applications',
            header: 'Applications',
            align: 'end',
            width: 'md',
            render: (link) => broughtIn(counts[link.code], 'applications'),
        },
        { key: 'hired', header: 'Hired', align: 'end', width: 'xs', render: (link) => broughtIn(counts[link.code], 'hired') },
        {
            key: 'status',
            header: 'Status',
            width: 'sm',
            // A switched-off link keeps the day it was switched off under its badge.
            render: (link) => (link.active ? <Badge tone="success">Active</Badge> : (
                <div className="text-ds-sm">
                    <Badge tone="neutral">Deactivated</Badge>
                    {when(link.deactivatedAt) && <p className="mt-ds-1 text-ds-xs text-ds-content-muted">{when(link.deactivatedAt)}</p>}
                </div>
            )),
        },
        {
            key: 'actions',
            headerLabel: 'Actions',
            align: 'end',
            // No label on a card: its buttons are the card's last line.
            mobileLabel: '',
            // `xl`: Copy and Deactivate side by side.
            width: 'xl',
            render: (link) => (link.active ? (
                <div className="flex flex-wrap items-center justify-end gap-ds-2">
                    <Button variant="secondary" size="sm" aria-label={`Copy the link for ${link.referrerName}`} onClick={() => onCopy(link)}>
                        <Icon icon={Copy} />
                        Copy
                    </Button>
                    <Button
                        variant="secondary"
                        tone="danger"
                        size="sm"
                        aria-label={`Deactivate the link for ${link.referrerName}`}
                        onClick={() => onDeactivate(link)}
                    >
                        Deactivate
                    </Button>
                </div>
            ) : null),
        },
    ], [counts, onCopy, onDeactivate]);

    return (
        <DataTable
            ariaLabel="Referral links"
            density="compact"
            minWidth="standard"
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
