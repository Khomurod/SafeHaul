import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';

import {
    Badge,
    Button,
    Card,
    DataTable,
    FieldMessage,
    FormField,
    Input,
    Select,
    defineTableColumns,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

import { describeAiError, listAiTelemetry } from '../../services/aiIntegrations';
import { AiTransactionModal } from './AiTransactionModal';
import {
    ARTICLE_TASK_TYPES,
    LOG_QUICK_FILTERS,
    describeOutcome,
    describeTaskType,
    formatDuration,
} from './aiTelemetryPresentation';

const TASK_OPTIONS = [
    { value: '', label: 'All features' },
    { value: 'cdl_extraction', label: 'CDL extraction' },
    { value: 'edoc_field_placement', label: 'E-Doc analysis' },
    { value: 'article_generation', label: 'Article generation' },
    { value: 'article_fact_check', label: 'Article verification' },
    { value: 'health_check', label: 'Connection test' },
];

const OUTCOME_OPTIONS = [
    { value: '', label: 'Any outcome' },
    { value: 'success', label: 'Success' },
    { value: 'failure', label: 'Failure' },
];

const EMPTY_FILTERS = {
    taskType: '', outcome: '', providerId: '', search: '', from: '', to: '',
    /**
     * Client-side only, and never sent to the server.
     *
     * One article run makes TWO transactions — generation and the fact-check —
     * and the `Articles` quick filter used to select `taskType:
     * 'article_generation'` alone. So a run refused by the fact-check was
     * invisible under the one filter an operator would think to use, which is a
     * large part of why "generation succeeded" was being read as "an article
     * published". The server takes at most one equality filter, so selecting a
     * pair of task types is done here instead.
     */
    articleTasks: false,
};

/**
 * AI Integrations → Logs.
 *
 * Every SafeHaul AI request, as one row per transaction, expandable into the
 * provider-by-provider timeline that explains it.
 *
 * The screen exists because "why did CDL extraction fail at 09:14?" had no
 * answer. Telemetry recorded one summary row per request; the fallback chain's
 * causes lived only inside an error string nobody saw, so the console could show
 * that something failed and never what.
 *
 * `ai_telemetry` is server-only in the security rules, so there is no live
 * subscription here — every read goes through the `listAiTelemetry` callable,
 * exactly as the provider list does.
 *
 * @param {object} props
 * @param {(entry: object) => void} [props.onError] surfaces a load failure to the page toast
 */
export function AiLogsPanel({ providers = [] }) {
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [entries, setEntries] = useState([]);
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);

    const isFiltered = useMemo(
        () => Object.entries(filters).some(([, value]) => value !== '' && value !== false),
        [filters],
    );

    const load = useCallback(async (active) => {
        setLoading(true);
        setError(null);
        try {
            // Empty strings mean "no filter"; the server drops anything it does
            // not recognise anyway, but sending them is noise.
            const payload = Object.fromEntries(
                Object.entries(active)
                    // `articleTasks` is applied below, not by the server.
                    .filter(([key, value]) => key !== 'articleTasks' && value !== ''),
            );
            const result = await listAiTelemetry(payload);
            const rows = result.entries || [];
            setEntries(active.articleTasks
                ? rows.filter((row) => ARTICLE_TASK_TYPES.includes(row.taskType))
                : rows);
            setTruncated(Boolean(result.truncated));
        } catch (loadError) {
            setError(describeAiError(loadError, 'Could not load AI logs.'));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Debounced, because the search box filters as it is typed and each
        // keystroke would otherwise be a callable invocation against a
        // rate-limited endpoint.
        const timer = setTimeout(() => load(filters), 250);
        return () => clearTimeout(timer);
    }, [filters, load]);

    const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

    const activeQuickFilter = useMemo(() => {
        const match = LOG_QUICK_FILTERS.find((quick) => (
            (quick.filters.taskType || '') === filters.taskType
            && (quick.filters.outcome || '') === filters.outcome
            && Boolean(quick.filters.articleTasks) === Boolean(filters.articleTasks)
        ));
        return match?.id || null;
    }, [filters.taskType, filters.outcome, filters.articleTasks]);

    const columns = useMemo(() => defineTableColumns([
        {
            key: 'time',
            header: 'Time',
            width: 'md',
            rowHeader: true,
            render: (row) => (
                <span className="text-ds-sm">
                    {row.timestamp ? new Date(row.timestamp).toLocaleString() : 'Unknown'}
                </span>
            ),
        },
        {
            key: 'task',
            header: 'Feature',
            width: 'md',
            render: (row) => describeTaskType(row.taskType),
        },
        {
            key: 'outcome',
            header: 'Outcome',
            // `xl`, not `md`. Badge text does not wrap, and the longest label
            // here ("Failed — Request rejected by vendor") is far wider than the
            // common case. `AiIntegrationsView` documents the same trap.
            width: 'xl',
            render: (row) => {
                const outcome = describeOutcome(row);
                return (
                    <span className="flex flex-wrap items-center gap-ds-2">
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                        {outcome.detail && (
                            <span className="text-ds-xs text-ds-content-secondary">{outcome.detail}</span>
                        )}
                    </span>
                );
            },
        },
        {
            key: 'provider',
            header: 'Provider',
            width: 'md',
            render: (row) => row.providerId || '—',
        },
        {
            key: 'duration',
            header: 'Duration',
            align: 'end',
            width: 'sm',
            render: (row) => formatDuration(row.latencyMs),
        },
        {
            key: 'fallbacks',
            header: 'Fallbacks',
            align: 'end',
            width: 'sm',
            render: (row) => row.fallbackCount ?? 0,
        },
    ]), []);

    return (
        <Stack gap="md">
            <Card padding="md" aria-labelledby="ai-logs-filters-heading">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <h3 id="ai-logs-filters-heading" className="text-ds-heading-sm font-semibold text-ds-content">
                        Search and filter
                    </h3>
                    <div className="flex gap-ds-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFilters(EMPTY_FILTERS)}
                            disabled={!isFiltered}
                        >
                            Clear filters
                        </Button>
                        <Button variant="secondary" size="sm" loading={loading} onClick={() => load(filters)}>
                            <RefreshCw size={14} aria-hidden="true" /> Refresh
                        </Button>
                    </div>
                </div>

                <div role="group" aria-label="Quick filters" className="mt-ds-3 flex flex-wrap gap-ds-2">
                    {LOG_QUICK_FILTERS.map((quick) => (
                        <Button
                            key={quick.id}
                            size="sm"
                            variant={activeQuickFilter === quick.id ? 'primary' : 'ghost'}
                            aria-pressed={activeQuickFilter === quick.id}
                            onClick={() => setFilters((current) => ({
                                ...current,
                                taskType: quick.filters.taskType || '',
                                outcome: quick.filters.outcome || '',
                                articleTasks: Boolean(quick.filters.articleTasks),
                            }))}
                        >
                            {quick.label}
                        </Button>
                    ))}
                </div>

                <div className="mt-ds-3">
                    <FormField
                        label="Search transactions"
                        description="Matches provider, model, failure category, vendor code and transaction id."
                    >
                        <Input
                            type="search"
                            value={filters.search}
                            placeholder="e.g. quota_exceeded, gemini, model_not_found"
                            onChange={(event) => setFilter('search', event.target.value)}
                        />
                    </FormField>
                </div>

                <div className="mt-ds-3">
                    <ResponsiveGrid minItemWidth="200px">
                        <FormField label="Feature">
                            <Select
                                value={filters.taskType}
                                onChange={(event) => setFilter('taskType', event.target.value)}
                            >
                                {TASK_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </Select>
                        </FormField>

                        <FormField label="Outcome">
                            <Select
                                value={filters.outcome}
                                onChange={(event) => setFilter('outcome', event.target.value)}
                            >
                                {OUTCOME_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </Select>
                        </FormField>

                        <FormField label="Provider">
                            <Select
                                value={filters.providerId}
                                onChange={(event) => setFilter('providerId', event.target.value)}
                            >
                                <option value="">Any provider</option>
                                {providers.map((provider) => (
                                    <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                                ))}
                            </Select>
                        </FormField>

                        {/* No DatePicker exists in the design system; `type="date"`
                            inside a FormField is the shipped precedent. */}
                        <FormField label="From">
                            <Input
                                type="date"
                                value={filters.from}
                                onChange={(event) => setFilter('from', event.target.value)}
                            />
                        </FormField>

                        <FormField label="To">
                            <Input
                                type="date"
                                value={filters.to}
                                onChange={(event) => setFilter('to', event.target.value)}
                            />
                        </FormField>
                    </ResponsiveGrid>
                </div>

                {truncated && (
                    // Said out loud rather than implied. Provider and text
                    // matching run over the page the server read, so matches can
                    // exist beyond it — presenting a partial list as complete is
                    // worse than admitting it is a window.
                    <div className="mt-ds-3">
                        <FieldMessage tone="help">
                            Showing the most recent matching transactions only. Narrow the date range to see older ones.
                        </FieldMessage>
                    </div>
                )}
            </Card>

            <DataTable
                ariaLabel="AI transactions"
                data={entries}
                columns={columns}
                getRowId={(row) => row.id}
                getRowLabel={(row) => (
                    `${describeTaskType(row.taskType)}, ${describeOutcome(row).label}, `
                    + `${row.timestamp ? new Date(row.timestamp).toLocaleString() : 'unknown time'}`
                )}
                onRowActivate={(row) => setSelected(row)}
                density="compact"
                minWidth="wide"
                isLoading={loading}
                loadingLabel="Loading AI transactions"
                error={error ? { message: error, onRetry: () => load(filters) } : undefined}
                empty={{
                    title: isFiltered ? 'No transactions match these filters.' : 'No AI requests have been recorded yet.',
                    description: isFiltered
                        ? 'Clear the filters to see all recent AI activity.'
                        : 'Transactions appear here as soon as a SafeHaul feature makes an AI request.',
                    icon: Inbox,
                }}
            />

            {selected && (
                <AiTransactionModal entry={selected} onClose={() => setSelected(null)} />
            )}
        </Stack>
    );
}
