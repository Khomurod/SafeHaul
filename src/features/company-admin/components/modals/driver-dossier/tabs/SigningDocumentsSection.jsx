import React, { useId } from 'react';
import {
    Icon, AlertCircle, Ban, CheckCircle, Circle, Clock, ExternalLink, FileText, Hourglass, Loader2, MailWarning, Send,
} from '@design-system/icons';
import { Badge, Button, Card, Notice } from '@/design-system/components';
import { useRecordSigningRequests } from '@features/company-admin/hooks/useRecordSigningRequests';
import { useSigningDocumentActions } from '@features/company-admin/hooks/useSigningDocumentActions';
import { deliveryFailure, deliveryNote, formatTimestamp } from '@features/company-admin/utils/documentsWorkspace';

/**
 * The driver's signing documents, a section of the dossier's Documents tab: the
 * signing requests linked to this application or lead, and for an application
 * each required post-application form nobody has started. Data and the rules
 * of the list are `useRecordSigningRequests` / `recordSigningDocuments.js`; the
 * actions are `useSigningDocumentActions`.
 *
 * A document still with its signer whose send failed is *Not delivered*, with
 * the reason the server recorded; a text skipped for an opted-out number is a
 * neutral note. Send to driver is offered on a required form nobody sent, and
 * Remind on a document waiting for its signer that went by email or text, its
 * link expired or not, delivered or not; the server decides the channels and
 * refuses with its reason, which
 * stays beside the document in the row's own polite region (always present, so
 * it announces when it fills). A signed copy opens in a new tab through
 * `getSignedDocumentUrl`.
 */

/**
 * Feature-owned state → Badge mapping, in the tones `EnvelopeHistory` gives the
 * same statuses. Every badge pairs its tone with an icon and words.
 */
const STATE_PRESENTATION = {
    not_started: { tone: 'neutral', label: 'Not started', icon: Circle },
    awaiting: { tone: 'info', label: 'Awaiting signature', icon: Clock },
    not_delivered: { tone: 'danger', label: 'Not delivered', icon: MailWarning },
    link_expired: { tone: 'warning', label: 'Link expired', icon: Hourglass },
    submitting: { tone: 'warning', label: 'Submitting', icon: Loader2 },
    sealing: { tone: 'warning', label: 'Sealing', icon: Loader2 },
    signed: { tone: 'success', label: 'Signed', icon: CheckCircle },
    seal_failed: { tone: 'danger', label: 'Seal failed', icon: AlertCircle },
    voided: { tone: 'danger', label: 'Voided', icon: Ban },
    other: { tone: 'neutral', label: null, icon: FileText },
};

/** The dates a row shows, each only when it has one. */
function rowDates(row) {
    if (row.kind === 'form') return ['Required after applying; not sent yet'];
    const { request, state } = row;
    const dated = (label, value) => (formatTimestamp(value) === '—' ? null : `${label} ${formatTimestamp(value)}`);
    return [
        dated('Created', request.createdAt),
        state === 'signed' && dated('Signed', request.signedAt || request.completedAt),
        state === 'awaiting' && dated('Link expires', request.expiresAt),
        state === 'link_expired' && dated('Link expired', request.expiresAt),
    ].filter(Boolean);
}

