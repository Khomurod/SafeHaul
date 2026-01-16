import React from 'react';
import RadioGroup from '@shared/components/form/RadioGroup';
import { YES_NO_OPTIONS, EXPERIENCE_OPTIONS } from '@/config/form-options';

const Step2_Qualifications = ({ formData, updateFormData, onNavigate }) => {
    const yesNoOptions = YES_NO_OPTIONS;
    const drugTestPositive = formData['drug-test-positive'] === 'yes';
    const experienceOptions = EXPERIENCE_OPTIONS;

    return (
        <div id="page-2" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 2 of 9: Qualification Information</h3>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">General Qualifications</legend>
                <RadioGroup 
                    label="Legally eligible to work in the U.S.?" 
                    name="legal-work" 
                    options={yesNoOptions}
                    value={formData['legal-work']} 
                    onChange={updateFormData}
                    required={true}
                />
                <RadioGroup 
                    label="Can you read, write, speak and understand English?" 
                    name="english-fluency" 
                    options={yesNoOptions}
                    value={formData['english-fluency']} 
                    onChange={updateFormData}
                    required={true}
                />
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Drug & Alcohol History</legend>
                <p className="text-sm text-gray-600">
                    Have you ever tested positive, or refused to test on a pre-employment drug or alcohol test by an employer to whom you applied, but did not obtain safety-sensitive transportation work covered by DOT drug and alcohol testing regulations, or have you ever tested positive or refused to test on any DOT-mandated drug or alcohol test?
                </p>
                <RadioGroup 
                    label="Drug and alcohol positive tests or refusals?" 
                    name="drug-test-positive" 
                    options={yesNoOptions}
                    value={formData['drug-test-positive']} 
                    onChange={updateFormData}
                    required={true}
                />
                {drugTestPositive && (
                    <div id="drug-test-details" className="space-y-2 pt-4 border-t border-gray-200">
                        <label htmlFor="drug-test-explanation" className="block text-sm font-medium text-gray-700 mb-1">Please explain:</label>
                        <textarea 
                            id="drug-test-explanation" 
                            name="drug-test-explanation" 
                            rows="3" 
                            value={formData['drug-test-explanation'] || ""}
                            onChange={(e) => updateFormData(e.target.name, e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        ></textarea>
                    </div>
                )}
                <RadioGroup 
                    label="Can you provide documentation, if requested, that confirms successful completion of the DOT return to duty process?"
                    name="dot-return-to-duty" 
                    options={yesNoOptions}
                    value={formData['dot-return-to-duty']} 
                    onChange={updateFormData}
                    required={true}
                />
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Commercial Experience</legend>
                <RadioGroup 
                    label="Years of commercial driving experience?"
                    name="experience-years" 
                    options={experienceOptions}
                    value={formData['experience-years']} 
                    onChange={updateFormData}
                    required={true}
                    horizontal={false}
                />
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
                    onClick={() => onNavigate('next')}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step2_Qualifications;