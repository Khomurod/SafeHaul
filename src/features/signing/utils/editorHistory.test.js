// Editor undo/redo history. Pure value semantics, coalescing, truncation,
// limits and the keyboard shortcut predicates. Every field below is artificial.
import { describe, expect, it } from 'vitest';
import {
    COALESCE_WINDOW_MS,
    HISTORY_LIMIT,
    canRedo,
    canUndo,
    createHistory,
    currentFields,
    isRedoShortcut,
    isUndoShortcut,
    pushHistory,
    redoHistory,
    redoLabel,
    undoHistory,
    undoLabel,
} from './editorHistory';

const field = (id, overrides = {}) => ({
    id,
    type: 'text',
    label: `Field ${id}`,
    page: 1,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    ...overrides,
});

describe('createHistory', () => {
    it('starts with the given fields and nothing to undo or redo', () => {
        const history = createHistory([field('a')]);
        expect(currentFields(history)).toEqual([field('a')]);
        expect(canUndo(history)).toBe(false);
        expect(canRedo(history)).toBe(false);
    });

    it('tolerates a missing or non-array starting value', () => {
        expect(currentFields(createHistory())).toEqual([]);
        expect(currentFields(createHistory(null))).toEqual([]);
        expect(currentFields(createHistory('nope'))).toEqual([]);
    });
});

describe('pushHistory', () => {
    it('records a new state and makes it undoable', () => {
        const start = createHistory([]);
        const next = pushHistory(start, [field('a')], { label: 'Add Text', at: 1000 });

        expect(currentFields(next)).toEqual([field('a')]);
        expect(canUndo(next)).toBe(true);
        expect(canRedo(next)).toBe(false);
        expect(undoLabel(next)).toBe('Add Text');
    });

    it('leaves the original history untouched', () => {
        const start = createHistory([]);
        pushHistory(start, [field('a')], { at: 1000 });
        expect(currentFields(start)).toEqual([]);
        expect(start.entries).toHaveLength(1);
    });

    it('ignores a push whose fields are the identical array', () => {
        const fields = [field('a')];
        const start = createHistory(fields);
        expect(pushHistory(start, fields, { at: 1000 })).toBe(start);
    });

    it('discards the redo tail when a new change follows an undo', () => {
        let history = createHistory([]);
        history = pushHistory(history, [field('a')], { label: 'First', at: 1000 });
        history = pushHistory(history, [field('a'), field('b')], { label: 'Second', at: 2000 });
        history = undoHistory(history);
        expect(canRedo(history)).toBe(true);

        history = pushHistory(history, [field('a'), field('c')], { label: 'Third', at: 3000 });
        expect(canRedo(history)).toBe(false);
        expect(currentFields(history).map((f) => f.id)).toEqual(['a', 'c']);
    });

    it('drops the oldest states past the limit', () => {
        let history = createHistory([]);
        for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
            history = pushHistory(history, [field(`f${i}`)], { label: `Edit ${i}`, at: i * 10_000 });
        }
        expect(history.entries).toHaveLength(HISTORY_LIMIT);
        // Still points at the newest state.
        expect(currentFields(history)[0].id).toBe(`f${HISTORY_LIMIT + 9}`);
    });
});

