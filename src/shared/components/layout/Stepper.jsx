import React, { useEffect, useMemo, useRef } from 'react';
import Step1_Contact from '../../../features/driver-app/components/application/steps/Step1_Contact';
import Step2_Qualifications from '../../../features/driver-app/components/application/steps/Step2_Qualifications';
import Step3_License from '../../../features/driver-app/components/application/steps/Step3_License';
import Step4_Violations from '../../../features/driver-app/components/application/steps/Step4_Violations';
import Step5_Accidents from '../../../features/driver-app/components/application/steps/Step5_Accidents';
import Step6_Employment from '../../../features/driver-app/components/application/steps/Step6_Employment';
import Step7_General from '../../../features/driver-app/components/application/steps/Step7_General';
import Step8_Review from '../../../features/driver-app/components/application/steps/Step8_Review';
import Step9_Consent from '../../../features/driver-app/components/application/steps/Step9_Consent';
import { DynamicQuestionsStep } from '../../../features/driver-app/components/application/steps/DynamicQuestionsStep';
import { ProgressBar } from '@/design-system/components';
import { initializeSignatureCanvas, clearCanvas } from '@/lib/signature';

export function buildSemanticStepOrder(hasCustomQuestions) {
    const order = ['contact', 'qualifications', 'license', 'violations', 'accidents', 'employment', 'general'];
    if (hasCustomQuestions) order.push('custom_questions');
    order.push('review', 'consent');
    return order;
}

export function resolveWizardStepIndex(semanticStep, hasCustomQuestions) {
    const order = buildSemanticStepOrder(hasCustomQuestions);
    if (typeof semanticStep === 'number' && semanticStep >= 0 && semanticStep < order.length) {
        return semanticStep;
    }
    const idx = order.indexOf(semanticStep);
    return idx >= 0 ? idx : 0;
}

// Base page config (without custom questions)
const basePageConfig = [
    { title: "Step 1: Personal Information", component: Step1_Contact, semanticId: 'contact' },
    { title: "Step 2: Qualification Information", component: Step2_Qualifications, semanticId: 'qualifications' },
    { title: "Step 3: License Information", component: Step3_License, semanticId: 'license' },
    { title: "Step 4: Motor Vehicle Record", component: Step4_Violations, semanticId: 'violations' },
    { title: "Step 5: Accident History", component: Step5_Accidents, semanticId: 'accidents' },
    { title: "Step 6: Employment History", component: Step6_Employment, semanticId: 'employment' },
    { title: "Step 7: General Questions", component: Step7_General, semanticId: 'general' },
    { title: "Step 8: Review Information", component: Step8_Review, semanticId: 'review' },
    { title: "Step 9: Agreements & Signature", component: Step9_Consent, semanticId: 'consent' },
];

/**
 * Public driver-application wizard frame.
 *
 * Presentation is migrated to the approved `Card` / `ProgressBar` primitives and
 * `--ds-*` tokens. Frozen contracts: the `#step-title` element id and its exact
 * `Step N of M: <Title>` text (asserted with `toHaveText` by
 * `e2e/public-application.spec.cjs`, `e2e/guest-application-intake.spec.cjs` and
 * `e2e/guest-offline-queue.spec.cjs`), the `#driver-form` id every step reads
 * with `document.getElementById` for native validation, the custom-questions
 * insertion position and titles, the `submissionStatus` → bar tone mapping, the
 * "only 100% on success" rule, the signature-canvas initialisation on the last
 * step, the `Error: Step N not found.` fallback, and the sandbox Magic Fill
 * control.
 *
 * DEFECTS FIXED (2026-07-27):
 * - The step title was an `<h2>` on a page with no `<h1>`, and every step then
 *   rendered its own `<h3>` repeating the same "Step N of 9" text — which was
 *   also *wrong* whenever custom questions made it 10 steps. The title is now
 *   the page's single `<h1>` and the duplicated per-step headings are gone.
 * - Progress was communicated by a bare `<div>`'s width, invisible to assistive
 *   technology. It is now an approved `ProgressBar` labelled by the step title.
 * - On every step change focus was silently dropped to `<body>` (the Continue
 *   button that triggered the change unmounts), so keyboard and screen-reader
 *   users were never told the step had changed and had to tab from the top of
 *   the document. Focus now moves to the step heading.
 * - Two competing scrolls ran per transition (`PublicApplyHandler` did an
 *   instant `window.scrollTo(0, 0)` and this component a smooth one). The
 *   smooth animation raced Playwright's scroll-into-view + hit-test on the next
 *   step's controls. Focusing the heading now performs the scroll once, without
 *   an animation to race.
 */
