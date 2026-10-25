/**
 * The Unified Driver Database table's columns. A builder rather than a
 * component: the view memoises the result with the same dependency list it
 * always had, and the handlers and state the cells use arrive through the one
 * context argument.
 *
 * `DataTable` columns: the name is the row header, its contact the quiet second
 * line under it, and the row's actions are always in view (never hover-only).
 * The record's last activity sits under its status, the freight type under
 * its location and the documents under the position, so the six columns fit
 * the owner panel at 1440px without a sideways scroll.
 * A two-line cell keeps its lines in one block, so on a phone card both sit
 * beside the column's label.
 */

import React from 'react';
import { Icon, Trash2, Eye, Clock, MapPin } from '@design-system/icons';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { StatusBadge } from '@shared/components/badges';
import { IconButton } from '@/design-system/components';
import { SourceBadge } from './UnifiedDriverListParts';

/** "First Last", or '' when the record has neither. */
export const driverName = (item) => `${item.firstName || ''} ${item.lastName || ''}`.trim();

export function buildDriverListColumns({
    deletingId,
    onAppClick,
    setPendingDelete,
    getRelativeTime,
    isStale,
    getDocsStatus,
}) {
    return [
        {
            key: 'identity',
            header: 'Driver',
            rowHeader: true,
            width: 'lg',
            render: (item) => {
                const contact = [item.phone ? formatPhoneNumber(item.phone) : '', item.email || '']
                    .filter(Boolean).join(' • ');
                return (
                    <>
                        <span className="block font-semibold text-ds-content [overflow-wrap:anywhere]">
                            {item.firstName} {item.lastName}
                        </span>
                        {contact && (
                            <span className="block text-ds-xs font-normal text-ds-content-muted [overflow-wrap:anywhere]">
                                {contact}
                            </span>
                        )}
                    </>
                );
            },
        },
        {
            key: 'status',
            header: 'Status',
            width: 'lg',
            render: (item) => {
                const updated = getRelativeTime(item.updatedAt || item.createdAt);
                return (
                    <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={item.status || 'New'} />
                        {isStale(item.createdAt) && <StatusBadge status="Stale" />}
                        {updated !== '--' && (
                            <span className="inline-flex items-center gap-1 text-ds-xs text-ds-content-muted">
                                <Icon icon={Clock} size="xs" />
                                Updated {updated}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'source',
            header: 'Source',
            width: 'md',
            render: (item) => <SourceBadge type={item.sourceType} />,
        },
        {
            key: 'context',
            header: 'Location',
            width: 'md',
            render: (item) => (
                <div className="min-w-0">
                    {(item.city || item.state) ? (
                        <span className="flex items-center gap-1 font-semibold text-ds-content">
                            <Icon icon={MapPin} size="xs" className="shrink-0 text-ds-content-muted" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                                {item.city}{item.city && item.state ? ', ' : ''}{item.state}
                            </span>
                        </span>
                    ) : (
                        <span className="block text-ds-content-muted">—</span>
                    )}
                    <span className="block text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">
                        {Array.isArray(item.driverType)
                            ? item.driverType.join(', ')
                            : item.driverType || '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'details',
            header: 'Position',
            width: 'md',
            render: (item) => {
                const docsStatus = getDocsStatus(item);
                const docsTone = docsStatus === 'Complete' ? 'text-ds-status-success-fg'
                    : docsStatus === 'Missing' ? 'text-ds-status-warning-fg' : 'text-ds-content-muted';
                return (
                    <div className="min-w-0">
                        <span className="block font-medium text-ds-content-secondary [overflow-wrap:anywhere]">
                            {item.positionApplyingTo || 'Driver'}
                            {item.yearsExperience ? ` · ${item.yearsExperience}y exp` : ''}
                        </span>
                        <span className={`block text-ds-xs font-medium ${docsTone}`}>
                            Docs: {docsStatus}
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'sm',
            stopPropagation: true,
            mobileLabel: '',
            render: (item) => {
                const who = driverName(item) || 'this driver';
                return (
                    <div className="flex justify-end gap-1">
                        <IconButton
                            label={`View ${who}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => onAppClick(item)}
                        >
                            <Icon icon={Eye} size="sm" />
                        </IconButton>
                        <IconButton
                            label={`Delete ${who}`}
                            variant="ghost"
                            size="sm"
                            loading={deletingId === item.id}
                            onClick={() => setPendingDelete(item)}
                        >
                            <Icon icon={Trash2} size="sm" className="text-ds-status-danger-fg" />
                        </IconButton>
                    </div>
                );
            },
        },
    ];
}
