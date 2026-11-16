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
 * its own, and `UnfinishedApplicationsPage` shows this message to the carrier.
 * Everything else `describeError` says is right for both.
 */
function describeMintError(error) {
    // A refused email names its reason (`functions/shared/linkDelivery.js`), and
    // the server's sentence is the one that says what to do.
    if (error?.details?.reason) return error.message;
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
 *
 * `emailLink` asks the server to email the link to the application's own address
 * instead: this browser never holds it, and learns only the address, masked
 * (`delivered`). Either way the newest link is the live one, so each clears the
 * other.
 */
export function useInviteLink({ companyId, appSlug }) {
    const [link, setLink] = useState(null);
    const [delivered, setDelivered] = useState(null);
    const [busy, setBusy] = useState(false);
    const [emailing, setEmailing] = useState(false);
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
            // The emailed link, if there was one, is the one this replaced.
            setDelivered(null);
            return url;
        } catch (mintError) {
            setError(describeMintError(mintError));
            return null;
        } finally {
            setBusy(false);
        }
    }, [appSlug, companyId]);

    /**
     * Have the server email the link to the application's own address.
     *
     * Resolves to `{ applicantKey, to, expiresInDays }`, `to` masked, or null when
     * nothing was sent. A refusal minted nothing, so the link the driver has still
     * works; a send that failed (`email-failed`) had minted one nobody received,
     * which retired the link before it, so that one comes off the screen too.
     * `appBaseUrl` says which site the driver should open; the server keeps it
     * only when it is one of the app's own.
     */
    const emailLink = useCallback(async (applicantKey) => {
        if (!applicantKey) return null;
        setEmailing(true);
        setError(null);
        setCopied(false);
        setCopyFailed(false);
        try {
            const call = httpsCallable(functions, 'mintApplicationInvite');
            const { data } = await call({
                companyId, applicantKey, deliver: 'email', appBaseUrl: window.location.origin,
            });
            const sent = { applicantKey: data.applicantKey, to: data.delivered?.to, expiresInDays: data.expiresInDays };
            // A link on screen was replaced by the one emailed: Copy would copy a retired link.
            setLink(null);
            setDelivered(sent);
            return sent;
        } catch (emailError) {
            if (emailError?.details?.reason === 'email-failed') {
                setLink(null);
                setDelivered(null);
            }
            setError(describeMintError(emailError));
            return null;
        } finally {
            setEmailing(false);
        }
    }, [companyId]);

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
     * `UnfinishedApplicationsPage` passes it straight here.
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

    /** Where this applicant's link was emailed, by the same rule as `linkFor`. */
    const deliveredFor = useCallback(
        (applicantKey) => (applicantKey && delivered?.applicantKey === applicantKey ? delivered : null),
        [delivered],
    );

    return {
        link, linkFor, delivered, deliveredFor, busy, emailing, error, copied, copyFailed,
        mint, emailLink, copy, copyUrl,
    };
}

export default useInviteLink;
