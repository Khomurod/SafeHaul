import React from 'react';
import { FormField, FormSection, Textarea } from '@/design-system/components';

/** Section 3: Additional Information. Presentation migrated; the optional
 *  `additionalComments` field and its placeholder are unchanged. */
export function AdditionalInfoSection({ formData, updateField }) {
    return (
        <FormSection title="Section 3: Additional Information">
            <FormField id="verify-additional-comments" label="Additional Comments (Optional)">
                <Textarea
                    rows={3}
                    value={formData.additionalComments}
                    onChange={(e) => updateField('additionalComments', e.target.value)}
                    placeholder="Any additional information relevant to this driver's employment or performance..."
                />
            </FormField>
        </FormSection>
    );
}

export default AdditionalInfoSection;
