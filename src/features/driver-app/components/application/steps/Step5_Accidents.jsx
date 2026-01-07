import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import DynamicRow from '@shared/components/form/DynamicRow';
import { useUtils } from '@shared/hooks/useUtils';

const Step5_Accidents = ({ formData, updateFormData, onNavigate }) => {
    const { states } = useUtils();
    const yesNoOptions = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
    const initialAccident = { date: '', city: '', state: '', commercial: 'no', details: '', preventable: 'no' };

    const renderAccidentRow = (index, item, handleChange) => (
        <div key={index} className="space-y-3">
            <InputField 
                label="Date of Accident" 
                id={'accident-date-' + index} 
                name="date" 
                type="date"
                value={item.date} 
                onChange={handleChange}
                required={true} 
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InputField 
                    label="City" 
                    id={'accident-city-' + index} 
                    name="city" 
                    value={item.city} 
                    onChange={handleChange} 
                    required={true}
                />
                <div>
                    <label htmlFor={'accident-state-' + index} className="block text-sm font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                    <select 
                        id={'accident-state-' + index} 
                        name="state" 
                        required 
                        value={item.state || ""} 
                        onChange={(e) => handleChange(e.target.name, e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                    >
                        <option value="" disabled>Select State</option>
                        {states.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                </div>
            </div>
            <RadioGroup 
                label="Were you in a commercial vehicle?"
                name="commercial" 
                options={yesNoOptions}
                value={item.commercial} 
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={true}
            />
            <div className="space-y-2">
                <label htmlFor={'accident-details-' + index} className="block text-sm font-medium text-gray-700 mb-1">Accident details <span className="text-red-500">*</span></label>
                <textarea 
                    id={'accident-details-' + index} 
                    name="details" 
                    rows="3" 
                    value={item.details || ""}
                    onChange={(e) => handleChange(e.target.name, e.target.value)}
                    required={true}
                    className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
            </div>
            <RadioGroup 
                label="Was this accident preventable?"
                name="preventable" 
                options={yesNoOptions}
                value={item.preventable} 
                onChange={(name, value) => handleChange(name, value)}
                required={true}
                horizontal={true}
            />
        </div>
    );

    return (
        <div id="page-5" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 5 of 9: Accident History</h3>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">Accident History (Past 3 Years)</legend>
                <p className="text-sm text-gray-600">Please list all motor vehicle accidents in which you were involved in the past 3 years.</p>
                <DynamicRow
                    listKey="accidents"
                    formData={formData}
                    updateFormData={updateFormData}
                    renderRow={renderAccidentRow}
                    initialItemState={initialAccident}
                    addButtonLabel="+ Add Accident"
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
                    onClick={() => onNavigate('next')}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Continue
                </button>
            </div>
        </div>
    );
};

export default Step5_Accidents;