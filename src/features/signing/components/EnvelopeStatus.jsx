import React from 'react';
import { Icon, CheckCircle, Clock, Loader2, AlertCircle, MessageSquare, Mail, Ban, Hourglass, Pencil } from '@design-system/icons';
import { Badge } from '@/design-system/components';
import {
    OPEN_STATUSES, STATUS_NAMES, deliveryNote, formatTimestamp, isLinkExpired, openDeliveryFailure,
} from '@features/company-admin/utils/documentsWorkspace';

/**
 * Feature-owned domain → visual mapping for a signing-request status.
 *
 * The design system only knows generic Badge tones; this feature owns which
 * status maps to which tone, icon and label. Tones preserve the previous
 * appearance: signed=success (green), sent=info (blue), voided/seal-failed=
 * danger (red), sealing/processing=warning (yellow/amber), unknown=neutral.
 * A sent document whose link ran out (`isLinkExpired`) is warning, like the
 * dossier's. Every badge pairs its tone with an icon and text, so status is
 * never communicated by colour alone.
 */
const STATUS_PRESENTATION = {
    // The names are the filter's and the details dialog's (`STATUS_NAMES`).
    signed: { tone: 'success', label: STATUS_NAMES.signed, icon: CheckCircle },
    sent: { tone: 'info', label: STATUS_NAMES.sent, icon: Clock },
    opened: { tone: 'info', label: STATUS_NAMES.opened, icon: Clock },
    voided: { tone: 'danger', label: STATUS_NAMES.voided, icon: Ban },
    pending_seal: { tone: 'warning', label: STATUS_NAMES.pending_seal, icon: Loader2, spin: true },
    error_sealing: { tone: 'danger', label: STATUS_NAMES.error_sealing, icon: AlertCircle },
    processing: { tone: 'warning', label: STATUS_NAMES.processing, icon: Loader2, spin: true },
    link_expired: { tone: 'warning', label: 'Link expired', icon: Hourglass },
};

/**
 * A sent document's status: its badge and the line under it, if any. While it
 * is still with its signer, a failed delivery first, with its reason (the
 * reason explains the status), then a link that ran out, then the stored
 * status. Once it is signed, sealing or voided its own status is what the row
 * says (`openDeliveryFailure`). A text skipped for an opted-out number is a
 * neutral note under an open document's badge, never a failure
 * (`deliveryNote`).
 */
function statusParts(docItem, detailSize = 'text-ds-xs') {
    const failure = openDeliveryFailure(docItem);
    if (failure) {
        // Truncate error for operator debugging without exposing sensitive internals
        const errorDetail = failure.error
            ? (failure.error.length > 80 ? failure.error.substring(0, 80) + '…' : failure.error)
            : `${failure.channel} delivery failed`;
        return {
            badge: (
                <span title={failure.error || `${failure.channel} delivery failed`}>
                    <Badge tone="danger" icon={AlertCircle}>Delivery failed</Badge>
                </span>
            ),
            // The reason wraps rather than being cut by the column; the
            // 80-character safety cut above stays, and the complete safe detail
            // lives in the details dialog.
            detail: (
                <span className={`${detailSize} text-ds-status-danger-fg [overflow-wrap:anywhere]`} title={failure.error}>
                    {errorDetail}
                </span>
            ),
        };
    }

    const s = (docItem.status || '').toLowerCase();
    const expired = isLinkExpired(docItem);
    const preset = STATUS_PRESENTATION[expired ? 'link_expired' : s];
    if (!preset) return { badge: <Badge tone="neutral">{docItem.status}</Badge>, detail: null };
    /*
     * `Glyph`, not `Icon`: the contract's own component is called `Icon`
     * and this file imports it, so holding the preset's glyph under that
     * name would shadow the import — and what the shadow holds is a
     * token, which throws when rendered.
     *
     * `size="xs"` stays explicit: `Badge` sizes the glyph it takes through
     * its `icon` PROP and has no rule for one passed as a CHILD, which is
     * the roadmap's open "Badge does not size its glyph" gap. Passing the
     * glyph as the prop instead would drop the spin class this needs.
     */
    const Glyph = preset.icon;
    const badge = (
        <Badge tone={preset.tone}>
            <Icon icon={Glyph} size="xs" className={preset.spin ? 'animate-spin' : undefined} />
            {preset.label}
        </Badge>
    );
    // Preserve the sealing-failure tooltip; say when an expired link stopped working.
    if (s === 'error_sealing') return { badge: <span title={docItem.errorLog || 'Sealing failed'}>{badge}</span>, detail: null };
    const shown = expired
        ? <span title={`The link stopped working on ${formatTimestamp(docItem.expiresAt)}`}>{badge}</span>
        : badge;
    const note = OPEN_STATUSES.includes(s) ? deliveryNote(docItem) : null;
    return {
        badge: shown,
        detail: note ? <span className={`${detailSize} text-ds-content-secondary [overflow-wrap:anywhere]`}>{note.note}</span> : null,
    };
}

/** A sent document's status badge, with its reason or delivery note under it. */
export function EnvelopeStatusBadge({ document: docItem }) {
    const { badge, detail } = statusParts(docItem);
    if (!detail) return badge;
    return (
        <div className="flex flex-col items-start gap-ds-1">
            {badge}
            {detail}
        </div>
    );
}

/**
 * The history table's "Status · Delivery" cell: the status badge, the line
 * under it, any `extra` line (where a signed copy stands), then how it was
 * delivered. As an item (`layout="item"`, the tablet list) and on a phone card,
 * the delivery chips share the badge's row and the lines follow it at 14px.
 */
export function EnvelopeStatusCell({ document: docItem, extra = null, layout = 'table' }) {
    if (layout === 'item') {
        const { badge, detail } = statusParts(docItem, 'text-ds-body');
        return (
            <div className="flex flex-row flex-wrap items-center gap-ds-1">
                {badge}
                <DeliveryMethodBadges document={docItem} />
                {detail && <span className="basis-full">{detail}</span>}
                {extra && <span className="basis-full">{extra}</span>}
            </div>
        );
    }
    const { badge, detail } = statusParts(docItem, 'text-ds-xs max-md:text-ds-body');
    return (
        <div className="flex flex-col items-start gap-ds-1 max-md:flex-row max-md:flex-wrap max-md:items-center">
            {badge}
            <span className="mt-ds-1 md:order-last max-md:mt-0">
                <DeliveryMethodBadges document={docItem} />
            </span>
            {detail && <span className="max-md:basis-full">{detail}</span>}
            {extra && <span className="max-md:basis-full">{extra}</span>}
        </div>
    );
}

/**
 * How a sent document was delivered: Email and SMS chips, or Manual for a
 * copied link. Channels, not states: each is neutral with its channel's glyph,
 * so only the status badge beside them carries a colour.
 */
export function DeliveryMethodBadges({ document: docItem }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-ds-1">
            {/* FEAT-4: Delivery method badge */}
            {docItem.sendEmail && <Badge tone="neutral" icon={Mail}>Email</Badge>}
            {docItem.sendSms && <Badge tone="neutral" icon={MessageSquare}>SMS</Badge>}
            {docItem.sendEmail === false && docItem.sendSms !== true && (
                <Badge tone="neutral" icon={Pencil}>Manual</Badge>
            )}
        </span>
    );
}
