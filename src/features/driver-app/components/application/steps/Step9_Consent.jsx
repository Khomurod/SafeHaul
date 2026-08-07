import React, { useState, useEffect, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { FileSignature, CheckCircle, Save, Eraser, Loader2, AlertCircle } from 'lucide-react';
import { getSignatureDataUrl, clearCanvas, initializeSignatureCanvas } from '@/lib/signature';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, Checkbox, FieldMessage } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { useApplicationAgreements } from '@features/driver-app/hooks/useApplicationAgreements';

const E2E_SIGNATURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAUCAYAAABwR4+JAAAAAXNSR0IArs4c6QAAAO5JREFUaEPt1zEOgjAURdEtjPEEXoCLcAuuYfQAroJzMJ5BG8kpXAxwsf96YfNQfGrJ1zR56Qvwf6MQQxgkNC+CP+zr79WD4QxR2jEfSxO93Jt0NdRnM6xQ81YeJX1FW/EMubQIq4B15xTCg+0haEoQO4jYl3mRr6z4nQ18fpwevUJj2wkfjmaB2YRQ4c2tw+Zx0AMmN7cN6wEJxS3R+lAk4lHCAZ5QULvXLiP9hCV2dAW8hJw8YZSUdBBQ+J0F6sN2W3/8c2kP4aK8e5zQ3VCfN8bYQ9xH+Hh2BV9AE2Lh5ws6gN95AAAAAElFTkSuQmCC';

/**
 * Agreements & signature step.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This step used to render three hand-written one-line summaries — "a consumer
 * report may be requested about you" standing in for the whole FCRA disclosure —
 * and omitted the FMCSA Clearinghouse consent entirely. Drivers signed a
 * certification against text they had never been shown.
 *
 * It also recorded acceptance as three loose `agree-*` flags, which is not the
 * shape `buildSubmissionSnapshot` reads. Every snapshot therefore recorded
 * `accepted: false` for all agreements and, under the snapshot's rule that a
 * signature is never attached to unaccepted wording, preserved no signature
 * against any agreement at all.
 *
 * Now: all four required agreements are fetched in full from the server registry
 * that also freezes them into the snapshot, each is acknowledged separately, and
 * acceptance is recorded per agreement with its version and timestamp.
 *
 * PRESERVED DELIBERATELY: the full CERTIFICATION OF APPLICANT text including the
 * 49 CFR 391.23 rights list; the `final-certification` `'agreed'` / `''` values;
 * drawn vs typed `signatureType`; the `signatureDate` ISO stamp; the
 * `dataUrl.length < 100` blank-canvas guard and its exact message; the
 * `isE2ETestMode`-only test-signature control; the "Signature Saved & Locked"
 * confirmation; and the legacy `agree-*` keys, which the recruiter dossier still
 * reads to display authorization status.
 */

/**
 * Legacy per-agreement flags, still written so the recruiter dossier keeps
 * showing authorization status for records created after this change.
 * `agreementAcceptances` is the authoritative evidence; these are a mirror.
 */
const LEGACY_ACCEPTANCE_KEYS = {
    electronicSignature: 'agree-electronic',
    fcraDisclosure: 'agree-background-check',
    pspDisclosure: 'agree-psp',
    clearinghouseConsent: 'agree-clearinghouse',
};

