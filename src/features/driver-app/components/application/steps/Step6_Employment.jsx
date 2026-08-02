import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import DateTripletField from '@shared/components/form/DateTripletField';
import MonthYearField from '@shared/components/form/MonthYearField';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, MILITARY_BRANCH_OPTIONS } from '@/config/form-options';
import { useToast } from '@shared/components/feedback';
import { employerRowHasVerifierContact } from '@shared/utils/employmentApplicationHelpers';
import EmployerNameAutocomplete from './components/EmployerNameAutocomplete';
import { FormField, FormSection, Textarea } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives (2026-07-27).
 *
 * Unchanged: the `employers` / `unemployment` / `schools` / `military` row
 * shapes, the `employmentHistory` config resolution, the per-employer email
 * format checks and their exact "Employer N: …" toast strings, the
 * `employerRowHasVerifierContact` requirement, the frozen 49 CFR 391.21 /
 * 391.23 explanatory copy, and the `form.checkValidity()` gate.
 *
 * DEFECT FIXED (2026-07-27): the per-row radio groups (`mayContact`, `branch`,
 * `heavyEq`, `honorable`) used the bare field name, so every row emitted the same
 * element ids and shared one browser radio group — clicking row 2's option
 * toggled row 1's input through the duplicated `label[for]`. Each row now scopes
 * its ids and grouping name by index while `name` (the saved key) is unchanged.
 */
