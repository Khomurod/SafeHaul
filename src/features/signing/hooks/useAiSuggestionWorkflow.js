// The envelope editor's AI-suggestion review workflow, split out of
// `EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1c).
// Wraps `useAiFieldAssistant` and owns the review state around it — the scan
// dialog, the panel, the selected suggestion, and the one-level apply undo.
// Suggestions live entirely inside the assistant until the reviewer applies
// them; nothing here can save a template or send a document, and the ONLY
// path from suggestion to real field still appends through `commitFields`.
// Bodies verbatim from the component; the inspector tab stays in the
// component, which passes its setter in.
import { useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAiFieldAssistant } from './useAiFieldAssistant';
import {
    applySuggestionsToFields,
    selectHighConfidence,
} from '@features/signing/utils/aiFieldSuggestions';
import { INSPECTOR_TABS } from '@features/signing/utils/editorSaveState';

export function useAiSuggestionWorkflow({
    companyId,
    file,
    numPages,
    activePage,
    fields,
    fieldsRef,
    commitFields,
    setSelectedFieldIds,
    setInspectorTab,
    showSuccess,
}) {
    const [aiScanDialogOpen, setAiScanDialogOpen] = useState(false);
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [selectedSuggestionId, setSelectedSuggestionId] = useState(null);
    // One-level undo for the last "apply". Holds the ids of the fields that
    // apply appended — not a whole snapshot — so undoing removes exactly those
    // and leaves any work done since the apply untouched.
    const [aiUndoFieldIds, setAiUndoFieldIds] = useState([]);

    const aiAssistant = useAiFieldAssistant({
        companyId,
        file,
        numPages,
        activePage,
        fields,
    });

    const {
        startScan: startAiScan,
        suggestions: aiSuggestions,
        updateSuggestion: updateAiSuggestion,
        setSuggestionStatus: setAiSuggestionStatus,
        removeSuggestions: removeAiSuggestions,
        discardAll: discardAiSuggestions,
    } = aiAssistant;

    const openAiAssistant = useCallback(() => {
        setAiPanelOpen(true);
        setInspectorTab(INSPECTOR_TABS.AI);
        setAiScanDialogOpen(true);
    }, [setInspectorTab]);

    const handleAiScanStart = useCallback(
        ({ scope, selectedPages }) => {
            setAiScanDialogOpen(false);
            setAiPanelOpen(true);
            setInspectorTab(INSPECTOR_TABS.AI);
            setSelectedSuggestionId(null);
            startAiScan({ scope, selectedPages });
        },
        [startAiScan, setInspectorTab],
    );

    const toggleSuggestionAccepted = useCallback(
        (suggestionId) => {
            const current = aiSuggestions.find((item) => item.suggestionId === suggestionId);
            if (!current) return;
            setAiSuggestionStatus(suggestionId, current.status === 'accepted' ? 'pending' : 'accepted');
        },
        [aiSuggestions, setAiSuggestionStatus],
    );

    const rejectSuggestion = useCallback(
        (suggestionId) => {
            removeAiSuggestions([suggestionId]);
            setSelectedSuggestionId((prev) => (prev === suggestionId ? null : prev));
        },
        [removeAiSuggestions],
    );

    /**
     * The ONLY path from suggestion to real field. Appends; never deletes,
     * replaces or reorders an existing field, and never saves or sends.
     */
    const applySuggestions = useCallback(
        (toApply) => {
            if (!toApply.length) return;
            const { fields: nextFields, appended } = applySuggestionsToFields({
                fields: fieldsRef.current,
                suggestions: toApply,
                idFactory: () => uuidv4(),
            });
            // Remember WHICH fields this apply added, not a whole snapshot:
            // undoing must not throw away work done after the apply.
            setAiUndoFieldIds(appended.map((field) => field.id));
            commitFields(nextFields, { label: `Apply ${toApply.length} AI field(s)` });
            removeAiSuggestions(toApply.map((item) => item.suggestionId));
            setSelectedSuggestionId(null);
            showSuccess(`${toApply.length} field${toApply.length === 1 ? '' : 's'} placed. Review before saving.`);
        },
        [removeAiSuggestions, showSuccess, commitFields, fieldsRef],
    );

    const handleApplySelected = useCallback(() => {
        applySuggestions(aiSuggestions.filter((item) => item.status === 'accepted'));
    }, [aiSuggestions, applySuggestions]);

    const handleApplyHighConfidence = useCallback(() => {
        applySuggestions(selectHighConfidence(aiSuggestions));
    }, [aiSuggestions, applySuggestions]);

    /**
     * Undo the last apply by removing exactly the fields it added.
     *
     * Restoring a pre-apply snapshot instead would silently discard every field
     * the operator added, moved, renamed or deleted since — an undo that
     * destroys unrelated work is worse than no undo.
     */
    const handleAiUndo = useCallback(() => {
        if (aiUndoFieldIds.length === 0) return;
        const undoIds = new Set(aiUndoFieldIds);
        commitFields((prev) => prev.filter((field) => !undoIds.has(field.id)), { label: 'Undo AI placement' });
        setAiUndoFieldIds([]);
        setSelectedFieldIds((previous) => previous.filter((id) => !undoIds.has(id)));
        showSuccess('Last AI placement undone.');
    }, [aiUndoFieldIds, showSuccess, commitFields, setSelectedFieldIds]);

    const handleAiDiscardAll = useCallback(() => {
        discardAiSuggestions();
        setSelectedSuggestionId(null);
    }, [discardAiSuggestions]);

    const closeAiPanel = useCallback(() => {
        setAiPanelOpen(false);
        setSelectedSuggestionId(null);
        setInspectorTab(INSPECTOR_TABS.PROPERTIES);
    }, [setInspectorTab]);

    const moveSuggestion = useCallback(
        (suggestionId, x, y) => updateAiSuggestion(suggestionId, { x, y }),
        [updateAiSuggestion],
    );

    const resizeSuggestion = useCallback(
        (suggestionId, width, height) => updateAiSuggestion(suggestionId, { width, height }),
        [updateAiSuggestion],
    );

    const suggestionCountsByPage = useMemo(() => {
        const counts = {};
        for (const suggestion of aiSuggestions) {
            counts[suggestion.page] = (counts[suggestion.page] || 0) + 1;
        }
        return counts;
    }, [aiSuggestions]);
    const reviewPages = useMemo(
        () => [...new Set(aiAssistant.manualReview.map((entry) => entry.page).filter(Boolean))],
        [aiAssistant.manualReview],
    );

    return {
        aiAssistant,
        aiSuggestions,
        updateAiSuggestion,
        aiScanDialogOpen,
        setAiScanDialogOpen,
        aiPanelOpen,
        setAiPanelOpen,
        selectedSuggestionId,
        setSelectedSuggestionId,
        aiUndoFieldIds,
        openAiAssistant,
        handleAiScanStart,
        toggleSuggestionAccepted,
        rejectSuggestion,
        handleApplySelected,
        handleApplyHighConfidence,
        handleAiUndo,
        handleAiDiscardAll,
        closeAiPanel,
        moveSuggestion,
        resizeSuggestion,
        suggestionCountsByPage,
        reviewPages,
    };
}
