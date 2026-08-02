/**
 * Page-range parsing for the AI Field Assistant's "selected pages" scan scope.
 *
 * A 40-page onboarding packet is unusable as a checkbox grid, so the scan
 * dialog takes the same comma/dash notation people already type into a print
 * dialog. Anything unparseable is ignored rather than guessed at.
 */

/** "1, 3, 5-8" → [1, 3, 5, 6, 7, 8], clamped to the document's page count. */
export function parsePageRange(raw, numPages) {
    const total = Number.isFinite(numPages) && numPages > 0 ? numPages : 0;
    if (!total) return [];
    const pages = new Set();

    for (const part of String(raw || '').split(',')) {
        const token = part.trim();
        if (!token) continue;

        const range = token.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (range) {
            const start = Math.max(1, Number(range[1]));
            const end = Math.min(total, Number(range[2]));
            for (let page = start; page <= end; page += 1) pages.add(page);
            continue;
        }

        const single = Number(token);
        if (Number.isInteger(single) && single >= 1 && single <= total) pages.add(single);
    }

    return [...pages].sort((a, b) => a - b);
}

export default parsePageRange;
