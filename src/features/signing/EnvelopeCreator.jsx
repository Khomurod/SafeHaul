import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@shared/components/feedback';
// The Firebase persistence paths — the "Correct"/"Edit Template" hydration
// and the save/send action — live in utils/envelopePersistence.js since the
// 2026-09-01 source-size split. State stays here; the module gets setters.
import {
    hydrateEnvelopeForEdit,
    saveEnvelope,
} from '@features/signing/utils/envelopePersistence';
import {
    PDF_VIEWPORT_WIDTH_DEFAULT,
    adjustPdfViewportWidth,
    clampPdfViewportWidth,
} from '@features/signing/utils/envelopePdfZoom';
import { ConfirmDialog } from '@design-system/patterns';
import { getFieldIcon } from './components/envelope-creator/fieldDefinitions';
import { FieldPropertiesPanel } from './components/envelope-creator/FieldPropertiesPanel';
import { EditorInspector } from './components/envelope-creator/EditorInspector';
import { EnvelopeSidebar } from './components/envelope-creator/EnvelopeSidebar';
import { PdfFieldWorkbench } from './components/envelope-creator/PdfFieldWorkbench';
import { AiScanOptionsDialog } from './components/envelope-creator/AiScanOptionsDialog';
import { AiSuggestionReviewPanel } from './components/envelope-creator/AiSuggestionReviewPanel';
import { useAiFieldAssistant } from './hooks/useAiFieldAssistant';
import {
    applySuggestionsToFields,
    selectHighConfidence,
} from '@features/signing/utils/aiFieldSuggestions';
import { EditorTopBar } from './components/envelope-creator/EditorTopBar';
import { EditorCanvasToolbar } from './components/envelope-creator/EditorCanvasToolbar';
import { PageThumbnailRail } from './components/envelope-creator/PageThumbnailRail';
import { SignerPreviewDialog } from './components/envelope-creator/SignerPreviewDialog';
import {
    canRedo as historyCanRedo,
    canUndo as historyCanUndo,
} from '@features/signing/utils/editorHistory';
import {
    INSPECTOR_TABS,
    SAVE_STATES,
    hasUnsavedWork,
    resolveEditorMode,
} from '@features/signing/utils/editorSaveState';
import {
    allPages,
    countFieldsByPage,
    toggleSelection,
} from '@features/signing/utils/fieldGeometry';
import { FieldToolsPanel } from './components/envelope-creator/FieldToolsPanel';
import { EditorBottomSheet } from './components/envelope-creator/EditorBottomSheet';
import { EditorMobileBar } from './components/envelope-creator/EditorMobileBar';
import { useCompactEditor } from './hooks/useCompactEditor';
// The editing spine split out on 2026-09-01 (SG-1b): history/save state and
// the single write path, the field-mutation handlers, and the keyboard
// clipboard — see each hook's header for what moved.
import { useEditorHistoryState } from './hooks/useEditorHistoryState';
import { useEnvelopeFieldEditing } from './hooks/useEnvelopeFieldEditing';
import { useFieldClipboardShortcuts } from './hooks/useFieldClipboardShortcuts';

/**
 * EnvelopeCreator — one-off signing request + template editor.
 *
 * Split for readability (behavior unchanged):
 *  - ./components/envelope-creator/fieldDefinitions.jsx       — field palette definitions + icons
 *  - ./components/envelope-creator/ResizableDraggableField.jsx — field overlay editor
 *  - ./components/envelope-creator/FieldPropertiesPanel.jsx    — right sidebar
 *  - ./components/envelope-creator/EnvelopeSidebar.jsx         — recipient/delivery + field palette
 *  - ./components/envelope-creator/PdfFieldWorkbench.jsx       — PDF canvas/viewer with overlays
 * State, hydration, and the save/send action stay here.
 */

