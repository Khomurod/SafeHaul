import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { Icon, FileSignature, CheckCircle, Eraser, Loader2 } from '@design-system/icons';
import { getSignatureDataUrl, clearCanvas, drawSignature, initializeSignatureCanvas } from '@/lib/signature';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, Checkbox, Notice } from '@/design-system/components';
import { StepNavigation } from './components/StepNavigation';
import { AgreementDocumentPage } from './components/AgreementDocumentPage';
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
 * `dataUrl.length < 100` blank-canvas guard; the `isE2ETestMode`-only
 * test-signature control; and the legacy `agree-*` keys, which the recruiter
 * dossier still reads to display authorization status.
 *
 * 2026-10-06 — ONE DOCUMENT PER PAGE. The agreements used to share one page with
 * each other and with the certification's release paragraph. The FCRA disclosure
 * must be a document consisting solely of itself, and the PSP form's own notice
 * says its language must stand alone and "may NOT be included with other consent
 * forms or any other language". So each agreement now has its own page (see
 * `AgreementDocumentPage`), and the certification and signature come last. An
 * acceptance counts only at the version on screen, so a draft that accepted
 * wording since replaced is asked again. The certification ends with the exact
 * 49 CFR 391.21(b)(12) sentence, which the rule requires "at the end of the
 * application form".
 *
 * 2026-10-09 — THE SIGNATURE SAVES ITSELF. It was kept only when the driver
 * pressed Save Signature, and Submit stayed grey with no reason given to a driver
 * who drew and went on. Each stroke now saves as it ends, the pad stays open for
 * the next stroke, Clear is always there, and a signature already given is drawn
 * back when the page is shown again (it said "Saved" over an empty pad). Under
 * Submit, a line names whatever is still missing: an agreement, the signature, the
 * certification, or an upload still on its way. A resumed draft never holds the
 * signature, so it is asked again there.
 */