const Stepper = ({
    step, formData, updateFormData, onNavigate,
    onPartialSubmit, onFinalSubmit, submissionStatus,
    handleFileUpload, isUploading,
    customQuestions = [], // NEW: Custom questions from schema
    isSandboxMode = false,
    onMagicFillStep,
}) => {
    const headingRef = useRef(null);

    // Build dynamic page config with custom questions inserted
    const pageConfig = useMemo(() => {
        if (!customQuestions || customQuestions.length === 0) {
            return basePageConfig.map((config, idx) => ({
                ...config,
                title: `Step ${idx + 1} of ${basePageConfig.length}: ${config.title.split(': ')[1]}`
            }));
        }

        // Insert custom questions step after Step 7 (General) but before Review
        const totalSteps = basePageConfig.length + 1;
        const config = [];

        for (let i = 0; i < basePageConfig.length; i++) {
            const baseTitle = basePageConfig[i].title.split(': ')[1];

            if (i < 7) {
                // Steps 1-7 unchanged
                config.push({
                    ...basePageConfig[i],
                    title: `Step ${i + 1} of ${totalSteps}: ${baseTitle}`
                });
            } else if (i === 7) {
                // Insert Custom Questions step (Step 8)
                config.push({
                    title: `Step 8 of ${totalSteps}: Additional Questions`,
                    component: DynamicQuestionsStep,
                    isCustomStep: true,
                    semanticId: 'custom_questions',
                    customQuestions: customQuestions
                });
                // Then Review becomes Step 9
                config.push({
                    ...basePageConfig[i],
                    title: `Step 9 of ${totalSteps}: ${baseTitle}`
                });
            } else if (i === 8) {
                // Consent becomes Step 10
                config.push({
                    ...basePageConfig[i],
                    title: `Step 10 of ${totalSteps}: ${baseTitle}`
                });
            }
        }

        return config;
    }, [customQuestions]);

    const currentConfig = pageConfig[step];
    const currentTitle = currentConfig?.title || "Application Step";
    const CurrentStepComponent = currentConfig?.component;

    // Check if this is the consent/signature step (last step)
    const isSignatureStep = step === pageConfig.length - 1;

    useEffect(() => {
        // Moving focus to the heading both announces the new step and brings it
        // into view — one deterministic, un-animated scroll instead of two
        // competing ones.
        headingRef.current?.focus({ preventScroll: false });
        // Initialize canvas only on the signature step
        if (isSignatureStep) {
            setTimeout(() => {
                initializeSignatureCanvas();
                // Only clear canvas if there is no saved signature already
                if (!formData.signature) {
                    clearCanvas();
                }
            }, 100);
        }
    }, [step, isSignatureStep]);

    const barTone = submissionStatus === 'success' ? 'success' :
        submissionStatus === 'error' ? 'danger' :
        submissionStatus === 'queued' ? 'warning' : 'info';
    // P3 FIX: Only show 100% on success, not on error/queued
    const barValue = submissionStatus === 'success' ? pageConfig.length : step + 1;

    if (!CurrentStepComponent) {
        return <p className="p-ds-6 text-center text-ds-status-danger-fg">Error: Step {step + 1} not found.</p>;
    }

    return (
        <>
            {isSandboxMode && typeof onMagicFillStep === 'function' && (
                <div className="fixed bottom-ds-6 right-ds-6 z-20">
                    {/* DOCUMENTED EXCEPTION — raw button.
                        The sandbox test control must stay visually distinct from
                        every production action so nobody mistakes the sandbox
                        wizard for the real one. The approved `Button` supports
                        only `default` and `success` tones, and a feature-side
                        background utility cannot override the variant's own
                        `background` rule (see the note in `Button.css`). This
                        composition is replaced as soon as the roadmap's
                        remaining Button tones land; it renders only when
                        `isSandboxMode` is true, never on `/apply/:slug`. */}
                    <button
                        type="button"
                        onClick={() => onMagicFillStep()}
                        className="rounded-ds-lg border border-ds-status-warning-border bg-ds-status-warning-bg px-ds-4 py-ds-2 text-ds-sm font-semibold text-ds-status-warning-fg shadow-ds-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                    >
                        🧪 Magic Fill Step
                    </button>
                </div>
            )}
            <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <h1
                    id="step-title"
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-ds-heading-sm font-semibold text-ds-content focus-visible:shadow-ds-focus"
                >
                    {currentTitle}
                </h1>
                <ProgressBar
                    id="progress-bar"
                    className="mt-ds-3"
                    value={barValue}
                    max={pageConfig.length}
                    tone={barTone}
                    labelledBy="step-title"
                    valueText={currentTitle}
                />
            </div>

            <div id="step-content-wrapper" className="p-ds-6 sm:p-ds-8">
                <form id="driver-form" onSubmit={(e) => e.preventDefault()}>
                    {currentConfig?.isCustomStep ? (
                        <CurrentStepComponent
                            questions={currentConfig.customQuestions}
                            formData={formData}
                            updateFormData={updateFormData}
                            onNavigate={onNavigate}
                            handleFileUpload={handleFileUpload}
                        />
                    ) : (
                        <CurrentStepComponent
                            formData={formData}
                            updateFormData={updateFormData}
                            onNavigate={onNavigate}
                            onPartialSubmit={onPartialSubmit}
                            onFinalSubmit={onFinalSubmit}
                            handleFileUpload={handleFileUpload}
                            isUploading={isUploading}
                            isSubmitting={submissionStatus === 'submitting'}
                        />
                    )}
                </form>
            </div>
        </>
    );
};

export default Stepper;
