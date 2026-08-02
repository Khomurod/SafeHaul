import React, { useState, useEffect, useRef } from 'react';
import AgreementBox from '@shared/components/form/AgreementBox';
import { useData } from '@/context/DataContext';
import { FileSignature, CheckCircle, Save, Eraser } from 'lucide-react';
import { getSignatureDataUrl, clearCanvas, initializeSignatureCanvas } from '@/lib/signature';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, Checkbox, FieldMessage } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';

const E2E_SIGNATURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAUCAYAAABwR4+JAAAAAXNSR0IArs4c6QAAAO5JREFUaEPt1zEOgjAURdEtjPEEXoCLcAuuYfQAroJzMJ5BG8kpXAxwsf96YfNQfGrJ1zR56Qvwf6MQQxgkNC+CP+zr79WD4QxR2jEfSxO93Jt0NdRnM6xQ81YeJX1FW/EMubQIq4B15xTCg+0haEoQO4jYl3mRr6z4nQ18fpwevUJj2wkfjmaB2YRQ4c2tw+Zx0AMmN7cN6wEJxS3R+lAk4lHCAZ5QULvXLiP9hCV2dAW8hJw8YZSUdBBQ+J0F6sN2W3/8c2kP4aK8e5zQ3VCfN8bYQ9xH+Hh2BV9AE2Lh5ws6gN95AAAAAElFTkSuQmCC';

/**
 * Agreements & signature step. Presentation migrated to the approved `Button` /
 * `Checkbox` primitives and `--ds-*` tokens (2026-07-27).
 *
 * Nothing legal or behavioural changed. Frozen: all three `AgreementBox`
 * disclosures with their exact `contentId`s, labels, descriptions and required
 * flags; the full CERTIFICATION OF APPLICANT text including the 49 CFR 391.23
 * rights list; the `final-certification` `'agreed'` / `''` values; the drawn vs
 * typed `signatureType`; the `signatureDate` ISO stamp; the
 * `dataUrl.length < 100` blank-canvas guard and its exact message text — which as
 * of 2026-07-28 is an announced inline error rather than a blocking `alert()`; the
 * `isE2ETestMode`-only "Use Test Signature" control; the "Signature Saved &
 * Locked" confirmation; and the
 * `!isFinalCertified || !isSigned || isSubmitting || isUploading` submit gate
 * that provides duplicate-submit protection alongside the container's
 * `isSubmittingRef` guard.
 *
 * DEFECTS FIXED (2026-07-27):
 * - The component injected a `<style>@import` for Google's "Dancing Script" font
 *   on every render of this step. Nothing in the app used that family, so it was
 *   a third-party request on the public application's most sensitive page for no
 *   visual effect. Removed.
 * - The signature canvas had no accessible name and no announcement, so a
 *   screen-reader user got no confirmation that their signature was captured.
 *   "Signature Saved & Locked" is now a `role="status"` live region and the
 *   canvas carries a label.
 * - The submit button was `type="submit"` inside `#driver-form`, so pressing
 *   Enter anywhere on the step could trigger it. It is now an explicit action
 *   button; `onFinalSubmit` is unchanged.
 */
