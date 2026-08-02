import React, { useState, useRef, useEffect, useId } from 'react';
import Draggable from 'react-draggable';
import { X, Scaling } from 'lucide-react';

/**
 * Resizable & draggable field overlay.
 *
 * Presentation only. Every calculation below is frozen: the percentage↔pixel
 * conversions in both directions, the `pageHeight || 800` fallback, the 8 px
 * minimum size floor, the window-level mousemove/mouseup lifecycle, the
 * `bounds="parent"` constraint, the `.resize-handle, .label-input` drag
 * exclusions, the `size.width > 40` label threshold, and the exact
 * `onStop(id, pageNum, x%, y%)` / `onResize(id, w%, h%)` payloads.
 *
 * The two class names `resize-handle` and `label-input` are load-bearing — they
 * are the selectors react-draggable's `cancel` prop matches — so they are kept
 * verbatim alongside the token classes.
 *
 * Field-type tones use the same `--ds-*` status tokens as the sidebar palette,
 * which is what makes the palette a legend for these overlays.
 *
 * APPEARANCE: a placed field is a thin toned border over a translucent fill, so
 * the document underneath stays readable — the fill is a separate `aria-hidden`
 * layer because the tone tokens resolve to opaque hex values that Tailwind's
 * opacity modifiers cannot thin. Selection is the loud state: a primary border,
 * a focus ring, a heavier fill, and the only state that reveals the remove
 * control and the resize handle. A field in a multi-selection takes the primary
 * border without the ring, so the field being edited is never ambiguous.
 */

/**
 * Domain → visual mapping for a placed field. Merged only where the previous
 * hues were adjacent (signature yellow + initial orange → warning), so the four
 * groups stay distinguishable and match the palette buttons one-for-one.
 */
const FIELD_TONE = {
    signature: { fill: 'bg-ds-status-warning-bg', border: 'border-ds-status-warning-border' },
    initial: { fill: 'bg-ds-status-warning-bg', border: 'border-ds-status-warning-border' },
    text: { fill: 'bg-ds-status-info-bg', border: 'border-ds-status-info-border' },
    date: { fill: 'bg-ds-status-success-bg', border: 'border-ds-status-success-border' },
};
const FIELD_TONE_FALLBACK = { fill: 'bg-ds-status-accent-bg', border: 'border-ds-status-accent-border' };

