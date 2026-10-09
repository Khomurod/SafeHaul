/**
 * The application's signature canvas helper: a stroke that drew something is
 * reported when it ends, and a signature drawn back onto a new canvas never lands
 * after the page was set up again or cleared. The canvas, its context and the
 * image decode are stand-ins the test drives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCanvas, drawSignature, getSignatureDataUrl, initializeSignatureCanvas } from './signature';

const SAVED = 'data:image/png;base64,iVBORw0KGgo=';
let images;
let context;

/** A canvas on the page, 300×150, with a context that records what is drawn. */
function mountCanvas() {
    const canvas = document.createElement('canvas');
    canvas.id = 'signature-canvas';
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 });
    context = {
        beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
        clearRect: vi.fn(), drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    };
    canvas.getContext = () => context;
    canvas.toDataURL = () => SAVED;
    document.body.appendChild(canvas);
    return canvas;
}

const mouse = (canvas, type, x, y) => canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));

beforeEach(() => {
    images = [];
    vi.stubGlobal('Image', class {
        constructor() { images.push(this); this.width = 600; this.height = 150; }
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('initializeSignatureCanvas', () => {
    it('reports a stroke that drew something when it ends, and not a tap', () => {
        const canvas = mountCanvas();
        const onStrokeEnd = vi.fn();
        initializeSignatureCanvas({ onStrokeEnd });

        mouse(canvas, 'mousedown', 10, 10);
        mouse(canvas, 'mouseup', 10, 10);
        expect(onStrokeEnd).not.toHaveBeenCalled();

        mouse(canvas, 'mousedown', 10, 10);
        mouse(canvas, 'mousemove', 40, 30);
        mouse(canvas, 'mouseup', 40, 30);
        expect(onStrokeEnd).toHaveBeenCalledTimes(1);
    });

    it('draws a saved signature back, scaled down to fit', () => {
        mountCanvas();
        initializeSignatureCanvas({ restore: SAVED });

        expect(images).toHaveLength(1);
        expect(images[0].src).toBe(SAVED);
        images[0].onload();
        expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 300, 75);
    });

    it('does not draw it back once the driver has cleared the pad', () => {
        mountCanvas();
        initializeSignatureCanvas({ restore: SAVED });

        clearCanvas();
        images[0].onload();

        expect(context.drawImage).not.toHaveBeenCalled();
    });

    it('does not draw it over a canvas set up again meanwhile', () => {
        mountCanvas();
        initializeSignatureCanvas({ restore: SAVED });
        initializeSignatureCanvas();

        images[0].onload();

        expect(context.drawImage).not.toHaveBeenCalled();
    });

    it('draws a signature asked for after a clear', () => {
        mountCanvas();
        initializeSignatureCanvas();
        clearCanvas();
        drawSignature(SAVED);

        images[0].onload();

        expect(context.drawImage).toHaveBeenCalledTimes(1);
    });

    it('reads nothing back from an empty pad', () => {
        mountCanvas();
        initializeSignatureCanvas();
        expect(getSignatureDataUrl()).toBeNull();
    });
});
