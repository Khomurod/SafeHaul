import React, { Suspense, lazy, useState, useId, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db, auth } from '@lib/firebase';
import { collection, deleteDoc, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useData } from '@/context/DataContext';
import { GlobalLoadingState } from '@shared/components/feedback';
import { Icon, LayoutDashboard, Send, FileText, ClipboardList, ArrowLeft, Plus } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { SendTemplateWizard } from '../components/documents/SendTemplateWizard';
import { DocumentsOverview } from '../components/documents/DocumentsOverview';
import { SentDocumentsPanel } from '../components/documents/SentDocumentsPanel';
import { TemplateLibraryPanel } from '../components/documents/TemplateLibraryPanel';
import { ApplicationFormsPanel } from '../components/documents/ApplicationFormsPanel';
import { NewDocumentDialog } from '../components/documents/NewDocumentDialog';
import { DEFAULT_FILTERS, isTemplateDuplicable, sentHeaderCount } from '../utils/documentsWorkspace';
import { useDocumentsWorkspaceData } from '../hooks/useDocumentsWorkspaceData';
import { useSentDocumentActions } from '@features/signing/hooks/useSentDocumentActions';
import { SentDocumentDialogs } from '@features/signing/components/SentDocumentDialogs';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { useCompanyTemplates } from '../hooks/useCompanyTemplates';
import { useTemplateSendFlow } from '../hooks/useTemplateSendFlow';
import { usePostSubmitForms } from '../hooks/usePostSubmitForms';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { ConfirmDialog } from '@design-system/patterns';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, TabList, TabPanel } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { isFeatureOn } from '@shared/utils/companyFeatures';

// The editor (the PDF workbench with pdf.js, and the AI field assistant) loads
// when a document is created or edited, not with the workspace's lists.
const EnvelopeCreator = lazy(() => import('@features/signing/EnvelopeCreator'));

/**
 * The four Documents workspace views, in tab order.
 *
 * `overview` is the default: the old page opened straight into a tool (the
 * history table) with no sense of what needed doing. `?view=<id>` opens another
 * (the dashboard's Company setup links to `forms` and `templates`). `forms` is
 * named for what it holds, the templates sent after an application, apart from
 * Settings → Application questions; its id, and so its address, stays.
 *
 * The design system has no approved Tabs primitive yet (tracked in the
 * roadmap), so this WAI-ARIA tab interface stays feature-owned.
 */
const DOCUMENT_TABS = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'sent', label: 'Sent Documents', icon: Send },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'forms', label: 'After-application forms', icon: ClipboardList },
];
const viewNamed = (view) => (DOCUMENT_TABS.some((tab) => tab.id === view) ? view : 'overview');

