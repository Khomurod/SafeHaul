import React from 'react';
import InputField from '@shared/components/form/InputField';

const BusinessInfoSection = ({ formData, updateFormData, states }) => {
    return (
        <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
            <legend className="text-lg font-semibold text-gray-800 px-2">Business Information (Owner-Operators)</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <InputField label="Employer ID Number (EIN)" id="ein" name="ein" value={formData.ein} onChange={updateFormData} />
                <InputField label="Driver Initials" id="driver-initials" name="driverInitials" value={formData.driverInitials} onChange={updateFormData} required={true} />
            </div>
            <InputField label="Business Name" id="business-name" name="businessName" value={formData.businessName} onChange={updateFormData} />
            <InputField label="Business Street" id="business-street" name="businessStreet" value={formData.businessStreet} onChange={updateFormData} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <InputField label="City" id="business-city" name="businessCity" value={formData.businessCity} onChange={updateFormData} />
                <div>
                    <label htmlFor="business-state" className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <select id="business-state" name="businessState" value={formData.businessState || ""} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        <option value="" disabled>Select State</option>
                        {states.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                </div>
                <InputField label="ZIP Code" id="business-zip" name="businessZip" value={formData.businessZip} onChange={updateFormData} />
            </div>
        </fieldset>
    );
};

export default BusinessInfoSection;
