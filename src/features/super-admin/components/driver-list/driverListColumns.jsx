/**
 * The Unified Driver Database table's columns, extracted verbatim from
 * `views/UnifiedDriverList.jsx`. A builder rather than a component: the view
 * memoises the result with the same dependency list it always had, and the
 * handlers and state the cells use arrive through the one context argument.
 */

import React from 'react';
import {
    Trash2, Eye, MessageSquare,
    Clock,
    MapPin
} from 'lucide-react';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { StatusBadge } from '@shared/components/badges';
import { IconButton } from '@/design-system/components';
import { SourceBadge } from './UnifiedDriverListParts';

export function buildDriverListColumns({
    deletingId,
    onAppClick,
    setPendingDelete,
    getRelativeTime,
    isStale,
    getDocsStatus,
}) {
    return [
        // Identity: Name + Contact
        {
            key: 'identity',
            header: 'Driver',
            render: (item) => (
                <div className="min-w-[180px]">
                    <p className="text-ds-body font-semibold text-ds-content">
                        {item.firstName} {item.lastName}
                    </p>
                    <p className="text-ds-xs text-ds-content-muted truncate max-w-[200px] mt-0.5">
                        {item.phone ? formatPhoneNumber(item.phone) : ''}
                        {item.phone && item.email ? ' • ' : ''}
                        {item.email || ''}
                    </p>
                </div>
            ),
        },
        // Status + Stale
        {
            key: 'status',
            header: 'Status',
            render: (item) => {
                const stale = isStale(item.createdAt);
                return (
                    <div className="flex flex-col gap-1">
                        <StatusBadge status={item.status || 'New'} />
                        {stale && <StatusBadge status="Stale" />}
                    </div>
                );
            },
        },
        // Source
        {
            key: 'source',
            header: 'Source',
            render: (item) => <SourceBadge type={item.sourceType} />,
        },
        // Context: Location + Driver Type
        {
            key: 'context',
            header: 'Location / Type',
            render: (item) => (
                <div>
                    {(item.city || item.state) ? (
                        <p className="text-ds-body font-semibold text-ds-content flex items-center gap-1">
                            <MapPin size={12} className="text-ds-content-muted" />
                            {item.city}{item.city && item.state ? ', ' : ''}{item.state}
                        </p>
                    ) : (
                        <p className="text-ds-body text-ds-content-muted">—</p>
                    )}
                    <p className="text-ds-xs text-ds-content-muted mt-0.5">
                        {Array.isArray(item.driverType)
                            ? item.driverType.join(', ')
                            : item.driverType || '—'}
                    </p>
                </div>
            ),
        },
        // Details: Position + Exp + Docs
        {
            key: 'details',
            header: 'Position / Docs',
            render: (item) => {
                const docsStatus = getDocsStatus(item);
                return (
                    <div>
                        <p className="text-ds-body text-ds-content-secondary font-medium">
                            {item.positionApplyingTo || 'Driver'}
                            {item.yearsExperience ? ` · ${item.yearsExperience}y exp` : ''}
                        </p>
                        <span className={`text-ds-xs font-medium mt-0.5 inline-block ${docsStatus === 'Complete' ? 'text-ds-status-success-fg' :
                                docsStatus === 'Missing' ? 'text-ds-status-warning-fg' : 'text-ds-content-muted'
                            }`}>
                            Docs: {docsStatus}
                        </span>
                    </div>
                );
            },
        },
        // Activity
        {
            key: 'activity',
            header: 'Activity',
            render: (item) => (
                <span className="inline-flex items-center gap-1 text-ds-xs text-ds-content-muted">
                    <Clock size={12} />
                    {getRelativeTime(item.updatedAt || item.createdAt)}
                </span>
            ),
        },
        // Actions — hover-reveal
        {
            key: 'actions',
            header: '',
            headerClassName: 'w-[100px]',
            cellClassName: 'w-[100px]',
            stopPropagation: true,
            render: (item) => {
                const who = `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'this driver';
                return (
                    // `focus-within` so keyboard users can see the actions at all —
                    // they were hover-only and therefore unreachable without a mouse.
                    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                        <IconButton
                            label={`View ${who}`}
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onAppClick(item); }}
                        >
                            <Eye size={15} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            label={`Message ${who}`}
                            variant="ghost"
                            size="sm"
                        >
                            <MessageSquare size={15} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            label={`Delete ${who}`}
                            variant="ghost"
                            size="sm"
                            loading={deletingId === item.id}
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(item); }}
                        >
                            <Trash2 size={15} aria-hidden="true" className="text-ds-status-danger-fg" />
                        </IconButton>
                    </div>
                );
            },
        },
    ];
}
