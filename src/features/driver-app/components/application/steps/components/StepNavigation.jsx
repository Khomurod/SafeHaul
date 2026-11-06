import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/components';
import { FinishLaterNotice } from './FinishLaterNotice';

/**
 * The public application wizard's step footer.
 *
 * Feature-owned composition of approved `Button`s: the design system owns how a
 * button looks, this component owns which actions a wizard step offers and in
 * what order. Extracted so the eight steps cannot drift apart again — before
 * this, each step repeated its own hand-styled Back/Continue pair.
 *
 * Frozen contracts: the accessible names "Back", "Continue", "Finish later",
 * "Uploading...", "Confirm & Proceed" and "Submit Full Application" are all
 * selected by `e2e/helpers/wizardHelpers.cjs` and the guest specs, so callers
 * must keep passing those exact labels.
 *
 * **"Finish later"** (`onSaveDraft`) makes the save every Continue already makes,
 * without moving on, and says under the buttons how the driver comes back
 * (`FinishLaterNotice`). `onSaveDraft` returns `{ saved, anotherDevice }` when it
 * saved — `anotherDevice` a promise of whether another device can find the copy —
 * and null when it did not (it has said why itself). The notice sits in a polite
 * live region mounted with the footer, so it is announced when it appears, and it
 * stays until the driver leaves the step. Only the latest press may add the
 * another-device line.
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
    saveDraftLabel = 'Finish later',
}) {
    const [finishLater, setFinishLater] = useState(null);
    const pressRef = useRef(0);
    useEffect(() => () => { pressRef.current = -1; }, []);

    const handleFinishLater = () => {
        const outcome = onSaveDraft();
        if (!outcome?.saved) return;
        const press = ++pressRef.current;
        setFinishLater({ anotherDevice: false });
        Promise.resolve(outcome.anotherDevice).then((found) => {
            if (found === true && pressRef.current === press) setFinishLater({ anotherDevice: true });
        }, () => {});
    };

    // `size="lg"` is the design system's 52 px step, reserved for the primary
    // action of a public, mobile-first, single-task screen — which is exactly what
    // this is. The whole row takes it so Back, Continue and Finish later are the
    // same height as each other.
    //
    // It no longer means "match a form control": the Button default and
    // `.ds-form-control` are both 44 px now, so an ordinary action does not need
    // an override at all. These stay `lg` because they are the most-tapped
    // controls in the flow, not because the default was too small.
    return (
        <div className="pt-ds-6">
            <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-center sm:justify-between">
                {onBack ? (
                    <Button variant="secondary" size="lg" onClick={onBack}>Back</Button>
                ) : (
                    <span className="hidden sm:block" />
                )}
                <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-center">
                    {onSaveDraft && (
                        <Button variant="secondary" size="lg" onClick={handleFinishLater}>{saveDraftLabel}</Button>
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
            {onSaveDraft && (
                <div role="status">
                    {finishLater && <FinishLaterNotice className="mt-ds-4" anotherDevice={finishLater.anotherDevice} />}
                </div>
            )}
        </div>
    );
}

export default StepNavigation;
