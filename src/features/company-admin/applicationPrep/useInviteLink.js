import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { describeError } from './useApplicationPrepDraft';

/**
 * The link the carrier sends the driver.
 *
 * The raw token comes back from the callable exactly once and is never retrievable
 * again, so it lives in this hook's state for as long as the recruiter has the
 * screen open and nowhere else. Losing it costs a click on "Create a new link",
 * which is the right trade: a token that could be re-read would be a token stored
 * somewhere it could leak from.
 */
export function useInviteLink({ companyId, appSlug }) {
    const [link, setLink] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    const mint = useCallback(async (applicantKey) => {
        if (!applicantKey) return null;
        setBusy(true);
        setError(null);
        setCopied(false);
        try {
            const call = httpsCallable(functions, 'mintApplicationInvite');
            const { data } = await call({ companyId, applicantKey });
            const url = `${window.location.origin}/apply/${appSlug}`
                + `?invite=${encodeURIComponent(data.inviteToken)}&k=${encodeURIComponent(data.applicantKey)}`;
            setLink({ url, expiresInDays: data.expiresInDays });
            return url;
        } catch (mintError) {
            setError(describeError(mintError));
            return null;
        } finally {
            setBusy(false);
        }
    }, [appSlug, companyId]);

    const copy = useCallback(async () => {
        if (!link?.url) return false;
        try {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
            return true;
        } catch {
            // A browser that refuses the clipboard still shows the link on screen,
            // so this is a lost convenience rather than a lost link.
            setCopied(false);
            return false;
        }
    }, [link]);

    return { link, busy, error, copied, mint, copy };
}

export default useInviteLink;
