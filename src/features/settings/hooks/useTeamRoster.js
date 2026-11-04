import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';

export const DEFAULT_GOALS = { callGoal: 150, contactGoal: 50 };
const LOAD_ERROR = "We couldn't load your team. Try again.";

function goalsOf(data) {
    return {
        // A goal saved as 0 is a goal of 0, not a missing one.
        callGoal: data?.callGoal ?? DEFAULT_GOALS.callGoal,
        contactGoal: data?.contactGoal ?? DEFAULT_GOALS.contactGoal,
    };
}

/** Every saved goal of the company, by user id. Never rejects: a failed read gives no goals. */
async function fetchGoals(companyId) {
    try {
        const snapshot = await getDocs(collection(db, 'companies', companyId, 'team'));
        return new Map(snapshot.docs.map((d) => [d.id, goalsOf(d.data())]));
    } catch (e) {
        console.warn('Error fetching goals:', e);
        return new Map();
    }
}

/**
 * The company's team, as `listCompanyTeam` resolves it (Admin SDK + Firebase
 * Auth fallback, so a member is never reduced to a placeholder because their
 * profile document is absent or unreadable), each with their daily goals from
 * `companies/{id}/team`, read in one request beside the roster (150 / 50 where
 * a member has none saved, or the read fails).
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
            const [{ data }, goals] = await Promise.all([
                httpsCallable(functions, 'listCompanyTeam')({ companyId }),
                fetchGoals(companyId),
            ]);
            const members = data?.members || [];
            if (!alive.current || request !== latestRequest.current) return;
            setState({
                members: members.map((member) => ({ ...member, ...(goals.get(member.id) || DEFAULT_GOALS) })),
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
