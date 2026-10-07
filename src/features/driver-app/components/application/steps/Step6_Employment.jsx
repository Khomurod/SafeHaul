import React, { useEffect, useMemo, useRef, useState } from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import MonthYearField from '@shared/components/form/MonthYearField';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS } from '@/config/form-options';
import { answersClearedByEndDate } from '@shared/utils/employmentApplicationHelpers';
import EmployerNameAutocomplete from './components/EmployerNameAutocomplete';
import { FormSection } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { StateSelectField } from './components/StateSelectField';
import { StepIssues } from './components/StepIssues';
import { makeEmploymentRowRenderers } from './components/EmploymentHistoryRows';
import { employmentStepIssues, focusEmploymentField } from './components/employmentStepIssues';
import { EMPTY_EMPLOYER } from './components/employmentRowShapes';
import { LockedEmployerIdentity } from './components/LockedEmployerIdentity';
import { EmployerDotQuestions } from './components/EmployerDotQuestions';
import { isLockedEmployerRow } from '@/config/applicationLockedFields';
import { ReportImportPanel } from './components/ReportImportPanel';
import { integrationEnabled } from '../reportSuggestions';
import { computeEmploymentCoverage } from '@shared/utils/employmentCoverage';
import {
    EmploymentCoveragePrompt,
    EmploymentCoverageSummary,
} from './components/EmploymentCoveragePrompt';
import { resolveApplicationGate } from '@/config/applicationGates';
import { employmentCoverageOptions } from '@/config/applicationRules';
import { useStepIssues } from '@features/driver-app/hooks/useApplicationRules';

/**
 * Presentation migrated to the approved `FormSection` / `FormField` / `Textarea`
 * primitives (2026-07-27).
 *
 * Unchanged: the `employers` / `unemployment` / `schools` / `military` row
 * shapes, the `employmentHistory` config resolution, the per-employer email
 * format checks and the `employerRowHasVerifierContact` requirement.
 *
 * DEFECT FIXED (2026-07-27): the per-row radio groups (`mayContact`, `branch`,
 * `heavyEq`, `honorable`) used the bare field name, so every row emitted the same
 * element ids and shared one browser radio group — clicking row 2's option
 * toggled row 1's input through the duplicated `label[for]`. Each row now scopes
 * its ids and grouping name by index while `name` (the saved key) is unchanged.
 *
 * 2026-09-02 — the company decides what incomplete coverage means
 * (`employmentHistoryEnforcement`: allow / warn / block) and how many years must
 * be accounted for (`employmentHistoryMinimumYears`). `warn` is the behaviour
 * this step always had: one interruption, then "Continue anyway". `block` shows
 * the same panel without that escape until the months are accounted for, and the
 * server refuses the same submission. `allow` never interrupts. The schooling,
 * gap and military row renderers moved to `EmploymentHistoryRows.jsx` unchanged.
 *
 * 2026-10-06 — the page asks what 49 CFR 391.21(b)(10)-(11) asks: every
 * employer of the past three years and, for a CDL job, the employers of the
 * seven years before that the applicant drove a CMV for. It asked for every
 * employer of ten. Each employer of the three years answers the two
 * (b)(10)(iv) questions (`EmployerDotQuestions`), and the reason for leaving is
 * required with the rest of the row. Employment dates are a month and a year
 * (`YYYY-MM`), as on FMCSA's own application form; rows saved with a full
 * `YYYY-MM-DD` keep it until changed, and every reader accepts both.
 *
 * 2026-10-07 — Continue lists what the page still needs, row by row, each line
 * taking the applicant to the field, and marks the fields (`employmentStepIssues.js`),
 * in place of the browser's bubble on one field and the email and contact toasts.
 */
