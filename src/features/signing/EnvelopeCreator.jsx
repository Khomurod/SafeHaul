import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { db, storage, auth } from '@lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, Timestamp, writeBatch, doc, getDoc, updateDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@shared/components/feedback';
import {
    buildPrefillContext,
    normalizePrefillPolicy,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import {
    cloneFieldWithoutId,
    computeNextPasteRect,
    isEditableKeyboardTarget,
} from '@features/signing/utils/envelopeFieldClipboard';
import { serializeTemplateFields } from '@features/signing/utils/templateFieldSerializer';
import {
    PDF_VIEWPORT_WIDTH_DEFAULT,
    adjustPdfViewportWidth,
    clampPdfViewportWidth,
} from '@features/signing/utils/envelopePdfZoom';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { FIELD_TEMPLATES, getFieldIcon } from './components/envelope-creator/fieldDefinitions';
import { FieldPropertiesPanel } from './components/envelope-creator/FieldPropertiesPanel';
import { EditorInspector } from './components/envelope-creator/EditorInspector';
import { EnvelopeSidebar } from './components/envelope-creator/EnvelopeSidebar';
import { PdfFieldWorkbench } from './components/envelope-creator/PdfFieldWorkbench';
import { AiScanOptionsDialog } from './components/envelope-creator/AiScanOptionsDialog';
import { AiSuggestionReviewPanel } from './components/envelope-creator/AiSuggestionReviewPanel';
import { useAiFieldAssistant } from './hooks/useAiFieldAssistant';
import {
    applySuggestionsToFields,
    selectHighConfidence,
} from '@features/signing/utils/aiFieldSuggestions';
import { EditorTopBar } from './components/envelope-creator/EditorTopBar';
import { EditorCanvasToolbar } from './components/envelope-creator/EditorCanvasToolbar';
import { PageThumbnailRail } from './components/envelope-creator/PageThumbnailRail';
import { SignerPreviewDialog } from './components/envelope-creator/SignerPreviewDialog';
import {
    canRedo as historyCanRedo,
    canUndo as historyCanUndo,
    createHistory,
    currentFields,
    isRedoShortcut,
    isUndoShortcut,
    pushHistory,
    redoHistory,
    undoHistory,
} from '@features/signing/utils/editorHistory';
import {
    INSPECTOR_TABS,
    SAVE_STATES,
    hasUnsavedWork,
    resolveEditorMode,
} from '@features/signing/utils/editorSaveState';
import {
    alignFields,
    allPages,
    copyFieldsToPages,
    countFieldsByPage,
    duplicateField,
    matchFieldSize,
    snapFieldPosition,
    toggleSelection,
} from '@features/signing/utils/fieldGeometry';
import { FieldToolsPanel } from './components/envelope-creator/FieldToolsPanel';
import { EditorBottomSheet } from './components/envelope-creator/EditorBottomSheet';
import { EditorMobileBar } from './components/envelope-creator/EditorMobileBar';
import { useCompactEditor } from './hooks/useCompactEditor';

/**
 * EnvelopeCreator — one-off signing request + template editor.
 *
 * Split for readability (behavior unchanged):
 *  - ./components/envelope-creator/fieldDefinitions.jsx       — field palette definitions + icons
 *  - ./components/envelope-creator/ResizableDraggableField.jsx — field overlay editor
 *  - ./components/envelope-creator/FieldPropertiesPanel.jsx    — right sidebar
 *  - ./components/envelope-creator/EnvelopeSidebar.jsx         — recipient/delivery + field palette
 *  - ./components/envelope-creator/PdfFieldWorkbench.jsx       — PDF canvas/viewer with overlays
 * State, hydration, and the save/send action stay here.
 */

// Upload ceiling. MUST stay <= the storage-rule limit (isValidFile in
// src/storage.rules), otherwise the client accepts files the server rejects.
const MAX_UPLOAD_MB = 20;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export default function EnvelopeCreator({
    companyId,
    onClose,
    initialMode = 'request',
    editRequestId = null,
    editTemplateId = null,
    companyName = '',
}) {
    const { showSuccess, showError } = useToast();
    const [file, setFile] = useState(null);
    const [numPages, setNumPages] = useState(null);
    const [loading, setLoading] = useState(false);
    const [hydrating, setHydrating] = useState(Boolean(editRequestId || editTemplateId));
    const [creatorMode, setCreatorMode] = useState(editTemplateId ? 'template' : initialMode); // 'request' or 'template'
    const [existingStoragePath, setExistingStoragePath] = useState('');

    /**
     * Selection.
     *
     * The array is the source of truth and its FIRST entry is the anchor: the
     * field the inspector edits and the one alignment and size-matching measure
     * against. `setSelectedFieldId(id)` replaces the selection,
     * `setSelectedFieldId(id, { additive: true })` toggles membership, and
     * `setSelectedFieldId(null)` clears it — so every existing caller keeps
     * working unchanged.
     */
    const [selectedFieldIds, setSelectedFieldIds] = useState([]);
    // Guides for the field currently under the pointer. Purely visual — it is
    // never part of the document and never enters the undo history.
    const [dragGuides, setDragGuides] = useState(null);
    const selectedFieldId = selectedFieldIds[0] ?? null;

    const setSelectedFieldId = useCallback((id, options = {}) => {
        setSelectedFieldIds((previous) => toggleSelection(previous, id, options?.additive === true));
    }, []);

    // FEAT-1: Track the currently visible page for multi-page field placement
    const [activePage, setActivePage] = useState(1);
    const pageRefs = useRef({});

    // Recipient details only needed for 'request' mode
    const [recipientEmail, setRecipientEmail] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    // ADV-2 FIX: Delivery method selector for one-off sends
    const [deliveryMethod, setDeliveryMethod] = useState('email'); // 'email' | 'sms' | 'both' | 'copy'
    const [title, setTitle] = useState('');

    const [fields, setFields] = useState([]);

    // --- AI Field Assistant -------------------------------------------------
    // Suggestions live entirely inside the assistant until the reviewer applies
    // them; nothing here can save a template or send a document.
    const [aiScanDialogOpen, setAiScanDialogOpen] = useState(false);
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [inspectorTab, setInspectorTab] = useState(INSPECTOR_TABS.PROPERTIES);
    // Compact editor: the desktop rails are replaced by a bottom toolbar and one
    // bottom sheet at a time, so the PDF keeps the screen.
    const isCompact = useCompactEditor();
    const [mobileSheet, setMobileSheet] = useState(null);
    const [selectedSuggestionId, setSelectedSuggestionId] = useState(null);
    // One-level undo for the last "apply". Holds the ids of the fields that
    // apply appended — not a whole snapshot — so undoing removes exactly those
    // and leaves any work done since the apply untouched.
    const [aiUndoFieldIds, setAiUndoFieldIds] = useState([]);

    // --- Editor shell -------------------------------------------------------
    const [history, setHistory] = useState(() => createHistory([]));
    const [saveState, setSaveState] = useState(SAVE_STATES.CLEAN);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [pendingClose, setPendingClose] = useState(false);
    const historyRef = useRef(history);
    const canvasRef = useRef(null);
    // The keydown listener is registered once on mount, so it reads the
    // handlers through refs rather than closing over a stale render.
    const handleUndoRef = useRef(() => {});
    const handleRedoRef = useRef(() => {});
    const commitFieldsRef = useRef(() => {});

    const [pageDimensions, setPageDimensions] = useState({});
    const [pdfViewportWidth, setPdfViewportWidth] = useState(PDF_VIEWPORT_WIDTH_DEFAULT);

    const pdfWorkbenchRef = useRef(null);
    const fieldsRef = useRef([]);
    const selectedFieldIdRef = useRef(null);
    const selectedFieldIdsRef = useRef([]);
    const fileRef = useRef(null);
    const envelopeClipboardRef = useRef(null);

    useEffect(() => {
        fieldsRef.current = fields;
    }, [fields]);

    useEffect(() => {
        selectedFieldIdRef.current = selectedFieldId;
        selectedFieldIdsRef.current = selectedFieldIds;
    }, [selectedFieldId, selectedFieldIds]);

    useEffect(() => {
        fileRef.current = file;
    }, [file]);

    useEffect(() => {
        if (!file) {
            setPdfViewportWidth(PDF_VIEWPORT_WIDTH_DEFAULT);
        }
    }, [file]);

    useEffect(() => {
        if (hydrating) return undefined;
        const el = pdfWorkbenchRef.current;
        if (!el) return undefined;

        const onWheel = (e) => {
            if (!fileRef.current) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!el.contains(e.target)) return;
            e.preventDefault();
            setPdfViewportWidth((w) => adjustPdfViewportWidth(w, e.deltaY, e.deltaMode));
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [hydrating]);

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
    }, []);

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
    }, []);

    const handleUndo = useCallback(() => stepHistory(undoHistory), [stepHistory]);
    const handleRedo = useCallback(() => stepHistory(redoHistory), [stepHistory]);

    useEffect(() => {
        handleUndoRef.current = handleUndo;
        handleRedoRef.current = handleRedo;
        commitFieldsRef.current = commitFields;
    }, [handleUndo, handleRedo, commitFields]);

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
    }, []);

    const handleAiScanStart = useCallback(
        ({ scope, selectedPages }) => {
            setAiScanDialogOpen(false);
            setAiPanelOpen(true);
            setInspectorTab(INSPECTOR_TABS.AI);
            setSelectedSuggestionId(null);
            startAiScan({ scope, selectedPages });
        },
        [startAiScan],
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
        [removeAiSuggestions, showSuccess, commitFields],
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
    }, [aiUndoFieldIds, showSuccess, commitFields]);

    const handleAiDiscardAll = useCallback(() => {
        discardAiSuggestions();
        setSelectedSuggestionId(null);
    }, [discardAiSuggestions]);

    const closeAiPanel = useCallback(() => {
        setAiPanelOpen(false);
        setSelectedSuggestionId(null);
        setInspectorTab(INSPECTOR_TABS.PROPERTIES);
    }, []);

    const moveSuggestion = useCallback(
        (suggestionId, x, y) => updateAiSuggestion(suggestionId, { x, y }),
        [updateAiSuggestion],
    );

    const resizeSuggestion = useCallback(
        (suggestionId, width, height) => updateAiSuggestion(suggestionId, { width, height }),
        [updateAiSuggestion],
    );

    // Derive active field from selection
    const activeField = useMemo(() => {
        if (!selectedFieldId) return null;
        return fields.find(f => f.id === selectedFieldId) || null;
    }, [selectedFieldId, fields]);

    const isEditingRequest = Boolean(editRequestId);
    const isEditingTemplate = Boolean(editTemplateId);
    const editingEntityId = editRequestId || editTemplateId;
    const editingCollection = isEditingTemplate ? 'templates' : 'signing_requests';

    // PHASE 4: Hydrate from existing document for "Correct" / "Edit Template" flows
    useEffect(() => {
        if (!editingEntityId || !companyId) return;
        (async () => {
            setHydrating(true);
            try {
                const docRef = doc(db, 'companies', companyId, editingCollection, editingEntityId);
                const snap = await getDoc(docRef);
                if (!snap.exists()) {
                    showError('Document not found.');
                    setHydrating(false);
                    return;
                }
                const data = snap.data();
                setRecipientName(data.recipientName || '');
                setRecipientEmail(data.recipientEmail || '');
                setRecipientPhone(data.recipientPhone || '');
                setTitle(data.title || '');
                setDeliveryMethod(data.deliveryMethod || 'email');
                setCreatorMode(isEditingTemplate ? 'template' : 'request');
                setExistingStoragePath(data.storagePath || '');

                // Hydrate fields (convert stored format back to editor format)
                if (data.fields) {
                    // SAFETY: Filter out null/undefined elements from Firestore before hydrating
                    const hydratedFields = (data.fields || []).filter(f => f != null).map(f => ({
                        id: f.id,
                        type: f.type,
                        label: f.label || f.type,
                        page: f?.pageNumber || f?.page || 1,
                        x: f.xPosition ?? f.x ?? 10,
                        y: f.yPosition ?? f.y ?? 10,
                        width: f.width || 25,
                        height: f.height || 5,
                        required: f.required ?? true,
                        readOnly: f.readOnly ?? false,
                        prefillPolicy: f.prefillPolicy || (f.readOnly ? 'locked' : 'editable'),
                        bindingKey: f.bindingKey || '',
                        prefillGroupKey: f.prefillGroupKey || '',
                        defaultValue: f.defaultValue || '',
                        fontSize: f.fontSize || 'Auto',
                    }));
                    resetEditorHistory(hydratedFields);
                }

                // Hydrate PDF file from storage
                if (data.storagePath) {
                    setNumPages(null); // RACE FIX: Reset before fetching new blob
                    const fileRef = ref(storage, data.storagePath);
                    const url = await getDownloadURL(fileRef);
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const pdfFile = new File([blob], `${data.title || 'document'}.pdf`, { type: 'application/pdf' });
                    setFile(pdfFile);
                }
            } catch (err) {
                console.error('Hydration error:', err);
                showError('Failed to load document for editing.');
            } finally {
                setHydrating(false);
            }
        })();
    }, [editingEntityId, companyId, editingCollection, isEditingTemplate, showError, resetEditorHistory]);

    // FEAT-1: IntersectionObserver to track which page is visible
    useEffect(() => {
        if (!numPages) return;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const pageNum = parseInt(entry.target.dataset.pageNum);
                        if (pageNum) setActivePage(pageNum);
                    }
                });
            },
            { threshold: 0.5 }
        );
        Object.values(pageRefs.current).forEach((el) => {
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [numPages, file]);

    const handleTitleChange = useCallback((next) => {
        setTitle(next);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);

    /** Scroll a page into view; the IntersectionObserver then updates activePage. */
    const goToPage = useCallback((page) => {
        const target = pageRefs.current?.[page];
        if (target?.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setActivePage(page);
    }, []);

    /**
     * Fit Width / Fit Page.
     *
     * Both express themselves as a viewport WIDTH, because that is the single
     * dimension the workbench renders from — so fitting cannot desynchronise
     * the field overlays from the page.
     */
    const handleFitWidth = useCallback(() => {
        const available = canvasRef.current?.clientWidth;
        if (!available) return;
        // Leave the canvas gutter so the page is not flush against the rails.
        setPdfViewportWidth(clampPdfViewportWidth(available - 64));
    }, []);

    const handleFitPage = useCallback(() => {
        const availableHeight = canvasRef.current?.clientHeight;
        const availableWidth = canvasRef.current?.clientWidth;
        if (!availableHeight || !availableWidth) return;
        const dims = pageDimensions[activePage];
        const ratio = dims && dims.width > 0 ? dims.height / dims.width : 11 / 8.5;
        const widthThatFitsHeight = (availableHeight - 64) / ratio;
        setPdfViewportWidth(clampPdfViewportWidth(Math.min(availableWidth - 64, widthThatFitsHeight)));
    }, [pageDimensions, activePage]);

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        if (selected && selected.type === 'application/pdf') {
            // Keep this limit in lock-step with the storage rule (isValidFile in
            // storage.rules, currently < 20MB). If the client accepts a file the
            // rule rejects, the upload fails server-side and surfaces as an opaque
            // error — so the two limits MUST match.
            if (selected.size >= MAX_UPLOAD_BYTES) {
                showError(`File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`);
                return;
            }
            setFile(selected);
            setNumPages(null); // RACE FIX: Wipe stale page count before new document loads
            setTitle(selected.name.replace('.pdf', ''));
            // A different document invalidates every placement, so the history
            // starts again rather than letting undo reach fields that belonged
            // to the previous PDF.
            resetEditorHistory([], { markClean: false });
            setSelectedFieldId(null);
            setSaveState(SAVE_STATES.UNSAVED);
        } else {
            showError('Please upload a valid PDF file.');
        }
    };

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
    }, [commitFields]);

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
    }, []);

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
    }, [commitFields]);

    const handleMatchFieldSize = useCallback((dimension) => {
        commitFields(
            (prev) => matchFieldSize(prev, selectedFieldIdsRef.current, dimension),
            { label: `Match ${dimension}` },
        );
    }, [commitFields]);

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
    }, [commitFields, nextCopyId]);

    const handleCopyToPages = useCallback((targetPages, label) => {
        const ids = selectedFieldIdsRef.current;
        if (ids.length === 0 || targetPages.length === 0) return;
        commitFields(
            (prev) => copyFieldsToPages(prev, ids, targetPages, nextCopyId).fields,
            { label },
        );
    }, [commitFields, nextCopyId]);

    const onPageLoadSuccess = (page) => {
        setPageDimensions(prev => ({ ...prev, [page.pageNumber]: { width: page.width, height: page.height } }));
    };

    /** Only reachable from a completed write. Also a safe history reset point. */
    /**
     * Recipient and delivery edits are part of the document being built, so they
     * count as unsaved work — otherwise Back would close without asking and
     * throw them away.
     *
     * These wrap the raw setters rather than replacing them: hydration keeps
     * using the raw ones, because it only resets the history (and with it the
     * save state) when the loaded document actually has fields. Marking a
     * freshly opened document unsaved would be its own lie.
     */
    const editRecipientName = useCallback((value) => {
        setRecipientName(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);
    const editRecipientEmail = useCallback((value) => {
        setRecipientEmail(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);
    const editRecipientPhone = useCallback((value) => {
        setRecipientPhone(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);
    const editDeliveryMethod = useCallback((value) => {
        setDeliveryMethod(value);
        setSaveState(SAVE_STATES.UNSAVED);
    }, []);

    const markSaved = useCallback(() => {
        setSaveState(SAVE_STATES.SAVED);
        historyRef.current = createHistory(fieldsRef.current);
        setHistory(historyRef.current);
    }, []);

    const handleSave = async () => {
        if (!file || fields.length === 0) {
            showError('Please upload a file and place at least one field.');
            return;
        }

        if (creatorMode === 'request' && !isEditingTemplate) {
            if (!recipientName) {
                showError('Please provide a recipient name.');
                return;
            }
            if ((deliveryMethod === 'email' || deliveryMethod === 'both') && !recipientEmail) {
                showError('Email is required for email delivery.');
                return;
            }
            if ((deliveryMethod === 'sms' || deliveryMethod === 'both') && !recipientPhone) {
                showError('Phone number is required for SMS delivery.');
                return;
            }
        }

        const shouldResolveForDelivery = creatorMode === 'request' || isEditingRequest;
        const prefillContext = buildPrefillContext({
            recipientName,
            recipientEmail,
            recipientPhone,
            companyName,
        });

        let processedFields = [];
        if (shouldResolveForDelivery) {
            const { fields: resolvedFields, missingLockedRequired } = resolveFieldsForSend(fields, prefillContext);
            processedFields = resolvedFields.map((resolvedField, index) => ({
                ...resolvedField,
                bindingKey: fields[index].bindingKey || '',
            }));

            if (missingLockedRequired.length > 0) {
                showError(
                    `Cannot send yet. These locked required fields are missing prefill data: ${missingLockedRequired.join(', ')}.`
                );
                return;
            }
        } else {
            // Template save/edit keeps raw placeholder tokens instead of pre-resolving values.
            processedFields = fields.map((field) => {
                const policy = normalizePrefillPolicy(field);
                return {
                    ...field,
                    prefillPolicy: policy,
                    readOnly: policy === 'locked',
                    bindingKey: field.bindingKey || '',
                };
            });
        }

        setLoading(true);
        setSaveState(SAVE_STATES.SAVING);

        try {
            const commonData = {
                companyId,
                title: title || 'Untitled Document',
                // Funnel every field through the pure serializer so the payload can
                // never contain `undefined` (which Firestore rejects outright).
                fields: serializeTemplateFields(processedFields),
                updatedAt: serverTimestamp()
            };

            if (isEditingRequest) {
                const docRef = doc(db, 'companies', companyId, 'signing_requests', editRequestId);
                await updateDoc(docRef, {
                    ...commonData,
                    recipientEmail: recipientEmail || null,
                    recipientName,
                    recipientPhone: recipientPhone || null,
                });
                showSuccess('Document updated successfully!');
                markSaved();
                if (onClose) onClose();
                return;
            }

            if (isEditingTemplate) {
                if (!existingStoragePath) {
                    showError('Template file reference is missing. Please re-upload the PDF as a new template.');
                    // Nothing was written, so the work is still unsaved. Leaving
                    // the state at SAVING would show "Saving…" forever.
                    setSaveState(SAVE_STATES.UNSAVED);
                    return;
                }
                const docRef = doc(db, 'companies', companyId, 'templates', editTemplateId);
                await updateDoc(docRef, {
                    ...commonData,
                    storagePath: existingStoragePath,
                });
                showSuccess('Template updated successfully!');
                markSaved();
                if (onClose) onClose();
                return;
            }

            const folder = creatorMode === 'template' ? 'templates' : 'originals';
            const storagePath = `secure_documents/${companyId}/${folder}/${Date.now()}_${file.name}`;
            const fileRef = ref(storage, storagePath);
            await uploadBytes(fileRef, file);

            commonData.storagePath = storagePath;

            if (creatorMode === 'template') {
                await addDoc(collection(db, 'companies', companyId, 'templates'), {
                    ...commonData,
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid
                });
                showSuccess('Template saved successfully!');
            } else {
                const accessToken = uuidv4();
                const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';

                const sendEmail = deliveryMethod === 'email' || deliveryMethod === 'both';
                const sendSms = deliveryMethod === 'sms' || deliveryMethod === 'both';

                const signingRef = doc(collection(db, 'companies', companyId, 'signing_requests'));
                const batch = writeBatch(db);
                batch.set(signingRef, {
                    ...commonData,
                    recipientEmail: recipientEmail || null,
                    recipientName,
                    recipientPhone: recipientPhone || null,
                    status: 'sent',
                    createdAt: serverTimestamp(),
                    expiresAt,
                    senderId: auth.currentUser.uid,
                    senderName,
                    sendEmail,
                    sendSms,
                    deliveryMethod,
                    appBaseUrl: window.location.origin
                });
                batch.set(doc(signingRef, 'secrets', 'token'), { accessToken });
                await batch.commit();

                if (deliveryMethod === 'copy') {
                    const baseUrl = window.location.origin;
                    const link = `${baseUrl}/sign/${companyId}/${signingRef.id}?token=${accessToken}`;
                    await navigator.clipboard.writeText(link);
                    showSuccess('Signing link copied to clipboard!');
                } else if (sendSms && recipientPhone) {
                    try {
                        const baseUrl = window.location.origin;
                        const signingLink = `${baseUrl}/sign/${companyId}/${signingRef.id}?token=${accessToken}`;
                        const smsMessage = `${senderName} sent you "${title || 'Document'}" to sign: ${signingLink}`;

                        const functions = getFunctions();
                        const sendSMSCallable = httpsCallable(functions, 'sendSMS');
                        await sendSMSCallable({
                            companyId,
                            recipientPhone,
                            messageBody: smsMessage
                        });
                        showSuccess('Document created & SMS sent!');
                    } catch (smsErr) {
                        console.error('SMS send failed:', smsErr);
                        showError(`Document created but SMS failed: ${smsErr.message}`);
                    }
                } else {
                    const methodLabel = deliveryMethod === 'both' ? 'Email + SMS' : 'Email';
                    showSuccess(`Document created! ${methodLabel} delivery in progress...`);
                }
            }

            markSaved();
            if (onClose) onClose();
        } catch (err) {
            console.error('Error saving:', err);
            // Never claim "Saved" after a failed write — the edits are still local.
            setSaveState(SAVE_STATES.ERROR);
            // Surface the real reason (e.g. permission-denied, storage/unauthorized,
            // invalid-argument) instead of a generic message. An opaque "Action failed"
            // is undebuggable; a precise code/message means this is never a mystery again.
            const reason = err?.code || err?.message || 'unknown error';
            showError(`Save failed (${reason}). Please try again or contact support.`);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = getFieldIcon;

    /**
     * The inspector is a permanent column on wide screens, so the canvas never
     * resizes under the pointer. Below that breakpoint it is a sheet, shown only
     * when it has something to say.
     */
    const inspectorOpen = Boolean(selectedFieldId) || aiPanelOpen;

    const dismissInspector = useCallback(() => {
        setSelectedFieldIds([]);
        setAiPanelOpen(false);
    }, []);

    const editorMode = resolveEditorMode({ creatorMode, isEditingTemplate, isEditingRequest });
    const fieldCountsByPage = useMemo(() => countFieldsByPage(fields), [fields]);
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

    /**
     * Leaving the editor.
     *
     * With unsaved work this asks first, through the shared accessible
     * confirmation rather than a blocking browser dialog. With nothing to lose
     * it closes straight away — a confirmation that always fires trains people
     * to dismiss it without reading.
     */
    const requestClose = useCallback(() => {
        if (hasUnsavedWork(saveState)) {
            setPendingClose(true);
            return;
        }
        if (onClose) onClose();
    }, [saveState, onClose]);

    /**
     * Prop bundles shared by the desktop rails and the compact bottom sheets.
     *
     * The same components render in both layouts with the same props — the
     * compact editor is a different arrangement, not a different editor.
     */
    const sidebarProps = {
        creatorMode,
        isEditingTemplate,
        recipientName,
        setRecipientName: editRecipientName,
        recipientEmail,
        setRecipientEmail: editRecipientEmail,
        recipientPhone,
        setRecipientPhone: editRecipientPhone,
        deliveryMethod,
        setDeliveryMethod: editDeliveryMethod,
        file,
        handleFileChange,
        addField,
        fields,
        selectedFieldId,
        setSelectedFieldId,
        removeField,
        getIcon,
        onOpenAiAssistant: openAiAssistant,
        aiAssistantBusy: aiAssistant.isScanning,
        fieldTools: (
            <FieldToolsPanel
                selectedCount={selectedFieldIds.length}
                numPages={numPages || 1}
                activePage={activePage}
                onAlign={handleAlignFields}
                onMatchSize={handleMatchFieldSize}
                onDuplicate={handleDuplicateSelection}
                onCopyToPage={(page) => handleCopyToPages([page], `Copy to page ${page}`)}
                onCopyToAllPages={() => handleCopyToPages(allPages(numPages || 1), 'Copy to all pages')}
            />
        ),
    };

    /** One rail section at a time, inside a sheet rather than a fixed column. */
    const sheetSidebarProps = (section) => ({
        ...sidebarProps,
        initialOpenSections: { setup: section === 'setup', add: section === 'add', placed: section === 'fields' },
        className: 'flex w-full flex-col',
        label: 'Envelope setup',
    });

    const pageRailProps = {
        file,
        numPages: numPages || 0,
        activePage,
        fieldCountsByPage,
        suggestionCountsByPage,
        reviewPages,
    };

    const inspectorElement = (
        <EditorInspector
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            suggestionCount={aiSuggestions.length}
            hasSelection={Boolean(activeField)}
            onDismiss={!isCompact && inspectorOpen ? dismissInspector : undefined}
            propertiesPanel={
                <FieldPropertiesPanel
                    activeField={activeField}
                    updateActiveField={updateActiveField}
                    getIcon={getIcon}
                />
            }
            aiPanel={
                aiPanelOpen ? (
                    <AiSuggestionReviewPanel
                        status={aiAssistant.status}
                        progress={aiAssistant.progress}
                        suggestions={aiSuggestions}
                        manualReview={aiAssistant.manualReview}
                        stats={aiAssistant.stats}
                        error={aiAssistant.error}
                        partial={aiAssistant.partial}
                        truncatedPages={aiAssistant.truncatedPages}
                        selectedSuggestionId={selectedSuggestionId}
                        onSelectSuggestion={setSelectedSuggestionId}
                        onUpdateSuggestion={updateAiSuggestion}
                        onToggleAccepted={toggleSuggestionAccepted}
                        onApplySelected={handleApplySelected}
                        onApplyHighConfidence={handleApplyHighConfidence}
                        onDiscardAll={handleAiDiscardAll}
                        onRescan={() => setAiScanDialogOpen(true)}
                        onUndo={handleAiUndo}
                        canUndo={aiUndoFieldIds.length > 0}
                        onCancel={aiAssistant.cancelScan}
                        onClose={closeAiPanel}
                    />
                ) : null
            }
        />
    );

    /** Opening the AI sheet also selects the tab it is meant to show. */
    const openMobileSheet = (key) => {
        if (key === 'ai') setInspectorTab(INSPECTOR_TABS.AI);
        if (key === 'inspector') setInspectorTab(INSPECTOR_TABS.PROPERTIES);
        setMobileSheet((previous) => (previous === key ? null : key));
    };

    const MOBILE_SHEET_TITLES = {
        setup: 'Setup',
        add: 'Add Field',
        fields: 'Fields',
        inspector: 'Properties',
        ai: 'AI Suggestions',
        pages: 'Pages',
    };

    // Show loading state while hydrating for Correct flow
    if (hydrating) {
        return (
            <div role="status" className="flex h-screen flex-col items-center justify-center gap-ds-3 bg-ds-canvas">
                <Loader2 className="animate-spin text-ds-action-primary" size={36} aria-hidden="true" />
                <p className="text-ds-sm font-medium text-ds-content-secondary">Loading document for editing...</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-ds-canvas">
            <EditorTopBar
                mode={editorMode}
                title={title}
                onTitleChange={handleTitleChange}
                saveState={saveState}
                pageCount={numPages || 0}
                fieldCount={fields.length}
                canUndo={historyCanUndo(history)}
                canRedo={historyCanRedo(history)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onPreview={() => setPreviewOpen(true)}
                previewDisabled={!file}
                onBack={requestClose}
                onSave={handleSave}
                saving={loading}
                compact={isCompact}
            />

            {/* 3-COLUMN LAYOUT */}
            <div className="flex flex-1 overflow-hidden">

                {/* LEFT RAIL: Setup / Add Fields / Fields.

                    Desktop only. On a phone the same sections are reachable
                    from the bottom bar, one sheet at a time, instead of being
                    compressed into a column that leaves no room for the PDF. */}
                {!isCompact && <EnvelopeSidebar {...sidebarProps} />}

                {!isCompact && <PageThumbnailRail {...pageRailProps} onSelectPage={goToPage} />}

                {/* CENTER: canvas toolbar + PDF viewer with the field overlays */}
                <div ref={canvasRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {file && (
                        <EditorCanvasToolbar
                            activePage={activePage}
                            numPages={numPages || 0}
                            onPreviousPage={() => goToPage(Math.max(1, activePage - 1))}
                            onNextPage={() => goToPage(Math.min(numPages || 1, activePage + 1))}
                            pdfViewportWidth={pdfViewportWidth}
                            setPdfViewportWidth={setPdfViewportWidth}
                            onFitWidth={handleFitWidth}
                            onFitPage={handleFitPage}
                            canUndo={historyCanUndo(history)}
                            canRedo={historyCanRedo(history)}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                            onPreview={() => setPreviewOpen(true)}
                            previewDisabled={!file}
                        />
                    )}
                    <PdfFieldWorkbench
                        workbenchRef={pdfWorkbenchRef}
                        file={file}
                        numPages={numPages}
                        setNumPages={setNumPages}
                        activePage={activePage}
                        pageRefs={pageRefs}
                        pageDimensions={pageDimensions}
                        onPageLoadSuccess={onPageLoadSuccess}
                        pdfViewportWidth={pdfViewportWidth}
                        setPdfViewportWidth={setPdfViewportWidth}
                        fields={fields}
                        selectedFieldId={selectedFieldId}
                        selectedFieldIds={selectedFieldIds}
                        setSelectedFieldId={setSelectedFieldId}
                        updateFieldPosition={updateFieldPosition}
                        onFieldDragMove={handleFieldDragMove}
                        dragGuides={dragGuides}
                        updateFieldSize={updateFieldSize}
                        removeField={removeField}
                        updateFieldLabel={updateFieldLabel}
                        getIcon={getIcon}
                        aiSuggestions={aiSuggestions}
                        selectedSuggestionId={selectedSuggestionId}
                        onSelectSuggestion={setSelectedSuggestionId}
                        onMoveSuggestion={moveSuggestion}
                        onResizeSuggestion={resizeSuggestion}
                        onAcceptSuggestion={toggleSuggestionAccepted}
                        onRejectSuggestion={rejectSuggestion}
                    />
                </div>

                {/* RIGHT: the inspector.

                    A permanent 320px column from `lg` up, so selecting or
                    deselecting a field never resizes the canvas under the
                    pointer. Below that breakpoint there is no room for a third
                    column and it moves into the Properties / AI Suggestions
                    bottom sheets instead. */}
                {!isCompact && (
                    <div
                        role="complementary"
                        aria-label="Document inspector"
                        className={`shrink-0 overflow-hidden border-l border-ds-border-subtle bg-ds-surface shadow-ds-lg ${
                            inspectorOpen
                                ? 'fixed inset-y-0 right-0 z-40 w-full max-w-sm lg:static lg:z-auto lg:w-80 lg:max-w-none'
                                : 'hidden lg:block lg:w-80'
                        }`}
                    >
                        {inspectorElement}
                    </div>
                )}
            </div>

            {/* Compact editor: a bottom toolbar that opens one sheet at a time.
                Each sheet is the shared accessible dialog, so focus moves in,
                Tab is trapped, Escape and the backdrop close it, and focus
                returns to the button that opened it. */}
            {isCompact && (
                <EditorMobileBar
                    openSheet={mobileSheet}
                    onOpenSheet={openMobileSheet}
                    fieldCount={fields.length}
                    suggestionCount={aiSuggestions.length}
                />
            )}

            {isCompact && mobileSheet && (
                <EditorBottomSheet
                    title={MOBILE_SHEET_TITLES[mobileSheet]}
                    onClose={() => setMobileSheet(null)}
                >
                    {(mobileSheet === 'setup' || mobileSheet === 'add' || mobileSheet === 'fields') && (
                        <EnvelopeSidebar {...sheetSidebarProps(mobileSheet)} />
                    )}
                    {(mobileSheet === 'inspector' || mobileSheet === 'ai') && inspectorElement}
                    {mobileSheet === 'pages' && (
                        <PageThumbnailRail
                            {...pageRailProps}
                            variant="sheet"
                            onSelectPage={(page) => {
                                goToPage(page);
                                setMobileSheet(null);
                            }}
                        />
                    )}
                </EditorBottomSheet>
            )}

            {previewOpen && (
                <SignerPreviewDialog
                    file={file}
                    numPages={numPages || 1}
                    fields={fields}
                    recipientName={recipientName}
                    recipientEmail={recipientEmail}
                    recipientPhone={recipientPhone}
                    companyName={companyName}
                    initialPage={activePage}
                    onClose={() => setPreviewOpen(false)}
                />
            )}

            {/*
              Leaving with unsaved work is guarded by the shared accessible
              confirmation, not a blocking browser dialog.
            */}
            <ConfirmDialog
                isOpen={pendingClose}
                tone="warning"
                title="Leave without saving?"
                description="This document has changes that have not been saved. Leaving now discards them."
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                onConfirm={() => {
                    setPendingClose(false);
                    if (onClose) onClose();
                }}
                onCancel={() => setPendingClose(false)}
            />

            {aiScanDialogOpen && (
                <AiScanOptionsDialog
                    activePage={activePage}
                    numPages={numPages || 1}
                    onClose={() => setAiScanDialogOpen(false)}
                    onStart={handleAiScanStart}
                />
            )}
        </div>
    );
}
