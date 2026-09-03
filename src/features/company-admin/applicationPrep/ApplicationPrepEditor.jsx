import React from 'react';
import InputField from '@shared/components/form/InputField';
import DateTripletField from '@shared/components/form/DateTripletField';
import DynamicRow from '@shared/components/form/DynamicRow';
import { FormSection } from '@/design-system/components';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';
import ApplicationDocumentsPanel from './ApplicationDocumentsPanel';
import PreparedEmployersPanel from './PreparedEmployersPanel';

/**
 * Everything the carrier can fill in before the driver sees it.
 *
 * Scalar sections come straight from `SchemaSection`, the same schema-driven
 * renderer the driver dossier's Full Application view uses — one definition of
 * what a licence field is, editable in both places.
 *
 * The repeating sections do not: `SchemaSection` renders arrays read-only even in
 * edit mode, deliberately, because in the dossier they are part of a submitted
 * application under the propose-and-approve flow. Nothing is submitted here, so
 * they get real editors — a shorter employer row than the wizard's (the fields a
 * recruiter can actually answer) and the violation row as it stands.
 *
 * Nothing here is required. A recruiter who knows only a name and a licence number
 * fills in a name and a licence number; the driver completes the rest, and the
 * Application Rules the company already configured are applied to them at
 * submission exactly as they always were.
 */
export function ApplicationPrepEditor({
    formData,
    updateField,
    updateList,
    lockedEmployers,
    onLockEmployers,
    onUnlockEmployer,
    onUpload,
    onFileChange,
    // Once a link has been minted for this draft, the email and phone that key it
    // must not change: the driver's already-sent link would keep opening the old
    // key while the recruiter edited a new one. They render read-only instead.
    identityLocked = false,
}) {
    const ty = new Date().getFullYear();
    const identityLockedKeys = identityLocked ? ['email', 'phone'] : [];

    const renderViolationRow = (index, item, handleChange) => (
        <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
            <DateTripletField
                label="Date of conviction"
                idPrefix={`prep-violation-date-${index}`}
                name="date"
                value={item.date}
                onChange={handleChange}
                maxToday={true}
                minYear={ty - 15}
                helpText="Month / day / year."
            />
            <InputField
                label="Charge"
                id={`prep-violation-charge-${index}`}
                name="charge"
                value={item.charge}
                onChange={handleChange}
            />
            <InputField
                label="Location (city, state)"
                id={`prep-violation-location-${index}`}
                name="location"
                value={item.location}
                onChange={handleChange}
            />
            <InputField
                label="Penalty"
                id={`prep-violation-penalty-${index}`}
                name="penalty"
                value={item.penalty}
                onChange={handleChange}
            />
        </div>
    );

    return (
        <div className="space-y-ds-6">
            <FormSection
                title="Driver details"
                description={identityLocked
                    ? 'A link is out for this driver. The email and phone identify it, so they are fixed — to change them, start a new application.'
                    : 'Whatever you already know. Anything left blank is simply a question the driver answers.'}
            >
                <SchemaSection
                    sectionId="personalInfo"
                    data={formData}
                    isEditing
                    onChange={updateField}
                    lockedKeys={identityLockedKeys}
                />
                <SchemaSection sectionId="currentAddress" data={formData} isEditing onChange={updateField} />
            </FormSection>

            <FormSection title="Licence and medical card">
                <SchemaSection sectionId="license" data={formData} isEditing onChange={updateField} />
                <SchemaSection sectionId="medicalCard" data={formData} isEditing onChange={updateField} />
            </FormSection>

            <PreparedEmployersPanel
                formData={formData}
                updateFormData={updateList}
                lockedEmployers={lockedEmployers}
                onLock={onLockEmployers}
                onUnlock={onUnlockEmployer}
            />

            <FormSection
                title="Moving violations"
                description="From the driver's record, if you have it. The driver reviews and can correct these."
            >
                <DynamicRow
                    listKey="violations"
                    formData={formData}
                    updateFormData={updateList}
                    renderRow={renderViolationRow}
                    initialItemState={{ date: '', charge: '', location: '', penalty: '' }}
                    addButtonLabel="+ Add violation"
                />
            </FormSection>

            <ApplicationDocumentsPanel formData={formData} onUpload={onUpload} onChange={onFileChange} />
        </div>
    );
}

export default ApplicationPrepEditor;
