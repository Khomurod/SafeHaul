import React, { useRef, useState } from 'react';
import { Icon, FileText, Eye, Download, X } from '@design-system/icons';
import { formatDate } from '@shared/utils/helpers';
import { EmptyState, Modal } from '@design-system/patterns';
import { Card, IconButton, IconButtonLink } from '@/design-system/components';

/**
 * Dossier document gallery: the applicant's uploaded documents with preview and
 * download.
 *
 * Presentation uses the approved `Card` / `IconButton` primitives and
 * `--ds-*` tokens.
 *
 * Frozen contracts: the eight standard document keys and their labels in this
 * exact order; the URL resolution precedence
 * (`fileUrls[key]` → `appData[key].url` → `appData.uploadedDocuments[key]`);
 * the rule that a document only appears once a URL resolves; the
 * `appData.updatedAt` document date with its `Unknown Date` fallback; the
 * `No documents found for this applicant.` empty copy; and the download link's
 * `download` attribute and `target`/`rel` pair.
 *
 * Rules this gallery keeps:
 * - Each document card is a real button that names the document it opens, so
 *   the gallery works from the keyboard.
 * - The preview lightbox is the approved accessible `Modal` (`role="dialog"`,
 *   focus containment, focus restoration, Escape), because it opens on top of
 *   a modal dialog.
 * - No interface text below the 12 px floor, the document date included.
 * - The close and download controls in the lightbox have accessible names.
 * - The documents are a real list, so assistive technology announces how many
 *   there are.
 * - The empty panel is the approved `EmptyState`, with the frozen copy as the
 *   state's heading.
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

export function DocumentsTab({ fileUrls = {}, filesPending = false, appData }) {
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

    // While the dossier signs its files, a stored link has expired: the gallery
    // waits for the fresh ones rather than list dead links, or nothing.
    if (filesPending) {
        return (
            <p role="status" className="py-ds-12 text-center text-ds-body text-ds-content-secondary">
                Loading documents…
            </p>
        );
    }

    if (allDocs.length === 0) {
        return (
            <EmptyState
                surface="bare"
                icon={FileText}
                headingLevel={3}
                title="No documents found for this applicant."
            />
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
                                    {/* A thumbnail placeholder in an `aspect-[3/4]` card whose
                                        width is fluid, so 40 -> `3xl` (32) rather than a size on
                                        the container: there is no fixed frame to take a ratio from. */}
                                    <Icon
                                        icon={FileText}
                                        size="3xl"
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
                                    <span className="rounded-ds-full bg-ds-surface p-ds-2 text-ds-content shadow-ds-md">
                                        <Icon icon={Eye} />
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
                    /*
                     * No stacking prop, and none is needed: this overlay is a DOM
                     * descendant of the dossier's, which has its own z-index and
                     * therefore its own stacking context — a positioned descendant
                     * with z-index >= 0 paints above its ancestor's content. The
                     * `z-[70]` that used to sit here was never doing anything the
                     * DOM was not already doing.
                     */
                    size="5xl"
                    scroll="body"
                    fill
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
                            <IconButtonLink
                                href={previewDoc.url}
                                download
                                external
                                variant="ghost"
                                label={`Download ${previewDoc.label}`}
                            >
                                <Icon icon={Download} />
                            </IconButtonLink>
                            <IconButton
                                ref={closePreviewRef}
                                variant="ghost"
                                label={`Close preview of ${previewDoc.label}`}
                                onClick={() => setPreviewDoc(null)}
                            >
                                <Icon icon={X} size="2xl" />
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
