import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { forgetPortalUser } from '@features/auth/services/userService';
import { Icon, Loader2, Link as LinkIcon, Copy, CheckCircle } from '@design-system/icons';
import { Button, Card } from '@/design-system/components';
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

    const companySlug = currentCompanyProfile?.appSlug || 'general';
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    // Without a signed-in user there is no one to assign, so there is no link.
    let uniqueLink = null;
    if (recruitingCode) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?r=${recruitingCode}`;
    else if (uid) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?recruiter=${uid}`;

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
        <Card
            className="border-ds-status-info-border bg-ds-status-info-bg"
            aria-labelledby="personal-recruiting-link-title"
        >
            <div className="flex items-start gap-4">
                <div
                    className="p-3 rounded-ds-md shadow-ds-xs bg-ds-surface text-ds-status-info-fg shrink-0"
                    aria-hidden="true"
                >
                    <Icon icon={LinkIcon} size="2xl" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2
                        id="personal-recruiting-link-title"
                        className="text-ds-heading-sm font-bold mb-1 text-ds-status-info-fg"
                    >
                        Your personal link
                    </h2>

                    <p className="text-ds-sm text-ds-status-info-fg mb-4">
                        Share this link. Drivers who apply will be <strong>automatically assigned to you</strong>.
                    </p>

                    {linkLoading ? (
                        <div
                            className="flex items-center gap-2 text-ds-sm text-ds-content-secondary"
                            role="status"
                        >
                            <Icon icon={Loader2} className="animate-spin" />
                            Generating unique code...
                        </div>
                    ) : !uniqueLink ? (
                        <p className="text-ds-sm text-ds-content-secondary">
                            Sign in again to see your link.
                        </p>
                    ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-ds-surface p-2 rounded-ds-md border border-ds-status-info-border">
                            <code
                                className="flex-1 min-w-0 text-ds-xs sm:text-ds-sm font-mono text-ds-content-secondary truncate px-2"
                                title={uniqueLink}
                            >
                                {uniqueLink}
                            </code>

                            <Button
                                variant="primary"
                                size="sm"
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
                </div>
            </div>
        </Card>
    );
}
