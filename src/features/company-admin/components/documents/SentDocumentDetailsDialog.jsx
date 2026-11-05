import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, Ban, Copy, Download, Edit3, Hourglass, RefreshCw, Send, X } from '@design-system/icons';
import { Modal } from '@design-system/patterns';
import { Badge, Button, IconButton, Notice } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { formatTimestamp, isLinkExpired } from '@features/company-admin/utils/documentsWorkspace';
import { canRemindSigner, sharedByCopiedLink } from '@features/signing/utils/signerReminder';
import { canSendSignedCopy, hasCompanySignature, isSignedCopyRetry } from '@features/signing/utils/signedCopy';
import { SignedCopyButton, SignedCopyStatus } from '@features/signing/components/SignedCopy';
import { useRerenderWhenClaimsExpire } from '@features/signing/hooks/useRerenderWhenClaimsExpire';
import { canRetrySeal, sealLeftUnfinished, sealStuckAt } from '@features/signing/utils/sealRetry';
import { useRerenderAt } from '@shared/hooks/useRerenderAt';
import { deliveryFailureCause, skippedTextNote } from './deliveryFailureCause';
import { FixRecipientForm } from './FixRecipientForm';

/**
 * Sent-document details.
 *
 * Read-only summary plus the same four actions the table row offers, so the
 * dialog never becomes a second source of truth for what can be done. A
 * document with a company signature also says where its signed copy stands
 * (`signedCopyRecord`) and offers Send signed copy where the row does. A
 * document whose seal failed, or was left unfinished for ten minutes, offers
 * Retry seal (`onRetrySeal`, busy while `retryingSeal`): the row's Review opens
 * this dialog, where the reason it failed is shown first. A document waiting
 * for its signer that went by email or text offers Remind (`onRemind`, busy
 * while `reminding`); one whose link ran out says so, and what to do.
 *
 * A failed send says why in plain words above the server's own text
 * (`deliveryFailureCause.js`). While the document is still with its signer
 * (`sent`) it offers, in this order: Fix recipient and resend (an inline form,
 * `FixRecipientForm`; `onFixRecipient(document, recipient)`, busy while
 * `fixingRecipient`), which takes Correct's place; Remind, named Resend here;
 * and Void. Nothing is offered that a signed, sealing or voided document could
 * not take. A voided document says when and by whom.
 *
 * SECURITY: the signing token is never rendered here. "Copy Link" calls the
 * authenticated `getSigningLink` callable exactly as the row action does; the
 * link is written to the clipboard and never into the DOM.
 */

const DELIVERY_LABEL = {
    email: 'Email',
    sms: 'SMS',
    both: 'Email + SMS',
    copy: 'Copy link',
    in_app_post_submit: 'After application',
};

function DetailRow({ label, children }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-b-0">
            <dt className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">{label}</dt>
            <dd className="min-w-0 max-w-[60%] text-right text-ds-sm text-ds-content [overflow-wrap:anywhere]">
                {children}
            </dd>
        </div>
    );
}

