import React, { useEffect, useRef } from 'react';
import { useUtils } from '../../hooks/useUtils';

const AgreementBox = ({ contentId, companyData, children, showCheckbox = true, checkboxName, checkboxLabel, checkboxDescription, required = false, formData, updateFormData }) => {
    const { initializeFormBranding } = useUtils();
    const contentRef = useRef(null);

    useEffect(() => {
        if (companyData && contentRef.current) {
            initializeFormBranding(companyData);
        }
    }, [companyData, initializeFormBranding, children]);

    const handleChange = (e) => {
        updateFormData(checkboxName, e.target.checked ? 'agreed' : '');
    };

    return (
        <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4">
            <legend className="text-lg font-semibold text-gray-800 px-2">{contentId}</legend>
            <div className="agreement-box">
                <div ref={contentRef} className="prose prose-sm max-w-none text-gray-700">
                    {children}
                </div>
            </div>
            {showCheckbox && (
                <div className="flex items-start p-4 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0">
                        <input
                            id={checkboxName}
                            name={checkboxName}
                            type="checkbox"
                            checked={formData[checkboxName] === 'agreed'}
                            onChange={handleChange}
                            required={required}
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                    <div className="ml-3 text-sm">
                        <label htmlFor={checkboxName} className="font-medium text-gray-800">
                            {checkboxLabel} {required && <span className="text-red-500">*</span>}
                        </label>
                        <p className="text-gray-600">{checkboxDescription}</p>
                    </div>
                </div>
            )}
        </fieldset>
    );
};

export default AgreementBox;