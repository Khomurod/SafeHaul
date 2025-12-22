import React from 'react';
import InputField from '@shared/components/form/InputField';
import RadioGroup from '@shared/components/form/RadioGroup';
import { useUtils } from '@shared/hooks/useUtils';
import { useData } from '@/context/DataContext';
import { YES_NO_OPTIONS, MILES_DRIVEN_OPTIONS, EXPERIENCE_OPTIONS } from '@/config/form-options';
import { UploadCloud, Calendar, Clock, Circle } from 'lucide-react';

const Step7_General = ({ formData, updateFormData, onNavigate, handleFileUpload }) => {
    const { states } = useUtils();
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    const yesNoOptions = YES_NO_OPTIONS;
    const milesOptions = MILES_DRIVEN_OPTIONS;
    const expOptions = EXPERIENCE_OPTIONS;
    const hasFelony = formData['has-felony'] === 'yes';

    // --- Validation Handler ---
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

    // --- Helper for Custom Answers ---
    const handleCustomAnswerChange = (questionIdOrLabel, answer) => {
        const currentAnswers = formData.customAnswers || {};
        const updatedAnswers = { ...currentAnswers, [questionIdOrLabel]: answer };
        updateFormData('customAnswers', updatedAnswers);
    };

    // Helper for Checkbox Grid / Multi-Select
    const handleCheckboxChange = (questionId, option) => {
        const currentAnswers = formData.customAnswers || {};
        const currentSelection = Array.isArray(currentAnswers[questionId]) ? currentAnswers[questionId] : [];

        let newSelection;
        if (currentSelection.includes(option)) {
            newSelection = currentSelection.filter(item => item !== option);
        } else {
            newSelection = [...currentSelection, option];
        }

        handleCustomAnswerChange(questionId, newSelection);
    };

    // --- Dynamic Question Renderer ---
    const renderQuestion = (q, index) => {
        // Handle Legacy String Questions
        if (typeof q === 'string') {
            return (
                <div key={index} className="space-y-2">
                    <label className="block text-sm font-medium text-gray-800">
                        {q} <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                        value={(formData.customAnswers && formData.customAnswers[q]) || ''}
                        onChange={(e) => handleCustomAnswerChange(q, e.target.value)}
                        required
                    />
                </div>
            );
        }

        // Handle New Object Questions
        const answer = (formData.customAnswers && formData.customAnswers[q.id]) || '';

        switch (q.type) {
            case 'paragraph':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <textarea
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            rows={4}
                            value={answer}
                            onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                            required={q.required}
                        />
                    </div>
                );

            case 'shortAnswer':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <input
                            type="text"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={answer}
                            onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                            required={q.required}
                        />
                    </div>
                );

            case 'multipleChoice':
                return (
                    <div key={q.id} className="space-y-3">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <div className="space-y-2">
                            {q.options?.map((opt, i) => (
                                <label key={i} className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-50">
                                    <input
                                        type="radio"
                                        name={q.id}
                                        value={opt}
                                        checked={answer === opt}
                                        onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                                        required={q.required}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">{opt}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                );

            case 'checkboxes':
                const selectedOptions = Array.isArray(answer) ? answer : [];
                return (
                    <div key={q.id} className="space-y-3">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <div className="space-y-2">
                            {q.options?.map((opt, i) => (
                                <label key={i} className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-50">
                                    <input
                                        type="checkbox"
                                        checked={selectedOptions.includes(opt)}
                                        onChange={() => handleCheckboxChange(q.id, opt)}
                                        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">{opt}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                );

            case 'dropdown':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <select
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={answer}
                            onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                            required={q.required}
                        >
                            <option value="">Select an option...</option>
                            {q.options?.map((opt, i) => (
                                <option key={i} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>
                );

            case 'date':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <div className="relative">
                            <Calendar size={18} className="absolute left-3 top-3.5 text-gray-400"/>
                            <input
                                type="date"
                                className="w-full pl-10 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={answer}
                                onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                                required={q.required}
                            />
                        </div>
                    </div>
                );

            case 'time':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}
                        <div className="relative">
                            <Clock size={18} className="absolute left-3 top-3.5 text-gray-400"/>
                            <input
                                type="time"
                                className="w-full pl-10 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={answer}
                                onChange={(e) => handleCustomAnswerChange(q.id, e.target.value)}
                                required={q.required}
                            />
                        </div>
                    </div>
                );

            case 'fileUpload':
                return (
                    <div key={q.id} className="space-y-2">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}

                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50 text-center hover:bg-gray-100 transition-colors">
                            <input
                                type="file"
                                id={`file-${q.id}`}
                                className="hidden"
                                // Required only if no answer (file name) is present
                                required={q.required && !answer} 
                                onChange={(e) => {
                                    // Use the main upload handler for actual file logic
                                    // We store the filename in customAnswers for reference
                                    if(handleFileUpload) handleFileUpload(q.id, e.target.files[0]);
                                    handleCustomAnswerChange(q.id, e.target.files[0]?.name || '');
                                }}
                            />
                            <label htmlFor={`file-${q.id}`} className="cursor-pointer flex flex-col items-center">
                                <UploadCloud size={24} className="text-blue-500 mb-2" />
                                <span className="text-sm text-blue-600 font-medium">Click to upload file</span>
                                {answer && <span className="text-xs text-gray-500 mt-2">Selected: {answer}</span>}
                            </label>
                        </div>
                    </div>
                );

            case 'linearScale':
                return (
                    <div key={q.id} className="space-y-3">
                        <label className="block text-sm font-bold text-gray-800">
                            {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.helpText && <p className="text-xs text-gray-500">{q.helpText}</p>}

                        <div className="flex items-center justify-between gap-4 max-w-md mx-auto py-2">
                            <span className="text-xs text-gray-500 font-medium">{q.minLabel || 'Min'}</span>
                            <div className="flex gap-4">
                                {[1, 2, 3, 4, 5].map(val => (
                                    <label key={val} className="flex flex-col items-center gap-1 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name={q.id} 
                                            value={val}
                                            checked={Number(answer) === val}
                                            onChange={(e) => handleCustomAnswerChange(q.id, Number(e.target.value))}
                                            required={q.required}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-xs text-gray-600">{val}</span>
                                    </label>
                                ))}
                            </div>
                            <span className="text-xs text-gray-500 font-medium">{q.maxLabel || 'Max'}</span>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div id="page-7" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 7 of 9: Custom Applicant Questions</h3>

            {/* --- Dynamic Custom Questions Section --- */}
            {currentCompany?.customQuestions?.length > 0 && (
                <fieldset className="border border-blue-200 bg-blue-50/30 rounded-lg p-6 space-y-6 shadow-sm">
                    <legend className="text-lg font-bold text-blue-900 px-2 flex items-center gap-2">
                        <Circle size={16} fill="currentColor" className="text-blue-200"/> 
                        {currentCompany.companyName || 'Company'} Specific Questions
                    </legend>
                    <p className="text-sm text-blue-700 px-1 mb-4 border-b border-blue-100 pb-2">
                        Please answer the following questions required by the carrier.
                    </p>

                    {currentCompany.customQuestions.map((question, index) => renderQuestion(question, index))}
                </fieldset>
            )}

            {/* --- Existing Fields --- */}
            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
                <legend className="text-lg font-semibold text-gray-800 px-2">Business Information (Owner-Operators)</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InputField label="Employer ID Number (EIN)" id="ein" name="ein" value={formData.ein} onChange={updateFormData} />
                    <InputField label="Driver Initials" id="driver-initials" name="driverInitials" value={formData.driverInitials} onChange={updateFormData} required={true} />
                </div>
                <InputField label="Business Name" id="business-name" name="businessName" value={formData.businessName} onChange={updateFormData} />
                <InputField label="Business Street" id="business-street" name="businessStreet" value={formData.businessStreet} onChange={updateFormData} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <InputField label="City" id="business-city" name="businessCity" value={formData.businessCity} onChange={updateFormData} />
                    <div>
                        <label htmlFor="business-state" className="block text-sm font-medium text-gray-700 mb-1">State</label>
                        <select id="business-state" name="businessState" value={formData.businessState || ""} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            <option value="" disabled>Select State</option>
                            {states.map(state => <option key={state} value={state}>{state}</option>)}
                        </select>
                    </div>
                    <InputField label="ZIP Code" id="business-zip" name="businessZip" value={formData.businessZip} onChange={updateFormData} />
                </div>
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Experience by Vehicle Type</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="exp-straight-truck-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Straight Truck</label>
                        <select id="exp-straight-truck-miles" name="expStraightTruckMiles" value={formData.expStraightTruckMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="exp-straight-truck-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Straight Truck</label>
                        <select id="exp-straight-truck-exp" name="expStraightTruckExp" value={formData.expStraightTruckExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="exp-semi-trailer-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Tractor + Semi Trailer</label>
                        <select id="exp-semi-trailer-miles" name="expSemiTrailerMiles" value={formData.expSemiTrailerMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="exp-semi-trailer-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Tractor + Semi Trailer</label>
                        <select id="exp-semi-trailer-exp" name="expSemiTrailerExp" value={formData.expSemiTrailerExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="exp-two-trailers-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Tractor + Two Trailers</label>
                        <select id="exp-two-trailers-miles" name="expTwoTrailersMiles" value={formData.expTwoTrailersMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="exp-two-trailers-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Tractor + Two Trailers</label>
                        <select id="exp-two-trailers-exp" name="expTwoTrailersExp" value={formData.expTwoTrailersExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                            {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                </div>
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Emergency Contacts</legend>
                <h4 className="text-base font-medium text-gray-700">Contact #1</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InputField label="Contact #1 Name" id="ec1-name" name="ec1Name" value={formData.ec1Name} onChange={updateFormData} required={true} />
                    <InputField label="Contact #1 Phone" id="ec1-phone" name="ec1Phone" type="tel" value={formData.ec1Phone} onChange={updateFormData} required={true} />
                    <InputField label="Contact #1 Relationship" id="ec1-relationship" name="ec1Relationship" value={formData.ec1Relationship} onChange={updateFormData} required={true} />
                    <InputField label="Contact #1 Address" id="ec1-address" name="ec1Address" value={formData.ec1Address} onChange={updateFormData} required={true} />
                </div>
                <h4 className="text-base font-medium text-gray-700 pt-4 border-t border-gray-100">Contact #2 (Optional)</h4>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InputField label="Contact #2 Name" id="ec2-name" name="ec2Name" value={formData.ec2Name} onChange={updateFormData} />
                    <InputField label="Contact #2 Phone" id="ec2-phone" name="ec2Phone" type="tel" value={formData.ec2Phone} onChange={updateFormData} />
                    <InputField label="Contact #2 Relationship" id="ec2-relationship" name="ec2Relationship" value={formData.ec2Relationship} onChange={updateFormData} />
                    <InputField label="Contact #2 Address" id="ec2-address" name="ec2Address" value={formData.ec2Address} onChange={updateFormData} />
                </div>
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Hours of Service (HOS)</legend>
                <p className="text-sm text-gray-600">Total hours worked during the immediately preceding 7 days.</p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
                    {[1, 2, 3, 4, 5, 6, 7].map(day => (
                        <div key={day}>
                            <label htmlFor={'hos-day' + day} className="block text-xs font-medium text-gray-700 mb-1">Day {day}</label>
                            <input 
                                type="number" 
                                id={'hos-day' + day} 
                                name={'hosDay' + day} 
                                value={formData['hosDay' + day] || ''}
                                onChange={(e) => updateFormData(e.target.name, e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-lg shadow-sm" 
                            />
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-gray-200">
                    <InputField label="Last relieved from work (DATE)" id="last-relieved-date" name="lastRelievedDate" type="date" value={formData.lastRelievedDate} onChange={updateFormData} />
                    <InputField label="Last relieved from work (TIME)" id="last-relieved-time" name="lastRelievedTime" type="time" value={formData.lastRelievedTime} onChange={updateFormData} />
                </div>
            </fieldset>

            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
                <legend className="text-lg font-semibold text-gray-800 px-2">Felony History</legend>
                <RadioGroup 
                    label="Have you ever been convicted of a felony?"
                    name="has-felony" 
                    options={yesNoOptions}
                    value={formData['has-felony']} 
                    onChange={updateFormData}
                    required={true}
                />
                {hasFelony && (
                    <div id="felony-details" className="space-y-2 pt-4 border-t border-gray-200">
                        <label htmlFor="felony-explanation" className="block text-sm font-medium text-gray-700 mb-1">Please explain:</label>
                        <textarea 
                            id="felony-explanation" 
                            name="felonyExplanation" 
                            rows="3" 
                            value={formData.felonyExplanation || ""}
                            onChange={(e) => updateFormData(e.target.name, e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        ></textarea>
                    </div>
                )}
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

export default Step7_General;