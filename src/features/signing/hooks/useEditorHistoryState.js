// The envelope editor's undo/redo spine, split out of `EnvelopeCreator.jsx`
// on 2026-09-01 for the source-size standard (SG-1b). This hook owns the
// placed-field array, the history stack and the save state, and exposes the
// single write path (`commitFields`) every mutation must go through. Bodies
// verbatim from the component. Selection stays in the component; `stepHistory`
// prunes it through the `setSelectedFieldIds` the component passes in.
import { useState, useRef, useEffect, useCallback } from 'react';
import {
    createHistory,
    currentFields,
    pushHistory,
    redoHistory,
    undoHistory,
} from '@features/signing/utils/editorHistory';
import { SAVE_STATES } from '@features/signing/utils/editorSaveState';

export function useEditorHistoryState({ setSelectedFieldIds }) {
    const [fields, setFields] = useState([]);
    const [history, setHistory] = useState(() => createHistory([]));
    const [saveState, setSaveState] = useState(SAVE_STATES.CLEAN);
    const historyRef = useRef(history);
    // The keydown listener is registered once on mount, so it reads the
    // handlers through refs rather than closing over a stale render.
    const handleUndoRef = useRef(() => {});
    const handleRedoRef = useRef(() => {});
    const commitFieldsRef = useRef(() => {});
    const fieldsRef = useRef([]);

    useEffect(() => {
        fieldsRef.current = fields;
    }, [fields]);

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    /**
     * The single write path for placed fields.
     *
     * Every mutation goes through here so it lands in the undo history and
     * marks the document unsaved. `fieldsRef` is updated eagerly so two commits
     * inside one tick still see each other, and the history push happens
     * outside the state updater so a double-invoked updater cannot record the
     * same change twice.
     */
    const commitFields = useCallback((updater, { label = 'Edit', coalesceKey = null } = {}) => {
        const previous = fieldsRef.current;
        const next = typeof updater === 'function' ? updater(previous) : updater;
        if (next === previous) return;
        fieldsRef.current = next;
        setFields(next);
        const nextHistory = pushHistory(historyRef.current, next, { label, coalesceKey });
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);

    /** Replace both the fields and the history at a safe reset point. */
    const resetEditorHistory = useCallback((nextFields, { markClean = true } = {}) => {
        const base = createHistory(nextFields);
        fieldsRef.current = nextFields;
        historyRef.current = base;
        setFields(nextFields);
        setHistory(base);
        if (markClean) setSaveState(SAVE_STATES.CLEAN);
    }, []);

    const stepHistory = useCallback((step) => {
        const next = step(historyRef.current);
        if (next === historyRef.current) return;
        historyRef.current = next;
        setHistory(next);
        const restored = currentFields(next);
        fieldsRef.current = restored;
        setFields(restored);
        setSaveState(SAVE_STATES.UNSAVED);
        // Keep only the selected fields that still exist.
        const alive = new Set(restored.map((field) => field.id));
        setSelectedFieldIds((previous) => previous.filter((id) => alive.has(id)));
    }, [setSelectedFieldIds]);

    const handleUndo = useCallback(() => stepHistory(undoHistory), [stepHistory]);
    const handleRedo = useCallback(() => stepHistory(redoHistory), [stepHistory]);

    useEffect(() => {
        handleUndoRef.current = handleUndo;
        handleRedoRef.current = handleRedo;
        commitFieldsRef.current = commitFields;
    }, [handleUndo, handleRedo, commitFields]);

    const markSaved = useCallback(() => {
        setSaveState(SAVE_STATES.SAVED);
        historyRef.current = createHistory(fieldsRef.current);
        setHistory(historyRef.current);
    }, []);

    return {
        fields,
        history,
        saveState,
        setSaveState,
        fieldsRef,
        commitFields,
        resetEditorHistory,
        handleUndo,
        handleRedo,
        handleUndoRef,
        handleRedoRef,
        commitFieldsRef,
        markSaved,
    };
}
