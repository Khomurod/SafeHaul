import React from 'react';
import InputField from '@shared/components/form/InputField';

const EmergencyContactsSection = ({ formData, updateFormData }) => {
    return (
        <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
            <legend className="text-lg font-semibold text-gray-800 px-2">Emergency Contacts</legend>
            <h4 className="text-base font-medium text-gray-700">Contact #1</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <InputField label="Contact #1 Name" id="ec1-name" name="ec1Name" value={formData.ec1Name} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Phone" id="ec1-phone" name="ec1Phone" type="tel" value={formData.ec1Phone} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Relationship" id="ec1-relationship" name="ec1Relationship" value={formData.ec1Relationship} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Address" id="ec1-address" name="ec1Address" value={formData.ec1Address} onChange={updateFormData} required={true} />
            </div>
            <h4 className="text-base font-medium text-gray-700 pt-4 border-t border-gray-100">Contact #2 (Optional)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <InputField label="Contact #2 Name" id="ec2-name" name="ec2Name" value={formData.ec2Name} onChange={updateFormData} />
                <InputField label="Contact #2 Phone" id="ec2-phone" name="ec2Phone" type="tel" value={formData.ec2Phone} onChange={updateFormData} />
                <InputField label="Contact #2 Relationship" id="ec2-relationship" name="ec2Relationship" value={formData.ec2Relationship} onChange={updateFormData} />
                <InputField label="Contact #2 Address" id="ec2-address" name="ec2Address" value={formData.ec2Address} onChange={updateFormData} />
            </div>
        </fieldset>
    );
};

export default EmergencyContactsSection;