describe('coalescing', () => {
    it('merges consecutive same-key edits inside the window into one entry', () => {
        let history = createHistory([field('a')]);
        history = pushHistory(history, [field('a', { x: 11 })], {
            label: 'Move Field a',
            coalesceKey: 'move:a',
            at: 1000,
        });
        const afterFirst = history.entries.length;

        history = pushHistory(history, [field('a', { x: 12 })], {
            label: 'Move Field a',
            coalesceKey: 'move:a',
            at: 1100,
        });
        history = pushHistory(history, [field('a', { x: 13 })], {
            label: 'Move Field a',
            coalesceKey: 'move:a',
            at: 1200,
        });

        expect(history.entries).toHaveLength(afterFirst);
        expect(currentFields(history)[0].x).toBe(13);

        // One undo reverses the whole gesture.
        history = undoHistory(history);
        expect(currentFields(history)[0].x).toBe(10);
    });

    it('starts a new entry once the window lapses', () => {
        let history = createHistory([field('a')]);
        history = pushHistory(history, [field('a', { x: 11 })], { coalesceKey: 'move:a', at: 1000 });
        history = pushHistory(history, [field('a', { x: 12 })], {
            coalesceKey: 'move:a',
            at: 1000 + COALESCE_WINDOW_MS + 1,
        });
        expect(history.entries).toHaveLength(3);
    });

    it('does not merge across different fields or different kinds of edit', () => {
        let history = createHistory([field('a'), field('b')]);
        history = pushHistory(history, [field('a', { x: 11 }), field('b')], { coalesceKey: 'move:a', at: 1000 });
        history = pushHistory(history, [field('a', { x: 11 }), field('b', { x: 11 })], { coalesceKey: 'move:b', at: 1050 });
        history = pushHistory(history, [field('a', { x: 11, width: 30 }), field('b', { x: 11 })], { coalesceKey: 'resize:a', at: 1100 });
        expect(history.entries).toHaveLength(4);
    });

    it('never coalesces into the base state', () => {
        // Otherwise the very first gesture would overwrite the original fields
        // and become impossible to undo.
        let history = createHistory([field('a')]);
        history = pushHistory(history, [field('a', { x: 11 })], { coalesceKey: 'move:a', at: 1000 });
        expect(history.entries).toHaveLength(2);
        expect(currentFields(undoHistory(history))[0].x).toBe(10);
    });

    it('does not coalesce when no key is supplied', () => {
        let history = createHistory([field('a')]);
        history = pushHistory(history, [field('a', { label: 'x' })], { at: 1000 });
        history = pushHistory(history, [field('a', { label: 'xy' })], { at: 1010 });
        expect(history.entries).toHaveLength(3);
    });
});

describe('undo and redo', () => {
    it('steps back and forward through states', () => {
        let history = createHistory([]);
        history = pushHistory(history, [field('a')], { label: 'Add a', at: 1000 });
        history = pushHistory(history, [field('a'), field('b')], { label: 'Add b', at: 2000 });

        history = undoHistory(history);
        expect(currentFields(history).map((f) => f.id)).toEqual(['a']);
        expect(redoLabel(history)).toBe('Add b');

        history = undoHistory(history);
        expect(currentFields(history)).toEqual([]);
        expect(canUndo(history)).toBe(false);

        history = redoHistory(history);
        expect(currentFields(history).map((f) => f.id)).toEqual(['a']);
        history = redoHistory(history);
        expect(currentFields(history).map((f) => f.id)).toEqual(['a', 'b']);
        expect(canRedo(history)).toBe(false);
    });

    it('is a no-op at either end', () => {
        const start = createHistory([field('a')]);
        expect(undoHistory(start)).toBe(start);
        expect(redoHistory(start)).toBe(start);
        expect(undoLabel(start)).toBe('');
        expect(redoLabel(start)).toBe('');
    });

    it('survives being called on a missing history', () => {
        expect(canUndo(null)).toBe(false);
        expect(canRedo(undefined)).toBe(false);
        expect(currentFields(null)).toEqual([]);
    });
});

describe('keyboard shortcuts', () => {
    const event = (overrides) => ({ ctrlKey: false, metaKey: false, shiftKey: false, key: 'z', ...overrides });

    it('recognises undo on both platforms', () => {
        expect(isUndoShortcut(event({ ctrlKey: true }))).toBe(true);
        expect(isUndoShortcut(event({ metaKey: true }))).toBe(true);
        expect(isUndoShortcut(event({ ctrlKey: true, key: 'Z' }))).toBe(true);
    });

    it('recognises both redo conventions', () => {
        expect(isRedoShortcut(event({ ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(isRedoShortcut(event({ metaKey: true, shiftKey: true }))).toBe(true);
        expect(isRedoShortcut(event({ ctrlKey: true, key: 'y' }))).toBe(true);
    });

    it('keeps undo and redo distinct', () => {
        expect(isUndoShortcut(event({ ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(isRedoShortcut(event({ ctrlKey: true }))).toBe(false);
    });

    it('ignores the plain key and unrelated modifiers', () => {
        expect(isUndoShortcut(event({}))).toBe(false);
        expect(isRedoShortcut(event({ shiftKey: true }))).toBe(false);
        expect(isUndoShortcut(event({ ctrlKey: true, key: 'c' }))).toBe(false);
        expect(isUndoShortcut(null)).toBe(false);
        expect(isRedoShortcut(undefined)).toBe(false);
    });
});
