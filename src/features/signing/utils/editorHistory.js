/**
 * Editor undo/redo history for the E-Docs field canvas.
 *
 * Pure and dependency-free: a history is a plain `{ entries, index }` value and
 * every operation returns a new one. The editor holds it in state, so React
 * owns the lifecycle and these functions stay trivially testable.
 *
 * WHAT IS RECORDED: only the local placed-field array — the same objects the
 * canvas already renders and the serializer already persists. Nothing here ever
 * touches Firestore documents, Storage paths, signing tokens, recipient details
 * or AI provider responses; a history entry is editor geometry and labels and
 * nothing else.
 *
 * WHAT IS NOT RECORDED: zoom, page navigation, panel/tab selection and field
 * selection. Those are view state — undoing a zoom change would be surprising,
 * and worse, it would bury the field edit the user actually meant to undo.
 *
 * COALESCING: a pointer drag or resize already commits once (react-draggable's
 * `onStop`, and the resize handle's `mouseup`), so those are naturally one entry
 * each. Keyboard nudges are not — holding an arrow key emits one update per
 * repeat. `coalesceKey` merges consecutive same-kind edits to the same field
 * inside a short window into a single entry, so one gesture stays one undo.
 */

/** Maximum retained states, including the base. Older states are dropped. */
export const HISTORY_LIMIT = 60;

/** Consecutive same-key edits inside this window collapse into one entry. */
export const COALESCE_WINDOW_MS = 600;

const asFields = (fields) => (Array.isArray(fields) ? fields : []);

/**
 * A fresh history whose only state is `fields`.
 *
 * Used for the initial mount and for every safe reset point: hydration
 * completing, the PDF being replaced, and a successful save. After a reset there
 * is nothing to undo — undoing past a save would silently reintroduce fields the
 * server no longer has.
 */
export function createHistory(fields = []) {
    return {
        entries: [{ label: 'Initial state', fields: asFields(fields), coalesceKey: null, at: 0 }],
        index: 0,
    };
}

/** The field array the history currently points at. */
export function currentFields(history) {
    const entry = history?.entries?.[history?.index];
    return entry ? entry.fields : [];
}

export function canUndo(history) {
    return Boolean(history) && history.index > 0;
}

export function canRedo(history) {
    return Boolean(history) && history.index < (history.entries?.length ?? 0) - 1;
}

/** Human-readable label of the change undo would reverse, for announcements. */
export function undoLabel(history) {
    if (!canUndo(history)) return '';
    return history.entries[history.index]?.label || '';
}

/** Human-readable label of the change redo would reapply. */
export function redoLabel(history) {
    if (!canRedo(history)) return '';
    return history.entries[history.index + 1]?.label || '';
}

/**
 * Record a new state.
 *
 * @param {object} history
 * @param {object[]} fields  the field array AFTER the change
 * @param {object} [options]
 * @param {string} [options.label] what changed, for the announcement
 * @param {string|null} [options.coalesceKey] merge key for one continuous gesture
 * @param {number} [options.at] timestamp, injectable for tests
 * @param {number} [options.coalesceWindowMs]
 */
export function pushHistory(history, fields, options = {}) {
    const base = history || createHistory();
    const {
        label = 'Edit',
        coalesceKey = null,
        at = Date.now(),
        coalesceWindowMs = COALESCE_WINDOW_MS,
    } = options;

    const next = asFields(fields);
    const current = base.entries[base.index];

    // Nothing actually changed — do not spend an undo step on it.
    if (current && current.fields === next) return base;

    // One continuous gesture (a run of arrow-key nudges, a slider drag) collapses
    // into a single entry so one Ctrl+Z reverses the whole gesture.
    const canCoalesce =
        coalesceKey !== null &&
        current &&
        current.coalesceKey === coalesceKey &&
        at - current.at <= coalesceWindowMs &&
        // Never coalesce into the base state: that would make the original
        // fields unreachable.
        base.index > 0;

    if (canCoalesce) {
        const entries = base.entries.slice(0, base.index + 1);
        entries[base.index] = { ...current, fields: next, at };
        return { entries, index: base.index };
    }

    // A new change after an undo discards the redo tail.
    const kept = base.entries.slice(0, base.index + 1);
    kept.push({ label, fields: next, coalesceKey, at });

    if (kept.length > HISTORY_LIMIT) {
        const overflow = kept.length - HISTORY_LIMIT;
        return { entries: kept.slice(overflow), index: kept.length - overflow - 1 };
    }

    return { entries: kept, index: kept.length - 1 };
}

/** Step back one state. Returns the same history when there is nothing to undo. */
export function undoHistory(history) {
    if (!canUndo(history)) return history;
    return { entries: history.entries, index: history.index - 1 };
}

/** Step forward one state. Returns the same history when there is nothing to redo. */
export function redoHistory(history) {
    if (!canRedo(history)) return history;
    return { entries: history.entries, index: history.index + 1 };
}

/**
 * Does this keyboard event mean undo?
 * Ctrl/⌘+Z without Shift.
 */
export function isUndoShortcut(event) {
    if (!event || !(event.ctrlKey || event.metaKey)) return false;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    return key === 'z' && !event.shiftKey;
}

/**
 * Does this keyboard event mean redo?
 * Ctrl/⌘+Shift+Z, or Ctrl/⌘+Y.
 */
export function isRedoShortcut(event) {
    if (!event || !(event.ctrlKey || event.metaKey)) return false;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (key === 'y') return true;
    return key === 'z' && event.shiftKey === true;
}
