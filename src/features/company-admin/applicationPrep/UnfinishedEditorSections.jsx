import React from 'react';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { SchemaField } from '@shared/components/schema/SchemaRenderer';
import { useUtils } from '@shared/hooks/useUtils';
import {
    ACCIDENTS_SECTION, ADDITIONAL_LICENSES_SECTION, VIOLATIONS_SECTION,
} from '@/config/applicationSchema';
import { EXPERIENCE_OPTIONS, MILES_DRIVEN_OPTIONS, YES_NO_OPTIONS } from '@/config/form-options';
import { visibleVehicleCategories } from '@/config/applicationRules';
import { PreviousEmployersEditor } from '@features/applications/components/PreviousEmployersEditor';
import UploadField from '@features/driver-app/components/application/UploadField';
import { DynamicQuestionsStep } from '@features/driver-app/components/application/steps/DynamicQuestionsStep';
import BusinessInfoSection from '@features/driver-app/components/application/steps/components/BusinessInfoSection';
import EmergencyContactsSection from '@features/driver-app/components/application/steps/components/EmergencyContactsSection';
import { makeEmploymentRowRenderers } from '@features/driver-app/components/application/steps/components/EmploymentHistoryRows';
import { PreviousAddressesSection } from '@features/driver-app/components/application/steps/components/PreviousAddressesSection';
import VehicleExperienceSection from '@features/driver-app/components/application/steps/components/VehicleExperienceSection';
import { PREP_DOCUMENTS } from './ApplicationDocumentsPanel';
import { SchemaRowsEditor } from './SchemaRowsEditor';
import { CUSTOM_ANSWERS, isDocumentOffered, isOffered } from './unfinishedEditorModel';

/**
 * Every page of the application, as a Company Admin edits it.
 *
 * Built from what already collects each answer, so it is stored the way the
 * driver's page stores it and the driver's page shows it unchanged:
 *
 * - **The scalar answers** through `SchemaField` in edit mode, the control the
 *   dossier and the preparation workspace edit them with (a choice as its
 *   option, several as the wizard's comma-joined list, a state by its name).
 * - **The wizard's own sections** where they are components: previous
 *   addresses, vehicle experience, business details, emergency contacts, the
 *   schooling, gap and military rows, and the company's own questions.
 * - **Employers** through `PreviousEmployersEditor`, the company's employer
 *   editor, with an employer the company locked shown as a record; violations,
 *   accidents and other licences through `SchemaRowsEditor`.
 * - **The four disclosures the schema lacks** as the wizard asks them: a yes/no
 *   question, and its explanation when the answer is yes.
 *
 * What is offered is `isOffered`'s call (see `unfinishedEditorModel.js`): the
 * answers only the driver gives never appear, and neither does a question the
 * company hid.
 */
/** In the wizard's frozen FMCSA wording (`Step4_Violations.jsx`, `Step7_General.jsx`). */
const DETAILS = 'Please provide details (date, location, circumstances):';
const DISCLOSURES = Object.freeze([
    {
        id: 'revoked-licenses',
        label: 'Has any license, permit or privilege ever been denied, suspended, or revoked for any reason?',
        explanation: 'revocationExplanation',
        explanationLabel: DETAILS,
    },
    {
        id: 'driving-convictions',
        label: 'Have you ever been convicted of driving during license suspension or revocation, or driving without a valid license or an expired license, or are any charges pending?',
        explanation: 'convictionExplanation',
        explanationLabel: DETAILS,
    },
    {
        id: 'drug-alcohol-convictions',
        label: 'Have you ever been convicted for any alcohol or controlled substance related offense while operating a motor vehicle, or are any charges pending?',
        explanation: 'drugConvictionExplanation',
        explanationLabel: DETAILS,
    },
]);
const FELONY = Object.freeze({
    id: 'has-felony',
    label: 'Have you ever been convicted of a felony?',
    explanation: 'felonyExplanation',
    explanationLabel: 'Please explain:',
});

function Grid({ children }) {
    return <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">{children}</div>;
}

/** A yes/no question the schema does not hold, and its explanation, as the wizard stores them. */
function Disclosure({ question, answers, update, offered }) {
    if (!offered(question.id)) return null;
    return (
        <div className="space-y-ds-3">
            <RadioGroup label={question.label} name={question.id} options={YES_NO_OPTIONS} value={answers[question.id]} onChange={update} />
            {offered(question.explanation) && (
                <FormField id={`${question.explanation}-edit`} label={question.explanationLabel}>
                    <Textarea
                        rows={3}
                        value={answers[question.explanation] || ''}
                        onChange={(e) => update(question.explanation, e.target.value)}
                    />
                </FormField>
            )}
        </div>
    );
}

