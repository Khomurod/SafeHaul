import React, { useCallback, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    UploadCloud,
} from 'lucide-react';
import {
    Badge,
    Button,
    Card,
    DataTable,
    FormField,
    Input,
    MetricCard,
    Select,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';
import { useEnvironmentInventory } from '../hooks/useEnvironmentInventory';
import { useRevealedValue } from '../hooks/useRevealedValue';
import {
    ReauthCancelledError,
    addEnvironmentValue,
    deleteEnvironmentValue,
    describeVaultError,
    isReauthCancelled,
    isReauthRequired,
    revealEnvironmentValue,
    testManagedIntegration,
    updateEnvironmentValue,
} from '../services/environmentVault';
import { EnvironmentDeleteDialog } from '../components/environment/EnvironmentDeleteDialog';
import { EnvironmentValueModal } from '../components/environment/EnvironmentValueModal';
import { ReauthenticateModal } from '../components/environment/ReauthenticateModal';
import { buildEnvironmentColumns } from '../components/environment/environmentColumns';
import {
    SOURCE_LABELS,
    CATEGORY_LABELS,
    ACTION_LABELS,
    label,
    formatTimestamp,
} from '../components/environment/environmentPresentation';

/**
 * Super Admin "Environment & Integrations" — the complete inventory of every
 * configuration value, secret and integration credential SafeHaul uses.
 *
 * ## What this screen guarantees
 *
 * - Every value renders as `********` until an authorised Super Admin reveals
 *   that one row. The list payload contains no plaintext and no ciphertext, so
 *   there is nothing sensitive in the initial DOM to hide in the first place.
 * - A reveal is one request for one key, gated on exact `super_admin` role and a
 *   recent sign-in, rate-limited, audited without the value, and cleared after
 *   thirty seconds — or sooner on a second press, a view change, a hidden tab,
 *   unmount, sign-out or refresh.
 * - Operations the source does not support stay visible and explain themselves
 *   rather than disappearing.
 *
 * ## Why there is no `PageHeader` here
 *
 * `PageHeader` renders the page-level `<h1>`, and the Super Admin masthead
 * already owns the single `<h1>` for this shell — an invariant every migrated
 * Super Admin view shares and `e2e/super-admin-views.spec.cjs` enforces. This
 * view uses the same `<h2>` + description composition the other views use.
 */


export function EnvironmentIntegrationsView() {
    const { showSuccess, showError, showInfo } = useToast();
    const inventory = useEnvironmentInventory();

    const [reauth, setReauth] = useState(null);
    const [valueModal, setValueModal] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    /**
     * Opens the re-authentication prompt and resolves once the operator has
     * proved who they are — or rejects with `ReauthCancelledError` if they back
     * out.
     *
     * Returning a promise rather than a boolean is the point. An earlier version
     * swallowed the stale-session failure and *resolved*, so a caller went on to
     * close its dialog and report success for a mutation that had not run, and
     * would never run if the operator cancelled. Nothing downstream may continue
     * until this settles.
     */
    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setReauth({ resolve, reject });
    }), []);

    /**
     * Runs one vault operation, transparently re-authenticating once if the
     * session has gone stale. The returned promise settles only when the
     * operation itself has actually run — or rejects, so no caller can mistake a
     * pending re-authentication for a completed action.
     */
    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            // Rejects with ReauthCancelledError when the operator dismisses it.
            await requestReauth();
            // One retry. A second stale-session failure is a real failure and is
            // reported as one rather than looping the prompt.
            return operation();
        }
    }, [requestReauth]);

    const revealed = useRevealedValue({
        request: useCallback(
            (entryId) => runGuarded(() => revealEnvironmentValue(entryId)),
            [runGuarded],
        ),
    });

    const handleAction = useCallback(async (actionId, entry) => {
        if (actionId === 'edit' || actionId === 'replace') {
            setValueModal({ entry, mode: 'replace' });
            return;
        }
        if (actionId === 'add') {
            setValueModal({ entry, mode: 'add' });
            return;
        }
        if (actionId === 'delete') {
            setDeleteError(null);
            setDeleteTarget(entry);
            return;
        }
        if (actionId === 'test') {
            showInfo(`Testing ${entry.integration}…`);
            try {
                const result = await runGuarded(() => testManagedIntegration(entry.id));
                showSuccess(result.message || 'The integration responded successfully.');
            } catch (error) {
                // A dismissed re-authentication prompt means the test never ran.
                if (isReauthCancelled(error)) return;
                showError(describeVaultError(error, 'The integration could not be reached.'));
            }
        }
    }, [runGuarded, showError, showInfo, showSuccess]);

    const submitValue = useCallback(async (value) => {
        const { entry, mode } = valueModal;
        try {
            await runGuarded(() => (mode === 'add'
                ? addEnvironmentValue(entry.id, value)
                : updateEnvironmentValue(entry.id, value)));
        } catch (error) {
            // A dismissed re-authentication prompt means nothing was written.
            // The dialog stays open with the operator's input intact, and
            // nothing is claimed.
            if (isReauthCancelled(error)) return;
            // Rethrown to the modal, which shows it inline. The message never
            // contains a value — the callable guarantees that.
            throw new Error(describeVaultError(error, 'The value could not be saved.'));
        }
        setValueModal(null);
        // Deliberately never echoes the value back.
        showSuccess(entry.requiresDeployment
            ? `${entry.key} saved. It reaches the running application on the next deployment.`
            : `${entry.key} updated.`);
        inventory.reload();
    }, [inventory, runGuarded, showSuccess, valueModal]);

    const confirmDelete = useCallback(async (confirmation) => {
        setDeleting(true);
        setDeleteError(null);
        try {
            await runGuarded(() => deleteEnvironmentValue(deleteTarget.id, confirmation));
            setDeleteTarget(null);
            showSuccess(`${deleteTarget.key} deleted.`);
            inventory.reload();
        } catch (error) {
            // A dismissed re-authentication prompt means nothing was deleted.
            // The confirmation dialog stays open and says nothing.
            if (!isReauthCancelled(error)) {
                setDeleteError(describeVaultError(error, 'The value could not be deleted.'));
            }
        } finally {
            setDeleting(false);
        }
    }, [deleteTarget, inventory, runGuarded, showSuccess]);

    const columns = useMemo(() => buildEnvironmentColumns({
        handleAction,
        revealed,
    }), [handleAction, revealed]);

    const { summary, options, filters, setFilter } = inventory;

    return (
        <Stack gap="lg">
            <header>
                <h2 className="flex items-center gap-ds-2 text-ds-heading-lg font-bold text-ds-content">
                    <KeyRound className="text-ds-content-link" aria-hidden="true" /> Environment &amp; Integrations
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Every environment variable, deployment secret and stored integration credential SafeHaul uses,
                    in one inventory.
                </p>
            </header>

            <Card padding="md" aria-labelledby="environment-security-notice">
                <h3 id="environment-security-notice" className="flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                    <ShieldCheck size={18} aria-hidden="true" /> How values are handled
                </h3>
                <ul className="mt-ds-2 list-disc space-y-1 pl-ds-5 text-ds-sm text-ds-content-secondary">
                    <li>Values are masked until you reveal one, and a reveal returns exactly one key.</li>
                    <li>Revealing or changing a value needs a recent sign-in and is recorded in the audit trail, without the value.</li>
                    <li>A revealed value clears after 30 seconds, when you switch view, or when the tab is hidden. It is never copied to the clipboard for you.</li>
                    <li>GitHub Actions never returns a stored secret, so those rows report that honestly instead of showing a value.</li>
                </ul>
            </Card>

            <ResponsiveGrid minItemWidth="180px" aria-label="Inventory summary">
                <MetricCard label="Total keys" value={summary.total} icon={<KeyRound size={18} />} />
                <MetricCard label="Configured" value={summary.configured} tone="success" icon={<CheckCircle2 size={18} />} />
                <MetricCard label="Missing" value={summary.missing} tone="danger" icon={<AlertTriangle size={18} />} />
                <MetricCard label="Protected" value={summary.protected} tone="info" icon={<ShieldCheck size={18} />} />
                <MetricCard label="Needs deployment" value={summary.needsDeployment} tone="warning" icon={<UploadCloud size={18} />} />
            </ResponsiveGrid>

            <Card padding="md" aria-labelledby="environment-filters-heading">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <h3 id="environment-filters-heading" className="text-ds-heading-sm font-semibold text-ds-content">
                        Search and filter
                    </h3>
                    <Button variant="ghost" size="sm" onClick={inventory.resetFilters} disabled={!inventory.isFiltered}>
                        Clear filters
                    </Button>
                </div>

                <div className="mt-ds-3">
                    <FormField label="Search keys, integrations and companies">
                        <Input
                            type="search"
                            value={inventory.search}
                            placeholder="e.g. ENCRYPTION, RingCentral, Sentry"
                            onChange={(event) => inventory.setSearch(event.target.value)}
                        />
                    </FormField>
                </div>

                <div className="mt-ds-3">
                    <ResponsiveGrid minItemWidth="200px">
                        <FormField label="Category">
                            <Select value={filters.category} onChange={(event) => setFilter('category', event.target.value)}>
                                <option value="all">All categories</option>
                                {options.categories.map((value) => (
                                    <option key={value} value={value}>{label(CATEGORY_LABELS, value)}</option>
                                ))}
                            </Select>
                        </FormField>
                        <FormField label="Source">
                            <Select value={filters.source} onChange={(event) => setFilter('source', event.target.value)}>
                                <option value="all">All sources</option>
                                {options.sources.map((value) => (
                                    <option key={value} value={value}>{label(SOURCE_LABELS, value)}</option>
                                ))}
                            </Select>
                        </FormField>
                        <FormField label="Integration">
                            <Select value={filters.integration} onChange={(event) => setFilter('integration', event.target.value)}>
                                <option value="all">All integrations</option>
                                {options.integrations.map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </Select>
                        </FormField>
                        <FormField label="Scope">
                            <Select value={filters.scopeKind} onChange={(event) => setFilter('scopeKind', event.target.value)}>
                                <option value="all">Global and company</option>
                                <option value="global">Global only</option>
                                <option value="company">Company only</option>
                            </Select>
                        </FormField>
                        <FormField label="Company">
                            <Select value={filters.company} onChange={(event) => setFilter('company', event.target.value)}>
                                <option value="all">All companies</option>
                                {options.companies.map(([id, name]) => (
                                    <option key={id} value={id}>{name}</option>
                                ))}
                            </Select>
                        </FormField>
                        <FormField label="Status">
                            <Select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
                                <option value="all">Any status</option>
                                <option value="configured">Configured</option>
                                <option value="missing">Missing</option>
                                <option value="unknown">Not retrievable</option>
                            </Select>
                        </FormField>
                        <FormField label="Writability">
                            <Select value={filters.writability} onChange={(event) => setFilter('writability', event.target.value)}>
                                <option value="all">Editable and read-only</option>
                                <option value="editable">Editable only</option>
                                <option value="read-only">Read-only only</option>
                            </Select>
                        </FormField>
                    </ResponsiveGrid>
                </div>
            </Card>

            {inventory.companyError && (
                <Card padding="sm">
                    <p role="status" className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {inventory.companyError} Global configuration below is complete.
                    </p>
                </Card>
            )}

            {revealed.error && (
                <Card padding="sm">
                    <p role="alert" className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {describeVaultError(revealed.error.error, 'That value could not be revealed.')}
                    </p>
                </Card>
            )}

            <DataTable
                ariaLabel="Environment and integration configuration"
                data={inventory.visibleEntries}
                columns={columns}
                getRowId={(row) => row.id}
                getRowLabel={(row) => `${row.key}, ${row.integration}`}
                density="compact"
                minWidth="wide"
                isLoading={inventory.loading}
                loadingLabel="Loading the configuration inventory"
                error={inventory.error ? { message: inventory.error, onRetry: inventory.reload } : undefined}
                empty={{
                    title: inventory.isFiltered ? 'No entries match these filters.' : 'No configuration entries found.',
                    description: inventory.isFiltered
                        ? 'Clear the filters to see the full inventory.'
                        : 'The inventory is built from the configuration registry; an empty result means the registry could not be read.',
                    icon: KeyRound,
                }}
            />

            <Card padding="md" aria-labelledby="environment-activity-heading">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <h3 id="environment-activity-heading" className="text-ds-heading-sm font-semibold text-ds-content">
                        Recent configuration activity
                    </h3>
                    <Button variant="ghost" size="sm" onClick={inventory.reload}>
                        <RefreshCw size={14} aria-hidden="true" /> Refresh
                    </Button>
                </div>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Server-written and never contains a value.
                </p>
                {inventory.recentActivity.length === 0 ? (
                    <p className="mt-ds-3 text-ds-sm text-ds-content-muted">No recorded activity yet.</p>
                ) : (
                    <ul className="mt-ds-3 space-y-ds-2">
                        {inventory.recentActivity.map((event) => (
                            <li key={event.id} className="flex flex-wrap items-baseline gap-ds-2 text-ds-sm">
                                <span className="text-ds-content">{label(ACTION_LABELS, event.action)}</span>
                                {event.key && <span className="font-mono text-ds-content-secondary">{event.key}</span>}
                                <Badge tone={event.result === 'success' ? 'success' : event.result === 'denied' ? 'danger' : 'neutral'}>
                                    {event.result}
                                </Badge>
                                <span className="text-ds-content-muted">
                                    {event.actorEmail || event.actorUid || 'unknown actor'} · {formatTimestamp(event.timestamp)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {valueModal && (
                <EnvironmentValueModal
                    entry={valueModal.entry}
                    mode={valueModal.mode}
                    onSubmit={submitValue}
                    onCancel={() => setValueModal(null)}
                />
            )}

            {deleteTarget && (
                <EnvironmentDeleteDialog
                    entry={deleteTarget}
                    loading={deleting}
                    error={deleteError}
                    onConfirm={confirmDelete}
                    onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
                />
            )}

            {reauth && (
                <ReauthenticateModal
                    onSuccess={() => {
                        const { resolve } = reauth;
                        setReauth(null);
                        resolve();
                    }}
                    onCancel={() => {
                        const { reject } = reauth;
                        setReauth(null);
                        reject(new ReauthCancelledError());
                    }}
                />
            )}
        </Stack>
    );
}
