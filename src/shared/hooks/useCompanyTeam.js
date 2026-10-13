import { useEffect, useMemo, useState } from 'react';
import { db } from '@lib/firebase';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';

const memberName = (name, email) => (name && name !== 'Unknown' ? name : email || 'Unknown');

/**
 * The company's team for its pickers and filters: `{ id, name, email, role }`
 * per member, `id` being the uid that `assignedTo` stores.
 *
 * The company document carries the team (`teamMembers`, which
 * `functions/hrAdmin/membership.js` rewrites on every membership change, keyed
 * by `userId`), and the whole team may read it. A company whose document has no
 * team yet is listed from its `memberships`, which only an admin may read: a
 * recruiter's browser is not sent a query the rules refuse it, and gets an
 * empty team instead.
 *
 * The signed-in profile is read when the user enters the company; a caller
 * holding a fresher read of the same company (the dossier reads it on opening)
 * passes it as `companyProfile`, so a member who joined since is listed.
 */
export function useCompanyTeam(companyId, companyProfile) {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const profile = [companyProfile, currentCompanyProfile].find((p) => p?.id === companyId);
    const cached = profile?.teamMembers;
    // The memberships are readable by an admin of this company or a super admin.
    const mayListMemberships = isCompanyAdminForRoute(currentUserClaims, companyId);

    const cachedTeam = useMemo(() => (Array.isArray(cached)
        ? cached
            .filter((m) => m && (m.userId || m.id))
            .map((m) => ({ id: m.userId || m.id, name: memberName(m.name, m.email), email: m.email || '', role: m.role }))
        : null), [cached]);

    const [fetched, setFetched] = useState({ companyId: null, team: [], error: null });
    const needsMemberships = Boolean(companyId) && !cachedTeam && mayListMemberships;

    useEffect(() => {
        if (!needsMemberships) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const snapshot = await getDocs(query(collection(db, 'memberships'), where('companyId', '==', companyId)));
                const team = await Promise.all(snapshot.docs.map(async (memDoc) => {
                    const { userId, role } = memDoc.data();
                    let name = '';
                    let email = '';
                    try {
                        const userDoc = await getDoc(doc(db, 'users', userId));
                        if (userDoc.exists()) {
                            const d = userDoc.data();
                            name = d.fullName || d.name || d.displayName || (d.firstName && d.lastName ? `${d.firstName} ${d.lastName}` : '');
                            email = d.email || '';
                        }
                    } catch (e) {
                        console.warn(`Error fetching user profile for ${userId}:`, e);
                    }
                    return { id: userId, name: memberName(name, email), email, role };
                }));
                if (!cancelled) setFetched({ companyId, team, error: null });
            } catch (err) {
                console.error('Error loading the team:', err);
                if (!cancelled) setFetched({ companyId, team: [], error: err.message });
            }
        })();
        return () => { cancelled = true; };
    }, [companyId, needsMemberships]);

    if (cachedTeam) return { team: cachedTeam, isLoading: false, error: null };
    if (!needsMemberships) return { team: [], isLoading: false, error: null };
    const settled = fetched.companyId === companyId;
    return { team: settled ? fetched.team : [], isLoading: !settled, error: settled ? fetched.error : null };
}
