import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, MILITARY_BRANCH_OPTIONS } from '@/config/form-options';

const Step6_Employment = ({ formData, updateFormData, onNavigate }) => {
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

    const initialEmployer = { name: '', street: '', city: '', state: '', phone: '', position: '', dates: '', reason: '' };
    const initialSchool = { name: '', dates: '', location: '' };
    const initialUnemployment = { startDate: '', endDate: '', details: '' };
    const initialMilitary = { branch: '', start: '', end: '', rank: '', heavyEq: 'no', honorable: 'yes', explanation: '' };

    const handleContinue = () => {
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
        <div key={index} className="space-y-3">
            <InputField label="Company Name" id={'emp-name-' + index} name="name" value={item.name} onChange={handleChange} required={empHistoryConfig.required} />
            <InputField label="Street Address" id={'emp-street-' + index} name="street" value={item.street} onChange={handleChange} required={empHistoryConfig.required} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <InputField label="City" id={'emp-city-' + index} name="city" value={item.city} onChange={handleChange} required={empHistoryConfig.required} />
                <div>
                    <label htmlFor={'emp-state-' + index} className="block text-sm font-medium text-gray-700 mb-1">State {empHistoryConfig.required && <span className="text-red-500">*</span>}</label>
                    <select id={'emp-state-' + index} name="state" required={empHistoryConfig.required} value={item.state || ""} onChange={(e) => handleChange(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        <option value="" disabled>Select State</option>
                        {states.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                </div>
                <InputField label="Phone" id={'emp-phone-' + index} name="phone" type="tel" value={item.phone} onChange={handleChange} />
            </div>
            <InputField label="Position Held" id={'emp-position-' + index} name="position" value={item.position} onChange={handleChange} />
            <InputField label="Dates Employed (mm/yyyy - mm/yyyy)" id={'emp-dates-' + index} name="dates" value={item.dates} onChange={handleChange} />
            <InputField label="Reason for Leaving" id={'emp-reason-' + index} name="reason" value={item.reason} onChange={handleChange} />
        </div>
    );

    const renderSchoolRow = (index, item, handleChange) => (
        <div key={index} className="space-y-3">
            <InputField label="School Name" id={'school-name-' + index} name="name" value={item.name} onChange={handleChange} required={true} />
            <InputField label="Dates Attended" id={'school-dates-' + index} name="dates" value={item.dates} onChange={handleChange} />
            <InputField label="Location (City, State)" id={'school-location-' + index} name="location" value={item.location} onChange={handleChange} />
        </div>
    );

    const renderUnemploymentRow = (index, item, handleChange) => (
        <div key={index} className="space-y-3">
            <InputField label="Start Date (mm/yyyy)" id={'unemp-start-' + index} name="startDate" value={item.startDate} onChange={handleChange} required={true} />
            <InputField label="End Date (mm/yyyy)" id={'unemp-end-' + index} name="endDate" value={item.endDate} onChange={handleChange} required={true} />
            <div className="space-y-2">
                <label htmlFor={'unemp-details-' + index} className="block text-sm font-medium text-gray-700 mb-1">Details related to unemployment period</label>
                <textarea id={'unemp-details-' + index} name="details" rows="3" value={item.details || ""} onChange={(e) => handleChange(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
        </div>
    );

    const renderMilitaryRow = (index, item, handleChange) => (
        <div key={index} className="space-y-3">
            <RadioGroup
                label="Branch of Service"
                name="branch"
                options={MILITARY_BRANCH_OPTIONS}
                value={item.branch}
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={false}
            />
            <InputField label="Start Date (mm/yyyy)" id={'mil-start-' + index} name="start" value={item.start} onChange={handleChange} required={true} />
            <InputField label="End Date (mm/yyyy)" id={'mil-end-' + index} name="end" value={item.end} onChange={handleChange} required={true} />
            <InputField label="Rank of Discharge" id={'mil-rank-' + index} name="rank" value={item.rank} onChange={handleChange} required={true} />
            <RadioGroup
                label="Did you operate heavy equipment/machinery?"
                name="heavyEq"
                options={yesNoOptions}
                value={item.heavyEq}
                onChange={(name, value) => handleChange(name, value)}
            />
            <RadioGroup
                label="Did you receive an honorable discharge?"
                name="honorable"
                options={yesNoOptions}
                value={item.honorable}
                onChange={(name, value) => handleChange(name, value)}
            />
            <div className="space-y-2">
                <label htmlFor={'mil-explain-' + index} className="block text-sm font-medium text-gray-700 mb-1">Please explain</label>
                <textarea id={'mil-explain-' + index} name="explanation" rows="3" value={item.explanation || ""} onChange={(e) => handleChange(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
        </div>
    );

    return (
        <div id="page-6" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 6 of 9: Employment History</h3>
            <p className="text-sm text-gray-600">To comply with DOT regulations (49 CFR 391.21), please provide a complete **10-year employment history**. This includes all employers (commercial driving and non-driving), periods of unemployment, military service, and driving schools. Failure to provide a complete 10-year history may delay your application.</p>

            {/* Previous Employers - Configurable */}
            {!empHistoryConfig.hidden && (
                <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                    <legend className="text-lg font-semibold text-gray-800 px-2">Previous Employers</legend>
                    <DynamicRow
                        listKey="employers"
                        formData={formData}
                        updateFormData={updateFormData}
                        renderRow={renderEmployerRow}
                        initialItemState={initialEmployer}
                        addButtonLabel="+ Add Employer"
                    />
                </fieldset>
            )}

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Employment Gaps</legend>
                <p className="text-sm text-gray-600">Please explain any gaps in employment of 30 days or more.</p>
                <DynamicRow
                    listKey="unemployment"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderUnemploymentRow}
                    initialItemState={initialUnemployment}
                    addButtonLabel="+ Add Employment Gap"
                />
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Driving Schools</legend>
                <DynamicRow
                    listKey="schools"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderSchoolRow}
                    initialItemState={initialSchool}
                    addButtonLabel="+ Add Driving School"
                />
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Military Service</legend>
                <DynamicRow
                    listKey="military"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderMilitaryRow}
                    initialItemState={initialMilitary}
                    addButtonLabel="+ Add Military Service"
                />
            </fieldset>

            <div className="flex justify-between pt-6">
                <button
                    type="button"
                    onClick={() => onNavigate('back')}
                    className="w-auto px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={handleContinue}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step6_Employment;