export default function DocumentsManager() {
    const { currentCompanyProfile, currentUserClaims } = useData();
    // Only a company admin may delete a template (the rules' `templates` delete).
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);
    const navigate = useNavigate();
    const { showSuccess, showError, showWarning } = useToast();

    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState(() => viewNamed(searchParams.get('view')));
    const [viewMode, setViewMode] = useState('view');
    const [creatorInitialMode, setCreatorInitialMode] = useState('request');
    const [editRequestId, setEditRequestId] = useState(null);
    const [editTemplateId, setEditTemplateId] = useState(null);
    const [showNewDocumentDialog, setShowNewDocumentDialog] = useState(false);

    const [templateSearch, setTemplateSearch] = useState('');
    const [templateSort, setTemplateSort] = useState('updated');
    const [duplicatingTemplateId, setDuplicatingTemplateId] = useState(null);

    const [sentFilters, setSentFilters] = useState({ ...DEFAULT_FILTERS });

    // Replaces the blocking `window.confirm("Delete template?")`.
    const [pendingTemplateDelete, setPendingTemplateDelete] = useState(null);
    const [deletingTemplate, setDeletingTemplate] = useState(false);
    const isE2EEdocMock = isE2ETestMode && getE2EQueryParam('e2eEdoc', '') === 'mock';

    const tabsIdBase = `edocs-${useId().replace(/:/g, '')}`;

    // One data hook for Overview and Sent Documents: the live window of the newest
    // signing requests and, past one window, server counts and a live list of the
    // documents that need attention (`useDocumentsWorkspaceData`).
    const workspace = useDocumentsWorkspaceData({ companyId: currentCompanyProfile?.id, isE2EEdocMock });
    const { documents: signingRequests, isLoading: signingRequestsLoading, loadError: signingRequestsError, retry: retrySigningRequests } = workspace;
    // The heading counts what Sent Documents lists (`sentHeaderCount`), once known.
    const { list: sentList, attention, summary } = workspace;
    const sentCount = useMemo(
        () => sentHeaderCount({ filters: sentFilters, documents: signingRequests, list: sentList, attention, summary }),
        [sentFilters, signingRequests, sentList, attention, summary],
    );
    const showSentCount = activeTab === 'sent' && !signingRequestsLoading && !signingRequestsError && sentCount !== undefined;

    const { templates, templatesLoading } = useCompanyTemplates({ companyId: currentCompanyProfile?.id, isE2EEdocMock });

    // The template-send flow (wizard state, the applicant and lead picker,
    // prefill, executeTemplateSend) and the post-application forms configuration
    // each moved to a feature hook, called here so every piece of state keeps
    // exactly the lifetime it had when it was declared inline. Each result goes
    // to its component whole (`flow`, `forms`).
    const sendFlow = useTemplateSendFlow({ currentCompanyProfile, isE2EEdocMock, navigate, setActiveTab, showSuccess, showError, showWarning });

    const forms = usePostSubmitForms({ currentCompanyProfile, templates, showSuccess, showError });
    // What the template delete flow below reads and prunes.
    const { postSubmitTemplateIds, setPostSubmitTemplateIds, postSubmitRequiredById, buildPostSubmitConfig } = forms;

    // PHASE 4: Handle "Correct" action from EnvelopeHistory
    const handleCorrect = (docItem) => {
        setEditRequestId(docItem.id);
        setEditTemplateId(null);
        setCreatorInitialMode('request');
        setViewMode('create');
    };

    // The Overview's Needs attention cards open the details dialog Sent
    // Documents opens, with the same actions.
    const overviewDocumentActions = useSentDocumentActions({
        companyId: currentCompanyProfile?.id,
        companyName: currentCompanyProfile?.companyName || currentCompanyProfile?.name || '',
        onCorrect: handleCorrect,
    });

    /** Sent Documents with only `filters` applied, from an Overview number. */
    const viewSent = (filters) => {
        setSentFilters({ ...DEFAULT_FILTERS, ...filters });
        setActiveTab('sent');
    };

    /**
     * Template deletion used to be guarded by a blocking `window.confirm("Delete
     * template?")` — a question that did not even say *which* template.
     *
     * `requestDeleteTemplate` captures the template at open time (id, title, and
     * whether it is currently wired into the post-application flow) so the dialog
     * can name it and warn about the second effect. `confirmDeleteTemplate` runs
     * the original sequence unchanged.
     */
    // Takes an id, not a template: the panel's `onDelete(id)` callback shape is a
    // frozen contract (see its own tests), so the lookup happens here.
    const requestDeleteTemplate = (id) => {
        if (!id) return;
        const template = templates.find((item) => item.id === id);
        setPendingTemplateDelete({
            id,
            title: String(template?.title || 'Untitled template').trim(),
            isPostSubmit: postSubmitTemplateIds.includes(id),
        });
    };

    // A refused delete keeps the confirmation open and says why.
    const confirmDeleteTemplate = async () => {
        if (!pendingTemplateDelete) return;
        setDeletingTemplate(true);
        try {
            await handleDeleteTemplate(pendingTemplateDelete.id);
            setPendingTemplateDelete(null);
        } catch (error) {
            console.error('[DocumentsManager] Failed deleting template:', { code: error?.code });
            showError(error?.code === 'permission-denied'
                ? 'Only a company admin can delete templates.'
                : 'Could not delete this template. Please try again.');
        } finally {
            setDeletingTemplate(false);
        }
    };

    const handleDeleteTemplate = async (id) => {
        await deleteDoc(doc(db, 'companies', currentCompanyProfile.id, 'templates', id));
        const nextIds = postSubmitTemplateIds.filter((templateId) => templateId !== id);
        setPostSubmitTemplateIds(nextIds);
        // Persist immediately when a configured post-submit form is deleted —
        // a stale companies/{id}.postApplicationTemplates entry would otherwise
        // keep offering applicants a document whose template no longer exists.
        if (nextIds.length !== postSubmitTemplateIds.length) {
            try {
                await updateDoc(doc(db, 'companies', currentCompanyProfile.id), {
                    postApplicationTemplates: buildPostSubmitConfig(nextIds, postSubmitRequiredById),
                });
            } catch (error) {
                console.error('[DocumentsManager] Failed pruning deleted template from post-submit forms:', error);
                showError('Template deleted, but the post-submission forms list could not be updated. Please press "Save forms".');
            }
        }
    };

    const handleEditTemplate = (template) => {
        setEditRequestId(null);
        setEditTemplateId(template.id);
        setCreatorInitialMode('template');
        setViewMode('create');
    };

    /**
     * Copy a template. Deliberately gated on `isTemplateDuplicable`: a template
     * without its stored PDF, or carrying a field type the editor does not
     * know, would produce a copy that can never be sent or edited. The copy
     * REUSES the original `storagePath` (the same immutable PDF) and never
     * inherits the post-application configuration.
     */
    const handleDuplicateTemplate = async (template) => {
        if (!isTemplateDuplicable(template)) {
            showError('This template cannot be duplicated safely. Open it and re-save it first.');
            return;
        }
        setDuplicatingTemplateId(template.id);
        try {
            await addDoc(collection(db, 'companies', currentCompanyProfile.id, 'templates'), {
                companyId: currentCompanyProfile.id,
                title: `${String(template.title || 'Untitled template').trim()} (copy)`,
                fields: template.fields,
                storagePath: template.storagePath,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: auth.currentUser?.uid || null,
            });
            showSuccess('Template duplicated.');
        } catch (error) {
            console.error('[DocumentsManager] Failed duplicating template:', error);
            showError('Could not duplicate this template. Please try again.');
        } finally {
            setDuplicatingTemplateId(null);
        }
    };

    /**
     * "Configure" is post-application usage — the only per-template
     * configuration this product has — so it opens the After-application forms view
     * rather than a second place to set the same thing.
     */
    const handleConfigureTemplate = () => setActiveTab('forms');

    /**
     * New Document. The chosen mode is passed to EnvelopeCreator as
     * `initialMode` and is FIXED there — the creator no longer offers a toggle
     * that could silently change the outcome.
     */
    const handleNewDocumentChoice = (choice) => {
        setShowNewDocumentDialog(false);
        if (choice === 'template-send') {
            setActiveTab('templates');
            return;
        }
        setEditRequestId(null);
        setEditTemplateId(null);
        setCreatorInitialMode(choice === 'create-template' ? 'template' : 'request');
        setViewMode('create');
    };

    if (!currentCompanyProfile) { navigate('/company/dashboard'); return null; }

    // BELOW every hook on purpose: returning before any of them changes the hook
    // count when a profile arrives with E-Docs off after the first paint, and
    // React throws ("Rendered fewer hooks than expected") instead of showing the
    // lock. The views test flips the flag on a mounted screen.
    if (!isFeatureOn(currentCompanyProfile, 'eDocs')) {
        return <FeatureLockedModal featureName="E-Docs" onClose={() => navigate('/company/dashboard')} />;
    }

    if (viewMode === 'create') {
        return (
            <Suspense fallback={<GlobalLoadingState />}>
                <EnvelopeCreator
                    companyId={currentCompanyProfile.id}
                    companyName={currentCompanyProfile.companyName || currentCompanyProfile.name || ''}
                    initialMode={creatorInitialMode}
                    editRequestId={editRequestId}
                    editTemplateId={editTemplateId}
                    onClose={() => {
                        setViewMode('view');
                        setEditRequestId(null);
                        setEditTemplateId(null);
                    }}
                />
            </Suspense>
        );
    }

    return (
        <div className="min-h-screen bg-ds-canvas">
            <PageContainer width="standard">
                <Stack gap="lg">
                    <Stack gap="sm">
                        {/* -ml-ds-3 cancels the sm button's own ds-space-3 inline
                            padding so the visible arrow/label sits flush with the
                            E-Docs heading below, while the padded hit area and
                            focus ring stay full size. */}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-ds-3 self-start"
                            onClick={() => navigate('/company/dashboard')}
                        >
                            <Icon icon={ArrowLeft} /> Back to Dashboard
                        </Button>
                        {/* One action: the tabs below are the way to the templates
                            and the sent documents. Below the design system's mobile
                            breakpoint the header stacks it under the title. */}
                        <PageHeader
                            title="E-Docs"
                            count={showSentCount ? sentCount : undefined}
                            countLabel={sentCount === 1 ? 'sent document' : 'sent documents'}
                            description="Create, send, track and manage documents requiring completion or signature."
                            actions={
                                <Button variant="primary" onClick={() => setShowNewDocumentDialog(true)}>
                                    <Icon icon={Plus} size="xl" /> New Document
                                </Button>
                            }
                        />
                    </Stack>

                    <TabList
                        ariaLabel="Documents workspace views"
                        idBase={tabsIdBase}
                        tabs={DOCUMENT_TABS}
                        activeTab={activeTab}
                        onChange={setActiveTab}
                        className="rounded-t-ds-xl bg-ds-surface px-ds-2"
                    />

                    <TabPanel
                        idBase={tabsIdBase}
                        tabId={activeTab}
                        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                    >
                        {activeTab === 'overview' && (
                            <DocumentsOverview
                                documents={signingRequests}
                                isLoading={signingRequestsLoading}
                                loadError={signingRequestsError}
                                onRetry={retrySigningRequests}
                                summary={summary}
                                attention={attention}
                                countsError={workspace.countsError}
                                onRetryCounts={workspace.retryCounts}
                                templates={templates}
                                templatesLoading={templatesLoading}
                                onViewAwaiting={() => viewSent({ status: 'sent' })}
                                onViewCompleted={() => viewSent({ status: 'signed' })}
                                onViewNeedsAttention={() => viewSent({ needsAttention: true })}
                                onViewTemplates={() => setActiveTab('templates')}
                                onOpenDocument={overviewDocumentActions.openDetails}
                            />
                        )}

                        {activeTab === 'sent' && (
                            <SentDocumentsPanel
                                companyId={currentCompanyProfile.id}
                                companyName={currentCompanyProfile.companyName || currentCompanyProfile.name || ''}
                                documents={signingRequests}
                                isLoading={signingRequestsLoading}
                                loadError={signingRequestsError}
                                onRetry={retrySigningRequests}
                                list={sentList}
                                attention={attention}
                                onCorrect={handleCorrect}
                                filters={sentFilters}
                                setFilters={setSentFilters}
                            />
                        )}

                        {activeTab === 'templates' && (
                            <TemplateLibraryPanel
                                templates={templates}
                                templatesLoading={templatesLoading}
                                postSubmitTemplateIds={postSubmitTemplateIds}
                                search={templateSearch}
                                setSearch={setTemplateSearch}
                                sort={templateSort}
                                setSort={setTemplateSort}
                                onSend={sendFlow.handleUseTemplate}
                                onEdit={handleEditTemplate}
                                onDuplicate={handleDuplicateTemplate}
                                onConfigure={handleConfigureTemplate}
                                onDelete={isCompanyAdmin ? requestDeleteTemplate : undefined}
                                onCreate={() => handleNewDocumentChoice('create-template')}
                                duplicatingTemplateId={duplicatingTemplateId}
                            />
                        )}

                        {activeTab === 'forms' && (
                            <ApplicationFormsPanel
                                templates={templates}
                                templatesLoading={templatesLoading}
                                forms={forms}
                            />
                        )}
                    </TabPanel>
                </Stack>
            </PageContainer>

            <SentDocumentDialogs actions={overviewDocumentActions} />

            {showNewDocumentDialog && (
                <NewDocumentDialog
                    templateCount={templates.length}
                    onClose={() => setShowNewDocumentDialog(false)}
                    onChoose={handleNewDocumentChoice}
                />
            )}

            {/* Guided three-step send. Every write, callable, message and
                navigation inside `executeTemplateSend` is unchanged. */}
            {sendFlow.showDriverPicker && (
                <SendTemplateWizard
                    flow={sendFlow}
                    // Closing mid-send is blocked so an in-flight write cannot be
                    // hidden behind a dismissed dialog.
                    onClose={() => { if (!sendFlow.sending) sendFlow.setShowDriverPicker(false); }}
                />
            )}

            {/*
              Replaces `window.confirm("Delete template?")`, which never said which
              template. When the template is also wired into the post-application
              flow, the dialog says so — that second effect was previously invisible
              until it silently happened.
            */}
            <ConfirmDialog
                isOpen={!!pendingTemplateDelete}
                tone="danger"
                title={`Delete "${pendingTemplateDelete?.title ?? ''}"?`}
                description={pendingTemplateDelete?.isPostSubmit
                    ? 'This template is currently sent to applicants after they apply. Deleting it also removes it from the after-application forms, so applicants will stop receiving it. This cannot be undone.'
                    : 'This template will be permanently deleted. This cannot be undone.'}
                confirmLabel="Delete template"
                loading={deletingTemplate}
                onConfirm={confirmDeleteTemplate}
                onCancel={() => setPendingTemplateDelete(null)}
            />
        </div>
    );
}
