import React, { useId, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { Badge, Button, IconButton } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { SignerField } from '@features/signing/components/signing-room/SignerField';
import {
    SAMPLE_RECIPIENT,
    buildSignerPreview,
    previewFieldValues,
    previewFieldsForPage,
} from '@features/signing/utils/signerPreview';

/**
 * "Preview as signer" — a read-only view of the document as the recipient will
 * receive it.
 *
 * It renders the REAL signer field components (`SignerField`, and through it
 * `SignerFieldOverlay` and the shared field styles) over the same PDF, fed by
 * `buildSignerPreview`, which runs the same serializer and prefill engine the
 * send path runs. There is no second implementation of signer behaviour here to
 * drift out of step.
 *
 * SAFETY: this dialog performs no I/O of any kind. No Firestore read or write,
 * no Storage access, no callable, no signing request, no access token, no
 * notification. The field handlers are inert by construction, and the field
 * layer is marked `inert` so nothing in it can be focused or typed into.
 * Because `inert` also removes the layer from the accessibility tree, an
 * equivalent field summary is rendered beside it, so the preview is fully
 * perceivable without sight.
 */
export function SignerPreviewDialog({
    file,
    numPages,
    fields,
    recipientName = '',
    recipientEmail = '',
    recipientPhone = '',
    companyName = '',
    initialPage = 1,
    onClose,
}) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `signer-preview-title-${rawId}`;
    const descriptionId = `signer-preview-description-${rawId}`;
    const summaryHeadingId = `signer-preview-summary-${rawId}`;
    const closeRef = useRef(null);

    const total = Math.max(1, Number(numPages) || 1);
    const [page, setPage] = useState(() => Math.min(Math.max(1, Number(initialPage) || 1), total));

    const preview = useMemo(
        () => buildSignerPreview({ fields, recipientName, recipientEmail, recipientPhone, companyName }),
        [fields, recipientName, recipientEmail, recipientPhone, companyName],
    );

    const values = useMemo(() => previewFieldValues(preview.fields), [preview.fields]);
    const pageFields = useMemo(
        () => previewFieldsForPage(preview.orderedFields, page),
        [preview.orderedFields, page],
    );

    const noop = () => {};
    const noopHandler = () => noop;

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={closeRef}
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <div className="flex flex-wrap items-start justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <div className="min-w-0">
                    <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <Eye size={18} className="text-ds-action-primary" aria-hidden="true" />
                        Preview as signer
                    </h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        Read-only. This is how the document will look to the recipient. Nothing is saved or
                        sent, and no signing link is created.
                    </p>
                </div>
                <IconButton label="Close preview" variant="ghost" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
                {/* Document */}
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center justify-center gap-ds-2 border-b border-ds-border-subtle p-ds-2">
                        <IconButton
                            label="Previous page"
                            variant="ghost"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage((value) => Math.max(1, value - 1))}
                        >
                            <ChevronLeft size={16} aria-hidden="true" />
                        </IconButton>
                        <span className="text-ds-sm font-medium text-ds-content">
                            Page {page} of {total}
                        </span>
                        <IconButton
                            label="Next page"
                            variant="ghost"
                            size="sm"
                            disabled={page >= total}
                            onClick={() => setPage((value) => Math.min(total, value + 1))}
                        >
                            <ChevronRight size={16} aria-hidden="true" />
                        </IconButton>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto bg-ds-canvas p-ds-4">
                        {file ? (
                            <Document file={file} className="flex justify-center">
                                <div className="relative inline-block border border-ds-border bg-ds-surface shadow-ds-md">
                                    <Page
                                        pageNumber={page}
                                        width={560}
                                        renderAnnotationLayer={false}
                                        renderTextLayer={false}
                                    />
                                    {/*
                                      The real signer field layer. `inert` makes the
                                      whole layer non-interactive and removes it from
                                      the accessibility tree — a preview must not be
                                      typeable — so the summary beside it carries the
                                      same information for assistive technology.
                                    */}
                                    <div
                                        inert
                                        data-testid="signer-preview-layer"
                                        // `inset-0` alone: the layer must match the
                                        // page THIS dialog rendered. Sizing it from
                                        // the editor's `pageDimensions` — measured at
                                        // the editor's own zoom — displaced every
                                        // field vertically whenever that zoom was not
                                        // exactly the preview's 560px.
                                        className="absolute inset-0"
                                    >
                                        {pageFields.map((field, index) => (
                                            <SignerField
                                                key={field.id}
                                                field={field}
                                                signed={false}
                                                fieldValues={values}
                                                handleFieldChange={noop}
                                                handleFieldFocus={noop}
                                                handleEnterAdvance={noopHandler}
                                                handleSignatureTap={noop}
                                                fieldPosition={index + 1}
                                                fieldTotal={pageFields.length}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </Document>
                        ) : (
                            <p className="py-ds-12 text-center text-ds-sm text-ds-content-secondary">
                                Upload a PDF to preview it.
                            </p>
                        )}
                    </div>
                </div>

                {/* Field summary — the accessible equivalent of the inert layer. */}
                <aside
                    aria-labelledby={summaryHeadingId}
                    className="min-h-0 shrink-0 overflow-y-auto border-t border-ds-border-subtle p-ds-4 lg:w-80 lg:border-l lg:border-t-0"
                >
                    <Stack gap="sm">
                        <h3 id={summaryHeadingId} className="text-ds-body font-bold text-ds-content">
                            What the recipient sees
                        </h3>

                        {preview.usedSampleRecipient && (
                            <p className="rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-2 text-ds-xs text-ds-content-secondary">
                                No recipient entered yet, so prefilled fields show sample values
                                (“{SAMPLE_RECIPIENT.name}”). The real recipient's details replace them when you send.
                            </p>
                        )}

                        {preview.missingLockedRequired.length > 0 && (
                            <div
                                role="alert"
                                className="rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-2"
                            >
                                <p className="flex items-start gap-ds-1 text-ds-xs text-ds-status-danger-fg">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>
                                        These locked required fields have no value, so the document cannot be sent
                                        yet: {preview.missingLockedRequired.join(', ')}.
                                    </span>
                                </p>
                            </div>
                        )}

                        <p className="text-ds-xs text-ds-content-secondary">
                            {preview.signerCompletes.length === 0
                                ? 'The recipient has nothing left to complete.'
                                : `The recipient must complete ${preview.signerCompletes.length} field${
                                      preview.signerCompletes.length === 1 ? '' : 's'
                                  }.`}
                        </p>

                        {preview.orderedFields.length === 0 ? (
                            <p className="text-ds-sm text-ds-content-secondary">No fields placed yet.</p>
                        ) : (
                            <ol className="flex flex-col gap-ds-2">
                                {preview.orderedFields.map((field) => {
                                    const mustComplete = preview.signerCompletes.some((f) => f.id === field.id);
                                    const value = String(field.defaultValue || '').trim();
                                    return (
                                        <li
                                            key={field.id}
                                            className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-2"
                                        >
                                            <span className="block text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">
                                                {field.label}
                                            </span>
                                            <span className="mt-ds-1 flex flex-wrap items-center gap-ds-1">
                                                <Badge tone="neutral">{field.type}</Badge>
                                                <Badge tone="neutral">Page {field.pageNumber}</Badge>
                                                {field.readOnly && <Badge tone="info">Locked</Badge>}
                                                {mustComplete && <Badge tone="warning">Recipient completes</Badge>}
                                            </span>
                                            {value && (
                                                <span className="mt-ds-1 block text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                                                    Shows: {value}
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </Stack>
                </aside>
            </div>

            <div className="flex justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
                <Button ref={closeRef} variant="primary" onClick={onClose}>
                    Back to editing
                </Button>
            </div>
        </Modal>
    );
}

export default SignerPreviewDialog;
