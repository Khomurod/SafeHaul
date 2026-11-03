import React, { useState, useId } from 'react';
import { Icon, CheckCircle2, AlertCircle, Clock, Search } from '@design-system/icons';
import { Card, Badge, Button, DataTable, Input, Label, Notice } from '@/design-system/components';
import { useLoadMoreFocus } from '@shared/hooks/useLoadMoreFocus';
import { sendResultOf } from '../constants/campaignConstants';
import { useCampaignLogs } from '../hooks/useCampaignLogs';

// An icon beside each result, so the status does not rest on colour alone.
const RESULT_ICON = { success: CheckCircle2, danger: AlertCircle, warning: AlertCircle, info: Clock, neutral: Clock };

/*
 * One row per recipient: the send result with its icon (never colour alone),
 * and under it the reason a message failed or a note on its delivery.
 */
const RESULT_COLUMNS = [
    {
        key: 'recipient',
        header: 'Recipient',
        rowHeader: true,
        width: 'md',
        render: (log) => (
            <span className="text-ds-sm font-bold text-ds-content [overflow-wrap:anywhere]">{log.recipientName || 'Unknown'}</span>
        ),
    },
    {
        key: 'contact',
        header: 'Contact',
        width: 'sm',
        render: (log) => <span className="font-mono text-ds-xs text-ds-content-secondary">{log.recipientIdentity}</span>,
    },
    {
        key: 'status',
        header: 'Status',
        width: 'lg',
        render: (log) => {
            const result = sendResultOf(log);
            return (
                <>
                    <Badge tone={result.tone} icon={RESULT_ICON[result.tone]}>
                        {result.label}
                    </Badge>
                    {result.reason && (
                        <p className="mt-ds-1 text-ds-xs font-medium text-ds-status-danger-fg">{result.reason}</p>
                    )}
                    {result.note && (
                        <p className="mt-ds-1 text-ds-xs font-medium text-ds-content-muted">{result.note}</p>
                    )}
                </>
            );
        },
    },
    {
        key: 'time',
        header: 'Time',
        width: 'sm',
        render: (log) => (
            <span className="inline-flex items-center gap-ds-1 text-ds-xs font-medium text-ds-content-muted">
                <Icon icon={Clock} size="xs" />
                {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
            </span>
        ),
    },
];

const logError = (err) => console.error('Failed to fetch logs:', err);

/** `refreshKey` reloads the log, as after a delivery check. */
export function CampaignResultsTable({ companyId, campaignId, refreshKey = 0 }) {
    const [searchTerm, setSearchTerm] = useState('');
    const searchId = useId();
    const { logs, loading, total, hasMore, loadMore, loadingMore, loadMoreFailed } = useCampaignLogs({
        companyId,
        sessionId: campaignId,
        refreshKey,
        onError: logError,
    });
    const { buttonRef, doneRef, showDone, press } = useLoadMoreFocus({
        resetKey: campaignId,
        hasMore,
        isLoadingMore: loadingMore,
        loadMoreFailed,
        loadedCount: logs.length,
    });

    const shown = logs.length.toLocaleString('en-US');
    const shownLine = total === null
        ? `Showing the newest ${shown} recipients.`
        : `Showing the newest ${shown} of ${total.toLocaleString('en-US')} recipients.`;

    const filteredLogs = logs.filter(log =>
        log.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.recipientIdentity?.includes(searchTerm)
    );

    if (loading) {
        return (
            <Card padding="lg" className="text-center">
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">
                    Loading detailed results...
                </p>
            </Card>
        );
    }

    if (logs.length === 0) {
        return (
            <Card padding="lg" className="text-center">
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">
                    No messages sent yet.
                </p>
            </Card>
        );
    }

    return (
        <Card padding="none" className="overflow-hidden">
            <div className="flex flex-col gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-ds-sm font-bold uppercase tracking-wide text-ds-content">Recipient Log</h3>
                <div className="flex items-center gap-ds-2">
                    <Icon icon={Search} className="text-ds-content-muted" />
                    <Label htmlFor={searchId} className="sr-only">Search recipients by name or contact</Label>
                    <Input
                        id={searchId}
                        type="search"
                        placeholder="Search name or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full sm:w-56"
                    />
                </div>
            </div>

            {/* The card is the frame; the rows scroll under the header, capped at 400px. */}
            <DataTable
                embedded
                ariaLabel="Recipient delivery log"
                density="compact"
                minWidth="none"
                maxHeight="md"
                data={filteredLogs}
                columns={RESULT_COLUMNS}
                getRowId={(log) => log.id}
                empty={{ title: 'No recipients match your search.' }}
            />

            {(hasMore || showDone) && (
                <div className="flex flex-col gap-ds-2 border-t border-ds-border-subtle p-ds-4">
                    {hasMore && (
                        <Notice
                            tone="info"
                            size="sm"
                            actions={(
                                <Button ref={buttonRef} variant="secondary" size="sm" loading={loadingMore} onClick={press(loadMore)}>
                                    Load more recipients
                                </Button>
                            )}
                        >
                            {`${shownLine}${searchTerm ? ' Search looks at these only.' : ''}`}
                        </Notice>
                    )}
                    {hasMore && loadMoreFailed && (
                        <p role="alert" className="text-ds-sm text-ds-status-danger-fg">More recipients could not be loaded.</p>
                    )}
                    {showDone && (
                        <Notice ref={doneRef} tabIndex={-1} tone="info" size="sm">
                            {`All ${(total ?? logs.length).toLocaleString('en-US')} recipients are shown.`}
                        </Notice>
                    )}
                </div>
            )}
        </Card>
    );
}