export function UnfinishedEditorSections({ answers, update, form, loaded, lockedEmployers, companyId, onUpload }) {
    const { states } = useUtils();
    const ty = new Date().getFullYear();
    const config = form?.applicationConfig;
    const offered = (fieldId) => isOffered(fieldId, { applicationConfig: config, answers, loaded });
    const schemaFields = (keys) => keys.filter(offered).map((key) => (
        <SchemaField key={key} fieldKey={key} data={answers} onChange={update} isEditing />
    ));
    const hasRows = (key) => Array.isArray(answers[key]) && answers[key].length > 0;
    const { renderSchoolRow, renderUnemploymentRow, renderMilitaryRow } = makeEmploymentRowRenderers({
        ty, yesNoOptions: YES_NO_OPTIONS,
    });
    const vehicleCategories = visibleVehicleCategories(form?.applicationRules);
    const businessAsked = ['businessName', 'ein', 'businessStreet', 'businessCity', 'businessState', 'businessZip'].some(offered);
    const questions = Array.isArray(form?.customQuestions) ? form.customQuestions : [];
    const documents = PREP_DOCUMENTS.filter((document) => isDocumentOffered(document.name, config));

    return (
        <div className="space-y-ds-6">
            <FormSection title="Personal Information">
                <Grid>{schemaFields(['firstName', 'middleName', 'suffix', 'known-by-other-name', 'otherName'])}</Grid>
            </FormSection>

            <FormSection title="Address History">
                <Grid>{schemaFields(['street', 'city', 'state', 'zip', 'residence-3-years'])}</Grid>
                {offered('previousAddresses') && (answers['residence-3-years'] === 'no' || hasRows('previousAddresses')) && (
                    <PreviousAddressesSection formData={answers} updateFormData={update} states={states} ty={ty} />
                )}
            </FormSection>

            <FormSection title="General Qualifications">
                {offered('positionApplyingTo') && (
                    <InputField label="Position Applied For" id="positionApplyingTo-edit" name="positionApplyingTo" value={answers.positionApplyingTo} onChange={update} />
                )}
                <Grid>
                    {schemaFields([
                        'legal-work', 'english-fluency', 'experience-years', 'pre-employment-test-positive',
                        'pre-employment-test-explanation', 'drug-test-positive', 'drug-test-explanation',
                        'dot-return-to-duty', 'referralSource',
                    ])}
                </Grid>
            </FormSection>

            <FormSection title="License & Credentials">
                <Grid>{schemaFields(['cdlNumber', 'cdlState', 'cdlClass', 'cdlExpiration', 'endorsements', 'medCardExpiration', 'has-other-licenses'])}</Grid>
                {offered('additionalLicenses') && (
                    <SchemaRowsEditor
                        listKey="additionalLicenses"
                        title="Other licenses (past 3 years)"
                        itemFields={ADDITIONAL_LICENSES_SECTION.itemFields}
                        formData={answers}
                        updateFormData={update}
                        addButtonLabel="+ Add License"
                    />
                )}
                <Grid>{schemaFields(['has-twic', 'twicExpiration'])}</Grid>
            </FormSection>

            <FormSection title="Driving Record">
                {DISCLOSURES.map((question) => (
                    <Disclosure key={question.id} question={question} answers={answers} update={update} offered={offered} />
                ))}
                <Grid>{schemaFields(['has-violations'])}</Grid>
                {offered('violations') && (answers['has-violations'] === 'yes' || hasRows('violations')) && (
                    <SchemaRowsEditor listKey="violations" itemFields={VIOLATIONS_SECTION.itemFields} formData={answers} updateFormData={update} addButtonLabel="+ Add Violation" />
                )}
                <Grid>{schemaFields(['has-accidents'])}</Grid>
                {offered('accidents') && (answers['has-accidents'] === 'yes' || hasRows('accidents')) && (
                    <SchemaRowsEditor listKey="accidents" itemFields={ACCIDENTS_SECTION.itemFields} formData={answers} updateFormData={update} addButtonLabel="+ Add Accident" />
                )}
            </FormSection>

            <VehicleExperienceSection
                formData={answers}
                updateFormData={update}
                milesOptions={MILES_DRIVEN_OPTIONS}
                expOptions={EXPERIENCE_OPTIONS}
                categories={vehicleCategories}
            />

            <FormSection title="Employment History">
                {offered('employers') && (
                    <PreviousEmployersEditor
                        employers={answers.employers}
                        onChange={(employers) => update('employers', employers)}
                        lockedEmployers={lockedEmployers}
                        unfinished
                    />
                )}
                <DynamicRow
                    listKey="unemployment"
                    title="Periods of unemployment"
                    formData={answers}
                    updateFormData={update}
                    renderRow={renderUnemploymentRow}
                    initialItemState={{ startDate: '', endDate: '', details: '' }}
                    addButtonLabel="+ Add Unemployment Period"
                />
            </FormSection>

            <FormSection title="Education & Military">
                <DynamicRow
                    listKey="schools"
                    title="Schools"
                    formData={answers}
                    updateFormData={update}
                    renderRow={renderSchoolRow}
                    initialItemState={{ name: '', startDate: '', endDate: '', location: '' }}
                    addButtonLabel="+ Add School"
                />
                <DynamicRow
                    listKey="military"
                    title="Military service"
                    formData={answers}
                    updateFormData={update}
                    renderRow={renderMilitaryRow}
                    initialItemState={{ branch: '', start: '', end: '', rank: '', heavyEq: 'no', honorable: 'yes', explanation: '' }}
                    addButtonLabel="+ Add Military Service"
                />
            </FormSection>

            {businessAsked && <BusinessInfoSection formData={answers} updateFormData={update} states={states} />}

            {offered('ec1Name') && <EmergencyContactsSection formData={answers} updateFormData={update} />}

            <FormSection title="Felony History">
                <Disclosure question={FELONY} answers={answers} update={update} offered={offered} />
            </FormSection>

            {documents.length > 0 && (
                <FormSection title="Documents" description="Attach what you have, or replace what the driver attached.">
                    <div className="space-y-ds-4">
                        {documents.map((document) => (
                            <UploadField
                                key={document.name}
                                label={document.label}
                                name={document.name}
                                value={answers[document.name]}
                                companyId={companyId}
                                onUpload={onUpload}
                                onChange={update}
                            />
                        ))}
                    </div>
                </FormSection>
            )}

            {questions.length > 0 && (
                <FormSection title="Additional Questions">
                    <DynamicQuestionsStep
                        questions={questions}
                        formData={{ [CUSTOM_ANSWERS]: answers[CUSTOM_ANSWERS] || {} }}
                        updateFormData={update}
                        handleFileUpload={onUpload}
                        embedded
                    />
                </FormSection>
            )}
        </div>
    );
}

export default UnfinishedEditorSections;