const Step6_Employment = ({ formData, updateFormData, onNavigate }) => {
    const { showError } = useToast();
    const ty = new Date().getFullYear();
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;
    const yesNoOptions = YES_NO_OPTIONS;

    // --- Configuration ---
    const getConfig = (fieldId, defaultReq = true) => {
        const config = currentCompany?.applicationConfig?.[fieldId];
        return {
            hidden: config?.hidden || false,
            required: config !== undefined ? config.required : defaultReq
        };
    };

    const empHistoryConfig = getConfig('employmentHistory', true);

    const initialEmployer = {
        companyName: '',
        dotNumber: '',
        address: '',
        city: '',
        state: '',
        phone: '',
        companyEmail: '',
        position: '',
        startDate: '',
        endDate: '',
        reasonForLeaving: '',
        supervisorName: '',
        supervisorPhone: '',
        supervisorEmail: '',
        mayContact: '',
    };
    const initialSchool = { name: '', startDate: '', endDate: '', location: '' };
    const initialUnemployment = { startDate: '', endDate: '', details: '' };
    const initialMilitary = { branch: '', start: '', end: '', rank: '', heavyEq: 'no', honorable: 'yes', explanation: '' };

    const handleContinue = () => {
        const employers = Array.isArray(formData.employers) ? formData.employers : [];
        if (!empHistoryConfig.hidden && employers.length > 0) {
            for (let i = 0; i < employers.length; i++) {
                const row = employers[i];
                const ce = String(row.companyEmail || '').trim();
                const se = String(row.supervisorEmail || '').trim();
                if (ce && !EMAIL_OK.test(ce)) {
                    showError(`Employer ${i + 1}: please enter a valid company email, or leave it blank.`);
                    return;
                }
                if (se && !EMAIL_OK.test(se)) {
                    showError(`Employer ${i + 1}: please enter a valid supervisor email, or leave it blank.`);
                    return;
                }
                if (empHistoryConfig.required && !employerRowHasVerifierContact(row)) {
                    showError(
                        `Employer ${i + 1}: add at least one contact method — company phone (10 digits), company email, supervisor phone, or supervisor email — so your carrier can verify employment.`
                    );
                    return;
                }
            }
        }

        const form = document.getElementById('driver-form');
        if (form) {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
        }
        onNavigate('next');
    };

    const renderEmployerRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <EmployerNameAutocomplete
                id={'emp-name-' + index}
                label="Company Name"
                value={item.companyName}
                onChange={handleChange}
                required={empHistoryConfig.required}
                statesAllowlist={states}
            />
            <InputField
                label="USDOT Number"
                id={'emp-dot-' + index}
                name="dotNumber"
                value={item.dotNumber}
                onChange={handleChange}
                placeholder="Optional — filled when you pick a carrier from search"
            />
            <InputField label="Street Address" id={'emp-street-' + index} name="address" value={item.address} onChange={handleChange} required={empHistoryConfig.required} />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-3">
                <InputField label="City" id={'emp-city-' + index} name="city" value={item.city} onChange={handleChange} required={empHistoryConfig.required} />
                <StateSelectField
                    id={'emp-state-' + index}
                    name="state"
                    states={states}
                    required={empHistoryConfig.required}
                    value={item.state}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </div>
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <InputField label="Company Phone" id={'emp-phone-' + index} name="phone" type="tel" value={item.phone} onChange={handleChange} placeholder="(555) 555-5555" />
                <InputField label="Company Email" id={'emp-co-email-' + index} name="companyEmail" type="email" value={item.companyEmail} onChange={handleChange} placeholder="hr@company.com" />
            </div>
            <p className="text-ds-xs text-ds-content-muted">
                Provide at least one way to reach someone who can verify this job: company phone (10 digits), company email, or supervisor phone/email below.
                {empHistoryConfig.required && <span className="font-medium text-ds-status-warning-fg"> Required when employment history is on.</span>}
            </p>
            <InputField label="Position Held" id={'emp-position-' + index} name="position" value={item.position} onChange={handleChange} />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <DateTripletField
                    label="Start Date"
                    idPrefix={'emp-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={empHistoryConfig.required}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
                <DateTripletField
                    label="End Date"
                    idPrefix={'emp-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={handleChange}
                    required={empHistoryConfig.required}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
            </div>
            <InputField label="Reason for Leaving" id={'emp-reason-' + index} name="reasonForLeaving" value={item.reasonForLeaving} onChange={handleChange} />
            <InputField label="Supervisor Name" id={'emp-supervisor-' + index} name="supervisorName" value={item.supervisorName} onChange={handleChange} />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <InputField label="Supervisor Phone" id={'emp-sup-phone-' + index} name="supervisorPhone" type="tel" value={item.supervisorPhone} onChange={handleChange} placeholder="Direct line or mobile" />
                <InputField label="Supervisor Email" id={'emp-sup-email-' + index} name="supervisorEmail" type="email" value={item.supervisorEmail} onChange={handleChange} placeholder="supervisor@company.com" />
            </div>
            <RadioGroup
                label="May we contact this employer?"
                name="mayContact"
                idPrefix={'emp-may-contact-' + index}
                groupName={'emp-may-contact-' + index}
                options={yesNoOptions}
                value={item.mayContact}
                onChange={(name, value) => handleChange(name, value)}
            />
        </div>
    );

    const renderSchoolRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <InputField label="School Name" id={'school-name-' + index} name="name" value={item.name} onChange={handleChange} required={true} />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <DateTripletField
                    label="Start Date"
                    idPrefix={'school-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
                <DateTripletField
                    label="End Date"
                    idPrefix={'school-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Month / Day / Year."
                />
            </div>
            <InputField label="Location (City, State)" id={'school-location-' + index} name="location" value={item.location} onChange={handleChange} />
        </div>
    );

    const renderUnemploymentRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <MonthYearField
                    label="Gap Start (month / year)"
                    idPrefix={'unemp-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                    helpText="Easier than typing — stored securely like other dates."
                />
                <MonthYearField
                    label="Gap End (month / year)"
                    idPrefix={'unemp-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 40}
                />
            </div>
            <FormField id={'unemp-details-' + index} label="Details related to unemployment period">
                <Textarea
                    name="details"
                    rows="3"
                    value={item.details || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
        </div>
    );

    const renderMilitaryRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            <RadioGroup
                label="Branch of Service"
                name="branch"
                idPrefix={'mil-branch-' + index}
                groupName={'mil-branch-' + index}
                options={MILITARY_BRANCH_OPTIONS}
                value={item.branch}
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={false}
            />
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <MonthYearField
                    label="Service Start (month / year)"
                    idPrefix={'mil-start-' + index}
                    name="start"
                    value={item.start}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 50}
                />
                <MonthYearField
                    label="Service End (month / year)"
                    idPrefix={'mil-end-' + index}
                    name="end"
                    value={item.end}
                    onChange={handleChange}
                    required={true}
                    maxToday={true}
                    minYear={ty - 50}
                />
            </div>
            <InputField label="Rank of Discharge" id={'mil-rank-' + index} name="rank" value={item.rank} onChange={handleChange} required={true} />
            <RadioGroup
                label="Did you operate heavy equipment/machinery?"
                name="heavyEq"
                idPrefix={'mil-heavy-eq-' + index}
                groupName={'mil-heavy-eq-' + index}
                options={yesNoOptions}
                value={item.heavyEq}
                onChange={(name, value) => handleChange(name, value)}
            />
            <RadioGroup
                label="Did you receive an honorable discharge?"
                name="honorable"
                idPrefix={'mil-honorable-' + index}
                groupName={'mil-honorable-' + index}
                options={yesNoOptions}
                value={item.honorable}
                onChange={(name, value) => handleChange(name, value)}
            />
            <FormField id={'mil-explain-' + index} label="Please explain">
                <Textarea
                    name="explanation"
                    rows="3"
                    value={item.explanation || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                />
            </FormField>
        </div>
    );

    return (
        <div id="page-6" className="form-step space-y-ds-6">
            <div className="space-y-ds-2 text-ds-sm text-ds-content-secondary">
                <p>
                    <strong className="text-ds-content">Application (49 CFR 391.21):</strong> provide a complete employment history for the <strong className="text-ds-content">past 10 years</strong> — all employers (driving and non-driving),
                    unemployment gaps of 30+ days, military service, and driving schools. Incomplete history may delay hiring.
                </p>
                <p>
                    <strong className="text-ds-content">Verification (49 CFR 391.23):</strong> carriers typically contact prior employers for the <strong className="text-ds-content">previous 3 years</strong> for safety verification.
                    That is separate from this longer application timeline — list the full 10 years here either way.
                </p>
            </div>

            {/* Previous Employers - Configurable */}
            {!empHistoryConfig.hidden && (
                <FormSection title="Previous Employers">
                    <DynamicRow
                        listKey="employers"
                        formData={formData}
                        updateFormData={updateFormData}
                        renderRow={renderEmployerRow}
                        initialItemState={initialEmployer}
                        addButtonLabel="+ Add Employer"
                    />
                </FormSection>
            )}

            <FormSection title="Employment Gaps">
                <p className="text-ds-sm text-ds-content-secondary">Please explain any gaps in employment of 30 days or more.</p>
                <DynamicRow
                    listKey="unemployment"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderUnemploymentRow}
                    initialItemState={initialUnemployment}
                    addButtonLabel="+ Add Employment Gap"
                />
            </FormSection>

            <FormSection title="Driving Schools">
                <DynamicRow
                    listKey="schools"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderSchoolRow}
                    initialItemState={initialSchool}
                    addButtonLabel="+ Add Driving School"
                />
            </FormSection>

            <FormSection title="Military Service">
                <DynamicRow
                    listKey="military"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderMilitaryRow}
                    initialItemState={initialMilitary}
                    addButtonLabel="+ Add Military Service"
                />
            </FormSection>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step6_Employment;
