import React, { useId } from 'react';
import { Icon, X, Lock, Zap, Database } from '@design-system/icons';
import { Badge, Button, IconButton, StatusMedallion } from '@/design-system/components';
import { Modal } from '@design-system/patterns';
/**
 * "Feature not enabled" interstitial for feature-flagged areas (Import Leads,
 * E-Docs, driver search).
 *
 * Presentation only — `onClose`, the `featureName` default of
 * `"Search For Drivers"`, the Telegram sales URL and its `_blank` target, and
 * every user-facing string are unchanged.
 *
 * Rules it keeps:
 *  1. **The close control names what it closes**: the action row also has a
 *     "Close" button, and two identically named controls cannot be told apart by
 *     a screen-reader user.
 *  2. **`--ds-*` tokens, approved type and approved buttons only**, never legacy
 *     palette, gradients or hand-built buttons.
 *  3. **No decorative animation**: a dialog whose whole purpose is to deliver one
 *     sentence carries no blur orbs or endless pulse and bounce, which would need
 *     a reduced-motion guard and approved values of their own.
 */
export function FeatureLockedModal({ onClose, featureName = "Search For Drivers" }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            size="2xl"
        >
            <div className="absolute right-ds-4 top-ds-4 z-ds-raised">
                <IconButton label={`Close the ${featureName} notice`} variant="ghost" size="sm" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>

            <div className="flex flex-col items-center bg-ds-surface-subtle p-ds-12 text-center">
                <div className="relative mb-ds-8">
                    <StatusMedallion tone="info" size="lg"><Icon icon={Lock} /></StatusMedallion>
                    <span
                        aria-hidden="true"
                        className="absolute -bottom-1 -right-1 rounded-ds-full border-2 border-ds-surface bg-ds-status-warning-bg p-1.5 text-ds-status-warning-fg"
                    >
                        <Icon icon={Database} size="sm" />
                    </span>
                </div>

                <h2 id={titleId} className="mb-ds-3 text-ds-heading-xl font-bold tracking-tight text-ds-content">
                    {featureName}
                </h2>

                <div className="mb-ds-6">
                    <Badge tone="info" icon={Zap}>Coming Soon</Badge>
                </div>

                <p id={descriptionId} className="mx-auto mb-ds-8 max-w-md text-ds-body-lg leading-relaxed text-ds-content-secondary">
                    This feature is currently turned off for your company. Please contact our Sales Team to enable it.
                </p>

                <div className="flex w-full max-w-md flex-col justify-center gap-ds-4 sm:flex-row">
                    <Button
                        variant="primary"
                        className="flex-1"
                        onClick={() => window.open('https://t.me/tomr_robins0n', '_blank')}
                    >
                        Contact Sales
                    </Button>

                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
