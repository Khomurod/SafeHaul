import React from 'react';
import { FormSection } from '@/design-system/components';
import UploadField from '@features/driver-app/components/application/UploadField';

/**
 * The driver's paperwork, as the carrier has it.
 *
 * Every one of the four is optional and independent. A recruiter with only a
 * licence in hand starts with only a licence; one holding the whole file attaches
 * the whole file. Nothing here requires a set, and nothing infers one document
 * from another — what is attached is read, and what is not is simply not read.
 *
 * They upload to the same guest-application path the driver's own uploads use, so
 * the files ride inside `formData` into the wizard, the submission and the
 * preserved record without a second storage convention or a second signing rule.
 */
export const PREP_DOCUMENTS = Object.freeze([
    { name: 'cdl-front', label: "Driver's licence (front)" },
    { name: 'cdl-back', label: "Driver's licence (back)" },
    { name: 'medical-card-upload', label: 'Medical examiner’s certificate' },
    { name: 'psp-report-upload', label: 'PSP report' },
    { name: 'mvr-upload', label: 'Motor vehicle record' },
]);

export function ApplicationDocumentsPanel({ formData, onUpload, onChange }) {
    return (
        <FormSection
            title="Documents you already have"
            description="Attach any of these — one, some or all. They become part of the driver's application, and the reader below can fill in what they say."
        >
            <div className="space-y-ds-4">
                {PREP_DOCUMENTS.map((document) => (
                    <UploadField
                        key={document.name}
                        label={document.label}
                        name={document.name}
                        value={formData[document.name]}
                        onUpload={onUpload}
                        onChange={onChange}
                    />
                ))}
            </div>
        </FormSection>
    );
}

export default ApplicationDocumentsPanel;
