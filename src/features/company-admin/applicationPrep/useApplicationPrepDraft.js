import { useCallback, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { normalizeLockedEmployers } from '@/config/applicationLockedFields';

/**
 * One carrier-prepared application, from the recruiter's side.
 *
 * Holds the answers and the employers locked from the driver's safety record;
 * talks to the callables that stage it. Deliberately has no opinion about how any
 * of it is displayed — the screen decides that, and the AI reader reaches the same
 * `setFormData` a recruiter typing does.
 *
 * ## `formData` is the single source of truth, identity included
 *
 * The driver's name, email and phone are ordinary fields of `formData` (the
 * `personalInfo` schema section edits them), not a state of their own. That is
 * what lets the AI reader prefill the name and the recruiter type the email in
 * the very same editor without two copies of "who is this" drifting apart.
 *
 * ## The email and phone are the key, and that is why changing them is a decision
 *
 * The draft's document id is `sha256(companyId:email:phone)`, the same key the
 * submitted application will take. Editing the email or phone therefore does not
 * edit this application — it addresses a different one. A save recomputes the key
 * from whatever `formData` holds, so correcting a typo before a link is out simply
 * stages the application under the right key.
 */
export function useApplicationPrepDraft(companyId) {
    const [formData, setFormData] = useState({});
    const [lockedEmployers, setLockedEmployers] = useState([]);
    const [applicantKey, setApplicantKey] = useState(null);
    const [status, setStatus] = useState('draft');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const call = useCallback(
        (name, payload) => httpsCallable(functions, name)({ companyId, ...payload }).then((r) => r.data),
        [companyId],
    );

    const updateField = useCallback((key, value) => {
        setFormData((previous) => ({
            ...previous,
            [key]: typeof value === 'function' ? value(previous[key]) : value,
        }));
    }, []);

    /** The email and phone that key the draft, read straight off the answers. */
    const contactEmail = typeof formData.email === 'string' ? formData.email.trim() : '';
    const contactPhone = typeof formData.phone === 'string' ? formData.phone.trim() : '';
    /** True once there is enough to key the draft — the Save gate. */
    const identityComplete = Boolean(contactEmail || contactPhone);

    /** The answers, plus the lock list the server records beside them. */
    const payloadFormData = useMemo(
        () => ({ ...formData, lockedEmployers }),
        [formData, lockedEmployers],
    );

    const save = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await call('saveCompanyPreparedApplication', {
                email: contactEmail,
                phone: contactPhone,
                formData: payloadFormData,
                lockedEmployers,
            });
            setApplicantKey(result.applicantKey);
            setLockedEmployers(result.lockedEmployers || []);
            setStatus((previous) => (previous === 'draft' ? 'prepared' : previous));
            return result;
        } catch (saveError) {
            setError(describeError(saveError));
            return null;
        } finally {
            setBusy(false);
        }
    }, [call, contactEmail, contactPhone, lockedEmployers, payloadFormData]);

    const load = useCallback(async (key) => {
        setBusy(true);
        setError(null);
        try {
            const result = await call('getCompanyPreparedDraft', { applicantKey: key });
            setApplicantKey(result.applicantKey);
            setStatus(result.status);
            if (result.readable) {
                setFormData(result.formData || {});
                setLockedEmployers(result.lockedEmployers || []);
            } else {
                // The driver has taken it over, so the answers are theirs — but the
                // contact and name still identify the row, and the screen shows a
                // read-only notice in place of the editor. Keeping just those keeps
                // the header meaningful without pretending we hold the answers.
                setFormData({
                    firstName: result.firstName || '',
                    lastName: result.lastName || '',
                    email: result.email || '',
                    phone: result.phone || '',
                });
                setLockedEmployers([]);
            }
            return result;
        } catch (loadError) {
            setError(describeError(loadError));
            return null;
        } finally {
            setBusy(false);
        }
    }, [call]);

    /**
     * Lock the identity of an employer row.
     *
     * Additive and idempotent: `normalizeLockedEmployers` drops a row it already
     * holds and one it cannot identify, so locking the same carrier twice is not
     * two locks and locking a blank row is not a lock nothing can satisfy.
     */
    const lockEmployers = useCallback((rows) => {
        // A carrier from a PSP report names itself `name`; an employer row calls
        // the same thing `companyName`. Accepting both here means the reader and
        // the row's own Lock button reach one list without a translation step at
        // either call site.
        const asRows = (rows || []).map((row) => ({
            companyName: row?.companyName || row?.name || '',
            dotNumber: row?.dotNumber || '',
        }));
        setLockedEmployers((previous) => normalizeLockedEmployers([...previous, ...asRows]));
    }, []);

    const unlockEmployer = useCallback((signature) => {
        setLockedEmployers((previous) => previous.filter((entry) => entry.signature !== signature));
    }, []);

    /**
     * Back to holding nothing, for starting a different driver's application.
     *
     * Every piece of this hook's state belongs to one applicant, and the key that
     * addresses it is derived from the email and phone in `formData`. Keeping any
     * of it across a switch would file one driver's answers, documents and locks
     * under another driver's key — a save, not a display glitch. So the screen
     * resets before it starts the next one.
     */
    const reset = useCallback(() => {
        setFormData({});
        setLockedEmployers([]);
        setApplicantKey(null);
        setStatus('draft');
        setError(null);
    }, []);

    return {
        formData, setFormData, updateField,
        contactEmail, contactPhone, identityComplete,
        lockedEmployers, lockEmployers, unlockEmployer,
        applicantKey, status, busy, error,
        save, load, reset,
    };
}

/** A callable failure the recruiter can act on, rather than a code. */
export function describeError(error) {
    switch (error?.code) {
        case 'functions/already-exists':
        case 'functions/failed-precondition':
            // The server's message is the useful part here: it names what the driver
            // has already done and what to do instead.
            return error.message;
        case 'functions/permission-denied':
            return 'You do not have access to this company.';
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/resource-exhausted':
            return 'Too many saves in a row. Wait a moment and try again.';
        case 'functions/not-found':
            return 'That application could not be found.';
        default:
            return error?.message || 'Something went wrong. Please try again.';
    }
}

export default useApplicationPrepDraft;
