import React, { useId } from 'react';
import {
    Upload, Link as LinkIcon, X, CheckCircle,
    Download, HelpCircle, RotateCcw, ArrowRight,
} from 'lucide-react';
import {
    Button, ChoiceGroup, DataTable, FieldMessage, FormField,
    IconButton, Input, ProgressBar, Radio, StatusMedallion,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '../modals/Modal';

/**
 * Shared bulk-upload surface (step meter, upload methods, preview, success).
 *
 * Presentation only. The parent owns parsing, the import method values, the
 * preview rows, the confirm/reset/close callbacks, stats and every string it
 * passes in. Nothing here talks to Firestore or knows what a lead is.
 *
 * Migrated to the design system on 2026-07-27. Defects fixed in that pass, each
 * of which changed presentation only:
 *
 *  1. The overlay was a bare `fixed inset-0` div: no `role="dialog"`, no
 *     `aria-modal`, no focus move, no focus trap, no focus restore and no
 *     Escape. It is now the shared accessible `Modal`.
 *  2. `ImportLeadsPage` has always passed `isEmbedded`, but nothing consumed it,
 *     so a full-screen modal rendered on top of the page's own header. The prop
 *     is now honoured: embedded renders in place, and only the dashboard's
 *     overlay usage gets a dialog.
 *  3. The close control was an icon-only `<button>` with no accessible name.
 *  4. The file input was `display: none`, which removes it from the tab order
 *     entirely — the upload control was unreachable by keyboard. It is now
 *     visually hidden but focusable, and the drop zone shows a focus ring.
 *     Its `id` was also a hard-coded global; it is per-instance now.
 *  5. The two import-method tiles were toggle buttons whose selected state was
 *     communicated by colour alone. They are now a real radio group.
 *  6. The Google Sheet URL field had a placeholder but no label.
 *  7. The preview table had no accessible name, no `scope`, and its scroll
 *     region was neither focusable nor labelled. It is now the approved
 *     `DataTable`.
 *  8. Upload progress was silent: the string was the disabled button's label,
 *     never announced, and there was no `progressbar`. It is now a live region
 *     plus a determinate `ProgressBar` when a countable total is supplied.
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

    const steps = [
        { id: 'upload', label: 'Upload' },
        { id: 'preview', label: 'Preview' },
        { id: 'success', label: 'Finish' }
    ];

    const currentStepIndex = steps.findIndex(s => s.id === step);

    const renderStepIndicator = () => (
        <ol className="mb-ds-6 flex items-center justify-center" aria-label="Import steps">
            {steps.map((s, idx) => {
                const isComplete = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                return (
                    <li key={s.id} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
                        <div
                            className={`flex items-center gap-ds-2 ${idx <= currentStepIndex
                                ? 'text-ds-action-primary'
                                : 'text-ds-content-muted'}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-ds-xs font-bold ${isComplete
                                    ? 'border-ds-action-primary bg-ds-action-primary text-ds-content-inverse'
                                    : isCurrent
                                        ? 'border-ds-action-primary bg-ds-surface text-ds-action-primary'
                                        : 'border-ds-border-subtle bg-ds-surface text-ds-content-muted'}`}
                            >
                                {isComplete ? <CheckCircle size={14} /> : idx + 1}
                            </span>
                            <span className="text-ds-sm font-medium">{s.label}</span>
                            <span className="sr-only">
                                {isComplete ? ' completed' : isCurrent ? ' current step' : ' not started'}
                            </span>
                        </div>
                        {idx < steps.length - 1 && (
                            <span
                                aria-hidden="true"
                                className={`mx-ds-2 h-0.5 w-8 ${idx < currentStepIndex
                                    ? 'bg-ds-action-primary'
                                    : 'bg-ds-border-subtle'}`}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );

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

    const renderUploadStep = () => (
        <Stack gap="lg">
            {instructions && (
                <div className="flex items-start gap-ds-3 rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-4 text-ds-sm text-ds-status-info-fg">
                    <HelpCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                        <h3 className="mb-ds-1 font-bold">Instructions</h3>
                        <div className="whitespace-pre-line leading-relaxed">{instructions}</div>
                    </div>
                </div>
            )}

            <ChoiceGroup legend="Import method" orientation="horizontal">
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

            {onDownloadTemplate && (
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={onDownloadTemplate}>
                        <Download size={14} aria-hidden="true" /> Download CSV Template
                    </Button>
                </div>
            )}

            {importMethod === 'file' && (
                <div className="rounded-ds-xl border-2 border-dashed border-ds-border p-ds-8 text-center transition-colors hover:border-ds-action-primary focus-within:border-ds-action-primary focus-within:shadow-ds-focus">
                    {/*
                      `sr-only` rather than `hidden`: the input must stay in the tab
                      order. There is no approved file-input contract in the design
                      system yet (recorded in the roadmap), so this composition is a
                      documented feature-owned exception.
                    */}
                    <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileChange}
                        className="sr-only"
                        id={fileInputId}
                    />
                    <label htmlFor={fileInputId} className="cursor-pointer">
                        <Upload className="mx-auto mb-ds-4 text-ds-content-muted" size={40} aria-hidden="true" />
                        <p className="font-medium text-ds-content-secondary">Click to upload a file</p>
                        <p className="mt-ds-1 text-ds-sm text-ds-content-muted">CSV, XLS, or XLSX files</p>
                    </label>
                </div>
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
                            {!processingSheet && <LinkIcon size={18} aria-hidden="true" />}
                            Import
                        </Button>
                    </div>
                    <p className="text-ds-xs text-ds-content-muted">
                        Make sure the sheet is publicly accessible or shared with view permissions.
                    </p>
                </Stack>
            )}

            {renderFeedback()}
        </Stack>
    );

    const previewKeys = getVisibleKeys(csvData?.[0]);
    const previewRows = (csvData || []).slice(0, 10).map((row, index) => ({
        previewIndex: index,
        row,
    }));
    const previewColumns = previewKeys.map((key) => ({
        key,
        header: key,
        truncate: true,
        render: (entry) => String(entry.row[key] || ''),
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
                        <RotateCcw size={14} aria-hidden="true" /> Reset
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
                        minWidth="auto"
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
                size="lg"
                fullWidth
                onClick={onConfirm}
                disabled={uploading}
                loading={uploading}
            >
                Confirm Upload {!uploading && <ArrowRight size={18} aria-hidden="true" />}
            </Button>
        </Stack>
    );

    const renderSuccessStep = () => (
        <div className="py-ds-8 text-center">
            <StatusMedallion tone="success" size="lg" className="mx-auto mb-ds-4">
                <CheckCircle size={48} />
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

    const body = (
        <>
            <div className="flex items-center justify-between border-b border-ds-border-subtle p-ds-5">
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">{title}</h2>
                <div className="flex items-center gap-ds-3">
                    {headerAction}
                    {/*
                      Named "Close import" rather than "Close": the success step
                      has its own frozen "Close" button, and two controls with the
                      same accessible name in one dialog is exactly the ambiguity
                      a screen-reader user cannot resolve.
                    */}
                    <IconButton label="Close import" variant="ghost" size="sm" onClick={onClose}>
                        <X size={20} aria-hidden="true" />
                    </IconButton>
                </div>
            </div>

            <div className="p-ds-6">
                {renderStepIndicator()}
                {step === 'upload' && renderUploadStep()}
                {step === 'preview' && renderPreviewStep()}
                {step === 'success' && renderSuccessStep()}
            </div>
        </>
    );

    if (isEmbedded) {
        return (
            <section
                aria-labelledby={titleId}
                className="w-full overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-sm"
            >
                {body}
            </section>
        );
    }

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            {body}
        </Modal>
    );
}
