import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ListChecks, RefreshCw, ScrollText } from 'lucide-react';

import {
    Button,
    Card,
    DataTable,
    FieldMessage,
    TabList,
    TabPanel,
    tabIds,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import {
    deleteAiCredential,
    deleteMediaCredential,
    describeAiError,
    isReauthCancelled,
    isReauthRequired,
    diagnoseAiCredentialAccess,
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
import { AiRoutingEligibility } from '../components/ai/AiRoutingEligibility';
import { AiRoutingOrderCard } from '../components/ai/AiRoutingOrderCard';
import { AiLogsPanel } from '../components/ai/AiLogsPanel';
import {
} from '../components/ai/aiTelemetryPresentation';
import { buildProviderColumns } from '../components/ai/aiProviderColumns';
import { AiMediaProvidersSection } from '../components/ai/AiMediaProvidersSection';
import { AiDiagnosticsCards } from '../components/ai/AiDiagnosticsCards';
import { AiRecentActivityCard } from '../components/ai/AiRecentActivityCard';
import { AiProvidersOverview } from '../components/ai/AiProvidersOverview';
import { AiIntegrationsModals } from '../components/ai/AiIntegrationsModals';

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
 *
 * At ~490 lines this file is deliberately the screen's orchestration and no
 * more: the state, the handlers, and the layout. What each region renders
 * lives beside it in `../components/ai/` — the provider table's columns, the
 * overview, the Research & Media section, the diagnostics cards, the
 * recent-activity card and the three dialogs — each taking exactly the state
 * and handlers it always used, as props.
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
    const [credentialAccess, setCredentialAccess] = useState(null);
    const [checkingCredentialAccess, setCheckingCredentialAccess] = useState(false);
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

    /**
     * Asks each vendor whether the models the registry pins still exist.
     *
     * The check no fixture can perform: a pin is only a string until a request
     * is made with it, so a vendor retiring a model is invisible to CI. Six pins
     * had rotted this way before anyone noticed.
     */
    /**
     * Asks both Functions generations whether they can read the credentials.
     *
     * The check that turns an invisible IAM gap into a sentence. AI credentials
     * are read at runtime, so nothing grants the runtime service account access
     * automatically — and this console can *create* a secret it is then unable to
     * read, because writing and reading need different permissions.
     */
    const handleCheckCredentialAccess = useCallback(async () => {
        setCheckingCredentialAccess(true);
        showInfo('Checking credential access from both Functions generations…');
        try {
            const result = await diagnoseAiCredentialAccess();
            setCredentialAccess(result);
            const refused = result.generations
                .filter((entry) => entry.ok)
                .reduce((total, entry) => total + entry.report.unreadableCount, 0);
            const ran = result.generations.filter((entry) => entry.ok).length;
            if (ran === 0) {
                showError('Neither generation could run the check.');
            } else if (refused > 0) {
                showError(`${refused} credential(s) could not be read. See the grant named below.`);
            } else if (ran < result.generations.length) {
                // Half an answer is not an all-clear: the generation that failed
                // to answer is the one most likely to be misconfigured.
                showInfo('One generation reported all credentials readable; the other could not be checked.');
            } else {
                showSuccess('Both Functions generations can read every stored credential.');
            }
        } catch (error) {
            showError(describeAiError(error, 'Could not check credential access.'));
        } finally {
            setCheckingCredentialAccess(false);
        }
    }, [showError, showInfo, showSuccess]);

    const handleDiagnosePins = useCallback(async () => {
        setDiagnosingPins(true);
        showInfo('Checking model pins against each vendor…');
        try {
            const result = await diagnoseAiModelPins();
            setPinDiagnosis(result);
            if (result.stalePins > 0) {
                showError(`${result.stalePins} pinned model(s) are no longer offered by their vendor.`);
            } else if (!result.complete) {
                // Zero stale pins is not an all-clear when most providers were
                // never checked — an unconfigured or unreachable vendor
                // contributes no pins at all. Saying so beats a green message
                // that means nothing.
                showInfo(
                    `Checked ${result.checkedCount} provider(s); `
                    + `${result.uncheckedCount} could not be checked. No stale pins among those verified.`,
                );
            } else {
                showSuccess('Every pinned model is still offered by its vendor.');
            }
        } catch (error) {
            showError(describeAiError(error, 'Could not check model pins.'));
        } finally {
            setDiagnosingPins(false);
        }
    }, [showError, showInfo, showSuccess]);

    // The dependency list below is the original's, kept deliberately:
    // `testResults` was already read by the test-status cell without being a
    // dependency, and adding it now would change when the columns rebuild — a
    // behaviour change that does not belong in a size-only split.
    const columns = useMemo(() => buildProviderColumns({
        busyId,
        configDrafts,
        handleMigrateGroq,
        handleSaveConfig,
        handleTest,
        handleToggleEnabled,
        revealed,
        testingId,
        testResults,
        setConfigDrafts,
        setCredentialModal,
        setDeleteTarget,
        setDeleteError,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }), [
        busyId, configDrafts, handleMigrateGroq, handleSaveConfig, handleTest,
        handleToggleEnabled, revealed, testingId,
    ]);

    const openLogsTab = () => {
        setActiveTab('logs');
        /*
          Focus follows the switch, so a keyboard user is not
          left on a button whose panel just changed under them.
          `tabIds` is the design system's own id contract, which
          is why the strip no longer needs a ref map here.
        */
        document.getElementById(tabIds(tabsId, 'logs').tabId)?.focus();
    };

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

            <TabList
                ariaLabel="AI Integrations sections"
                idBase={tabsId}
                tabs={TABS}
                activeTab={activeTab}
                onChange={setActiveTab}
                className="overflow-x-auto"
            />

            <TabPanel idBase={tabsId} tabId={activeTab}>
            {activeTab === 'logs' && <AiLogsPanel providers={providers} />}

            {activeTab === 'providers' && (
            <Stack gap="lg">
            <AiProvidersOverview summary={summary} />

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

            <AiMediaProvidersSection
                mediaProviders={mediaProviders}
                setCredentialModal={setCredentialModal}
                setDeleteTarget={setDeleteTarget}
                setDeleteError={setDeleteError}
            />

            <AiDiagnosticsCards
                pinDiagnosis={pinDiagnosis}
                diagnosingPins={diagnosingPins}
                handleDiagnosePins={handleDiagnosePins}
                credentialAccess={credentialAccess}
                checkingCredentialAccess={checkingCredentialAccess}
                handleCheckCredentialAccess={handleCheckCredentialAccess}
            />

            {/* Recent activity lives in the Logs tab now: one transaction per
                row, expandable into the provider timeline. A second, shallower
                list here would be a competing answer to the same question. */}
            <AiRecentActivityCard telemetry={telemetry} onOpenLogs={openLogsTab} />
            </Stack>
            )}
            </TabPanel>

            <AiIntegrationsModals
                credentialModal={credentialModal}
                setCredentialModal={setCredentialModal}
                handleSaveCredential={handleSaveCredential}
                deleteTarget={deleteTarget}
                setDeleteTarget={setDeleteTarget}
                deleting={deleting}
                deleteError={deleteError}
                setDeleteError={setDeleteError}
                handleDelete={handleDelete}
                reauth={reauth}
                setReauth={setReauth}
            />
        </Stack>
    );
}

export default AiIntegrationsView;
