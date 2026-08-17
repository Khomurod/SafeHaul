import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ListChecks, RefreshCw, ScrollText, Trash2 } from 'lucide-react';

import {
    Badge,
    Button,
    Card,
    DataTable,
    FieldMessage,
    FormField,
    Input,
    MetricCard,
} from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import {
    deleteAiCredential,
    deleteMediaCredential,
    describeAiError,
    isReauthCancelled,
    ReauthCancelledError,
    isReauthRequired,
    diagnoseAiModelPins,
    listAiProviders,
    listMediaProviders,
    migrateGroqCredential,
    revealAiCredential,
    saveAiCredential,
    saveMediaCredential,
    setAiProviderEnabled,
    setAiProviderPriority,
    testAiProvider,
    updateAiProviderConfig,
} from '../services/aiIntegrations';
import { useRevealedCredential } from '../hooks/useRevealedCredential';
import { AiCredentialCell } from '../components/ai/AiCredentialCell';
import { AiProviderStatus } from '../components/ai/AiProviderStatus';
import { AiRoutingEligibility } from '../components/ai/AiRoutingEligibility';
import { AiRoutingOrderCard } from '../components/ai/AiRoutingOrderCard';
import { AiCredentialModal } from '../components/ai/AiCredentialModal';
import { AiCredentialDeleteDialog } from '../components/ai/AiCredentialDeleteDialog';
import { AiLogsPanel } from '../components/ai/AiLogsPanel';
import { describePinStatus, describeProbe } from '../components/ai/aiTelemetryPresentation';
import { ReauthenticateModal } from '../components/environment/ReauthenticateModal';

/**
 * Super Admin → AI Integrations.
 *
 * One page listing every AI provider SafeHaul supports, in the order the router
 * actually tries them, plus the research and media providers the automated blog
 * uses for legally-licensed images.
 *
 * Security posture is inherited rather than re-invented: the same callables that
 * back this page enforce exact super-admin role, recent authentication for every
 * reveal and mutation, fail-closed rate limits and value-free audit records, and
 * this view reuses the vault's `ReauthenticateModal` and its
 * `requestReauth`/`runGuarded` orchestration verbatim. A credential is revealed
 * one at a time, for thirty seconds, and lives only in React state.
 *
 * This view does not render a `PageHeader`: the Super Admin masthead owns the
 * single `<h1>`, so the page starts at `<h2>`.
 */
/**
 * The two halves of this screen.
 *
 * The design system has no Tabs primitive — the roadmap records the gap — so
 * this is a feature-owned WAI-ARIA tab interface, copied from the shipped one in
 * `AnalyticsView.jsx` rather than invented: same roving focus, same ids, same
 * tokens. Copying a working implementation is the sanctioned interim, and the
 * roadmap now cites this screen alongside the others waiting on the primitive.
 */
const TABS = Object.freeze([
    { id: 'providers', label: 'Providers', icon: ListChecks },
    { id: 'logs', label: 'Logs', icon: ScrollText },
]);

