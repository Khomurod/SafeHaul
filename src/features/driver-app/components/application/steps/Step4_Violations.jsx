import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS } from '@/config/form-options';

const Step4_Violations = ({ formData, updateFormData, handleFileUpload, onNavigate }) => {
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    // --- Configuration ---
    // We keep this helper in case you need to re-enable other config fields later
    const getConfig = (fieldId, defaultReq = true) => {
        const config = currentCompany?.applicationConfig?.[fieldId];
        return {
            hidden: config?.hidden || false,
            required: config !== undefined ? config.required : defaultReq
        };
    };

    const yesNoOptions = YES_NO_OPTIONS;
    const initialViolation = { date: '', charge: '', location: '', penalty: '' };

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

    const renderViolationRow = (index, item, handleChange) => (
        <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField 
                label="Date of Conviction" 
                id={'violation-date-' + index} 
                name="date" 
                type="date"
                value={item.date} 
                onChange={handleChange}
                required={true} 
            />
            <InputField 
                label="Charge" 
                id={'violation-charge-' + index} 
                name="charge" 
                value={item.charge} 
                onChange={handleChange} 
                required={true}
            />
            <InputField 
                label="Location (City, State)" 
                id={'violation-location-' + index} 
                name="location" 
                value={item.location} 
                onChange={handleChange} 
                className="sm:col-span-2"
            />
            <InputField 
                label="Penalty" 
                id={'violation-penalty-' + index} 
                name="penalty" 
                value={item.penalty} 
                onChange={handleChange} 
                className="sm:col-span-2"
            />
        </div>
    );

    return (
        <div id="page-4" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 4 of 9: Motor Vehicle Record</h3>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">Consent & Revocations</legend>

                <div className="space-y-2 pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-900">Motor Vehicle Record (MVR) Check</label>
                    <p className="text-sm text-gray-600">This is required for employment. We will pull your driving record from all states where you have held a license in the past 3 years.</p>
                    <RadioGroup 
                        label="I Consent to MVR Check" 
                        name="consent-mvr" 
                        options={yesNoOptions}
                        value={formData['consent-mvr']} 
                        onChange={updateFormData}
                        required={true}
                    />
                </div>

                <RadioGroup 
                    label="Has any license, permit or privilege ever been denied, suspended, or revoked for any reason?" 
                    name="revoked-licenses" 
                    options={yesNoOptions}
                    value={formData['revoked-licenses']} 
                    onChange={updateFormData}
                    required={true}
                />

                <RadioGroup 
                    label="Have you ever been convicted of driving during license suspension or revocation, or driving without a valid license or an expired license, or are any charges pending?" 
                    name="driving-convictions" 
                    options={yesNoOptions}
                    value={formData['driving-convictions']} 
                    onChange={updateFormData}
                    required={true}
                />

                <RadioGroup 
                    label="Have you ever been convicted for any alcohol or controlled substance related offense while operating a motor vehicle, or are any charges pending?" 
                    name="drug-alcohol-convictions" 
                    options={yesNoOptions}
                    value={formData['drug-alcohol-convictions']} 
                    onChange={updateFormData}
                    required={true}
                />

                {/* REMOVED: Upload Signed MVR Consent Form section */}
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Moving Violations (Past 3 Years)</legend>
                <p className="text-sm text-gray-600">Please list all moving violations or traffic convictions within the past 3 years (whether in a personal or commercial vehicle).</p>
                <DynamicRow
                    listKey="violations"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderViolationRow}
                    initialItemState={initialViolation}
                    addButtonLabel="+ Add Violation"
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
                    onClick={handleContinue}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step4_Violations;