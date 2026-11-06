// src/features/settings/components/PersonalProfileTab.jsx
import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from '@lib/firebase';
import { forgetPortalUser } from '@features/auth/services/userService';
import { Icon, Loader2, Link as LinkIcon, Copy, CheckCircle } from '@design-system/icons';
import {
    Button,
    Card,
    FormField,
    FormSection,
    Input,
    Link,
    Notice,
} from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { useToast } from '@shared/components/feedback';
import { recruiterCodeFor } from '../services/recruiterLinkCode';
import { saveBarSummary } from '../utils/saveBarSummary';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/**
 * Settings → My profile: the signed-in member's name and their recruiting
 * link. A changed name stays on the page until the save bar's Save, which
 * writes only `users/{uid}.name`; the company shell's leave guard watches it.
 */
export function PersonalProfileTab({ currentUser, currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [savedName, setSavedName] = useState('');
    const [name, setName] = useState('');
    const [recruitingCode, setRecruitingCode] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [linkLoading, setLinkLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    const dirty = name !== savedName;
    useUnsavedChanges(dirty);
    // What the field and the saved name are now, for a read that finishes later.
    const nameState = useRef({ name, savedName });
    nameState.current = { name, savedName };
    // A failure is about a change that is no longer there once the page is clean.
    if (!dirty && saveError) setSaveError(null);

    // FIX: Use Env var if present, otherwise fallback to current origin (robust for MVP)
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    const companyId = currentCompanyProfile?.id;
    const uid = currentUser?.uid;

    useEffect(() => {
        // A company switch while the page is open asks again: a code made for
        // the previous company would not assign anyone here.
        let current = true;
        setRecruitingCode(null);
        setLinkLoading(true);
        const fetchUserAndCode = async () => {
            if (!uid) {
                setLinkLoading(false);
                return;
            }
            try {
                const userDoc = await getDoc(doc(db, "users", uid));
                if (!current || !userDoc.exists()) return;
                const data = userDoc.data();
                // A name being typed stays, still unsaved, when the read is a repeat.
                const typed = nameState.current;
                setSavedName(data.name || '');
                if (typed.name === typed.savedName) setName(data.name || '');

                const savedCode = data.recruitingCode;
                const code = companyId ? await recruiterCodeFor(uid, companyId, savedCode) : null;
                if (code && code !== savedCode) forgetPortalUser(uid);
                if (current) setRecruitingCode(code);
            } catch (err) {
                console.error("Error generating link:", err);
                if (current) showError("Could not generate your personal link.");
            } finally {
                if (current) setLinkLoading(false);
            }
        };
        fetchUserAndCode();
        return () => { current = false; };
    }, [uid, companyId, showError]);

    const handleSavePersonal = async () => {
        const sent = name;
        setSaving(true);
        setSaveError(null);
        try {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, { name: sent });
            // The next screen to show the name reads it again.
            forgetPortalUser(currentUser.uid);
            // A name typed while the save was on its way stays, still unsaved.
            setSavedName(sent);
            showSuccess('Personal profile updated successfully.');
        } catch (error) {
            console.error("User save failed", error);
            setSaveError(plainErrorMessage(error, 'Your profile could not be saved.'));
        } finally {
            setSaving(false);
        }
    };

    const discard = () => {
        setName(savedName);
        setSaveError(null);
    };

    // Construct the link
    const companySlug = currentCompanyProfile?.appSlug || 'general';
    // Clean trailing slash just in case
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    // Without a signed-in user there is no one to assign, so there is no link.
    let uniqueLink = null;
    if (recruitingCode) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?r=${recruitingCode}`;
    else if (currentUser?.uid) uniqueLink = `${cleanBaseUrl}/apply/${companySlug}?recruiter=${currentUser.uid}`;

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
        <div>
            <Stack gap="lg">
                <PageHeader
                    title="My profile"
                    description="Update your personal details and access your recruiting tools."
                />

                <Notice tone="info">
                    Change your password or sign-in email on{' '}
                    <Link href="/company/profile">your profile page</Link>.
                </Notice>

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

                <FormSection
                    title="Profile details"
                    description="Your name appears in the Company workspace. Your sign-in email is read-only here."
                >
                    <FormField id="personal-profile-name" label="Full Name">
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </FormField>

                    <FormField
                        id="personal-profile-email"
                        label="Email"
                        description="Email cannot be changed directly."
                    >
                        <Input
                            type="email"
                            value={currentUser?.email || ''}
                            readOnly
                        />
                    </FormField>
                </FormSection>

                {dirty && (
                    <SaveBar
                        summary={saveBarSummary(['Full Name'])}
                        saving={saving}
                        error={saveError}
                        onSave={handleSavePersonal}
                        onDiscard={discard}
                    />
                )}
            </Stack>
        </div>
    );
}
