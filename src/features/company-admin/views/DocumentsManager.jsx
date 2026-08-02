import React, { useState, useEffect, useMemo, useId, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '@lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc, updateDoc, getDocs, addDoc, Timestamp, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useData } from '@/context/DataContext';
import EnvelopeCreator from '@features/signing/EnvelopeCreator';
import { useSigningRequests } from '@features/signing/hooks/useSigningRequests';
import {
    buildPrefillContext,
    buildEditablePrefillGroups,
    buildPrefillOverridesForSend,
    initialGroupedPrefillState,
    initialPlainPrefillState,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { GlobalLoadingState } from '@shared/components/feedback';
import { LayoutDashboard, Send, FileText, ClipboardList, ArrowLeft, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@shared/components/feedback';
import { SendTemplateWizard } from '../components/documents/SendTemplateWizard';
import { DocumentsOverview } from '../components/documents/DocumentsOverview';
import { SentDocumentsPanel } from '../components/documents/SentDocumentsPanel';
import { TemplateLibraryPanel } from '../components/documents/TemplateLibraryPanel';
import { ApplicationFormsPanel } from '../components/documents/ApplicationFormsPanel';
import { NewDocumentDialog } from '../components/documents/NewDocumentDialog';
import { DEFAULT_FILTERS, isTemplateDuplicable } from '../utils/documentsWorkspace';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button } from '@/design-system/components';
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

const TAB_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

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

    // Send Flow State
    const [showDriverPicker, setShowDriverPicker] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [drivers, setDrivers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sending, setSending] = useState(false);

    // FEAT-2/3/4: Manual entry + delivery method state
    const [manualName, setManualName] = useState('');
    const [manualEmail, setManualEmail] = useState('');
    const [manualPhone, setManualPhone] = useState('');
    const [deliveryMethod, setDeliveryMethod] = useState('email'); // 'email' | 'sms' | 'both' | 'copy'
    // Template pre-fill: grouped keys share one control; plain text fields stay per-slot
    const [prefillValues, setPrefillValues] = useState({});
    const [prefillValuesByGroupKey, setPrefillValuesByGroupKey] = useState({});
    const [postSubmitTemplateIds, setPostSubmitTemplateIds] = useState([]);
    // templateId -> boolean. Missing key = required (backward-compatible default:
    // post-application forms are required unless explicitly marked optional).
    const [postSubmitRequiredById, setPostSubmitRequiredById] = useState({});
    const [savingPostSubmitTemplates, setSavingPostSubmitTemplates] = useState(false);
    // Replaces the blocking `window.confirm("Delete template?")`.
    const [pendingTemplateDelete, setPendingTemplateDelete] = useState(null);
    const [deletingTemplate, setDeletingTemplate] = useState(false);
    const isE2EEdocMock = isE2ETestMode && getE2EQueryParam('e2eEdoc', '') === 'mock';

    const rawId = useId().replace(/:/g, '');
    const tabPanelId = `edocs-tabpanel-${rawId}`;
    const tabIdFor = (value) => `edocs-tab-${value}-${rawId}`;
    const tabRefs = useRef({});

    // One live subscription for the whole workspace: Overview metrics and the
    // Sent Documents table read the same documents rather than opening two
    // listeners on companies/{id}/signing_requests.
    const {
        documents: signingRequests,
        isLoading: signingRequestsLoading,
        loadError: signingRequestsError,
        retry: retrySigningRequests,
    } = useSigningRequests(isE2EEdocMock ? null : currentCompanyProfile?.id);

    // Automatic activation: arrow/Home/End both select and move focus, so the
    // panel always matches the focused tab.
    const handleTabKeyDown = (event) => {
        if (!TAB_KEYS.has(event.key)) return;
        event.preventDefault();
        const currentIndex = DOCUMENT_TABS.findIndex((tab) => tab.id === activeTab);
        const lastIndex = DOCUMENT_TABS.length - 1;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + DOCUMENT_TABS.length) % DOCUMENT_TABS.length;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % DOCUMENT_TABS.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = lastIndex;
        const nextTab = DOCUMENT_TABS[nextIndex];
        setActiveTab(nextTab.id);
        tabRefs.current[nextTab.id]?.focus();
    };

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

    useEffect(() => {
        const raw = Array.isArray(currentCompanyProfile?.postApplicationTemplates)
            ? currentCompanyProfile.postApplicationTemplates
            : [];
        const ids = [];
        const requiredById = {};
        for (const item of raw) {
            let templateId = '';
            let required = true;
            if (typeof item === 'string') {
                templateId = item.trim();
            } else if (item && typeof item === 'object') {
                templateId = String(item.templateId || item.id || '').trim();
                required = item.required !== false;
            }
            if (!templateId) continue;
            ids.push(templateId);
            requiredById[templateId] = required;
        }
        setPostSubmitTemplateIds(ids);
        setPostSubmitRequiredById(requiredById);
    }, [currentCompanyProfile?.postApplicationTemplates]);

    useEffect(() => {
        if (!templates.length) return;
        setPostSubmitTemplateIds((prev) => prev.filter((id) => templates.some((t) => t.id === id)));
    }, [templates]);

    // Fetch Drivers for Picker
    useEffect(() => {
        if (showDriverPicker && currentCompanyProfile?.id) {
            if (isE2EEdocMock) {
                setDrivers([
                    {
                        id: 'lead_e2e_1',
                        firstName: 'E2E',
                        lastName: 'Driver',
                        email: 'driver@safehaul.local',
                        phone: '5551112222',
                    },
                ]);
                return;
            }
            const fetchDrivers = async () => {
                const q = query(collection(db, 'companies', currentCompanyProfile.id, 'leads'));
                const snap = await getDocs(q);
                setDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            };
            fetchDrivers();
        }
    }, [showDriverPicker, currentCompanyProfile?.id, isE2EEdocMock]);

    const handleUseTemplate = (template) => {
        setSelectedTemplate(template);
        setManualName('');
        setManualEmail('');
        setManualPhone('');
        setDeliveryMethod('email');
        const { groups, plainFields } = buildEditablePrefillGroups(template.fields || []);
        setPrefillValuesByGroupKey(initialGroupedPrefillState(groups));
        setPrefillValues(initialPlainPrefillState(plainFields));
        setShowDriverPicker(true);
    };

    const editablePrefillPartition = useMemo(() => {
        if (!selectedTemplate?.fields) return { groups: [], plainFields: [] };
        return buildEditablePrefillGroups(selectedTemplate.fields);
    }, [selectedTemplate]);

    // FEAT-2: Quick-select a driver to auto-fill manual entry fields
    const handleQuickSelect = (driver) => {
        setManualName(`${driver.firstName || ''} ${driver.lastName || ''}`.trim());
        setManualEmail(driver.email || '');
        setManualPhone(driver.phone || driver.phoneNumber || '');
    };

    const executeTemplateSend = async () => {
        // Guard against a second submission while the first is still in flight.
        if (sending) return;
        // FEAT-2: Validate based on delivery method
        if (!manualName.trim()) {
            showError('Please enter a recipient name.');
            return;
        }
        if ((deliveryMethod === 'email' || deliveryMethod === 'both') && !manualEmail.trim()) {
            showError('Email address is required for email delivery.');
            return;
        }
        if ((deliveryMethod === 'sms' || deliveryMethod === 'both') && !manualPhone.trim()) {
            showError('Phone number is required for SMS delivery.');
            return;
        }

        setSending(true);
        try {
            if (isE2EEdocMock) {
                setShowDriverPicker(false);
                showSuccess('Document created! Email delivery in progress...');
                navigate(`/sign/${currentCompanyProfile.id}/e2e-edoc-send-req?token=e2e-token&e2eSign=mock`);
                return;
            }

            const accessToken = uuidv4();

            const resolvedRecipientName = manualName.trim();
            const resolvedRecipientEmail = manualEmail.trim();
            const resolvedRecipientPhone = manualPhone.trim();

            const prefillContext = buildPrefillContext({
                recipientName: resolvedRecipientName,
                recipientEmail: resolvedRecipientEmail,
                recipientPhone: resolvedRecipientPhone,
                companyName: currentCompanyProfile?.companyName || currentCompanyProfile?.name || '',
            });

            const overridesByFieldId = buildPrefillOverridesForSend(selectedTemplate.fields || [], {
                prefillValues,
                prefillValuesByGroupKey,
            });

            const { fields: autoFilledFields, missingLockedRequired } = resolveFieldsForSend(
                selectedTemplate.fields || [],
                prefillContext,
                { overridesByFieldId },
            );

            if (missingLockedRequired.length > 0) {
                showError(`Cannot send this template yet. Missing locked prefill data: ${missingLockedRequired.join(', ')}.`);
                return;
            }

            const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';

            // FEAT-3/4: Set delivery flags based on method
            const sendEmail = deliveryMethod === 'email' || deliveryMethod === 'both';
            const sendSms = deliveryMethod === 'sms' || deliveryMethod === 'both';

            const docData = {
                companyId: currentCompanyProfile.id,
                recipientEmail: resolvedRecipientEmail || null,
                recipientName: resolvedRecipientName,
                recipientPhone: resolvedRecipientPhone || null,
                title: selectedTemplate.title,
                status: 'sent',
                createdAt: serverTimestamp(),
                expiresAt,
                storagePath: selectedTemplate.storagePath,
                senderId: auth.currentUser.uid,
                senderName,
                sendEmail,
                sendSms: false, // SMS is sent directly by frontend callable; do not trigger async function.
                deliveryMethod, // Record what user chose for audit trail
                appBaseUrl: window.location.origin, // DOMAIN FIX: Store sender's domain for backend link generation
                fields: autoFilledFields,
                templateId: selectedTemplate.id,
                fieldValues: autoFilledFields.reduce((acc, f) => {
                    if (f.defaultValue) acc[f.id] = f.defaultValue;
                    return acc;
                }, {})
            };

            // BUG-2 FIX: Use batch write to store accessToken in secrets subcollection
            const signingRef = doc(collection(db, 'companies', currentCompanyProfile.id, 'signing_requests'));
            const batch = writeBatch(db);
            batch.set(signingRef, docData);
            batch.set(doc(signingRef, 'secrets', 'token'), { accessToken });
            await batch.commit();

            // FEAT-4: Copy Link mode - copy URL to clipboard instead of sending
            if (deliveryMethod === 'copy') {
                const baseUrl = window.location.origin;
                const link = `${baseUrl}/sign/${currentCompanyProfile.id}/${signingRef.id}?token=${accessToken}`;
                await navigator.clipboard.writeText(link);
                showSuccess('Signing link copied to clipboard!');
            } else {
                // Send SMS directly via callable (not relying on async trigger)
                if (sendSms && resolvedRecipientPhone) {
                    try {
                        const baseUrl = window.location.origin;
                        const signingLink = `${baseUrl}/sign/${currentCompanyProfile.id}/${signingRef.id}?token=${accessToken}`;
                        const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';
                        const smsMessage = `${senderName} sent you "${selectedTemplate.title}" to sign: ${signingLink}`;

                        const functions = getFunctions();
                        const sendSMSCallable = httpsCallable(functions, 'sendSMS');
                        await sendSMSCallable({
                            companyId: currentCompanyProfile.id,
                            recipientPhone: resolvedRecipientPhone,
                            messageBody: smsMessage
                        });
                        showSuccess('Document created & SMS sent!');
                    } catch (smsErr) {
                        console.error('SMS send failed:', smsErr);
                        showError(`Document created but SMS failed: ${smsErr.message}`);
                    }
                } else {
                    const methodLabel = deliveryMethod === 'both' ? 'Email + SMS' : 'Email';
                    showSuccess(`Document created! ${methodLabel} delivery in progress...`);
                }
            }

            setShowDriverPicker(false);
            setActiveTab('sent');
        } catch (err) {
            console.error(err);
            showError("Failed to send template.");
        } finally {
            setSending(false);
        }
    };

    const buildPostSubmitConfig = (ids, requiredById) => ids
        .map((templateId) => {
            const template = templates.find((item) => item.id === templateId);
            if (!template) return null;
            return {
                templateId,
                title: String(template.title || 'Complete Form').trim(),
                enabled: true,
                required: requiredById[templateId] !== false,
            };
        })
        .filter(Boolean);

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

    const isTemplateEnabledPostSubmit = (templateId) => postSubmitTemplateIds.includes(templateId);

    const togglePostSubmitTemplate = (templateId) => {
        setPostSubmitTemplateIds((prev) => {
            if (prev.includes(templateId)) return prev.filter((id) => id !== templateId);
            return [...prev, templateId];
        });
    };

    const movePostSubmitTemplate = (templateId, direction) => {
        setPostSubmitTemplateIds((prev) => {
            const index = prev.indexOf(templateId);
            if (index < 0) return prev;
            const target = direction === 'up' ? index - 1 : index + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const togglePostSubmitRequired = (templateId) => {
        setPostSubmitRequiredById((prev) => ({
            ...prev,
            [templateId]: prev[templateId] === false,
        }));
    };

    const handleSavePostSubmitTemplates = async () => {
        try {
            setSavingPostSubmitTemplates(true);
            const mapped = buildPostSubmitConfig(postSubmitTemplateIds, postSubmitRequiredById);

            await updateDoc(doc(db, 'companies', currentCompanyProfile.id), {
                postApplicationTemplates: mapped,
            });
            showSuccess('Post-submission forms updated.');
        } catch (error) {
            console.error('[DocumentsManager] Failed saving post-submission forms:', error);
            showError('Could not save post-submission forms. Please try again.');
        } finally {
            setSavingPostSubmitTemplates(false);
        }
    };

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

                    <div
                        role="tablist"
                        aria-label="Documents workspace views"
                        onKeyDown={handleTabKeyDown}
                        className="flex flex-wrap rounded-t-ds-xl border-b border-ds-border bg-ds-surface px-ds-2"
                    >
                        {DOCUMENT_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isSelected = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    ref={(node) => { tabRefs.current[tab.id] = node; }}
                                    type="button"
                                    role="tab"
                                    id={tabIdFor(tab.id)}
                                    aria-selected={isSelected}
                                    aria-controls={tabPanelId}
                                    // Roving tabIndex: only the selected tab is in the tab order.
                                    tabIndex={isSelected ? 0 : -1}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex min-h-11 items-center gap-ds-2 border-b-2 px-ds-5 py-ds-4 text-ds-sm font-bold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                        isSelected
                                            ? 'border-ds-action-primary text-ds-action-primary'
                                            : 'border-transparent text-ds-content-secondary hover:text-ds-content'
                                    }`}
                                >
                                    <Icon size={16} aria-hidden="true" />
                                    {tab.label}
                                    {/* Selection is carried by aria-selected plus this text, never
                                        by the underline colour alone. */}
                                    {isSelected && <span className="ds-visually-hidden"> (selected)</span>}
                                </button>
                            );
                        })}
                    </div>

                    <div
                        id={tabPanelId}
                        role="tabpanel"
                        aria-labelledby={tabIdFor(activeTab)}
                        tabIndex={-1}
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
                    </div>
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
