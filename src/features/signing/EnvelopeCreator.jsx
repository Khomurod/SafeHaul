import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
// The Firebase persistence paths — the "Correct"/"Edit Template" hydration
// and the save/send action — live in utils/envelopePersistence.js since the
// 2026-09-01 source-size split. State stays here; the module gets setters.
import {
    hydrateEnvelopeForEdit,
    saveEnvelope,
} from '@features/signing/utils/envelopePersistence';
import { getFieldIcon } from './components/envelope-creator/fieldDefinitions';
import {
    INSPECTOR_TABS,
    SAVE_STATES,
    resolveEditorMode,
} from '@features/signing/utils/editorSaveState';
import {
    countFieldsByPage,
    toggleSelection,
} from '@features/signing/utils/fieldGeometry';
import { useCompactEditor } from './hooks/useCompactEditor';
// The editing spine split out on 2026-09-01 (SG-1b): history/save state and
// the single write path, the field-mutation handlers, and the keyboard
// clipboard — see each hook's header for what moved.
import { useEditorHistoryState } from './hooks/useEditorHistoryState';
import { useEnvelopeFieldEditing } from './hooks/useEnvelopeFieldEditing';
import { useFieldClipboardShortcuts } from './hooks/useFieldClipboardShortcuts';
// And the SG-1c split: the document/viewport controls, the AI-suggestion
// review workflow, and the arrangement itself.
import { useEnvelopeDocumentControls } from './hooks/useEnvelopeDocumentControls';
import { useAiSuggestionWorkflow } from './hooks/useAiSuggestionWorkflow';
import { EnvelopeCreatorLayout } from './components/envelope-creator/EnvelopeCreatorLayout';

/**
 * EnvelopeCreator — one-off signing request + template editor.
 *
 * Split for readability (behavior unchanged):
 *  - ./components/envelope-creator/fieldDefinitions.jsx       — field palette definitions + icons
 *  - ./components/envelope-creator/ResizableDraggableField.jsx — field overlay editor
 *  - ./components/envelope-creator/FieldPropertiesPanel.jsx    — right sidebar
 *  - ./components/envelope-creator/EnvelopeSidebar.jsx         — recipient/delivery + field palette
 *  - ./components/envelope-creator/PdfFieldWorkbench.jsx       — PDF canvas/viewer with overlays
 *  - ./components/envelope-creator/EnvelopeCreatorLayout.jsx   — the arrangement (SG-1c)
 *  - utils/envelopePersistence.js + five hooks                 — see their headers (SG-1a/b/c)
 * State ownership, the hook wiring and the prop plumbing stay here.
 */

