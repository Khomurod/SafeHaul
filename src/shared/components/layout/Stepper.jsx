import React, { useEffect, useMemo } from 'react';
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
import { initializeSignatureCanvas, clearCanvas } from '@/lib/signature';

// Base page config (without custom questions)
const basePageConfig = [
    { title: "Step 1: Personal Information", component: Step1_Contact },
    { title: "Step 2: Qualification Information", component: Step2_Qualifications },
    { title: "Step 3: License Information", component: Step3_License },
    { title: "Step 4: Motor Vehicle Record", component: Step4_Violations },
    { title: "Step 5: Accident History", component: Step5_Accidents },
    { title: "Step 6: Employment History", component: Step6_Employment },
    { title: "Step 7: General Questions", component: Step7_General },
    { title: "Step 8: Review Information", component: Step8_Review },
    { title: "Step 9: Agreements & Signature", component: Step9_Consent },
];

const Stepper = ({
    step, formData, updateFormData, onNavigate,
    onPartialSubmit, onFinalSubmit, submissionStatus,
    handleFileUpload, isUploading,
    customQuestions = [] // NEW: Custom questions from schema
}) => {

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

    const progressPercent = useMemo(() => {
        return ((step + 1) / pageConfig.length) * 100;
    }, [step, pageConfig.length]);

    const currentConfig = pageConfig[step];
    const currentTitle = currentConfig?.title || "Application Step";
    const CurrentStepComponent = currentConfig?.component;

    // Check if this is the consent/signature step (last step)
    const isSignatureStep = step === pageConfig.length - 1;

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Initialize canvas only on the signature step
        if (isSignatureStep) {
            setTimeout(() => {
                initializeSignatureCanvas();
                clearCanvas();
            }, 100);
        }
    }, [step, isSignatureStep]);

    const barColor = submissionStatus === 'success' ? 'bg-green-600' :
        submissionStatus === 'error' ? 'bg-red-600' : 'bg-blue-600';
    const barWidth = submissionStatus ? '100%' : `${progressPercent}%`;

    if (!CurrentStepComponent) {
        return <div className="p-6 text-center text-red-500">Error: Step {step + 1} not found.</div>;
    }

    return (
        <>
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                <h2 id="step-title" className="text-lg font-semibold text-gray-700">{currentTitle}</h2>
                <div className="w-full bg-gray-200 rounded-full h-2.5 mt-3">
                    <div
                        id="progress-bar"
                        className={`h-2.5 rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: barWidth }}
                    ></div>
                </div>
            </div>

            <div id="step-content-wrapper" className="p-6 sm:p-8">
                <form id="driver-form" onSubmit={(e) => e.preventDefault()}>
                    {currentConfig?.isCustomStep ? (
                        <CurrentStepComponent
                            questions={currentConfig.customQuestions}
                            formData={formData}
                            updateFormData={updateFormData}
                            onNavigate={onNavigate}
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
                        />
                    )}
                </form>
            </div>
        </>
    );
};

export default Stepper;