import { useCallback, useEffect, useRef, useState } from 'react';
import { apiKeyErrorMessage, createApiKey, listApiKeys, revokeApiKey } from './apiKeysService';

/**
 * A company's API keys as Settings shows them: loaded once, reloaded after each
 * change, so the list is always the server's and never a guess.
 */
export function useCompanyApiKeys(companyId) {
    const [state, setState] = useState({ keys: [], maxActiveKeys: 5, loading: true, error: null });
    // A reply for a company the screen has since left is dropped.
    const current = useRef(companyId);
    current.current = companyId;

    const reload = useCallback(async () => {
        if (!companyId) return;
        setState((previous) => ({ ...previous, loading: true, error: null }));
        try {
            const result = await listApiKeys(companyId);
            if (current.current === companyId) setState({ ...result, loading: false, error: null });
        } catch (error) {
            if (current.current !== companyId) return;
            setState((previous) => ({
                ...previous,
                loading: false,
                error: apiKeyErrorMessage(error, 'We could not load your API keys. Try again.'),
            }));
        }
    }, [companyId]);

    useEffect(() => { reload(); }, [reload]);

    const create = useCallback(async ({ name, scopes }) => {
        const made = await createApiKey({ companyId, name, scopes });
        reload();
        return made;
    }, [companyId, reload]);

    const revoke = useCallback(async (keyId) => {
        await revokeApiKey({ companyId, keyId });
        await reload();
    }, [companyId, reload]);

    const activeCount = state.keys.filter((key) => !key.revokedAt).length;
    return { ...state, activeCount, reload, create, revoke };
}
