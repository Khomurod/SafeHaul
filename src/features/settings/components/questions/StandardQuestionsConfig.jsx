import React from 'react';
import { Settings } from 'lucide-react';

export const STANDARD_FIELDS = [
    { id: 'ssn', label: 'Social Security Number', defaultReq: true },
    { id: 'dob', label: 'Date of Birth', defaultReq: true },
    { id: 'addressHistory', label: '3 Years Address History', defaultReq: true },
    { id: 'employmentHistory', label: 'Employment History (3-10 Yrs)', defaultReq: true },
    { id: 'cdlUpload', label: 'CDL Document Upload', defaultReq: true },
    { id: 'medCardUpload', label: 'Medical Card Upload', defaultReq: false },
    { id: 'mvrConsent', label: 'MVR Consent Form', defaultReq: true },
    { id: 'referralSource', label: 'Referral Source', defaultReq: false }
];

export function StandardQuestionsConfig({ config, onChange }) {
    const safeConfig = config || {};

    const toggleField = (fieldId, type) => {
        // type: 'required' | 'hidden'

        const currentSetting = safeConfig[fieldId] || { 
            required: STANDARD_FIELDS.find(f => f.id === fieldId)?.defaultReq || false, 
            hidden: false 
        };

        let newSetting = { ...currentSetting };

        if (type === 'required') {
            newSetting.required = !newSetting.required;
            // If making required, it cannot be hidden
            if (newSetting.required) newSetting.hidden = false;
        } else if (type === 'hidden') {
            newSetting.hidden = !newSetting.hidden;
            // If hiding, it cannot be required
            if (newSetting.hidden) newSetting.required = false;
        }

        onChange({
            ...safeConfig,
            [fieldId]: newSetting
        });
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-8">
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <Settings size={18} className="text-gray-500" />
                <h3 className="font-bold text-gray-800">Standard DOT Questions Configuration</h3>
            </div>

            <div className="p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-white text-gray-500 font-bold border-b border-gray-100">
                        <tr>
                            <th className="p-4">Field Name</th>
                            <th className="p-4 text-center w-32">Required</th>
                            <th className="p-4 text-center w-32">Hidden</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {STANDARD_FIELDS.map(field => {
                            const setting = safeConfig[field.id] || { required: field.defaultReq, hidden: false };

                            return (
                                <tr key={field.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-medium text-gray-700">{field.label}</td>

                                    {/* Required Toggle */}
                                    <td className="p-4 text-center">
                                        <button 
                                            onClick={() => toggleField(field.id, 'required')}
                                            className={`w-10 h-6 rounded-full relative transition-colors ${
                                                setting.required ? 'bg-green-500' : 'bg-gray-200'
                                            }`}
                                        >
                                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                                                setting.required ? 'translate-x-4' : 'translate-x-0'
                                            }`}></div>
                                        </button>
                                    </td>

                                    {/* Hidden Toggle */}
                                    <td className="p-4 text-center">
                                        <button 
                                            onClick={() => toggleField(field.id, 'hidden')}
                                            className={`w-10 h-6 rounded-full relative transition-colors ${
                                                setting.hidden ? 'bg-red-500' : 'bg-gray-200'
                                            }`}
                                        >
                                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                                                setting.hidden ? 'translate-x-4' : 'translate-x-0'
                                            }`}></div>
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                <p><strong>Note:</strong> Hiding DOT required fields (like SSN or Employment History) may make your application non-compliant.</p>
            </div>
        </div>
    );
}