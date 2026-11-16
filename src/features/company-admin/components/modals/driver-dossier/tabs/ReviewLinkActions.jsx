import React from 'react';
import { Icon, Link2, Mail } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { canEmailLinkTo } from '@shared/utils/linkEmail';

/**
 * The two ways the driver gets the "approve changes" link, under the pending
 * changes in the dossier's Application tab.
 *
 * **Email review link to driver** has the server email it to the application's
 * own address (`createChangeReview` with `deliver: 'email'`); this screen learns
 * only where, masked (`emailedTo`), and never holds the link. **Copy driver
 * review link** stays as the fallback. Only the newest link works, so each press
 * replaces the link before it, and the line below says so. Without a usable
 * address the email is not offered, and the line says why.
 *
 * One press is in flight at a time: an email still being sent when a copy
 * replaced its link would reach the driver dead.
 */
export function ReviewLinkActions({ email, linking = false, emailing = false, emailedTo = null, onEmail, onCopy }) {
    const canEmail = Boolean(onEmail) && canEmailLinkTo(email);
    let note = '';
    if (emailedTo) note = `Emailed to ${emailedTo}. A copied link replaces the emailed one.`;
    else if (!canEmail) note = 'No email address on this application, so the review link can only be copied.';
    return (
        <>
            {canEmail && (
                <Button variant="primary" size="sm" onClick={onEmail} disabled={linking} loading={emailing}>
                    {emailing ? null : <Icon icon={Mail} size="sm" />}
                    Email review link to driver
                </Button>
            )}
            <Button
                variant="secondary"
                size="sm"
                onClick={onCopy}
                disabled={linking || emailing}
                loading={linking}
            >
                {linking ? null : <Icon icon={Link2} size="sm" />}
                Copy driver review link
            </Button>
            {/* Always in the page, so filling it is announced; empty, it takes no line. */}
            <p role="status" className={note ? 'w-full text-ds-xs text-ds-content-secondary' : 'sr-only'}>{note}</p>
        </>
    );
}

export default ReviewLinkActions;
