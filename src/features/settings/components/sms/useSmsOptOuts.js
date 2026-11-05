import { useCallback, useEffect, useRef, useState } from 'react';
import { addSmsOptOut, listSmsOptOuts, optOutErrorMessage, removeSmsOptOut } from './smsOptOutService';

/**
 * A company's opted-out numbers as Settings shows them: loaded once, reloaded
 * after each change, so the list is always the server's and never a guess.
 */
export function useSmsOptOuts(companyId) {
    const [state, setState] = useState({ entries: [], total: 0, hasMore: false, loading: true, error: null });
    // A reply for a company the screen has since left is dropped.
    const current = useRef(companyId);
    current.current = companyId;
    // Only the newest request may write the list: an older answer arriving later is dropped.
    const latest = useRef(0);

    const reload = useCallback(async () => {
        if (!companyId) return;
        const request = ++latest.current;
        const stale = () => request !== latest.current || current.current !== companyId;
        setState((previous) => ({ ...previous, loading: true, error: null }));
        try {
            const result = await listSmsOptOuts(companyId);
            if (!stale()) setState({ ...result, loading: false, error: null });
        } catch (error) {
            if (stale()) return;
            setState((previous) => ({
                ...previous,
                loading: false,
                error: optOutErrorMessage(error, 'We could not load the opted-out numbers. Try again.'),
            }));
        }
    }, [companyId]);

    useEffect(() => { reload(); }, [reload]);

    const add = useCallback(async ({ phone, reason }) => {
        const result = await addSmsOptOut({ companyId, phone, reason });
        reload();
        return result;
    }, [companyId, reload]);

    const remove = useCallback(async (phone) => {
        await removeSmsOptOut({ companyId, phone });
        await reload();
    }, [companyId, reload]);

    return { ...state, reload, add, remove };
}
