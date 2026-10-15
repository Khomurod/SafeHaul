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
import { serverMessageOf } from '@shared/utils/callableErrors';

/**
 * E2E-only load scenarios, reachable as `?e2eVerify=<mode>` under
 * `VITE_E2E_TEST_MODE=1`.
 *
 * `mock` is the fixture path and stays **bit-for-bit** as it is. The others let
 * the expired, invalid, already-completed and generic-failure screens be reached
 * — and axe-scanned — in a real browser. They are additive: nothing about `mock`,
 * and nothing about the real callable path, changes for them.
 *
 * The failure modes deliberately *throw the same coded errors the callable
 * throws* rather than setting page state directly, so they run through the real
 * mapping in the `catch` below instead of bypassing it.
 */
const E2E_VERIFY_SCENARIOS = new Set(['mock', 'expired', 'invalid', 'completed', 'failure']);

const INVALID_LINK = 'This verification link is invalid or has been removed.';
const KEPT = 'Your answers are still on this page';

/**
 * Where a failed submission leaves the respondent.
 *
 * Only a refusal no retry can change ends the visit, on the screen the same
 * refusal gets when the link is opened: the answer is already on file, the
 * link expired (the server says so in its own words), or the request is gone.
 * Anything else keeps the form and its answers. "deadline-exceeded" with no
 * words of the server's is the browser giving up after 70 seconds while the
 * server, allowed 120, may still record the answer; a retry then finds it on
 * file.
 */
function submitFailure(err) {
    const said = serverMessageOf(err);
    switch (err?.code) {
        case 'functions/already-exists':
            return { ends: 'alreadyCompleted' };
        case 'functions/not-found':
            return { ends: 'invalid' };
        case 'functions/deadline-exceeded':
            return said
                ? { ends: 'expired' }
                : { message: `We did not hear back in time, so your response may not have arrived. ${KEPT}: try again, and if it did arrive, this page will say so.` };
        case 'functions/invalid-argument':
        case 'functions/resource-exhausted':
            if (said) return { message: `Your response was not sent: ${said} ${KEPT}.` };
            break;
        default:
            break;
    }
    return { message: `Your response was not sent. ${KEPT}: check your connection and try again.` };
}

export function useVerificationPortal(token) {
    const e2eVerifyMode = isE2ETestMode ? getE2EQueryParam('e2eVerify', '') : '';
    const isE2EVerifyMock = e2eVerifyMode === 'mock';
    const isE2EVerifyScenario = E2E_VERIFY_SCENARIOS.has(e2eVerifyMode);

    // Page state
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    // Why the last submission was not taken, shown on the form it leaves in place.
    const [submitError, setSubmitError] = useState(null);
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
        // 'drawn' | 'typed' | null — recorded with the response so the PDF and the
        // audit trail say how the mark was made.
        signatureMethod: null,
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
                    setError(INVALID_LINK);
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

    /** `{ data, method }` from SignatureInput, or null when nothing is signed. Both fields move together. */
    const updateSignature = (signature) => {
        updateField('signatureData', signature?.data ?? null);
        updateField('signatureMethod', signature?.method ?? null);
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
        setSubmitError(null);
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
            const failure = submitFailure(err);
            if (failure.ends === 'alreadyCompleted') {
                completedRef.current = true;
                setAlreadyCompleted(true);
            } else if (failure.ends === 'expired') {
                setExpired(true);
            } else if (failure.ends === 'invalid') {
                setError(INVALID_LINK);
            } else {
                setSubmitError(failure.message);
            }
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
        submitError,
        completed,
        alreadyCompleted,
        expired,
        verificationData,
        formData,
        formErrors,
        updateField,
        updateSignature,
        handleSubmit,
    };
}