// Upload ceiling. MUST stay <= the storage-rule limit (isValidFile in
// src/storage.rules), otherwise the client accepts files the server rejects.
const MAX_UPLOAD_MB = 20;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export default function EnvelopeCreator({
    companyId,
    onClose,
    initialMode = 'request',
    editRequestId = null,
    editTemplateId = null,
    companyName = '',
}) {
    const { showSuccess, showError } = useToast();
    const [file, setFile] = useState(null);
    const [numPages, setNumPages] = useState(null);
    const [loading, setLoading] = useState(false);
    const [hydrating, setHydrating] = useState(Boolean(editRequestId || editTemplateId));
    const [creatorMode, setCreatorMode] = useState(editTemplateId ? 'template' : initialMode); // 'request' or 'template'
    const [existingStoragePath, setExistingStoragePath] = useState('');

    /**
     * Selection.
     *
     * The array is the source of truth and its FIRST entry is the anchor: the
     * field the inspector edits and the one alignment and size-matching measure
     * against. `setSelectedFieldId(id)` replaces the selection,
     * `setSelectedFieldId(id, { additive: true })` toggles membership, and
     * `setSelectedFieldId(null)` clears it — so every existing caller keeps
     * working unchanged.
     */
    const [selectedFieldIds, setSelectedFieldIds] = useState([]);
    const selectedFieldId = selectedFieldIds[0] ?? null;

    const setSelectedFieldId = useCallback((id, options = {}) => {
        setSelectedFieldIds((previous) => toggleSelection(previous, id, options?.additive === true));
    }, []);

    // The placed-field array, the undo/redo stack and the save state — with
    // `commitFields`, the single write path — live in useEditorHistoryState
    // since the 2026-09-01 source-size split (SG-1b).
    const {
        fields,
        history,
        saveState,
        setSaveState,
        fieldsRef,
        commitFields,
        resetEditorHistory,
        handleUndo,
        handleRedo,
        handleUndoRef,
        handleRedoRef,
        commitFieldsRef,
        markSaved,
    } = useEditorHistoryState({ setSelectedFieldIds });

    // FEAT-1: Track the currently visible page for multi-page field placement
    const [activePage, setActivePage] = useState(1);
    const pageRefs = useRef({});

    // Recipient details only needed for 'request' mode
    const [recipientEmail, setRecipientEmail] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    // ADV-2 FIX: Delivery method selector for one-off sends
    const [deliveryMethod, setDeliveryMethod] = useState('email'); // 'email' | 'sms' | 'both' | 'copy'
    const [title, setTitle] = useState('');

    // --- AI Field Assistant -------------------------------------------------
    // Suggestions live entirely inside the assistant until the reviewer applies
    // them; nothing here can save a template or send a document.
    const [aiScanDialogOpen, setAiScanDialogOpen] = useState(false);
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [inspectorTab, setInspectorTab] = useState(INSPECTOR_TABS.PROPERTIES);
    // Compact editor: the desktop rails are replaced by a bottom toolbar and one
    // bottom sheet at a time, so the PDF keeps the screen.
    const isCompact = useCompactEditor();
    const [mobileSheet, setMobileSheet] = useState(null);
    const [selectedSuggestionId, setSelectedSuggestionId] = useState(null);
    // One-level undo for the last "apply". Holds the ids of the fields that
    // apply appended — not a whole snapshot — so undoing removes exactly those
    // and leaves any work done since the apply untouched.
    const [aiUndoFieldIds, setAiUndoFieldIds] = useState([]);

    // --- Editor shell -------------------------------------------------------
    const [previewOpen, setPreviewOpen] = useState(false);
    const [pendingClose, setPendingClose] = useState(false);
    const canvasRef = useRef(null);

    const [pageDimensions, setPageDimensions] = useState({});
    const [pdfViewportWidth, setPdfViewportWidth] = useState(PDF_VIEWPORT_WIDTH_DEFAULT);

    const pdfWorkbenchRef = useRef(null);
    const selectedFieldIdRef = useRef(null);
    const selectedFieldIdsRef = useRef([]);
    const fileRef = useRef(null);

    useEffect(() => {
        selectedFieldIdRef.current = selectedFieldId;
        selectedFieldIdsRef.current = selectedFieldIds;
    }, [selectedFieldId, selectedFieldIds]);

    useEffect(() => {
        fileRef.current = file;
    }, [file]);

    useEffect(() => {
        if (!file) {
            setPdfViewportWidth(PDF_VIEWPORT_WIDTH_DEFAULT);
        }
    }, [file]);

    useEffect(() => {
        if (hydrating) return undefined;
        const el = pdfWorkbenchRef.current;
        if (!el) return undefined;

        const onWheel = (e) => {
            if (!fileRef.current) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!el.contains(e.target)) return;
            e.preventDefault();
            setPdfViewportWidth((w) => adjustPdfViewportWidth(w, e.deltaY, e.deltaMode));
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [hydrating]);

    // Ctrl/Cmd undo/redo and field copy/paste live in
    // useFieldClipboardShortcuts since the 2026-09-01 source-size split
    // (SG-1b); the listener still registers once and reads through these refs.
    useFieldClipboardShortcuts({
        fieldsRef,
        selectedFieldIdRef,
        fileRef,
        commitFieldsRef,
        handleUndoRef,
        handleRedoRef,
        setSelectedFieldIds,
    });

    const aiAssistant = useAiFieldAssistant({
        companyId,
        file,
        numPages,
        activePage,
        fields,
    });

    const {
        startScan: startAiScan,
        suggestions: aiSuggestions,
        updateSuggestion: updateAiSuggestion,
        setSuggestionStatus: setAiSuggestionStatus,
        removeSuggestions: removeAiSuggestions,
        discardAll: discardAiSuggestions,
    } = aiAssistant;

    const openAiAssistant = useCallback(() => {
        setAiPanelOpen(true);
        setInspectorTab(INSPECTOR_TABS.AI);
        setAiScanDialogOpen(true);
    }, []);

    const handleAiScanStart = useCallback(
        ({ scope, selectedPages }) => {
            setAiScanDialogOpen(false);
            setAiPanelOpen(true);
            setInspectorTab(INSPECTOR_TABS.AI);
            setSelectedSuggestionId(null);
            startAiScan({ scope, selectedPages });
        },
        [startAiScan],
    );

    const toggleSuggestionAccepted = useCallback(
        (suggestionId) => {
            const current = aiSuggestions.find((item) => item.suggestionId === suggestionId);
            if (!current) return;
            setAiSuggestionStatus(suggestionId, current.status === 'accepted' ? 'pending' : 'accepted');
        },
        [aiSuggestions, setAiSuggestionStatus],
    );

    const rejectSuggestion = useCallback(
        (suggestionId) => {
            removeAiSuggestions([suggestionId]);
            setSelectedSuggestionId((prev) => (prev === suggestionId ? null : prev));
        },
        [removeAiSuggestions],
    );

    /**
     * The ONLY path from suggestion to real field. Appends; never deletes,
     * replaces or reorders an existing field, and never saves or sends.
     */
    const applySuggestions = useCallback(
        (toApply) => {
            if (!toApply.length) return;
            const { fields: nextFields, appended } = applySuggestionsToFields({
                fields: fieldsRef.current,
                suggestions: toApply,
                idFactory: () => uuidv4(),
            });
            // Remember WHICH fields this apply added, not a whole snapshot:
            // undoing must not throw away work done after the apply.
            setAiUndoFieldIds(appended.map((field) => field.id));
            commitFields(nextFields, { label: `Apply ${toApply.length} AI field(s)` });
            removeAiSuggestions(toApply.map((item) => item.suggestionId));
            setSelectedSuggestionId(null);
            showSuccess(`${toApply.length} field${toApply.length === 1 ? '' : 's'} placed. Review before saving.`);
        },
        [removeAiSuggestions, showSuccess, commitFields, fieldsRef],
    );

    const handleApplySelected = useCallback(() => {
        applySuggestions(aiSuggestions.filter((item) => item.status === 'accepted'));
    }, [aiSuggestions, applySuggestions]);

    const handleApplyHighConfidence = useCallback(() => {
        applySuggestions(selectHighConfidence(aiSuggestions));
    }, [aiSuggestions, applySuggestions]);

    /**
     * Undo the last apply by removing exactly the fields it added.
     *
     * Restoring a pre-apply snapshot instead would silently discard every field
     * the operator added, moved, renamed or deleted since — an undo that
     * destroys unrelated work is worse than no undo.
     */
    const handleAiUndo = useCallback(() => {
        if (aiUndoFieldIds.length === 0) return;
        const undoIds = new Set(aiUndoFieldIds);
        commitFields((prev) => prev.filter((field) => !undoIds.has(field.id)), { label: 'Undo AI placement' });
        setAiUndoFieldIds([]);
        setSelectedFieldIds((previous) => previous.filter((id) => !undoIds.has(id)));
        showSuccess('Last AI placement undone.');
    }, [aiUndoFieldIds, showSuccess, commitFields]);

    const handleAiDiscardAll = useCallback(() => {
        discardAiSuggestions();
        setSelectedSuggestionId(null);
    }, [discardAiSuggestions]);

    const closeAiPanel = useCallback(() => {
        setAiPanelOpen(false);
        setSelectedSuggestionId(null);
        setInspectorTab(INSPECTOR_TABS.PROPERTIES);
    }, []);

    const moveSuggestion = useCallback(
        (suggestionId, x, y) => updateAiSuggestion(suggestionId, { x, y }),
        [updateAiSuggestion],
    );

    const resizeSuggestion = useCallback(
        (suggestionId, width, height) => updateAiSuggestion(suggestionId, { width, height }),
        [updateAiSuggestion],
    );

    // Derive active field from selection
    const activeField = useMemo(() => {
        if (!selectedFieldId) return null;
        return fields.find(f => f.id === selectedFieldId) || null;
    }, [selectedFieldId, fields]);

    const isEditingRequest = Boolean(editRequestId);
    const isEditingTemplate = Boolean(editTemplateId);
    const editingEntityId = editRequestId || editTemplateId;
    const editingCollection = isEditingTemplate ? 'templates' : 'signing_requests';

    // PHASE 4: Hydrate from existing document for "Correct" / "Edit Template" flows
    useEffect(() => {
        if (!editingEntityId || !companyId) return;
        hydrateEnvelopeForEdit({
            companyId,
            editingCollection,
            editingEntityId,
            isEditingTemplate,
            showError,
            resetEditorHistory,
            setHydrating,
            setRecipientName,
            setRecipientEmail,
            setRecipientPhone,
            setTitle,
            setDeliveryMethod,
            setCreatorMode,
            setExistingStoragePath,
            setNumPages,
            setFile,
        });
    }, [editingEntityId, companyId, editingCollection, isEditingTemplate, showError, resetEditorHistory]);

    // FEAT-1: IntersectionObserver to track which page is visible
    useEffect(() => {
        if (!numPages) return;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const pageNum = parseInt(entry.target.dataset.pageNum);
                        if (pageNum) setActivePage(pageNum);
                    }
                });
            },
            { threshold: 0.5 }
        );
        Object.values(pageRefs.current).forEach((el) => {
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [numPages, file]);

    const handleTitleChange = useCallback((next) => {
        setTitle(next);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);

    /** Scroll a page into view; the IntersectionObserver then updates activePage. */
    const goToPage = useCallback((page) => {
        const target = pageRefs.current?.[page];
        if (target?.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setActivePage(page);
    }, []);

    /**
     * Fit Width / Fit Page.
     *
     * Both express themselves as a viewport WIDTH, because that is the single
     * dimension the workbench renders from — so fitting cannot desynchronise
     * the field overlays from the page.
     */
    const handleFitWidth = useCallback(() => {
        const available = canvasRef.current?.clientWidth;
        if (!available) return;
        // Leave the canvas gutter so the page is not flush against the rails.
        setPdfViewportWidth(clampPdfViewportWidth(available - 64));
    }, []);

    const handleFitPage = useCallback(() => {
        const availableHeight = canvasRef.current?.clientHeight;
        const availableWidth = canvasRef.current?.clientWidth;
        if (!availableHeight || !availableWidth) return;
        const dims = pageDimensions[activePage];
        const ratio = dims && dims.width > 0 ? dims.height / dims.width : 11 / 8.5;
        const widthThatFitsHeight = (availableHeight - 64) / ratio;
        setPdfViewportWidth(clampPdfViewportWidth(Math.min(availableWidth - 64, widthThatFitsHeight)));
    }, [pageDimensions, activePage]);

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        if (selected && selected.type === 'application/pdf') {
            // Keep this limit in lock-step with the storage rule (isValidFile in
            // storage.rules, currently < 20MB). If the client accepts a file the
            // rule rejects, the upload fails server-side and surfaces as an opaque
            // error — so the two limits MUST match.
            if (selected.size >= MAX_UPLOAD_BYTES) {
                showError(`File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`);
                return;
            }
            setFile(selected);
            setNumPages(null); // RACE FIX: Wipe stale page count before new document loads
            setTitle(selected.name.replace('.pdf', ''));
            // A different document invalidates every placement, so the history
            // starts again rather than letting undo reach fields that belonged
            // to the previous PDF.
            resetEditorHistory([], { markClean: false });
            setSelectedFieldId(null);
            setSaveState(SAVE_STATES.UNSAVED);
        } else {
            showError('Please upload a valid PDF file.');
        }
    };

    // Every field mutation — add/remove/move/resize/label/property plus the
    // align/match/duplicate/copy-to-pages bulk tools and the visual drag
    // guides — lives in useEnvelopeFieldEditing since the 2026-09-01
    // source-size split (SG-1b). All of it still routes through commitFields.
    const {
        dragGuides,
        addField,
        removeField,
        handleFieldDragMove,
        updateFieldPosition,
        updateFieldSize,
        updateFieldLabel,
        updateActiveField,
        handleAlignFields,
        handleMatchFieldSize,
        handleDuplicateSelection,
        handleCopyToPages,
    } = useEnvelopeFieldEditing({
        commitFields,
        fieldsRef,
        selectedFieldIdsRef,
        setSelectedFieldIds,
        file,
        activePage,
        selectedFieldId,
    });

    const onPageLoadSuccess = (page) => {
        setPageDimensions(prev => ({ ...prev, [page.pageNumber]: { width: page.width, height: page.height } }));
    };

    /** Only reachable from a completed write. Also a safe history reset point. */
    /**
     * Recipient and delivery edits are part of the document being built, so they
     * count as unsaved work — otherwise Back would close without asking and
     * throw them away.
     *
     * These wrap the raw setters rather than replacing them: hydration keeps
     * using the raw ones, because it only resets the history (and with it the
     * save state) when the loaded document actually has fields. Marking a
     * freshly opened document unsaved would be its own lie.
     */
    const editRecipientName = useCallback((value) => {
        setRecipientName(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);
    const editRecipientEmail = useCallback((value) => {
        setRecipientEmail(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);
    const editRecipientPhone = useCallback((value) => {
        setRecipientPhone(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);
    const editDeliveryMethod = useCallback((value) => {
        setDeliveryMethod(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);

    // One expression, so the caller awaits the module's own promise (the
    // `CA-9` wrapper shape). Not a useCallback before the split either.
    const handleSave = () => saveEnvelope({
        file,
        fields,
        creatorMode,
        isEditingTemplate,
        isEditingRequest,
        editRequestId,
        editTemplateId,
        existingStoragePath,
        recipientName,
        recipientEmail,
        recipientPhone,
        deliveryMethod,
        title,
        companyId,
        companyName,
        onClose,
        showError,
        showSuccess,
        setLoading,
        setSaveState,
        markSaved,
    });

    const getIcon = getFieldIcon;

    /**
     * The inspector is a permanent column on wide screens, so the canvas never
     * resizes under the pointer. Below that breakpoint it is a sheet, shown only
     * when it has something to say.
     */
    const inspectorOpen = Boolean(selectedFieldId) || aiPanelOpen;

    const dismissInspector = useCallback(() => {
        setSelectedFieldIds([]);
        setAiPanelOpen(false);
    }, []);

    const editorMode = resolveEditorMode({ creatorMode, isEditingTemplate, isEditingRequest });
    const fieldCountsByPage = useMemo(() => countFieldsByPage(fields), [fields]);
    const suggestionCountsByPage = useMemo(() => {
        const counts = {};
        for (const suggestion of aiSuggestions) {
            counts[suggestion.page] = (counts[suggestion.page] || 0) + 1;
        }
        return counts;
    }, [aiSuggestions]);
    const reviewPages = useMemo(
        () => [...new Set(aiAssistant.manualReview.map((entry) => entry.page).filter(Boolean))],
        [aiAssistant.manualReview],
    );

    /**
     * Leaving the editor.
     *
     * With unsaved work this asks first, through the shared accessible
     * confirmation rather than a blocking browser dialog. With nothing to lose
     * it closes straight away — a confirmation that always fires trains people
     * to dismiss it without reading.
     */
    const requestClose = useCallback(() => {
        if (hasUnsavedWork(saveState)) {
            setPendingClose(true);
            return;
        }
        if (onClose) onClose();
    }, [saveState, onClose]);

    /**
     * Prop bundles shared by the desktop rails and the compact bottom sheets.
     *
     * The same components render in both layouts with the same props — the
     * compact editor is a different arrangement, not a different editor.
     */
    const sidebarProps = {
        creatorMode,
        isEditingTemplate,
        recipientName,
        setRecipientName: editRecipientName,
        recipientEmail,
        setRecipientEmail: editRecipientEmail,
        recipientPhone,
        setRecipientPhone: editRecipientPhone,
        deliveryMethod,
        setDeliveryMethod: editDeliveryMethod,
        file,
        handleFileChange,
        addField,
        fields,
        selectedFieldId,
        setSelectedFieldId,
        removeField,
        getIcon,
        onOpenAiAssistant: openAiAssistant,
        aiAssistantBusy: aiAssistant.isScanning,
        fieldTools: (
            <FieldToolsPanel
                selectedCount={selectedFieldIds.length}
                numPages={numPages || 1}
                activePage={activePage}
                onAlign={handleAlignFields}
                onMatchSize={handleMatchFieldSize}
                onDuplicate={handleDuplicateSelection}
                onCopyToPage={(page) => handleCopyToPages([page], `Copy to page ${page}`)}
                onCopyToAllPages={() => handleCopyToPages(allPages(numPages || 1), 'Copy to all pages')}
            />
        ),
    };

    /** One rail section at a time, inside a sheet rather than a fixed column. */
    const sheetSidebarProps = (section) => ({
        ...sidebarProps,
        initialOpenSections: { setup: section === 'setup', add: section === 'add', placed: section === 'fields' },
        className: 'flex w-full flex-col',
        label: 'Envelope setup',
    });

    const pageRailProps = {
        file,
        numPages: numPages || 0,
        activePage,
        fieldCountsByPage,
        suggestionCountsByPage,
        reviewPages,
    };

    const inspectorElement = (
        <EditorInspector
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            suggestionCount={aiSuggestions.length}
            hasSelection={Boolean(activeField)}
            onDismiss={!isCompact && inspectorOpen ? dismissInspector : undefined}
            propertiesPanel={
                <FieldPropertiesPanel
                    activeField={activeField}
                    updateActiveField={updateActiveField}
                    getIcon={getIcon}
                />
            }
            aiPanel={
                aiPanelOpen ? (
                    <AiSuggestionReviewPanel
                        status={aiAssistant.status}
                        progress={aiAssistant.progress}
                        suggestions={aiSuggestions}
                        manualReview={aiAssistant.manualReview}
                        stats={aiAssistant.stats}
                        error={aiAssistant.error}
                        partial={aiAssistant.partial}
                        truncatedPages={aiAssistant.truncatedPages}
                        selectedSuggestionId={selectedSuggestionId}
                        onSelectSuggestion={setSelectedSuggestionId}
                        onUpdateSuggestion={updateAiSuggestion}
                        onToggleAccepted={toggleSuggestionAccepted}
                        onApplySelected={handleApplySelected}
                        onApplyHighConfidence={handleApplyHighConfidence}
                        onDiscardAll={handleAiDiscardAll}
                        onRescan={() => setAiScanDialogOpen(true)}
                        onUndo={handleAiUndo}
                        canUndo={aiUndoFieldIds.length > 0}
                        onCancel={aiAssistant.cancelScan}
                        onClose={closeAiPanel}
                    />
                ) : null
            }
        />
    );

    /** Opening the AI sheet also selects the tab it is meant to show. */
    const openMobileSheet = (key) => {
        if (key === 'ai') setInspectorTab(INSPECTOR_TABS.AI);
        if (key === 'inspector') setInspectorTab(INSPECTOR_TABS.PROPERTIES);
        setMobileSheet((previous) => (previous === key ? null : key));
    };

    const MOBILE_SHEET_TITLES = {
        setup: 'Setup',
        add: 'Add Field',
        fields: 'Fields',
        inspector: 'Properties',
        ai: 'AI Suggestions',
        pages: 'Pages',
    };

    // Show loading state while hydrating for Correct flow
    if (hydrating) {
        return (
            <div role="status" className="flex h-screen flex-col items-center justify-center gap-ds-3 bg-ds-canvas">
                <Loader2 className="animate-spin text-ds-action-primary" size={36} aria-hidden="true" />
                <p className="text-ds-sm font-medium text-ds-content-secondary">Loading document for editing...</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-ds-canvas">
            <EditorTopBar
                mode={editorMode}
                title={title}
                onTitleChange={handleTitleChange}
                saveState={saveState}
                pageCount={numPages || 0}
                fieldCount={fields.length}
                canUndo={historyCanUndo(history)}
                canRedo={historyCanRedo(history)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onPreview={() => setPreviewOpen(true)}
                previewDisabled={!file}
                onBack={requestClose}
                onSave={handleSave}
                saving={loading}
                compact={isCompact}
            />

            {/* 3-COLUMN LAYOUT */}
            <div className="flex flex-1 overflow-hidden">

                {/* LEFT RAIL: Setup / Add Fields / Fields.

                    Desktop only. On a phone the same sections are reachable
                    from the bottom bar, one sheet at a time, instead of being
                    compressed into a column that leaves no room for the PDF. */}
                {!isCompact && <EnvelopeSidebar {...sidebarProps} />}

                {!isCompact && <PageThumbnailRail {...pageRailProps} onSelectPage={goToPage} />}

                {/* CENTER: canvas toolbar + PDF viewer with the field overlays */}
                <div ref={canvasRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {file && (
                        <EditorCanvasToolbar
                            activePage={activePage}
                            numPages={numPages || 0}
                            onPreviousPage={() => goToPage(Math.max(1, activePage - 1))}
                            onNextPage={() => goToPage(Math.min(numPages || 1, activePage + 1))}
                            pdfViewportWidth={pdfViewportWidth}
                            setPdfViewportWidth={setPdfViewportWidth}
                            onFitWidth={handleFitWidth}
                            onFitPage={handleFitPage}
                            canUndo={historyCanUndo(history)}
                            canRedo={historyCanRedo(history)}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                            onPreview={() => setPreviewOpen(true)}
                            previewDisabled={!file}
                        />
                    )}
                    <PdfFieldWorkbench
                        workbenchRef={pdfWorkbenchRef}
                        file={file}
                        numPages={numPages}
                        setNumPages={setNumPages}
                        activePage={activePage}
                        pageRefs={pageRefs}
                        pageDimensions={pageDimensions}
                        onPageLoadSuccess={onPageLoadSuccess}
                        pdfViewportWidth={pdfViewportWidth}
                        setPdfViewportWidth={setPdfViewportWidth}
                        fields={fields}
                        selectedFieldId={selectedFieldId}
                        selectedFieldIds={selectedFieldIds}
                        setSelectedFieldId={setSelectedFieldId}
                        updateFieldPosition={updateFieldPosition}
                        onFieldDragMove={handleFieldDragMove}
                        dragGuides={dragGuides}
                        updateFieldSize={updateFieldSize}
                        removeField={removeField}
                        updateFieldLabel={updateFieldLabel}
                        getIcon={getIcon}
                        aiSuggestions={aiSuggestions}
                        selectedSuggestionId={selectedSuggestionId}
                        onSelectSuggestion={setSelectedSuggestionId}
                        onMoveSuggestion={moveSuggestion}
                        onResizeSuggestion={resizeSuggestion}
                        onAcceptSuggestion={toggleSuggestionAccepted}
                        onRejectSuggestion={rejectSuggestion}
                    />
                </div>

                {/* RIGHT: the inspector.

                    A permanent 320px column from `lg` up, so selecting or
                    deselecting a field never resizes the canvas under the
                    pointer. Below that breakpoint there is no room for a third
                    column and it moves into the Properties / AI Suggestions
                    bottom sheets instead. */}
                {!isCompact && (
                    <div
                        role="complementary"
                        aria-label="Document inspector"
                        className={`shrink-0 overflow-hidden border-l border-ds-border-subtle bg-ds-surface shadow-ds-lg ${
                            inspectorOpen
                                ? 'fixed inset-y-0 right-0 z-40 w-full max-w-sm lg:static lg:z-auto lg:w-80 lg:max-w-none'
                                : 'hidden lg:block lg:w-80'
                        }`}
                    >
                        {inspectorElement}
                    </div>
                )}
            </div>

            {/* Compact editor: a bottom toolbar that opens one sheet at a time.
                Each sheet is the shared accessible dialog, so focus moves in,
                Tab is trapped, Escape and the backdrop close it, and focus
                returns to the button that opened it. */}
            {isCompact && (
                <EditorMobileBar
                    openSheet={mobileSheet}
                    onOpenSheet={openMobileSheet}
                    fieldCount={fields.length}
                    suggestionCount={aiSuggestions.length}
                />
            )}

            {isCompact && mobileSheet && (
                <EditorBottomSheet
                    title={MOBILE_SHEET_TITLES[mobileSheet]}
                    onClose={() => setMobileSheet(null)}
                >
                    {(mobileSheet === 'setup' || mobileSheet === 'add' || mobileSheet === 'fields') && (
                        <EnvelopeSidebar {...sheetSidebarProps(mobileSheet)} />
                    )}
                    {(mobileSheet === 'inspector' || mobileSheet === 'ai') && inspectorElement}
                    {mobileSheet === 'pages' && (
                        <PageThumbnailRail
                            {...pageRailProps}
                            variant="sheet"
                            onSelectPage={(page) => {
                                goToPage(page);
                                setMobileSheet(null);
                            }}
                        />
                    )}
                </EditorBottomSheet>
            )}

            {previewOpen && (
                <SignerPreviewDialog
                    file={file}
                    numPages={numPages || 1}
                    fields={fields}
                    recipientName={recipientName}
                    recipientEmail={recipientEmail}
                    recipientPhone={recipientPhone}
                    companyName={companyName}
                    initialPage={activePage}
                    onClose={() => setPreviewOpen(false)}
                />
            )}

            {/*
              Leaving with unsaved work is guarded by the shared accessible
              confirmation, not a blocking browser dialog.
            */}
            <ConfirmDialog
                isOpen={pendingClose}
                tone="warning"
                title="Leave without saving?"
                description="This document has changes that have not been saved. Leaving now discards them."
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                onConfirm={() => {
                    setPendingClose(false);
                    if (onClose) onClose();
                }}
                onCancel={() => setPendingClose(false)}
            />

            {aiScanDialogOpen && (
                <AiScanOptionsDialog
                    activePage={activePage}
                    numPages={numPages || 1}
                    onClose={() => setAiScanDialogOpen(false)}
                    onStart={handleAiScanStart}
                />
            )}
        </div>
    );
}
