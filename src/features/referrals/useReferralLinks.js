import { useCallback, useEffect, useRef, useState } from 'react';
import {
    countReferrals,
    createReferralLink,
    deactivateReferralLink,
    listReferralLinks,
} from './referralLinksService';

/** Counts are read for this many links at most, newest first. */
const COUNTED_LINKS = 50;

/**
 * The referral links this person may see, with what each brought in. A count
 * that cannot be read shows as unknown rather than as zero.
 */
export function useReferralLinks({ companyId, uid, isAdmin }) {
    const [links, setLinks] = useState([]);
    const [counts, setCounts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // A late answer belongs to an earlier company or user.
    const version = useRef(0);

    const load = useCallback(async () => {
        if (!companyId || !uid) return;
        const mine = ++version.current;
        setLoading(true);
        setError(null);
        try {
            const next = await listReferralLinks({ companyId, uid, isAdmin });
            if (mine !== version.current) return;
            setLinks(next);
            setLoading(false);
            const entries = await Promise.all(next.slice(0, COUNTED_LINKS).map((link) => countReferrals({ companyId, code: link.code })
                .then((count) => [link.code, count], () => [link.code, null])));
            if (mine === version.current) setCounts(Object.fromEntries(entries));
        } catch (failure) {
            if (mine !== version.current) return;
            console.error('[useReferralLinks] load failed:', failure?.code || failure?.message);
            setError('We could not load the referral links.');
            setLoading(false);
        }
    }, [companyId, uid, isAdmin]);

    useEffect(() => { load(); }, [load]);

    const create = useCallback(async (fields) => {
        const code = await createReferralLink({ companyId, uid, ...fields });
        await load();
        return code;
    }, [companyId, uid, load]);

    const deactivate = useCallback(async (code) => {
        await deactivateReferralLink({ companyId, code });
        await load();
    }, [companyId, load]);

    return { links, counts, loading, error, reload: load, create, deactivate };
}
