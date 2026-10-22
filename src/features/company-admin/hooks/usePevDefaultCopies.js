import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * The company's saved verification copies, read when the send dialog opens.
 *
 * The signed-in company profile is loaded once per session, so a list saved in
 * Settings since would otherwise reach the dialog only after a reload. Until the
 * read answers — or if it fails — the profile's copy stands.
 *
 * @returns {{ copies: string[], loaded: boolean }}
 */
export function usePevDefaultCopies(companyId, fallback) {
    const [state, setState] = useState({ copies: Array.isArray(fallback) ? fallback : [], loaded: !companyId });

    useEffect(() => {
        if (!companyId) return undefined;
        let live = true;
        getDoc(doc(db, 'companies', companyId)).then(
            (snap) => {
                if (!live) return;
                const saved = snap.exists() ? snap.data()?.pevCcEmails : undefined;
                setState((prev) => ({ copies: Array.isArray(saved) ? saved : prev.copies, loaded: true }));
            },
            () => { if (live) setState((prev) => ({ ...prev, loaded: true })); },
        );
        return () => { live = false; };
    }, [companyId]);

    return state;
}
