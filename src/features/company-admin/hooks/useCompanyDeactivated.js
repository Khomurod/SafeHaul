import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { auth, db } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { isCompanyDeactivated } from '@/config/companyStatus';

/**
 * Is the open company deactivated? Its document is watched, so the workspace
 * closes the moment Super Admin → Companies turns the company off. The server
 * refuses its staff at once, and the rules within the hour their token lasts.
 * A super admin is never shut out, so is not watched.
 */
export function useCompanyDeactivated() {
    const { currentCompanyProfile, userRole } = useData();
    const companyId = currentCompanyProfile?.id || null;
    const watch = Boolean(companyId) && userRole !== 'super_admin';
    const [live, setLive] = useState({ companyId: null, deactivated: false });
    // A listener the rules refuse stops for good: the next token, which may
    // carry the company's role again, starts another.
    const [attempt, setAttempt] = useState(0);
    const [refusedKey, setRefusedKey] = useState(null);
    const key = `${companyId}:${attempt}`;
    const refused = watch && refusedKey === key;

    useEffect(() => {
        if (!watch) return undefined;
        return onSnapshot(
            doc(db, 'companies', companyId),
            (snap) => {
                // Offline, the cache answers that the document is missing. That
                // decides nothing, nor does a refused read: the profile already
                // loaded still does.
                if (snap.exists()) setLive({ companyId, deactivated: isCompanyDeactivated(snap.data()) });
            },
            () => setRefusedKey(key),
        );
    }, [companyId, watch, key]);

    useEffect(() => {
        if (!refused) return undefined;
        // The first call reports the token in hand; only a new one is worth a try.
        let first = true;
        return onIdTokenChanged(auth, () => {
            if (first) { first = false; return; }
            setAttempt((n) => n + 1);
        });
    }, [refused]);

    if (!watch) return false;
    return live.companyId === companyId ? live.deactivated : isCompanyDeactivated(currentCompanyProfile);
}
