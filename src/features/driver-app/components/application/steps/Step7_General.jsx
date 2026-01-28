import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, MILES_DRIVEN_OPTIONS, EXPERIENCE_OPTIONS } from '@/config/form-options';
import { Circle } from 'lucide-react';

import DynamicQuestionRenderer from './components/DynamicQuestionRenderer';
import BusinessInfoSection from './components/BusinessInfoSection';
import VehicleExperienceSection from './components/VehicleExperienceSection';
import EmergencyContactsSection from './components/EmergencyContactsSection';

const Step7_General = ({ formData, updateFormData, onNavigate, handleFileUpload, isUploading }) => {
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    const yesNoOptions = YES_NO_OPTIONS;
    const milesOptions = MILES_DRIVEN_OPTIONS;
    const expOptions = EXPERIENCE_OPTIONS;
    const hasFelony = formData['has-felony'] === 'yes';

    const handleContinue = () => {
        const form = document.getElementById('driver-form');
        if (form) {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
        onNavigate('next');
    };

    const handleCustomAnswerChange = (questionIdOrLabel, answer) => {
        const currentAnswers = formData.customAnswers || {};
        const updatedAnswers = { ...currentAnswers, [questionIdOrLabel]: answer };
        updateFormData('customAnswers', updatedAnswers);
    };

    const handleCheckboxChange = (questionId, option) => {
        const currentAnswers = formData.customAnswers || {};
        const currentSelection = Array.isArray(currentAnswers[questionId]) ? currentAnswers[questionId] : [];

        let newSelection;
        if (currentSelection.includes(option)) {
            newSelection = currentSelection.filter(item => item !== option);
        } else {
            newSelection = [...currentSelection, option];
        }

        handleCustomAnswerChange(questionId, newSelection);
    };

    return (
        <div id="page-7" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 7 of 9: Custom Applicant Questions</h3>

            {currentCompany?.customQuestions?.length > 0 && (
                <fieldset className="border border-blue-200 bg-blue-50/30 rounded-lg p-6 space-y-6 shadow-sm">
                    <legend className="text-lg font-bold text-blue-900 px-2 flex items-center gap-2">
                        <Circle size={16} fill="currentColor" className="text-blue-200" />
                        {currentCompany.companyName || 'Company'} Specific Questions
                    </legend>
                    <p className="text-sm text-blue-700 px-1 mb-4 border-b border-blue-100 pb-2">
                        Please answer the following questions required by the carrier.
                    </p>

                    {currentCompany.customQuestions.map((question, index) => (
                        <DynamicQuestionRenderer
                            key={question.id || index}
                            question={question}
                            index={index}
                            formData={formData}
                            onAnswerChange={handleCustomAnswerChange}
                            onCheckboxChange={handleCheckboxChange}
                            handleFileUpload={handleFileUpload}
                        />
                    ))}
                </fieldset>
            )}

            {(formData.positionType === 'ownerOperator' || formData.positionType === 'leaseOperator') && (
                <BusinessInfoSection
                    formData={formData}
                    updateFormData={updateFormData}
                    states={states}
                />
            )}

            <VehicleExperienceSection
                formData={formData}
                updateFormData={updateFormData}
                milesOptions={milesOptions}
                expOptions={expOptions}
            />

            {currentCompany?.applicationConfig?.showEmergencyContacts && (
                <EmergencyContactsSection
                    formData={formData}
                    updateFormData={updateFormData}
                />
            )}

            {/* HOS Section Removed: Note required for initial application per typical DOT flows unless asked by carrier (now handled via custom questions if needed) */}


            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Felony History</legend>
                <RadioGroup
                    label="Have you ever been convicted of a felony?"
                    name="has-felony"
                    options={yesNoOptions}
                    value={formData['has-felony']}
                    onChange={updateFormData}
                    required={true}
                />
                {hasFelony && (
                    <div id="felony-details" className="space-y-2 pt-4 border-t border-gray-200">
                        <label htmlFor="felony-explanation" className="block text-sm font-medium text-gray-700 mb-1">Please explain:</label>
                        <textarea
                            id="felony-explanation"
                            name="felonyExplanation"
                            rows="3"
                            value={formData.felonyExplanation || ""}
                            onChange={(e) => updateFormData(e.target.name, e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        ></textarea>
                    </div>
                )}
            </fieldset>

            <div className="flex justify-between pt-6">
                <button
                    type="button"
                    onClick={() => onNavigate('back')}
                    className="w-auto px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={handleContinue}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step7_General;
