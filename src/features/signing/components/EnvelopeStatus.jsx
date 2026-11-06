import React from 'react';
import { Icon, CheckCircle, Clock, Loader2, AlertCircle, MessageSquare, Mail, Ban, Hourglass } from '@design-system/icons';
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
 * A sent document's status in the history table: while it is still with its
 * signer, a failed delivery first, with its reason under the badge (the reason
 * explains the status), then a link that ran out, then the stored status. Once
 * it is signed, sealing or voided its own status is what the row says
 * (`openDeliveryFailure`). A text skipped for an opted-out number is a neutral
 * note under an open document's badge, never a failure (`deliveryNote`).
 */
export function EnvelopeStatusBadge({ document: docItem }) {
    const failure = openDeliveryFailure(docItem);
    if (failure) {
        // Truncate error for operator debugging without exposing sensitive internals
        const errorDetail = failure.error
            ? (failure.error.length > 80 ? failure.error.substring(0, 80) + '…' : failure.error)
            : `${failure.channel} delivery failed`;
        return (
            <div className="flex flex-col items-start gap-ds-1">
                <span title={failure.error || `${failure.channel} Delivery Failed`}>
                    <Badge tone="danger" icon={AlertCircle}>Delivery Failed</Badge>
                </span>
                {/* One clamped line; the complete safe detail lives in the details dialog. */}
                <span
                    className="line-clamp-1 max-w-[220px] text-ds-xs text-ds-status-danger-fg [overflow-wrap:anywhere]"
                    title={failure.error}
                >
                    {errorDetail}
                </span>
            </div>
        );
    }

    const s = (docItem.status || '').toLowerCase();
    const expired = isLinkExpired(docItem);
    const preset = STATUS_PRESENTATION[expired ? 'link_expired' : s];
    if (preset) {
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
        if (s === 'error_sealing') return <span title={docItem.errorLog || 'Sealing failed'}>{badge}</span>;
        const shown = expired
            ? <span title={`The link stopped working on ${formatTimestamp(docItem.expiresAt)}`}>{badge}</span>
            : badge;
        const note = OPEN_STATUSES.includes(s) ? deliveryNote(docItem) : null;
        if (!note) return shown;
        return (
            <div className="flex flex-col items-start gap-ds-1">
                {shown}
                <span className="line-clamp-1 max-w-[220px] text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]" title={note.note}>
                    {note.note}
                </span>
            </div>
        );
    }
    return <Badge tone="neutral">{docItem.status}</Badge>;
}

/** How a sent document was delivered: Email and SMS badges, or Manual for a copied link. */
export function DeliveryMethodBadges({ document: docItem }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-ds-1">
            {/* FEAT-4: Delivery method badge */}
            {docItem.sendEmail && <Badge tone="info" icon={Mail}>Email</Badge>}
            {docItem.sendSms && <Badge tone="success" icon={MessageSquare}>SMS</Badge>}
            {docItem.sendEmail === false && docItem.sendSms !== true && (
                <Badge tone="neutral">Manual</Badge>
            )}
        </span>
    );
}
