import React, { useMemo } from 'react';
import { Copy, Icon } from '@design-system/icons';
import { Badge, Button, DataTable } from '@/design-system/components';

const codeOf = (link) => link.code;

function when(value) {
    const date = typeof value?.toDate === 'function' ? value.toDate() : null;
    return date ? date.toLocaleDateString('en-US', { dateStyle: 'medium' }) : null;
}

/** "3 leads · 1 application · 0 hired", or a dash while unknown. */
function broughtIn(count) {
    if (!count) return '—';
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return `${plural(count.leads, 'lead')} · ${plural(count.applications, 'application')} · ${count.hired} hired`;
}

/**
 * Referral links, switched-on ones first. On a phone each link is a card: a
 * recruiter copies one link at a time.
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
            width: 'md',
            render: (link) => (
                <div className="flex flex-wrap items-center gap-ds-2">
                    <span className="font-mono text-ds-sm">{link.code}</span>
                    {link.active && (
                        <Button variant="secondary" size="sm" aria-label={`Copy the link for ${link.referrerName}`} onClick={() => onCopy(link)}>
                            <Icon icon={Copy} />
                            Copy
                        </Button>
                    )}
                </div>
            ),
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
        {
            key: 'brought',
            header: 'Brought in',
            width: 'lg',
            render: (link) => <span className="text-ds-sm">{broughtIn(counts[link.code])}</span>,
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (link) => (link.active ? (
                <div className="flex flex-wrap items-center gap-ds-2">
                    <Badge tone="success">Active</Badge>
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
            ) : (
                <div className="text-ds-sm">
                    <Badge tone="neutral">Deactivated</Badge>
                    {when(link.deactivatedAt) && <p className="mt-ds-1 text-ds-xs text-ds-content-muted">{when(link.deactivatedAt)}</p>}
                </div>
            )),
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