const Step9_Consent = ({ formData, updateFormData, onNavigate, onFinalSubmit, isSubmitting, isUploading }) => {
    const { currentCompanyProfile } = useData();
    const currentCompany = currentCompanyProfile;
    const canvasRef = useRef(null);

    const [isSigned, setIsSigned] = useState(!!formData.signature);
    // Replaces the blocking `alert()` on the blank-canvas guard.
    const [signatureError, setSignatureError] = useState('');
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
            // Was a blocking `alert()`. The wording is preserved verbatim and is now
            // an announced inline error next to the canvas, matching how every other
            // validation message on this wizard behaves. A native alert on the
            // public application's most mobile-heavy step also could not be styled
            // or reliably dismissed.
            setSignatureError("Please draw your signature first.");
            return;
        }

        setSignatureError('');
        updateFormData('signature', dataUrl);
        updateFormData('signatureType', 'drawn');
        updateFormData('signatureDate', new Date().toISOString()); // Save the signing date
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

    const handleUseE2ESignature = () => {
        updateFormData('signature', E2E_SIGNATURE_DATA_URL);
        updateFormData('signatureType', 'typed');
        updateFormData('signatureDate', new Date().toISOString());
        setIsSigned(true);
    };

    return (
        <div id="page-9" className="form-step space-y-ds-6">
            <h2 className="text-ds-heading-sm font-semibold text-ds-content">Agreements &amp; Signature</h2>

            {/* Agreements Section (Kept for context) */}
            <div className="space-y-ds-4">
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
            <fieldset className="mt-ds-6 space-y-ds-4 rounded-ds-lg border border-ds-border bg-ds-surface p-ds-4 shadow-ds-xs">
                <legend className="flex items-center gap-ds-2 px-ds-2 text-ds-body-lg font-semibold text-ds-content">
                    <FileSignature size={20} className="text-ds-action-primary" aria-hidden="true" /> Final Certification &amp; Signature
                </legend>

                {/* Frozen legal text. Keyboard-focusable so a keyboard-only
                    applicant can scroll the certification they are about to sign. */}
                <div
                    tabIndex={0}
                    role="group"
                    aria-label="Certification of applicant"
                    className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 italic focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                >
                    <div className="space-y-ds-4 text-ds-sm leading-relaxed text-ds-content-secondary">
                        <p><strong className="text-ds-content">CERTIFICATION OF APPLICANT:</strong></p>
                        <p>I certify that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.</p>
                        <p>I authorize you to make such investigations and inquiries of my personal, employment, financial or medical history and other related matters as may be necessary in arriving at an employment decision. (Generally, inquiries regarding medical history will be made only if and after a conditional offer of employment has been extended.) I hereby release employers, schools, health care providers and other persons from all liability in responding to inquiries and releasing information in connection with my application.</p>
                        <p>In the event of employment, I understand that false or misleading information given in my application or interview(s) may result in discharge. I understand, also, that I am required to abide by all rules and regulations of the Company.</p>
                        <p>I understand that information I provide regarding current and/or previous employers may be used, and those employer(s) will be contacted, for the purpose of investigating my safety performance history as required by 49 CFR 391.23(d) and (e). I understand that I have the right to:</p>
                        <ul className="list-disc space-y-ds-1 pl-ds-5">
                            <li>Review information provided by previous employers;</li>
                            <li>Have errors in the information corrected by previous employers and for those previous employers to re-send the corrected information to the prospective employer; and</li>
                            <li>Have a rebuttal statement attached to the alleged erroneous information, if the previous employer(s) and I cannot agree on the accuracy of the information.</li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-ds-border-subtle pt-ds-4">
                    <span id="signature-canvas-label" className="ds-label mb-ds-2">
                        <span>Applicant Signature (Draw Below)</span>
                        <span className="ds-label__required-mark" aria-hidden="true">*</span>
                        <span className="ds-visually-hidden"> required</span>
                    </span>

                    <div className="relative">
                        <div className={`relative h-40 overflow-hidden rounded-ds-lg border-2 border-dashed ${isSigned ? 'border-ds-status-success-border bg-ds-surface-subtle' : 'border-ds-status-info-border bg-ds-surface'}`}>
                            <canvas
                                ref={canvasRef}
                                id="signature-canvas"
                                role="img"
                                aria-labelledby="signature-canvas-label"
                                className={`h-full w-full cursor-crosshair ${isSigned ? 'pointer-events-none opacity-40' : ''}`}
                                style={{ touchAction: 'none' }}
                            ></canvas>

                            {/* Signature Saved Overlay */}
                            {isSigned && (
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                    <p
                                        role="status"
                                        className="flex items-center gap-ds-2 rounded-ds-xl bg-ds-status-success-bg px-ds-6 py-ds-2 text-ds-sm font-bold tracking-wide text-ds-status-success-fg shadow-ds-md"
                                    >
                                        <CheckCircle size={18} aria-hidden="true" /> Signature Saved &amp; Locked
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Announced blank-canvas guard; was a blocking `alert()`. */}
                        <div role="alert">
                            {signatureError && (
                                <FieldMessage tone="error" className="mt-ds-2">{signatureError}</FieldMessage>
                            )}
                        </div>

                        <div className="mt-ds-4 flex flex-col gap-ds-3 sm:flex-row">
                            {!isSigned ? (
                                <>
                                    <Button variant="primary" size="lg" fullWidth onClick={handleSaveSignature}>
                                        <Save size={18} aria-hidden="true" /> Save Signature
                                    </Button>
                                    {isE2ETestMode && (
                                        <Button variant="secondary" size="lg" fullWidth onClick={handleUseE2ESignature}>
                                            Use Test Signature
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <Button variant="secondary" size="lg" fullWidth onClick={handleClearSignature}>
                                    <Eraser size={18} aria-hidden="true" /> Clear / Re-draw Signature
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="mt-ds-6 rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
                        <Checkbox
                            id="final-certification"
                            label="I Certify and Agree"
                            description="I certify that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge."
                            checked={isFinalCertified}
                            onChange={handleFinalCertificationChange}
                        />
                    </div>
                </div>
            </fieldset>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={onFinalSubmit}
                continueLabel={isSubmitting ? 'Submitting...' : 'Submit Full Application'}
                continueIcon={isSubmitting ? null : <CheckCircle size={20} aria-hidden="true" />}
                continueTone="success"
                continueLoading={isSubmitting}
                continueDisabled={!isFinalCertified || !isSigned || isUploading}
            />
        </div>
    );
};

export default Step9_Consent;
