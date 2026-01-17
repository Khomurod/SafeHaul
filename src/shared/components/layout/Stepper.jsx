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
import { initializeSignatureCanvas, clearCanvas } from '@/lib/signature';

const pageConfig = [
    { title: "Step 1 of 9: Personal Information", component: Step1_Contact },
    { title: "Step 2 of 9: Qualification Information", component: Step2_Qualifications },
    { title: "Step 3 of 9: License Information", component: Step3_License },
    { title: "Step 4 of 9: Motor Vehicle Record", component: Step4_Violations },
    { title: "Step 5 of 9: Accident History", component: Step5_Accidents },
    { title: "Step 6 of 9: Employment History", component: Step6_Employment },
    { title: "Step 7 of 9: Custom Applicant Questions", component: Step7_General },
    { title: "Step 8 of 9: Review Information", component: Step8_Review },
    { title: "Step 9 of 9: Agreements & Signature", component: Step9_Consent },
];

const Stepper = ({ 
    step, formData, updateFormData, onNavigate, 
    onPartialSubmit, onFinalSubmit, submissionStatus,
    handleFileUpload, isUploading 
}) => {

    // Step is 0-based in some apps, 1-based in others. 
    // In Unification, we usually use 0-based index for arrays.
    // The previous components might expect 1-based logic? 
    // Let's standardise: `step` prop is 0-based index.

    const progressPercent = useMemo(() => {
        return ((step + 1) / pageConfig.length) * 100;
    }, [step]);

    const currentConfig = pageConfig[step];
    const currentTitle = currentConfig?.title || "Application Step";
    const CurrentStepComponent = currentConfig?.component;

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Initialize canvas only on the final step (index 8)
        if (step === 8) {
            // Give the DOM a moment to render the canvas element
            setTimeout(() => {
                initializeSignatureCanvas();
                clearCanvas();
            }, 100);
        }
    }, [step]);

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
                    <CurrentStepComponent 
                        formData={formData} 
                        updateFormData={updateFormData} 
                        onNavigate={onNavigate}
                        onPartialSubmit={onPartialSubmit}
                        onFinalSubmit={onFinalSubmit}
                        handleFileUpload={handleFileUpload}
                        isUploading={isUploading}
                    />
                </form>
            </div>
        </>
    );
};

export default Stepper;