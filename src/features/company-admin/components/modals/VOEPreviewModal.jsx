import React, { useRef, useState, useMemo, useId } from 'react';
import { X, Mail, Printer, ShieldCheck, Download, AlertCircle } from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';
import { useData } from '@/context/DataContext';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    PRINT_DOCUMENT_STYLES,
    collectPrintStyles,
    scrubTrustedPrintTree,
    waitForPrintDocumentReady,
} from '@shared/utils/printDocument';
import { Modal } from '@design-system/patterns';
import { Button, IconButton } from '@/design-system/components';
import { VOEDocument } from './VOEDocument';

/**
 * VOE preview: the generated 49 CFR §391.23 verification request, with print,
 * PDF export and transmission.
 *
 * ── SCOPE OF THE 2026-07-27 MIGRATION ────────────────────────────────────────
 * Only the **app chrome** is migrated — the dialog shell, header,
 * recipient/applicant summary, the Print / Download PDF / Edit Request /
 * Transmit actions, and the loading, export-failure and missing-data states.
 *
 * The **generated document itself is deliberately NOT tokenised.** It is
 * immutable document content, not themeable app chrome: a `--ds-*` role is
 * themeable by design, and this artefact must render the same next year as it
 * does today, because a palette change must not reach a signed regulatory
 * document that has already been exported. Its class list is the capture surface
 * for a rasteriser, so any edit to it changes every exported PDF and every
 * printed page.
 *
 * Note what that reason is NOT, corrected 2026-09-04: it is not that the export
 * paths lack the custom properties. `handleDownloadPDF` rasterises with
 * html2canvas from **computed** style, which resolves `var()` first; and
 * `handlePrint` inlines the application's own stylesheets through
 * `collectPrintStyles`, tokens included. Tokens would resolve. They are withheld
 * because the document must not follow the theme, not because it could not.
 * `VOEPreviewModal.export.test.jsx` enforces this: the document subtree must
 * contain no `ds-*` class and no `var(--ds-…)` value. Do not "finish the
 * migration" by tokenising it without first proving export parity.
 *
 * ── PRINT PIPELINE (rebuilt 2026-07-27) ──────────────────────────────────────
 * See `@shared/utils/printDocument` for the reasoning. In short: the document is
 * **cloned as a DOM tree** into the print window rather than serialised,
 * sanitised as user content and re-parsed; the application's own stylesheets are
 * inlined instead of pulling Tailwind from a CDN; and printing waits for the new
 * document's images, fonts and stylesheets to settle instead of a flat one-second
 * timer.
 *
 * Frozen contracts: every word of the regulatory text and its ordering; all
 * applicant/employer values and their `getFieldValue` / `NOT DISCLOSED` /
 * `REDACTED (ON FILE)` / `[PROSPECTIVE COMPANY]` / `Verified` fallbacks; the SSN
 * last-four masking; the `TEXT_SIGNATURE:` prefix rule and the image/typed/
 * missing signature branches; the audit-ID derivation; the generated
 * date/time; the `{ scale: 2, useCORS: true }` html2canvas options; the jsPDF
 * `portrait` / `px` / `[canvas.width, canvas.height]` construction and
 * `addImage` placement; the `VOE_<employer>_<first>_<last>.pdf` filename with
 * whitespace underscored; the print window's feature string, its title and its
 * 20 px body padding; and the `onClose` / `onSend()` callbacks, including that
 * `onClose` returns to `PEVRequestModal`.
 *
 * DEFECTS FIXED (2026-07-27):
 * - **The dialog was hand-rolled**: no `role="dialog"`, no `aria-modal`, no
 *   focus containment, no focus restoration and no Escape — layered on top of
 *   `PEVRequestModal`, which is itself a dialog inside the driver dossier, which
 *   is a third. Tab walked straight out of all three.
 * - **The close control had no accessible name.**
 * - **Export failure used `window.alert`**, which blocks the thread and is not
 *   announced as part of the dialog. It is now an in-dialog `role="alert"`.
 * - **A blocked pop-up crashed the print action** with a TypeError on
 *   `windowPrint.document`, with nothing shown to the user.
 * - **PDF generation was silent** — an icon swap with no live region.
 * - **Missing data rendered `null`**, so choosing "Continue to Preview" opened
 *   nothing at all with no explanation and no way back.
 * - **The disabled Transmit action never said why** it was disabled; the reason
 *   was only visible inside the document image.
 * - `text-[10px]` chrome text below the 12 px floor.
 */
