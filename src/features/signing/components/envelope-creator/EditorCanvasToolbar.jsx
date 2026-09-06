import React, { useId } from 'react';
import { Icon, ChevronLeft, ChevronRight, Eye, Maximize2, MoveHorizontal, Redo2, Undo2, ZoomIn, ZoomOut } from '@design-system/icons';
import { Button, IconButton } from '@/design-system/components';
import {
    PDF_VIEWPORT_WIDTH_DEFAULT,
    clampPdfViewportWidth,
    zoomPercentLabel,
} from '@features/signing/utils/envelopePdfZoom';

/**
 * Canvas toolbar: paging, zoom, fit, undo/redo and preview.
 *
 * The ±48 px zoom steps, the `clampPdfViewportWidth` bounds, the
 * `PDF_VIEWPORT_WIDTH_DEFAULT` reset and `zoomPercentLabel` are the existing
 * zoom contract, reused unchanged — and Ctrl/⌘+scroll still belongs to the
 * workbench, so this toolbar adds controls rather than replacing the gesture.
 *
 * Everything wraps: at 412 px the row becomes two or three lines instead of
 * overflowing the document.
 */
export function EditorCanvasToolbar({
    activePage = 1,
    numPages = 0,
    onPreviousPage,
    onNextPage,
    pdfViewportWidth = PDF_VIEWPORT_WIDTH_DEFAULT,
    setPdfViewportWidth,
    onFitWidth,
    onFitPage,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
    onPreview,
    previewDisabled = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const zoomLabelId = `canvas-zoom-label-${rawId}`;
    const zoomPercent = zoomPercentLabel(pdfViewportWidth);
    const total = Math.max(0, Number(numPages) || 0);

    return (
        <div
            role="toolbar"
            aria-label="Document canvas tools"
            aria-orientation="horizontal"
            className="flex flex-wrap items-center justify-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface px-ds-3 py-ds-2"
            // The toolbar's own clicks must not deselect the current field.
            onClick={(event) => event.stopPropagation()}
        >
            {/* Paging */}
            <div className="flex items-center gap-ds-1">
                <IconButton
                    label="Previous page"
                    variant="ghost"
                    size="sm"
                    disabled={activePage <= 1}
                    onClick={onPreviousPage}
                >
                    <Icon icon={ChevronLeft} />
                </IconButton>
                <span className="min-w-[5.5rem] text-center text-ds-sm font-medium text-ds-content">
                    Page {activePage} / {total || 1}
                </span>
                <IconButton
                    label="Next page"
                    variant="ghost"
                    size="sm"
                    disabled={total === 0 || activePage >= total}
                    onClick={onNextPage}
                >
                    <Icon icon={ChevronRight} />
                </IconButton>
            </div>

            <span aria-hidden="true" className="hidden h-5 w-px bg-ds-border-subtle sm:block" />

            {/* Zoom */}
            <div role="group" aria-labelledby={zoomLabelId} className="flex items-center gap-ds-1">
                <span id={zoomLabelId} className="ds-visually-hidden">PDF zoom</span>
                <IconButton
                    label="Zoom out"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPdfViewportWidth((width) => clampPdfViewportWidth(width - 48))}
                >
                    <Icon icon={ZoomOut} />
                </IconButton>
                <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Reset zoom to 100 percent, currently ${zoomPercent} percent`}
                    className="min-w-[3.5rem] font-mono"
                    onClick={() => setPdfViewportWidth(PDF_VIEWPORT_WIDTH_DEFAULT)}
                >
                    {zoomPercent}%
                </Button>
                <IconButton
                    label="Zoom in"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPdfViewportWidth((width) => clampPdfViewportWidth(width + 48))}
                >
                    <Icon icon={ZoomIn} />
                </IconButton>
            </div>

            {/* Fit */}
            <div className="flex items-center gap-ds-1">
                <Button variant="ghost" size="sm" onClick={onFitWidth}>
                    <Icon icon={MoveHorizontal} size="sm" /> Fit Width
                </Button>
                <Button variant="ghost" size="sm" onClick={onFitPage}>
                    <Icon icon={Maximize2} size="sm" /> Fit Page
                </Button>
            </div>

            <span aria-hidden="true" className="hidden h-5 w-px bg-ds-border-subtle sm:block" />

            {/* History + preview. Duplicated from the top bar on purpose: at the
                canvas is where they are needed, and the top bar collapses on
                narrow screens. */}
            <div className="flex items-center gap-ds-1">
                <IconButton label="Undo" variant="ghost" size="sm" disabled={!canUndo} onClick={onUndo}>
                    <Icon icon={Undo2} />
                </IconButton>
                <IconButton label="Redo" variant="ghost" size="sm" disabled={!canRedo} onClick={onRedo}>
                    <Icon icon={Redo2} />
                </IconButton>
                <IconButton
                    label="Preview as signer"
                    variant="ghost"
                    size="sm"
                    disabled={previewDisabled}
                    onClick={onPreview}
                >
                    <Icon icon={Eye} />
                </IconButton>
            </div>

            <span role="status" className="ds-visually-hidden">
                {`Page ${activePage} of ${total || 1}. Zoom ${zoomPercent} percent.`}
            </span>

            <span className="ml-1 hidden text-ds-xs text-ds-content-secondary lg:inline">
                Ctrl/⌘ + scroll to zoom
            </span>
        </div>
    );
}

export default EditorCanvasToolbar;
