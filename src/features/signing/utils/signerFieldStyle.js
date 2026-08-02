/**
 * Percentage-based overlay geometry for the public signing room.
 * Matches EnvelopeCreator / digitalSealing coordinate system (top-left origin).
 */

/** @typedef {import('react').CSSProperties} CSSProperties */

/**
 * Normalize a field from Firestore/API to canonical xPosition/yPosition.
 * @param {Record<string, unknown>} field
 */
export function normalizeSignerField(field) {
    if (!field || typeof field !== 'object') return field;
    return {
        ...field,
        pageNumber: Number(field.pageNumber) || 1,
        xPosition: field.xPosition ?? field.x ?? 10,
        yPosition: field.yPosition ?? field.y ?? 10,
    };
}

/**
 * Width/height stored as page percentages when value < 100; legacy envelopes may use px.
 * @param {Record<string, unknown>} field
 */
export function isPercentFieldSize(field) {
    const w = Number(field?.width);
    if (!Number.isFinite(w)) return true;
    return w < 100;
}

/**
 * Absolute positioning box (% of PDF page container). No min-width/height — layout matches editor.
 * @param {Record<string, unknown>} field
 * @returns {CSSProperties}
 */
export function getSignerFieldBoxStyle(field) {
    const isPercent = isPercentFieldSize(field);
    const widthVal = field.width ?? (isPercent ? 25 : 160);
    const heightVal = field.height ?? (isPercent ? 5 : 40);
    const x = field.xPosition ?? field.x ?? 10;
    const y = field.yPosition ?? field.y ?? 10;

    return {
        left: `${x}%`,
        top: `${y}%`,
        width: `${widthVal}${isPercent ? '%' : 'px'}`,
        height: `${heightVal}${isPercent ? '%' : 'px'}`,
        position: 'absolute',
        zIndex: 20,
    };
}