export function AiIntegrationsView() {
    const { showSuccess, showError, showInfo } = useToast();

    const [providers, setProviders] = useState([]);
    const [routing, setRouting] = useState(null);
    const [mediaProviders, setMediaProviders] = useState([]);
    const [telemetry, setTelemetry] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const [reauth, setReauth] = useState(null);
    const [credentialModal, setCredentialModal] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);
    const [testingId, setTestingId] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [savingOrder, setSavingOrder] = useState(false);
    const [configDrafts, setConfigDrafts] = useState({});
    const [activeTab, setActiveTab] = useState('providers');
    const [testResults, setTestResults] = useState({});
    const [pinDiagnosis, setPinDiagnosis] = useState(null);
    const [diagnosingPins, setDiagnosingPins] = useState(false);
    const tabRefs = useRef({});
    const tabsId = useId();

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [ai, media] = await Promise.all([
                listAiProviders(),
                // The media list is secondary: a failure there must not blank
                // the AI provider table, which is the point of the page.
                listMediaProviders().catch(() => ({ providers: [] })),
            ]);
            setProviders(ai.providers || []);
            setRouting(ai.routing || null);
            setTelemetry(ai.telemetry || []);
            setMediaProviders(media.providers || []);
        } catch (error) {
            setLoadError(describeAiError(error, 'The AI provider list could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    /**
     * Returns a promise that settles only once the operator has re-authenticated
     * or dismissed the prompt. Returning a promise rather than a boolean is the
     * point: nothing downstream may treat a pending prompt as a completed action.
     */
    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setReauth({ resolve, reject });
    }), []);

    /** Runs one operation, re-authenticating once if the session has gone stale. */
    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            // Rejects with ReauthCancelledError when the operator dismisses it.
            await requestReauth();
            // One retry. A second stale-session failure is a real failure.
            return operation();
        }
    }, [requestReauth]);

    const revealed = useRevealedCredential({
        request: useCallback(
            (providerId, field) => runGuarded(() => revealAiCredential(providerId, field)),
            [runGuarded],
        ),
    });

    useEffect(() => {
        if (revealed.error) {
            showError(describeAiError(revealed.error.error, 'That credential could not be revealed.'));
        }
    }, [revealed.error, showError]);

    const summary = useMemo(() => {
        const usable = providers.filter((provider) => !provider.retired);
        return {
            total: providers.length,
            configured: usable.filter((provider) => provider.configured).length,
            enabled: usable.filter((provider) => provider.configured && provider.enabled).length,
            cooldown: usable.filter((provider) => provider.cooldown.active).length,
            retired: providers.filter((provider) => provider.retired).length,
        };
    }, [providers]);

    const handleTest = useCallback(async (provider) => {
        setTestingId(provider.id);
        showInfo(`Testing ${provider.displayName}…`);
        try {
            const result = await testAiProvider(provider.id);
            // Kept per provider so the row can show *which* capabilities
            // passed. A single pass/fail hid the failure mode that mattered:
            // text working while structured JSON was rejected on every request.
            setTestResults((current) => ({ ...current, [provider.id]: result.capabilities || [] }));
            if (result.success) showSuccess(result.message);
            else showError(result.message);
            await load();
        } catch (error) {
            showError(describeAiError(error, 'The connection test could not be run.'));
        } finally {
            setTestingId(null);
        }
    }, [load, showError, showInfo, showSuccess]);

    const handleToggleEnabled = useCallback(async (provider) => {
        setBusyId(provider.id);
        try {
            await runGuarded(() => setAiProviderEnabled(provider.id, !provider.enabled));
            showSuccess(`${provider.displayName} ${provider.enabled ? 'disabled' : 'enabled'}.`);
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'That provider could not be updated.'));
        } finally {
            setBusyId(null);
        }
    }, [load, runGuarded, showError, showSuccess]);

    const handleSaveOrder = useCallback(async (providerIds) => {
        setSavingOrder(true);
        try {
            await runGuarded(() => setAiProviderPriority(providerIds));
            showSuccess('Routing order saved. It applies to the next AI request.');
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'The routing order could not be saved.'));
        } finally {
            setSavingOrder(false);
        }
    }, [load, runGuarded, showError, showSuccess]);

    const handleSaveCredential = useCallback(async (value) => {
        const { provider, field, mode, kind } = credentialModal;
        await runGuarded(() => (kind === 'media'
            ? saveMediaCredential(provider.id, field.name, value)
            : saveAiCredential(provider.id, field.name, value)));
        setCredentialModal(null);
        showSuccess(`${provider.displayName} ${field.label.toLowerCase()} ${mode === 'add' ? 'added' : 'replaced'}.`);
        await load();
    }, [credentialModal, load, runGuarded, showSuccess]);

    const handleDelete = useCallback(async (confirmation) => {
        setDeleting(true);
        setDeleteError(null);
        try {
            const { provider, field, kind } = deleteTarget;
            await runGuarded(() => (kind === 'media'
                ? deleteMediaCredential(provider.id, field.name)
                : deleteAiCredential(provider.id, field.name, confirmation)));
            setDeleteTarget(null);
            showSuccess(`${provider.displayName} ${field.label.toLowerCase()} deleted.`);
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            setDeleteError(describeAiError(error, 'That credential could not be deleted.'));
        } finally {
            setDeleting(false);
        }
    }, [deleteTarget, load, runGuarded, showSuccess]);

    const handleSaveConfig = useCallback(async (provider) => {
        const draft = configDrafts[provider.id];
        if (!draft) return;
        setBusyId(provider.id);
        try {
            await runGuarded(() => updateAiProviderConfig(provider.id, draft));
            showSuccess(`${provider.displayName} settings saved.`);
            setConfigDrafts((current) => {
                const next = { ...current };
                delete next[provider.id];
                return next;
            });
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'Those settings could not be saved.'));
        } finally {
            setBusyId(null);
        }
    }, [configDrafts, load, runGuarded, showError, showSuccess]);

    const handleMigrateGroq = useCallback(async () => {
        setBusyId('groq');
        try {
            const result = await runGuarded(() => migrateGroqCredential());
            if (result.verified) showSuccess(result.message);
            else showError(result.message);
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'The Groq credential could not be migrated.'));
        } finally {
            setBusyId(null);
        }
    }, [load, runGuarded, showError, showSuccess]);

    // Roving focus: a tablist must answer Arrow/Home/End, not only clicks.
    const onTabKeyDown = (event) => {
        const index = TABS.findIndex((tab) => tab.id === activeTab);
        let next = null;
        if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
        if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
        if (event.key === 'Home') next = TABS[0];
        if (event.key === 'End') next = TABS[TABS.length - 1];
        if (!next) return;
        event.preventDefault();
        setActiveTab(next.id);
        tabRefs.current[next.id]?.focus();
    };

    /**
     * Asks each vendor whether the models the registry pins still exist.
     *
     * The check no fixture can perform: a pin is only a string until a request
     * is made with it, so a vendor retiring a model is invisible to CI. Six pins
     * had rotted this way before anyone noticed.
     */
    const handleDiagnosePins = useCallback(async () => {
        setDiagnosingPins(true);
        showInfo('Checking model pins against each vendor…');
        try {
            const result = await diagnoseAiModelPins();
            setPinDiagnosis(result);
            if (result.stalePins > 0) {
                showError(`${result.stalePins} pinned model(s) are no longer offered by their vendor.`);
            } else {
                showSuccess('Every pinned model is still offered by its vendor.');
            }
        } catch (error) {
            showError(describeAiError(error, 'Could not check model pins.'));
        } finally {
            setDiagnosingPins(false);
        }
    }, [showError, showInfo, showSuccess]);

    const columns = useMemo(() => [
        {
            key: 'provider',
            header: 'Provider',
            rowHeader: true,
            priority: 'primary',
            width: 'md',
            render: (provider) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-semibold text-ds-content">{provider.displayName}</span>
                    <span className="text-ds-xs text-ds-content-secondary">
                        Fallback position {provider.rank ?? provider.priority}
                    </span>
                    {typeof provider.rank === 'number' && provider.rank !== provider.priority && (
                        // The registry default is worth naming once an operator
                        // has moved away from it, so "why is this not where the
                        // documentation says" has an answer on the row itself.
                        <span className="text-ds-xs text-ds-content-secondary">
                            Default position {provider.priority}
                        </span>
                    )}
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (provider) => <AiProviderStatus provider={provider} />,
        },
        {
            key: 'capabilities',
            header: 'Capabilities',
            priority: 'tertiary',
            // `xl`, not `md`. Badges are `white-space: nowrap`, so a column
            // holding them must be at least as wide as the widest one —
            // "Structured JSON output" needs 171px, and at 144px it spilled over
            // the credentials column. `lg` clears it by 5px, which is one font
            // change away from breaking; `xl` clears it by 49px.
            width: 'xl',
            render: (provider) => (
                <div className="flex flex-wrap gap-ds-1">
                    {provider.capabilities.map((capability) => (
                        <Badge key={capability.id} tone="info">{capability.label}</Badge>
                    ))}
                </div>
            ),
        },
        {
            key: 'credentials',
            header: 'Credentials',
            width: 'lg',
            render: (provider) => (
                <Stack gap="sm">
                    {provider.credentialFields.map((field) => (
                        <AiCredentialCell
                            key={field.name}
                            providerId={provider.id}
                            providerName={provider.displayName}
                            field={field}
                            revealedSlot={revealed.revealedSlot}
                            pendingSlot={revealed.pendingSlot}
                            revealedValue={revealed.revealedValue}
                            unavailableReason={revealed.unavailableReason}
                            secondsRemaining={revealed.secondsRemaining}
                            canReveal={!provider.retired}
                            onToggle={revealed.reveal}
                        />
                    ))}
                </Stack>
            ),
        },
        {
            key: 'models',
            header: 'Model defaults',
            priority: 'tertiary',
            width: 'md',
            render: (provider) => (
                <Stack gap="sm">
                    <ul className="text-ds-xs text-ds-content-secondary">
                        {Object.entries(provider.resolvedModels).slice(0, 3).map(([capability, model]) => (
                            <li key={capability} className="break-all">{model}</li>
                        ))}
                    </ul>
                    {provider.configFields.map((field) => (
                        <FormField key={field.name} label={field.label} description={field.description}>
                            <Input
                                value={configDrafts[provider.id]?.[field.name] ?? field.value}
                                placeholder={field.placeholder}
                                autoComplete="off"
                                spellCheck={false}
                                disabled={Boolean(provider.retired)}
                                onChange={(event) => setConfigDrafts((current) => ({
                                    ...current,
                                    [provider.id]: {
                                        ...(current[provider.id] || {}),
                                        [field.name]: event.target.value,
                                    },
                                }))}
                            />
                        </FormField>
                    ))}
                    {configDrafts[provider.id] && (
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={busyId === provider.id}
                            onClick={() => handleSaveConfig(provider)}
                        >
                            Save settings
                        </Button>
                    )}
                </Stack>
            ),
        },
        {
            key: 'lastTest',
            header: 'Last test',
            priority: 'tertiary',
            width: 'sm',
            render: (provider) => {
                if (!provider.lastTest) {
                    return <span className="text-ds-xs text-ds-content-secondary">Never tested</span>;
                }
                const probes = testResults[provider.id] || [];
                return (
                    <div className="flex flex-col gap-ds-1">
                        <Badge tone={provider.lastTest.success ? 'success' : 'danger'}>
                            {provider.lastTest.success ? 'Passed' : 'Failed'}
                        </Badge>
                        <span className="text-ds-xs text-ds-content-secondary">
                            {provider.lastTest.at ? new Date(provider.lastTest.at).toLocaleString() : ''}
                        </span>
                        {/* Per-capability results from the most recent test in
                            this session. A provider that answers text but not
                            structured JSON now says so on the row rather than
                            reporting a single misleading verdict. */}
                        {probes.filter((probe) => probe.status !== 'skipped').map((probe) => {
                            const state = describeProbe(probe);
                            return (
                                <span key={probe.id} className="flex items-center gap-ds-1 text-ds-xs">
                                    <Badge tone={state.tone}>{state.label}</Badge>
                                    <span className="text-ds-content-secondary">{probe.label}</span>
                                </span>
                            );
                        })}
                    </div>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (provider) => {
                if (provider.retired) {
                    // Retired providers keep their row so the fallback order is
                    // legible, but every action would be a lie.
                    return (
                        <span className="text-ds-xs text-ds-content-secondary">
                            No actions available.
                        </span>
                    );
                }

                const firstField = provider.credentialFields[0];
                const anyConfigured = provider.credentialFields.some((field) => field.configured);

                return (
                    <div className="flex flex-wrap justify-end gap-ds-1">
                        {provider.credentialFields.map((field) => (
                            <Button
                                key={field.name}
                                size="sm"
                                variant="secondary"
                                onClick={() => setCredentialModal({
                                    provider,
                                    field,
                                    mode: field.configured ? 'replace' : 'add',
                                    kind: 'ai',
                                })}
                            >
                                {field.configured ? 'Replace' : 'Add'} {field.label.toLowerCase()}
                            </Button>
                        ))}

                        <Button
                            size="sm"
                            variant="secondary"
                            loading={testingId === provider.id}
                            disabled={!provider.configured}
                            onClick={() => handleTest(provider)}
                        >
                            Test connection
                        </Button>

                        <Button
                            size="sm"
                            variant="secondary"
                            loading={busyId === provider.id}
                            disabled={!provider.configured}
                            onClick={() => handleToggleEnabled(provider)}
                        >
                            {provider.enabled ? 'Disable' : 'Enable'}
                        </Button>

                        {provider.id === 'groq' && provider.credentialSource === 'legacy-env' && (
                            <Button
                                size="sm"
                                variant="primary"
                                loading={busyId === 'groq'}
                                onClick={handleMigrateGroq}
                            >
                                Migrate legacy key
                            </Button>
                        )}

                        {anyConfigured && firstField && (() => {
                            const target = provider.credentialFields.find((f) => f.configured) || firstField;
                            return (
                                <Button
                                    size="sm"
                                    variant="danger"
                                    // Named for the credential it deletes. A table
                                    // of identical "Delete" buttons is unusable
                                    // with a screen reader.
                                    aria-label={`Delete ${provider.displayName} ${target.label}`}
                                    onClick={() => {
                                        setDeleteError(null);
                                        setDeleteTarget({ provider, field: target, kind: 'ai' });
                                    }}
                                >
                                    <Trash2 size={14} aria-hidden="true" /> Delete
                                </Button>
                            );
                        })()}
                    </div>
                );
            },
        },
    ], [
        busyId, configDrafts, handleMigrateGroq, handleSaveConfig, handleTest,
        handleToggleEnabled, revealed, testingId,
    ]);

    return (
        <Stack gap="lg">
            <div>
                <h2 className="text-ds-heading-lg font-bold text-ds-content">AI Integrations</h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Every AI provider SafeHaul can use, listed in the order the shared router tries them.
                    All AI features — CDL auto-fill, document field analysis and the News &amp; Insights
                    blog — route through this one system.
                </p>
            </div>

            <div
                role="tablist"
                aria-label="AI Integrations sections"
                onKeyDown={onTabKeyDown}
                className="flex overflow-x-auto border-b border-ds-border-subtle"
            >
                {TABS.map((tab) => {
                    const selected = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            id={`${tabsId}-tab-${tab.id}`}
                            aria-selected={selected}
                            aria-controls={`${tabsId}-panel-${tab.id}`}
                            tabIndex={selected ? 0 : -1}
                            ref={(node) => { tabRefs.current[tab.id] = node; }}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-ds-2 whitespace-nowrap border-b-2 px-ds-4 py-ds-3 text-ds-sm font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                selected
                                    ? 'border-ds-action-primary text-ds-content-link'
                                    : 'border-transparent text-ds-content-secondary hover:text-ds-content'
                            }`}
                        >
                            <Icon size={16} aria-hidden="true" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div
                role="tabpanel"
                id={`${tabsId}-panel-${activeTab}`}
                aria-labelledby={`${tabsId}-tab-${activeTab}`}
                tabIndex={0}
                className="focus-visible:outline-none focus-visible:shadow-ds-focus"
            >
            {activeTab === 'logs' && <AiLogsPanel providers={providers} />}

            {activeTab === 'providers' && (
            <Stack gap="lg">
            <Card padding="sm">
                <h3 className="text-ds-sm font-semibold text-ds-content">How credentials are handled</h3>
                <ul className="mt-1 list-disc pl-ds-4 text-ds-sm text-ds-content-secondary">
                    <li>Values are masked by default and revealed one at a time.</li>
                    <li>Revealing or changing one needs a recent sign-in and is audited without the value.</li>
                    <li>A revealed value clears after 30 seconds, when the tab is hidden, or on leaving.</li>
                    <li>Credentials live in Google Secret Manager and take effect without a deployment.</li>
                </ul>
            </Card>

            <ResponsiveGrid minItemWidth="sm" role="group" aria-label="AI provider summary">
                <MetricCard label="Supported providers" value={String(summary.total)} />
                <MetricCard label="Configured" value={String(summary.configured)} tone="info" />
                <MetricCard label="Active in routing" value={String(summary.enabled)} tone="success" />
                <MetricCard
                    label="In cooldown"
                    value={String(summary.cooldown)}
                    tone={summary.cooldown > 0 ? 'warning' : 'neutral'}
                />
                <MetricCard
                    label="Retired by vendor"
                    value={String(summary.retired)}
                    tone={summary.retired > 0 ? 'neutral' : 'neutral'}
                />
            </ResponsiveGrid>

            {loadError && (
                <Card padding="md" tone="danger">
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                    <div className="mt-ds-2">
                        <Button variant="secondary" onClick={load}>
                            <RefreshCw size={14} aria-hidden="true" /> Try again
                        </Button>
                    </div>
                </Card>
            )}

            <AiRoutingOrderCard
                providers={providers}
                usingDefaultOrder={routing?.usingDefaultOrder !== false}
                saving={savingOrder}
                onSave={handleSaveOrder}
            />

            <AiRoutingEligibility lanes={routing?.lanes} providers={providers} />

            <DataTable
                ariaLabel="AI provider configuration"
                density="compact"
                minWidth="wide"
                data={providers}
                columns={columns}
                isLoading={loading}
                loadingLabel="Loading AI providers"
                empty={{ title: 'No AI providers are registered.' }}
            />

            {/* Research & Media — a clearly separated subsection of the same view. */}
            <div>
                <h3 className="text-ds-heading-md font-bold text-ds-content">Research &amp; Media</h3>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Image sources for automatically published articles. Every stored image records its
                    provider, source, creator, licence and attribution. When none of these is configured,
                    articles use an approved SafeHaul illustration rather than an unlicensed image.
                </p>
            </div>

            <ResponsiveGrid minItemWidth="md" role="group" aria-label="Media providers">
                {mediaProviders.map((provider) => (
                    <Card key={provider.id} padding="md">
                        <Stack gap="sm">
                            <div className="flex items-start justify-between gap-ds-2">
                                <div>
                                    <h4 className="font-semibold text-ds-content">{provider.displayName}</h4>
                                    <span className="text-ds-xs text-ds-content-secondary">
                                        Priority {provider.priority}
                                    </span>
                                </div>
                                <Badge tone={provider.configured ? 'success' : 'warning'}>
                                    {provider.configured ? 'Available' : 'Not configured'}
                                </Badge>
                            </div>

                            <p className="text-ds-xs text-ds-content-secondary">
                                {provider.requiresCredential
                                    ? 'Requires an API credential.'
                                    : 'Works without a credential; a token raises the rate limit.'}
                                {' '}
                                {provider.allowsHosting
                                    ? 'Images may be hosted by SafeHaul.'
                                    : 'Images must be hotlinked, per the provider terms.'}
                            </p>

                            {provider.credentialFields.map((field) => (
                                <div key={field.name} className="flex items-center justify-between gap-ds-2">
                                    <span className="text-ds-sm text-ds-content-secondary">
                                        {field.label}: <span className="font-mono">{field.configured ? field.maskedValue : 'none'}</span>
                                    </span>
                                    <div className="flex gap-ds-1">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setCredentialModal({
                                                provider,
                                                field,
                                                mode: field.configured ? 'replace' : 'add',
                                                kind: 'media',
                                            })}
                                        >
                                            {field.configured ? 'Replace' : 'Add'}
                                        </Button>
                                        {field.configured && (
                                            <Button
                                                size="sm"
                                                variant="danger"
                                                aria-label={`Delete ${provider.displayName} ${field.label}`}
                                                onClick={() => {
                                                    setDeleteError(null);
                                                    setDeleteTarget({ provider, field, kind: 'media' });
                                                }}
                                            >
                                                Delete
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </Stack>
                    </Card>
                ))}
            </ResponsiveGrid>

            {/* Model pins, reconciled against each vendor's live catalogue.
                A pin is only a string until a request is made with it, so this
                is the one check that can catch a vendor retiring a model. */}
            <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <div>
                        <h3 className="text-ds-sm font-semibold text-ds-content">Model pins</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Asks each configured vendor whether the models SafeHaul pins still exist.
                            Six pins had been naming retired models before this check existed.
                        </p>
                    </div>
                    <Button variant="secondary" size="sm" loading={diagnosingPins} onClick={handleDiagnosePins}>
                        Verify model pins
                    </Button>
                </div>

                {pinDiagnosis && (
                    <ul className="mt-ds-3 space-y-ds-2">
                        {pinDiagnosis.providers.map((entry) => {
                            const state = describePinStatus(entry);
                            return (
                                <li key={entry.providerId} className="flex flex-wrap items-center gap-ds-2 text-ds-sm">
                                    <span className="font-semibold text-ds-content">{entry.displayName}</span>
                                    <Badge tone={state.tone}>{state.label}</Badge>
                                    {entry.pins.filter((pin) => !pin.present).map((pin) => (
                                        <span key={pin.model} className="text-ds-xs text-ds-content-secondary">
                                            {pin.model} ({pin.capabilities.join(', ')})
                                        </span>
                                    ))}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>

            {/* Recent activity lives in the Logs tab now: one transaction per
                row, expandable into the provider timeline. A second, shallower
                list here would be a competing answer to the same question. */}
            <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <div>
                        <h3 className="text-ds-sm font-semibold text-ds-content">Recent AI activity</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            {telemetry.length > 0
                                ? `${telemetry.length} recent transaction${telemetry.length === 1 ? '' : 's'} recorded.`
                                : 'No AI requests have been recorded yet.'}
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            setActiveTab('logs');
                            tabRefs.current.logs?.focus();
                        }}
                    >
                        <ScrollText size={14} aria-hidden="true" /> Open logs
                    </Button>
                </div>
            </Card>
            </Stack>
            )}
            </div>

            {credentialModal && (
                <AiCredentialModal
                    provider={credentialModal.provider}
                    field={credentialModal.field}
                    mode={credentialModal.mode}
                    onSubmit={handleSaveCredential}
                    onCancel={() => setCredentialModal(null)}
                />
            )}

            {deleteTarget && (
                <AiCredentialDeleteDialog
                    provider={deleteTarget.provider}
                    field={deleteTarget.field}
                    loading={deleting}
                    error={deleteError}
                    onConfirm={handleDelete}
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
                        // The typed error is what lets every caller distinguish
                        // "the operator backed out" from "the server refused",
                        // so a cancelled mutation is never reported as done.
                        reject(new ReauthCancelledError());
                    }}
                />
            )}
        </Stack>
    );
}

export default AiIntegrationsView;
