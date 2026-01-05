import React, { useEffect } from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { AlertCircle } from 'lucide-react';

const Step1_Contact = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    // --- Configuration Helper ---
    const getConfig = (fieldId, defaultReq = true) => {
        const config = currentCompany?.applicationConfig?.[fieldId];
        return {
            hidden: config?.hidden || false,
            required: config !== undefined ? config.required : defaultReq
        };
    };

    const ssnConfig = getConfig('ssn', true);
    const dobConfig = getConfig('dob', true);
    const historyConfig = getConfig('addressHistory', true);
    const referralConfig = getConfig('referralSource', false);

    // --- Logic ---
    const residenceThreeYears = formData['residence-3-years'];
    // Only show previous address if user said "No" AND history is not hidden globally
    const knownByOtherName = formData['known-by-other-name'] === 'yes';

    useEffect(() => {
        if (formData['known-by-other-name'] === undefined) {
            updateFormData('known-by-other-name', 'no');
        }
    }, [formData, updateFormData]);

    const yesNoOptions = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];

    const handleOtherNameToggle = (e) => {
        updateFormData('known-by-other-name', e.target.checked ? 'yes' : 'no');
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

    // --- Soft Validation Helpers ---
    const hasPhoneWarning = (val) => val && val.length > 5 && !/^\D?(\d{3})\D?\D?(\d{3})\D?(\d{4})$/.test(val);
    const hasEmailWarning = (val) => val && val.length > 5 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    const hasSSNWarning = (val) => val && val.length > 7 && !/^\d{3}-?\d{2}-?\d{4}$/.test(val);
    const hasZipWarning = (val) => val && val.length > 0 && !/^\d{5}(-\d{4})?$/.test(val);

    const ValidationWarning = ({ message }) => (
        <div className="flex items-center gap-1.5 mt-1 text-amber-600 text-xs font-medium animate-in fade-in slide-in-from-top-1">
            <AlertCircle size={12} />
            <span>{message}</span>
        </div>
    );

    return (
        <div id="page-1" className="form-step space-y-6">

            {/* --- Personal Details --- */}
            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">Step 1 of 9: Personal Information</legend>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InputField label="First Name" id="first-name" name="firstName" required={true} value={formData.firstName} onChange={updateFormData} placeholder="John" />
                    <InputField label="Middle Name" id="middle-name" name="middleName" value={formData.middleName} onChange={updateFormData} placeholder="M" />
                    <InputField label="Last Name" id="last-name" name="lastName" required={true} value={formData.lastName} onChange={updateFormData} placeholder="Doe" />
                    <InputField label="Suffix" id="suffix" name="suffix" value={formData.suffix} onChange={updateFormData} placeholder="Jr." />
                </div>

                <div className="flex items-center pt-2 border-t border-gray-200">
                    <input
                        id="known-by-other-name"
                        name="known-by-other-name"
                        type="checkbox"
                        checked={knownByOtherName}
                        onChange={handleOtherNameToggle}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="known-by-other-name" className="ml-2 block text-sm font-medium text-gray-800">Known by other name(s)?</label>
                </div>

                {knownByOtherName && (
                    <div id="other-name-field" className="pt-2">
                        <InputField label="Other Name(s)" id="other-name" name="otherName" value={formData.otherName} onChange={updateFormData} placeholder="e.g., Johnny" />
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* SSN Field - Configurable */}
                    {!ssnConfig.hidden && (
                        <div>
                            <InputField
                                label="Social Security Number (SSN)"
                                id="ssn"
                                name="ssn"
                                required={ssnConfig.required}
                                value={formData.ssn}
                                onChange={updateFormData}
                                placeholder="XXX-XX-XXXX"
                            />
                            {hasSSNWarning(formData.ssn) && <ValidationWarning message="Format usually matches XXX-XX-XXXX" />}
                        </div>
                    )}

                    {/* DOB Field - Configurable */}
                    {!dobConfig.hidden && (
                        <InputField
                            label="Date of Birth"
                            id="dob"
                            name="dob"
                            type="date"
                            required={dobConfig.required}
                            value={formData.dob}
                            onChange={updateFormData}
                        />
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-gray-200">
                    <div>
                        <InputField label="Phone" id="phone" name="phone" type="tel" required={true} value={formData.phone} onChange={updateFormData} placeholder="(555) 555-5555" />
                        {hasPhoneWarning(formData.phone) && <ValidationWarning message="Please double-check phone format." />}
                    </div>
                    <div>
                        <InputField label="Email" id="email" name="email" type="email" required={true} value={formData.email} onChange={updateFormData} placeholder="you@example.com" />
                        {hasEmailWarning(formData.email) && <ValidationWarning message="Email address looks incomplete." />}
                    </div>
                </div>

                <RadioGroup
                    label="Can we send you SMS messages?"
                    name="sms-consent"
                    options={yesNoOptions}
                    value={formData['sms-consent']}
                    onChange={updateFormData}
                    horizontal={true}
                />

                {/* Referral Source - Configurable */}
                {!referralConfig.hidden && (
                    <div className="pt-4 border-t border-gray-200">
                        <InputField
                            label="How did you hear about us?"
                            id="referral-source"
                            name="referralSource"
                            required={referralConfig.required}
                            value={formData.referralSource}
                            onChange={updateFormData}
                            placeholder="e.g. Facebook, Indeed, Friend..."
                        />
                    </div>
                )}
            </fieldset>

            {/* --- Current Address --- */}
            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Current Address</legend>
                <div>
                    <InputField label="Address 1" id="street" name="street" required={true} value={formData.street} onChange={updateFormData} placeholder="123 Main St" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <InputField label="City" id="city" name="city" required={true} value={formData.city} onChange={updateFormData} placeholder="Anytown" />
                    <div>
                        <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                        <select
                            id="state"
                            name="state"
                            required
                            value={formData.state || ""}
                            onChange={(e) => handleStateChange(e.target.name, e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                        >
                            <option value="" disabled>Select State</option>
                            {states.map(state => <option key={state} value={state}>{state}</option>)}
                        </select>
                    </div>
                    <div>
                        <InputField label="ZIP Code" id="zip" name="zip" required={true} value={formData.zip} onChange={updateFormData} placeholder="12345" />
                        {hasZipWarning(formData.zip) && <ValidationWarning message="Standard ZIP is 5 digits." />}
                    </div>
                </div>

                {/* Only show "3 Years" question if history is not hidden */}
                {!historyConfig.hidden && (
                    <RadioGroup
                        label="Lived at this residence for 3 years or more?"
                        name="residence-3-years"
                        options={yesNoOptions}
                        value={residenceThreeYears}
                        onChange={updateFormData}
                        horizontal={true}
                        required={historyConfig.required}
                    />
                )}
            </fieldset>

            {/* --- Previous Address History (Past 3 Years) --- */}
            <div className="mt-6 animate-in fade-in">
                <DynamicRow
                    listKey="previousAddresses"
                    title="Previous Addresses (Past 3 Years)"
                    formData={formData}
                    updateFormData={updateFormData}
                    initialItemState={{ street: '', city: '', state: '', zip: '', startDate: '', endDate: '' }}
                    addButtonLabel="Add Previous Address"
                    renderRow={(index, item, handleChange) => (
                        <div className="space-y-4">
                            <InputField
                                label="Address"
                                id={`prev-street-${index}`}
                                name="street"
                                value={item.street}
                                onChange={(n, v) => handleChange('street', v)}
                                placeholder="123 Old St"
                                required={true}
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <InputField
                                    label="City"
                                    id={`prev-city-${index}`}
                                    name="city"
                                    value={item.city}
                                    onChange={(n, v) => handleChange('city', v)}
                                    placeholder="City"
                                    required={true}
                                />
                                <div>
                                    <label htmlFor={`prev-state-${index}`} className="block text-sm font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                                    <select
                                        id={`prev-state-${index}`}
                                        name="state"
                                        value={item.state || ""}
                                        onChange={(e) => handleChange('state', e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                                        required
                                    >
                                        <option value="" disabled>Select State</option>
                                        {states.map(state => <option key={state} value={state}>{state}</option>)}
                                    </select>
                                </div>
                                <InputField
                                    label="ZIP Code"
                                    id={`prev-zip-${index}`}
                                    name="zip"
                                    value={item.zip}
                                    onChange={(n, v) => handleChange('zip', v)}
                                    placeholder="Zip"
                                    required={true}
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <InputField
                                    label="From Date"
                                    id={`prev-start-${index}`}
                                    name="startDate"
                                    type="month"
                                    value={item.startDate}
                                    onChange={(n, v) => handleChange('startDate', v)}
                                    required={true}
                                />
                                <InputField
                                    label="To Date"
                                    id={`prev-end-${index}`}
                                    name="endDate"
                                    type="month"
                                    value={item.endDate}
                                    onChange={(n, v) => handleChange('endDate', v)}
                                    required={true}
                                />
                            </div>
                        </div>
                    )}
                />
            </div>

            {/* --- Buttons --- */}
            <div className="flex flex-col sm:flex-row sm:justify-end pt-6 space-y-3 sm:space-y-0 sm:space-x-4">
                <button
                    type="button"
                    name="submit-partial"
                    onClick={onPartialSubmit}
                    className="w-full sm:w-auto px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200"
                >
                    Save as Draft
                </button>
                <button
                    type="button"
                    onClick={handleContinue}
                    className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step1_Contact;