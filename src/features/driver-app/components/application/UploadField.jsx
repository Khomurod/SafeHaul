import React, { useId, useRef, useState } from 'react';
import { Upload, X, CheckCircle, RefreshCw, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { Button, IconButton, ProgressBar } from '@/design-system/components';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';

/**
 * UploadField
 * A reliable file upload component with progress tracking, retry logic, and previews.
 *
 * Presentation is migrated to the approved `Button` / `IconButton` /
 * `ProgressBar` primitives and `--ds-*` tokens. The design system has no
 * approved file-input contract yet (Phase 4 records it as open), so the
 * hidden-input + visible-trigger composition stays feature-owned. The dashed
 * drop-zone look is produced by giving the approved secondary `Button` a dashed
 * 2 px border — the variant keeps owning the border *colour*, so no token is
 * bypassed and no local button is created.
 *
 * Frozen behaviour: the `onUpload(name, file)` call, the `onChange(name, result)`
 * / `onChange(name, null)` payloads, the "Upload completed but no file metadata
 * was returned." guard, the fake progress ramp and its 1 s success→idle reset,
 * the fact that removing a file is confirmed before it happens, the
 * `required && !hasValue` attribute on the hidden input, the `accept` default, and
 * the exact "Uploaded Successfully" / "Upload failed. Please try again." strings
 * (asserted by `e2e/public-application.spec.cjs`).
 *
 * DEFECT FIXED (2026-07-28): the removal prompt was a bare `confirm(...)`. The
 * *rule* (removal is always confirmed) is preserved; the blocking browser dialog
 * is replaced by the shared accessible `ConfirmDialog`.
 *
 * DEFECTS FIXED (2026-07-27):
 * - The empty state was a `<div onClick>`: unreachable by keyboard, no role, no
 *   accessible name. It is now an approved `Button` that names the field.
 * - Progress, success and failure were silent. They are now announced through
 *   `role="status"` / `role="alert"` live regions.
 * - The hidden input used `display:none`, so a `required` empty input made
 *   `form.reportValidity()` fail with no focusable control and therefore no
 *   visible message. It is now visually hidden but focusable, and kept out of
 *   the tab order with `tabIndex={-1}` so the visible trigger stays the only
 *   tab stop.
 *
 * `data-upload-field` / `data-upload-state` are a deliberate test contract: the
 * E2E specs must be able to wait for *this* field's committed state instead of
 * counting shared "Uploaded Successfully" strings across the whole step.
 */
const UploadField = ({
    label,
    value,
    onUpload,
    onChange,
    name,
    required = false,
    accept = "image/*,application/pdf"
}) => {
    const [status, setStatus] = useState('idle'); // idle, uploading, success, error
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState(null);
    // Replaces the bare `confirm("Are you sure you want to remove this file?")`.
    const [pendingClear, setPendingClear] = useState(false);
    const fileInputRef = useRef(null);
    const rawId = useId().replace(/:/g, '');
    const labelId = `upload-${name}-label-${rawId}`;

    // Determine current display
    const hasValue = !!value;
    const fileName = value?.name || (typeof value === 'string' ? 'Uploaded File' : null);
    const fileUrl = value?.url || (typeof value === 'string' ? value : null);
    const isImage = fileName?.match(/\.(jpg|jpeg|png|gif|webp)$/i) || (typeof value === 'string');

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset
        setStatus('uploading');
        setProgress(10); // Start progress
        setErrorMsg(null);

        // Fake progress for UX (since Firebase uploadBytes doesn't give granular progress easily without stream)
        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 90) return 90;
                return prev + Math.random() * 10;
            });
        }, 200);

        try {
            // Perform Upload
            const result = await onUpload(name, file);
            if (!result) {
                throw new Error('Upload completed but no file metadata was returned.');
            }

            clearInterval(progressInterval);
            setProgress(100);
            setStatus('success');
            setErrorMsg(null);

            // Notify Parent
            onChange(name, result);

            // Reset status after a moment to show the "File Card"
            setTimeout(() => {
                setStatus('idle');
            }, 1000);

        } catch (err) {
            clearInterval(progressInterval);
            console.error("Upload failed in component:", err);
            setStatus('error');
            setErrorMsg(err?.message || "Upload failed. Please try again.");
            setProgress(0);
        }
    };

    const handleRetry = () => {
        fileInputRef.current?.click();
    };

    /**
     * Removing an uploaded document used a bare `confirm(...)` — the browser's
     * blocking dialog. On the public driver application that is the worst place for
     * one: it is the most mobile-heavy surface in the product, and a native prompt
     * cannot be styled, announced or dismissed consistently across mobile browsers.
     * It now opens the shared accessible `ConfirmDialog`.
     */
    const requestClear = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPendingClear(true);
    };

    const confirmClear = () => {
        setPendingClear(false);
        onChange(name, null);
        setStatus('idle');
        setProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // The state E2E and assistive tech can both rely on: what the driver's file
    // actually is right now, not which transient animation is playing.
    const uploadState = status === 'uploading'
        ? 'uploading'
        : status === 'error'
            ? 'error'
            : hasValue ? 'uploaded' : 'empty';

    return (
        <div
            className="mb-ds-4 grid gap-ds-2"
            data-upload-field={name}
            data-upload-state={uploadState}
        >
            <span id={labelId} className="ds-label">
                <span>{label}</span>
                {required && (
                    <>
                        <span className="ds-label__required-mark" aria-hidden="true">*</span>
                        <span className="ds-visually-hidden"> required</span>
                    </>
                )}
            </span>

            {/* ERROR STATE */}
            {status === 'error' && (
                <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-ds-2 rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg px-ds-3 py-ds-3"
                >
                    <span className="flex min-w-0 items-center gap-ds-2 text-ds-sm font-medium text-ds-status-danger-fg">
                        <AlertCircle size={18} aria-hidden="true" className="shrink-0" />
                        <span className="[overflow-wrap:anywhere]">{errorMsg}</span>
                    </span>
                    <Button variant="secondary" size="md" onClick={handleRetry}>
                        <RefreshCw size={12} aria-hidden="true" /> Retry
                    </Button>
                </div>
            )}

            {/* UPLOADING STATE */}
            {status === 'uploading' && (
                <div className="space-y-ds-2 rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
                    <p className="flex justify-between text-ds-xs font-semibold text-ds-status-info-fg" role="status">
                        <span>Uploading...</span>
                        <span>{Math.round(progress)}%</span>
                    </p>
                    <ProgressBar
                        value={progress}
                        max={100}
                        label={`${label} upload progress`}
                        valueText={`${Math.round(progress)}% uploaded`}
                    />
                </div>
            )}

            {/* SUCCESS / VIEW STATE */}
            {(hasValue && status !== 'uploading' && status !== 'error') && (
                <div className="flex items-center gap-ds-3 rounded-ds-md border border-ds-status-success-border bg-ds-status-success-bg p-ds-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-ds-md bg-ds-surface text-ds-status-success-fg">
                        {isImage && fileUrl ? (
                            <img src={fileUrl} alt={`${label} preview`} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                            <FileText size={20} aria-hidden="true" />
                        )}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-ds-sm font-medium text-ds-content">
                            {fileName}
                        </p>
                        {/* Announced when the upload lands, so a screen-reader user is
                            told the file was accepted instead of having to re-read. */}
                        <p role="status" className="flex items-center gap-ds-1 text-ds-xs text-ds-status-success-fg">
                            <CheckCircle size={12} aria-hidden="true" /> Uploaded Successfully
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-ds-1">
                        {fileUrl && (
                            <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-ds-md text-ds-content-muted hover:text-ds-content-link focus-visible:shadow-ds-focus"
                            >
                                <ImageIcon size={18} aria-hidden="true" />
                                <span className="ds-visually-hidden">View {label} file</span>
                            </a>
                        )}
                        <IconButton
                            variant="ghost"
                            size="md"
                            label={`Remove ${label} file`}
                            onClick={requestClear}
                        >
                            <X size={18} aria-hidden="true" />
                        </IconButton>
                    </div>
                </div>
            )}

            {/* IDLE / EMPTY STATE — keyboard-reachable trigger for the hidden input. */}
            {(!hasValue && status !== 'uploading') && (
                <Button
                    variant="secondary"
                    size="lg"
                    fullWidth
                    className="border-2 border-dashed"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <span className="flex flex-col items-center gap-ds-1 py-ds-4">
                        <span className="flex h-10 w-10 items-center justify-center rounded-ds-md bg-ds-status-info-bg text-ds-status-info-fg">
                            <Upload size={20} aria-hidden="true" />
                        </span>
                        {/* Visible copy is frozen; the field name is added for
                            assistive tech so several upload triggers on one step
                            do not all announce as "Click to upload". */}
                        <span className="text-ds-sm font-medium text-ds-content">
                            Click to upload<span className="ds-visually-hidden"> {label}</span>
                        </span>
                        <span className="text-ds-xs font-normal text-ds-content-muted">
                            {accept.includes('image') ? 'PDF, PNG, JPG accepted' : 'Files accepted'}
                        </span>
                    </span>
                </Button>
            )}

            <input
                ref={fileInputRef}
                type="file"
                name={name}
                tabIndex={-1}
                aria-labelledby={labelId}
                className="ds-visually-hidden"
                accept={accept}
                required={required && !hasValue}
                onChange={handleFileSelect}
            />

            {/* Replaces the bare `confirm("Are you sure you want to remove this file?")`. */}
            <ConfirmDialog
                isOpen={pendingClear}
                tone="warning"
                title="Remove this file?"
                description={`"${label}" will be removed and you will need to upload it again.`}
                confirmLabel="Remove file"
                cancelLabel="Keep file"
                onConfirm={confirmClear}
                onCancel={() => setPendingClear(false)}
            />
        </div>
    );
};

export default UploadField;
