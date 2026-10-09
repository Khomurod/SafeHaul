/**
 * The driver application's signature canvas (`#signature-canvas` on the consent
 * step). `initializeSignatureCanvas` takes `onStrokeEnd`, called when a stroke
 * that drew something ends, so the step can save the signature without a button
 * the driver may never press, and `restore`, a signature saved earlier, drawn
 * back because the canvas is a new, blank element each time its page is shown.
 */

/** @type {HTMLCanvasElement | null} */
let canvas;
/** @type {CanvasRenderingContext2D | null} */
let ctx;
let drawing = false;
let lastPos;
/** Whether the stroke in progress has drawn anything; a tap draws nothing. */
let strokeDrew = false;
/** @type {(() => void) | null} */
let strokeEndHandler = null;
/** Counts set-ups, so a signature drawn back belongs to the set-up that asked for it. */
let setUps = 0;

function getMousePos(canvasDom, mouseEvent) {
    const rect = canvasDom.getBoundingClientRect();
    const scaleX = canvasDom.width / rect.width;
    const scaleY = canvasDom.height / rect.height;
    return {
        x: (mouseEvent.clientX - rect.left) * scaleX,
        y: (mouseEvent.clientY - rect.top) * scaleY
    };
}

function getTouchPos(canvasDom, touchEvent) {
    const rect = canvasDom.getBoundingClientRect();
    const scaleX = canvasDom.width / rect.width;
    const scaleY = canvasDom.height / rect.height;
    return {
        x: (touchEvent.touches[0].clientX - rect.left) * scaleX,
        y: (touchEvent.touches[0].clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    e.preventDefault();
    drawing = true;
    strokeDrew = false;
    lastPos = e.touches ? getTouchPos(canvas, e) : getMousePos(canvas, e);
}

function stopDrawing() {
    const drew = drawing && strokeDrew;
    drawing = false;
    strokeDrew = false;
    if (drew && strokeEndHandler) strokeEndHandler();
}

function draw(e) {
    if (!drawing) return;
    e.preventDefault();

    const pos = e.touches ? getTouchPos(canvas, e) : getMousePos(canvas, e);

    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastPos = pos;
    strokeDrew = true;
}

let abortController;

export function initializeSignatureCanvas({ onStrokeEnd = null, restore = null } = {}) {
    // Clean up any previous event listeners to prevent leaks
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal } = abortController;
    strokeEndHandler = onStrokeEnd;
    setUps += 1;

    canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('signature-canvas'));
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#333';

    canvas.addEventListener('mousedown', startDrawing, { signal });
    canvas.addEventListener('mouseup', stopDrawing, { signal });
    canvas.addEventListener('mousemove', draw, { signal });
    canvas.addEventListener('mouseleave', stopDrawing, { signal });

    canvas.addEventListener('touchstart', startDrawing, { passive: false, signal });
    canvas.addEventListener('touchend', stopDrawing, { passive: false, signal });
    canvas.addEventListener('touchmove', draw, { passive: false, signal });

    const clearBtn = document.getElementById('clear-signature');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearCanvas, { signal });
    }

    if (restore) drawSignature(restore);
}

/**
 * Draws a saved signature (a `data:image/` URL) onto the canvas, scaled down to
 * fit and never up. It draws over what is there; clear first to replace it.
 */
export function drawSignature(dataUrl) {
    if (!ctx || !canvas || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    const target = canvas;
    const context = ctx;
    const setUp = setUps;
    const image = new Image();
    image.onload = () => {
        // The page was left, or set up again, while the image loaded.
        if (setUps !== setUp || canvas !== target || !image.width || !image.height) return;
        const scale = Math.min(1, target.width / image.width, target.height / image.height);
        context.drawImage(image, 0, 0, image.width * scale, image.height * scale);
    };
    image.src = dataUrl;
}

export function clearCanvas() {
    if (!ctx || !canvas) return;
    const tempWidth = canvas.width;
    const tempHeight = canvas.height;
    ctx.clearRect(0, 0, tempWidth, tempHeight);

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#333';
}

export function isCanvasEmpty() {
    if (!canvas) return true;

    const context = canvas.getContext('2d');
    try {
        const pixelBuffer = new Uint32Array(
            context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
        );
        return !pixelBuffer.some(pixel => pixel !== 0);
    } catch (e) {
        console.error("Error reading canvas data:", e);
        return true;
    }
}

export function getSignatureDataUrl() {
    if (!canvas || isCanvasEmpty()) return null;
    return canvas.toDataURL('image/png');
}