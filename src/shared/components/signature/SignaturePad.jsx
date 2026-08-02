import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Button, FieldMessage } from '@/design-system/components';

/**
 * SignaturePad
 * ============
 * Plain-canvas draw-to-sign component (no external dependency). It collects the
 * legally operative mark on an FMCSA 49 CFR §391.23 employer verification.
 *
 * ── FROZEN CONTRACT ──────────────────────────────────────────────────────────
 *  - `onSignatureChange(dataUrl)` fires with a `data:image/png;base64,…` string
 *    when a stroke finishes, and with `null` when the pad is cleared.
 *  - The canvas is exactly `SIGNATURE_CANVAS_HEIGHT` (150) px tall and stretches
 *    to its container's width.
 * `SignaturePad.contract.test.jsx` pins both by value.
 *
 * ── DEFECT FIXED 2026-07-27: the signature could diverge from the data ───────
 * Assigning `canvas.width` resets the bitmap. The previous version rebuilt the
 * canvas on **every** window `resize` and never told its parent, so the drawing
 * went blank while the parent still held the PNG captured before the resize. The
 * respondent then submitted, under penalty of perjury, a signature they could no
 * longer see. On a phone, rotating the device was enough to trigger it.
 *
 * The invariant now enforced is: **what is on the canvas and what the parent
 * holds can never disagree.**
 *   - A resize that does not change the rendered size is ignored outright, so
 *     an on-screen keyboard opening or a mobile URL bar collapsing is a no-op.
 *   - A real resize copies the bitmap out, rebuilds, draws it back 1:1 (the
 *     height is constant, so only width is revealed or cropped — the mark is
 *     never stretched) and **re-emits**, so the stored PNG matches the pixels.
 *   - If the bitmap cannot be carried over, the pad clears itself and emits
 *     `null`. Losing the signature visibly is correct; keeping invisible data is
 *     not.
 *
 * ── OTHER DEFECTS FIXED ──────────────────────────────────────────────────────
 *  - **No accessible name, instructions or error association.** The canvas is
 *    now a named `role="img"` with `aria-describedby` covering the drawing
 *    instructions and any validation message, plus `aria-invalid`, and a
 *    `role="status"` region announces capture and clearing.
 *  - **Clear was a bare `<button>`** with raw palette classes that only existed
 *    once something had been drawn, so it appeared and vanished under the
 *    keyboard. It is now an always-present design-system `Button`, disabled
 *    while there is nothing to clear.
 *  - **Pen and stylus did not work** — only `mouse` and `touch` were handled.
 *    Pointer events are handled first, with the mouse/touch handlers kept as a
 *    fallback and de-duplicated so a single gesture is never drawn twice.
 *  - **Coordinates ignored the canvas scale.** `canvas.width` was set from the
 *    *parent's* `offsetWidth`, which includes the container's 2 px border, so
 *    the backing store was wider than the rendered canvas and strokes drifted
 *    from the cursor. Positions are now measured against the canvas's own rect
 *    and scaled by the backing-store ratio.
 *  - **Raw palette classes** (`border-gray-300`, `text-blue-600`, …) replaced
 *    with `--ds-*` tokens.
 *
 * KNOWN, UNRESOLVED — a canvas cannot be signed with a keyboard, so this control
 * has no keyboard path to producing a signature. Recorded as an open owner
 * decision in the roadmap rather than papered over: a typed fallback would have
 * to be legally distinguishable from a drawn mark (as `TEXT_SIGNATURE:` already
 * is on the VOE side), and that is a product decision, not a styling one.
 *
 * NOTE: The public application flow uses `src/lib/signature.js` (DOM-id based)
 * and the signing room uses `react-signature-canvas` (SignatureSheet). Those
 * have different visuals and validation semantics and are intentionally NOT
 * migrated to this component.
 */

/** Frozen: the rendered height of the signing surface, in CSS pixels. */
export const SIGNATURE_CANVAS_HEIGHT = 150;

const DEFAULT_LABEL = 'Signature drawing area';

