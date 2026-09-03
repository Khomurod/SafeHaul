import React, { useMemo } from 'react';
import { Badge, Button, DataTable } from '@/design-system/components';

const STATUS_TONE = Object.freeze({
    prepared: { tone: 'neutral', label: 'Not sent yet' },
    sent: { tone: 'info', label: 'Link sent' },
    driver_in_progress: { tone: 'success', label: 'Driver is filling it in' },
});

/**
 * What this carrier has started, and where each one has got to.
 *
 * A worklist, not a preview: it says who and how far, and opening a row is what
 * asks the server for the answers — which it gives only while the carrier is still
 * the author of them. Once the driver has written, the row is still here and still
 * says how far they have got; the answers are theirs now.
 */
export function PreparedApplicationsTable({ applications, loading, onOpen }) {
    const columns = useMemo(() => [
        {
            key: 'name',
            header: 'Driver',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (entry) => {
                const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ');
                return <span className="font-medium text-ds-content">{name || 'Name not entered yet'}</span>;
            },
        },
        {
            key: 'contact',
            header: 'Contact',
            priority: 'secondary',
            width: 'lg',
            render: (entry) => (
                <div className="flex flex-col gap-ds-1 text-ds-sm text-ds-content-secondary">
                    {entry.email && <span>{entry.email}</span>}
                    {entry.phone && <span>{entry.phone}</span>}
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            priority: 'secondary',
            width: 'md',
            render: (entry) => {
                const status = STATUS_TONE[entry.status] || { tone: 'neutral', label: entry.status };
                return <Badge tone={status.tone}>{status.label}</Badge>;
            },
        },
        {
            key: 'prepared',
            header: 'Started by',
            priority: 'tertiary',
            width: 'md',
            render: (entry) => (
                <span className="text-ds-sm text-ds-content-secondary">{entry.preparedBy?.name || 'Someone here'}</span>
            ),
        },
        {
            key: 'open',
            header: 'Open',
            priority: 'secondary',
            width: 'sm',
            render: (entry) => (
                <Button variant="secondary" size="sm" onClick={() => onOpen(entry)}>Open</Button>
            ),
        },
    ], [onOpen]);

    return (
        <DataTable
            ariaLabel="Applications you have started"
            density="compact"
            minWidth="md"
            data={applications}
            columns={columns}
            isLoading={loading}
            loadingLabel="Loading applications you have started"
            empty={{
                title: 'You have not started any applications yet.',
                description: 'Start one when you have a driver’s paperwork in hand and they have not applied themselves.',
            }}
        />
    );
}

export default PreparedApplicationsTable;
