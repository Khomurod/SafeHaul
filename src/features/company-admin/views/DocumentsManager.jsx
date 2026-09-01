import React, { useState, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '@lib/firebase';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useData } from '@/context/DataContext';
import EnvelopeCreator from '@features/signing/EnvelopeCreator';
import { useSigningRequests } from '@features/signing/hooks/useSigningRequests';
import { GlobalLoadingState } from '@shared/components/feedback';
import { LayoutDashboard, Send, FileText, ClipboardList, ArrowLeft, Plus } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { SendTemplateWizard } from '../components/documents/SendTemplateWizard';
import { DocumentsOverview } from '../components/documents/DocumentsOverview';
import { SentDocumentsPanel } from '../components/documents/SentDocumentsPanel';
import { TemplateLibraryPanel } from '../components/documents/TemplateLibraryPanel';
import { ApplicationFormsPanel } from '../components/documents/ApplicationFormsPanel';
import { NewDocumentDialog } from '../components/documents/NewDocumentDialog';
import { DEFAULT_FILTERS, isTemplateDuplicable } from '../utils/documentsWorkspace';
import { useTemplateSendFlow } from '../hooks/useTemplateSendFlow';
import { usePostSubmitForms } from '../hooks/usePostSubmitForms';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { ConfirmDialog } from '@design-system/patterns';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, TabList, TabPanel } from '@/design-system/components';
import { Inline, PageContainer, PageHeader, Stack } from '@/design-system/layouts';

/**
 * The four Documents workspace views, in tab order.
 *
 * `overview` is the default: the old page opened straight into a tool (the
 * history table) with no sense of what needed doing.
 *
 * The design system has no approved Tabs primitive yet (tracked in the
 * roadmap), so this WAI-ARIA tab interface stays feature-owned.
 */
const DOCUMENT_TABS = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'sent', label: 'Sent Documents', icon: Send },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'forms', label: 'Application Forms', icon: ClipboardList },
];

