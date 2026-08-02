import React, { useEffect, useId, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { Check, Scaling, Sparkles, X } from 'lucide-react';

/**
 * One AI suggestion drawn over the PDF.
 *
 * Deliberately a *different* visual language from a placed field: a dashed
 * accent outline plus an "AI" badge, so a reviewer can never mistake a proposal
 * for something already on the document. Suggestions live in their own layer
 * and never touch the `fields` array until they are accepted.
 *
 * Geometry is percentage-based in both directions, exactly like
 * `ResizableDraggableField`, which is why a suggestion stays put when the
 * editor zoom changes.
 */
export function AiSuggestionOverlay({
    suggestion,
    pageNum,
    pageWidth,
    pageHeight,
    isSelected,
    onSelect,
    onMove,
    onResize,
    onAccept,
    onReject,
}) {
    const nodeRef = useRef(null);
    const hintId = `ai-suggestion-hint-${useId().replace(/:/g, '')}`;
    const safePageHeight = pageHeight || 800;

    const wPx = (suggestion.width / 100) * pageWidth;
    const hPx = (suggestion.height / 100) * safePageHeight;
    const xPx = (suggestion.x / 100) * pageWidth;
    const yPx = (suggestion.y / 100) * safePageHeight;

    const [size, setSize] = useState({ width: wPx, height: hPx });
    const sizeRef = useRef({ width: wPx, height: hPx });

    useEffect(() => {
        const next = { width: wPx, height: hPx };
        setSize(next);
        sizeRef.current = next;
    }, [wPx, hPx]);

    const handleResizeMouseDown = (event) => {
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = sizeRef.current.width;
        const startHeight = sizeRef.current.height;

        const doDrag = (dragEvent) => {
            const next = {
                width: Math.max(8, startWidth + dragEvent.clientX - startX),
                height: Math.max(8, startHeight + dragEvent.clientY - startY),
            };
            sizeRef.current = next;
            setSize(next);
        };

        const stopDrag = () => {
            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
            const { width, height } = sizeRef.current;
            onResize(suggestion.suggestionId, (width / pageWidth) * 100, (height / safePageHeight) * 100);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    };

    const handleKeyDown = (event) => {
        const step = event.shiftKey ? 5 : 1;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else return;

        event.preventDefault();
        event.stopPropagation();

        if (event.altKey) {
            onResize(
                suggestion.suggestionId,
                Math.min(100 - suggestion.x, Math.max(1, suggestion.width + dx)),
                Math.min(100 - suggestion.y, Math.max(1, suggestion.height + dy)),
            );
            return;
        }

        onMove(
            suggestion.suggestionId,
            Math.min(100 - suggestion.width, Math.max(0, suggestion.x + dx)),
            Math.min(100 - suggestion.height, Math.max(0, suggestion.y + dy)),
        );
    };

    const confidencePercent = Math.round(suggestion.confidence * 100);
    const accepted = suggestion.status === 'accepted';

    return (
        <Draggable
            nodeRef={nodeRef}
            bounds="parent"
            position={{ x: xPx, y: yPx }}
            onStop={(event, data) =>
                onMove(suggestion.suggestionId, (data.x / pageWidth) * 100, (data.y / safePageHeight) * 100)
            }
            cancel=".ai-suggestion-action, .resize-handle"
        >
            <div
                ref={nodeRef}
                tabIndex={0}
                role="group"
                aria-label={`AI suggestion: ${suggestion.label}, ${suggestion.type} field on page ${pageNum}, ${confidencePercent} percent confidence${accepted ? ', accepted' : ''}`}
                aria-describedby={hintId}
                onFocus={() => onSelect(suggestion.suggestionId)}
                onKeyDown={handleKeyDown}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect(suggestion.suggestionId);
                }}
                data-ai-suggestion={suggestion.suggestionId}
                className={`group pointer-events-auto absolute z-40 flex cursor-move flex-col rounded-ds-sm border-2 border-dashed shadow-ds-sm transition focus-visible:outline-none focus-visible:shadow-ds-focus
                    ${accepted
                        ? 'border-ds-status-success-border bg-ds-status-success-bg'
                        : 'border-ds-status-accent-border bg-ds-status-accent-bg'}
                    ${isSelected ? 'ring-2 ring-ds-focus ring-offset-1' : ''}`}
                style={{ width: size.width, height: size.height }}
            >
                <div className="flex shrink-0 items-center gap-ds-1 overflow-hidden px-ds-1 py-0.5">
                    <span aria-hidden="true" className="shrink-0 text-ds-status-accent-fg">
                        {accepted ? <Check size={11} /> : <Sparkles size={11} />}
                    </span>
                    {size.width > 56 && (
                        <span className="truncate text-ds-xs font-bold uppercase text-ds-content">
                            {suggestion.label}
                        </span>
                    )}
                </div>

                <span id={hintId} className="ds-visually-hidden">
                    Arrow keys move this suggestion by one percent, Shift by five, and Alt with an arrow
                    key resizes it. This suggestion is not part of the document until you apply it.
                </span>

                {/* DOCUMENTED EXCEPTION — the two corner controls are not the approved
                    IconButton, for the same reason ResizableDraggableField's remove
                    control is not: they are ~14px badges pinned to a box whose minimum
                    size is 8px, and the approved primitive's min-height would overflow
                    it. Both keep an accessible name, a focus-visible ring and `--ds-*`
                    tokens. Recorded in the roadmap alongside the existing exception. */}
                <button
                    type="button"
                    className="ai-suggestion-action absolute -right-2 -top-2 z-50 rounded-full bg-ds-action-danger p-0.5 text-ds-content-inverse shadow-ds-sm focus-visible:outline-none focus-visible:shadow-ds-focus"
                    aria-label={`Reject AI suggestion ${suggestion.label} on page ${pageNum}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onReject(suggestion.suggestionId);
                    }}
                >
                    <X size={10} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="ai-suggestion-action absolute -left-2 -top-2 z-50 rounded-full bg-ds-action-primary p-0.5 text-ds-content-inverse shadow-ds-sm focus-visible:outline-none focus-visible:shadow-ds-focus"
                    aria-label={`${accepted ? 'Unselect' : 'Select'} AI suggestion ${suggestion.label} on page ${pageNum}`}
                    aria-pressed={accepted}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onAccept(suggestion.suggestionId);
                    }}
                >
                    <Check size={10} aria-hidden="true" />
                </button>

                <div
                    className="resize-handle absolute bottom-0 right-0 flex h-3 w-3 cursor-se-resize items-end justify-end p-0.5 opacity-60 transition group-hover:opacity-100"
                    onMouseDown={handleResizeMouseDown}
                    aria-hidden="true"
                >
                    <Scaling size={10} className="text-ds-content-secondary" />
                </div>
            </div>
        </Draggable>
    );
}

export default AiSuggestionOverlay;
