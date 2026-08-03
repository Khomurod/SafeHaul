import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PlugZap, RefreshCw, Trash2 } from 'lucide-react';

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
    listAiProviders,
    listMediaProviders,
    migrateGroqCredential,
    revealAiCredential,
    saveAiCredential,
    saveMediaCredential,
    setAiProviderEnabled,
    testAiProvider,
    updateAiProviderConfig,
} from '../services/aiIntegrations';
import { useRevealedCredential } from '../hooks/useRevealedCredential';
import { AiCredentialCell } from '../components/ai/AiCredentialCell';
import { AiProviderStatus } from '../components/ai/AiProviderStatus';
import { AiCredentialModal } from '../components/ai/AiCredentialModal';
import { AiCredentialDeleteDialog } from '../components/ai/AiCredentialDeleteDialog';
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
export function AiIntegrationsView() {
    const { showSuccess, showError, showInfo } = useToast();

    const [providers, setProviders] = useState([]);
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
    const [configDrafts, setConfigDrafts] = useState({});

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
                        Fallback position {provider.priority}
                    </span>
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
            width: 'md',
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
                return (
                    <div className="flex flex-col gap-ds-1">
                        <Badge tone={provider.lastTest.success ? 'success' : 'danger'}>
                            {provider.lastTest.success ? 'Passed' : 'Failed'}
                        </Badge>
                        <span className="text-ds-xs text-ds-content-secondary">
                            {provider.lastTest.at ? new Date(provider.lastTest.at).toLocaleString() : ''}
                        </span>
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

            {/* Recent AI activity — safe operational facts only. */}
            <Card padding="md">
                <h3 className="text-ds-sm font-semibold text-ds-content">Recent AI activity</h3>
                {telemetry.length === 0 ? (
                    <p className="mt-1 text-ds-sm text-ds-content-secondary">
                        No AI requests have been recorded yet.
                    </p>
                ) : (
                    <ul className="mt-ds-2 space-y-ds-1 text-ds-sm text-ds-content-secondary">
                        {telemetry.map((entry) => (
                            <li key={entry.id} className="flex flex-wrap items-center gap-ds-2">
                                {entry.outcome === 'success'
                                    ? <CheckCircle2 size={14} aria-hidden="true" />
                                    : <PlugZap size={14} aria-hidden="true" />}
                                <span>{entry.taskType}</span>
                                <span>·</span>
                                <span>{entry.providerId || 'no provider'}</span>
                                {entry.category && <><span>·</span><span>{entry.category}</span></>}
                                {typeof entry.latencyMs === 'number' && <><span>·</span><span>{entry.latencyMs}ms</span></>}
                                {entry.fallbackCount > 0 && <><span>·</span><span>{entry.fallbackCount} fallback(s)</span></>}
                                <span>·</span>
                                <span>{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

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
