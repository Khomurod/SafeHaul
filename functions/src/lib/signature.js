let canvas, ctx, drawing = false;
let lastPos;

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
    lastPos = e.touches ? getTouchPos(canvas, e) : getMousePos(canvas, e);
}

function stopDrawing() {
    drawing = false;
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
}

export function initializeSignatureCanvas() {
    canvas = document.getElementById('signature-canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#333';

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });

    const clearBtn = document.getElementById('clear-signature');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearCanvas);
    }
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