/**
 * The Environment & Integrations table's columns, extracted verbatim from
 * `views/EnvironmentIntegrationsView.jsx`. A builder rather than a
 * component: the view memoises the result with the same dependency list it
 * always had, and the handlers and reveal state arrive through the one
 * context argument.
 */

import React from 'react';
import {
    Building2,
    Globe,
    UploadCloud,
} from 'lucide-react';
import {
    Badge,
} from '@/design-system/components';
import { EnvironmentActions, EnvironmentPermissionSummary } from './EnvironmentActions';
import { EnvironmentValueCell } from './EnvironmentValueCell';
import {
    STATUS_PRESENTATION,
    SOURCE_LABELS,
    label,
    formatTimestamp,
} from './environmentPresentation';

export function buildEnvironmentColumns({ handleAction, revealed }) {
    return [
        {
            key: 'key',
            header: 'Key',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (row) => (
                <div className="min-w-0">
                    <span className="block break-all font-mono text-ds-sm font-semibold text-ds-content">{row.key}</span>
                    <span className="block text-ds-sm text-ds-content-secondary">{row.displayName}</span>
                </div>
            ),
        },
        {
            key: 'integration',
            header: 'Integration',
            width: 'md',
            truncate: true,
            render: (row) => row.integration,
        },
        {
            key: 'scope',
            header: 'Scope',
            width: 'sm',
            priority: 'tertiary',
            render: (row) => (
                <span className="flex items-center gap-ds-1 text-ds-sm">
                    {row.scope === 'company'
                        ? <Building2 size={14} aria-hidden="true" />
                        : <Globe size={14} aria-hidden="true" />}
                    {row.scope === 'company' ? (row.companyName || row.companyId) : 'Global'}
                </span>
            ),
        },
        {
            key: 'source',
            header: 'Source',
            width: 'md',
            priority: 'tertiary',
            render: (row) => label(SOURCE_LABELS, row.source),
        },
        {
            key: 'status',
            header: 'Status',
            // `lg`, not `sm`: a configured entry that also needs a deployment
            // stacks two badges, which need 157px together. At 120px they spilled
            // over the next column on mobile.
            width: 'lg',
            render: (row) => {
                const presentation = STATUS_PRESENTATION[row.status] || STATUS_PRESENTATION.unknown;
                return (
                    <span className="flex flex-col items-start gap-ds-1">
                        <Badge tone={presentation.tone} icon={presentation.icon}>{presentation.label}</Badge>
                        {row.requiresDeployment && <Badge tone="warning" icon={UploadCloud}>Needs deployment</Badge>}
                    </span>
                );
            },
        },
        {
            key: 'value',
            header: 'Value',
            width: 'lg',
            render: (row) => (
                <EnvironmentValueCell
                    entry={row}
                    isRevealed={revealed.revealedId === row.id}
                    isPending={revealed.pendingId === row.id}
                    revealedValue={revealed.revealedValue}
                    unavailableReason={revealed.unavailableReason}
                    secondsRemaining={revealed.secondsRemaining}
                    onToggle={revealed.reveal}
                />
            ),
        },
        {
            key: 'permissions',
            header: 'Permissions',
            width: 'md',
            priority: 'tertiary',
            render: (row) => <EnvironmentPermissionSummary entry={row} />,
        },
        {
            key: 'lastUpdated',
            header: 'Last updated',
            width: 'md',
            priority: 'tertiary',
            render: (row) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {formatTimestamp(row.lastUpdated)}
                    {row.updatedBy && <span className="block text-ds-sm text-ds-content-muted">by {row.updatedBy}</span>}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            headerLabel: 'Actions',
            align: 'end',
            width: 'actions',
            priority: 'actions',
            stopPropagation: true,
            render: (row) => <EnvironmentActions entry={row} onAction={handleAction} />,
        },
    ];
}
