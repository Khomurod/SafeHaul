import React, { useState } from 'react';
import { Icon, Plus, Rocket, History, LayoutGrid, Users, Zap, Loader2 } from '@design-system/icons';
import { doc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { isCancellableSessionStatus } from './constants/campaignConstants';
import { CampaignCard } from './components/CampaignCard';
import { CampaignListMore } from './components/CampaignListMore';
import { CampaignEditor } from './CampaignEditor';
import { CampaignDetails } from './components/CampaignDetails';
import DetailedReportModal from './components/DetailedReportModal';
import { useCampaignLists } from './hooks/useCampaignLists';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useLoadMoreFocus } from '@shared/hooks/useLoadMoreFocus';
import { ConfirmDialog } from '@design-system/patterns';
import { useData } from '@/context/DataContext';
import { PaywallMessage } from '@shared/components/feedback/PaywallMessage';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, MetricCard, Notice, TabList, TabPanel } from '@/design-system/components';
import { PageContainer, PageHeader, ResponsiveGrid, Section, Stack } from '@/design-system/layouts';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

// The ids are the frozen `activeTab` contract ('drafts' | 'history'); labels and
// icons are presentation only. The strip itself is the design system's
// `TabList`, not a hand-rolled tablist, so a page-level view switcher looks like
// every other page-level view switcher.
const CAMPAIGN_TABS = [
    { id: 'drafts', label: 'Drafts', icon: LayoutGrid },
    { id: 'history', label: 'Past Sequences', icon: History },
];

// One `useLoadMoreFocus` per tab, so a tab switch keeps each list's focus state.
const focusOptions = (list, resetKey) => ({
    resetKey,
    hasMore: list.hasMore,
    isLoadingMore: list.isLoadingMore,
    loadMoreFailed: list.loadMoreFailed,
    loadedCount: list.items.length,
});

