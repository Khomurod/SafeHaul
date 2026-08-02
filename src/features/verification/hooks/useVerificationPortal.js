/**
 * useVerificationPortal
 * =====================
 * Load / validate / submit state for the public PEV portal.
 * Extracted verbatim from VerificationPortal.jsx — token behavior,
 * validation rules, and submission payload are unchanged.
 */
import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

/**
 * E2E-only load scenarios, reachable as `?e2eVerify=<mode>` under
 * `VITE_E2E_TEST_MODE=1`.
 *
 * `mock` is the pre-existing fixture path and is **bit-for-bit unchanged**. The
 * others were added on 2026-07-27 so the expired, invalid, already-completed and
 * generic-failure screens can be reached — and axe-scanned — in a real browser.
 * They are additive: nothing about `mock`, and nothing about the real callable
 * path, changes.
 *
 * The failure modes deliberately *throw the same coded errors the callable
 * throws* rather than setting page state directly, so they run through the real
 * mapping in the `catch` below instead of bypassing it.
 */
const E2E_VERIFY_SCENARIOS = new Set(['mock', 'expired', 'invalid', 'completed', 'failure']);

export function useVerificationPortal(token) {
    const e2eVerifyMode = isE2ETestMode ? getE2EQueryParam('e2eVerify', '') : '';
    const isE2EVerifyMock = e2eVerifyMode === 'mock';
    const isE2EVerifyScenario = E2E_VERIFY_SCENARIOS.has(e2eVerifyMode);

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

    // Synchronous mirrors of `submitting` / `completed`. React state updates are
    // batched, so a second submit dispatched in the same tick would still see
    // the stale `false` — a ref is what actually closes the window.
    const submittingRef = useRef(false);
    const completedRef = useRef(false);

    // Load verification data on mount
    useEffect(() => {
        async function loadVerification() {
            try {
                if (isE2EVerifyScenario) {
                    if (isE2EVerifyMock) {
                        setVerificationData({
                            status: 'pending',
                            applicantName: 'E2E Driver',
                            employerName: 'E2E Previous Employer',
                            companyName: 'SafeHaul E2E Carrier',
                            employmentStartDate: '2021-01-01',
                            employmentEndDate: '2024-01-01',
                            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                        });
                        return;
                    }
                    if (e2eVerifyMode === 'completed') {
                        setAlreadyCompleted(true);
                        return;
                    }
                    // Thrown, not set: these run through the real error mapping.
                    const simulated = new Error('E2E simulated verification failure.');
                    if (e2eVerifyMode === 'expired') simulated.code = 'functions/deadline-exceeded';
                    if (e2eVerifyMode === 'invalid') simulated.code = 'functions/not-found';
                    throw simulated;
                }
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
    }, [token, isE2EVerifyMock, isE2EVerifyScenario, e2eVerifyMode]);

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

        // DEFECT FIX: the only duplicate-submit protection was the submit
        // Button's `loading` -> `disabled`. A disabled submit button does not
        // stop *implicit* submission, so pressing Enter in any text field while
        // the first request was still in flight fired a second
        // `submitVerificationResponse` for the same token. This re-entrancy
        // guard, and the completed guard below it, close that off at the source.
        if (submittingRef.current || completedRef.current) return;

        if (!validate()) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        try {
            if (isE2EVerifyMock) {
                completedRef.current = true;
                setCompleted(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            const submitFn = httpsCallable(functions, 'submitVerificationResponse');
            await submitFn({ token, response: formData });
            completedRef.current = true;
            setCompleted(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            console.error('Submit error:', err);
            setError(err.message || 'Failed to submit response. Please try again.');
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return {
        isE2EVerifyMock,
        loading,
        submitting,
        error,
        completed,
        alreadyCompleted,
        expired,
        verificationData,
        formData,
        formErrors,
        updateField,
        handleSubmit,
    };
}