/** "a", "a and b", "a, b and c". */
function sentenceList(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

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

/**
 * 49 CFR 391.21(b)(12), word for word. The rule prescribes this sentence and puts
 * it, with the signature line, "at the end of the application form".
 */
const CERTIFICATION_STATEMENT = 'This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.';

const Step9_Consent = ({ formData, updateFormData, onNavigate, onFinalSubmit, isSubmitting, isUploading }) => {
    const { currentCompanyProfile } = useData();
    const canvasRef = useRef(null);
    const pageHeadingRef = useRef(null);

    const companyId = currentCompanyProfile?.id || formData?.companyId || null;
    const { agreements: allAgreements, loading: agreementsLoading, error: agreementsError, retry } =
        useApplicationAgreements(companyId);
    // The MVR authorization is read and answered on the Motor Vehicle Record
    // step; this page shows the agreements that belong to it.
    const agreements = useMemo(
        () => allAgreements.filter((agreement) => (agreement.presentedOn || 'consent') === 'consent'),
        [allAgreements],
    );

    const isSigned = Boolean(formData.signature);
    const isFinalCertified = formData['final-certification'] === 'agreed';

    const acceptances = formData.agreementAcceptances || {};
    // At the version on screen, not merely accepted: agreeing to earlier wording
    // is not agreeing to this wording.
    const isAccepted = (agreement) => acceptances[agreement.id]?.accepted === true
        && acceptances[agreement.id]?.version === agreement.version;
    const allAgreementsAccepted = agreements.length > 0 && agreements.every(isAccepted);

    // The page showing: a document's index, or `agreements.length` for the
    // certification and signature. Fixed once the set arrives (the first document
    // not yet accepted, or the signature when none is left) and then moved only by
    // the driver, so ticking a box never turns the page under them.
    const [page, setPage] = useState(null);
    const firstOpen = agreements.findIndex((agreement) => !isAccepted(agreement));
    const startPage = firstOpen === -1 ? agreements.length : firstOpen;
    const current = page ?? startPage;
    const ready = !agreementsLoading && !agreementsError && agreements.length > 0;
    const onSignaturePage = ready && current >= agreements.length;

    useEffect(() => {
        if (page === null && agreements.length > 0) setPage(startPage);
    }, [page, agreements.length, startPage]);

    // Not on arrival, which the Stepper announces with the step heading, but on
    // every turn of the page after it, so a screen reader hears the new document.
    const shownPageRef = useRef(null);
    useEffect(() => {
        if (page === null) return;
        if (shownPageRef.current !== null && shownPageRef.current !== page) pageHeadingRef.current?.focus();
        shownPageRef.current = page;
    }, [page]);

    // The canvas exists only on the signature page, and is a new element each
    // time that page is shown: the signature already given is drawn back onto it,
    // and every stroke is saved the moment it ends. Read through refs, so a save
    // does not set the canvas up again and wipe it.
    const signatureRef = useRef(formData.signature);
    signatureRef.current = formData.signature;
    const saveStrokeRef = useRef(null);
    saveStrokeRef.current = () => {
        const dataUrl = getSignatureDataUrl();
        // The blank-canvas guard: a stroke too small to read is not a signature.
        if (!dataUrl || dataUrl.length < 100) return;
        updateFormData('signature', dataUrl);
        updateFormData('signatureType', 'drawn');
        updateFormData('signatureDate', new Date().toISOString());
    };
    useEffect(() => {
        if (!onSignaturePage) return;
        initializeSignatureCanvas({
            onStrokeEnd: () => saveStrokeRef.current?.(),
            restore: signatureRef.current,
        });
    }, [onSignaturePage]);

    const goToPage = (next) => setPage(Math.max(0, Math.min(next, agreements.length)));

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
                // Whether this page drew the version's links (the FCRA summary of
                // rights): the server records them as provided only on this word.
                linksShown: Array.isArray(agreement.links) && agreement.links.length > 0,
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

    const handleClearSignature = () => {
        const canvas = canvasRef.current || document.getElementById('signature-canvas');
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);

        clearCanvas();
        updateFormData('signature', '');
    };

    const handleUseE2ESignature = () => {
        clearCanvas();
        drawSignature(E2E_SIGNATURE_DATA_URL);
        updateFormData('signature', E2E_SIGNATURE_DATA_URL);
        updateFormData('signatureType', 'typed');
        updateFormData('signatureDate', new Date().toISOString());
    };

    // What still keeps Submit grey, in the order the page asks for it.
    const missingBeforeSubmit = [
        !allAgreementsAccepted && `acknowledge all ${agreements.length} agreements`,
        !isSigned && 'draw your signature in the box above',
        !isFinalCertified && 'tick “I Certify and Agree”',
        isUploading && 'wait for your files to finish uploading',
    ].filter(Boolean);

    return (
        <div id="page-9" className="form-step space-y-ds-6">
            <h2 className="text-ds-heading-sm font-semibold text-ds-content">Agreements &amp; Signature</h2>

            <p className="text-ds-sm text-ds-content-secondary">
                Each agreement is on its own page. Read it in full and acknowledge it there. Your signature at the
                end applies to all of them.
            </p>

            {agreementsLoading && (
                <div role="status" className="flex items-center gap-ds-2 py-ds-8 text-ds-content-muted">
                    <Icon icon={Loader2} size="xl" className="animate-spin" />
                    Loading the required agreements…
                </div>
            )}

            {/* There is nothing legitimate to sign if the agreements did not load,
                so this blocks submission rather than degrading quietly. */}
            {agreementsError && !agreementsLoading && (
                /* The other site that decided the action placement: the button
                   was already under the message. Radius normalises `lg` to the
                   contract's `md`. */
                <Notice announce="assertive" tone="danger" actions={<Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}>
                    {agreementsError} You cannot submit until they load, because you must be able to read what you are signing.
                </Notice>
            )}

            {ready && !onSignaturePage && (
                <AgreementDocumentPage
                    key={agreements[current].id}
                    agreement={agreements[current]}
                    position={current + 1}
                    total={agreements.length}
                    accepted={isAccepted(agreements[current])}
                    onAcceptedChange={(checked) => handleAgreementChange(agreements[current], checked)}
                    onBack={current === 0 ? () => onNavigate('back') : () => goToPage(current - 1)}
                    onNext={() => goToPage(current + 1)}
                    headingRef={pageHeadingRef}
                />
            )}

            {onSignaturePage && (
                <fieldset className="space-y-ds-4 rounded-ds-lg border border-ds-border bg-ds-surface p-ds-4 shadow-ds-xs">
                    <legend className="flex items-center gap-ds-2 px-ds-2 text-ds-body-lg font-semibold text-ds-content">
                        <Icon icon={FileSignature} size="xl" className="text-ds-action-primary" />
                        <span ref={pageHeadingRef} tabIndex={-1} className="focus-visible:shadow-ds-focus">Final Certification &amp; Signature</span>
                    </legend>

                    {/* Frozen legal text. Keyboard-focusable so a keyboard-only
                        applicant can scroll the certification they are about to sign.
                        The 391.21(b)(12) sentence is last, word for word: the rule
                        puts it "at the end of the application form", above the
                        signature. */}
                    <div
                        tabIndex={0}
                        role="group"
                        aria-label="Certification of applicant"
                        className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 italic focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                    >
                        <div className="space-y-ds-4 text-ds-sm leading-relaxed text-ds-content-secondary">
                            <p><strong className="text-ds-content">CERTIFICATION OF APPLICANT:</strong></p>
                            <p>I authorize you to make such investigations and inquiries of my personal, employment, financial or medical history and other related matters as may be necessary in arriving at an employment decision. (Generally, inquiries regarding medical history will be made only if and after a conditional offer of employment has been extended.) I hereby release employers, schools, health care providers and other persons from all liability in responding to inquiries and releasing information in connection with my application.</p>
                            <p>In the event of employment, I understand that false or misleading information given in my application or interview(s) may result in discharge. I understand, also, that I am required to abide by all rules and regulations of the Company.</p>
                            <p>I understand that information I provide regarding current and/or previous employers may be used, and those employer(s) will be contacted, for the purpose of investigating my safety performance history as required by 49 CFR 391.23(d) and (e). I understand that I have the right to:</p>
                            <ul className="list-disc space-y-ds-1 pl-ds-5">
                                <li>Review information provided by previous employers;</li>
                                <li>Have errors in the information corrected by previous employers and for those previous employers to re-send the corrected information to the prospective employer; and</li>
                                <li>Have a rebuttal statement attached to the alleged erroneous information, if the previous employer(s) and I cannot agree on the accuracy of the information.</li>
                            </ul>
                            <p>{CERTIFICATION_STATEMENT}</p>
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
                                    className="h-full w-full cursor-crosshair"
                                    style={{ touchAction: 'none' }}
                                ></canvas>
                                {!isSigned && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                        <span aria-hidden="true" className="text-ds-sm text-ds-content-muted">Draw your signature here</span>
                                    </div>
                                )}
                            </div>

                            {/* Mounted before it has anything to say, so a screen reader
                                hears the save the moment a stroke ends. */}
                            <p role="status" className="mt-ds-2 flex items-center gap-ds-1 text-ds-sm font-medium text-ds-status-success-fg">
                                {isSigned && <><Icon icon={CheckCircle} size="sm" /> Signature saved</>}
                            </p>

                            <div className="mt-ds-3 flex flex-col gap-ds-3 sm:flex-row">
                                <Button variant="secondary" size="lg" fullWidth onClick={handleClearSignature} disabled={!isSigned}>
                                    <Icon icon={Eraser} size="lg" /> Clear signature
                                </Button>
                                {isE2ETestMode && (
                                    <Button variant="secondary" size="lg" fullWidth onClick={handleUseE2ESignature}>
                                        Use Test Signature
                                    </Button>
                                )}
                            </div>
                        </div>

                        <div className="mt-ds-6 rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
                            <Checkbox
                                id="final-certification"
                                label="I Certify and Agree"
                                description={CERTIFICATION_STATEMENT}
                                checked={isFinalCertified}
                                onChange={handleFinalCertificationChange}
                            />
                        </div>

                        {/* Names what is still outstanding. The disabled submit button
                            alone leaves an applicant guessing which box they missed. */}
                        <p role="status" className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                            {missingBeforeSubmit.length > 0 && `To submit, ${sentenceList(missingBeforeSubmit)}.`}
                        </p>
                    </div>
                </fieldset>
            )}

            {/* The document pages carry their own Back and Next. Here, and while the
                set is loading or failed, the step's own row: a set that did not
                load leaves nothing legitimate to sign, so Submit stays disabled. */}
            {(onSignaturePage || !ready) && (
                <StepNavigation
                    onBack={onSignaturePage ? () => goToPage(agreements.length - 1) : () => onNavigate('back')}
                    onContinue={onFinalSubmit}
                    continueLabel={isSubmitting ? 'Submitting...' : 'Submit Full Application'}
                    continueIcon={isSubmitting ? null : <Icon icon={CheckCircle} size="xl" />}
                    continueTone="success"
                    continueLoading={isSubmitting}
                    continueDisabled={!onSignaturePage || !isFinalCertified || !isSigned || !allAgreementsAccepted || isUploading}
                />
            )}
        </div>
    );
};

export default Step9_Consent;
