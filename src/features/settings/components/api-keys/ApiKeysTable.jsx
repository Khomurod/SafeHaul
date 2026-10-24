import React, { useMemo } from 'react';
import { Badge, Button, DataTable } from '@/design-system/components';

/** What each permission is called on this screen. */
const PERMISSION_NAMES = Object.freeze({
    'applications:read': 'Applications',
    'documents:read': 'Uploaded files',
    'ssn:read': 'Full SSN',
});

const keyIdOf = (key) => key.keyId;

function when(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A company's API keys, turned-on ones first. On a phone each key is a card:
 * keys are looked at one at a time, never compared.
 *
 * Where a key stands is its Status; turning it off is in the last column, as on
 * every list. The Settings page leaves the table 830px at 1440, and the six
 * columns come to 824px.
 */
export function ApiKeysTable({ keys, loading, error, onRevoke }) {
    const columns = useMemo(() => [
        {
            key: 'name',
            header: 'Key',
            rowHeader: true,
            // `lg`: the prefix keeps to one line, cut at the end, and is whole on hover.
            width: 'lg',
            render: (key) => (
                <div className="min-w-0">
                    <p className="font-semibold text-ds-content [overflow-wrap:anywhere]">{key.name}</p>
                    <p className="truncate font-mono text-ds-xs text-ds-content-muted" title={key.prefix}>{key.prefix}</p>
                </div>
            ),
        },
        {
            key: 'permissions',
            header: 'Can read',
            // The widest badge, "Uploaded files", fits; more than one stacks.
            width: 'md',
            render: (key) => (
                <div className="flex flex-wrap gap-ds-1">
                    {(key.scopes || []).map((scope) => (
                        <Badge key={scope} tone={scope === 'ssn:read' ? 'warning' : 'neutral'}>
                            {PERMISSION_NAMES[scope] || scope}
                        </Badge>
                    ))}
                </div>
            ),
        },
        {
            key: 'created',
            header: 'Created',
            width: 'md',
            render: (key) => (
                <div className="text-ds-sm">
                    <p>{when(key.createdAt) || '—'}</p>
                    {key.createdByName && <p className="text-ds-xs text-ds-content-muted">by {key.createdByName}</p>}
                </div>
            ),
        },
        {
            key: 'lastUsed',
            header: 'Last used',
            width: 'sm',
            render: (key) => <span className="text-ds-sm">{when(key.lastUsedAt) || 'Never'}</span>,
        },
        {
            key: 'status',
            header: 'Status',
            width: 'sm',
            // A key turned off keeps when under its badge.
            render: (key) => (key.revokedAt ? (
                <div className="text-ds-sm">
                    <Badge tone="neutral">Turned off</Badge>
                    <p className="mt-ds-1 text-ds-xs text-ds-content-muted">{when(key.revokedAt)}</p>
                </div>
            ) : <Badge tone="success">On</Badge>),
        },
        {
            key: 'actions',
            headerLabel: 'Actions',
            align: 'end',
            // No label on a card: its button is the card's last line.
            mobileLabel: '',
            width: 'sm',
            render: (key) => (key.revokedAt ? null : (
                <Button
                    variant="secondary"
                    tone="danger"
                    size="sm"
                    aria-label={`Turn off ${key.name}`}
                    onClick={() => onRevoke(key)}
                >
                    Turn off
                </Button>
            )),
        },
    ], [onRevoke]);

    return (
        <DataTable
            ariaLabel="API keys"
            density="compact"
            minWidth="standard"
            mobilePresentation="cards"
            embedded
            data={keys}
            columns={columns}
            getRowId={keyIdOf}
            isLoading={loading}
            loadingLabel="Loading API keys"
            error={error}
            empty={{
                title: 'No API keys yet',
                description: 'Create one when a service, such as your TMS, needs to read your applications.',
            }}
        />
    );
}

export default ApiKeysTable;
