import React, { useState, useEffect, useRef } from 'react';
import AgreementBox from '@shared/components/form/AgreementBox';
import { useData } from '@/context/DataContext';
import { FileSignature, PenTool, CheckCircle, Save, Eraser, RotateCcw } from 'lucide-react';
import { getSignatureDataUrl, clearCanvas, initializeSignatureCanvas } from '@/lib/signature';

const Step9_Consent = ({ formData, updateFormData, onNavigate, onFinalSubmit }) => {
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;
    const canvasRef = useRef(null);

    const [isSigned, setIsSigned] = useState(!!formData.signature);
    const isFinalCertified = formData['final-certification'] === 'agreed';

    // Initialize canvas on mount
    useEffect(() => {
        initializeSignatureCanvas();
    }, []);

    const handleFinalCertificationChange = (e) => {
        updateFormData('final-certification', e.target.checked ? 'agreed' : '');
    };

    const handleSaveSignature = () => {
        const dataUrl = getSignatureDataUrl();

        // Validation: Ensure the signature is not empty (dataURLs for blank canvases are very short)
        if (!dataUrl || dataUrl.length < 100) {
            alert("Please draw your signature first.");
            return;
        }

        updateFormData('signature', dataUrl);
        updateFormData('signatureType', 'drawn');
        setIsSigned(true);
    };

    const handleClearSignature = () => {
        // Clear via context as requested
        const canvas = canvasRef.current || document.getElementById('signature-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Also call utility for state consistency
        clearCanvas();
        updateFormData('signature', '');
        setIsSigned(false);
    };

    return (
        <div id="page-9" className="form-step space-y-6">
            <style>
                {`@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap');`}
            </style>

            <h3 className="text-xl font-semibold text-gray-800">Step 9 of 9: Agreements & Signature</h3>

            {/* Agreements Section (Kept for context) */}
            <div className="space-y-4">
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
                    <p>This electronic transaction service is provided on behalf of <strong className="company-name-placeholder">{currentCompany?.companyName || 'The Company'}</strong>. You are agreeing to receive notices electronically and provide electronic signatures.</p>
                </AgreementBox>

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
                    <p>In connection with your application for employment, a consumer report may be requested about you.</p>
                </AgreementBox>

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
                    <p>I authorize access to the FMCSA Pre-Employment Screening Program (PSP) system.</p>
                </AgreementBox>
            </div>

            {/* 5. Final Certification & E-Signature */}
            <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6 bg-white shadow-sm">
                <legend className="text-lg font-semibold text-gray-800 px-2 flex items-center gap-2">
                    <FileSignature size={20} className="text-blue-600" /> Final Certification & Signature
                </legend>

                <div className="bg-gray-50 p-4 rounded text-sm text-gray-700 leading-relaxed border border-gray-200 italic">
                    <p>This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.</p>
                </div>

                <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-bold text-gray-700">
                            Applicant Signature (Draw Below) <span className="text-red-500">*</span>
                        </label>
                    </div>

                    <div className="relative group">
                        <div className={`relative bg-white border-2 border-dashed rounded-xl overflow-hidden h-40 transition-all duration-300 ${isSigned ? 'border-green-500 bg-gray-100' : 'border-blue-200 group-hover:border-blue-400'}`}>
                            <canvas
                                ref={canvasRef}
                                id="signature-canvas"
                                className={`w-full h-full cursor-crosshair ${isSigned ? 'pointer-events-none opacity-40' : ''}`}
                                style={{ touchAction: 'none' }}
                            ></canvas>

                            {/* Signature Saved Overlay */}
                            {isSigned && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-in fade-in zoom-in duration-300">
                                    <div className="bg-green-600 text-white px-6 py-2 rounded-full shadow-lg flex items-center gap-2 font-bold text-sm tracking-wide">
                                        <CheckCircle size={18} /> Signature Saved & Locked
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-4 mt-4">
                            {!isSigned ? (
                                <button
                                    type="button"
                                    onClick={handleSaveSignature}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-100 transition-all active:scale-95"
                                >
                                    <Save size={18} /> Save Signature
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleClearSignature}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-bold transition-all active:scale-95 border border-gray-200"
                                >
                                    <Eraser size={18} /> Clear / Re-draw Signature
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-start p-4 bg-blue-50/30 border border-blue-100 rounded-xl mt-6">
                        <div className="flex-shrink-0">
                            <input
                                id="final-certification"
                                type="checkbox"
                                checked={isFinalCertified}
                                onChange={handleFinalCertificationChange}
                                className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-1 cursor-pointer"
                            />
                        </div>
                        <div className="ml-3 text-sm">
                            <label htmlFor="final-certification" className="font-bold text-gray-900 cursor-pointer block">
                                I Certify and Agree
                            </label>
                            <p className="text-gray-600 mt-1 leading-relaxed">
                                I certify that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.
                            </p>
                        </div>
                    </div>
                </div>
            </fieldset>

            <div className="flex justify-between pt-8">
                <button
                    type="button"
                    onClick={() => onNavigate('back')}
                    className="px-10 py-3.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all active:scale-95 shadow-sm"
                >
                    Back
                </button>
                <button
                    type="submit"
                    onClick={onFinalSubmit}
                    disabled={!isFinalCertified || !isSigned}
                    className="px-10 py-3.5 bg-green-600 text-white font-bold rounded-xl shadow-lg shadow-green-100 hover:bg-green-700 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed flex items-center gap-2 transition-all active:scale-95"
                >
                    <CheckCircle size={20} /> Submit Full Application
                </button>
            </div>
        </div>
    );
};

export default Step9_Consent;