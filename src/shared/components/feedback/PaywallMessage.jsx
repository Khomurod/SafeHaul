import React from 'react';
import { Lock, Mail } from 'lucide-react';
import { Button } from '@/design-system/components';

/**
 * Reusable component for displaying a paywall/upgrade message
 * when a feature is disabled for the company.
 *
 * Presentation migrated to the approved `Button` and `--ds-*` tokens
 * (2026-07-27) as part of the PEV initiation/tracking campaign. Consumed by the
 * PEV tab and the Campaigns dashboard; the sales contact URL, the
 * `window.open(url, '_blank')` behaviour and both default strings are unchanged.
 *
 * DEFECT FIXED (2026-07-27): the heading was always an `<h3>`, which collides
 * with the section heading of whichever surface renders it — inside the driver
 * dossier that put a second `<h3>` at the same level as the dossier's own
 * section title. The level is now the caller's choice, defaulting to the
 * previous `h3` so existing consumers are unaffected.
 */
export function PaywallMessage({ title, message, headingLevel: Heading = 'h3' }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-ds-xl border-2 border-dashed border-ds-border bg-ds-surface-subtle p-ds-12 text-center">
            <span
                aria-hidden="true"
                className="mb-ds-6 flex h-20 w-20 items-center justify-center rounded-ds-xl bg-ds-status-warning-bg text-ds-status-warning-fg shadow-ds-md"
            >
                <Lock size={40} />
            </span>
            <Heading className="mb-ds-3 text-ds-heading-sm font-bold text-ds-content">{title || 'Paid Feature'}</Heading>
            <p className="mb-ds-6 max-w-md leading-relaxed text-ds-content-secondary">
                {message || 'This feature is only available to premium subscribers.'}
            </p>
            <Button
                variant="primary"
                onClick={() => window.open('https://t.me/tomr_robins0n', '_blank')}
            >
                <Mail size={18} aria-hidden="true" /> Contact Sales
            </Button>
        </div>
    );
}
