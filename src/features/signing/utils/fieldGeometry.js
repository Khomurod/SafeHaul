/**
 * Field geometry tools for the E-Docs editor: selection, alignment, snapping,
 * duplication and copying across pages.
 *
 * All coordinates are the editor's existing page percentages — `x`, `y`,
 * `width`, `height` in 0–100 with a top-left origin, and a 1-based `page`. This
 * module never converts to pixels and never touches the drag/resize maths in
 * `ResizableDraggableField`; it only produces new field values that the same
 * update paths then apply.
 *
 * Every function is pure and returns new objects, so the editor's history can
 * record the result as a single state.
 */

/** Smallest usable field, matching the AI assistant's floor. */
export const MIN_FIELD_WIDTH_PCT = 1.5;
export const MIN_FIELD_HEIGHT_PCT = 1;

/** Distance (in page percent) within which an edge snaps. */
export const SNAP_THRESHOLD_PCT = 0.8;

const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Force a field inside its page and to a usable size.
 *
 * Copying, aligning and size-matching can all push a box past an edge; this is
 * the single place that decides what "on the page" means, so no tool can leave
 * a field the signer would never see.
 */
export function clampFieldToPage(field) {
    if (!field || typeof field !== 'object') return field;

    const width = Math.min(100, Math.max(MIN_FIELD_WIDTH_PCT, num(field.width, 25)));
    const height = Math.min(100, Math.max(MIN_FIELD_HEIGHT_PCT, num(field.height, 5)));
    const x = Math.min(Math.max(0, num(field.x, 0)), 100 - width);
    const y = Math.min(Math.max(0, num(field.y, 0)), 100 - height);

    return { ...field, x, y, width, height };
}

/** Right edge / bottom edge / centres, used by alignment and snapping. */
export function fieldEdges(field) {
    const x = num(field?.x, 0);
    const y = num(field?.y, 0);
    const width = num(field?.width, 0);
    const height = num(field?.height, 0);
    return {
        left: x,
        right: x + width,
        top: y,
        bottom: y + height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        width,
        height,
    };
}

/**
 * Shift-click selection.
 *
 * A plain click replaces the selection; an additive click toggles one field in
 * or out. Returned arrays keep insertion order, because the first-selected
 * field is the anchor that alignment and size-matching measure against.
 */
export function toggleSelection(selectedIds = [], id, additive = false) {
    if (!id) return additive ? [...selectedIds] : [];
    if (!additive) return [id];
    return selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id];
}

export const ALIGNMENT_MODES = Object.freeze([
    'left',
    'center',
    'right',
    'top',
    'middle',
    'bottom',
]);

/**
 * Align the selected fields to the anchor — the FIRST field selected.
 *
 * Anchoring on the first selection rather than on the bounding box is what
 * makes the result predictable: the user picks the field that is already in the
 * right place, then picks the others.
 *
 * Fields on a different page than the anchor are left alone: aligning across
 * pages has no meaning, and silently moving a field the user cannot see would
 * be worse than doing nothing.
 */
export function alignFields(fields = [], selectedIds = [], mode = 'left') {
    if (!ALIGNMENT_MODES.includes(mode)) return fields;
    if (!Array.isArray(fields) || selectedIds.length < 2) return fields;

    const anchor = fields.find((field) => field?.id === selectedIds[0]);
    if (!anchor) return fields;

    const anchorEdges = fieldEdges(anchor);
    const selected = new Set(selectedIds);

    return fields.map((field) => {
        if (!field || !selected.has(field.id)) return field;
        if (field.id === anchor.id) return field;
        if (num(field.page, 1) !== num(anchor.page, 1)) return field;

        const edges = fieldEdges(field);
        let next = field;

        if (mode === 'left') next = { ...field, x: anchorEdges.left };
        if (mode === 'right') next = { ...field, x: anchorEdges.right - edges.width };
        if (mode === 'center') next = { ...field, x: anchorEdges.centerX - edges.width / 2 };
        if (mode === 'top') next = { ...field, y: anchorEdges.top };
        if (mode === 'bottom') next = { ...field, y: anchorEdges.bottom - edges.height };
        if (mode === 'middle') next = { ...field, y: anchorEdges.centerY - edges.height / 2 };

        return clampFieldToPage(next);
    });
}

