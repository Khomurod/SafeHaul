import React from 'react';
import { Icon, Eye, Send } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button } from '@/design-system/components';
import { signedCopyLine } from '@features/signing/utils/signedCopy';

/**
 * The signed copy in the Documents workspace: the line that says where it
 * stands, the action that opens the approval, and the approval itself. The
 * rules are `utils/signedCopy.js`'s and the send is `useSignedCopySend`'s; these
 * only draw them, with the design system's own controls and dialog.
 */

/** The line's tone, carried by its words as well: status is never colour alone. */
const LINE_TONE = {
    success: 'text-ds-status-success-fg',
    neutral: 'text-ds-content-secondary',
    danger: 'text-ds-status-danger-fg',
};

/** `size` is the line's type size: 12px by default, 14px where it sits under a status in a list item. */
export function SignedCopyStatus({ record, size = 'text-ds-xs' }) {
    const line = signedCopyLine(record);
    if (!line) return null;
    // An address breaks before its "@" and between words, never mid-word.
    const [before, ...after] = line.text.split('@');
    return (
        <span className={`${size} ${LINE_TONE[line.tone]} [overflow-wrap:break-word]`}>
            {before}
            {after.map((part, index) => <React.Fragment key={index}><wbr />@{part}</React.Fragment>)}
        </span>
    );
}

/**
 * "Send signed copy", or "Try again" after a copy that did not go. In a list
 * its name says which document (`title`); inside one document's details it
 * needs none.
 */
export function SignedCopyButton({ title, retry = false, size, variant = 'secondary', fullWidth = false, className = '', onClick }) {
    const named = (label) => (title ? `${label} of ${title}` : undefined);
    return (
        <Button
            variant={variant}
            size={size}
            fullWidth={fullWidth}
            className={className}
            aria-label={retry ? named('Try again: send signed copy') : named('Send signed copy')}
            onClick={onClick}
        >
            <Icon icon={Send} /> {retry ? 'Try again' : 'Send signed copy'}
        </Button>
    );
}

/**
 * Approve and send. `pending` is the document as it was when the approval
 * opened; the server's refusal is `error`, and the dialog stays open with it.
 */
export function SignedCopyDialog({ pending, sending, error, onApprove, onCancel, onViewPdf }) {
    return (
        <ConfirmDialog
            isOpen={Boolean(pending)}
            tone="info"
            title="Send the signed copy?"
            description="The driver gets the signed PDF, with your company signature, at this address. This is sent once."
            confirmLabel={sending ? 'Sending…' : 'Approve and send'}
            loading={sending}
            error={error || undefined}
            onConfirm={onApprove}
            onCancel={onCancel}
        >
            {pending && (
                <div className="flex flex-col gap-ds-3">
                    <dl className="flex flex-col gap-ds-1 rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-3 text-ds-sm">
                        <div className="flex justify-between gap-ds-2">
                            <dt className="text-ds-content-secondary">Document</dt>
                            <dd className="min-w-0 text-right font-medium text-ds-content [overflow-wrap:anywhere]">{pending.title}</dd>
                        </div>
                        <div className="flex justify-between gap-ds-2">
                            <dt className="text-ds-content-secondary">Email</dt>
                            <dd className="min-w-0 text-right font-medium text-ds-content [overflow-wrap:anywhere]">{pending.email}</dd>
                        </div>
                    </dl>
                    <Button variant="secondary" size="sm" className="self-start" onClick={() => onViewPdf(pending.signedPdfPath)}>
                        <Icon icon={Eye} /> View signed PDF
                    </Button>
                </div>
            )}
        </ConfirmDialog>
    );
}
