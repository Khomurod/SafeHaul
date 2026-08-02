import React, { useRef, useState } from 'react';
import { FileText, Eye, Download, X } from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';
import { Modal } from '@shared/components/modals/Modal';
import { Card, IconButton } from '@/design-system/components';

/**
 * Dossier document gallery: the applicant's uploaded documents with preview and
 * download.
 *
 * Presentation migrated to the approved `Card` / `IconButton` primitives and
 * `--ds-*` tokens (2026-07-27).
 *
 * Frozen contracts: the eight standard document keys and their labels in this
 * exact order; the URL resolution precedence
 * (`fileUrls[key]` → `appData[key].url` → `appData.uploadedDocuments[key]`);
 * the rule that a document only appears once a URL resolves; the
 * `appData.updatedAt` document date with its `Unknown Date` fallback; the
 * `No documents found for this applicant.` empty copy; and the download link's
 * `download` attribute and `target`/`rel` pair.
 *
 * DEFECTS FIXED (2026-07-27):
 * - Each document card was a `<div onClick>`: not focusable, not activatable by
 *   keyboard, no role and no accessible name. The whole gallery was
 *   mouse-only. Cards are now real buttons that name the document they open.
 * - The preview lightbox was a hand-rolled overlay with **no `role="dialog"`, no
 *   focus containment, no focus restoration and no Escape**, layered on top of a
 *   modal dialog. It now uses the shared accessible `Modal`.
 * - The document date used `text-[10px]`, below the 12 px interface floor.
 * - The close and download controls in the lightbox had no accessible names.
 * - The list was a bare grid of `<div>`s; it is now a real list, so assistive
 *   technology announces how many documents there are.
 */

const STANDARD_DOCUMENTS = [
    ['cdl-front', 'CDL Front'],
    ['cdl-back', 'CDL Back'],
    ['medical-card-upload', 'Medical Card'],
    ['ssc-upload', 'SSN Card'],
    ['twic-card-upload', 'TWIC Card'],
    ['mvr-upload', 'MVR Report'],
    ['mvr-consent-upload', 'MVR Consent'],
    ['drug-test-consent-upload', 'Drug Test Consent'],
];

export function DocumentsTab({ fileUrls = {}, appData }) {
    const [previewDoc, setPreviewDoc] = useState(null);
    const closePreviewRef = useRef(null);

    // Resolution order is a frozen contract: resolved URL, then the appData
    // field's own url, then the uploadedDocuments map.
    const allDocs = STANDARD_DOCUMENTS.reduce((docs, [key, label]) => {
        const resolvedUrl = fileUrls[key];
        const appDirectUrl = appData?.[key]?.url;
        const uploadedUrl = appData?.uploadedDocuments?.[key];
        const url = resolvedUrl || appDirectUrl || uploadedUrl;

        if (url) {
            docs.push({
                id: key,
                label,
                url,
                date: appData?.updatedAt,
                type: 'pdf/image',
            });
        }
        return docs;
    }, []);

    if (allDocs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-ds-12 text-ds-content-secondary">
                <FileText size={48} className="mb-ds-4 text-ds-content-muted" aria-hidden="true" />
                <p>No documents found for this applicant.</p>
            </div>
        );
    }

    return (
        <div className="space-y-ds-6">
            <h4 className="px-ds-1 text-ds-body-lg font-bold text-ds-content">Uploaded Documents</h4>

            <ul className="grid grid-cols-2 gap-ds-4 md:grid-cols-4 lg:grid-cols-5">
                {allDocs.map((doc) => (
                    <li key={doc.id}>
                        <Card padding="none" className="h-full overflow-hidden">
                            {/*
                              One control per document, named after it, so the
                              gallery is operable by keyboard and every entry
                              announces which document it opens.
                            */}
                            <button
                                type="button"
                                onClick={() => setPreviewDoc(doc)}
                                className="group relative flex aspect-[3/4] w-full flex-col text-left focus-visible:outline-none focus-visible:shadow-ds-focus"
                            >
                                <span className="flex flex-1 items-center justify-center bg-ds-surface-subtle p-ds-4">
                                    <FileText
                                        size={40}
                                        aria-hidden="true"
                                        className="text-ds-content-muted transition-colors group-hover:text-ds-action-primary"
                                    />
                                    <span className="ds-visually-hidden">Preview {doc.label}</span>
                                </span>
                                <span className="block border-t border-ds-border-subtle bg-ds-surface p-ds-3">
                                    <span className="block truncate text-ds-xs font-bold text-ds-content" title={doc.label}>
                                        {doc.label}
                                    </span>
                                    <span className="mt-ds-1 block text-ds-xs text-ds-content-secondary">
                                        {doc.date ? formatDate(doc.date) : 'Unknown Date'}
                                    </span>
                                </span>
                                <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                    <span className="rounded-full bg-ds-surface p-ds-2 text-ds-content shadow-ds-md">
                                        <Eye size={16} />
                                    </span>
                                </span>
                            </button>
                        </Card>
                    </li>
                ))}
            </ul>

            {previewDoc && (
                <Modal
                    label={previewDoc.label}
                    onClose={() => setPreviewDoc(null)}
                    initialFocusRef={closePreviewRef}
                    // Above the dossier dialog itself, matching the previous z-[70].
                    overlayClassName="fixed inset-0 z-[70] flex items-center justify-center bg-ds-overlay p-ds-4 backdrop-blur-sm"
                    className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-ds-xl bg-ds-surface shadow-ds-lg"
                >
                    {/*
                      The toolbar sits on the panel's own light surface rather
                      than over the dark backdrop. That keeps the approved ghost
                      `IconButton` legible: its variant owns its colour, and a
                      feature-side `text-*` utility cannot override it (see the
                      note in `Button.css`).
                    */}
                    <div className="flex shrink-0 items-center justify-between gap-ds-3 border-b border-ds-border-subtle px-ds-4 py-ds-3">
                        <h4 className="min-w-0 truncate text-ds-body-lg font-bold text-ds-content">{previewDoc.label}</h4>
                        <div className="flex shrink-0 items-center gap-ds-2">
                            {/*
                              DOCUMENTED EXCEPTION — styled `<a>` rather than an
                              approved control. A download is a navigation, and
                              the design system has no Link/ButtonLink primitive
                              yet (recorded in the roadmap). Tokens only, 44 px
                              target, visible focus ring.
                            */}
                            <a
                                href={previewDoc.url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-ds-md text-ds-content-secondary hover:bg-ds-surface-subtle hover:text-ds-content-link focus-visible:outline-none focus-visible:shadow-ds-focus"
                            >
                                <Download size={24} aria-hidden="true" />
                                <span className="ds-visually-hidden">Download {previewDoc.label}</span>
                            </a>
                            <IconButton
                                ref={closePreviewRef}
                                variant="ghost"
                                label={`Close preview of ${previewDoc.label}`}
                                onClick={() => setPreviewDoc(null)}
                            >
                                <X size={24} aria-hidden="true" />
                            </IconButton>
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ds-surface-subtle">
                        <iframe
                            src={previewDoc.url}
                            className="h-full w-full"
                            title={previewDoc.label}
                        />
                    </div>
                </Modal>
            )}
        </div>
    );
}
