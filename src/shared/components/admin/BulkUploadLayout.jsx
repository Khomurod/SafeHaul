import React, { useId } from 'react';
import { Icon, Link as LinkIcon, X, CheckCircle, Download, HelpCircle, RotateCcw, ArrowRight } from '@design-system/icons';
import {
    Button, ChoiceGroup, DataTable, FieldMessage, FileInput, FormField, FormSection,
    IconButton, Input, ProgressBar, Radio, StatusMedallion,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';
import { BulkUploadSteps } from './BulkUploadSteps';

/**
 * Shared bulk-upload surface (step meter, upload methods, preview, success).
 *
 * Presentation only. The parent owns parsing, the import method values, the
 * preview rows, the confirm/reset/close callbacks, stats and every string it
 * passes in. Nothing here talks to Firestore or knows what a lead is.
 *
 * Presentation rules:
 *
 *  1. The overlay is the approved accessible `Modal`: dialog role, focus move,
 *     trap and restore, and Escape.
 *  2. `isEmbedded` is honoured (`ImportLeadsPage` passes it): embedded renders in
 *     place, and only the dashboard's overlay usage gets a dialog.
 *  3. The close control has an accessible name.
 *  4. The file input is never `display: none`, so the upload control stays
 *     reachable by keyboard, and the drop zone shows a focus ring. Its `id` is
 *     per-instance, never a hard-coded global.
 *  5. The two import methods are a real radio group, never toggle tiles whose
 *     selection is shown by colour alone.
 *  6. The Google Sheet URL field has a label, not only a placeholder.
 *  7. The preview table is the approved `DataTable`: an accessible name, `scope`,
 *     and a focusable, labelled scroll region.
 *  8. Upload progress is announced in a live region, with a determinate
 *     `ProgressBar` when a countable total is supplied.
 *  9. Embedded, it is one card (`FormSection header="bleed"`): the title, an
 *     optional `description` and the `headerAction` on its header row, then the
 *     step. There is no close control in the card: the page around it has the
 *     way back. A page that shows the steps itself (`BulkUploadSteps`, in its
 *     header) passes `showSteps={false}`; the dialog always shows them.
 * 10. The upload step is two columns where the card is at least 900px wide:
 *     the method, the file and the template on the left, the instructions as a
 *     full-height panel on the right. Narrower, the instructions are a band
 *     above the method; where the card is under 560px the template action
 *     follows the file.
 *     `instructions` is a list of sentences (a bulleted list) or one string
 *     (shown as written, line breaks kept).
 *
 * Frozen and unchanged: the step ids/labels, the accepted file formats, the
 * `'file'` / `'gsheet'` values, the internal-field filter, the 8-column and
 * 10-row preview caps, the record count, every callback signature, and every
 * user-facing string.
 */
export function BulkUploadLayout({
    title = "Bulk Upload",
    step,
    importMethod,
    setImportMethod,
    sheetUrl,
    setSheetUrl,
    processingSheet,
    handleSheetImport,
    handleFileChange,
    csvData,
    reset,
    onConfirm,
    onClose,
    uploading,
    progress,
    stats,
    children,
    headerAction,
    onDownloadTemplate,
    instructions,
    // Additive, presentation-only.
    /** Render in place instead of as a modal dialog. */
    isEmbedded = false,
    /** Countable progress for the determinate bar. `total: 0` hides the bar. */
    progressCount,
    /** Non-blocking failure message shown in place, replacing `alert()`. */
    error,
    /** Non-blocking informational outcome shown in place, replacing `alert()`. */
    notice,
    /** One line under the title, saying what the upload does. */
    description,
    /** Draw the step list in the card; false when the page draws it in its header. */
    showSteps = true,
}) {
    const instanceId = useId().replace(/:/g, '');
    const titleId = `bulk-upload-title-${instanceId}`;
    const fileInputId = `bulk-upload-file-${instanceId}`;

    // #10 FIX: Filter out internal/system fields from the preview table
    const INTERNAL_FIELDS = new Set([
        '__rowNum', '__parsed', '__index', '_raw', 'id', 'uid',
        'createdAt', 'updatedAt', 'companyId', 'assignedTo',
        'sourceType', 'status', 'lifecycle', 'processingStatus'
    ]);

    const getVisibleKeys = (row) => {
        if (!row) return [];
        return Object.keys(row).filter(k => !INTERNAL_FIELDS.has(k)).slice(0, 8);
    };

    /**
     * A failure is `role="alert"` (assertive) because the user's action did not
     * happen; an informational outcome is `role="status"` (polite) because it
     * did. Both replace a blocking `alert()` and keep the caller's exact text.
     */
    const renderFeedback = () => (
        <>
            {error && <FieldMessage tone="error">{error}</FieldMessage>}
            {notice && <FieldMessage tone="success" role="status">{notice}</FieldMessage>}
        </>
    );

    const renderInstructions = () => (
        <>
            {/* `HelpCircle` rather than an info glyph: this is guidance on how
                to do the task, not information about its state. */}
            <h3 className="flex items-center gap-ds-2 text-ds-body font-semibold text-ds-brand-primary">
                <Icon icon={HelpCircle} />
                Instructions
            </h3>
            {Array.isArray(instructions) ? (
                <>
                    <p className="text-ds-body text-ds-content-secondary">What the file needs.</p>
                    <ul className="mt-ds-3 grid list-disc gap-ds-1 pl-ds-5 text-ds-body text-ds-content-secondary">
                        {instructions.map((line) => <li key={line} className="[text-wrap:pretty]">{line}</li>)}
                    </ul>
                </>
            ) : (
                <div className="mt-ds-1 whitespace-pre-line text-ds-body text-ds-content-secondary">{instructions}</div>
            )}
        </>
    );

    const templateAction = onDownloadTemplate && (
        /* An action, not a link: it builds the file and downloads it. */
        <Button variant="link" onClick={onDownloadTemplate}>
            <Icon icon={Download} size="sm" /> Download CSV Template
        </Button>
    );

    /*
     * One size container, the card's body: from 900px two columns, narrower
     * the instructions as a band; from 560px the template action at the end of
     * the method's row (it fits there in the left column too), narrower — a
     * phone, a tablet beside the menu — on a row of its own under the file.
     * Instructions come first in the DOM, as they always have, so they are read
     * before the controls; in two columns the grid places them on the right.
     */
    const renderUploadStep = () => (
        <div className="min-w-0 [container-type:inline-size]">
            <div className="grid min-w-0 [@container_(min-width:900px)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                {instructions && (
                    <div className="min-w-0 border-b border-ds-border-subtle bg-ds-canvas p-ds-card [@container_(min-width:900px)]:col-start-2 [@container_(min-width:900px)]:row-start-1 [@container_(min-width:900px)]:border-b-0 [@container_(min-width:900px)]:border-l">
                        {renderInstructions()}
                    </div>
                )}

                <div className="grid min-w-0 p-ds-card [@container_(min-width:900px)]:col-start-1 [@container_(min-width:900px)]:row-start-1">
                    {/* Rows: the method, then the file (which grows to the
                        instructions' height in two columns), then — where the
                        card is under 560px — the template action. */}
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] gap-x-ds-4">
                        <ChoiceGroup legend="Import method" orientation="horizontal" className="min-w-0">
                            <Radio
                                name={`bulk-upload-method-${instanceId}`}
                                label="Upload File"
                                value="file"
                                checked={importMethod === 'file'}
                                onChange={() => setImportMethod('file')}
                            />
                            <Radio
                                name={`bulk-upload-method-${instanceId}`}
                                label="Google Sheet"
                                value="gsheet"
                                checked={importMethod === 'gsheet'}
                                onChange={() => setImportMethod('gsheet')}
                            />
                        </ChoiceGroup>

                        {templateAction && (
                            <div className="col-start-1 row-start-3 mt-ds-2 flex min-h-ds-control items-center [@container_(min-width:560px)]:col-start-2 [@container_(min-width:560px)]:row-start-1 [@container_(min-width:560px)]:mt-0 [@container_(min-width:560px)]:mb-ds-1 [@container_(min-width:560px)]:min-h-0 [@container_(min-width:560px)]:self-end">
                                {templateAction}
                            </div>
                        )}

                        <div className="col-span-full row-start-2 mt-ds-4 grid min-w-0 grid-rows-[1fr] gap-ds-4">
                            {importMethod === 'file' && (
                                /*
                                  `FileInput variant="dropzone"`, never the same structure by
                                  hand. The label is hidden because the radio above it already
                                  says "Upload a file"; the accessible name stays.
                                */
                                <FileInput
                                    label="Upload a file"
                                    labelHidden
                                    variant="dropzone"
                                    buttonLabel="Click to upload a file"
                                    description="CSV, XLS, or XLSX files"
                                    accept=".csv,.xlsx,.xls"
                                    onChange={handleFileChange}
                                    id={fileInputId}
                                />
                            )}

                            {importMethod === 'gsheet' && (
                                <Stack gap="sm">
                                    <div className="flex items-end gap-ds-2">
                                        <div className="min-w-0 flex-1">
                                            <FormField label="Google Sheet URL">
                                                <Input
                                                    type="url"
                                                    value={sheetUrl}
                                                    onChange={(e) => setSheetUrl(e.target.value)}
                                                    placeholder="Paste Google Sheet URL..."
                                                />
                                            </FormField>
                                        </div>
                                        <Button
                                            variant="primary"
                                            tone="success"
                                            onClick={handleSheetImport}
                                            disabled={!sheetUrl || processingSheet}
                                            loading={processingSheet}
                                        >
                                            {!processingSheet && <Icon icon={LinkIcon} size="lg" />}
                                            Import
                                        </Button>
                                    </div>
                                    <p className="text-ds-xs text-ds-content-muted">
                                        Make sure the sheet is publicly accessible or shared with view permissions.
                                    </p>
                                </Stack>
                            )}

                            {renderFeedback()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const previewKeys = getVisibleKeys(csvData?.[0]);
    const previewRows = (csvData || []).slice(0, 10).map((row, index) => ({
        previewIndex: index,
        row,
    }));
    // Every column `lg`, so the longest header ("normalizedPhone") fits on
    // its line and a value is readable: eight of them are wider than the
    // dialog, so the preview scrolls sideways rather than squeezing each
    // column to a few letters. A longer value is cut, and whole on hover.
    const previewColumns = previewKeys.map((key) => ({
        key,
        header: key,
        width: 'lg',
        truncate: true,
        render: (entry) => {
            const value = String(entry.row[key] || '');
            return <span title={value || undefined}>{value}</span>;
        },
    }));

    const hasCountableProgress = Number(progressCount?.total) > 0;

    const renderPreviewStep = () => (
        <Stack gap="md">
            {children}

            <div className="overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-canvas">
                <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
                    <span className="font-medium text-ds-content-secondary">
                        Preview ({csvData?.length || 0} records)
                    </span>
                    <Button variant="ghost" size="sm" onClick={reset}>
                        <Icon icon={RotateCcw} size="sm" /> Reset
                    </Button>
                </div>
                {/*
                  A fixed `h-64`, not `max-h-64`: `DataTable`'s root uses
                  `height: 100%`, which only resolves against an ancestor with an
                  explicit (not `max-`) height. With only `max-height` here the
                  percentage falls back to `auto` and the table grew to fit every
                  row instead of scrolling — the exact overflow this wrapper
                  exists to prevent.
                */}
                <div className="flex h-64">
                    <DataTable
                        ariaLabel="Import preview"
                        data={previewRows}
                        columns={previewColumns}
                        getRowId={(entry) => entry.previewIndex}
                        density="compact"
                        minWidth="none"
                        embedded
                        empty={{ title: 'No records to preview.' }}
                    />
                </div>
            </div>

            {uploading && (
                <div role="status" aria-live="polite">
                    <p className="mb-ds-2 text-center text-ds-sm text-ds-content-secondary">
                        {progress || 'Processing...'}
                    </p>
                    {hasCountableProgress && (
                        <ProgressBar
                            value={progressCount.current}
                            max={progressCount.total}
                            label="Upload progress"
                            valueText={`${progressCount.current} of ${progressCount.total} records`}
                        />
                    )}
                </div>
            )}

            {renderFeedback()}

            <Button
                variant="primary"
                fullWidth
                onClick={onConfirm}
                disabled={uploading}
                loading={uploading}
            >
                Confirm Upload {!uploading && <Icon icon={ArrowRight} size="lg" />}
            </Button>
        </Stack>
    );

    const renderSuccessStep = () => (
        <div className="py-ds-8 text-center">
            <StatusMedallion tone="success" size="lg" className="mx-auto mb-ds-4">
                <Icon icon={CheckCircle} />
            </StatusMedallion>
            <h3 className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">Upload Complete!</h3>
            <div className="mb-ds-6 flex justify-center gap-ds-6 text-ds-sm text-ds-content-secondary">
                <span>
                    <strong className="text-ds-status-success-fg">{stats?.created || 0}</strong> Created
                </span>
                <span>
                    <strong className="text-ds-content-link">{stats?.updated || 0}</strong> Updated
                </span>
            </div>
            <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
    );

    const stepBody = (
        <>
            {step === 'upload' && renderUploadStep()}
            {step === 'preview' && renderPreviewStep()}
            {step === 'success' && renderSuccessStep()}
        </>
    );

    if (isEmbedded) {
        /*
         * The upload step lays out its own padding (a full-bleed instructions
         * panel); the preview and the result take the card's. `overflow-hidden`
         * keeps that panel's fill inside the card's rounded corner: nothing in
         * the card opens outside it (the repair dialog is a portal).
         */
        return (
            <FormSection
                header="bleed"
                title={title}
                description={description}
                actions={headerAction}
                padding={step === 'upload' ? 'none' : 'md'}
                className="overflow-hidden"
            >
                {showSteps && (
                    <div className={step === 'upload' ? 'px-ds-card pt-ds-card' : ''}>
                        <BulkUploadSteps step={step} className="justify-center" />
                    </div>
                )}
                {stepBody}
            </FormSection>
        );
    }

    /*
     * The dialog keeps its close control, named "Close import" rather than
     * "Close": the success step has its own frozen "Close" button, and two
     * controls with the same accessible name in one dialog is exactly the
     * ambiguity a screen-reader user cannot resolve.
     */
    const body = (
        <>
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-ds-heading-sm font-semibold text-ds-content">{title}</h2>
                    {description && <p className="mt-ds-1 text-ds-body text-ds-content-secondary">{description}</p>}
                </div>
                <div className="flex items-center gap-ds-3">
                    {headerAction}
                    <IconButton label="Close import" variant="ghost" size="sm" onClick={onClose}>
                        <Icon icon={X} size="xl" />
                    </IconButton>
                </div>
            </div>

            {showSteps && (
                <div className="px-ds-6 pt-ds-6">
                    <BulkUploadSteps step={step} className="justify-center" />
                </div>
            )}
            <div className={step === 'upload' ? '' : 'p-ds-6'}>{stepBody}</div>
        </>
    );

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            size="2xl"
        >
            {body}
        </Modal>
    );
}
