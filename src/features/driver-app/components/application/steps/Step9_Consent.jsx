import React from 'react';
import AgreementBox from '@shared/components/form/AgreementBox';
import InputField from '@shared/components/form/InputField'; // Kept for potential future use
import { useData } from '@/context/DataContext';
import { FileSignature, PenTool, CheckCircle } from 'lucide-react';

const Step9_Consent = ({ formData, updateFormData, onNavigate, onFinalSubmit, handleFileUpload }) => {
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;

    const isFinalCertified = formData['final-certification'] === 'agreed';
    const signatureName = formData['signatureName'] || '';

    const handleFinalCertificationChange = (e) => {
        updateFormData('final-certification', e.target.checked ? 'agreed' : '');
    };

    // Helper kept in case you add uploads back later, though currently unused in this version
    const onFileChange = (name, file) => {
        if (handleFileUpload) {
            handleFileUpload(name, file);
        }
    };

    return (
        <div id="page-9" className="form-step space-y-6">
            {/* Load a cursive font for the signature preview */}
            <style>
                {`@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap');`}
            </style>

            <h3 className="text-xl font-semibold text-gray-800">Step 9 of 9: Agreements & Signature</h3>

            {/* 1. Electronic Transaction Agreement */}
            <AgreementBox
                contentId="Agreement to Conduct Transaction Electronically"
                companyData={currentCompany}
                formData={formData}
                updateFormData={updateFormData}
                checkboxName="agree-electronic"
                checkboxLabel="I Agree"
                checkboxDescription="I have read, understood, and agree to the terms of transacting electronically."
                required={true}
            >
                <p>This electronic transaction service is provided on behalf of <strong className="company-name-placeholder">{currentCompany?.companyName || 'The Company'}</strong> (the "Employer").
                The Employer is requesting that we - SafeHaul - provide legal documents, notices, and disclosures electronically and that we obtain your signature to legal agreements, authorizations, and other documents electronically.</p>
                <h4>Scope of Agreement</h4>
                <p>You are agreeing to receive notices electronically, authorize background checks, and provide electronic signatures in lieu of wet ink signatures.</p>
            </AgreementBox>

            {/* 2. Background Check Disclosure */}
            <AgreementBox
                contentId="Background Check Disclosure"
                companyData={currentCompany}
                formData={formData}
                updateFormData={updateFormData}
                checkboxName="agree-background-check"
                checkboxLabel="I Acknowledge and Authorize"
                checkboxDescription="I have read, understood, and agree to the Background Check Disclosure."
                required={true}
            >
                <p>In connection with your application for employment with <strong className="company-name-placeholder">{currentCompany?.companyName || 'The Company'}</strong>, a consumer report and/or investigative consumer report may be requested about you for employment purposes.</p>
                <p>These reports may include criminal history, driving records, and employment history.</p>
            </AgreementBox>

            {/* 3. FMCSA PSP Authorization */}
            <AgreementBox
                contentId="FMCSA PSP Authorization"
                companyData={currentCompany}
                formData={formData}
                updateFormData={updateFormData}
                checkboxName="agree-psp"
                checkboxLabel="I Authorize PSP Check"
                checkboxDescription="I have read, understood, and agree to the PSP Disclosure and Authorization."
                required={true}
            >
                <p>I authorize <strong className="company-name-placeholder">{currentCompany?.companyName || 'The Company'}</strong> to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record.</p>
            </AgreementBox>

            {/* 4. Drug & Alcohol Clearinghouse */}
            <AgreementBox
                contentId="Drug & Alcohol Clearinghouse"
                companyData={currentCompany}
                formData={formData}
                updateFormData={updateFormData}
                checkboxName="agree-clearinghouse"
                checkboxLabel="I Provide Consent"
                checkboxDescription="I have read, understood, and provide consent for the Clearinghouse limited query."
                required={true}
            >
                <h4>General Consent for Limited Queries</h4>
                <p>I hereby provide consent to <strong className="company-name-placeholder">{currentCompany?.companyName || 'The Company'}</strong> to conduct a limited query of the FMCSA Commercial Driver's License Drug and Alcohol Clearinghouse.</p>

                {/* REMOVED: Upload Drug Test Consent Form (Optional) section */}
            </AgreementBox>

            {/* 5. Final Certification & E-Signature */}
            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6 bg-white">
                <legend className="text-lg font-semibold text-gray-800 px-2 flex items-center gap-2">
                    <FileSignature size={20} className="text-blue-600"/> Final Certification & Signature
                </legend>

                <div className="bg-gray-50 p-4 rounded text-sm text-gray-700 leading-relaxed border border-gray-200">
                    <p className="mb-2">I certify that I have read and understood all of the employment application.
                    I certify that I completed this application and that all of the information I supply is a full and complete statement of facts.</p>
                    <p>It is understood that if any falsification is discovered, it will constitute grounds for rejection of application or dismissal from employment.</p>
                </div>

                {/* --- TYPED SIGNATURE SECTION --- */}
                <div className="pt-4 border-t border-gray-200 space-y-4">

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1" htmlFor="signatureName">
                                Electronic Signature (Type Full Name) <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <PenTool className="text-gray-400" size={16} />
                                </div>
                                <input
                                    type="text"
                                    id="signatureName"
                                    name="signatureName"
                                    value={signatureName}
                                    onChange={(e) => updateFormData('signatureName', e.target.value)}
                                    placeholder="e.g. John Doe"
                                    className="w-full pl-10 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                By typing your name, you agree that this valid as your handwritten signature.
                            </p>
                        </div>

                        {/* Signature Preview */}
                        <div className="bg-white border-2 border-dashed border-blue-200 rounded-lg flex flex-col justify-center items-center p-4 min-h-[100px]">
                            {signatureName ? (
                                <p className="text-3xl text-blue-800 transform -rotate-2" style={{ fontFamily: "'Dancing Script', cursive" }}>
                                    {signatureName}
                                </p>
                            ) : (
                                <p className="text-gray-300 text-sm italic">Signature Preview</p>
                            )}
                        </div>
                    </div>

                    {/* Final Checkbox */}
                    <div className="flex items-start p-4 bg-blue-50/50 border border-blue-100 rounded-lg mt-4">
                        <div className="flex-shrink-0">
                            <input 
                                id="final-certification" 
                                name="final-certification" 
                                type="checkbox" 
                                checked={isFinalCertified}
                                onChange={handleFinalCertificationChange}
                                value="agreed" 
                                required 
                                className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5"
                            />
                        </div>
                        <div className="ml-3 text-sm">
                            <label htmlFor="final-certification" className="font-bold text-gray-800 cursor-pointer">
                                I Certify and Agree
                            </label>
                            <p className="text-gray-600 mt-1">
                                This certifies that I completed this application, and that all entries on it and information in it are true and complete to the best of my knowledge. I agree to sign this application electronically.
                            </p>
                        </div>
                    </div>
                </div>
            </fieldset>

            <div className="flex justify-between pt-6">
                <button 
                    type="button" 
                    onClick={() => onNavigate('back')} 
                    className="w-auto px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700"
                >
                    Back
                </button>
                <button 
                    type="submit" 
                    name="submit-full" 
                    onClick={onFinalSubmit}
                    disabled={!isFinalCertified || !signatureName.trim()}
                    className="w-auto px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <CheckCircle size={18} /> Submit Full Application
                </button>
            </div>
        </div>
    );
};

export default Step9_Consent;