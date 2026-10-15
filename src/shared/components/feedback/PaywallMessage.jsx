import React from 'react';
import { Icon, Lock, Mail } from '@design-system/icons';
import { Button } from '@/design-system/components';

/**
 * Reusable component for displaying a paywall/upgrade message
 * when a feature is disabled for the company.
 *
 * Presentation uses the approved `Button` and `--ds-*` tokens. Consumed by the
 * PEV tab and the Campaigns dashboard; the sales contact URL, the
 * `window.open(url, '_blank')` behaviour and both default strings are unchanged.
 *
 * The heading level is the caller's choice (`headingLevel`), because a fixed
 * level collides with the section heading of whichever surface renders it; it
 * defaults to `h3`, which existing consumers rely on.
 */
export function PaywallMessage({ title, message, headingLevel: Heading = 'h3' }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-ds-xl border-2 border-dashed border-ds-border bg-ds-surface-subtle p-ds-12 text-center">
            <span
                aria-hidden="true"
                className="mb-ds-6 flex h-20 w-20 items-center justify-center rounded-ds-xl bg-ds-status-warning-bg text-ds-status-warning-fg shadow-ds-md"
            >
                {/* A tinted icon TILE — a rounded square with a shadow, which is the
                    half of that shape no primitive owns yet. Not a medallion:
                    that is a circle. 40 is not a step, so the glyph snaps. */}
                <Icon icon={Lock} size="3xl" />
            </span>
            <Heading className="mb-ds-3 text-ds-heading-sm font-bold text-ds-content">{title || 'Paid Feature'}</Heading>
            <p className="mb-ds-6 max-w-md leading-relaxed text-ds-content-secondary">
                {message || 'This feature is only available to premium subscribers.'}
            </p>
            <Button
                variant="primary"
                onClick={() => window.open('https://t.me/tomr_robins0n', '_blank')}
            >
                <Icon icon={Mail} size="lg" /> Contact Sales
            </Button>
        </div>
    );
}
