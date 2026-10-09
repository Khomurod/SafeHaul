/**
 * A big phone photo goes as a smaller JPEG; everything else goes as it is. The
 * decoder and the canvas are stand-ins, since the test DOM has neither.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_MAX_SIDE, PHOTO_TARGET_BYTES, shrinkPhoto } from './guestUploadImage';

const MB = 1024 * 1024;

function photo(name, type, size) {
    const file = new File(['x'], name, { type, lastModified: 1700000000000 });
    Object.defineProperty(file, 'size', { value: size });
    return file;
}

/** A decoder for a `width`×`height` photo and a canvas whose JPEG weighs `outBytes`. */
function stubDrawing({ width = 4000, height = 3000, outBytes = 600 * 1024 } = {}) {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn((done) => done(new Blob([new Uint8Array(outBytes)], { type: 'image/jpeg' }))) };
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : create(tag)));
    return { canvas, context, close };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('shrinkPhoto', () => {
    it('redraws a big photo as a JPEG with its longest side at most 2400 px, on white', async () => {
        const { canvas, context, close } = stubDrawing();
        const big = photo('IMG_1234.png', 'image/png', 9 * MB);

        const sent = await shrinkPhoto(big);

        expect([canvas.width, canvas.height]).toEqual([PHOTO_MAX_SIDE, 1800]);
        expect(context.fillStyle).toBe('white');
        expect(context.fillRect).toHaveBeenCalledWith(0, 0, PHOTO_MAX_SIDE, 1800);
        expect(context.drawImage).toHaveBeenCalledTimes(1);
        expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
        expect(close).toHaveBeenCalled();
        expect(sent).not.toBe(big);
        expect(sent.name).toBe('IMG_1234.jpg');
        expect(sent.type).toBe('image/jpeg');
        expect(sent.size).toBe(600 * 1024);
    });

    it('never enlarges a photo that is heavy but already small in pixels', async () => {
        const { canvas } = stubDrawing({ width: 1200, height: 900 });
        await shrinkPhoto(photo('scan.jpg', 'image/jpeg', 3 * MB));
        expect([canvas.width, canvas.height]).toEqual([1200, 900]);
    });

    it.each([
        ['a PDF', photo('report.pdf', 'application/pdf', 15 * MB)],
        ['a photo already small enough', photo('cdl.jpg', 'image/jpeg', PHOTO_TARGET_BYTES)],
    ])('sends %s as it is', async (_label, file) => {
        stubDrawing();
        expect(await shrinkPhoto(file)).toBe(file);
        expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    });

    it('sends the photo as it is when it would not come out smaller', async () => {
        stubDrawing({ outBytes: 6 * MB });
        const big = photo('cdl.jpg', 'image/jpeg', 5 * MB);
        expect(await shrinkPhoto(big)).toBe(big);
    });

    it('sends the photo as it is when the browser cannot decode it', async () => {
        stubDrawing();
        vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('unsupported format'); }));
        const heic = photo('IMG_9.heic', 'image/heic', 6 * MB);
        expect(await shrinkPhoto(heic)).toBe(heic);
    });

    it('sends the photo as it is where the browser has no decoder at all', async () => {
        const big = photo('cdl.jpg', 'image/jpeg', 6 * MB);
        vi.stubGlobal('createImageBitmap', undefined);
        expect(await shrinkPhoto(big)).toBe(big);
    });
});
