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
            // Stamped with whose application it opens. The link is a bearer
            // credential for exactly one applicant, so a screen that shows it must
            // be able to prove it belongs to the applicant on screen — see
            // `linkFor`. Showing one driver's link under another driver's name is
            // one Copy away from sending a stranger their application.
            setLink({ url, expiresInDays: data.expiresInDays, applicantKey: data.applicantKey });
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

    const reset = useCallback(() => {
        setLink(null);
        setError(null);
        setCopied(false);
    }, []);

    /**
     * The link, but only if it opens this applicant's application.
     *
     * Structural rather than a matter of remembering to reset: the hook does not
     * watch which draft the screen has loaded, so switching applications used to
     * leave the previous driver's URL on screen with the primary Copy button
     * beside it. A caller that asks for "the link for this key" cannot show the
     * wrong one, whether or not anything was reset.
     */
    const linkFor = useCallback(
        (applicantKey) => (applicantKey && link?.applicantKey === applicantKey ? link : null),
        [link],
    );

    return { link, linkFor, busy, error, copied, mint, copy, reset };
}

export default useInviteLink;
