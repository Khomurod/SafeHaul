import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ResizableDraggableField } from './ResizableDraggableField';
import { AiSuggestionOverlay } from './AiSuggestionOverlay';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

/**
 * Center column of the envelope creator: the PDF viewer and the draggable field
 * overlay per page.
 *
 * The floating zoom widget that used to sit over the top-right corner of the
 * canvas is gone: `EditorCanvasToolbar` above the canvas now owns paging, zoom,
 * Fit Width, Fit Page, undo/redo and preview, and two controls with the same
 * accessible name in the same view is an ambiguity, not a convenience. The zoom
 * contract itself — the ±48px steps, the clamp, the reset and the Ctrl/⌘+wheel
 * gesture — is unchanged and still owned by the creator.
 *
 * Presentation only. Everything the rest of the creator depends on is frozen:
 * the `workbenchRef` the Ctrl/⌘+wheel listener tests with `el.contains(e.target)`,
 * the canvas click that deselects, `onLoadSuccess({ numPages })`, the
 * `pageRefs` registration,
 * the `data-page-num` attribute, the `Page {n} / {total}` badge text, the
 * `renderAnnotationLayer`/`renderTextLayer` flags, the `pointer-events-none`
 * overlay layer, the `f.page === pageNum` filter and the
 * `pageHeight={dims ? dims.height : 900}` fallback.
 */
export function PdfFieldWorkbench({
    workbenchRef,
    file,
    numPages,
    setNumPages,
    activePage,
    pageRefs,
    pageDimensions,
    onPageLoadSuccess,
    pdfViewportWidth,
    fields,
    selectedFieldId,
    selectedFieldIds = [],
    setSelectedFieldId,
    updateFieldPosition,
    onFieldDragMove,
    dragGuides = null,
    updateFieldSize,
    removeField,
    updateFieldLabel,
    getIcon,
    // AI Field Assistant. Suggestions render in their own layer above the field
    // layer and are never part of `fields` until the reviewer applies them.
    aiSuggestions = [],
    selectedSuggestionId = null,
    onSelectSuggestion,
    onMoveSuggestion,
    onResizeSuggestion,
    onAcceptSuggestion,
    onRejectSuggestion,
}) {
    return (
        <div
            ref={workbenchRef}
            className="relative flex flex-1 justify-center overflow-y-auto bg-ds-canvas p-ds-8 scroll-smooth"
            onClick={() => setSelectedFieldId(null)}
        >
            {file && (
                <Document
                    file={file}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    className="flex flex-col gap-ds-8 pb-16"
                >
                    {numPages > 0 && Array.from(new Array(numPages), (el, index) => {
                        const pageNum = index + 1;
                        const dims = pageDimensions[pageNum];

                        return (
                            <div
                                key={pageNum}
                                ref={(el) => (pageRefs.current[pageNum] = el)}
                                data-page-num={pageNum}
                                className={`relative inline-block border-2 bg-ds-surface shadow-ds-lg ${
                                    activePage === pageNum ? 'border-ds-action-primary' : 'border-ds-border'
                                }`}
                            >
                                {/* FEAT-1: Page label badge */}
                                <div
                                    className={`absolute left-2 top-2 z-20 rounded-ds-md px-2 py-1 text-ds-xs font-bold ${
                                        activePage === pageNum
                                            ? 'bg-ds-action-primary text-ds-content-inverse'
                                            : 'bg-ds-status-neutral-bg text-ds-status-neutral-fg'
                                    }`}
                                >
                                    Page {pageNum} / {numPages}
                                </div>
                                <Page
                                    pageNumber={pageNum}
                                    width={pdfViewportWidth}
                                    onLoadSuccess={onPageLoadSuccess}
                                    renderAnnotationLayer={false}
                                    renderTextLayer={false}
                                />
                                <div className="absolute inset-0 z-10 pointer-events-none">
                                    {fields.filter(f => f.page === pageNum).map((field) => (
                                        <ResizableDraggableField
                                            key={field.id}
                                            field={field}
                                            pageNum={pageNum}
                                            pageWidth={pdfViewportWidth}
                                            pageHeight={dims ? dims.height : 900}
                                            onStop={updateFieldPosition}
                                            onDragMove={onFieldDragMove}
                                            onResize={updateFieldSize}
                                            onRemove={removeField}
                                            getIcon={getIcon}
                                            onLabelChange={updateFieldLabel}
                                            isSelected={selectedFieldId === field.id}
                                            isMultiSelected={
                                                selectedFieldId !== field.id && selectedFieldIds.includes(field.id)
                                            }
                                            onSelect={setSelectedFieldId}
                                        />
                                    ))}
                                </div>
                                {/* Alignment guides for the field being dragged.
                                    Decorative: what they mean is the snapped
                                    position itself, which is announced by the
                                    field's own accessible name. */}
                                {dragGuides?.page === pageNum && dragGuides.guides.length > 0 && (
                                    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden="true">
                                        {dragGuides.guides.map((guide) => (
                                            guide.axis === 'x' ? (
                                                <span
                                                    key={`x-${guide.at}`}
                                                    className="absolute inset-y-0 w-px bg-ds-action-primary"
                                                    style={{ left: `${guide.at}%` }}
                                                />
                                            ) : (
                                                <span
                                                    key={`y-${guide.at}`}
                                                    className="absolute inset-x-0 h-px bg-ds-action-primary"
                                                    style={{ top: `${guide.at}%` }}
                                                />
                                            )
                                        ))}
                                    </div>
                                )}
                                {aiSuggestions.length > 0 && (
                                    <div
                                        className="absolute inset-0 z-20 pointer-events-none"
                                        aria-label={`AI field suggestions on page ${pageNum}`}
                                        role="group"
                                    >
                                        {aiSuggestions
                                            .filter((suggestion) => suggestion.page === pageNum)
                                            .map((suggestion) => (
                                                <AiSuggestionOverlay
                                                    key={suggestion.suggestionId}
                                                    suggestion={suggestion}
                                                    pageNum={pageNum}
                                                    pageWidth={pdfViewportWidth}
                                                    pageHeight={dims ? dims.height : 900}
                                                    isSelected={selectedSuggestionId === suggestion.suggestionId}
                                                    onSelect={onSelectSuggestion}
                                                    onMove={onMoveSuggestion}
                                                    onResize={onResizeSuggestion}
                                                    onAccept={onAcceptSuggestion}
                                                    onReject={onRejectSuggestion}
                                                />
                                            ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </Document>
            )}
        </div>
    );
}

export default PdfFieldWorkbench;