function applyStrokeStyle(ctx) {
    ctx.strokeStyle = '#1a2332';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

export function SignaturePad({
    onSignatureChange,
    label = DEFAULT_LABEL,
    instructions,
    error,
}) {
    const canvasRef = useRef(null);
    const [hasSignature, setHasSignature] = useState(false);
    const [announcement, setAnnouncement] = useState('');

    // `isDrawing` is a ref, not state, on purpose. React batches state updates,
    // so a `pointermove` arriving in the same task as its `pointerdown` — which
    // is what a fast flick, a synthetic event, or a high-frequency stylus
    // produces — would still read the stale `false` and silently drop the
    // stroke. A ref is correct at the moment the next event is handled.
    const isDrawingRef = useRef(false);

    // Mirrors of state for use inside listeners that must not be re-bound on
    // every render (the resize handler is registered once).
    const hasSignatureRef = useRef(false);
    const onSignatureChangeRef = useRef(onSignatureChange);
    onSignatureChangeRef.current = onSignatureChange;

    // Set while a Pointer Events gesture is in flight, so the browser's
    // compatibility mouse/touch events for the same gesture are ignored.
    const activePointerRef = useRef(null);

    const rawId = useId().replace(/:/g, '');
    const instructionsId = instructions ? `signature-instructions-${rawId}` : undefined;
    const errorId = error ? `signature-error-${rawId}` : undefined;
    const describedBy = [instructionsId, errorId].filter(Boolean).join(' ') || undefined;

    const setSigned = useCallback((signed) => {
        hasSignatureRef.current = signed;
        setHasSignature(signed);
    }, []);

    const emitCurrentSignature = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.toDataURL !== 'function') return;
        onSignatureChangeRef.current(canvas.toDataURL('image/png'));
    }, []);

    /**
     * Rebuild the backing store for the current rendered size, carrying the
     * drawing across. See the divergence note in the file header.
     */
    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect?.();
        const measured = rect?.width || canvas.parentElement?.clientWidth || 0;
        const nextWidth = Math.max(1, Math.round(measured));

        if (canvas.width === nextWidth && canvas.height === SIGNATURE_CANVAS_HEIGHT) {
            // Nothing about the rendered size changed — an on-screen keyboard or
            // a collapsing URL bar. Leave the drawing alone.
            applyStrokeStyle(ctx);
            return;
        }

        // Copy the existing drawing out before the assignment wipes it.
        let snapshot = null;
        if (hasSignatureRef.current && canvas.width > 0 && canvas.height > 0) {
            try {
                const buffer = document.createElement('canvas');
                buffer.width = canvas.width;
                buffer.height = canvas.height;
                const bufferCtx = buffer.getContext('2d');
                if (bufferCtx && typeof bufferCtx.drawImage === 'function') {
                    bufferCtx.drawImage(canvas, 0, 0);
                    snapshot = buffer;
                }
            } catch {
                snapshot = null;
            }
        }

        canvas.width = nextWidth;
        canvas.height = SIGNATURE_CANVAS_HEIGHT;
        applyStrokeStyle(ctx);

        if (!hasSignatureRef.current) return;

        if (snapshot && typeof ctx.drawImage === 'function') {
            try {
                // 1:1, anchored top-left: the height never changes, so the mark
                // keeps its proportions and only width is revealed or cropped.
                ctx.drawImage(snapshot, 0, 0);
            } catch {
                snapshot = null;
            }
        }

        if (snapshot) {
            // Re-issue so the parent's stored PNG matches what is on screen now.
            emitCurrentSignature();
            return;
        }

        // Could not carry it over. Fail visibly rather than submit a signature
        // the respondent can no longer see.
        setSigned(false);
        setAnnouncement('Signature cleared because the form was resized. Please sign again.');
        onSignatureChangeRef.current(null);
    }, [emitCurrentSignature, setSigned]);

    useEffect(() => {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', resizeCanvas);
        return () => {
            window.removeEventListener('resize', resizeCanvas);
            window.removeEventListener('orientationchange', resizeCanvas);
        };
    }, [resizeCanvas]);

    /** Client coordinates → backing-store coordinates. */
    const toCanvasPoint = (clientX, clientY) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width ? canvas.width / rect.width : 1;
        const scaleY = rect.height ? canvas.height / rect.height : 1;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const pointFromEvent = (e) => {
        if (e.touches && e.touches.length > 0) {
            return toCanvasPoint(e.touches[0].clientX, e.touches[0].clientY);
        }
        return toCanvasPoint(e.clientX, e.clientY);
    };

    const beginStroke = (e) => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        isDrawingRef.current = true;
        const pos = pointFromEvent(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const extendStroke = (e) => {
        if (!isDrawingRef.current) return;
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const pos = pointFromEvent(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (!hasSignatureRef.current) {
            setSigned(true);
            setAnnouncement('Signature captured.');
        }
    };

    const endStroke = () => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        if (hasSignatureRef.current) emitCurrentSignature();
    };

    // ── Pointer Events: mouse, pen and touch in one path ────────────────────
    const handlePointerDown = (e) => {
        e.preventDefault();
        activePointerRef.current = e.pointerId ?? 'pointer';
        // Start the stroke FIRST. `setPointerCapture` throws `NotFoundError` for
        // a pointer id the browser does not consider active; letting that escape
        // ahead of `beginStroke` would abandon the stroke entirely.
        beginStroke(e);
        try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
            // Capture is an enhancement — drawing works without it.
        }
    };

    const handlePointerMove = (e) => {
        if (activePointerRef.current === null) return;
        e.preventDefault();
        extendStroke(e);
    };

    const handlePointerEnd = (e) => {
        if (activePointerRef.current === null) return;
        try {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
            // Nothing was captured; nothing to release.
        }
        activePointerRef.current = null;
        endStroke();
    };

    // ── Mouse and touch fallbacks, skipped when Pointer Events handled it ───
    const pointerHandled = () => activePointerRef.current !== null;

    const handleMouseDown = (e) => { if (pointerHandled()) return; e.preventDefault(); beginStroke(e); };
    const handleMouseMove = (e) => { if (pointerHandled()) return; e.preventDefault(); extendStroke(e); };
    const handleMouseEnd = () => { if (pointerHandled()) return; endStroke(); };

    const handleTouchStart = (e) => { if (pointerHandled()) return; e.preventDefault(); beginStroke(e); };
    const handleTouchMove = (e) => { if (pointerHandled()) return; e.preventDefault(); extendStroke(e); };
    const handleTouchEnd = () => { if (pointerHandled()) return; endStroke(); };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        setSigned(false);
        setAnnouncement('Signature cleared.');
        onSignatureChange(null);
    };

    return (
        <div className="grid gap-ds-2">
            {instructions && (
                <p id={instructionsId} className="text-ds-xs text-ds-content-muted">
                    {instructions}
                </p>
            )}

            <div
                className={`relative overflow-hidden rounded-ds-lg border-2 border-dashed bg-ds-surface ${
                    error ? 'border-ds-status-danger-border' : 'border-ds-border'
                }`}
                style={{ touchAction: 'none' }}
            >
                <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label={label}
                    aria-describedby={describedBy}
                    aria-invalid={error ? 'true' : undefined}
                    height={SIGNATURE_CANVAS_HEIGHT}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    onPointerLeave={handlePointerEnd}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseEnd}
                    onMouseLeave={handleMouseEnd}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    className="block w-full cursor-crosshair"
                    style={{ height: `${SIGNATURE_CANVAS_HEIGHT}px`, touchAction: 'none' }}
                />
                {!hasSignature && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span aria-hidden="true" className="text-ds-sm text-ds-content-muted">
                            Draw your signature here
                        </span>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-ds-3">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={clearSignature}
                    disabled={!hasSignature}
                >
                    Clear Signature
                </Button>
                <p role="status" className="ds-visually-hidden">{announcement}</p>
            </div>

            {error && (
                <FieldMessage id={errorId} tone="error">
                    {error}
                </FieldMessage>
            )}
        </div>
    );
}

export default SignaturePad;