const Step6_Employment = ({ formData, updateFormData, onNavigate, onPartialSubmit }) => {
    const ty = new Date().getFullYear();
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;
    const yesNoOptions = YES_NO_OPTIONS;

    // --- Configuration ---
    // One resolver for every surface (see src/config/applicationGates.js):
    // canonical gate ids, legacy aliases and shared defaults, so this step, the
    // submission validator and the immutable snapshot always agree.
    const getConfig = (fieldId) => resolveApplicationGate(currentCompany?.applicationConfig, fieldId);

    const empHistoryConfig = getConfig('employmentHistory');
    const { rules, blocking } = useStepIssues('employment', formData);
    const enforcement = rules.employmentHistoryEnforcement;
    // Coverage is told through its own panel; anything else that blocks this
    // step (an impossible date in a row) is told through the shared alert.
    const otherBlocking = blocking.filter((issue) => issue.code !== 'employment-coverage');
    const [attempted, setAttempted] = useState(false);
    // The rows named when Continue was last refused. Their lines and marks follow
    // the answers; a row added since waits for the next Continue.
    const [listedRows, setListedRows] = useState(() => new Set());
    const issuesRef = useRef(null);
    const pendingFocus = useRef(false);
    const { hidden: employersHidden, required: employersRequired } = empHistoryConfig;
    const fieldIssues = useMemo(() => employmentStepIssues({
        formData, employment: { hidden: employersHidden, required: employersRequired },
    }), [formData, employersHidden, employersRequired]);
    const listed = fieldIssues.items.filter((item) => listedRows.has(item.key));
    const errorFor = (listKey, index, key) => (listedRows.has(`${listKey}-${index}`)
        ? fieldIssues.errorFor(listKey, index, key)
        : undefined);
    // The list mounts on the render that follows the refusal, so focus waits for it.
    useEffect(() => {
        if (pendingFocus.current && issuesRef.current) {
            pendingFocus.current = false;
            issuesRef.current.focus();
        }
    });

    const initialEmployer = { ...EMPTY_EMPLOYER };
    const initialSchool = { name: '', startDate: '', endDate: '', location: '' };
    const initialUnemployment = { startDate: '', endDate: '', details: '' };
    const initialMilitary = { branch: '', start: '', end: '', rank: '', heavyEq: 'no', honorable: 'yes', explanation: '' };
    const { renderSchoolRow, renderUnemploymentRow, renderMilitaryRow } = makeEmploymentRowRenderers({ ty, yesNoOptions, errorFor });

    // Live three-year coverage, computed by the same module the submission
    // snapshot uses on the server, so what the driver is told here and what the
    // preserved record states are the same number.
    const coverage = useMemo(() => computeEmploymentCoverage({
        employers: formData.employers,
        unemployment: formData.unemployment,
        unemploymentPeriods: formData.unemploymentPeriods,
        schools: formData.schools,
        military: formData.military,
    }, employmentCoverageOptions(rules)), [
        formData.employers,
        formData.unemployment,
        formData.unemploymentPeriods,
        formData.schools,
        formData.military,
        rules,
    ]);

    const [coveragePromptOpen, setCoveragePromptOpen] = useState(false);
    // Shown once. After the driver has seen it, Continue continues — being told
    // twice is nagging, and a driver who cannot get past a step abandons the
    // application entirely.
    const coveragePromptSeen = useRef(false);
    const employersSectionRef = useRef(null);

    const proceed = () => {
        setCoveragePromptOpen(false);
        onNavigate('next');
    };

    const handleAddHistory = () => {
        setCoveragePromptOpen(false);
        employersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Focus lands on the section itself, so a keyboard user continues from
        // the history they were asked to add rather than the bottom of the page.
        employersSectionRef.current?.focus();
    };

    const handleContinue = () => {
        if (fieldIssues.items.length > 0 || otherBlocking.length > 0) {
            setAttempted(true);
            setListedRows(new Set(fieldIssues.items.map((item) => item.key)));
            if (issuesRef.current) issuesRef.current.focus();
            else pendingFocus.current = true;
            return;
        }
        // Behind the list: the browser's own check, for anything the list does not name.
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }

        if (!coverage.isComplete) {
            // `block`: the panel stays until the months are accounted for. `warn`:
            // it interrupts once, and its own "Continue anyway" proceeds. `allow`:
            // never interrupts.
            if (enforcement === 'block') {
                setCoveragePromptOpen(true);
                return;
            }
            if (enforcement === 'warn' && !coveragePromptSeen.current) {
                coveragePromptSeen.current = true;
                setCoveragePromptOpen(true);
                return;
            }
        }

        proceed();
    };

    /**
     * Employers the carrier fixed when it prepared this application.
     *
     * The decorative copy the invite exchange delivered. The enforcement copy is on
     * the draft, where the driver cannot reach it, and the submission checks that
     * one — this is only what tells the page which rows to present as settled.
     * Absent for every application a driver started themselves.
     */
    const lockedEmployers = formData.lockedEmployers;

    const renderEmployerRow = (index, item, handleChange) => (
        <div className="space-y-ds-3">
            {isLockedEmployerRow(item, lockedEmployers) ? (
                <LockedEmployerIdentity companyName={item.companyName} dotNumber={item.dotNumber} />
            ) : (
                <>
                    <EmployerNameAutocomplete
                        id={'emp-name-' + index}
                        label="Company Name"
                        value={item.companyName}
                        onChange={handleChange}
                        required={empHistoryConfig.required}
                        statesAllowlist={states}
                        error={errorFor('employers', index, 'companyName')}
                    />
                    <InputField
                        label="USDOT Number"
                        id={'emp-dot-' + index}
                        name="dotNumber"
                        value={item.dotNumber}
                        onChange={handleChange}
                        placeholder="Optional — filled when you pick a carrier from search"
                    />
                </>
            )}
            <InputField label="Street Address" id={'emp-street-' + index} name="address" autoComplete="off" value={item.address} onChange={handleChange} required={empHistoryConfig.required} error={errorFor('employers', index, 'address')} />
            <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-3">
                <InputField label="City" id={'emp-city-' + index} name="city" autoComplete="off" value={item.city} onChange={handleChange} required={empHistoryConfig.required} error={errorFor('employers', index, 'city')} />
                <StateSelectField
                    id={'emp-state-' + index}
                    name="state"
                    autoComplete="off"
                    states={states}
                    required={empHistoryConfig.required}
                    value={item.state}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                    error={errorFor('employers', index, 'state')}
                />
            </div>
            <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
                <InputField label="Company Phone" id={'emp-phone-' + index} name="phone" type="tel" autoComplete="off" value={item.phone} onChange={handleChange} placeholder="(555) 555-5555" error={errorFor('employers', index, 'phone')} />
                <InputField label="Company Email" id={'emp-co-email-' + index} name="companyEmail" type="email" autoComplete="off" value={item.companyEmail} onChange={handleChange} placeholder="hr@company.com" error={errorFor('employers', index, 'companyEmail')} />
            </div>
            <p className="text-ds-xs text-ds-content-muted">
                Provide at least one way to reach someone who can verify this job: company phone (10 digits), company email, or supervisor phone/email below.
                {empHistoryConfig.required && <span className="font-medium text-ds-status-warning-fg"> Required when employment history is on.</span>}
            </p>
            <InputField label="Position Held" id={'emp-position-' + index} name="position" value={item.position} onChange={handleChange} />
            <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
                <MonthYearField
                    label="Start Date (month / year)"
                    idPrefix={'emp-start-' + index}
                    name="startDate"
                    value={item.startDate}
                    onChange={handleChange}
                    required={empHistoryConfig.required}
                    maxToday={true}
                    minYear={ty - 40}
                    error={errorFor('employers', index, 'startDate')}
                />
                <MonthYearField
                    label="End Date (month / year)"
                    idPrefix={'emp-end-' + index}
                    name="endDate"
                    value={item.endDate}
                    onChange={(name, value) => {
                        handleChange(name, value);
                        for (const key of answersClearedByEndDate(item, value)) handleChange(key, '');
                    }}
                    required={empHistoryConfig.required}
                    maxToday={true}
                    minYear={ty - 40}
                    error={errorFor('employers', index, 'endDate')}
                />
            </div>
            <InputField label="Reason for Leaving" id={'emp-reason-' + index} name="reasonForLeaving" value={item.reasonForLeaving} onChange={handleChange} required={empHistoryConfig.required} error={errorFor('employers', index, 'reasonForLeaving')} />
            <EmployerDotQuestions index={index} item={item} required={empHistoryConfig.required} onChange={handleChange} errorFor={(key) => errorFor('employers', index, key)} />
            <InputField label="Supervisor Name" id={'emp-supervisor-' + index} name="supervisorName" autoComplete="off" value={item.supervisorName} onChange={handleChange} />
            <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
                <InputField label="Supervisor Phone" id={'emp-sup-phone-' + index} name="supervisorPhone" type="tel" autoComplete="off" value={item.supervisorPhone} onChange={handleChange} placeholder="Direct line or mobile" />
                <InputField label="Supervisor Email" id={'emp-sup-email-' + index} name="supervisorEmail" type="email" autoComplete="off" value={item.supervisorEmail} onChange={handleChange} placeholder="supervisor@company.com" error={errorFor('employers', index, 'supervisorEmail')} />
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

    return (
        <div id="page-6" className="form-step space-y-ds-6">
            <StepIssues
                ref={issuesRef}
                blocking={[...listed, ...otherBlocking]}
                showBlocking={attempted}
                title={listed.length > 0 ? 'Before you continue:' : undefined}
                onFocusField={focusEmploymentField}
            />
            <div className="space-y-ds-2 text-ds-sm text-ds-content-secondary">
                <p>
                    <strong className="text-ds-content">Past 3 years:</strong> list every employer, driving or not, and explain any gap of 30 days or more. Military service and driving school count too.
                </p>
                <p>
                    <strong className="text-ds-content">Years 4 to 10:</strong> if this job needs a CDL, also list each employer you drove a commercial motor vehicle for (49 CFR 391.21).
                </p>
                {rules.employmentHistoryMinimumYears > 3 && (
                    <p>This company asks you to account for the past {rules.employmentHistoryMinimumYears} years.</p>
                )}
            </div>

            <EmploymentCoverageSummary coverage={coverage} />

            {/*
              Everything that can account for the three years lives inside this
              block, so "Add missing history" has one unambiguous place to send
              the driver — including when the company has hidden the employer
              list and the gaps/schools/military sections are all that remain.
            */}
            <div
                ref={employersSectionRef}
                tabIndex={-1}
                className="space-y-ds-6 focus:outline-none"
            >
            {/*
              Optional PSP import — only when the company switched it on. It
              suggests the carriers the report mentions; the applicant adds each
              one deliberately, and nothing already entered changes.
            */}
            {!empHistoryConfig.hidden && integrationEnabled(currentCompany, 'psp') && (
                <ReportImportPanel kind="psp" company={currentCompany} formData={formData} updateFormData={updateFormData} />
            )}

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

            </div>

            {coveragePromptOpen && (
                <EmploymentCoveragePrompt
                    coverage={coverage}
                    onAddHistory={handleAddHistory}
                    onContinueAnyway={enforcement === 'block' ? null : proceed}
                />
            )}

            <StepNavigation
                onBack={() => onNavigate('back')}
                onSaveDraft={onPartialSubmit}
                onContinue={handleContinue}
            />
        </div>
    );
};

export default Step6_Employment;
