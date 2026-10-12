/**
 * Field property changes in the envelope editor, through the real undo history.
 *
 * Read Only and Prefill Behavior each change two properties. Written one at a
 * time they were two undo steps, so one Undo left a field read-only but
 * editable when prefilled. All fields are artificial.
 */
import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEditorHistoryState } from './useEditorHistoryState';
import { useEnvelopeFieldEditing } from './useEnvelopeFieldEditing';

const FIELD = { id: 'f1', type: 'text', label: 'Trailer number', page: 1, x: 10, y: 10, width: 30, height: 5, readOnly: false, prefillPolicy: 'editable' };

function useEditor() {
    const [selectedFieldIds, setSelectedFieldIds] = useState([FIELD.id]);
    const selectedFieldIdsRef = useRef(selectedFieldIds);
    const history = useEditorHistoryState({ setSelectedFieldIds });
    const editing = useEnvelopeFieldEditing({
        commitFields: history.commitFields,
        fieldsRef: history.fieldsRef,
        selectedFieldIdsRef,
        setSelectedFieldIds,
        file: null,
        activePage: 1,
        selectedFieldId: selectedFieldIds[0],
    });
    return { history, editing };
}

const lockOf = (field) => ({ readOnly: field.readOnly, prefillPolicy: field.prefillPolicy });

describe('updateActiveField', () => {
    it('changes Read Only and its prefill policy as one step, so one Undo reverses both', () => {
        const { result } = renderHook(() => useEditor());
        act(() => result.current.history.resetEditorHistory([FIELD]));

        act(() => result.current.editing.updateActiveField({ readOnly: true, prefillPolicy: 'locked' }));
        expect(lockOf(result.current.history.fields[0])).toEqual({ readOnly: true, prefillPolicy: 'locked' });

        act(() => result.current.history.handleUndo());
        expect(lockOf(result.current.history.fields[0])).toEqual({ readOnly: false, prefillPolicy: 'editable' });
    });

    it('still changes one property by name', () => {
        const { result } = renderHook(() => useEditor());
        act(() => result.current.history.resetEditorHistory([FIELD]));

        act(() => result.current.editing.updateActiveField('label', 'Unit number'));
        expect(result.current.history.fields[0].label).toBe('Unit number');

        act(() => result.current.history.handleUndo());
        expect(result.current.history.fields[0].label).toBe('Trailer number');
    });
});
