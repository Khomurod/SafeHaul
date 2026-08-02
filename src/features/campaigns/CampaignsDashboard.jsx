import React, { useState, useEffect, useRef } from 'react';
import {
    Plus, Rocket, History, LayoutGrid,
    Users, Zap, Loader2
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { isCancellableSessionStatus } from './constants/campaignConstants';
import { CampaignCard } from './components/CampaignCard';
import { CampaignEditor } from './CampaignEditor';
import { CampaignDetails } from './components/CampaignDetails';
import DetailedReportModal from './components/DetailedReportModal';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { useData } from '@/context/DataContext';
import { PaywallMessage } from '@shared/components/feedback/PaywallMessage';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, MetricCard } from '@/design-system/components';
import { PageContainer, PageHeader, ResponsiveGrid, Section, Stack } from '@/design-system/layouts';

// Feature-owned tab model. The design system has no tab primitive yet, so the
// dashboard renders an accessible WAI-ARIA tablist here. Values are the frozen
// activeTab contract ('drafts' | 'history'); labels/icons are presentation only.
const CAMPAIGN_TABS = [
    { value: 'drafts', label: 'Drafts', icon: LayoutGrid },
    { value: 'history', label: 'Past Sequences', icon: History },
];

export function CampaignsDashboard({ companyId }) {
    const { currentCompanyProfile } = useData();
    const isCampaignsEnabled = currentCompanyProfile?.features?.campaignsEnabled !== false;
    const [campaigns, setCampaigns] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('drafts'); // 'drafts' | 'history'
    const [selectedCampaignId, setSelectedCampaignId] = useState(null);
    const [viewingSession, setViewingSession] = useState(null);
    const [selectedReportSessionId, setSelectedReportSessionId] = useState(null);
    // Replace the two blocking `window.confirm` guards. Each holds the target
    // captured at the moment its dialog opened, so a tab switch or a live
    // `onSnapshot` update cannot retarget an open confirmation.
    const [pendingCancel, setPendingCancel] = useState(null);
    const [cancelling, setCancelling] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const tablistRef = useRef(null);
    const { showSuccess, showError } = useToast();
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';
    const e2eNow = {
        toDate: () => new Date(),
        toMillis: () => Date.now(),
    };

    // 1. Fetch Drafts
    useEffect(() => {
        if (!companyId || !isCampaignsEnabled) return;
        if (isE2ECampaignMock) {
            setCampaigns([
                {
                    id: 'camp_e2e_seed',
                    name: 'E2E Seed Campaign',
                    status: 'draft',
                    updatedAt: e2eNow,
                    matchCount: 6,
                    messageConfig: { method: 'sms', message: 'E2E seeded outreach message.' },
                },
            ]);
            setLoading(false);
            return () => {};
        }
        const q = query(
            collection(db, 'companies', companyId, 'campaign_drafts'),
            orderBy('updatedAt', 'desc')
        );
        const unsub = onSnapshot(q, (snap) => {
            setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });
        return () => unsub();
    }, [companyId, isCampaignsEnabled, isE2ECampaignMock]);

    // 1b. Fetch Live/Past Sessions
    useEffect(() => {
        if (!companyId || !isCampaignsEnabled) return;
        if (isE2ECampaignMock) {
            setSessions([
                {
                    id: 'session_e2e_seed',
                    name: 'E2E Completed Session',
                    status: 'completed',
                    progress: { processedCount: 12, totalCount: 12 },
                    config: { method: 'sms', message: 'Completed seed campaign' },
                    createdAt: e2eNow,
                    updatedAt: e2eNow,
                    matchCount: 12,
                },
            ]);
            return () => {};
        }
        const q = query(
            collection(db, 'companies', companyId, 'bulk_sessions'),
            orderBy('createdAt', 'desc')
        );
        const unsub = onSnapshot(q, (snap) => {
            setSessions(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    name: data.name,
                    status: data.status,
                    createdAt: data.createdAt,
                    updatedAt: data.lastUpdateAt || data.createdAt, // Map for CampaignCard
                    messageConfig: data.config, // Map for CampaignCard
                    matchCount: data.progress?.totalCount || data.targetIds?.length || 0,
                    progress: data.progress, // Pass full progress for bar
                    ...data
                };
            }));
        });
        return () => unsub();
    }, [companyId, isCampaignsEnabled, isE2ECampaignMock]);

    if (!isCampaignsEnabled) {
        return (
            <div className="p-8">
                <PaywallMessage
                    title="Campaigns Module Unavailable"
                    message="Bulk Actions and SMS Campaigns are currently turned off for your company. Please contact our Sales Team to enable this feature."
                />
            </div>
        );
    }

    // Stats Calculation
    const liveCount = sessions.filter(s => ['active', 'queued', 'scheduled'].includes(s.status)).length;
    const totalOutreach = sessions.reduce((acc, s) => acc + (s.progress?.processedCount || 0), 0);

    // The active tab decides which frozen list feeds the card grid.
    const visibleCampaigns = activeTab === 'drafts' ? campaigns : sessions;

    // Roving-tabindex keyboard support for the accessible tablist. Arrow/Home/End
    // move focus and activate; presentation only, no change to activeTab values.
    const handleTabKeyDown = (event, index) => {
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % CAMPAIGN_TABS.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + CAMPAIGN_TABS.length) % CAMPAIGN_TABS.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = CAMPAIGN_TABS.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        const nextTab = CAMPAIGN_TABS[nextIndex];
        setActiveTab(nextTab.value);
        tablistRef.current?.querySelector(`#campaigns-tab-${nextTab.value}`)?.focus();
    };

    // 2. Create New Campaign Draft
    const handleNewCampaign = async () => {
        if (!companyId) return;
        if (isE2ECampaignMock) {
            setSelectedCampaignId('camp_e2e_mock');
            return;
        }
        const newId = `camp_${Date.now()}`;
        try {
            await setDoc(doc(db, 'companies', companyId, 'campaign_drafts', newId), {
                name: 'Untitled Campaign',
                status: 'draft',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                filters: {},
                messageConfig: { method: 'sms', message: '' }
            });
            setSelectedCampaignId(newId);
        } catch (err) {
            showError("Failed to create campaign: " + err.message);
        }
    };

    /**
     * Cancel and delete both used to be guarded by a blocking `window.confirm`.
     * They now open the shared accessible `ConfirmDialog`.
     *
     * Both handlers capture the **target and the branch at open time** into
     * `pendingCancel` / `pendingDelete`. That matters: the delete path chooses its
     * Firestore collection from `activeTab`, and the live-session backstop reads
     * `campaign.status`. Reading either of those again at confirm time would let a
     * tab switch or an incoming `onSnapshot` update retarget an in-flight
     * confirmation at a different document.
     *
     * On failure the existing toast wording is preserved exactly and the dialog is
     * left open so the operator can retry. The toast is already a `role="alert"`
     * live region, so the failure is announced once rather than twice.
     */

    // Cancel a live (active/queued/scheduled/paused) session through the supported
    // backend flow. The worker checks session status at claim time, mid-batch, and
    // post-batch, so a cancelled session stops sending; the record is kept for
    // reporting/audit. cancelBulkSession is idempotent — re-cancelling is harmless.
    const requestCancelCampaign = (campaign) => {
        if (!companyId || !campaign.id) return;
        setPendingCancel({ id: campaign.id, name: campaign.name });
    };

    const confirmCancelCampaign = async () => {
        if (!pendingCancel) return;
        setCancelling(true);
        try {
            const cancelFn = httpsCallable(functions, 'cancelBulkSession');
            await cancelFn({ companyId, sessionId: pendingCancel.id });
            showSuccess('Campaign cancelled. No further messages will be sent.');
            setPendingCancel(null);
        } catch (err) {
            showError('Failed to cancel campaign: ' + err.message);
        } finally {
            setCancelling(false);
        }
    };

    const requestDeleteCampaign = (campaign) => {
        if (!companyId || !campaign.id) return;

        // Never delete a live session outright: the worker must observe the
        // cancelled status and stop through the supported path, and reporting
        // history must be preserved. (The card menu offers Cancel instead, so
        // this is a defensive backstop.) This runs *before* the dialog opens, so a
        // live campaign never reaches a destructive confirmation at all.
        if (activeTab !== 'drafts' && isCancellableSessionStatus(campaign.status)) {
            showError('This campaign is still live. Cancel it first — it can be deleted once it has stopped.');
            return;
        }

        setPendingDelete({ id: campaign.id, name: campaign.name, isDraft: activeTab === 'drafts' });
    };

    const confirmDeleteCampaign = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            if (pendingDelete.isDraft) {
                await deleteDoc(doc(db, 'companies', companyId, 'campaign_drafts', pendingDelete.id));
                showSuccess("Campaign draft deleted");
            } else {
                await deleteDoc(doc(db, 'companies', companyId, 'bulk_sessions', pendingDelete.id));
                showSuccess("Campaign record deleted");
            }
            setPendingDelete(null);
        } catch (err) {
            showError("Failed to delete campaign: " + err.message);
        } finally {
            setDeleting(false);
        }
    };

    if (selectedCampaignId) {
        return (
            <CampaignEditor
                companyId={companyId}
                campaignId={selectedCampaignId}
                onClose={() => setSelectedCampaignId(null)}
            />
        );
    }

    if (viewingSession) {
        return (
            <CampaignDetails
                campaign={viewingSession}
                onClose={() => setViewingSession(null)}
            />
        );
    }

    return (
        <div className="min-h-full bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="Campaigns"
                        description="Design and deploy bulk engagement sequences to reactivate your driver database."
                        actions={
                            <Button variant="primary" onClick={handleNewCampaign}>
                                <Plus size={18} aria-hidden="true" />
                                Create Campaign
                            </Button>
                        }
                    />

                    <Section aria-label="Campaign performance summary">
                        <ResponsiveGrid minItemWidth="240px">
                            <MetricCard
                                id="campaigns-stat-live"
                                label="Live Campaigns"
                                value={liveCount}
                                icon={<Zap size={20} />}
                                tone="info"
                            />
                            <MetricCard
                                id="campaigns-stat-outreach"
                                label="Total Outreach"
                                value={totalOutreach}
                                icon={<Users size={20} />}
                                tone="success"
                            />
                        </ResponsiveGrid>
                    </Section>

                    <Section aria-label="Campaign list">
                        <div
                            ref={tablistRef}
                            role="tablist"
                            aria-label="Campaign views"
                            className="inline-flex gap-ds-1 rounded-ds-lg border border-ds-border-subtle bg-ds-surface p-ds-1"
                        >
                            {CAMPAIGN_TABS.map((tab, index) => {
                                const selected = activeTab === tab.value;
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.value}
                                        type="button"
                                        role="tab"
                                        id={`campaigns-tab-${tab.value}`}
                                        aria-selected={selected}
                                        aria-controls="campaigns-tabpanel"
                                        tabIndex={selected ? 0 : -1}
                                        onClick={() => setActiveTab(tab.value)}
                                        onKeyDown={(event) => handleTabKeyDown(event, index)}
                                        className={`flex items-center gap-ds-2 rounded-ds-md px-ds-4 py-ds-2 text-ds-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                            selected
                                                ? 'bg-ds-action-primary text-ds-content-inverse shadow-ds-sm'
                                                : 'text-ds-content-muted hover:bg-ds-surface-subtle hover:text-ds-content'
                                        }`}
                                    >
                                        <Icon size={16} aria-hidden="true" />
                                        <span>{tab.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <div
                            id="campaigns-tabpanel"
                            role="tabpanel"
                            aria-labelledby={`campaigns-tab-${activeTab}`}
                            tabIndex={0}
                            className="mt-ds-6 focus-visible:outline-none"
                        >
                            {loading ? (
                                <div
                                    role="status"
                                    className="flex flex-col items-center justify-center gap-ds-4 py-ds-12 text-ds-content-muted"
                                >
                                    <Loader2 size={40} className="animate-spin" aria-hidden="true" />
                                    <span className="text-ds-sm font-semibold uppercase tracking-wide">Synchronizing…</span>
                                </div>
                            ) : visibleCampaigns.length === 0 ? (
                                <div className="flex flex-col items-center justify-center gap-ds-4 rounded-ds-lg border-2 border-dashed border-ds-border bg-ds-surface px-ds-6 py-ds-12 text-center">
                                    <span
                                        aria-hidden="true"
                                        className="flex h-16 w-16 items-center justify-center rounded-full bg-ds-surface-subtle text-ds-content-muted"
                                    >
                                        <Rocket size={32} />
                                    </span>
                                    <h2 className="text-ds-heading-md font-bold text-ds-content">
                                        No {activeTab === 'drafts' ? 'Drafts' : 'Campaigns'} Found
                                    </h2>
                                    <p className="max-w-sm text-ds-sm text-ds-content-muted">
                                        Ready to reactivate your driver database? Create your first automated messaging sequence.
                                    </p>
                                    <Button variant="primary" onClick={handleNewCampaign}>
                                        Define Initial Campaign
                                    </Button>
                                </div>
                            ) : (
                                <ResponsiveGrid minItemWidth="280px">
                                    {visibleCampaigns.map(campaign => (
                                        <CampaignCard
                                            key={campaign.id}
                                            campaign={campaign}
                                            onClick={() => activeTab === 'drafts' ? setSelectedCampaignId(campaign.id) : setViewingSession(campaign)}
                                            onDelete={requestDeleteCampaign}
                                            onCancel={activeTab === 'drafts' ? undefined : requestCancelCampaign}
                                            onViewReport={() => setSelectedReportSessionId(campaign.id)}
                                        />
                                    ))}
                                </ResponsiveGrid>
                            )}
                        </div>
                    </Section>
                </Stack>
            </PageContainer>

            <DetailedReportModal
                companyId={companyId}
                sessionId={selectedReportSessionId}
                isOpen={!!selectedReportSessionId}
                onClose={() => setSelectedReportSessionId(null)}
            />

            {/* Replaces `window.confirm("Cancel \"{name}\"? …")`. */}
            <ConfirmDialog
                isOpen={!!pendingCancel}
                tone="warning"
                title={`Cancel "${pendingCancel?.name ?? ''}"?`}
                description="Sending stops and the campaign record is kept for reporting."
                confirmLabel="Cancel campaign"
                cancelLabel="Keep sending"
                loading={cancelling}
                onConfirm={confirmCancelCampaign}
                onCancel={() => setPendingCancel(null)}
            />

            {/* Replaces `window.confirm("Are you sure you want to delete \"{name}\"?")`. */}
            <ConfirmDialog
                isOpen={!!pendingDelete}
                tone="danger"
                title={`Delete "${pendingDelete?.name ?? ''}"?`}
                description={pendingDelete?.isDraft
                    ? 'This campaign draft will be permanently deleted. This cannot be undone.'
                    : 'This campaign record and its reporting history will be permanently deleted. This cannot be undone.'}
                confirmLabel={pendingDelete?.isDraft ? 'Delete draft' : 'Delete record'}
                loading={deleting}
                onConfirm={confirmDeleteCampaign}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}
