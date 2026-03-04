/**
 * VerificationPortal.jsx
 * ======================
 * Public-facing page where previous employers respond to employment verification requests.
 * Accessed via /verify/:token — no login required (token-based access).
 *
 * FMCSA 49 CFR §391.23 compliant — collects all required data points.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import {
    Loader2, CheckCircle, AlertTriangle, Clock, ShieldCheck,
    Send, FileText, Phone, Mail, User, Briefcase, ChevronDown, Info
} from 'lucide-react';

// ============================================================
// SIGNATURE PAD COMPONENT (Inline — no external dependency)
// ============================================================
function SignaturePad({ onSignatureChange }) {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);

    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        canvas.width = parent.offsetWidth;
        canvas.height = 150;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#1a2332';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, []);

    useEffect(() => {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [resizeCanvas]);

    const getPosition = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        if (e.touches) {
            return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        }
        return { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    };

    const startDrawing = (e) => {
        e.preventDefault();
        setIsDrawing(true);
        const ctx = canvasRef.current.getContext('2d');
        const pos = getPosition(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e) => {
        e.preventDefault();
        if (!isDrawing) return;
        const ctx = canvasRef.current.getContext('2d');
        const pos = getPosition(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (!hasSignature) setHasSignature(true);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        if (hasSignature && canvasRef.current) {
            onSignatureChange(canvasRef.current.toDataURL('image/png'));
        }
    };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasSignature(false);
        onSignatureChange(null);
    };

    return (
        <div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg relative bg-white cursor-crosshair overflow-hidden"
                 style={{ touchAction: 'none' }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full"
                />
                {!hasSignature && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-gray-400 text-sm">Draw your signature here</span>
                    </div>
                )}
            </div>
            {hasSignature && (
                <button type="button" onClick={clearSignature}
                        className="mt-1 text-xs text-blue-600 hover:text-blue-800 underline">
                    Clear Signature
                </button>
            )}
        </div>
    );
}


// ============================================================
// MAIN VERIFICATION PORTAL COMPONENT
// ============================================================
export function VerificationPortal() {
    const { token } = useParams();

    // Page state
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [completed, setCompleted] = useState(false);
    const [alreadyCompleted, setAlreadyCompleted] = useState(false);
    const [expired, setExpired] = useState(false);

    // Verification data from backend
    const [verificationData, setVerificationData] = useState(null);

    // Form state
    const [formData, setFormData] = useState({
        // Section 1: Employment
        wasEmployed: null,
        confirmedStartDate: '',
        confirmedEndDate: '',
        positionHeld: '',
        reasonForLeaving: '',
        eligibleForRehire: null,
        // Section 2: Safety
        subjectToFmcsrs: null,
        subjectToDotTesting: null,
        hadDrugAlcoholViolations: null,
        violationDetails: '',
        completedReturnToDuty: '',
        hadAccidents: null,
        accidentDetails: '',
        // Section 3: Additional
        additionalComments: '',
        // Section 4: Respondent
        respondentName: '',
        respondentTitle: '',
        respondentPhone: '',
        respondentEmail: '',
        signatureData: null,
    });

    const [formErrors, setFormErrors] = useState({});

    // Load verification data on mount
    useEffect(() => {
        async function loadVerification() {
            try {
                const getVerification = httpsCallable(functions, 'getVerificationRequest');
                const result = await getVerification({ token });
                const data = result.data;

                if (data.status === 'completed') {
                    setAlreadyCompleted(true);
                } else {
                    setVerificationData(data);
                }
            } catch (err) {
                console.error('Load verification error:', err);
                if (err.code === 'functions/deadline-exceeded') {
                    setExpired(true);
                } else if (err.code === 'functions/not-found') {
                    setError('This verification link is invalid or has been removed.');
                } else {
                    setError(err.message || 'Failed to load verification request.');
                }
            } finally {
                setLoading(false);
            }
        }
        if (token) loadVerification();
        else { setError('No verification token provided.'); setLoading(false); }
    }, [token]);

    // Form field updater
    const updateField = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (formErrors[field]) {
            setFormErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
        }
    };

    // Validation
    const validate = () => {
        const errors = {};
        if (formData.wasEmployed === null) errors.wasEmployed = 'Required';
        if (formData.wasEmployed) {
            if (!formData.confirmedStartDate) errors.confirmedStartDate = 'Required';
            if (!formData.confirmedEndDate) errors.confirmedEndDate = 'Required';
            if (!formData.positionHeld) errors.positionHeld = 'Required';
            if (!formData.reasonForLeaving) errors.reasonForLeaving = 'Required';
            if (formData.subjectToFmcsrs === null) errors.subjectToFmcsrs = 'Required';
            if (formData.subjectToDotTesting === null) errors.subjectToDotTesting = 'Required';
            if (formData.subjectToDotTesting && formData.hadDrugAlcoholViolations === null) errors.hadDrugAlcoholViolations = 'Required';
            if (formData.hadAccidents === null) errors.hadAccidents = 'Required';
        }
        if (!formData.respondentName) errors.respondentName = 'Required';
        if (!formData.respondentTitle) errors.respondentTitle = 'Required';
        if (!formData.respondentPhone) errors.respondentPhone = 'Required';
        if (!formData.signatureData) errors.signatureData = 'Please provide your electronic signature';
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    // Submit handler
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        setSubmitting(true);
        try {
            const submitFn = httpsCallable(functions, 'submitVerificationResponse');
            await submitFn({ token, response: formData });
            setCompleted(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            console.error('Submit error:', err);
            setError(err.message || 'Failed to submit response. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    // Radio button helper
    const RadioGroup = ({ name, value, onChange, options, error: fieldError }) => (
        <div>
            <div className="flex flex-wrap gap-4 mt-1">
                {options.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                            ${value === opt.value ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-gray-400'}`}>
                            {value === opt.value && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <input type="radio" name={name} className="sr-only"
                               checked={value === opt.value}
                               onChange={() => onChange(opt.value)} />
                        <span className={`text-sm font-medium ${value === opt.value ? 'text-blue-900' : 'text-gray-700'}`}>
                            {opt.label}
                        </span>
                    </label>
                ))}
            </div>
            {fieldError && <p className="text-red-500 text-xs mt-1 font-medium">{fieldError}</p>}
        </div>
    );

    // ============================================================
    // RENDER: Loading
    // ============================================================
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Loading verification request...</p>
                </div>
            </div>
        );
    }

    // ============================================================
    // RENDER: Error
    // ============================================================
    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
                    <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Verification Error</h1>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        );
    }

    // ============================================================
    // RENDER: Expired
    // ============================================================
    if (expired) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
                    <Clock className="w-16 h-16 text-amber-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
                    <p className="text-gray-600">This verification request has expired. Please contact the requesting company for a new link.</p>
                </div>
            </div>
        );
    }

    // ============================================================
    // RENDER: Already Completed
    // ============================================================
    if (alreadyCompleted) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
                    <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Already Completed</h1>
                    <p className="text-gray-600">This verification has already been submitted. Thank you for your cooperation.</p>
                </div>
            </div>
        );
    }

    // ============================================================
    // RENDER: Success (after submit)
    // ============================================================
    if (completed) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-lg max-w-lg w-full p-8 text-center">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-12 h-12 text-emerald-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Verification Submitted Successfully</h1>
                    <p className="text-gray-600 mb-6">
                        Thank you for completing the employment verification for <strong>{verificationData?.applicantName}</strong>.
                        Your response has been securely recorded and the requesting company has been notified.
                    </p>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-left">
                        <p className="text-sm text-emerald-800 font-medium">
                            <ShieldCheck className="inline w-4 h-4 mr-1" />
                            A PDF record has been generated and added to the applicant's Qualification file.
                        </p>
                    </div>
                    <p className="text-xs text-gray-400 mt-6">Verification ID: {token}</p>
                </div>
            </div>
        );
    }

    // ============================================================
    // RENDER: Main Form
    // ============================================================
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-slate-900 text-white py-6 px-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <ShieldCheck className="w-6 h-6 text-blue-400" />
                    <h1 className="text-xl font-bold">Previous Employment Verification</h1>
                </div>
                <p className="text-blue-300 text-sm">FMCSA 49 CFR Part 391.23 Compliance</p>
            </div>

            {/* Form errors banner */}
            {Object.keys(formErrors).length > 0 && (
                <div className="max-w-3xl mx-auto mt-4 px-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-red-800 font-bold text-sm">Please fix the following errors:</p>
                            <ul className="text-red-700 text-xs mt-1 list-disc list-inside">
                                {Object.entries(formErrors).map(([key, msg]) => (
                                    <li key={key}>{key.replace(/([A-Z])/g, ' $1').trim()}: {msg}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-3xl mx-auto py-6 px-4">
                {/* Info Banner */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
                    <div className="bg-blue-50 border-l-4 border-blue-500 rounded p-4 mb-6">
                        <p className="text-sm text-blue-800 leading-relaxed">
                            Under <strong>FMCSA 49 CFR Part 391.23</strong>, prospective employers of commercial motor vehicle
                            drivers are required to investigate the driver's employment record for the preceding 3 years.
                            Your cooperation in providing this information is <strong>required by federal regulation</strong>.
                            Previous employers must respond within <strong>30 days</strong> of receiving this request.
                        </p>
                    </div>

                    <h2 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-200 pb-2">Applicant Details</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="text-gray-500 font-medium">Applicant Name:</span>
                            <span className="ml-2 font-bold text-gray-900">{verificationData?.applicantName}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 font-medium">Reported Dates:</span>
                            <span className="ml-2 text-gray-900">{verificationData?.employmentStartDate} to {verificationData?.employmentEndDate}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 font-medium">Requesting Company:</span>
                            <span className="ml-2 text-gray-900">{verificationData?.companyName}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 font-medium">Response Deadline:</span>
                            <span className="ml-2 font-bold text-red-600">{verificationData?.expiresAt ? new Date(verificationData.expiresAt).toLocaleDateString() : 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* Section 1: Employment Confirmation */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                            <Briefcase className="w-5 h-5 text-blue-600" />
                            Section 1: Employment Confirmation
                        </h2>
                        <p className="text-xs text-gray-500 mb-4">Confirm the applicant's employment details</p>

                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Was this individual employed by your company? <span className="text-red-500">*</span>
                                </label>
                                <RadioGroup
                                    name="wasEmployed"
                                    value={formData.wasEmployed}
                                    onChange={(v) => updateField('wasEmployed', v)}
                                    options={[
                                        { value: true, label: 'Yes' },
                                        { value: false, label: 'No / No Record Found' },
                                    ]}
                                    error={formErrors.wasEmployed}
                                />
                            </div>

                            {formData.wasEmployed && (
                                <div className="space-y-4 pl-2 border-l-2 border-blue-200 ml-2 animate-in slide-in-from-top-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                                                Confirmed Start Date <span className="text-red-500">*</span>
                                            </label>
                                            <input type="date" value={formData.confirmedStartDate}
                                                   onChange={(e) => updateField('confirmedStartDate', e.target.value)}
                                                   className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.confirmedStartDate ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                            {formErrors.confirmedStartDate && <p className="text-red-500 text-xs mt-1">{formErrors.confirmedStartDate}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                                                Confirmed End Date <span className="text-red-500">*</span>
                                            </label>
                                            <input type="date" value={formData.confirmedEndDate}
                                                   onChange={(e) => updateField('confirmedEndDate', e.target.value)}
                                                   className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.confirmedEndDate ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                            {formErrors.confirmedEndDate && <p className="text-red-500 text-xs mt-1">{formErrors.confirmedEndDate}</p>}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                                            Position / Title Held <span className="text-red-500">*</span>
                                        </label>
                                        <input type="text" value={formData.positionHeld}
                                               onChange={(e) => updateField('positionHeld', e.target.value)}
                                               placeholder="e.g., OTR Driver, Local Delivery Driver"
                                               className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.positionHeld ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                        {formErrors.positionHeld && <p className="text-red-500 text-xs mt-1">{formErrors.positionHeld}</p>}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                                            Reason for Leaving <span className="text-red-500">*</span>
                                        </label>
                                        <select value={formData.reasonForLeaving}
                                                onChange={(e) => updateField('reasonForLeaving', e.target.value)}
                                                className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.reasonForLeaving ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
                                            <option value="">Select...</option>
                                            <option value="Voluntary Resignation">Voluntary Resignation</option>
                                            <option value="Terminated">Terminated</option>
                                            <option value="Laid Off">Laid Off</option>
                                            <option value="Contract Ended">Contract Ended</option>
                                            <option value="Mutual Agreement">Mutual Agreement</option>
                                            <option value="Other">Other</option>
                                        </select>
                                        {formErrors.reasonForLeaving && <p className="text-red-500 text-xs mt-1">{formErrors.reasonForLeaving}</p>}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">Eligible for Rehire?</label>
                                        <RadioGroup
                                            name="eligibleForRehire"
                                            value={formData.eligibleForRehire}
                                            onChange={(v) => updateField('eligibleForRehire', v)}
                                            options={[
                                                { value: true, label: 'Yes' },
                                                { value: false, label: 'No' },
                                            ]}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section 2: Safety & Compliance (only shown if employed) */}
                    {formData.wasEmployed && (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 animate-in slide-in-from-top-2">
                            <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-blue-600" />
                                Section 2: Safety & Compliance
                                <span className="text-xs font-normal text-gray-500 ml-1">(FMCSA Required)</span>
                            </h2>
                            <p className="text-xs text-gray-500 mb-4">This information is required by federal regulation</p>

                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Was this driver subject to the Federal Motor Carrier Safety Regulations (FMCSRs)? <span className="text-red-500">*</span>
                                    </label>
                                    <p className="text-xs text-gray-500 mb-2">i.e., Did they operate a commercial motor vehicle (CMV) for your company?</p>
                                    <RadioGroup
                                        name="subjectToFmcsrs"
                                        value={formData.subjectToFmcsrs}
                                        onChange={(v) => updateField('subjectToFmcsrs', v)}
                                        options={[
                                            { value: true, label: 'Yes' },
                                            { value: false, label: 'No' },
                                        ]}
                                        error={formErrors.subjectToFmcsrs}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Was this driver subject to DOT drug & alcohol testing requirements? <span className="text-red-500">*</span>
                                    </label>
                                    <RadioGroup
                                        name="subjectToDotTesting"
                                        value={formData.subjectToDotTesting}
                                        onChange={(v) => updateField('subjectToDotTesting', v)}
                                        options={[
                                            { value: true, label: 'Yes' },
                                            { value: false, label: 'No' },
                                        ]}
                                        error={formErrors.subjectToDotTesting}
                                    />
                                </div>

                                {/* Drug/Alcohol Violations (conditional) */}
                                {formData.subjectToDotTesting && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4 animate-in slide-in-from-top-2">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                                                Did this driver have any DOT drug or alcohol violations? <span className="text-red-500">*</span>
                                            </label>
                                            <p className="text-xs text-gray-500 mb-2">Including positive tests, refusals, or other violations per 49 CFR Part 40</p>
                                            <RadioGroup
                                                name="hadDrugAlcoholViolations"
                                                value={formData.hadDrugAlcoholViolations}
                                                onChange={(v) => updateField('hadDrugAlcoholViolations', v)}
                                                options={[
                                                    { value: true, label: 'Yes' },
                                                    { value: false, label: 'No' },
                                                ]}
                                                error={formErrors.hadDrugAlcoholViolations}
                                            />
                                        </div>

                                        {formData.hadDrugAlcoholViolations && (
                                            <div className="space-y-4 animate-in slide-in-from-top-2">
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                                        Violation Details <span className="text-red-500">*</span>
                                                    </label>
                                                    <textarea value={formData.violationDetails}
                                                              onChange={(e) => updateField('violationDetails', e.target.value)}
                                                              placeholder="Describe the nature of the violation(s), date(s), substance(s) involved..."
                                                              rows={3}
                                                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                                        Did the driver complete the return-to-duty process per 49 CFR Part 40, Subpart O?
                                                    </label>
                                                    <RadioGroup
                                                        name="completedReturnToDuty"
                                                        value={formData.completedReturnToDuty}
                                                        onChange={(v) => updateField('completedReturnToDuty', v)}
                                                        options={[
                                                            { value: 'yes', label: 'Yes' },
                                                            { value: 'no', label: 'No' },
                                                            { value: 'in_progress', label: 'In Progress' },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Accident History */}
                                <div className="border-t border-gray-200 pt-4">
                                    <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">Accident History</h3>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">
                                            Were there any DOT-recordable accidents involving this driver in the last 3 years? <span className="text-red-500">*</span>
                                        </label>
                                        <p className="text-xs text-gray-500 mb-2">Per 49 CFR §390.5: accidents involving fatality, bodily injury requiring medical treatment away from the scene, or disabling damage to any vehicle requiring tow-away</p>
                                        <RadioGroup
                                            name="hadAccidents"
                                            value={formData.hadAccidents}
                                            onChange={(v) => updateField('hadAccidents', v)}
                                            options={[
                                                { value: true, label: 'Yes' },
                                                { value: false, label: 'No' },
                                            ]}
                                            error={formErrors.hadAccidents}
                                        />
                                    </div>

                                    {formData.hadAccidents && (
                                        <div className="mt-4 animate-in slide-in-from-top-2">
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">Accident Details</label>
                                            <textarea value={formData.accidentDetails}
                                                      onChange={(e) => updateField('accidentDetails', e.target.value)}
                                                      placeholder="For each accident, provide: Date, Location, Nature of accident, Fatalities (Y/N), Injuries (Y/N), Hazmat spill (Y/N)"
                                                      rows={3}
                                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Section 3: Additional Comments */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-600" />
                            Section 3: Additional Information
                        </h2>
                        <div className="mt-3">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Additional Comments (Optional)</label>
                            <textarea value={formData.additionalComments}
                                      onChange={(e) => updateField('additionalComments', e.target.value)}
                                      placeholder="Any additional information relevant to this driver's employment or performance..."
                                      rows={3}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y" />
                        </div>
                    </div>

                    {/* Section 4: Respondent Verification & Signature */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                            <User className="w-5 h-5 text-blue-600" />
                            Section 4: Respondent Verification & Signature
                        </h2>
                        <p className="text-xs text-gray-500 mb-4">Must be completed by an authorized representative of the previous employer</p>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Your Full Name <span className="text-red-500">*</span>
                                    </label>
                                    <input type="text" value={formData.respondentName}
                                           onChange={(e) => updateField('respondentName', e.target.value)}
                                           placeholder="e.g., John Smith"
                                           className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.respondentName ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                    {formErrors.respondentName && <p className="text-red-500 text-xs mt-1">{formErrors.respondentName}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Your Title / Position <span className="text-red-500">*</span>
                                    </label>
                                    <input type="text" value={formData.respondentTitle}
                                           onChange={(e) => updateField('respondentTitle', e.target.value)}
                                           placeholder="e.g., Safety Director, HR Manager"
                                           className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.respondentTitle ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                    {formErrors.respondentTitle && <p className="text-red-500 text-xs mt-1">{formErrors.respondentTitle}</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Phone Number <span className="text-red-500">*</span>
                                    </label>
                                    <input type="tel" value={formData.respondentPhone}
                                           onChange={(e) => updateField('respondentPhone', e.target.value)}
                                           placeholder="(555) 123-4567"
                                           className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${formErrors.respondentPhone ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                                    {formErrors.respondentPhone && <p className="text-red-500 text-xs mt-1">{formErrors.respondentPhone}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                                        Email Address
                                    </label>
                                    <input type="email" value={formData.respondentEmail}
                                           onChange={(e) => updateField('respondentEmail', e.target.value)}
                                           placeholder="you@company.com"
                                           className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Electronic Signature <span className="text-red-500">*</span>
                                </label>
                                <p className="text-xs text-gray-500 mb-2">Draw your signature below. By signing, you certify that the information provided is true and accurate.</p>
                                <SignaturePad onSignatureChange={(data) => updateField('signatureData', data)} />
                                {formErrors.signatureData && <p className="text-red-500 text-xs mt-1">{formErrors.signatureData}</p>}
                            </div>

                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <p className="text-xs text-gray-600 leading-relaxed">
                                    <strong>Certification:</strong> By submitting this form, I certify that I am authorized to provide this
                                    employment verification on behalf of the above-referenced company, and that the information provided
                                    herein is true, accurate, and complete to the best of my knowledge. I understand that providing false
                                    information may result in penalties under federal and state law.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-4 bg-slate-900 text-white font-bold text-lg rounded-xl hover:bg-slate-800 transition-all shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                Submit Verification Response
                            </>
                        )}
                    </button>
                </form>

                {/* Footer */}
                <div className="text-center py-6">
                    <p className="text-xs text-gray-400">
                        This request was generated by <strong>SafeHaul Compliance Services</strong>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                        Secure verification ID: {token}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default VerificationPortal;