/** Match every selected field's width and/or height to the anchor's. */
export function matchFieldSize(fields = [], selectedIds = [], dimension = 'width') {
    if (!Array.isArray(fields) || selectedIds.length < 2) return fields;
    const anchor = fields.find((field) => field?.id === selectedIds[0]);
    if (!anchor) return fields;

    const selected = new Set(selectedIds);
    const anchorWidth = num(anchor.width, 25);
    const anchorHeight = num(anchor.height, 5);

    return fields.map((field) => {
        if (!field || !selected.has(field.id) || field.id === anchor.id) return field;
        const next = { ...field };
        if (dimension === 'width' || dimension === 'both') next.width = anchorWidth;
        if (dimension === 'height' || dimension === 'both') next.height = anchorHeight;
        return clampFieldToPage(next);
    });
}

/**
 * Snap a dragged rectangle to the page's centre lines, its edges, and the edges
 * and centres of other fields on the same page.
 *
 * Returns the adjusted position plus the guides that should be drawn, so the
 * canvas shows exactly what it snapped to rather than moving unexplained.
 *
 * @returns {{ x: number, y: number, guides: Array<{axis: 'x'|'y', at: number}> }}
 */
export function snapFieldPosition(candidate, others = [], options = {}) {
    const threshold = num(options.threshold, SNAP_THRESHOLD_PCT);
    const width = num(candidate?.width, 0);
    const height = num(candidate?.height, 0);
    let x = num(candidate?.x, 0);
    let y = num(candidate?.y, 0);
    const page = num(candidate?.page, 1);

    const sameSurface = (Array.isArray(others) ? others : []).filter(
        (field) => field && field.id !== candidate?.id && num(field.page, 1) === page,
    );

    // Candidate lines: page edges and centre, then every other field's edges
    // and centres on this page.
    const verticalTargets = [0, 50, 100];
    const horizontalTargets = [0, 50, 100];
    for (const field of sameSurface) {
        const edges = fieldEdges(field);
        verticalTargets.push(edges.left, edges.centerX, edges.right);
        horizontalTargets.push(edges.top, edges.centerY, edges.bottom);
    }

    const guides = [];

    // For each axis try the moving box's own left/centre/right against every
    // target, and keep the closest match inside the threshold.
    const trySnap = (movingLines, targets) => {
        let best = null;
        for (const { offset, value } of movingLines) {
            for (const target of targets) {
                const distance = Math.abs(value - target);
                if (distance > threshold) continue;
                if (!best || distance < best.distance) {
                    best = { distance, at: target, origin: target - offset };
                }
            }
        }
        return best;
    };

    const vertical = trySnap(
        [
            { offset: 0, value: x },
            { offset: width / 2, value: x + width / 2 },
            { offset: width, value: x + width },
        ],
        verticalTargets,
    );
    if (vertical) {
        x = vertical.origin;
        guides.push({ axis: 'x', at: vertical.at });
    }

    const horizontal = trySnap(
        [
            { offset: 0, value: y },
            { offset: height / 2, value: y + height / 2 },
            { offset: height, value: y + height },
        ],
        horizontalTargets,
    );
    if (horizontal) {
        y = horizontal.origin;
        guides.push({ axis: 'y', at: horizontal.at });
    }

    const clamped = clampFieldToPage({ x, y, width, height, page });
    return { x: clamped.x, y: clamped.y, guides };
}

/** Default offset applied to a duplicate so it does not hide the original. */
const DUPLICATE_OFFSET_PCT = 2;

