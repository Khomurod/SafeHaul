import { isFieldLocked } from './prefillEngine';

/**
 * Reading-order helpers for signer fields. The signing room renders fields as
 * overlays anchored to the PDF, but navigation ("next field", progress, the
 * keyboard Enter key) needs a deterministic order: page, then top-to-bottom,
 * then left-to-right.
 */
export function sortFieldsForFlow(fields) {
    return [...(fields || [])].filter(Boolean).sort((a, b) => {
        const pa = Number(a.pageNumber) || 1;
        const pb = Number(b.pageNumber) || 1;
        if (pa !== pb) return pa - pb;
        const ya = Number(a.yPosition) || 0;
        const yb = Number(b.yPosition) || 0;
        if (ya !== yb) return ya - yb;
        return (Number(a.xPosition) || 0) - (Number(b.xPosition) || 0);
    });
}

/** A field counts as complete when it has a value; locked/optional fields never block. */
export function isFieldComplete(field, value) {
    if (!field) return true;
    if (isFieldLocked(field)) return true;
    if (!field.required) return true;
    if (field.type === 'checkbox') return value === true;
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

/** First required field (in reading order) the signer still has to fill. */
export function findFirstIncompleteField(orderedFields, values = {}) {
    return (
        (orderedFields || []).find(
            (f) => f && !isFieldLocked(f) && f.required && !isFieldComplete(f, values[f.id]),
        ) || null
    );
}

/**
 * Next fillable field after `currentId` in reading order (locked fields are
 * skipped — the signer cannot interact with them). Returns null at the end.
 */
export function findNextField(orderedFields, currentId) {
    const list = orderedFields || [];
    const idx = list.findIndex((f) => f && f.id === currentId);
    if (idx === -1) return null;
    for (let i = idx + 1; i < list.length; i += 1) {
        if (list[i] && !isFieldLocked(list[i])) return list[i];
    }
    return null;
}
