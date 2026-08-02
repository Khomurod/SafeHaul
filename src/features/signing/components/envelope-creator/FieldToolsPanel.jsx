import React, { useId, useState } from 'react';
import {
    AlignCenter,
    AlignCenterVertical,
    AlignEndVertical,
    AlignLeft,
    AlignRight,
    AlignStartVertical,
    Copy,
    CopyPlus,
    MoveHorizontal,
    MoveVertical,
    Ruler,
} from 'lucide-react';
import { Button, FormField, IconButton, Select } from '@/design-system/components';

/**
 * Field tools for the current selection.
 *
 * Alignment and size-matching anchor on the FIRST field selected, which is why
 * the panel says so: "anchor" is otherwise invisible, and aligning to a bounding
 * box instead would move every field including the one you were happy with.
 *
 * Every action here is a normal edit — it goes through the editor's single write
 * path and is therefore one undo step. Nothing here saves, sends or writes.
 */

const ALIGNMENTS = [
    { mode: 'left', label: 'Align left', icon: AlignLeft },
    { mode: 'center', label: 'Align horizontal centres', icon: AlignCenter },
    { mode: 'right', label: 'Align right', icon: AlignRight },
    { mode: 'top', label: 'Align top', icon: AlignStartVertical },
    { mode: 'middle', label: 'Align vertical centres', icon: AlignCenterVertical },
    { mode: 'bottom', label: 'Align bottom', icon: AlignEndVertical },
];

const SIZE_MATCHES = [
    { dimension: 'width', label: 'Match width', icon: MoveHorizontal },
    { dimension: 'height', label: 'Match height', icon: MoveVertical },
    { dimension: 'both', label: 'Match width and height', icon: Ruler },
];

export function FieldToolsPanel({
    selectedCount = 0,
    numPages = 1,
    activePage = 1,
    onAlign,
    onMatchSize,
    onDuplicate,
    onCopyToPage,
    onCopyToAllPages,
}) {
    const rawId = useId().replace(/:/g, '');
    const alignLabelId = `field-tools-align-${rawId}`;
    const sizeLabelId = `field-tools-size-${rawId}`;

    const total = Math.max(1, Number(numPages) || 1);

    // `null` means "follow the page I am on", which is the useful default and
    // survives the document's page count arriving after this panel mounts. Once
    // a page is chosen explicitly it stays chosen.
    const [chosenPage, setChosenPage] = useState(null);
    const targetPage = chosenPage && chosenPage <= total
        ? chosenPage
        : (activePage < total ? activePage + 1 : 1);

    if (selectedCount === 0) return null;

    const canArrange = selectedCount >= 2;
    const plural = selectedCount === 1 ? 'field' : 'fields';

    return (
        <div className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-2">
            <p role="status" className="mb-ds-2 text-ds-xs font-bold text-ds-content">
                {selectedCount} {plural} selected
            </p>

            <p className="mb-ds-2 text-ds-xs leading-snug text-ds-content-secondary">
                {canArrange
                    ? 'Aligning and matching use the first field you selected as the anchor.'
                    : 'Shift-click another field to align, match sizes or copy them together.'}
            </p>

            <h5 id={alignLabelId} className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">
                Align
            </h5>
            <div role="group" aria-labelledby={alignLabelId} className="mb-ds-3 grid grid-cols-6 gap-ds-1">
                {ALIGNMENTS.map(({ mode, label, icon: Icon }) => (
                    <IconButton
                        key={mode}
                        label={label}
                        variant="ghost"
                        size="sm"
                        disabled={!canArrange}
                        onClick={() => onAlign(mode)}
                    >
                        <Icon size={14} aria-hidden="true" />
                    </IconButton>
                ))}
            </div>

            <h5 id={sizeLabelId} className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">
                Match size
            </h5>
            <div role="group" aria-labelledby={sizeLabelId} className="mb-ds-3 grid grid-cols-3 gap-ds-1">
                {SIZE_MATCHES.map(({ dimension, label, icon: Icon }) => (
                    <IconButton
                        key={dimension}
                        label={label}
                        variant="ghost"
                        size="sm"
                        disabled={!canArrange}
                        onClick={() => onMatchSize(dimension)}
                    >
                        <Icon size={14} aria-hidden="true" />
                    </IconButton>
                ))}
            </div>

            <Button variant="secondary" size="sm" fullWidth className="mb-ds-3" onClick={onDuplicate}>
                <CopyPlus size={14} aria-hidden="true" />
                Duplicate {plural}
            </Button>

            {total > 1 && (
                <div>
                    <FormField label="Copy to page">
                        <Select
                            value={String(targetPage)}
                            onChange={(event) => setChosenPage(Number(event.target.value))}
                        >
                            {Array.from({ length: total }, (_, index) => index + 1).map((page) => (
                                <option key={page} value={page}>Page {page}</option>
                            ))}
                        </Select>
                    </FormField>
                    <div className="mt-ds-2 grid grid-cols-1 gap-ds-1">
                        <Button variant="secondary" size="sm" onClick={() => onCopyToPage(targetPage)}>
                            <Copy size={14} aria-hidden="true" />
                            Copy to page {targetPage}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onCopyToAllPages}>
                            Copy to all pages
                        </Button>
                    </div>
                    <p className="mt-ds-1 text-ds-xs leading-snug text-ds-content-secondary">
                        Copies keep their size, label, binding and position, get their own ids, and
                        never land outside a page. The page a field is already on is skipped.
                    </p>
                </div>
            )}
        </div>
    );
}

export default FieldToolsPanel;
