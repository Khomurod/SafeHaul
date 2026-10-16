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
import { CompanyEditsNotice } from '../../../features/driver-app/components/application/CompanyEditsNotice';
import { COMPANY_NOTICE_KEY } from '../../../features/driver-app/components/application/companyEditsSync';
import { Button, ProgressBar } from '@/design-system/components';
import { wizardStepsFor } from './wizardSteps';

/** Each page's screen, by the page's name in `wizardSteps.js`. */
const STEP_COMPONENTS = {
    contact: Step1_Contact,
    qualifications: Step2_Qualifications,
    license: Step3_License,
    violations: Step4_Violations,
    accidents: Step5_Accidents,
    employment: Step6_Employment,
    general: Step7_General,
    custom_questions: DynamicQuestionsStep,
    review: Step8_Review,
    consent: Step9_Consent,
};

/**
 * Public driver-application wizard frame.
 *
 * Presentation is migrated to the approved `Card` / `ProgressBar` primitives and
 * `--ds-*` tokens. Frozen contracts: the `#step-title` element id and its exact
 * `Step N of M: <Title>` text (asserted with `toHaveText` by
 * `e2e/public-application.spec.cjs`, `e2e/guest-application-intake.spec.cjs` and
 * `e2e/guest-offline-queue.spec.cjs`), the `#driver-form` id every step reads
 * with `document.getElementById` for native validation, the pages' order and
 * titles (`wizardSteps.js`), the `submissionStatus` → bar tone mapping, the
 * "only 100% on success" rule, the `Error: Step N not found.` fallback, and the
 * sandbox Magic Fill control. The signature canvas is the consent step's own: it
 * exists only on that step's last page, which sets it up each time it is shown.
 *
 * Accessibility and scrolling:
 * - The step title is the page's single `<h1>`; no step repeats it in a heading
 *   of its own.
 * - Progress is an approved `ProgressBar` labelled by the step title.
 * - On every step change focus moves to the step heading: the Continue button
 *   that triggered the change unmounts, and focus would otherwise drop to
 *   `<body>` without telling anyone the step has changed.
 * - Focusing the heading is the transition's only scroll, and it is not
 *   animated: a second or smooth scroll races Playwright's scroll-into-view +
 *   hit-test on the next step's controls.
 */
const Stepper = ({
    step, formData, updateFormData, onNavigate,
    onPartialSubmit, onFinalSubmit, submissionStatus,
    handleFileUpload, isUploading,
    customQuestions = [], // the company's own questions: a page of their own when there are any
    isSandboxMode = false,
    onMagicFillStep,
}) => {
    const headingRef = useRef(null);

    const pageConfig = useMemo(() => {
        const pages = wizardStepsFor(customQuestions?.length > 0);
        return pages.map((page, idx) => ({
            title: `Step ${idx + 1} of ${pages.length}: ${page.title}`,
            component: STEP_COMPONENTS[page.id],
            isCustomStep: page.id === 'custom_questions',
        }));
    }, [customQuestions]);

    const currentConfig = pageConfig[step];
    const currentTitle = currentConfig?.title || "Application Step";
    const CurrentStepComponent = currentConfig?.component;

    useEffect(() => {
        // Moving focus to the heading both announces the new step and brings it
        // into view — one deterministic, un-animated scroll instead of two
        // competing ones.
        headingRef.current?.focus({ preventScroll: false });
    }, [step]);

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
                <div className="fixed bottom-ds-6 right-ds-6 z-ds-sticky">
                    {/* The sandbox test control stays visually distinct from every
                        production action so nobody mistakes the sandbox wizard for
                        the real one — and that distinction is now the design
                        system's `warning` tone rather than a hand-written class
                        list. The exception this replaced said it would go "as soon
                        as the roadmap's remaining Button tones land"; they have.
                        `shadow-ds-lg` stays: it lifts a floating control off the
                        page, which is position, not appearance. Renders only when
                        `isSandboxMode` is true, never on `/apply/:slug`. */}
                    <Button
                        variant="secondary"
                        tone="warning"
                        size="sm"
                        onClick={() => onMagicFillStep()}
                        className="shadow-ds-lg"
                    >
                        🧪 Magic Fill Step
                    </Button>
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
                <CompanyEditsNotice
                    fields={formData?.[COMPANY_NOTICE_KEY]}
                    onDismiss={() => updateFormData(COMPANY_NOTICE_KEY, null)}
                />
                <form id="driver-form" onSubmit={(e) => e.preventDefault()}>
                    {currentConfig?.isCustomStep ? (
                        <CurrentStepComponent
                            questions={customQuestions}
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
