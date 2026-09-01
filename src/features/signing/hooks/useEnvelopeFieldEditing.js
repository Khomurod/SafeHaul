// The envelope editor's field-manipulation handlers, split out of
// `EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1b).
// Everything here is a mutation of the placed-field array routed through the
// history hook's `commitFields`, plus the purely visual drag guides. Bodies
// verbatim from the component; `file`, `activePage` and `selectedFieldId` are
// hook arguments now, and each useCallback keeps its original dependency list
// with those names unchanged.
import { useState, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FIELD_TEMPLATES } from '../components/envelope-creator/fieldDefinitions';
import {
    alignFields,
    copyFieldsToPages,
    duplicateField,
    matchFieldSize,
    snapFieldPosition,
} from '@features/signing/utils/fieldGeometry';

export function useEnvelopeFieldEditing({
    commitFields,
    fieldsRef,
    selectedFieldIdsRef,
    setSelectedFieldIds,
    file,
    activePage,
    selectedFieldId,
}) {
    // Guides for the field currently under the pointer. Purely visual — it is
    // never part of the document and never enters the undo history.
    const [dragGuides, setDragGuides] = useState(null);

    // PHASE 2: Updated addField using templates
    const addField = useCallback((templateId) => {
        if (!file) return;
        const template = FIELD_TEMPLATES[templateId];
        if (!template) return;

        let w = 25, h = 5;
        if (template.type === 'checkbox') { w = 4; h = 3; }
        if (template.type === 'text') { w = 30; h = 5; }
        if (template.type === 'date') { w = 20; h = 5; }
        if (template.type === 'initial') { w = 15; h = 4; }

        // FEAT-1: Place field on the currently visible page instead of always page 1
        const newField = {
            id: uuidv4(),
            ...template,
            page: activePage,
            x: 10, y: 10,
            width: w, height: h,
        };
        commitFields(prev => [...prev, newField], { label: `Add ${template.label || templateId} field` });
    }, [file, activePage, commitFields]);

    const removeField = useCallback((id) => {
        commitFields(prev => prev.filter(f => f.id !== id), { label: 'Remove field' });
        setSelectedFieldIds((previous) => previous.filter((value) => value !== id));
    }, [commitFields, setSelectedFieldIds]);

    /**
     * Live alignment guides while a field is under the pointer.
     *
     * Read-only: it computes what the drop *would* snap to and shows it. No
     * field is touched, so a drag that is abandoned changes nothing and adds no
     * history entry.
     */
    const handleFieldDragMove = useCallback((id, pageNum, xPercent, yPercent) => {
        const current = fieldsRef.current;
        const moving = current.find((f) => f.id === id);
        if (!moving) return;
        const others = current.filter((f) => f.id !== id && f.page === pageNum);
        const { guides } = snapFieldPosition({ ...moving, x: xPercent, y: yPercent, page: pageNum }, others);
        setDragGuides(guides.length > 0 ? { page: pageNum, guides } : null);
    }, [fieldsRef]);

    // One completed drag is one history entry: react-draggable commits once on
    // `onStop`, and the coalesce key merges a run of keyboard nudges.
    //
    // Snapping applies to pointer drags only (`options.snap`). Arrow-key
    // placement stays exact to the percent, because the keyboard is the
    // precision path — silently pulling a nudge onto a guide would make it
    // impossible to sit a field just off centre.
    const updateFieldPosition = useCallback((id, pageNum, xPercent, yPercent, options = {}) => {
        setDragGuides(null);
        commitFields(
            (prev) => {
                const moving = prev.find((f) => f.id === id);
                if (!moving) return prev;
                let x = xPercent;
                let y = yPercent;
                if (options?.snap) {
                    const others = prev.filter((f) => f.id !== id && f.page === pageNum);
                    const snapped = snapFieldPosition({ ...moving, x, y, page: pageNum }, others);
                    x = snapped.x;
                    y = snapped.y;
                }
                return prev.map((f) => (f.id === id ? { ...f, x, y, page: pageNum } : f));
            },
            { label: 'Move field', coalesceKey: `move:${id}` },
        );
    }, [commitFields]);

    const updateFieldSize = useCallback((id, widthPercent, heightPercent) => {
        commitFields(
            prev => prev.map(f => f.id === id ? { ...f, width: widthPercent, height: heightPercent } : f),
            { label: 'Resize field', coalesceKey: `resize:${id}` },
        );
    }, [commitFields]);

    const updateFieldLabel = useCallback((id, newLabel) => {
        commitFields(
            prev => prev.map(f => f.id === id ? { ...f, label: newLabel } : f),
            { label: 'Rename field', coalesceKey: `label:${id}` },
        );
    }, [commitFields]);

    // PHASE 3: Update any property on the active field
    const updateActiveField = useCallback((key, value) => {
        if (!selectedFieldId) return;
        commitFields(
            prev => prev.map(f => f.id === selectedFieldId ? { ...f, [key]: value } : f),
            { label: 'Change field property', coalesceKey: `prop:${selectedFieldId}:${key}` },
        );
    }, [selectedFieldId, commitFields]);

    /**
     * Bulk field tools.
     *
     * All of them go through `commitFields`, so each one is exactly one undo
     * step, and all of them are pure geometry on the local field array — no
     * Firestore, no Storage, no callable.
     *
     * Copies get their own ids. The suffix guarantees uniqueness even where the
     * id source repeats within a tick, which matters because a copy that shared
     * an id with its source would silently overwrite it on save.
     */
    const copySequenceRef = useRef(0);
    const nextCopyId = useCallback(() => {
        copySequenceRef.current += 1;
        return `${uuidv4()}_${copySequenceRef.current}`;
    }, []);

    const handleAlignFields = useCallback((mode) => {
        commitFields(
            (prev) => alignFields(prev, selectedFieldIdsRef.current, mode),
            { label: `Align ${mode}` },
        );
    }, [commitFields, selectedFieldIdsRef]);

    const handleMatchFieldSize = useCallback((dimension) => {
        commitFields(
            (prev) => matchFieldSize(prev, selectedFieldIdsRef.current, dimension),
            { label: `Match ${dimension}` },
        );
    }, [commitFields, selectedFieldIdsRef]);

    const handleDuplicateSelection = useCallback(() => {
        const ids = selectedFieldIdsRef.current;
        if (ids.length === 0) return;
        const created = [];
        commitFields((prev) => {
            const copies = prev
                .filter((field) => ids.includes(field.id))
                .map((field) => duplicateField(field, nextCopyId))
                .filter(Boolean);
            if (copies.length === 0) return prev;
            created.push(...copies.map((copy) => copy.id));
            return [...prev, ...copies];
        }, { label: `Duplicate ${ids.length} field${ids.length === 1 ? '' : 's'}` });
        // The copies become the selection, so the next nudge moves them and not
        // the originals underneath.
        if (created.length > 0) setSelectedFieldIds(created);
    }, [commitFields, nextCopyId, selectedFieldIdsRef, setSelectedFieldIds]);

    const handleCopyToPages = useCallback((targetPages, label) => {
        const ids = selectedFieldIdsRef.current;
        if (ids.length === 0 || targetPages.length === 0) return;
        commitFields(
            (prev) => copyFieldsToPages(prev, ids, targetPages, nextCopyId).fields,
            { label },
        );
    }, [commitFields, nextCopyId, selectedFieldIdsRef]);

    return {
        dragGuides,
        addField,
        removeField,
        handleFieldDragMove,
        updateFieldPosition,
        updateFieldSize,
        updateFieldLabel,
        updateActiveField,
        handleAlignFields,
        handleMatchFieldSize,
        handleDuplicateSelection,
        handleCopyToPages,
    };
}