export default function DocumentsManager() {
    const { currentCompanyProfile, loading } = useData();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();

    const [activeTab, setActiveTab] = useState('overview');
    const [viewMode, setViewMode] = useState('view');
    const [creatorInitialMode, setCreatorInitialMode] = useState('request');
    const [editRequestId, setEditRequestId] = useState(null);
    const [editTemplateId, setEditTemplateId] = useState(null);
    const [showNewDocumentDialog, setShowNewDocumentDialog] = useState(false);

    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [templateSearch, setTemplateSearch] = useState('');
    const [templateSort, setTemplateSort] = useState('updated');
    const [duplicatingTemplateId, setDuplicatingTemplateId] = useState(null);

    const [sentFilters, setSentFilters] = useState({ ...DEFAULT_FILTERS });


    // Replaces the blocking `window.confirm("Delete template?")`.
    const [pendingTemplateDelete, setPendingTemplateDelete] = useState(null);
    const [deletingTemplate, setDeletingTemplate] = useState(false);
    const isE2EEdocMock = isE2ETestMode && getE2EQueryParam('e2eEdoc', '') === 'mock';

    const tabsIdBase = `edocs-${useId().replace(/:/g, '')}`;

    // One live subscription for the whole workspace: Overview metrics and the
    // Sent Documents table read the same documents rather than opening two
    // listeners on companies/{id}/signing_requests.
    const {
        documents: signingRequests,
        isLoading: signingRequestsLoading,
        loadError: signingRequestsError,
        retry: retrySigningRequests,
    } = useSigningRequests(isE2EEdocMock ? null : currentCompanyProfile?.id);

    if (currentCompanyProfile?.features?.eDocs === false) {
        return <FeatureLockedModal featureName="E-Docs" onClose={() => navigate('/company/dashboard')} />;
    }

    // Fetch Templates
    useEffect(() => {
        if (!currentCompanyProfile?.id) return;
        if (isE2EEdocMock) {
            setTemplates([
                {
                    id: 'tpl_e2e_mock',
                    title: 'E2E Test Document',
                    storagePath: 'secure_documents/e2e/mock.pdf',
                    fields: [
                        { id: 'full_name', label: 'Full Name', type: 'text', required: true, defaultValue: '' },
                        { id: 'sig1', label: 'Signature', type: 'signature', required: true, defaultValue: '' },
                    ],
                },
            ]);
            setTemplatesLoading(false);
            return () => {};
        }
        const q = query(collection(db, 'companies', currentCompanyProfile.id, 'templates'), orderBy('updatedAt', 'desc'));
        return onSnapshot(q, (snap) => {
            setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setTemplatesLoading(false);
        }, (err) => {
            console.error('[DocumentsManager] templates snapshot', err);
            setTemplatesLoading(false);
        });
    }, [currentCompanyProfile?.id, isE2EEdocMock]);

    // The template-send flow (wizard state, driver picker, prefill,
    // executeTemplateSend) and the post-application forms configuration each
    // moved to a feature hook. Both are called here, in this component, so
    // every piece of state keeps exactly the lifetime it had when it was
    // declared inline.
    const {
        showDriverPicker,
        setShowDriverPicker,
        selectedTemplate,
        drivers,
        searchQuery,
        setSearchQuery,
        sending,
        manualName,
        setManualName,
        manualEmail,
        setManualEmail,
        manualPhone,
        setManualPhone,
        deliveryMethod,
        setDeliveryMethod,
        prefillValues,
        setPrefillValues,
        prefillValuesByGroupKey,
        setPrefillValuesByGroupKey,
        editablePrefillPartition,
        handleUseTemplate,
        handleQuickSelect,
        executeTemplateSend,
    } = useTemplateSendFlow({ currentCompanyProfile, isE2EEdocMock, navigate, setActiveTab, showSuccess, showError });

    const {
        postSubmitTemplateIds,
        setPostSubmitTemplateIds,
        postSubmitRequiredById,
        savingPostSubmitTemplates,
        buildPostSubmitConfig,
        isTemplateEnabledPostSubmit,
        togglePostSubmitTemplate,
        movePostSubmitTemplate,
        togglePostSubmitRequired,
        handleSavePostSubmitTemplates,
    } = usePostSubmitForms({ currentCompanyProfile, templates, showSuccess, showError });

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

    const confirmDeleteTemplate = async () => {
        if (!pendingTemplateDelete) return;
        setDeletingTemplate(true);
        try {
            await handleDeleteTemplate(pendingTemplateDelete.id);
            setPendingTemplateDelete(null);
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
     * configuration this product has — so it opens the Application Forms view
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

    if (loading) return <GlobalLoadingState />;
    if (!currentCompanyProfile) { navigate('/company/dashboard'); return null; }

    // PHASE 4: Handle "Correct" action from EnvelopeHistory
    const handleCorrect = (docItem) => {
        setEditRequestId(docItem.id);
        setEditTemplateId(null);
        setCreatorInitialMode('request');
        setViewMode('create');
    };

    if (viewMode === 'create') {
        return (
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
        );
    }

    const filteredDrivers = drivers.filter(d =>
        `${d.firstName} ${d.lastName} ${d.email}`.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-ds-canvas">
            <PageContainer width="standard">
                <Stack gap="lg">
                    <Stack gap="sm">
                        {/* -ml-ds-3 cancels the sm button's own ds-space-3 inline
                            padding so the visible arrow/label sits flush with the
                            Documents heading below, while the padded hit area and
                            focus ring stay full size. */}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-ds-3 self-start"
                            onClick={() => navigate('/company/dashboard')}
                        >
                            <ArrowLeft size={16} aria-hidden="true" /> Back to Dashboard
                        </Button>
                        {/* The header is allowed to wrap so the two actions drop onto
                            their own line rather than overflowing at narrow widths;
                            below the design system's mobile breakpoint it already
                            stacks the actions under the title. */}
                        <PageHeader
                            className="flex-wrap"
                            title="Documents"
                            description="Create, send, track and manage documents requiring completion or signature."
                            actions={
                                <Inline gap="sm">
                                    <Button onClick={() => setActiveTab('templates')}>
                                        <FileText size={18} aria-hidden="true" /> Manage Templates
                                    </Button>
                                    <Button variant="primary" onClick={() => setShowNewDocumentDialog(true)}>
                                        <Plus size={20} aria-hidden="true" /> New Document
                                    </Button>
                                </Inline>
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
                                templates={templates}
                                templatesLoading={templatesLoading}
                                onViewSentDocuments={() => {
                                    setSentFilters({ ...DEFAULT_FILTERS });
                                    setActiveTab('sent');
                                }}
                                onViewNeedsAttention={() => {
                                    setSentFilters({ ...DEFAULT_FILTERS, needsAttention: true });
                                    setActiveTab('sent');
                                }}
                                onViewTemplates={() => setActiveTab('templates')}
                            />
                        )}

                        {activeTab === 'sent' && (
                            <SentDocumentsPanel
                                companyId={currentCompanyProfile.id}
                                documents={signingRequests}
                                isLoading={signingRequestsLoading}
                                loadError={signingRequestsError}
                                onRetry={retrySigningRequests}
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
                                onSend={handleUseTemplate}
                                onEdit={handleEditTemplate}
                                onDuplicate={handleDuplicateTemplate}
                                onConfigure={handleConfigureTemplate}
                                onDelete={requestDeleteTemplate}
                                duplicatingTemplateId={duplicatingTemplateId}
                            />
                        )}

                        {activeTab === 'forms' && (
                            <ApplicationFormsPanel
                                templates={templates}
                                templatesLoading={templatesLoading}
                                postSubmitTemplateIds={postSubmitTemplateIds}
                                postSubmitRequiredById={postSubmitRequiredById}
                                togglePostSubmitRequired={togglePostSubmitRequired}
                                savingPostSubmitTemplates={savingPostSubmitTemplates}
                                handleSavePostSubmitTemplates={handleSavePostSubmitTemplates}
                                movePostSubmitTemplate={movePostSubmitTemplate}
                                isTemplateEnabledPostSubmit={isTemplateEnabledPostSubmit}
                                togglePostSubmitTemplate={togglePostSubmitTemplate}
                            />
                        )}
                    </TabPanel>
                </Stack>
            </PageContainer>

            {showNewDocumentDialog && (
                <NewDocumentDialog
                    templateCount={templates.length}
                    onClose={() => setShowNewDocumentDialog(false)}
                    onChoose={handleNewDocumentChoice}
                />
            )}

            {/* Guided three-step send. Every write, callable, message and
                navigation inside `executeTemplateSend` is unchanged. */}
            {showDriverPicker && (
                <SendTemplateWizard
                    selectedTemplate={selectedTemplate}
                    // Closing mid-send is blocked so an in-flight write cannot be
                    // hidden behind a dismissed dialog.
                    onClose={() => { if (!sending) setShowDriverPicker(false); }}
                    manualName={manualName}
                    setManualName={setManualName}
                    manualEmail={manualEmail}
                    setManualEmail={setManualEmail}
                    manualPhone={manualPhone}
                    setManualPhone={setManualPhone}
                    deliveryMethod={deliveryMethod}
                    setDeliveryMethod={setDeliveryMethod}
                    editablePrefillPartition={editablePrefillPartition}
                    prefillValues={prefillValues}
                    setPrefillValues={setPrefillValues}
                    prefillValuesByGroupKey={prefillValuesByGroupKey}
                    setPrefillValuesByGroupKey={setPrefillValuesByGroupKey}
                    sending={sending}
                    executeTemplateSend={executeTemplateSend}
                    filteredDrivers={filteredDrivers}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    handleQuickSelect={handleQuickSelect}
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
                    ? 'This template is currently sent to applicants after they apply. Deleting it also removes it from the post-application forms, so applicants will stop receiving it. This cannot be undone.'
                    : 'This template will be permanently deleted. This cannot be undone.'}
                confirmLabel="Delete template"
                loading={deletingTemplate}
                onConfirm={confirmDeleteTemplate}
                onCancel={() => setPendingTemplateDelete(null)}
            />
        </div>
    );
}
