// The envelope editor's keyboard shortcuts — undo/redo and field copy/paste —
// split out of `EnvelopeCreator.jsx` on 2026-09-01 for the source-size
// standard (SG-1b). The listener is registered once on mount and reads
// everything through the refs the component (and its history hook) passes in,
// exactly as it did in place; the clipboard ref lives here because nothing
// else reads it. Bodies verbatim.
import { useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    cloneFieldWithoutId,
    computeNextPasteRect,
    isEditableKeyboardTarget,
} from '@features/signing/utils/envelopeFieldClipboard';
import {
    isRedoShortcut,
    isUndoShortcut,
} from '@features/signing/utils/editorHistory';

export function useFieldClipboardShortcuts({
    fieldsRef,
    selectedFieldIdRef,
    fileRef,
    commitFieldsRef,
    handleUndoRef,
    handleRedoRef,
    setSelectedFieldIds,
}) {
    const envelopeClipboardRef = useRef(null);

    useEffect(() => {
        const onKeyDown = (e) => {
            const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
            if (!(e.ctrlKey || e.metaKey) || !key) return;

            // Undo/redo come first: they must work even with a field selected,
            // and they are not text-editing operations.
            if (isRedoShortcut(e)) {
                if (isEditableKeyboardTarget(e.target)) return;
                e.preventDefault();
                handleRedoRef.current();
                return;
            }
            if (isUndoShortcut(e)) {
                if (isEditableKeyboardTarget(e.target)) return;
                e.preventDefault();
                handleUndoRef.current();
                return;
            }

            if (key === 'c') {
                if (isEditableKeyboardTarget(e.target)) return;
                const fid = selectedFieldIdRef.current;
                if (!fid || !fileRef.current) return;
                const field = fieldsRef.current.find((f) => f.id === fid);
                if (!field) return;
                e.preventDefault();
                const template = cloneFieldWithoutId(field);
                const anchorRect = {
                    x: field.x,
                    y: field.y,
                    width: field.width,
                    height: field.height,
                    page: field.page,
                };
                envelopeClipboardRef.current = {
                    template,
                    anchor: anchorRect,
                    lastPlaced: { ...anchorRect },
                };
                return;
            }

            if (key === 'v') {
                if (isEditableKeyboardTarget(e.target)) return;
                const clip = envelopeClipboardRef.current;
                if (!clip?.template || !fileRef.current) return;
                e.preventDefault();
                const { template, anchor, lastPlaced } = clip;
                const rect = computeNextPasteRect(lastPlaced, anchor, template.width, template.height);
                const newField = {
                    ...template,
                    id: uuidv4(),
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    page: rect.page,
                };
                commitFieldsRef.current((prev) => [...prev, newField], { label: 'Paste field' });
                setSelectedFieldIds([newField.id]);
                envelopeClipboardRef.current = {
                    ...clip,
                    lastPlaced: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        page: rect.page,
                    },
                };
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
        // Everything the listener needs is read through refs, so it is
        // registered once on mount rather than on every field change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