/**
 * Duplicate one field on its own page, nudged so both are visible.
 *
 * The copy gets a NEW id and keeps everything that defines what the field means
 * — type, label, binding, required state, prefill policy, default value and
 * size. Reusing an id would make two fields collide in `fieldValues` and in the
 * sealed PDF.
 */
export function duplicateField(field, idFactory) {
    if (!field || typeof field !== 'object') return null;
    const makeId = idFactory || (() => `fld_${Math.random().toString(36).slice(2, 10)}`);
    return clampFieldToPage({
        ...field,
        id: makeId(field),
        x: num(field.x, 0) + DUPLICATE_OFFSET_PCT,
        y: num(field.y, 0) + DUPLICATE_OFFSET_PCT,
    });
}

/**
 * Copy the selected fields onto other pages.
 *
 * Relative geometry is preserved exactly — a signature block that sits at the
 * bottom-right of page 1 lands at the bottom-right of every target page — and
 * every copy is clamped, so no copy can end up off the page. The source page is
 * skipped: "copy to all pages" should not silently double the fields you
 * already have.
 *
 * @param {object[]} fields  the full field array
 * @param {string[]} selectedIds
 * @param {number[]} targetPages  1-based page numbers
 * @param {(field: object, page: number) => string} [idFactory]
 * @returns {{ fields: object[], created: object[] }}
 */
export function copyFieldsToPages(fields = [], selectedIds = [], targetPages = [], idFactory) {
    const source = (Array.isArray(fields) ? fields : []).filter(
        (field) => field && selectedIds.includes(field.id),
    );
    if (source.length === 0 || targetPages.length === 0) {
        return { fields: Array.isArray(fields) ? fields : [], created: [] };
    }

    const makeId = idFactory || (() => `fld_${Math.random().toString(36).slice(2, 10)}`);
    const created = [];

    for (const page of [...new Set(targetPages)].sort((a, b) => a - b)) {
        if (!Number.isInteger(page) || page < 1) continue;
        for (const field of source) {
            // Skip the page the field already lives on.
            if (num(field.page, 1) === page) continue;
            created.push(clampFieldToPage({ ...field, id: makeId(field, page), page }));
        }
    }

    return { fields: [...fields, ...created], created };
}

/** Page numbers 1..total, for "copy to all pages". */
export function allPages(total) {
    const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
    return Array.from({ length: count }, (_, index) => index + 1);
}

/** Apply one geometry patch to a set of fields, clamping each result. */
export function updateFields(fields = [], ids = [], patch) {
    const selected = new Set(ids);
    return (Array.isArray(fields) ? fields : []).map((field) => {
        if (!field || !selected.has(field.id)) return field;
        const next = typeof patch === 'function' ? patch(field) : { ...field, ...patch };
        return clampFieldToPage(next);
    });
}

/** Remove a set of fields. Used by multi-field delete, which must be undoable. */
export function removeFields(fields = [], ids = []) {
    const selected = new Set(ids);
    return (Array.isArray(fields) ? fields : []).filter((field) => field && !selected.has(field.id));
}

/** Fields grouped by page, in page order, for the placed-fields list. */
export function groupFieldsByPage(fields = []) {
    const byPage = new Map();
    for (const field of Array.isArray(fields) ? fields : []) {
        if (!field) continue;
        const page = num(field.page, 1) || 1;
        if (!byPage.has(page)) byPage.set(page, []);
        byPage.get(page).push(field);
    }
    return [...byPage.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([page, pageFields]) => ({ page, fields: pageFields }));
}

/** How many fields sit on each page — for the thumbnail badges. */
export function countFieldsByPage(fields = []) {
    const counts = {};
    for (const field of Array.isArray(fields) ? fields : []) {
        if (!field) continue;
        const page = num(field.page, 1) || 1;
        counts[page] = (counts[page] || 0) + 1;
    }
    return counts;
}
