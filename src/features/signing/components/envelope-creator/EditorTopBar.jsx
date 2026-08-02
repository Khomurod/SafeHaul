import React, { useEffect, useId, useState } from 'react';
import { ArrowLeft, Eye, Redo2, Save, Undo2 } from 'lucide-react';
import { Badge, Button, IconButton, Input } from '@/design-system/components';
import {
    SAVE_STATES,
    modePresentation,
    saveStateLabel,
    saveStateTone,
} from '@features/signing/utils/editorSaveState';

/**
 * Editor top bar.
 *
 * Carries the document's identity and status in one place: where you are, what
 * you are building, how big it is, whether your work is safe, and the one
 * action that finishes the job.
 *
 * The save-state indicator never reads "Saved" until a write has actually
 * succeeded — `SAVE_STATES.SAVED` is only reachable from a completed save, and
 * any edit moves it back to "Unsaved changes". Claiming otherwise would be
 * worse than showing nothing.
 */
export function EditorTopBar({
    mode,
    title,
    onTitleChange,
    saveState = SAVE_STATES.CLEAN,
    pageCount = 0,
    fieldCount = 0,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
    onPreview,
    previewDisabled = false,
    onBack,
    onSave,
    saving = false,
    compact = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `editor-title-${rawId}`;
    const presentation = modePresentation(mode);
    const stateLabel = saveStateLabel(saveState);

    // Local draft so typing stays responsive; committed on blur/Enter so a
    // single rename is one history-free change rather than one per keystroke.
    const [draft, setDraft] = useState(title || '');
    useEffect(() => setDraft(title || ''), [title]);

    const commit = () => {
        const next = draft.trim();
        if (next !== (title || '').trim()) onTitleChange(next);
        else setDraft(title || '');
    };

    return (
        <div className="z-30 flex shrink-0 flex-wrap items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-2 shadow-ds-xs">
            <div className="flex min-w-0 flex-1 items-center gap-ds-3">
                <Button variant="ghost" size="sm" className="shrink-0" onClick={onBack}>
                    <ArrowLeft size={16} aria-hidden="true" />
                    {!compact && 'Back to Documents'}
                    {compact && <span className="ds-visually-hidden">Back to Documents</span>}
                </Button>

                <div className="min-w-0 flex-1">
                    <label htmlFor={titleId} className="ds-visually-hidden">Document title</label>
                    <Input
                        id={titleId}
                        type="text"
                        value={draft}
                        placeholder="Untitled Document"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                            }
                            if (event.key === 'Escape') {
                                setDraft(title || '');
                                event.currentTarget.blur();
                            }
                        }}
                        className="max-w-md font-bold"
                    />
                </div>

                {!compact && (
                    <div className="flex shrink-0 flex-wrap items-center gap-ds-1">
                        <Badge tone="neutral">{presentation.label}</Badge>
                        <Badge tone="neutral">
                            {pageCount} page{pageCount === 1 ? '' : 's'}
                        </Badge>
                        <Badge tone="neutral">
                            {fieldCount} field{fieldCount === 1 ? '' : 's'}
                        </Badge>
                        {stateLabel && <Badge tone={saveStateTone(saveState)}>{stateLabel}</Badge>}
                    </div>
                )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-ds-2">
                <IconButton label="Undo" variant="ghost" size="sm" disabled={!canUndo} onClick={onUndo}>
                    <Undo2 size={16} aria-hidden="true" />
                </IconButton>
                <IconButton label="Redo" variant="ghost" size="sm" disabled={!canRedo} onClick={onRedo}>
                    <Redo2 size={16} aria-hidden="true" />
                </IconButton>

                <Button variant="secondary" size="sm" disabled={previewDisabled} onClick={onPreview}>
                    <Eye size={14} aria-hidden="true" />
                    {compact ? <span className="ds-visually-hidden">Preview as signer</span> : 'Preview as signer'}
                </Button>

                <Button variant="primary" size="sm" disabled={saving} loading={saving} onClick={onSave}>
                    {!saving && <Save size={14} aria-hidden="true" />}
                    {presentation.action}
                </Button>
            </div>

            {/* Status is announced, not only shown. */}
            <p role="status" className="ds-visually-hidden">
                {saving ? 'Saving document, please wait…' : stateLabel}
            </p>
            {compact && (
                <p className="ds-visually-hidden">
                    {presentation.label}. {pageCount} pages. {fieldCount} fields.
                </p>
            )}
        </div>
    );
}

export default EditorTopBar;
