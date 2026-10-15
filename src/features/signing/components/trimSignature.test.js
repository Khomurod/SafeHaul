import { afterEach, describe, expect, it, vi } from 'vitest';
import { inkBounds, trimmedSignaturePng } from './trimSignature';

/** RGBA data `width` × `height` with the alpha of each listed pixel set. */
function pixels(width, height, inked) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y, alpha = 255] of inked) data[(y * width + x) * 4 + 3] = alpha;
    return data;
}

describe('inkBounds', () => {
    it('is null for a canvas with no ink', () => {
        expect(inkBounds(pixels(4, 3, []), 4, 3)).toBeNull();
    });

    it('spans every row and column holding a pixel that is not fully transparent', () => {
        // Ink at (1,1) and (3,2), and a faint anti-aliased edge pixel at (2,4).
        const data = pixels(6, 5, [[1, 1], [3, 2], [2, 4, 1]]);
        expect(inkBounds(data, 6, 5)).toEqual({ left: 1, top: 1, width: 3, height: 4 });
    });

    it('keeps a single dot as a one-pixel box', () => {
        expect(inkBounds(pixels(5, 5, [[4, 0]]), 5, 5)).toEqual({ left: 4, top: 0, width: 1, height: 1 });
    });
});

describe('trimmedSignaturePng', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** A canvas whose 2D context serves `data` and records what is read. */
    function fakeCanvas(width, height, data) {
        const reads = [];
        const context = {
            getImageData: (x, y, w, h) => {
                reads.push([x, y, w, h]);
                return { data, width: w, height: h, crop: [x, y, w, h] };
            },
        };
        return { canvas: { width, height, getContext: () => context, ownerDocument: document }, reads };
    }

    it('copies only the inked box into a new canvas and encodes that as PNG', () => {
        const { canvas, reads } = fakeCanvas(6, 5, pixels(6, 5, [[1, 1], [3, 2]]));
        const put = vi.fn();
        const trimmed = {
            getContext: () => ({ putImageData: put }),
            toDataURL: vi.fn(() => 'data:image/png;base64,trimmed'),
        };
        const create = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? trimmed : create(tag)));

        expect(trimmedSignaturePng(canvas)).toBe('data:image/png;base64,trimmed');
        expect(reads).toEqual([[0, 0, 6, 5], [1, 1, 3, 2]]);
        expect(trimmed.width).toBe(3);
        expect(trimmed.height).toBe(2);
        expect(put).toHaveBeenCalledWith(expect.objectContaining({ crop: [1, 1, 3, 2] }), 0, 0);
        expect(trimmed.toDataURL).toHaveBeenCalledWith('image/png');
    });

    it('is null when the canvas holds no ink', () => {
        const { canvas } = fakeCanvas(4, 4, pixels(4, 4, []));
        const createElement = vi.spyOn(document, 'createElement');
        expect(trimmedSignaturePng(canvas)).toBeNull();
        expect(createElement).not.toHaveBeenCalled();
    });
});
