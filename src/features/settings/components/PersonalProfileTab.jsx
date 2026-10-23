// src/features/settings/components/PersonalProfileTab.jsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from '@lib/firebase';
import { forgetPortalUser } from '@features/auth/services/userService';
import { Icon, Save, Loader2, Link as LinkIcon, Copy, CheckCircle } from '@design-system/icons';
import {
    Button,
    Card,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';
import { recruiterCodeFor } from '../services/recruiterLinkCode';

export function PersonalProfileTab({ currentUser, currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [personalData, setPersonalData] = useState({ name: '' });
    const [recruitingCode, setRecruitingCode] = useState(null);
    const [loading, setLoading] = useState(false);
    const [linkLoading, setLinkLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    // FIX: Use Env var if present, otherwise fallback to current origin (robust for MVP)
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    const companyId = currentCompanyProfile?.id;

    useEffect(() => {
        // A company switch while the page is open asks again: a code made for
        // the previous company would not assign anyone here.
        let current = true;
        setRecruitingCode(null);
        setLinkLoading(true);
        const fetchUserAndCode = async () => {
            if (!currentUser?.uid) {
                setLinkLoading(false);
                return;
            }
            try {
                const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                if (!current || !userDoc.exists()) return;
                const data = userDoc.data();
                setPersonalData({ name: data.name || '' });

                const savedCode = data.recruitingCode;
                const code = companyId ? await recruiterCodeFor(currentUser.uid, companyId, savedCode) : null;
                if (code && code !== savedCode) forgetPortalUser(currentUser.uid);
                if (current) setRecruitingCode(code);
            } catch (err) {
                console.error("Error generating link:", err);
                if (current) showError("Could not generate tracking link.");
            } finally {
                if (current) setLinkLoading(false);
            }
        };
        fetchUserAndCode();
        return () => { current = false; };
    }, [currentUser, companyId, showError]);

    const handleSavePersonal = async () => {
        setLoading(true);
        try {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, { name: personalData.name });
            // The next screen to show the name reads it again.
            forgetPortalUser(currentUser.uid);
            showSuccess('Personal profile updated successfully.');
        } catch (error) {
            console.error("User save failed", error);
            showError("Failed to update profile.");
        } finally {
            setLoading(false);
        }
    };

    // Construct the link
    const companySlug = currentCompanyProfile?.appSlug || 'general';
    // Clean trailing slash just in case
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    const uniqueLink = recruitingCode 
        ? `${cleanBaseUrl}/apply/${companySlug}?r=${recruitingCode}`
        : `${cleanBaseUrl}/apply/${companySlug}?recruiter=${currentUser?.uid}`;

    const handleCopyLink = async () => {
        if (!uniqueLink) return;
        try {
            await navigator.clipboard.writeText(uniqueLink);
        } catch {
            showError("Could not copy the link. Select it and copy it yourself.");
            return;
        }
        setCopied(true);
        showSuccess("Short link copied!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="max-w-4xl animate-in fade-in">
            <Stack gap="lg">
                <PageHeader
                    title="Personal Profile"
                    description="Update your personal details and access your recruiting tools."
                />

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
                                Your Short Recruiting Link
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
                            value={personalData.name}
                            onChange={(e) => setPersonalData({ ...personalData, name: e.target.value })}
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

                    <div className="flex justify-end pt-2">
                        <Button
                            variant="primary"
                            onClick={handleSavePersonal}
                            loading={loading}
                        >
                            {!loading && <Icon icon={Save} size="lg" />}
                            Update Profile
                        </Button>
                    </div>
                </FormSection>
            </Stack>
        </div>
    );
}
