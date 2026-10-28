import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';

export const DEFAULT_GOALS = { callGoal: 150, contactGoal: 50 };
const LOAD_ERROR = "We couldn't load your team. Try again.";

async function fetchGoals(companyId, userId) {
    try {
        const settingsSnap = await getDoc(doc(db, 'companies', companyId, 'team', userId));
        if (!settingsSnap.exists()) return DEFAULT_GOALS;
        const data = settingsSnap.data();
        return {
            callGoal: data.callGoal || DEFAULT_GOALS.callGoal,
            contactGoal: data.contactGoal || DEFAULT_GOALS.contactGoal,
        };
    } catch (e) {
        console.warn('Error fetching goals:', e);
        return DEFAULT_GOALS;
    }
}

/**
 * The company's team, as `listCompanyTeam` resolves it (Admin SDK + Firebase
 * Auth fallback, so a member is never reduced to a placeholder because their
 * profile document is absent or unreadable), each with their daily goals from
 * `companies/{id}/team/{uid}`.
 *
 * It loads at once and again on every change to the company's `memberships`.
 * The listener is only the change signal: if it is denied the roster still
 * loads, it just stops following changes, and only a failed `listCompanyTeam`
 * shows an error. When answers overlap, only the newest may write.
 *
 * Returns `{ members, invalidMemberships, loading, error, reload, updateMember }`.
 */
export function useTeamRoster(companyId) {
    const [state, setState] = useState({ members: [], invalidMemberships: [], loading: true, error: null });
    const latestRequest = useRef(0);
    const alive = useRef(true);

    const reload = useCallback(async () => {
        if (!companyId) return;
        const request = ++latestRequest.current;
        try {
            const { data } = await httpsCallable(functions, 'listCompanyTeam')({ companyId });
            const members = data?.members || [];
            const goals = await Promise.all(members.map((m) => fetchGoals(companyId, m.id)));
            if (!alive.current || request !== latestRequest.current) return;
            setState({
                members: members.map((member, i) => ({ ...member, ...goals[i] })),
                invalidMemberships: data?.invalidMemberships || [],
                loading: false,
                error: null,
            });
        } catch (e) {
            if (!alive.current || request !== latestRequest.current) return;
            console.error('Error loading team:', e);
            setState((prev) => ({ ...prev, loading: false, error: LOAD_ERROR }));
        }
    }, [companyId]);

    useEffect(() => {
        alive.current = true;
        if (!companyId) return undefined;
        reload();
        // The first answer only repeats what the load above is fetching.
        let first = true;
        const unsubscribe = onSnapshot(
            query(collection(db, 'memberships'), where('companyId', '==', companyId)),
            () => {
                if (first) { first = false; return; }
                reload();
            },
            (err) => console.error('Error watching memberships:', err),
        );
        return () => {
            alive.current = false;
            unsubscribe();
        };
    }, [companyId, reload]);

    /** Applies a saved change (such as new goals) to one member without reloading. */
    const updateMember = useCallback((id, patch) => {
        setState((prev) => ({ ...prev, members: prev.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    }, []);

    return { ...state, reload, updateMember };
}
