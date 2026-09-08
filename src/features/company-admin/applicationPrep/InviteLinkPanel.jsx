import React from 'react';
import { Icon, Copy, Link2, RefreshCw } from '@design-system/icons';
import { Button, Card, FieldMessage } from '@/design-system/components';

/**
 * The link, and the one thing worth saying about it.
 *
 * The token is shown once because it exists once — the callable returns it and
 * never can again. So the panel says so rather than implying a link can be looked
 * up later, and offers the honest remedy: make a new one, which retires the old.
 *
 * ## The copy below is a claim about the server, and it was false
 *
 * "Creating a new one retires this one" described the intent while the server did
 * the opposite: one document-level expiry, rewritten by every mint and shared by
 * every accepted hash, so regenerating revived the old link for a further fourteen
 * days instead of retiring it. Fixed on 2026-09-08 in
 * `functions/companyApplications/invite.js`, where each hash now carries its own
 * expiry and a replaced link keeps a ten-minute grace so a driver mid-page is not
 * cut off. **The sentence names the grace**, because "retires this one" on its own
 * is the wording that was wrong before.
 */
/**
 * `driverStarted` is not a permission — the boundary is enforced in
 * `functions/companyApplications/invite.js`, where the exchange stops returning
 * the driver's answers and stops handing out a resume token. It is here so the
 * panel does not imply otherwise. Minting deliberately still works: a driver who
 * lost their link needs a new one, and the link it produces takes them to their
 * own application and asks them to confirm who they are. Hiding the button would
 * remove a workflow the boundary does not require removing.
 */
export function InviteLinkPanel({ link, busy, error, copied, copyFailed, driverStarted, onMint, onCopy }) {
    return (
        <Card padding="md">
            <div className="space-y-ds-3">
                <div>
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Send it to the driver</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        {driverStarted
                            ? 'This driver has already started. A new link still reaches their application — it asks '
                              + 'them to confirm their date of birth and Social Security Number first, so only they '
                              + 'can open it. Send it however you normally reach them.'
                            : 'They open the link, complete what only they can answer, review it and sign. Send it '
                              + 'however you normally reach them.'}
                    </p>
                </div>

                {error && <FieldMessage tone="error">{error}</FieldMessage>}

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
                            <Button variant="ghost" size="sm" onClick={onMint} loading={busy}>
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
                    <Button variant="primary" onClick={onMint} loading={busy}>
                        <Icon icon={Link2} size="sm" /> {driverStarted ? 'Create a replacement link' : "Create the driver's link"}
                    </Button>
                )}
            </div>
        </Card>
    );
}

export default InviteLinkPanel;