function SigningDocumentRow({ row, busy, message, onSend, onRemind, onOpen }) {
    const presentation = STATE_PRESENTATION[row.state] || STATE_PRESENTATION.other;
    // Both only while the document is with its signer; a signed or voided one says just that.
    const failure = row.state === 'not_delivered' ? deliveryFailure(row.request) : null;
    const note = ['awaiting', 'link_expired'].includes(row.state) ? deliveryNote(row.request) : null;
    const canOpen = row.state === 'signed' && Boolean(row.request?.signedPdfUrl);

    return (
        <li>
            <Card padding="md">
                <div className="flex flex-col gap-ds-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-ds-2">
                            <h5 className="font-bold leading-tight text-ds-content [overflow-wrap:anywhere]">{row.title}</h5>
                            <Badge tone={presentation.tone} icon={presentation.icon}>
                                {presentation.label || row.request?.status || 'Unknown'}
                            </Badge>
                        </div>
                        <p className="mt-ds-1 flex flex-wrap gap-x-ds-4 gap-y-ds-1 text-ds-xs font-medium text-ds-content-secondary">
                            {rowDates(row).map((text) => <span key={text}>{text}</span>)}
                        </p>
                        {failure && (
                            <p className="mt-ds-1 text-ds-xs text-ds-status-danger-fg [overflow-wrap:anywhere]">
                                {failure.channel} not delivered{failure.error ? `: ${failure.error}` : ''}
                            </p>
                        )}
                        {note && (
                            <p className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">{note.note}</p>
                        )}
                    </div>

                    {(row.canSend || row.canRemind || canOpen) && (
                        <div className="flex flex-wrap items-center gap-ds-2 md:justify-end">
                            {row.canSend && (
                                <Button variant="primary" size="sm" loading={busy} onClick={() => onSend(row)}>
                                    {!busy && <Icon icon={Send} size="sm" />}
                                    Send to driver<span className="ds-visually-hidden"> — {row.title}</span>
                                </Button>
                            )}
                            {row.canRemind && (
                                <Button variant="secondary" size="sm" loading={busy} onClick={() => onRemind(row)}>
                                    {!busy && <Icon icon={Send} size="sm" />}
                                    Remind<span className="ds-visually-hidden"> — {row.title}</span>
                                </Button>
                            )}
                            {canOpen && (
                                <Button variant="secondary" size="sm" loading={busy} onClick={() => onOpen(row)}>
                                    {!busy && <Icon icon={ExternalLink} size="sm" />}
                                    Open signed copy
                                    <span className="ds-visually-hidden"> of {row.title} (opens in a new tab)</span>
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* On every row: a form that was just sent loses its button when the
                    live list catches up, and its message must stay where it was. */}
                <div role="status">
                    {message && (
                        <Notice tone={message.tone} size="sm" announce="off" className="mt-ds-3">
                            {message.text}
                        </Notice>
                    )}
                </div>
            </Card>
        </li>
    );
}

export function SigningDocumentsSection({ companyId, recordId, collectionName }) {
    const headingId = `signing-documents-${useId().replace(/:/g, '')}`;
    const isApplication = collectionName !== 'leads';
    const { rows, isLoading, error, formsError } = useRecordSigningRequests({ companyId, recordId, collectionName });
    const { busyKey, messages, sendToDriver, remind, openSigned } = useSigningDocumentActions({
        companyId,
        applicationId: isApplication ? recordId : null,
    });

    let body;
    if (isLoading) {
        body = <p role="status" className="px-ds-1 text-ds-sm text-ds-content-secondary">Loading signing documents…</p>;
    } else if (error) {
        body = <Notice tone="danger" announce="assertive">{error}</Notice>;
    } else if (rows.length === 0) {
        body = <p role="status" className="px-ds-1 text-ds-sm text-ds-content-secondary">No signing documents for this driver yet.</p>;
    } else {
        body = (
            <ul className="grid gap-ds-3">
                {rows.map((row) => (
                    <SigningDocumentRow
                        key={row.key}
                        row={row}
                        busy={busyKey === row.key}
                        message={messages[row.key]}
                        onSend={sendToDriver}
                        onRemind={remind}
                        onOpen={openSigned}
                    />
                ))}
            </ul>
        );
    }

    return (
        <section aria-labelledby={headingId} className="space-y-ds-4">
            <div className="px-ds-1">
                <h4 id={headingId} className="text-ds-body-lg font-bold text-ds-content">Signing documents</h4>
                <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
                    {isApplication
                        ? 'Documents sent to this driver to sign, and the forms the company requires after an application.'
                        : 'Documents sent to this driver to sign.'}
                </p>
            </div>
            {body}
            {formsError && !isLoading && <Notice tone="warning" size="sm" announce="polite">{formsError}</Notice>}
        </section>
    );
}

export default SigningDocumentsSection;
