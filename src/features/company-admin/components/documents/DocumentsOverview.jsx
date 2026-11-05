import React, { useId, useMemo } from 'react';
import { Icon, AlertCircle, CheckCircle, Clock, FileText, Loader2, MailWarning } from '@design-system/icons';
import { Badge, Button, Card, MetricCard, Notice, SelectableCard } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import {
    attentionDocuments,
    hasDeliveryFailure,
    summarizeDocuments,
} from '@features/company-admin/utils/documentsWorkspace';

/**
 * Documents workspace — Overview.
 *
 * Every number here is a count of documents the company already has; nothing is
 * estimated, projected or inferred from a rule the app does not enforce. When
 * the live query fails, the failure is shown rather than a plausible-looking
 * zero.
 *
 * Without `summary` and `attention` everything comes from `documents`. With
 * them (a company with more documents than are loaded) the numbers are
 * `summary` (null while unknown: '—', and `countsError` says why) and the
 * Needs attention list is `attention.documents`, with its own loading line and
 * failure.
 *
 * Each number opens the list it counts (`onViewAwaiting`, `onViewCompleted`,
 * `onViewNeedsAttention`, `onViewTemplates`); no button under them repeats
 * that, and no list repeats the newest rows of Sent Documents. Each Needs
 * attention card opens its document's details (`onOpenDocument`).
 */
export function DocumentsOverview({
    documents,
    isLoading,
    loadError,
    onRetry,
    summary: summaryProp,
    attention: attentionProp,
    countsError,
    onRetryCounts,
    templates,
    templatesLoading,
    onViewAwaiting,
    onViewCompleted,
    onViewNeedsAttention,
    onViewTemplates,
    onOpenDocument,
}) {
    const rawId = useId().replace(/:/g, '');
    const metricsHeadingId = `documents-overview-metrics-${rawId}`;
    const attentionHeadingId = `documents-overview-attention-${rawId}`;

    const summary = useMemo(
        () => (summaryProp !== undefined ? summaryProp : summarizeDocuments(documents)),
        [summaryProp, documents],
    );
    const attentionSource = attentionProp ? attentionProp.documents : documents;
    const attention = useMemo(() => attentionDocuments(attentionSource), [attentionSource]);
    const count = (key) => (summary ? summary[key] : '—');

    if (loadError) {
        return (
            <Card>
                <Stack gap="sm">
                    <p role="alert" className="text-ds-body text-ds-status-danger-fg">{loadError}</p>
                    <Button variant="secondary" className="self-start" onClick={onRetry}>Try again</Button>
                </Stack>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <div
                role="status"
                className="flex items-center justify-center gap-ds-2 py-ds-12 text-ds-sm text-ds-content-secondary"
            >
                <Icon icon={Loader2} size="xl" className="animate-spin" />
                Loading document overview
            </div>
        );
    }

    return (
        <Stack gap="lg">
            <section aria-labelledby={metricsHeadingId}>
                <h2 id={metricsHeadingId} className="mb-ds-3 text-ds-body font-bold text-ds-content">
                    At a glance
                </h2>
                {countsError && (
                    <Notice
                        tone="warning"
                        size="sm"
                        className="mb-ds-3"
                        actions={<Button variant="secondary" size="sm" onClick={onRetryCounts}>Try again</Button>}
                    >
                        Totals could not be loaded.
                    </Notice>
                )}
                <ResponsiveGrid minItemWidth="220px">
                    <MetricCard
                        label="Awaiting signature"
                        value={count('awaitingSignature')}
                        icon={<Icon icon={Clock} size="xl" />}
                        tone="info"
                        onActivate={onViewAwaiting}
                    />
                    <MetricCard
                        label="Completed"
                        value={count('completed')}
                        icon={<Icon icon={CheckCircle} size="xl" />}
                        tone="success"
                        onActivate={onViewCompleted}
                    />
                    <MetricCard
                        label="Needs attention"
                        value={count('needsAttention')}
                        icon={<Icon icon={AlertCircle} size="xl" />}
                        tone={summary?.needsAttention > 0 ? 'danger' : 'neutral'}
                        onActivate={onViewNeedsAttention}
                    />
                    <MetricCard
                        label="Active templates"
                        value={templatesLoading ? '—' : templates.length}
                        icon={<Icon icon={FileText} size="xl" />}
                        tone="neutral"
                        onActivate={onViewTemplates}
                    />
                </ResponsiveGrid>
            </section>

            <section aria-labelledby={attentionHeadingId}>
                <h2 id={attentionHeadingId} className="mb-ds-3 text-ds-body font-bold text-ds-content">
                    Needs attention
                </h2>
                {attentionProp?.isLoading ? (
                    <div role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <Icon icon={Loader2} size="lg" className="animate-spin" />
                        Loading documents that need attention
                    </div>
                ) : attentionProp?.error ? (
                    <Notice
                        tone="warning"
                        size="sm"
                        actions={<Button variant="secondary" size="sm" onClick={attentionProp.retry}>Try again</Button>}
                    >
                        {attentionProp.error}
                    </Notice>
                ) : attention.length === 0 ? (
                    <Card>
                        <p className="text-ds-sm text-ds-content-secondary">
                            {summary?.total === 0
                                ? 'No documents sent yet. Use New Document to send your first one.'
                                : 'No delivery or sealing failures. Documents still waiting on a signature are not counted here.'}
                        </p>
                    </Card>
                ) : (
                    <Card>
                        <Stack gap="sm">
                            {/* Each card is a button that opens the document; its
                                name is what it shows, the spaces between the
                                parts keeping them words apart. */}
                            <ul className="flex flex-col gap-ds-2">
                                {attention.map((document) => (
                                    <li key={document.id}>
                                        <SelectableCard
                                            tone="danger"
                                            className="flex-wrap justify-between"
                                            onSelect={() => onOpenDocument(document)}
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="block font-medium text-ds-content [overflow-wrap:anywhere]">
                                                    {document.title || 'Untitled'}
                                                </span>
                                                {' '}
                                                <span className="block text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                                                    {document.recipientName || 'Unknown recipient'}
                                                </span>
                                            </span>
                                            {' '}
                                            <Badge
                                                tone="danger"
                                                icon={hasDeliveryFailure(document) ? MailWarning : AlertCircle}
                                            >
                                                {hasDeliveryFailure(document) ? 'Delivery failed' : 'Seal failed'}
                                            </Badge>
                                        </SelectableCard>
                                    </li>
                                ))}
                            </ul>
                            <Button variant="secondary" className="self-start" onClick={onViewNeedsAttention}>
                                {summary ? `Review all ${summary.needsAttention}` : 'Review all'}
                            </Button>
                        </Stack>
                    </Card>
                )}
            </section>

        </Stack>
    );
}

export default DocumentsOverview;