export function VOEPreviewModal({ employer, applicant, onClose, onSend }) {
    const hasRequiredData = Boolean(employer && applicant);

    const signatureUrl = applicant?.signature && !applicant.signature.startsWith('TEXT_SIGNATURE')
        ? applicant?.signature
        : null;

    const signatureText = applicant?.signature && applicant.signature.startsWith('TEXT_SIGNATURE')
        ? applicant?.signature.replace('TEXT_SIGNATURE:', '')
        : null;

    const documentRef = useRef(null);
    const closeRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isPreparingPrint, setIsPreparingPrint] = useState(false);
    const [exportError, setExportError] = useState('');
    const rawId = useId().replace(/:/g, '');
    const titleId = `voe-preview-title-${rawId}`;
    const transmitHintId = `voe-transmit-hint-${rawId}`;
    const { currentCompanyProfile } = useData();
    const companyName = currentCompanyProfile?.name || currentCompanyProfile?.companyName || '[PROSPECTIVE COMPANY]';

    // Stable audit ID — derived from applicationId so it never changes between renders
    const auditId = useMemo(() => {
        const base = (applicant?.id || applicant?.uid || Date.now().toString());
        return base.slice(-6).toUpperCase() + '-' + Math.abs(base.split('').reduce((a, c) => a + c.charCodeAt(0), 0)).toString(36).toUpperCase().slice(0, 6);
    }, [applicant?.id, applicant?.uid]);

    if (!hasRequiredData) {
        // DEFECT FIX: this returned `null`, so "Continue to Preview" opened
        // nothing — no document, no explanation and no way back to the request.
        return (
            <Modal
                labelledBy={titleId}
                onClose={onClose}
                initialFocusRef={closeRef}
                size="md"
            >
                <div className="p-ds-6" role="alert">
                    <div className="mb-ds-3 flex items-center gap-ds-3">
                        <span aria-hidden="true" className="rounded-ds-md bg-ds-status-danger-bg p-ds-2 text-ds-status-danger-fg">
                            <AlertCircle size={22} />
                        </span>
                        <h4 id={titleId} className="text-ds-body-lg font-bold text-ds-content">
                            Verification document unavailable
                        </h4>
                    </div>
                    <p className="mb-ds-6 text-ds-sm text-ds-content-secondary">
                        This verification request cannot be generated because the employer or applicant
                        details are missing. Go back and reopen the request.
                    </p>
                    <div className="flex justify-end">
                        <Button ref={closeRef} variant="secondary" onClick={onClose}>
                            Edit Request
                        </Button>
                    </div>
                </div>
            </Modal>
        );
    }

    /**
     * Build and print a standalone copy of the generated document.
     *
     * DEFECT FIX (2026-07-27): this used to serialise the document to a string,
     * run it through `sanitizeUserContent` — the strict *user-content* policy —
     * and write the result into the print window. That policy allows no `div`,
     * no `class` and no `img`, so Print emitted a flat, unstyled text dump with
     * the applicant's signature deleted: an unsigned §391.23 release. See
     * `@shared/utils/printDocument` for why trusted structure needs its own
     * policy and why the shared sanitiser must not be loosened to accommodate
     * this call site.
     */
    const handlePrint = async () => {
        const printContent = documentRef.current;
        if (!printContent) return;

        const windowPrint = window.open('', '', 'left=0,top=0,width=800,height=900,toolbar=0,scrollbars=0,status=0');
        // DEFECT FIX: a blocked pop-up returned null and the next line threw a
        // TypeError, with nothing shown to the user.
        if (!windowPrint) {
            setExportError('Could not open the print window. Please allow pop-ups for this site and try again.');
            return;
        }

        setExportError('');
        setIsPreparingPrint(true);
        try {
            const printDocument = windowPrint.document;
            printDocument.write('<!DOCTYPE html><html><head><title>Print VOE</title></head><body></body></html>');
            printDocument.close();

            // The application's own compiled CSS, not a CDN build of it.
            const { cssText, hrefs, readableSheets, unreadableSheets } = collectPrintStyles(document);
            for (const href of hrefs) {
                const link = printDocument.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                printDocument.head.appendChild(link);
            }
            if (cssText) {
                const style = printDocument.createElement('style');
                style.textContent = cssText;
                printDocument.head.appendChild(style);
            }
            const printStyle = printDocument.createElement('style');
            printStyle.textContent = PRINT_DOCUMENT_STYLES;
            printDocument.head.appendChild(printStyle);

            // Clone, then enforce the trusted-document policy on the clone —
            // never on the node that is still on screen.
            const clone = printContent.cloneNode(true);
            scrubTrustedPrintTree(clone);

            const wrapper = printDocument.createElement('div');
            wrapper.setAttribute('style', 'padding: 20px;');
            wrapper.appendChild(printDocument.importNode(clone, true));
            printDocument.body.appendChild(wrapper);
            printDocument.body.setAttribute('data-voe-print-ready', 'true');

            if (readableSheets === 0 && unreadableSheets === 0) {
                // Nothing to style the copy with. Say so rather than printing a
                // silently unstyled legal document.
                setExportError('Could not load the document styles for printing. The printed copy may be unstyled.');
            }

            windowPrint.focus();
            // Condition-based, not a flat timer: wait for the *new* document's
            // stylesheets, signature image and fonts before invoking print.
            await waitForPrintDocumentReady(windowPrint);
            if (windowPrint.closed) return;

            windowPrint.print();
            windowPrint.close();
        } catch (error) {
            console.error('Error preparing the print document:', error);
            setExportError('Failed to prepare the document for printing. Please try again.');
            try {
                windowPrint.close();
            } catch {
                // The window is already gone; nothing further to clean up.
            }
        } finally {
            setIsPreparingPrint(false);
        }
    };

    const handleDownloadPDF = async () => {
        if (!documentRef.current) return;
        setIsDownloading(true);
        setExportError('');
        try {
            const canvas = await html2canvas(documentRef.current, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`VOE_${employer.companyName || 'Employer'}_${applicant.firstName}_${applicant.lastName}.pdf`.replace(/\s+/g, '_'));
        } catch (error) {
            console.error('Error generating PDF:', error);
            // DEFECT FIX: this was `alert()`, which blocks the thread and is not
            // part of the dialog. Same wording, now announced in place.
            setExportError('Failed to generate PDF. Please try again.');
        } finally {
            setIsDownloading(false);
        }
    };

    const canTransmit = Boolean(signatureUrl || signatureText);

    return (
        <Modal
            labelledBy={titleId}
            onClose={onClose}
            initialFocusRef={closeRef}
            size="4xl"
            scroll="body"
            mobile="fullscreen"
        >
            {/*
              Header.

              This was a `bg-slate-900` inverse bar. The token contract has
              `--ds-color-content-inverse` but no inverse *surface*, so an
              inverse header is not expressible in approved tokens and inventing
              one is not a feature's call (gap already recorded in the roadmap by
              the PEV campaign). It follows the same precedent as
              `PEVRequestModal`: the header sits on the panel's own surface,
              which also keeps the ghost `IconButton` legible.
            */}
            <div className="flex shrink-0 items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface px-ds-6 py-ds-4">
                <div className="flex min-w-0 items-center gap-ds-3">
                    <span aria-hidden="true" className="shrink-0 rounded-ds-md bg-ds-status-info-bg p-ds-2 text-ds-status-info-fg">
                        <ShieldCheck size={20} />
                    </span>
                    <div className="min-w-0">
                        {/* `<h4>` under the dossier header's `<h3>` section title. */}
                        <h4 id={titleId} className="text-ds-sm font-bold tracking-tight text-ds-content">Employment Verification Preview</h4>
                        <p className="text-ds-xs font-medium uppercase tracking-widest text-ds-content-secondary">Document Generated by SafeHaul HR Services</p>
                    </div>
                </div>
                <IconButton
                    ref={closeRef}
                    variant="ghost"
                    label="Close verification preview"
                    onClick={onClose}
                >
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            {/* Sub-Header Actions */}
            <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface px-ds-6 py-ds-3">
                <div className="flex flex-wrap items-center justify-between gap-ds-3">
                    <div className="flex min-w-0 flex-wrap gap-ds-4">
                        <p className="flex items-center gap-ds-2 text-ds-xs font-bold text-ds-content-secondary">
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ds-status-success-fg" />
                            <span className="[overflow-wrap:anywhere]">RECIPIENT: {getFieldValue(employer.companyName || employer.name)}</span>
                        </p>
                        <p className="flex items-center gap-ds-2 text-ds-xs font-bold text-ds-content-secondary">
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ds-action-primary" />
                            <span className="[overflow-wrap:anywhere]">APPLICANT: {getFieldValue(applicant.firstName)} {getFieldValue(applicant.lastName)}</span>
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-ds-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handlePrint}
                            disabled={isPreparingPrint}
                        >
                            <Printer size={14} aria-hidden="true" /> Print
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleDownloadPDF}
                            disabled={isDownloading}
                            loading={isDownloading}
                        >
                            {isDownloading ? null : <Download size={14} aria-hidden="true" />}
                            {isDownloading ? 'Generating...' : 'Download PDF'}
                        </Button>
                    </div>
                </div>

                {/* Export progress and failure were both silent before. */}
                <p role="status" className="ds-visually-hidden">
                    {isDownloading ? 'Generating the verification PDF…' : ''}
                    {isPreparingPrint ? 'Preparing the verification document for printing…' : ''}
                </p>
                {exportError && (
                    <p role="alert" className="mt-ds-2 text-ds-xs font-medium text-ds-status-danger-fg">
                        {exportError}
                    </p>
                )}
            </div>

            {/*
              Scrollable Form Content.

              DEFECT FIX: this scroll container was not keyboard-focusable
              (axe `scrollable-region-focusable`, serious). The VOE document is
              far taller than the viewport, so a keyboard user had no way to
              scroll it at all — the only focusable things in the dialog are the
              five chrome actions, none of which are inside the scroller.
            */}
            <div
                role="region"
                aria-label="Verification document preview"
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto bg-ds-surface-subtle p-ds-4 focus-visible:outline-none focus-visible:shadow-ds-focus sm:p-ds-12"
            >
                    <VOEDocument
                        employer={employer}
                        applicant={applicant}
                        companyName={companyName}
                        auditId={auditId}
                        signatureUrl={signatureUrl}
                        signatureText={signatureText}
                        documentRef={documentRef}
                    />
                </div>

            {/* Footer Actions */}
            <div className="flex shrink-0 flex-col items-stretch gap-ds-3 border-t border-ds-border-subtle bg-ds-surface px-ds-6 py-ds-4 sm:flex-row sm:items-center sm:justify-end sm:px-ds-12">
                {/*
                  DEFECT FIX: the Transmit action was disabled with no stated
                  reason — the explanation existed only inside the rendered
                  document. It is now announced with the button itself.
                */}
                {!canTransmit && (
                    <p id={transmitHintId} className="text-ds-xs font-medium text-ds-status-danger-fg sm:mr-auto">
                        This form cannot be transmitted without a valid applicant signature.
                    </p>
                )}
                <Button variant="secondary" onClick={onClose}>
                    Edit Request
                </Button>
                <Button
                    variant="primary"
                    onClick={() => {
                        // Kept as a safety net: the control is disabled without a
                        // signature, so this guard is not reachable from the UI,
                        // but it still refuses to call onSend().
                        if (!canTransmit) return;
                        onSend();
                    }}
                    disabled={!canTransmit}
                    aria-describedby={canTransmit ? undefined : transmitHintId}
                >
                    <Mail size={20} aria-hidden="true" /> Transmit Request Now
                </Button>
            </div>
        </Modal>
    );
}

