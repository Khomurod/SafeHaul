import React from 'react';
import { Button } from '@/design-system/components';

/**
 * The public application wizard's step footer.
 *
 * Feature-owned composition of approved `Button`s: the design system owns how a
 * button looks, this component owns which actions a wizard step offers and in
 * what order. Extracted so the eight steps cannot drift apart again — before
 * this, each step repeated its own hand-styled Back/Continue pair.
 *
 * Frozen contracts: the accessible names "Back", "Continue", "Save as Draft",
 * "Uploading...", "Confirm & Proceed" and "Submit Full Application" are all
 * selected by `e2e/helpers/wizardHelpers.cjs` and the guest specs, so callers
 * must keep passing those exact labels.
 */
export function StepNavigation({
    onBack,
    onContinue,
    continueLabel = 'Continue',
    continueIcon = null,
    continueTone = 'default',
    continueDisabled = false,
    continueLoading = false,
    onSaveDraft,
    saveDraftLabel = 'Save as Draft',
}) {
    // `size="lg"` is the approved 44 px control height. The Button default (`md`)
    // is 40 px, which clears WCAG 2.2 AA Target Size (Minimum, 24 px) but not the
    // 44 px the design system's own form controls use. This is a mobile-primary
    // flow whose most-tapped controls are these, so they take the larger approved
    // size rather than a local override.
    return (
        <div className="flex flex-col gap-ds-3 pt-ds-6 sm:flex-row sm:items-center sm:justify-between">
            {onBack ? (
                <Button variant="secondary" size="lg" onClick={onBack}>Back</Button>
            ) : (
                <span className="hidden sm:block" />
            )}
            <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-center">
                {onSaveDraft && (
                    <Button variant="secondary" size="lg" onClick={onSaveDraft}>{saveDraftLabel}</Button>
                )}
                <Button
                    variant="primary"
                    size="lg"
                    tone={continueTone}
                    onClick={onContinue}
                    disabled={continueDisabled}
                    loading={continueLoading}
                >
                    {continueLabel}
                    {continueIcon}
                </Button>
            </div>
        </div>
    );
}

export default StepNavigation;
