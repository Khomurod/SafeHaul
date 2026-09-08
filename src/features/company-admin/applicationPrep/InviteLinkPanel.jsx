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
export function InviteLinkPanel({ link, busy, error, copied, canMint, onMint, onCopy }) {
    return (
        <Card padding="md">
            <div className="space-y-ds-3">
                <div>
                    <h3 className="text-ds-body-lg font-semibold text-ds-content">Send it to the driver</h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        They open the link, complete what only they can answer, review it and sign. Send it however you
                        normally reach them.
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
                            <Button variant="ghost" size="sm" onClick={onMint} disabled={busy}>
                                <Icon icon={RefreshCw} size="sm" /> Create a new link
                            </Button>
                        </div>
                        <p className="text-ds-xs text-ds-content-muted" role="status">
                            Works for {link.expiresInDays} days. Copy it now — it is shown once. Creating a new link
                            retires this one: it stops working about ten minutes later, so a driver part-way through
                            it is not cut off.
                        </p>
                    </div>
                ) : (
                    <Button variant="primary" onClick={onMint} disabled={busy || !canMint}>
                        <Icon icon={Link2} size="sm" /> Create the driver's link
                    </Button>
                )}
            </div>
        </Card>
    );
}

export default InviteLinkPanel;