export const ResizableDraggableField = React.memo(({ field, pageNum, pageWidth, pageHeight, onStop, onResize, onRemove, getIcon, onLabelChange, isSelected, isMultiSelected = false, onSelect, onDragMove }) => {
    const nodeRef = useRef(null);
    /**
     * A pointer press focuses the field before the click is dispatched. If the
     * focus handler also selected, a Shift-click would select the field on focus
     * and then toggle it straight back out on click, leaving an empty selection
     * and making the multi-select tools unreachable by pointer. So the click
     * owns pointer selection, and focus only selects when it did not come from a
     * pointer — which is exactly the keyboard case it exists for.
     */
    const pointerFocusRef = useRef(false);
    const hintId = `placed-field-hint-${useId().replace(/:/g, '')}`;
    const safePageHeight = pageHeight || 800;
    const wPx = (field.width / 100) * pageWidth;
    const hPx = (field.height / 100) * safePageHeight;
    const xPx = (field.x / 100) * pageWidth;
    const yPx = (field.y / 100) * safePageHeight;

    const [size, setSize] = useState({ width: wPx, height: hPx });
    const sizeRef = useRef({ width: wPx, height: hPx });

    useEffect(() => {
        const next = { width: wPx, height: hPx };
        setSize(next);
        sizeRef.current = next;
    }, [wPx, hPx]);

    const handleMouseDown = (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = sizeRef.current.width;
        const startHeight = sizeRef.current.height;

        const doDrag = (dragEvent) => {
            const next = {
                // PRECISION FIX: Minimum size reduced to 8px
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
            onResize(field.id, (width / pageWidth) * 100, (height / safePageHeight) * 100);
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    };

    // The percentages are unchanged; the trailing options object is additive.
    // `snap: true` marks this as a pointer gesture, where snapping to guides is
    // wanted. Keyboard placement below deliberately does not set it, so arrow
    // keys stay exact to the percent.
    const handleDragStop = (e, data) => {
        onStop(field.id, pageNum, (data.x / pageWidth) * 100, (data.y / safePageHeight) * 100, { snap: true });
    };

    const handleDrag = (e, data) => {
        if (!onDragMove) return;
        onDragMove(field.id, pageNum, (data.x / pageWidth) * 100, (data.y / safePageHeight) * 100);
    };

    const tone = FIELD_TONE[field.type] || FIELD_TONE_FALLBACK;
    const fieldName = field.label || 'Untitled field';
    const inSelection = isSelected || isMultiSelected;

    /**
     * Keyboard placement. Purely additive: the pointer path above is untouched,
     * and these handlers emit the *same* `onStop` / `onResize` payloads in
     * percentages, clamped so a field can never leave its page — the keyboard
     * equivalent of `bounds="parent"`.
     *
     * Arrow keys move by 1% (Shift: 5%); Alt+arrows resize by the same steps.
     */
    const handleKeyDown = (e) => {
        const step = e.shiftKey ? 5 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;
        else return;

        e.preventDefault();
        e.stopPropagation();

        if (e.altKey) {
            const nextWidth = Math.min(100 - field.x, Math.max(1, field.width + dx));
            const nextHeight = Math.min(100 - field.y, Math.max(1, field.height + dy));
            onResize(field.id, nextWidth, nextHeight);
            return;
        }

        const nextX = Math.min(100 - field.width, Math.max(0, field.x + dx));
        const nextY = Math.min(100 - field.height, Math.max(0, field.y + dy));
        onStop(field.id, pageNum, nextX, nextY);
    };

    return (
        <Draggable
            nodeRef={nodeRef}
            bounds="parent"
            position={{ x: xPx, y: yPx }}
            onDrag={handleDrag}
            onStop={handleDragStop}
            cancel=".resize-handle, .label-input"
        >
            <div
                ref={nodeRef}
                // Focusable so the field can be reached, selected and moved without a
                // pointer. The accessible name states where it is; the description
                // states how to move it.
                tabIndex={0}
                role="group"
                // Selection is stated in the name, not only in the border colour.
                // `aria-selected` is not allowed on role="group", so the name carries it.
                aria-label={`${fieldName}, ${field.type} field on page ${pageNum}${inSelection ? ', selected' : ''}`}
                aria-describedby={hintId}
                onMouseDown={() => { pointerFocusRef.current = true; }}
                onFocus={() => {
                    if (pointerFocusRef.current) return;
                    onSelect(field.id);
                }}
                onBlur={() => { pointerFocusRef.current = false; }}
                onKeyDown={handleKeyDown}
                // Shift adds to the selection rather than replacing it. The second
                // argument is additive metadata: callers that ignore it behave
                // exactly as before.
                onClick={(e) => {
                    pointerFocusRef.current = false;
                    e.stopPropagation();
                    onSelect(field.id, { additive: e.shiftKey === true });
                }}
                className={`group absolute flex cursor-move flex-col rounded-ds-sm border pointer-events-auto transition-shadow motion-reduce:transition-none focus-visible:outline-none focus-visible:shadow-ds-focus
                    ${isSelected
                        ? 'z-[60] border-ds-action-primary shadow-ds-md ring-2 ring-ds-focus ring-offset-1'
                        : isMultiSelected
                            ? 'z-[55] border-ds-action-primary shadow-ds-sm'
                            : `z-50 shadow-ds-xs hover:shadow-ds-sm ${tone.border}`}`
                }
                style={{ width: size.width, height: size.height }}
            >
                {/* Translucent fill layer. Separate from the box so the border can
                    stay crisp while the fill lets the document show through. */}
                <span
                    data-field-fill="true"
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-ds-sm ${tone.fill} ${
                        inSelection ? 'opacity-70' : 'opacity-40'
                    }`}
                />

                {/* Compact type + label chip. */}
                <div className="relative z-10 flex shrink-0 items-center gap-ds-1 overflow-hidden px-ds-1 py-0.5">
                    <span aria-hidden="true" className="shrink-0 text-ds-content">{getIcon(field.type)}</span>
                    {size.width > 40 && (
                        <input
                            className="label-input w-full cursor-text truncate border-none bg-transparent p-0 text-ds-xs font-bold uppercase text-ds-content focus:ring-0"
                            aria-label={`Label for ${field.type} field on page ${pageNum}`}
                            value={field.label}
                            onChange={(e) => onLabelChange(field.id, e.target.value)}
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                    )}
                </div>

                <span id={hintId} className="ds-visually-hidden">
                    Arrow keys move the field by one percent, Shift by five, and Alt with an
                    arrow key resizes it.
                </span>

                {/* Remove and resize are contextual: they appear on the selected
                    field only, so an unselected field is a clean rectangle rather
                    than a cluster of controls. Focusing a field selects it, so both
                    stay reachable from the keyboard. */}
                {isSelected && (
                    <>
                        {/* DOCUMENTED EXCEPTION — this corner control is not the approved
                            IconButton. It is a ~14px round badge pinned to the corner of a
                            field whose minimum size is 8px; the approved primitive carries a
                            min-height and padding that would overflow the field it belongs
                            to. It keeps an accessible name, a focus-visible ring and the
                            `--ds-*` tokens. Retiring it needs a compact icon-button size in
                            the design system, recorded in the roadmap gap list. */}
                        <button
                            type="button"
                            aria-label={`Remove ${fieldName} from page ${pageNum}`}
                            onMouseDown={(e) => { e.stopPropagation(); onRemove(field.id); }}
                            className="absolute -right-2 -top-2 z-[70] rounded-full bg-ds-action-danger p-0.5 text-ds-content-inverse shadow-ds-sm focus-visible:outline-none focus-visible:shadow-ds-focus"
                        >
                            <X size={10} aria-hidden="true" />
                        </button>

                        {/* The resize affordance stays a pointer-only control: react-draggable
                            cancels dragging on `.resize-handle`, and the mousemove/mouseup
                            mathematics above is frozen. Keyboard resizing is Alt+arrows on the
                            field itself, so nothing is pointer-only overall. */}
                        <div
                            className="resize-handle absolute bottom-0 right-0 z-[70] flex h-3 w-3 cursor-se-resize items-end justify-end p-0.5 opacity-60 transition motion-reduce:transition-none group-hover:opacity-100"
                            onMouseDown={handleMouseDown}
                            aria-hidden="true"
                        >
                            <Scaling size={10} className="text-ds-content-secondary" />
                        </div>
                    </>
                )}
            </div>
        </Draggable>
    );
});

export default ResizableDraggableField;
