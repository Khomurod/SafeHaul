import React, { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { IconButton } from '@/design-system/components';

/**
 * Bottom sheet for the compact editor.
 *
 * Built on the shared accessible `Modal`, so it inherits the behaviour a
 * hand-rolled sheet always gets wrong: focus moves in on open, Tab is trapped
 * while it is open, Escape and the backdrop close it, and focus returns to the
 * control that opened it. Only the anchoring and the shape are new — the sheet
 * sits at the bottom, within thumb reach, and stops short of the top of the
 * screen so the document stays visible behind it.
 */
export function EditorBottomSheet({ title, onClose, children }) {
    const headingId = `editor-sheet-${useId().replace(/:/g, '')}`;

    return (
        <Modal
            labelledBy={headingId}
            onClose={onClose}
            overlayClassName="fixed inset-0 z-50 flex items-end justify-center bg-ds-overlay backdrop-blur-sm"
            className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-ds-xl bg-ds-surface shadow-ds-lg"
        >
            <div className="flex shrink-0 items-center justify-between gap-ds-2 border-b border-ds-border-subtle px-ds-4 py-ds-3">
                <h2 id={headingId} className="text-ds-body font-bold text-ds-content">{title}</h2>
                <IconButton label={`Close ${title}`} variant="ghost" size="sm" onClick={onClose}>
                    <X size={18} aria-hidden="true" />
                </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Modal>
    );
}

export default EditorBottomSheet;
