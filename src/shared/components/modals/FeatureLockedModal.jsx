import React, { useId } from 'react';
import { X, Lock, Zap, Database } from 'lucide-react';
import { Badge, Button, IconButton, StatusMedallion } from '@/design-system/components';
import { Modal } from './Modal';

/**
 * "Feature not enabled" interstitial for feature-flagged areas (Import Leads,
 * E-Docs, driver search).
 *
 * Migrated to the design system 2026-07-28. Presentation only — `onClose`, the
 * `featureName` default of `"Search For Drivers"`, the Telegram sales URL and its
 * `_blank` target, and every user-facing string are unchanged.
 *
 * Defects fixed:
 *  1. **The close control's `aria-label` was the bare word "Close"** on a dialog
 *     that also has a "Close" button in the action row, so a screen-reader user
 *     heard two identically-named controls. It now names what it closes.
 *  2. **Legacy palette and unapproved type throughout** — a `bg-gray-900/70`
 *     backdrop, `bg-white rounded-2xl shadow-2xl border-white/20` chrome,
 *     `text-3xl font-extrabold`, a `from-blue-600 to-indigo-600` gradient pill,
 *     `text-gray-600 text-lg` body copy and two `bg-blue-600` / `bg-white`
 *     hand-built buttons.
 *  3. **Four purely decorative animated blur orbs and a `ring-4` lock badge** ran
 *     `animate-pulse` and `animate-bounce` indefinitely with no reduced-motion
 *     guard, on a dialog whose whole purpose is to deliver one sentence. The
 *     decoration is removed rather than tokenised: it carried no meaning, and
 *     keeping it would have meant inventing approved values for it.
 *  4. **A dead `<style>` block** defined a `shimmer` keyframe animation that
 *     nothing referenced.
 *  5. The unused `onGoToLeads` prop and `ArrowRight` import are removed — no
 *     caller ever passed the prop and nothing rendered the icon.
 */
export function FeatureLockedModal({ onClose, featureName = "Search For Drivers" }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
            className="relative w-full max-w-2xl overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="absolute right-ds-4 top-ds-4 z-10">
                <IconButton label={`Close the ${featureName} notice`} variant="ghost" size="sm" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="flex flex-col items-center bg-ds-surface-subtle p-ds-12 text-center">
                <div className="relative mb-ds-8">
                    <StatusMedallion tone="info" size="lg"><Lock size={40} /></StatusMedallion>
                    <span
                        aria-hidden="true"
                        className="absolute -bottom-1 -right-1 rounded-full border-2 border-ds-surface bg-ds-status-warning-bg p-1.5 text-ds-status-warning-fg"
                    >
                        <Database size={14} />
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
                        size="lg"
                        className="flex-1"
                        onClick={() => window.open('https://t.me/tomr_robins0n', '_blank')}
                    >
                        Contact Sales
                    </Button>

                    <Button variant="secondary" size="lg" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
