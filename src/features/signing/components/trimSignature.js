/**
 * The adopted signature: a PNG of only the part of the drawing canvas the ink
 * covers, so the ink fills the field box when it is stamped into the document.
 * The crop is the same as `trim-canvas`, which the signing room used before:
 * every row and column holding a pixel that is not fully transparent, copied
 * pixel for pixel. The drawing canvas itself is not changed.
 */

/**
 * The bounding box of the pixels whose alpha is not 0, in RGBA data `width`
 * pixels wide, or null when there are none.
 */
export function inkBounds(data, width, height) {
    let top = -1;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
            if (data[(row + x) * 4 + 3] === 0) continue;
            if (top < 0) top = y;
            bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
        }
    }
    if (top < 0) return null;
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** The trimmed PNG data URL of `canvas`, or null when it holds no ink. */
export function trimmedSignaturePng(canvas) {
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const box = inkBounds(data, canvas.width, canvas.height);
    if (!box) return null;
    const trimmed = canvas.ownerDocument.createElement('canvas');
    trimmed.width = box.width;
    trimmed.height = box.height;
    trimmed.getContext('2d').putImageData(
        context.getImageData(box.left, box.top, box.width, box.height),
        0,
        0,
    );
    return trimmed.toDataURL('image/png');
}
