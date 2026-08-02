import React from 'react';
import InputField from '@shared/components/form/InputField';
import { FormSection } from '@/design-system/components';

/**
 * Two emergency contacts. Presentation migrated to the approved `FormSection`
 * primitive and the shared field adapter (2026-07-27); the `ec1*` / `ec2*` field
 * keys, element ids and required flags (contact #1 required, #2 optional) are
 * unchanged.
 *
 * The two sub-headings are `<h3>` under the section's `<h2>` — they were `<h4>`
 * on a page whose only other heading was the step title, which skipped a level.
 */
const EmergencyContactsSection = ({ formData, updateFormData }) => {
    return (
        <FormSection title="Emergency Contacts">
            <h3 className="text-ds-body font-medium text-ds-content">Contact #1</h3>
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                <InputField label="Contact #1 Name" id="ec1-name" name="ec1Name" value={formData.ec1Name} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Phone" id="ec1-phone" name="ec1Phone" type="tel" value={formData.ec1Phone} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Relationship" id="ec1-relationship" name="ec1Relationship" value={formData.ec1Relationship} onChange={updateFormData} required={true} />
                <InputField label="Contact #1 Address" id="ec1-address" name="ec1Address" value={formData.ec1Address} onChange={updateFormData} required={true} />
            </div>
            <h3 className="border-t border-ds-border-subtle pt-ds-4 text-ds-body font-medium text-ds-content">Contact #2 (Optional)</h3>
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                <InputField label="Contact #2 Name" id="ec2-name" name="ec2Name" value={formData.ec2Name} onChange={updateFormData} />
                <InputField label="Contact #2 Phone" id="ec2-phone" name="ec2Phone" type="tel" value={formData.ec2Phone} onChange={updateFormData} />
                <InputField label="Contact #2 Relationship" id="ec2-relationship" name="ec2Relationship" value={formData.ec2Relationship} onChange={updateFormData} />
                <InputField label="Contact #2 Address" id="ec2-address" name="ec2Address" value={formData.ec2Address} onChange={updateFormData} />
            </div>
        </FormSection>
    );
};

export default EmergencyContactsSection;
