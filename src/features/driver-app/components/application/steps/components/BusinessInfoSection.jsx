import React from 'react';
import InputField from '@shared/components/form/InputField';
import { FormSection } from '@/design-system/components';
import { StateSelectField } from './StateSelectField';

/**
 * Owner-operator business details. Presentation migrated to the approved
 * `FormSection` primitive and the shared field adapters (2026-07-27); every
 * field key (`ein`, `driverInitials`, `businessName`, `businessStreet`,
 * `businessCity`, `businessState`, `businessZip`), element id and required flag
 * is unchanged — `business-state` stays optional.
 */
const BusinessInfoSection = ({ formData, updateFormData, states }) => {
    return (
        <FormSection title="Business Information (Owner-Operators)">
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-2">
                <InputField label="Employer ID Number (EIN)" id="ein" name="ein" value={formData.ein} onChange={updateFormData} />
                <InputField label="Driver Initials" id="driver-initials" name="driverInitials" value={formData.driverInitials} onChange={updateFormData} required={true} />
            </div>
            <InputField label="Business Name" id="business-name" name="businessName" value={formData.businessName} onChange={updateFormData} />
            <InputField label="Business Street" id="business-street" name="businessStreet" value={formData.businessStreet} onChange={updateFormData} />
            <div className="grid grid-cols-1 gap-ds-6 sm:grid-cols-3">
                <InputField label="City" id="business-city" name="businessCity" value={formData.businessCity} onChange={updateFormData} />
                <StateSelectField
                    id="business-state"
                    name="businessState"
                    states={states}
                    required={false}
                    value={formData.businessState}
                    onChange={(e) => updateFormData(e.target.name, e.target.value)}
                />
                <InputField label="ZIP Code" id="business-zip" name="businessZip" value={formData.businessZip} onChange={updateFormData} />
            </div>
        </FormSection>
    );
};

export default BusinessInfoSection;
