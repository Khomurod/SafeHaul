import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { forgetPortalUser } from '@features/auth/services/userService';
import { Icon, Loader2, Copy, CheckCircle } from '@design-system/icons';
import { Button, FormSection } from '@/design-system/components';
import { useToast } from '@shared/components/feedback';
import { recruiterCodeFor } from '../../utils/recruiterLinkCode';

/**
 * The signed-in member's personal application link, on their Profile page:
 * drivers who apply through it are assigned to them. Every staff member has
 * one; the rules let a member create their own (`recruiter_links`).
 *
 * The link carries a short code (`?r=`) made for this company
 * (`recruiterCodeFor`). When the saved code was made for another company, the
 * page offers `?recruiter=<uid>`, which the server checks against this
 * company's team.
 *
 * A stacked section (`id="personal-recruiting-link"`): the heading and what the
 * link does above a card that holds only the link and Copy. The link is shown
 * whole, never cut: it wraps inside its box, after a "/", before the "?" or
 * after the "=", and its query ("?recruiter=", the code or id) stays whole on
 * its line (`withBreaks`).
 */
export function PersonalLinkCard({ currentUser, currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [recruitingCode, setRecruitingCode] = useState(null);
    const [linkLoading, setLinkLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    // The driver app's address when one is configured, else this one.
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    const companyId = currentCompanyProfile?.id;
    const uid = currentUser?.uid;

    useEffect(() => {
        // A company switch while the page is open asks again: a code made for
        // the previous company would not assign anyone here.
        let current = true;
        setRecruitingCode(null);
        setLinkLoading(true);
        const fetchCode = async () => {
            if (!uid) {
                setLinkLoading(false);
                return;
            }
            try {
                const userDoc = await getDoc(doc(db, "users", uid));
                if (!current || !userDoc.exists()) return;
                const savedCode = userDoc.data().recruitingCode;
                const code = companyId ? await recruiterCodeFor(uid, companyId, savedCode) : null;
                // A new code is on the profile now: its next reader reads it again.
                if (code && code !== savedCode) forgetPortalUser(uid);
                if (current) setRecruitingCode(code);
            } catch (err) {
                console.error("Error generating link:", err);
                if (current) showError("Could not generate your personal link.");
            } finally {
                if (current) setLinkLoading(false);
            }
        };
        fetchCode();
        return () => { current = false; };
    }, [uid, companyId, showError]);

    // The link is the company's own apply page: without its address there is
    // none to share (no stand-in address, which could open another page).
    const companySlug = String(currentCompanyProfile?.appSlug || '').trim();
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    // Without a signed-in user there is no one to assign, so there is no link.
    let uniqueLink = null;
    if (companySlug && recruitingCode) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?r=${recruitingCode}`;
    else if (companySlug && uid) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?recruiter=${uid}`;

    const handleCopyLink = async () => {
        if (!uniqueLink) return;
        try {
            await navigator.clipboard.writeText(uniqueLink);
        } catch {
            showError("Could not copy the link. Select it and copy it yourself.");
            return;
        }
        setCopied(true);
        showSuccess("Personal link copied!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <FormSection
            layout="stacked"
            id="personal-recruiting-link"
            title="Your personal link"
            description={(
                <>Share this link. Drivers who apply will be <strong className="font-semibold text-ds-content">automatically assigned to you</strong>.</>
            )}
        >
            {linkLoading ? (
                <div
                    className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary"
                    role="status"
                >
                    <Icon icon={Loader2} className="animate-spin" />
                    Generating unique code...
                </div>
            ) : !uniqueLink ? (
                <p className="text-ds-sm text-ds-content-secondary">
                    {uid && !companySlug
                        ? "Your company's application page has no address yet, so there is no link to share. SafeHaul support can set one."
                        : 'Sign in again to see your link.'}
                </p>
            ) : (
                <div className="flex min-w-0 flex-col gap-ds-2 md:flex-row md:items-start md:gap-ds-3">
                    <div className="flex min-h-ds-control min-w-0 flex-1 items-center rounded-ds-md border border-ds-border bg-ds-surface px-ds-3 py-ds-2">
                        <code className="min-w-0 break-words font-mono text-ds-body text-ds-content">
                            {withBreaks(uniqueLink)}
                        </code>
                    </div>

                    <Button
                        variant="primary"
                        onClick={handleCopyLink}
                        aria-live="polite"
                    >
                        {copied
                            ? <Icon icon={CheckCircle} />
                            : <Icon icon={Copy} />}
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </div>
            )}
        </FormSection>
    );
}

/*
 * The longest query piece kept on one line: what the narrowest phone's box
 * holds (26 characters at 320px), so a longer one (a 28-character id) may
 * still break rather than run out of the box.
 */
const WHOLE_PIECE_MAX = 24;

/**
 * The link with a line-break opportunity after each "/" (not inside "//"),
 * before the "?" and after each "=", so a narrow box wraps it at its parts
 * rather than mid-word. From the "?" on, each piece ("?recruiter=", the id)
 * is kept whole, so an id is never split at a hyphen of its own; the path
 * stays plain text, so a long company address can still break at its hyphens.
 */
function withBreaks(url) {
    const parts = [];
    let part = '';
    [...url].forEach((character, index) => {
        if (character === '?' && part) {
            parts.push(part);
            part = '';
        }
        part += character;
        if ((character === '/' && url[index + 1] !== '/') || character === '=') {
            parts.push(part);
            part = '';
        }
    });
    if (part) parts.push(part);
    const query = parts.findIndex((piece) => piece.startsWith('?'));
    return parts.flatMap((piece, index) => {
        const whole = query !== -1 && index >= query && piece.length <= WHOLE_PIECE_MAX;
        const shown = whole ? <span key={`piece-${index}`} className="whitespace-nowrap">{piece}</span> : piece;
        return index === 0 ? [shown] : [<wbr key={index} />, shown];
    });
}
