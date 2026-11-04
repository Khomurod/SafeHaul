import React from 'react';
import { Icon, Copy, Link2, Mail, RefreshCw } from '@design-system/icons';
import { Button, Card, FieldMessage } from '@/design-system/components';
import { canEmailLinkTo } from '@shared/utils/linkEmail';

/**
 * The link, and the one thing worth saying about it.
 *
 * The token is shown once because it exists once — the callable returns it and
 * never can again. So the panel says so rather than implying a link can be looked
 * up later, and offers the honest remedy: make a new one, which retires the old.
 *
 * ## The copy below is a claim about the server
 *
 * "Creating a new link retires this one" is true because
 * `functions/companyApplications/invite.js` gives each hash its own expiry, and a
 * replaced link keeps a ten-minute grace so a driver mid-page is not cut off.
 * **The sentence names the grace**, because "retires this one" on its own would
 * overstate it.
 */
/**
 * `driverStarted` is not a permission — the boundary is enforced in
 * `functions/companyApplications/invite.js`, where the exchange stops returning
 * the driver's answers and stops handing out a resume token. It is here so the
 * panel does not imply otherwise. Minting deliberately still works: a driver who
 * lost their link needs a new one, and the link it produces takes them to their
 * own application and asks them to confirm who they are. Hiding the button would
 * remove a workflow the boundary does not require removing.
 *
 * **That last sentence is a claim about the server too**, so the sentence below
 * names all four things the confirmation screen asks for, not two of them.
 *
 * ## Email first, Copy as the fallback
 *
 * "Email it to the driver" has the server email the link to the application's
 * own address (`functions/companyApplications/inviteDelivery.js`); this screen
 * learns only the address, masked (`delivered`), and never holds the link.
 * Without a usable address (`email`) it is not offered, and the panel says why.
 * Either press makes the newest link, which retires the one before it.
 */
export function InviteLinkPanel({
    link, busy, error, copied, copyFailed, driverStarted, onMint, onCopy,
    email = '', delivered = null, emailing = false, onEmail,
}) {
    const canEmail = Boolean(onEmail) && canEmailLinkTo(email);
    const emailButton = canEmail && (
        <Button variant={link ? 'secondary' : 'primary'} onClick={onEmail} loading={emailing} disabled={busy}>
            <Icon icon={Mail} size="sm" /> {delivered ? 'Email it again' : 'Email it to the driver'}
        </Button>
    );
    return (
        <Card padding="md">
            <div className="space-y-ds-3">
                <div>
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Send it to the driver</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        {driverStarted
                            ? 'This driver has already started. A new link still reaches their application — it asks '
                              + 'them to confirm their last name, date of birth, Social Security Number and one of '
                              + 'their contact details first, so only they can open it. If they saved before '
                              + 'entering their Social Security Number, it cannot confirm them, and they continue '
                              + 'on the phone or computer where they started. We can email it to them, or you can '
                              + 'copy it and send it however you normally reach them.'
                            : 'They open the link, complete what only they can answer, review it and sign. We can '
                              + 'email it to them, or you can copy it and send it however you normally reach them.'}
                    </p>
                </div>

                {error && <FieldMessage tone="error">{error}</FieldMessage>}

                {delivered && (
                    <p className="text-ds-sm text-ds-content" role="status">
                        {`Emailed to ${delivered.to}. It works for ${delivered.expiresInDays} days. Sending another `
                            + 'link, by email or to copy, retires this one about ten minutes later.'}
                    </p>
                )}

                {link ? (
                    <div className="space-y-ds-2">
                        <code
                            className="block overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 text-ds-xs text-ds-content"
                            data-testid="invite-link"
                        >
                            {link.url}
                        </code>
                        <div className="flex flex-wrap gap-ds-2">
                            <Button variant="primary" size="sm" onClick={onCopy}>
                                <Icon icon={Copy} size="sm" /> {copied ? 'Copied' : 'Copy link'}
                            </Button>
                            {emailButton}
                            <Button variant="ghost" size="sm" onClick={onMint} loading={busy} disabled={emailing}>
                                <Icon icon={RefreshCw} size="sm" /> Create a new link
                            </Button>
                        </div>
                        {/* A refused clipboard used to be silent — the label simply
                            never changed to "Copied", which reads as nothing having
                            happened. The link is selectable above either way, so
                            this is a lost convenience rather than a lost link, and
                            saying so is the whole fix. */}
                        {copyFailed && (
                            <FieldMessage tone="error">
                                Your browser would not let us copy it. Select the link above and copy it yourself.
                            </FieldMessage>
                        )}
                        <p className="text-ds-xs text-ds-content-muted" role="status">
                            Works for {link.expiresInDays} days. Copy it now — it is shown once. Creating a new link
                            retires this one: it stops working about ten minutes later, so a driver part-way through
                            it is not cut off.
                            {driverStarted && ' Their answers are theirs now, so this link will not show them to you.'}
                        </p>
                    </div>
                ) : (
                    /* Clickable with nothing saved yet: the press explains that a
                       link addresses a saved application, and offers to save. The
                       precondition used to be an undocumented `disabled`. */
                    <div className="flex flex-wrap gap-ds-2">
                        {emailButton}
                        <Button variant={canEmail ? 'secondary' : 'primary'} onClick={onMint} loading={busy} disabled={emailing}>
                            <Icon icon={Link2} size="sm" />{' '}
                            {delivered ? 'Create a link to copy' : (driverStarted ? 'Create a replacement link' : "Create the driver's link")}
                        </Button>
                    </div>
                )}

                {onEmail && !canEmail && (
                    <p className="text-ds-xs text-ds-content-muted">
                        No email address on this application, so the link can only be copied and sent another way.
                    </p>
                )}
            </div>
        </Card>
    );
}

export default InviteLinkPanel;
