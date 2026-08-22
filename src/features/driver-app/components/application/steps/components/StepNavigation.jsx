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
    // `size="lg"` is the design system's 52 px step, reserved for the primary
    // action of a public, mobile-first, single-task screen — which is exactly what
    // this is. The whole row takes it so Back, Continue and Save as Draft are the
    // same height as each other.
    //
    // It no longer means "match a form control": the Button default and
    // `.ds-form-control` are both 44 px now, so an ordinary action does not need
    // an override at all. These stay `lg` because they are the most-tapped
    // controls in the flow, not because the default was too small.
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
