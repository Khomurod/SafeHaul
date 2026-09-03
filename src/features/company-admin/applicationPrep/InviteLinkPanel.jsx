import React from 'react';
import { Copy, Link2, RefreshCw } from 'lucide-react';
import { Button, Card, FieldMessage } from '@/design-system/components';

/**
 * The link, and the one thing worth saying about it.
 *
 * The token is shown once because it exists once — the callable returns it and
 * never can again. So the panel says so rather than implying a link can be looked
 * up later, and offers the honest remedy: make a new one, which retires the old.
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
                                <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy link'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onMint} disabled={busy}>
                                <RefreshCw size={14} aria-hidden="true" /> Create a new link
                            </Button>
                        </div>
                        <p className="text-ds-xs text-ds-content-muted" role="status">
                            Works for {link.expiresInDays} days. Copy it now — it is shown once, and creating a new one
                            retires this one.
                        </p>
                    </div>
                ) : (
                    <Button variant="primary" onClick={onMint} disabled={busy || !canMint}>
                        <Link2 size={14} aria-hidden="true" /> Create the driver's link
                    </Button>
                )}
            </div>
        </Card>
    );
}

export default InviteLinkPanel;
