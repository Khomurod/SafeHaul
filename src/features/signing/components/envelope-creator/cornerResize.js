/**
 * cornerResize.js — the corner handle's resize gesture, for a placed field and
 * for an AI suggestion alike.
 *
 * Pointer events cover a mouse, a pen and a finger; the handle carries
 * `touch-none`, so a finger resizes the box instead of scrolling the page. The
 * box follows the pointer that pressed the handle, never below 8px, until that
 * press ends; a second finger changes nothing. Only a size that changed is
 * reported, so a tap on the handle records nothing.
 */
export function startCornerResize(event, sizeRef, setSize, onResized) {
    event.stopPropagation();
    const { pointerId } = event;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = sizeRef.current;

    const follow = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const next = {
            width: Math.max(8, start.width + moveEvent.clientX - startX),
            height: Math.max(8, start.height + moveEvent.clientY - startY),
        };
        sizeRef.current = next;
        setSize(next);
    };
    const finish = (endEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', follow);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        const { width, height } = sizeRef.current;
        if (width !== start.width || height !== start.height) onResized(width, height);
    };

    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
}
