import { useCallback, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { normalizeLockedEmployers } from '@/config/applicationLockedFields';

/**
 * One carrier-prepared application, from the recruiter's side.
 *
 * Holds the identity that keys it, the answers, and the employers locked from the
 * driver's safety record; talks to the three callables that stage it. Deliberately
 * has no opinion about how any of it is displayed — the screen decides that, and
 * the AI panel (later) reaches the same `setFormData` a recruiter typing does.
 *
 * ## The identity is the key, and that is why changing it is a decision
 *
 * The draft's document id is `sha256(companyId:email:phone)`, the same key the
 * submitted application will take. Editing the email or phone therefore does not
 * edit this application — it addresses a different one. Before a link exists that
 * is harmless (nobody has been sent anywhere), so the change is silent; the screen
 * asks first once a link is out, because the old link keeps opening the old draft.
 */
export function useApplicationPrepDraft(companyId) {
    const [identity, setIdentity] = useState({ firstName: '', lastName: '', email: '', phone: '' });
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

    /** Everything the carrier typed, plus the identity fields the wizard also owns. */
    const payloadFormData = useMemo(() => ({
        ...formData,
        firstName: identity.firstName || formData.firstName || '',
        lastName: identity.lastName || formData.lastName || '',
        email: identity.email,
        phone: identity.phone,
        lockedEmployers,
    }), [formData, identity, lockedEmployers]);

    const save = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await call('saveCompanyPreparedApplication', {
                email: identity.email,
                phone: identity.phone,
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
    }, [call, identity.email, identity.phone, lockedEmployers, payloadFormData]);

    const load = useCallback(async (key) => {
        setBusy(true);
        setError(null);
        try {
            const result = await call('getCompanyPreparedDraft', { applicantKey: key });
            setApplicantKey(result.applicantKey);
            setStatus(result.status);
            setIdentity({
                firstName: result.firstName || '',
                lastName: result.lastName || '',
                email: result.email || '',
                phone: result.phone || '',
            });
            if (result.readable) {
                setFormData(result.formData || {});
                setLockedEmployers(result.lockedEmployers || []);
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
     * addresses it is derived from the identity. Keeping any of it across a switch
     * would file one driver's answers, documents and locks under another driver's
     * key — a save, not a display glitch. So the screen resets before it asks who
     * the next application is for.
     */
    const reset = useCallback(() => {
        setIdentity({ firstName: '', lastName: '', email: '', phone: '' });
        setFormData({});
        setLockedEmployers([]);
        setApplicantKey(null);
        setStatus('draft');
        setError(null);
    }, []);

    return {
        identity, setIdentity,
        formData, setFormData, updateField,
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
