import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, LICENSE_CLASS_OPTIONS, ENDORSEMENT_OPTIONS } from '@/config/form-options';

const Step3_License = ({ formData, updateFormData, handleFileUpload, onNavigate }) => {
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    // --- Configuration ---
    const getConfig = (fieldId, defaultReq = true) => {
        const config = currentCompany?.applicationConfig?.[fieldId];
        return {
            hidden: config?.hidden || false,
            required: config !== undefined ? config.required : defaultReq
        };
    };

    const cdlUploadConfig = getConfig('cdlUpload', true);
    const medCardConfig = getConfig('medCardUpload', false); 

    const licenseClassOptions = LICENSE_CLASS_OPTIONS;
    const endorsementOptions = ENDORSEMENT_OPTIONS;
    const yesNoOptions = YES_NO_OPTIONS;
    const endorsements = (formData.endorsements || '').split(',').filter(e => e);

    const handleEndorsementChange = (e) => {
        const value = e.target.value;
        let newEndorsements;
        if (e.target.checked) {
            newEndorsements = [...endorsements, value];
        } else {
            newEndorsements = endorsements.filter(e => e !== value);
        }
        updateFormData('endorsements', newEndorsements.join(','));
    };

    const safeFileChange = (fieldName, file) => {
        if (!handleFileUpload) {
            console.error("[Step3_License] Missing handleFileUpload prop");
            return;
        }
        handleFileUpload(fieldName, file);
    };

    const handleStateChange = (name, value) => {
        updateFormData(name, value);
    };

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

    const hasTwic = formData['has-twic'] === 'yes';

    return (
        <div id="page-3" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 3 of 9: License Information</h3>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">Current License Information</legend>

                <div>
                    <label htmlFor="cdl-state" className="block text-sm font-medium text-gray-700 mb-1">License State <span className="text-red-500">*</span></label>
                    <select 
                        id="cdl-state" 
                        name="cdlState" 
                        required 
                        value={formData.cdlState || ""} 
                        onChange={(e) => handleStateChange(e.target.name, e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                    >
                        <option value="" disabled>Select State</option>
                        {states.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                </div>

                <RadioGroup 
                    label="License Class" 
                    name="cdlClass" 
                    options={licenseClassOptions}
                    value={formData.cdlClass} 
                    onChange={updateFormData}
                    required={true}
                    horizontal={false}
                />

                <InputField label="License Number" id="cdl-number" name="cdlNumber" required={true} value={formData.cdlNumber} onChange={updateFormData} />
                <InputField label="License Expiration" id="cdl-expiration" name="cdlExpiration" type="date" required={true} value={formData.cdlExpiration} onChange={updateFormData} />

                <div className="space-y-3 pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-900">Endorsements</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {endorsementOptions.map(option => (
                            <div key={option.value} className="flex items-center">
                                <input 
                                    id={'endorse-' + option.value} 
                                    name="endorsements" 
                                    value={option.value} 
                                    type="checkbox" 
                                    checked={endorsements.includes(option.value)}
                                    onChange={handleEndorsementChange}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor={'endorse-' + option.value} className="ml-2 text-sm text-gray-700">{option.label}</label>
                            </div>
                        ))}
                    </div>
                </div>

                {/* CDL UPLOADS */}
                {!cdlUploadConfig.hidden && (
                    <div className="space-y-4 pt-4 border-t border-gray-200">
                        <InputField 
                            label="Upload CDL (Front)" 
                            id="cdl-front" 
                            name="cdl-front" 
                            type="file" 
                            value={formData['cdl-front']}
                            onChange={safeFileChange}
                            required={cdlUploadConfig.required && !formData['cdl-front']}
                        />
                        <InputField 
                            label="Upload CDL (Back)" 
                            id="cdl-back" 
                            name="cdl-back" 
                            type="file" 
                            value={formData['cdl-back']}
                            onChange={safeFileChange}
                            required={cdlUploadConfig.required && !formData['cdl-back']}
                        />
                    </div>
                )}

                {/* MEDICAL CARD UPLOAD */}
                {!medCardConfig.hidden && (
                    <div className="pt-4 border-t border-gray-200">
                         <InputField 
                            label="Upload Medical Card" 
                            id="medical-card-upload" 
                            name="medical-card-upload" 
                            type="file" 
                            value={formData['medical-card-upload']}
                            onChange={safeFileChange}
                            required={medCardConfig.required && !formData['medical-card-upload']}
                        />
                    </div>
                )}

            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">TWIC Card</legend>
                <RadioGroup 
                    label="Do you have a TWIC (Transportation Worker Identification Credential) card?" 
                    name="has-twic" 
                    options={yesNoOptions}
                    value={formData['has-twic']} 
                    onChange={updateFormData}
                    required={true}
                />
                {hasTwic && (
                    <div id="twic-card-details" className="space-y-4 pt-4 border-t border-gray-200">
                        <InputField label="Expiration Date" id="twic-expiration" name="twicExpiration" type="date" value={formData.twicExpiration} onChange={updateFormData} />
                        <InputField 
                            label="Upload TWIC Card" 
                            id="twic-card-upload" 
                            name="twic-card-upload" 
                            type="file" 
                            value={formData['twic-card-upload']} 
                            onChange={safeFileChange} 
                        />
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

export default Step3_License;