export function SentDocumentDetailsDialog({
    document,
    onClose,
    onCopyLink,
    onCorrect,
    onVoid,
    onDownload,
    copying = false,
    signedCopyRecord = null,
    onSendSignedCopy,
    onRetrySeal,
    retryingSeal = false,
    onRemind,
    reminding = false,
    onFixRecipient,
    fixingRecipient = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `sent-document-title-${rawId}`;
    const fixFormId = `fix-recipient-form-${rawId}`;
    const closeRef = useRef(null);
    const fixButtonRef = useRef(null);
    const nameRef = useRef(null);
    const [fixing, setFixing] = useState(false);
    const wasFixing = useRef(false);
    // A copy still being sent turns into Try again when its claim lapses.
    useRerenderWhenClaimsExpire([signedCopyRecord]);
    // A seal still running when the dialog opened offers Retry seal once it counts as unfinished.
    useRerenderAt(sealStuckAt(document));
    // Focus follows the form: into its first field, and back to the button that opened it.
    useEffect(() => {
        if (fixing) nameRef.current?.focus();
        else if (wasFixing.current) fixButtonRef.current?.focus();
        wasFixing.current = fixing;
    }, [fixing]);

    if (!document) return null;

    const title = document.title || 'Untitled';
    const status = String(document.status || 'unknown');
    const failure = deliveryFailureCause(document);
    const deliveryFailed = failure !== null;
    const sealFailed = status === 'error_sealing';
    // Still with its signer, and the send failed: the three actions below.
    const openFailed = deliveryFailed && status === 'sent';
    const offersFix = openFailed && Boolean(onFixRecipient);
    const skippedText = skippedTextNote(document);
    const offersSignedCopy = Boolean(onSendSignedCopy) && canSendSignedCopy(document, signedCopyRecord);
    const offersSealRetry = Boolean(onRetrySeal) && canRetrySeal(document);
    const expired = isLinkExpired(document);
    const offersRemind = Boolean(onRemind) && canRemindSigner(document);
    const reminderCount = Number(document.reminders?.count) || 0;

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            initialFocusRef={closeRef}
            size="lg"
            scroll="body"
        >
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <h2 id={titleId} className="min-w-0 text-ds-heading-sm font-bold text-ds-content [overflow-wrap:anywhere]">
                    {title}
                </h2>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                <Stack gap="md">
                    <dl className="flex flex-col">
                        <DetailRow label="Recipient">{document.recipientName || '—'}</DetailRow>
                        <DetailRow label="Email">{document.recipientEmail || '—'}</DetailRow>
                        <DetailRow label="Phone">{document.recipientPhone || '—'}</DetailRow>
                        <DetailRow label="Delivery">
                            {DELIVERY_LABEL[document.deliveryMethod] || document.deliveryMethod || '—'}
                        </DetailRow>
                        <DetailRow label="Sent">{formatTimestamp(document.createdAt)}</DetailRow>
                        <DetailRow label="Expires">{formatTimestamp(document.expiresAt)}</DetailRow>
                        <DetailRow label="Status">
                            {expired && !deliveryFailed
                                ? <Badge tone="warning" icon={Hourglass}>Link expired</Badge>
                                : <Badge tone={deliveryFailed || sealFailed ? 'danger' : 'neutral'}>{status}</Badge>}
                        </DetailRow>
                        {skippedText && <DetailRow label="Text message">{skippedText}</DetailRow>}
                        {status === 'voided' && (document.voidedAt || document.voidedByName) && (
                            <DetailRow label="Voided">
                                {`${formatTimestamp(document.voidedAt)}${document.voidedByName ? ` by ${document.voidedByName}` : ''}`}
                            </DetailRow>
                        )}
                        {reminderCount > 0 && (
                            <DetailRow label="Reminders">
                                {`${reminderCount} sent, the last on ${formatTimestamp(document.reminders.lastAt)}`}
                            </DetailRow>
                        )}
                        {hasCompanySignature(document) && (status === 'signed' || signedCopyRecord) && (
                            <DetailRow label="Signed copy">
                                {signedCopyRecord ? <SignedCopyStatus record={signedCopyRecord} /> : 'Not sent yet'}
                            </DetailRow>
                        )}
                    </dl>

                    {(deliveryFailed || sealFailed) && (
                        <Notice
                            announce="assertive"
                            tone="danger"
                            size="sm"
                            title={deliveryFailed ? `${failure.channel} delivery error` : 'Sealing error'}
                            titleAs="h3"
                        >
                            {deliveryFailed ? (
                                <>
                                    {/* What to do only where the actions it names are offered. */}
                                    <p>{offersFix ? `${failure.cause} ${failure.fix}` : failure.cause}</p>
                                    <p className="mt-ds-1 text-ds-xs [overflow-wrap:anywhere]">
                                        Details: {failure.raw || 'No further detail was recorded.'}
                                    </p>
                                </>
                            ) : (document.errorLog || 'No further detail was recorded.')}
                        </Notice>
                    )}
                    {expired && (
                        <Notice announce="polite" tone="warning" size="sm" title="Link expired" titleAs="h3">
                            The signer&apos;s link stopped working on {formatTimestamp(document.expiresAt)}.{' '}
                            {offersRemind && 'Remind sends it again with seven more days.'}
                            {sharedByCopiedLink(document) && 'It was shared by a copied link, so there is nothing to send again. Correct it to add an email address or a phone number.'}
                        </Notice>
                    )}
                    {offersSealRetry && sealLeftUnfinished(document) && (
                        <Notice announce="polite" tone="warning" size="sm" title="Sealing did not finish" titleAs="h3">
                            This document was signed more than ten minutes ago and is still not sealed. Seal it
                            again: the signer&apos;s answers stay exactly as they submitted them.
                        </Notice>
                    )}
                    {fixing && (
                        <FixRecipientForm
                            ref={nameRef}
                            id={fixFormId}
                            document={document}
                            onSubmit={(recipient) => onFixRecipient(document, recipient)}
                        />
                    )}
                </Stack>
            </div>

            <div className="flex flex-wrap justify-end gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                {fixing ? (
                    <>
                        <Button variant="ghost" disabled={fixingRecipient} onClick={() => setFixing(false)}>Cancel</Button>
                        <Button type="submit" form={fixFormId} variant="primary" loading={fixingRecipient}>
                            {!fixingRecipient && <Icon icon={Send} size="sm" />} Save and resend
                        </Button>
                    </>
                ) : (
                    <>
                        <Button ref={closeRef} variant="ghost" onClick={onClose}>Close</Button>
                        {status === 'signed' ? (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={() => onDownload(document.signedPdfUrl || document.storagePath)}
                                >
                                    <Icon icon={Download} size="sm" /> Download
                                </Button>
                                {offersSignedCopy && (
                                    <SignedCopyButton
                                        variant="primary"
                                        retry={isSignedCopyRetry(signedCopyRecord)}
                                        onClick={() => onSendSignedCopy(document)}
                                    />
                                )}
                            </>
                        ) : status === 'voided' ? null : (
                            <>
                                <Button variant="secondary" loading={copying} onClick={() => onCopyLink(document)}>
                                    {!copying && <Icon icon={Copy} size="sm" />} Copy Link
                                </Button>
                                {openFailed ? (
                                    <>
                                        {offersFix ? (
                                            <Button ref={fixButtonRef} variant="primary" onClick={() => setFixing(true)}>
                                                <Icon icon={Edit3} size="sm" /> Fix recipient and resend
                                            </Button>
                                        ) : onCorrect && (
                                            <Button variant="secondary" onClick={() => onCorrect(document)}>
                                                <Icon icon={Edit3} size="sm" /> Correct
                                            </Button>
                                        )}
                                        {offersRemind && (
                                            <Button variant="secondary" loading={reminding} onClick={() => onRemind(document)}>
                                                {!reminding && <Icon icon={Send} size="sm" />} Resend
                                            </Button>
                                        )}
                                        <Button variant="danger" onClick={() => onVoid(document)}>
                                            <Icon icon={Ban} size="sm" /> Void
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        {status === 'sent' && onCorrect && (
                                            <Button variant="secondary" onClick={() => onCorrect(document)}>
                                                <Icon icon={Edit3} size="sm" /> Correct
                                            </Button>
                                        )}
                                        {status === 'sent' && (
                                            <Button variant="danger" onClick={() => onVoid(document)}>
                                                <Icon icon={Ban} size="sm" /> Void
                                            </Button>
                                        )}
                                        {offersRemind && (
                                            <Button variant="primary" loading={reminding} onClick={() => onRemind(document)}>
                                                {!reminding && <Icon icon={Send} size="sm" />} Remind
                                            </Button>
                                        )}
                                        {offersSealRetry && (
                                            <Button variant="primary" loading={retryingSeal} onClick={() => onRetrySeal(document)}>
                                                {!retryingSeal && <Icon icon={RefreshCw} size="sm" />} Retry seal
                                            </Button>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

export default SentDocumentDetailsDialog;
