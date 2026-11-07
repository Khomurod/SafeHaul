import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { auth, db } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { isCompanyDeactivated } from '@/config/companyStatus';

/** The switches a super admin sets on a company: its features and their scheduled switch-offs. */
const switchesOf = (company) => ({ features: company?.features, featureSchedules: company?.featureSchedules });

const sameMap = (a, b) => {
    const left = a ?? {};
    const right = b ?? {};
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
};

const sameSwitches = (a, b) => sameMap(a.features, b.features) && sameMap(a.featureSchedules, b.featureSchedules);

/**
 * Watches the open company's document, so the workspace follows it without a
 * reload. A feature a super admin switches on or off (or schedules off) reaches
 * the company in use at once, and so every screen that reads it; nothing else
 * in the company changes, and when the switches are as they were, nothing does.
 * Returns whether the company is deactivated: the workspace closes the moment
 * Super Admin → Companies turns the company off. The server refuses its staff
 * at once, and the rules within the hour their token lasts. A super admin is
 * never shut out, though their workspace follows the switches too.
 */
export function useLiveCompany() {
    const { currentCompanyProfile, userRole, applyCompanyChanges } = useData();
    const companyId = currentCompanyProfile?.id || null;
    const [live, setLive] = useState({ companyId: null, deactivated: false });
    // A listener the rules refuse stops for good: the next token, which may
    // carry the company's role again, starts another.
    const [attempt, setAttempt] = useState(0);
    const [refusedKey, setRefusedKey] = useState(null);
    const key = `${companyId}:${attempt}`;
    const refused = Boolean(companyId) && refusedKey === key;
    // The company as last rendered, which a snapshot's switches are measured against.
    const profileRef = useRef(currentCompanyProfile);
    useEffect(() => { profileRef.current = currentCompanyProfile; }, [currentCompanyProfile]);

    useEffect(() => {
        if (!companyId) return undefined;
        // The switches of this listener's last answer. Two answers can arrive before
        // the company in use takes the first, so each is also measured against the
        // one before it: a switch turned off and back on reaches the workspace both times.
        let last = null;
        return onSnapshot(
            doc(db, 'companies', companyId),
            (snap) => {
                // Offline, the cache answers that the document is missing. That
                // decides nothing, nor does a refused read: the profile already
                // loaded still does.
                if (!snap.exists()) return;
                const data = snap.data();
                setLive({ companyId, deactivated: isCompanyDeactivated(data) });
                const switches = switchesOf(data);
                const moved = last !== null && !sameSwitches(switches, last);
                last = switches;
                if (moved || !sameSwitches(switches, switchesOf(profileRef.current))) applyCompanyChanges(companyId, switches);
            },
            () => setRefusedKey(key),
        );
    }, [companyId, key, applyCompanyChanges]);

    useEffect(() => {
        if (!refused) return undefined;
        // The first call reports the token in hand; only a new one is worth a try.
        let first = true;
        return onIdTokenChanged(auth, () => {
            if (first) { first = false; return; }
            setAttempt((n) => n + 1);
        });
    }, [refused]);

    if (!companyId || userRole === 'super_admin') return false;
    return live.companyId === companyId ? live.deactivated : isCompanyDeactivated(currentCompanyProfile);
}
