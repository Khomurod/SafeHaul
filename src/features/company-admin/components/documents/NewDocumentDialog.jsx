import React, { useId, useRef } from 'react';
import { FilePlus2, FileText, Send, X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { Button, IconButton } from '@/design-system/components';

/**
 * "New Document" — the three things a company can actually start.
 *
 * This dialog exists because the outcome used to be decided by a toggle inside
 * the editor that most people never noticed: the same screen could send a
 * one-off document or save a reusable template. The choice is now made here,
 * up front, and is fixed for the rest of the flow.
 */

const CHOICES = [
    {
        id: 'template-send',
        icon: Send,
        title: 'Send from template',
        description: 'Pick a saved template, choose the recipient and send it.',
    },
    {
        id: 'upload-send',
        icon: FilePlus2,
        title: 'Upload and send PDF',
        description: 'Upload a one-off PDF, place fields on it and send it to one recipient.',
    },
    {
        id: 'create-template',
        icon: FileText,
        title: 'Create reusable template',
        description: 'Upload a PDF and save it as a template you can send again and again.',
    },
];

export function NewDocumentDialog({ onClose, onChoose, templateCount = 0 }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `new-document-title-${rawId}`;
    const descriptionId = `new-document-description-${rawId}`;
    const firstChoiceRef = useRef(null);

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={firstChoiceRef}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">New Document</h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        Choose how you want to start. This decides what happens when you finish.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                <ul className="flex flex-col gap-ds-3">
                    {CHOICES.map((choice, index) => {
                        const Icon = choice.icon;
                        // "Send from template" stays enabled with no templates: it
                        // opens the template library, which says there are none and
                        // how to make one. A disabled option would be a dead end.
                        const noTemplates = choice.id === 'template-send' && templateCount === 0;
                        return (
                            <li key={choice.id}>
                                <Button
                                    ref={index === 0 ? firstChoiceRef : undefined}
                                    variant="secondary"
                                    fullWidth
                                    justify="start"
                                    className="h-auto py-ds-3 text-left"
                                    onClick={() => onChoose(choice.id)}
                                >
                                    <span
                                        aria-hidden="true"
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-lg bg-ds-status-accent-bg text-ds-status-accent-fg"
                                    >
                                        <Icon size={18} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-bold text-ds-content">{choice.title}</span>
                                        <span className="block whitespace-normal text-ds-xs font-normal text-ds-content-secondary">
                                            {noTemplates
                                                ? 'You have no templates yet — this opens the template library so you can create one.'
                                                : choice.description}
                                        </span>
                                    </span>
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </Modal>
    );
}

export default NewDocumentDialog;
