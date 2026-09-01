// The envelope editor's arrangement, split out of `EnvelopeCreator.jsx` on
// 2026-09-01 for the source-size standard (SG-1c). JSX verbatim from the
// component's return: the top bar, the three-column desktop layout, the
// compact bottom bar with its one-sheet-at-a-time presentation, the preview
// and scan dialogs, and the leave-without-saving confirmation. Purely
// presentation-owned state lives here (which sheet is open, whether preview
// or the close confirmation is showing); every document mutation arrives
// through props. The compact editor is a different arrangement, not a
// different editor — both layouts render the same components with the same
// prop bundles the component builds.
import { useState, useCallback } from 'react';
import { ConfirmDialog } from '@design-system/patterns';
import { getFieldIcon } from './fieldDefinitions';
import { FieldPropertiesPanel } from './FieldPropertiesPanel';
import { EditorInspector } from './EditorInspector';
import { AiSuggestionReviewPanel } from './AiSuggestionReviewPanel';
import { FieldToolsPanel } from './FieldToolsPanel';
import { EnvelopeSidebar } from './EnvelopeSidebar';
import { PdfFieldWorkbench } from './PdfFieldWorkbench';
import { AiScanOptionsDialog } from './AiScanOptionsDialog';
import { EditorTopBar } from './EditorTopBar';
import { EditorCanvasToolbar } from './EditorCanvasToolbar';
import { PageThumbnailRail } from './PageThumbnailRail';
import { SignerPreviewDialog } from './SignerPreviewDialog';
import { EditorBottomSheet } from './EditorBottomSheet';
import { EditorMobileBar } from './EditorMobileBar';
import {
    canRedo as historyCanRedo,
    canUndo as historyCanUndo,
} from '@features/signing/utils/editorHistory';
import {
    INSPECTOR_TABS,
    hasUnsavedWork,
} from '@features/signing/utils/editorSaveState';
import { allPages } from '@features/signing/utils/fieldGeometry';

const MOBILE_SHEET_TITLES = {
    setup: 'Setup',
    add: 'Add Field',
    fields: 'Fields',
    inspector: 'Properties',
    ai: 'AI Suggestions',
    pages: 'Pages',
};

export function EnvelopeCreatorLayout({
    isCompact,
    editorMode,
    title,
    onTitleChange,
    saveState,
    onClose,
    file,
    numPages,
    fields,
    history,
    onUndo,
    onRedo,
    onSave,
    saving,
    activePage,
    goToPage,
    pdfViewportWidth,
    setPdfViewportWidth,
    onFitWidth,
    onFitPage,
    canvasRef,
    workbenchProps,
    creatorMode,
    isEditingTemplate,
    recipientName,
    recipientEmail,
    recipientPhone,
    editRecipientName,
    editRecipientEmail,
    editRecipientPhone,
    deliveryMethod,
    editDeliveryMethod,
    companyName,
    handleFileChange,
    addField,
    removeField,
    selectedFieldId,
    selectedFieldIds,
    setSelectedFieldId,
    setSelectedFieldIds,
    handleAlignFields,
    handleMatchFieldSize,
    handleDuplicateSelection,
    handleCopyToPages,
    fieldCountsByPage,
    activeField,
    updateActiveField,
    inspectorTab,
    setInspectorTab,
    aiAssistant,
    aiSuggestions,
    updateAiSuggestion,
    suggestionCountsByPage,
    reviewPages,
    aiPanelOpen,
    setAiPanelOpen,
    selectedSuggestionId,
    setSelectedSuggestionId,
    openAiAssistant,
    toggleSuggestionAccepted,
    handleApplySelected,
    handleApplyHighConfidence,
    handleAiDiscardAll,
    handleAiUndo,
    aiUndoFieldIds,
    closeAiPanel,
    aiScanDialogOpen,
    setAiScanDialogOpen,
    onAiScanStart,
}) {
    const [mobileSheet, setMobileSheet] = useState(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [pendingClose, setPendingClose] = useState(false);

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

    /** Opening the AI sheet also selects the tab it is meant to show. */
    const openMobileSheet = (key) => {
        if (key === 'ai') setInspectorTab(INSPECTOR_TABS.AI);
        if (key === 'inspector') setInspectorTab(INSPECTOR_TABS.PROPERTIES);
        setMobileSheet((previous) => (previous === key ? null : key));
    };

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
    }, [setSelectedFieldIds, setAiPanelOpen]);

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

    return (
        <div className="flex h-screen flex-col bg-ds-canvas">
            <EditorTopBar
                mode={editorMode}
                title={title}
                onTitleChange={onTitleChange}
                saveState={saveState}
                pageCount={numPages || 0}
                fieldCount={fields.length}
                canUndo={historyCanUndo(history)}
                canRedo={historyCanRedo(history)}
                onUndo={onUndo}
                onRedo={onRedo}
                onPreview={() => setPreviewOpen(true)}
                previewDisabled={!file}
                onBack={requestClose}
                onSave={onSave}
                saving={saving}
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
                            onFitWidth={onFitWidth}
                            onFitPage={onFitPage}
                            canUndo={historyCanUndo(history)}
                            canRedo={historyCanRedo(history)}
                            onUndo={onUndo}
                            onRedo={onRedo}
                            onPreview={() => setPreviewOpen(true)}
                            previewDisabled={!file}
                        />
                    )}
                    <PdfFieldWorkbench {...workbenchProps} />
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
                    onStart={onAiScanStart}
                />
            )}
        </div>
    );
}
