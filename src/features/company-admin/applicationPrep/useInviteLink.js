import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { describeError } from './useApplicationPrepDraft';

/**
 * A refused mint, in words about minting.
 *
 * `describeError` is shared with the prep-draft hook and answers
 * `resource-exhausted` with "Too many saves in a row", which is the wrong noun
 * here — nothing was being saved, and `mintApplicationInvite` has a rate limit of
 * its own. It only started mattering when `UnfinishedApplicationsPage` began
 * rendering this error at all (2026-09-09); before that the message went nowhere,
 * which was the defect. Everything else `describeError` says is right for both.
 */
function describeMintError(error) {
    if (error?.code === 'functions/resource-exhausted') {
        return 'Too many links created in a row. Wait a moment and try again.';
    }
    return describeError(error);
}

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
    /**
     * The clipboard refused.
     *
     * It used to be swallowed entirely: the label simply never changed to
     * "Copied", which reads as nothing having happened at all. The link is on
     * screen and selectable either way, so this is a lost convenience rather than
     * a lost link — but only if somebody says so.
     */
    const [copyFailed, setCopyFailed] = useState(false);

    const mint = useCallback(async (applicantKey) => {
        if (!applicantKey) return null;
        setBusy(true);
        setError(null);
        setCopied(false);
        setCopyFailed(false);
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
            setError(describeMintError(mintError));
            return null;
        } finally {
            setBusy(false);
        }
    }, [appSlug, companyId]);

    /**
     * Copy a URL that is not necessarily the one in state yet.
     *
     * The parameter is the whole point. `copy()` below reads `link`, which is
     * captured from the render it was created in — so a caller that mints and then
     * copies in one press holds a `copy` whose `link` is still `null`, and the
     * copy silently does nothing. That is exactly the shape of the
     * "refused clipboard used to be silent" defect this hook already records, one
     * step earlier in the sequence: nothing failed, so nothing was said.
     *
     * `mint` returns the URL for this reason; the row action on
     * `UnfinishedApplicationsPage` passes it straight here. Found by its own
     * contract test on 2026-09-09.
     */
    const copyUrl = useCallback(async (url) => {
        // Not a clipboard refusal — there was nothing to copy — so no message.
        if (!url) return false;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setCopyFailed(false);
            return true;
        } catch {
            // A browser that refuses the clipboard still shows the link on screen,
            // so this is a lost convenience rather than a lost link — and the panel
            // now says which, and points at the link.
            setCopied(false);
            setCopyFailed(true);
            return false;
        }
    }, []);

    /** The button beside a link that is already on screen. */
    const copy = useCallback(() => copyUrl(link?.url), [copyUrl, link]);

    const reset = useCallback(() => {
        setLink(null);
        setError(null);
        setCopied(false);
        setCopyFailed(false);
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

    return { link, linkFor, busy, error, copied, copyFailed, mint, copy, copyUrl, reset };
}

export default useInviteLink;
