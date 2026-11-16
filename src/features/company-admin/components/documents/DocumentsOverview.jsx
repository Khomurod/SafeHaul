import React, { useId, useMemo } from 'react';
import { Icon, AlertCircle, CheckCircle, Clock, FileText, Loader2, MailWarning } from '@design-system/icons';
import { Badge, Button, Card, MetricCard, Notice } from '@/design-system/components';
import { useIsMobile } from '@shared/hooks/useIsMobile';
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
 * attention row's Review opens its document's details (`onOpenDocument`).
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
    const isMobile = useIsMobile();
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

    const reviewAll = summary ? `Review all ${summary.needsAttention}` : 'Review all';
    const listed = !attentionProp?.isLoading && !attentionProp?.error && attention.length > 0;

    return (
        <Stack gap="lg">
            <section aria-labelledby={metricsHeadingId}>
                <h2
                    id={metricsHeadingId}
                    className="mb-ds-3 text-ds-body font-semibold uppercase tracking-[0.08em] text-ds-content-muted"
                >
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
                {/* Four in a row on the page, two by two on a phone. 236px, not
                    240: four of them and the grid's gaps fit a 1366px laptop's
                    1030px of content (4 × 236 + 3 × 24 = 1016). */}
                <ResponsiveGrid minItemWidth={isMobile ? '150px' : '236px'}>
                    <MetricCard
                        label="Awaiting signature"
                        value={count('awaitingSignature')}
                        icon={<Icon icon={Clock} />}
                        tone="info"
                        onActivate={onViewAwaiting}
                    />
                    <MetricCard
                        label="Completed"
                        value={count('completed')}
                        icon={<Icon icon={CheckCircle} />}
                        tone="success"
                        onActivate={onViewCompleted}
                    />
                    <MetricCard
                        label="Needs attention"
                        value={count('needsAttention')}
                        icon={<Icon icon={AlertCircle} />}
                        tone={summary?.needsAttention > 0 ? 'danger' : 'neutral'}
                        onActivate={onViewNeedsAttention}
                    />
                    <MetricCard
                        label="Active templates"
                        value={templatesLoading ? '—' : templates.length}
                        icon={<Icon icon={FileText} />}
                        tone="accent"
                        onActivate={onViewTemplates}
                    />
                </ResponsiveGrid>
            </section>

            {/* One card: its heading and Review all, then a row per document. */}
            <Card as="section" padding="none" aria-labelledby={attentionHeadingId}>
                <div className="flex flex-wrap items-center justify-between gap-ds-3 border-b border-ds-border-subtle px-ds-5 py-ds-4 max-md:p-ds-4">
                    <h2 id={attentionHeadingId} className="text-ds-heading-sm font-semibold text-ds-content">
                        Needs attention
                    </h2>
                    {listed && (
                        <Button variant="secondary" size="sm" onClick={onViewNeedsAttention}>
                            {reviewAll}
                        </Button>
                    )}
                </div>
                {attentionProp?.isLoading ? (
                    <div role="status" className="flex items-center gap-ds-2 px-ds-5 py-ds-4 text-ds-sm text-ds-content-secondary max-md:px-ds-4">
                        <Icon icon={Loader2} size="lg" className="animate-spin" />
                        Loading documents that need attention
                    </div>
                ) : attentionProp?.error ? (
                    <div className="px-ds-5 py-ds-4 max-md:px-ds-4">
                        <Notice
                            tone="warning"
                            size="sm"
                            actions={<Button variant="secondary" size="sm" onClick={attentionProp.retry}>Try again</Button>}
                        >
                            {attentionProp.error}
                        </Notice>
                    </div>
                ) : attention.length === 0 ? (
                    <p className="px-ds-5 py-ds-4 text-ds-body text-ds-content-secondary max-md:px-ds-4">
                        {summary?.total === 0
                            ? 'No documents sent yet. Use New Document to send your first one.'
                            : 'No delivery or sealing failures. Documents still waiting on a signature are not counted here.'}
                    </p>
                ) : (
                    <ul className="divide-y divide-ds-border-subtle">
                        {attention.map((document) => (
                            <AttentionRow
                                key={document.id}
                                document={document}
                                buttonSize={isMobile ? 'md' : 'sm'}
                                onReview={() => onOpenDocument(document)}
                            />
                        ))}
                    </ul>
                )}
            </Card>
        </Stack>
    );
}

/**
 * One document that needs attention: an alert tile, the title with what failed
 * beside it and the recipient under it, and Review, which opens its details.
 * On a phone Review closes the text column at its full width.
 */
function AttentionRow({ document, buttonSize, onReview }) {
    const title = document.title || 'Untitled';
    const deliveryFailed = hasDeliveryFailure(document);
    return (
        <li className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-ds-3 px-ds-5 py-ds-3 max-md:grid-cols-[2.25rem_minmax(0,1fr)] max-md:items-start max-md:gap-y-ds-3 max-md:p-ds-4">
            <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-ds-lg bg-ds-status-danger-bg text-ds-status-danger-fg"
            >
                <Icon icon={AlertCircle} size="md" />
            </span>
            <span className="flex min-w-0 flex-col gap-ds-1">
                <span className="flex flex-wrap items-center gap-x-ds-2 gap-y-ds-1">
                    <span className="text-ds-heading-sm font-semibold text-ds-content [overflow-wrap:anywhere]">
                        {document.title || 'Untitled'}
                    </span>
                    {' '}
                    <Badge tone="danger" icon={deliveryFailed ? MailWarning : AlertCircle}>
                        {deliveryFailed ? 'Delivery failed' : 'Seal failed'}
                    </Badge>
                </span>
                {' '}
                <span className="text-ds-body text-ds-content-secondary [overflow-wrap:break-word]">
                    {document.recipientName || 'Unknown recipient'}
                </span>
            </span>
            <Button
                variant="secondary"
                size={buttonSize}
                className="max-md:col-start-2 max-md:w-full"
                aria-label={`Review details for ${title}`}
                onClick={onReview}
            >
                Review
            </Button>
        </li>
    );
}

export default DocumentsOverview;
