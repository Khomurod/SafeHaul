import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Inbox, RefreshCw } from '@design-system/icons';

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
import { ListToolbar } from '@/design-system/patterns';

import { describeAiError, listAiTelemetry } from '../../services/aiIntegrations';
import { AiTransactionModal } from './AiTransactionModal';
import {
    ARTICLE_TASK_TYPES,
    LOG_SEGMENTS,
    describeOutcome,
    describeTaskType,
    formatDuration,
} from './aiTelemetryPresentation';

/** The fields behind Filters, each back to "any" when cleared. */
const FILTER_FIELDS = Object.freeze({ providerId: '', from: '', to: '' });

const EMPTY_FILTERS = Object.freeze({
    /** Which feature (`LOG_SEGMENTS`). */
    segment: 'all',
    /** Only failed transactions: the server's `outcome: 'failure'`. */
    errorsOnly: false,
    search: '',
    ...FILTER_FIELDS,
});

/**
 * What the server is asked for. Empty values mean "no filter"; the server drops
 * anything it does not recognise anyway, but sending them is noise. The article
 * pair is not a server filter (it takes one task type), so it is applied to the
 * rows instead.
 */
function serverFilters(filters, segment) {
    return Object.fromEntries(Object.entries({
        taskType: segment.taskType || '',
        outcome: filters.errorsOnly ? 'failure' : '',
        providerId: filters.providerId,
        search: filters.search,
        from: filters.from,
        to: filters.to,
    }).filter(([, value]) => value !== ''));
}

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
 * A list page in the tab (`ListToolbar`): the feature segments, "Errors only",
 * the search, and Filters for the provider and the dates.
 *
 * `ai_telemetry` is server-only in the security rules, so there is no live
 * subscription here — every read goes through the `listAiTelemetry` callable,
 * exactly as the provider list does.
 *
 * @param {object} props
 * @param {Array<{id: string, displayName: string}>} [props.providers] the Provider filter's choices
 */
export function AiLogsPanel({ providers = [] }) {
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [entries, setEntries] = useState([]);
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);

    const isFiltered = useMemo(
        () => Object.entries(filters).some(([key, value]) => value !== EMPTY_FILTERS[key]),
        [filters],
    );
    const activeCount = Object.keys(FILTER_FIELDS).filter((key) => filters[key] !== '').length;

    const load = useCallback(async (active) => {
        setLoading(true);
        setError(null);
        try {
            const segment = LOG_SEGMENTS.find((item) => item.id === active.segment) || LOG_SEGMENTS[0];
            const result = await listAiTelemetry(serverFilters(active, segment));
            const rows = result.entries || [];
            setEntries(segment.articleTasks
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

    const update = (patch) => setFilters((current) => ({ ...current, ...patch }));

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
            render: (row) => describeTaskType(row.taskType, row.trigger),
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
        <Card padding="none">
            <ListToolbar
                segments={{
                    ariaLabel: 'Feature',
                    items: LOG_SEGMENTS.map(({ id, label }) => ({ id, label })),
                    value: filters.segment,
                    onChange: (segment) => update({ segment }),
                }}
                toggle={{
                    label: 'Errors only',
                    checked: filters.errorsOnly,
                    onChange: (errorsOnly) => update({ errorsOnly }),
                }}
                search={{
                    label: 'Search transactions',
                    placeholder: 'Provider, model or error',
                    value: filters.search,
                    onChange: (search) => update({ search }),
                }}
                filters={{
                    open: filtersOpen,
                    onOpenChange: setFiltersOpen,
                    activeCount,
                    onClear: () => update(FILTER_FIELDS),
                    children: (
                        <>
                            <FormField label="Provider">
                                <Select
                                    value={filters.providerId}
                                    onChange={(event) => update({ providerId: event.target.value })}
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
                                    onChange={(event) => update({ from: event.target.value })}
                                />
                            </FormField>

                            <FormField label="To">
                                <Input
                                    type="date"
                                    value={filters.to}
                                    onChange={(event) => update({ to: event.target.value })}
                                />
                            </FormField>
                        </>
                    ),
                }}
                actions={(
                    <Button variant="secondary" loading={loading} onClick={() => load(filters)}>
                        <Icon icon={RefreshCw} size="sm" /> Refresh
                    </Button>
                )}
            />

            {truncated && (
                // Said out loud rather than implied. Provider and text
                // matching run over the page the server read, so matches can
                // exist beyond it — presenting a partial list as complete is
                // worse than admitting it is a window.
                <div className="px-ds-4 pb-ds-3">
                    <FieldMessage tone="help">
                        Showing the most recent matching transactions only. Narrow the date range to see older ones.
                    </FieldMessage>
                </div>
            )}

            <DataTable
                embedded
                ariaLabel="AI transactions"
                data={entries}
                columns={columns}
                getRowId={(row) => row.id}
                getRowLabel={(row) => (
                    `${describeTaskType(row.taskType, row.trigger)}, ${describeOutcome(row).label}, `
                    + `${row.timestamp ? new Date(row.timestamp).toLocaleString() : 'unknown time'}`
                )}
                onRowActivate={(row) => setSelected(row)}
                density="compact"
                minWidth="none"
                mobilePresentation="cards"
                isLoading={loading}
                loadingLabel="Loading AI transactions"
                error={error ? { message: error, onRetry: () => load(filters) } : undefined}
                empty={{
                    title: isFiltered ? 'No transactions match these filters.' : 'No AI requests have been recorded yet.',
                    description: isFiltered
                        ? 'Clear the search or the filters to see all recent AI activity.'
                        : 'Transactions appear here as soon as a SafeHaul feature makes an AI request.',
                    icon: Inbox,
                }}
            />

            {selected && (
                <AiTransactionModal entry={selected} onClose={() => setSelected(null)} />
            )}
        </Card>
    );
}
