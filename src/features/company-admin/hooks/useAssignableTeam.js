import { useEffect, useMemo, useState } from 'react';
import { getCompanyProfile } from '@features/companies/services/companyService';
import { useCompanyTeam } from '@shared/hooks/useCompanyTeam';

const NO_TEAM = Object.freeze([]);

/** The team a bulk assignment offers: the company's team cache
 *  (companies/{id}.teamMembers, kept by functions/hrAdmin/membership.js),
 *  read fresh once when the screen opens so someone added since the company
 *  was entered is offered. One document read instead of the memberships and
 *  one profile per member, when the document carries the cache. If the read
 *  fails, the copy read on entering the company is used; with no cache in
 *  either, useCompanyTeam lists an admin's memberships (one profile read per
 *  member, in parallel). */
export function useAssignableTeam(companyId) {
    const [fresh, setFresh] = useState({ companyId: null, profile: null });
    useEffect(() => {
        if (!companyId) return undefined;
        let cancelled = false;
        // getCompanyProfile resolves null on any failure; it never rejects.
        getCompanyProfile(companyId).then((profile) => { if (!cancelled) setFresh({ companyId, profile }); });
        return () => { cancelled = true; };
    }, [companyId]);
    const settled = Boolean(companyId) && fresh.companyId === companyId;
    // Until the read lands, an empty team of this company stands in, so
    // useCompanyTeam does not start its memberships fallback for nothing.
    const pending = useMemo(() => ({ id: companyId, teamMembers: NO_TEAM }), [companyId]);
    const { team, isLoading } = useCompanyTeam(companyId, settled ? fresh.profile : pending);
    if (!companyId) return { team: NO_TEAM, isLoading: false };
    return { team: settled ? team : NO_TEAM, isLoading: !settled || isLoading };
}
