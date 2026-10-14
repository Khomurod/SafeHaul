import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@lib/firebase';
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
            () => {},
        );
    }, [companyId, watch]);

    if (!watch) return false;
    return live.companyId === companyId ? live.deactivated : isCompanyDeactivated(currentCompanyProfile);
}