const Step9_Consent = ({ formData, updateFormData, onNavigate, onFinalSubmit, isSubmitting, isUploading }) => {
    const { currentCompanyProfile } = useData();
    const canvasRef = useRef(null);

    const companyId = currentCompanyProfile?.id || formData?.companyId || null;
    const { agreements, loading: agreementsLoading, error: agreementsError, retry } =
        useApplicationAgreements(companyId);

    const [isSigned, setIsSigned] = useState(!!formData.signature);
    const [signatureError, setSignatureError] = useState('');
    const isFinalCertified = formData['final-certification'] === 'agreed';

    const acceptances = formData.agreementAcceptances || {};
    const allAgreementsAccepted =
        agreements.length > 0 && agreements.every((a) => acceptances[a.id]?.accepted === true);

    useEffect(() => {
        initializeSignatureCanvas();
    }, []);

    const handleFinalCertificationChange = (e) => {
        updateFormData('final-certification', e.target.checked ? 'agreed' : '');
    };

    /**
     * Record acceptance of one agreement.
     *
     * The version is stored alongside the timestamp so the evidence identifies
     * WHICH wording was accepted. Recording a bare "yes" against wording that can
     * later be revised is not evidence of anything.
     */
    const handleAgreementChange = (agreement, checked) => {
        const next = { ...(formData.agreementAcceptances || {}) };
        if (checked) {
            next[agreement.id] = {
                accepted: true,
                acceptedAt: new Date().toISOString(),
                version: agreement.version,
                // The client's own user agent is legitimate to self-report. The IP
                // is deliberately NOT sent from here: a client-supplied address is
                // trivially forged, so the server stamps it at submission instead.
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            };
        } else {
            // Withdrawing acknowledgement removes the evidence rather than marking
            // it false, so a stale acceptedAt cannot survive a change of mind.
            delete next[agreement.id];
        }
        updateFormData('agreementAcceptances', next);

        const legacyKey = LEGACY_ACCEPTANCE_KEYS[agreement.id];
        if (legacyKey) updateFormData(legacyKey, checked ? 'agreed' : '');
    };

    const handleSaveSignature = () => {
        const dataUrl = getSignatureDataUrl();

        if (!dataUrl || dataUrl.length < 100) {
            setSignatureError("Please draw your signature first.");
            return;
        }

        setSignatureError('');
        updateFormData('signature', dataUrl);
        updateFormData('signatureType', 'drawn');
        updateFormData('signatureDate', new Date().toISOString());
        setIsSigned(true);
    };

    const handleClearSignature = () => {
        const canvas = canvasRef.current || document.getElementById('signature-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

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

            <p className="text-ds-sm text-ds-content-secondary">
                Please read each agreement in full and acknowledge them separately. Your signature below
                applies to all of them.
            </p>

            {agreementsLoading && (
                <div role="status" className="flex items-center gap-ds-2 py-ds-8 text-ds-content-muted">
                    <Loader2 className="animate-spin" size={20} aria-hidden="true" />
                    Loading the required agreements…
                </div>
            )}

            {/* There is nothing legitimate to sign if the agreements did not load,
                so this blocks submission rather than degrading quietly. */}
            {agreementsError && !agreementsLoading && (
                <div
                    role="alert"
                    className="flex items-start gap-ds-3 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-4 text-ds-sm text-ds-status-danger-fg"
                >
                    <AlertCircle size={18} className="mt-px shrink-0" aria-hidden="true" />
                    <div className="space-y-ds-3">
                        <p>{agreementsError} You cannot submit until they load, because you must be able to read what you are signing.</p>
                        <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
                    </div>
                </div>
            )}

            <div className="space-y-ds-4">
                {agreements.map((agreement) => {
                    const checkboxId = `agreement-${agreement.id}`;
                    const accepted = acceptances[agreement.id]?.accepted === true;
                    return (
                        <fieldset
                            key={agreement.id}
                            className="space-y-ds-4 rounded-ds-lg border border-ds-border bg-ds-surface p-ds-4"
                        >
                            <legend className="px-ds-2 text-ds-body-lg font-semibold text-ds-content">
                                {agreement.title}
                            </legend>
                            {/* Focusable scroll region: a disclosure taller than the box
                                must be readable with the keyboard alone. */}
                            <div
                                tabIndex={0}
                                role="group"
                                aria-label={`${agreement.title} full text`}
                                className="max-h-72 overflow-y-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                            >
                                <p className="whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-content-secondary">
                                    {agreement.body}
                                </p>
                            </div>
                            <div className="rounded-ds-md bg-ds-surface-subtle p-ds-4">
                                <Checkbox
                                    id={checkboxId}
                                    name={checkboxId}
                                    label="I have read and agree"
                                    description={`I have read, understood, and agree to the ${agreement.title.toLowerCase()}.`}
                                    required
                                    checked={accepted}
                                    onChange={(e) => handleAgreementChange(agreement, e.target.checked)}
                                />
                            </div>
                        </fieldset>
                    );
                })}
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

                    {/* Names what is still outstanding. The disabled submit button
                        alone leaves an applicant guessing which box they missed. */}
                    {!allAgreementsAccepted && agreements.length > 0 && (
                        <p role="status" className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                            Please acknowledge all {agreements.length} agreements above before submitting.
                        </p>
                    )}
                </div>
            </fieldset>

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={onFinalSubmit}
                continueLabel={isSubmitting ? 'Submitting...' : 'Submit Full Application'}
                continueIcon={isSubmitting ? null : <CheckCircle size={20} aria-hidden="true" />}
                continueTone="success"
                continueLoading={isSubmitting}
                continueDisabled={!isFinalCertified || !isSigned || !allAgreementsAccepted || isUploading}
            />
        </div>
    );
};

export default Step9_Consent;
