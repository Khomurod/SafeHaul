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
import { Modal } from '@shared/components/modals/Modal';
import { Button, IconButton } from '@/design-system/components';

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
 * immutable document content, not themeable app chrome, and two export paths
 * depend on its literal styling:
 *   1. `handleDownloadPDF` rasterises it with html2canvas, so every colour is
 *      resolved from computed style at capture time.
 *   2. `handlePrint` clones it into a bare `window.open` document. That window
 *      is built from scratch, so nothing in it can be assumed — see the print
 *      pipeline note below for what is copied into it and what is not.
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
                overlayClassName="fixed inset-0 z-[80] flex items-center justify-center bg-ds-overlay p-ds-4 backdrop-blur-md"
                className="w-full max-w-md overflow-hidden rounded-ds-xl bg-ds-surface shadow-ds-lg"
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
            overlayClassName="fixed inset-0 z-[80] flex items-stretch justify-center bg-ds-overlay p-0 backdrop-blur-md sm:items-center sm:p-ds-4"
            className="flex h-full w-full flex-col overflow-hidden bg-ds-surface-subtle shadow-ds-lg sm:h-auto sm:max-h-[95vh] sm:max-w-4xl sm:rounded-ds-xl"
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
                    <div ref={documentRef} data-testid="voe-document" className="bg-white border border-gray-300 shadow-xl p-12 max-w-3xl mx-auto min-h-[1000px] font-serif text-slate-900 leading-relaxed">

                        {/* Official Document Header */}
                        <div className="flex justify-between items-start mb-12 border-b-2 border-slate-900 pb-8">
                            <div className="text-left">
                                <h1 className="text-2xl font-black uppercase tracking-tighter mb-1">SAFEHAUL</h1>
                                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Compliance & Verification Services</p>
                                <p className="text-[10px] text-slate-400 mt-2 font-sans italic">Generated on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
                            </div>
                            <div className="text-right">
                                <h2 className="text-xl font-bold uppercase tracking-widest border-2 border-slate-900 px-4 py-2">VOE-391.23</h2>
                            </div>
                        </div>

                        {/* Title Section */}
                        <div className="text-center mb-10">
                            <h3 className="text-xl font-bold uppercase underline decoration-2 underline-offset-8">Request for Verification of Employment</h3>
                            <p className="text-xs font-bold mt-4 text-slate-600 font-sans px-8 py-2 bg-slate-50 border border-slate-100 rounded">
                                This request is made pursuant to the Federal Motor Carrier Safety Regulations (FMCSR) 49 CFR Part 391.23.
                                This regulation requires prospective employers to investigate a driver's background through the driver's previous employers.
                            </p>
                        </div>

                        {/* Section 1: Parties */}
                        <div className="grid grid-cols-2 gap-12 mb-10 font-sans">
                            <div>
                                <h4 className="text-[10px] font-black uppercase text-blue-600 border-b-2 border-blue-500 mb-3 tracking-widest">To (Previous Employer)</h4>
                                <div className="text-sm font-bold uppercase space-y-1">
                                    <p className="text-lg">{getFieldValue(employer.companyName || employer.name)}</p>
                                    <p className="text-slate-600 font-medium">{getFieldValue(employer.city)}, {getFieldValue(employer.state)}</p>
                                    {employer.email && <p className="text-blue-600 normal-case">{employer.email}</p>}
                                    {employer.phone && <p className="text-slate-500">{employer.phone}</p>}
                                </div>
                            </div>
                            <div>
                                <h4 className="text-[10px] font-black uppercase text-slate-500 border-b-2 border-slate-400 mb-3 tracking-widest">From (Prospective Employer)</h4>
                                <div className="text-sm font-bold uppercase space-y-1">
                                    <p className="text-lg">{companyName}</p>
                                    <p className="text-slate-600 font-medium">SafeHaul Network Member</p>
                                    <p className="text-slate-500 normal-case italic opacity-50">Verified Business Entity</p>
                                </div>
                            </div>
                        </div>

                        {/* Section 2: Subject */}
                        <div className="mb-10 font-sans bg-slate-50 p-6 border border-slate-200">
                            <h4 className="text-[10px] font-black uppercase text-slate-700 mb-4 tracking-widest">Subject Applicant Information</h4>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm font-bold">
                                <div className="border-b border-slate-200 pb-1">
                                    <span className="text-[10px] uppercase text-slate-400 block mb-0.5">Full Name</span>
                                    {getFieldValue(applicant.firstName)} {getFieldValue(applicant.lastName)}
                                </div>
                                <div className="border-b border-slate-200 pb-1">
                                    <span className="text-[10px] uppercase text-slate-400 block mb-0.5">Social Security Number</span>
                                    {applicant.ssn ? `***-**-${applicant.ssn.slice(-4)}` : 'REDACTED (ON FILE)'}
                                </div>
                                <div className="border-b border-slate-200 pb-1">
                                    <span className="text-[10px] uppercase text-slate-400 block mb-0.5">Date of Birth</span>
                                    {applicant.dob || 'NOT DISCLOSED'}
                                </div>
                                <div className="border-b border-slate-200 pb-1">
                                    <span className="text-[10px] uppercase text-slate-400 block mb-0.5">Reported Service Dates</span>
                                    {getFieldValue(employer.startDate)} to {getFieldValue(employer.endDate)}
                                </div>
                            </div>
                        </div>

                        {/* Section 3: Authorization (Signature Box) */}
                        <div className="mb-12 border-2 border-slate-900 p-8 relative overflow-hidden bg-slate-50/30">
                            {/* Watermark */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none rotate-12 -z-10">
                                <ShieldCheck size={400} />
                            </div>

                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-blue-600 text-white rounded-lg">
                                    <ShieldCheck size={20} />
                                </div>
                                <h4 className="text-xl font-bold uppercase underline decoration-blue-600 decoration-4 underline-offset-4">Legal Release & Authorization</h4>
                            </div>

                            <p className="text-[13px] text-justify mb-10 leading-relaxed text-slate-800 font-medium border-l-4 border-blue-500 pl-6 py-2">
                                I, the undersigned applicant, hereby provide specific written consent and authorize the release of all information requested by SafeHaul HR Verification Services on behalf of the prospective employer. In accordance with <span className="font-bold">49 CFR §391.23</span> and <span className="font-bold">§40.321</span>, this includes, but is not limited to: my complete employment history, safety performance history, accident records, and all results of drug and alcohol testing (including any refusals to test or violations of Part 382). I release all previous employers and their agents from any and all liability which may result from furnishing such information in good faith.
                            </p>

                            <div className="flex justify-between items-end gap-12 font-sans">
                                <div className="flex-1">
                                    <p className="text-[10px] font-black text-slate-500 uppercase mb-3 tracking-widest">Digital Signature of Applicant</p>
                                    <div className={`h-24 border-b-2 flex items-center justify-center pb-2 px-6 ${signatureUrl || signatureText ? 'border-slate-900' : 'border-red-400 bg-red-50'}`}>
                                        {signatureUrl ? (
                                            <img src={signatureUrl} alt="Signature" className="h-20 object-contain" />
                                        ) : signatureText ? (
                                            <span className="font-serif italic text-4xl text-slate-900">/s/ {signatureText}</span>
                                        ) : (
                                            <div className="text-center">
                                                <AlertCircle size={24} className="mx-auto text-red-500 mb-2" />
                                                <span className="text-red-500 text-xs font-bold block uppercase tracking-tighter">DRIVER SIGNATURE MISSING</span>
                                                <span className="text-[10px] text-red-400">Application must be signed before transmission</span>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-3 uppercase tracking-tighter">Attested to under penalty of perjury &bull; IP: {applicant.ipAddress || 'Verified'}</p>
                                </div>
                                <div className="w-56">
                                    <p className="text-[10px] font-black text-slate-500 uppercase mb-3 tracking-widest text-right">Date of Authorization</p>
                                    <div className="h-24 border-b-2 border-slate-900 flex items-center justify-end pb-2">
                                        <div className="text-right">
                                            <span className="text-2xl font-bold text-slate-900">{applicant['signature-date'] || new Date().toLocaleDateString()}</span>
                                            <p className="text-[10px] text-slate-400 mt-1 uppercase">Valid for 30 Days</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Questionnaire Section */}
                        <div className="opacity-80 pointer-events-none grayscale border-t-2 border-dashed border-slate-300 pt-8 mt-12 bg-slate-50/20 p-8 rounded-xl">
                            <h4 className="text-[11px] font-black uppercase text-slate-800 mb-8 tracking-widest text-center border-b border-slate-200 pb-2">Employment History Questionnaire (To be completed by Recipient)</h4>

                            <div className="space-y-8 font-sans">
                                {/* Row 1: Basic Verification */}
                                <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                        <span className="text-xs font-bold text-slate-700">Did this person work for you?</span>
                                        <div className="flex gap-4">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                <span className="text-[10px] font-bold text-slate-400">YES</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                <span className="text-[10px] font-bold text-slate-400">NO</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col border-b border-slate-200 pb-2">
                                        <div className="flex justify-between items-center w-full">
                                            <span className="text-xs font-bold text-slate-700">Dates of employment correct?</span>
                                            <div className="flex gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">YES</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">NO</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex items-end gap-2">
                                            <span className="text-[9px] uppercase text-slate-400 font-bold whitespace-nowrap">If no, explain:</span>
                                            <div className="flex-1 border-b border-slate-300 h-4"></div>
                                        </div>
                                    </div>

                                    <div className="col-span-1 flex flex-col border-b border-slate-200 pb-2">
                                        <span className="text-xs font-bold text-slate-700">Type of equipment operated:</span>
                                        <div className="mt-2 flex-1 border-b border-slate-300 h-5"></div>
                                    </div>

                                    <div className="flex flex-col border-b border-slate-200 pb-2">
                                        <div className="flex justify-between items-center w-full">
                                            <span className="text-xs font-bold text-slate-700">Eligible for re-hire?</span>
                                            <div className="flex gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">YES</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">NO</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex items-end gap-2">
                                            <span className="text-[9px] uppercase text-slate-400 font-bold whitespace-nowrap">If no, explain:</span>
                                            <div className="flex-1 border-b border-slate-300 h-4"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Row 2: Accident History */}
                                <div className="pt-4 border-t border-slate-200">
                                    <h5 className="text-[10px] font-black uppercase text-slate-500 mb-4 tracking-widest">Safety Performance (Accidents)</h5>
                                    <div className="flex flex-col border-b border-slate-200 pb-3">
                                        <div className="flex justify-between items-center w-full">
                                            <span className="text-xs font-bold text-slate-700">Did the driver have any DOT-recordable accidents?</span>
                                            <div className="flex gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">YES</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                    <span className="text-[10px] font-bold text-slate-400">NO</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex items-end gap-2">
                                            <span className="text-[9px] uppercase text-slate-400 font-bold whitespace-nowrap">If yes, please provide dates and details:</span>
                                            <div className="flex-1 border-b border-slate-300 h-4"></div>
                                        </div>
                                        <div className="mt-4 border-b border-slate-300 h-4"></div>
                                    </div>
                                </div>

                                {/* Row 3: Drug & Alcohol */}
                                <div className="pt-4 border-t border-slate-200">
                                    <h5 className="text-[10px] font-black uppercase text-slate-500 mb-4 tracking-widest">Drug & Alcohol Compliance (Part 40)</h5>
                                    <div className="grid grid-cols-1 gap-6">
                                        {[
                                            "Did the driver refuse to take a required drug or alcohol test?",
                                            "Did the driver have any other drug/alcohol regulation violations?",
                                            "Did the driver test positive for a controlled substance?"
                                        ].map((q, idx) => (
                                            <div key={idx} className="flex flex-col border-b border-slate-100 pb-3">
                                                <div className="flex justify-between items-center w-full">
                                                    <span className="text-xs font-bold text-slate-700">{q}</span>
                                                    <div className="flex gap-4">
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                            <span className="text-[10px] font-bold text-slate-400">YES</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-4 h-4 border border-slate-400 rounded-sm"></div>
                                                            <span className="text-[10px] font-bold text-slate-400">NO</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex items-end gap-2">
                                                    <span className="text-[9px] uppercase text-slate-400 font-bold whitespace-nowrap">If yes, explain:</span>
                                                    <div className="flex-1 border-b border-slate-300 h-4"></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Compliance Footer */}
                        <div className="mt-20 border-t border-slate-200 pt-4 text-center">
                            <p className="text-[8px] text-slate-400 font-sans uppercase tracking-[0.2em]">
                                Protected by SafeHaul Encryption Services &bull; Secure Audit ID: {auditId}
                            </p>
                        </div>

                    </div>
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
                <Button variant="secondary" size="lg" onClick={onClose}>
                    Edit Request
                </Button>
                <Button
                    variant="primary"
                    size="lg"
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