export function CampaignsDashboard({ companyId }) {
    const { currentCompanyProfile } = useData();
    const isCampaignsEnabled = currentCompanyProfile?.features?.campaignsEnabled !== false;
    const [activeTab, setActiveTab] = useState('drafts'); // 'drafts' | 'history'
    // The campaign open in the editor: `{ id, isNew }`, `isNew` until its first save creates the draft.
    const [openCampaign, setOpenCampaign] = useState(null);
    const [viewingSessionId, setViewingSessionId] = useState(null);
    const [selectedReportSessionId, setSelectedReportSessionId] = useState(null);
    // Replace the two blocking `window.confirm` guards. Each holds the target
    // captured at the moment its dialog opened, so a tab switch or a live
    // `onSnapshot` update cannot retarget an open confirmation.
    const [pendingCancel, setPendingCancel] = useState(null);
    const [cancelling, setCancelling] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const { showSuccess, showError } = useToast();
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';
    // The newest 50 of each list (more on request) and every live campaign; the two numbers stay exact.
    const { drafts, sessions, liveCount, totalOutreach } = useCampaignLists({ companyId, enabled: isCampaignsEnabled });
    const draftsFocus = useLoadMoreFocus(focusOptions(drafts, companyId));
    const sessionsFocus = useLoadMoreFocus(focusOptions(sessions, companyId));

    if (!isCampaignsEnabled) {
        return (
            <div className="p-ds-8">
                <PaywallMessage
                    title="Campaigns Module Unavailable"
                    message="Bulk Actions and SMS Campaigns are currently turned off for your company. Please contact our Sales Team to enable this feature."
                />
            </div>
        );
    }

    // The active tab decides which frozen list feeds the card grid, and the
    // spinner follows that list: Past Sequences waits for its history and live
    // listeners rather than showing "No Campaigns Found" first. A failure shows
    // at once, even while the other listener is still pending.
    const activeList = activeTab === 'drafts' ? drafts : sessions;
    const visibleCampaigns = activeList.items;
    const loading = activeList.isLoading && !activeList.error;

    // A new campaign opens unsaved: the editor's first save creates its draft
    // under this id, so leaving it before then leaves no empty draft behind.
    const handleNewCampaign = () => {
        if (!companyId) return;
        if (isE2ECampaignMock) {
            setOpenCampaign({ id: 'camp_e2e_mock', isNew: false });
            return;
        }
        setOpenCampaign({ id: `camp_${Date.now()}`, isNew: true });
    };

    /**
     * Cancel and delete both used to be guarded by a blocking `window.confirm`.
     * They now open the approved accessible `ConfirmDialog`.
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
            console.error('Campaign not cancelled:', err);
            showError(plainErrorMessage(err, 'The campaign could not be cancelled.'));
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
            console.error('Campaign not deleted:', err);
            showError(plainErrorMessage(err, 'The campaign could not be deleted.'));
        } finally {
            setDeleting(false);
        }
    };

    if (openCampaign) {
        return (
            <CampaignEditor
                // One editor per draft: its state (a launch included) never carries over to another.
                key={openCampaign.id}
                companyId={companyId}
                campaignId={openCampaign.id}
                isNew={openCampaign.isNew}
                onClose={() => setOpenCampaign(null)}
                // A launched draft's report: the same one View Report opens on Past Sequences.
                onViewReport={(sessionId) => {
                    setOpenCampaign(null);
                    setSelectedReportSessionId(sessionId);
                }}
            />
        );
    }

    // The details follow the live session, not the copy the card was clicked
    // with, so progress and status update while they are open; a deleted
    // session takes them back to the list.
    const viewingSession = viewingSessionId ? sessions.items.find((session) => session.id === viewingSessionId) : null;
    if (viewingSession) {
        return (
            <CampaignDetails
                campaign={viewingSession}
                onClose={() => setViewingSessionId(null)}
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
                                <Icon icon={Plus} size="lg" />
                                Create Campaign
                            </Button>
                        }
                    />

                    <Section aria-label="Campaign performance summary">
                        <ResponsiveGrid minItemWidth="240px">
                            <MetricCard
                                id="campaigns-stat-live"
                                label="Live Campaigns"
                                value={liveCount ?? '—'}
                                icon={<Icon icon={Zap} size="xl" />}
                                tone="info"
                            />
                            <MetricCard
                                id="campaigns-stat-outreach"
                                label="Total Outreach"
                                value={totalOutreach ?? '—'}
                                icon={<Icon icon={Users} size="xl" />}
                                tone="success"
                            />
                        </ResponsiveGrid>
                    </Section>

                    <Section aria-label="Campaign list">
                        <TabList
                            ariaLabel="Campaign views"
                            idBase="campaigns"
                            tabs={CAMPAIGN_TABS}
                            activeTab={activeTab}
                            onChange={setActiveTab}
                        />

                        <TabPanel idBase="campaigns" tabId={activeTab} className="mt-ds-6">
                            {loading ? (
                                <div
                                    role="status"
                                    className="flex flex-col items-center justify-center gap-ds-4 py-ds-12 text-ds-content-muted"
                                >
                                    {/* 40 is not a step. `3xl` is, and it is what the empty state
                                        beside it already uses — so the two states in
                                        this panel finally match. */}
                                    <Icon icon={Loader2} size="3xl" className="animate-spin" />
                                    <span className="text-ds-sm font-semibold uppercase tracking-wide">Synchronizing…</span>
                                </div>
                            ) : activeList.error ? (
                                <Notice
                                    tone="danger"
                                    actions={<Button variant="secondary" size="sm" onClick={activeList.retry}>Try again</Button>}
                                >
                                    {activeList.error}
                                </Notice>
                            ) : visibleCampaigns.length === 0 && !activeList.hasMore ? (
                                <div className="flex flex-col items-center justify-center gap-ds-4 rounded-ds-lg border-2 border-dashed border-ds-border bg-ds-surface px-ds-6 py-ds-12 text-center">
                                    <span
                                        aria-hidden="true"
                                        className="flex h-16 w-16 items-center justify-center rounded-ds-full bg-ds-surface-subtle text-ds-content-muted"
                                    >
                                        <Icon icon={Rocket} size="3xl" />
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
                                <>
                                    <ResponsiveGrid minItemWidth="280px">
                                        {visibleCampaigns.map(campaign => (
                                            <CampaignCard
                                                key={campaign.id}
                                                campaign={campaign}
                                                onClick={() => activeTab === 'drafts' ? setOpenCampaign({ id: campaign.id, isNew: false }) : setViewingSessionId(campaign.id)}
                                                onDelete={requestDeleteCampaign}
                                                onCancel={activeTab === 'drafts' ? undefined : requestCancelCampaign}
                                                onViewReport={() => setSelectedReportSessionId(campaign.id)}
                                            />
                                        ))}
                                    </ResponsiveGrid>
                                    <CampaignListMore
                                        tab={activeTab}
                                        list={activeList}
                                        focus={activeTab === 'drafts' ? draftsFocus : sessionsFocus}
                                    />
                                </>
                            )}
                        </TabPanel>
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