export default function EnvelopeCreator({
    companyId,
    onClose,
    initialMode = 'request',
    editRequestId = null,
    editTemplateId = null,
    companyName = '',
}) {
    const { showSuccess, showError } = useToast();
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

    // Recipient details only needed for 'request' mode
    const [recipientEmail, setRecipientEmail] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    // ADV-2 FIX: Delivery method selector for one-off sends
    const [deliveryMethod, setDeliveryMethod] = useState('email'); // 'email' | 'sms' | 'both' | 'copy'
    const [title, setTitle] = useState('');

    // The PDF itself and how it is shown — file, page count, visible page,
    // page refs/dimensions, viewport width with wheel zoom and the fit
    // handlers, and the upload picker with its size ceiling — live in
    // useEnvelopeDocumentControls since the 2026-09-01 source-size split
    // (SG-1c).
    const {
        file,
        setFile,
        fileRef,
        numPages,
        setNumPages,
        activePage,
        pageRefs,
        pageDimensions,
        pdfViewportWidth,
        setPdfViewportWidth,
        pdfWorkbenchRef,
        canvasRef,
        goToPage,
        handleFitWidth,
        handleFitPage,
        handleFileChange,
        onPageLoadSuccess,
    } = useEnvelopeDocumentControls({
        hydrating,
        showError,
        setTitle,
        setSaveState,
        resetEditorHistory,
        setSelectedFieldId,
    });

    const [inspectorTab, setInspectorTab] = useState(INSPECTOR_TABS.PROPERTIES);
    // Compact editor: the desktop rails are replaced by a bottom toolbar and one
    // bottom sheet at a time, so the PDF keeps the screen.
    const isCompact = useCompactEditor();

    // The AI-suggestion review workflow — the scan dialog, the panel, the
    // selected suggestion, the one-level apply undo, and every handler around
    // useAiFieldAssistant — lives in useAiSuggestionWorkflow since the
    // 2026-09-01 source-size split (SG-1c).
    const {
        aiAssistant,
        aiSuggestions,
        updateAiSuggestion,
        aiScanDialogOpen,
        setAiScanDialogOpen,
        aiPanelOpen,
        setAiPanelOpen,
        selectedSuggestionId,
        setSelectedSuggestionId,
        aiUndoFieldIds,
        openAiAssistant,
        handleAiScanStart,
        toggleSuggestionAccepted,
        rejectSuggestion,
        handleApplySelected,
        handleApplyHighConfidence,
        handleAiUndo,
        handleAiDiscardAll,
        closeAiPanel,
        moveSuggestion,
        resizeSuggestion,
        suggestionCountsByPage,
        reviewPages,
    } = useAiSuggestionWorkflow({
        companyId,
        file,
        numPages,
        activePage,
        fields,
        fieldsRef,
        commitFields,
        setSelectedFieldIds,
        setInspectorTab,
        showSuccess,
    });

    const selectedFieldIdRef = useRef(null);
    const selectedFieldIdsRef = useRef([]);

    useEffect(() => {
        selectedFieldIdRef.current = selectedFieldId;
        selectedFieldIdsRef.current = selectedFieldIds;
    }, [selectedFieldId, selectedFieldIds]);

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
    }, [editingEntityId, companyId, editingCollection, isEditingTemplate, showError, resetEditorHistory, setFile, setNumPages]);

    const handleTitleChange = useCallback((next) => {
        setTitle(next);
        setSaveState(SAVE_STATES.UNSAVED);
    }, [setSaveState]);

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

    const editorMode = resolveEditorMode({ creatorMode, isEditingTemplate, isEditingRequest });
    const fieldCountsByPage = useMemo(() => countFieldsByPage(fields), [fields]);

    // Show loading state while hydrating for Correct flow
    if (hydrating) {
        return (
            <div role="status" className="flex h-screen flex-col items-center justify-center gap-ds-3 bg-ds-canvas">
                <Loader2 className="animate-spin text-ds-action-primary" size={36} aria-hidden="true" />
                <p className="text-ds-sm font-medium text-ds-content-secondary">Loading document for editing...</p>
            </div>
        );
    }

    /**
     * Everything the workbench needs, grouped so the layout stays a pure
     * arrangement. The same object serves desktop and compact, like the
     * sidebar/page-rail bundles above.
     */
    const workbenchProps = {
        workbenchRef: pdfWorkbenchRef,
        file,
        numPages,
        setNumPages,
        activePage,
        pageRefs,
        pageDimensions,
        onPageLoadSuccess,
        pdfViewportWidth,
        setPdfViewportWidth,
        fields,
        selectedFieldId,
        selectedFieldIds,
        setSelectedFieldId,
        updateFieldPosition,
        onFieldDragMove: handleFieldDragMove,
        dragGuides,
        updateFieldSize,
        removeField,
        updateFieldLabel,
        getIcon: getFieldIcon,
        aiSuggestions,
        selectedSuggestionId,
        onSelectSuggestion: setSelectedSuggestionId,
        onMoveSuggestion: moveSuggestion,
        onResizeSuggestion: resizeSuggestion,
        onAcceptSuggestion: toggleSuggestionAccepted,
        onRejectSuggestion: rejectSuggestion,
    };

    // The arrangement — top bar, three-column desktop layout, compact bottom
    // bar and sheets, preview/scan dialogs, and the leave-without-saving
    // confirmation — lives in EnvelopeCreatorLayout since the 2026-09-01
    // source-size split (SG-1c).
    return (
        <EnvelopeCreatorLayout
            isCompact={isCompact}
            editorMode={editorMode}
            title={title}
            onTitleChange={handleTitleChange}
            saveState={saveState}
            onClose={onClose}
            file={file}
            numPages={numPages}
            fields={fields}
            history={history}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSave={handleSave}
            saving={loading}
            activePage={activePage}
            goToPage={goToPage}
            pdfViewportWidth={pdfViewportWidth}
            setPdfViewportWidth={setPdfViewportWidth}
            onFitWidth={handleFitWidth}
            onFitPage={handleFitPage}
            canvasRef={canvasRef}
            workbenchProps={workbenchProps}
            creatorMode={creatorMode}
            isEditingTemplate={isEditingTemplate}
            recipientName={recipientName}
            recipientEmail={recipientEmail}
            recipientPhone={recipientPhone}
            editRecipientName={editRecipientName}
            editRecipientEmail={editRecipientEmail}
            editRecipientPhone={editRecipientPhone}
            deliveryMethod={deliveryMethod}
            editDeliveryMethod={editDeliveryMethod}
            companyName={companyName}
            handleFileChange={handleFileChange}
            addField={addField}
            removeField={removeField}
            selectedFieldId={selectedFieldId}
            selectedFieldIds={selectedFieldIds}
            setSelectedFieldId={setSelectedFieldId}
            setSelectedFieldIds={setSelectedFieldIds}
            handleAlignFields={handleAlignFields}
            handleMatchFieldSize={handleMatchFieldSize}
            handleDuplicateSelection={handleDuplicateSelection}
            handleCopyToPages={handleCopyToPages}
            fieldCountsByPage={fieldCountsByPage}
            activeField={activeField}
            updateActiveField={updateActiveField}
            inspectorTab={inspectorTab}
            setInspectorTab={setInspectorTab}
            aiAssistant={aiAssistant}
            aiSuggestions={aiSuggestions}
            updateAiSuggestion={updateAiSuggestion}
            suggestionCountsByPage={suggestionCountsByPage}
            reviewPages={reviewPages}
            aiPanelOpen={aiPanelOpen}
            setAiPanelOpen={setAiPanelOpen}
            selectedSuggestionId={selectedSuggestionId}
            setSelectedSuggestionId={setSelectedSuggestionId}
            openAiAssistant={openAiAssistant}
            toggleSuggestionAccepted={toggleSuggestionAccepted}
            handleApplySelected={handleApplySelected}
            handleApplyHighConfidence={handleApplyHighConfidence}
            handleAiDiscardAll={handleAiDiscardAll}
            handleAiUndo={handleAiUndo}
            aiUndoFieldIds={aiUndoFieldIds}
            closeAiPanel={closeAiPanel}
            aiScanDialogOpen={aiScanDialogOpen}
            setAiScanDialogOpen={setAiScanDialogOpen}
            onAiScanStart={handleAiScanStart}
        />
    );
}
