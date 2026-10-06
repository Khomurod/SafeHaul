import React, { useRef, useState } from 'react';
import { Checkbox } from '@/design-system/components';
import { StepNavigation } from './StepNavigation';

/**
 * One agreement, alone on its page.
 *
 * The FCRA disclosure must be "a document that consists solely of the
 * disclosure" (15 U.S.C. 1681b(b)(2)(A)). The FMCSA PSP form says its language
 * "must exist as one stand-alone document" and "may NOT be included with other
 * consent forms or any other language". So each agreement gets a page of its
 * own, holding the document, its one acknowledgement and the way on, and no
 * other text shares it.
 *
 * Next is never disabled for an unticked box: pressed, it says what is missing
 * under the box and moves focus to it (the design system's "explain rather than
 * prevent"), so a keyboard user learns why it did not go on.
 *
 * Frozen: the `agreement-<id>` checkbox ids and the "<title> full text" group.
 * `e2e/helpers/wizardHelpers.cjs` and `e2e/public-application-responsive.spec.cjs`
 * select them. The group stays focusable so a keyboard user can move to the text
 * they are about to accept.
 */
export function AgreementDocumentPage({
    agreement,
    position,
    total,
    accepted,
    onAcceptedChange,
    onBack,
    onNext,
    headingRef,
}) {
    const checkboxId = `agreement-${agreement.id}`;
    const headingId = `agreement-${agreement.id}-heading`;
    const checkboxRef = useRef(null);
    const [refused, setRefused] = useState(false);

    const handleNext = () => {
        if (!accepted) {
            setRefused(true);
            checkboxRef.current?.focus();
            return;
        }
        onNext();
    };

    return (
        <section aria-labelledby={headingId} className="space-y-ds-4">
            <p className="text-ds-sm text-ds-content-muted">Document {position} of {total}</p>
            <h3
                id={headingId}
                ref={headingRef}
                tabIndex={-1}
                className="text-ds-body-lg font-semibold text-ds-content focus-visible:shadow-ds-focus"
            >
                {agreement.title}
            </h3>
            <div
                tabIndex={0}
                role="group"
                aria-label={`${agreement.title} full text`}
                className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
            >
                <p className="whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-content-secondary">
                    {agreement.body}
                </p>
            </div>
            <div className="rounded-ds-md bg-ds-surface-subtle p-ds-4">
                <Checkbox
                    ref={checkboxRef}
                    id={checkboxId}
                    name={checkboxId}
                    label="I have read and agree"
                    description={`I have read, understood, and agree to the ${agreement.title.toLowerCase()}.`}
                    required
                    checked={accepted}
                    onChange={(e) => onAcceptedChange(e.target.checked)}
                    error={refused && !accepted ? 'Tick "I have read and agree" to go on.' : undefined}
                />
            </div>
            <StepNavigation
                onBack={onBack}
                onContinue={handleNext}
                continueLabel={position === total ? 'Continue to signature' : 'Next document'}
            />
        </section>
    );
}

export default AgreementDocumentPage;
