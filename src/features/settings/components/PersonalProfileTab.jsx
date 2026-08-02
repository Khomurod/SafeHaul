// src/features/settings/components/PersonalProfileTab.jsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from '@lib/firebase';
import { Save, Loader2, Link as LinkIcon, Copy, CheckCircle } from 'lucide-react';
import {
    Button,
    Card,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

export function PersonalProfileTab({ currentUser, currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [personalData, setPersonalData] = useState({ name: '' });
    const [recruitingCode, setRecruitingCode] = useState(null);
    const [loading, setLoading] = useState(false);
    const [linkLoading, setLinkLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    // FIX: Use Env var if present, otherwise fallback to current origin (robust for MVP)
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    useEffect(() => {
        const fetchUserAndCode = async () => {
            if (currentUser?.uid) {
                try {
                    const userDocRef = doc(db, "users", currentUser.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (userDoc.exists()) {
                        const data = userDoc.data();
                        setPersonalData({ name: data.name || '' });

                        if (data.recruitingCode) {
                            setRecruitingCode(data.recruitingCode);
                            setLinkLoading(false);
                        } else {
                            await generateShortCode(currentUser.uid);
                        }
                    }
                } catch (e) {
                    console.error("Error fetching profile:", e);
                    setLinkLoading(false);
                }
            }
        };
        fetchUserAndCode();
    }, [currentUser]);

    const generateShortCode = async (uid) => {
        setLinkLoading(true);
        try {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();

            // 1. Save mapping
            await setDoc(doc(db, "recruiter_links", code), {
                userId: uid,
                companyId: currentCompanyProfile.id,
                createdAt: new Date()
            });

            // 2. Save code to user profile
            await updateDoc(doc(db, "users", uid), {
                recruitingCode: code
            });

            setRecruitingCode(code);
        } catch (err) {
            console.error("Error generating link:", err);
            showError("Could not generate tracking link.");
        } finally {
            setLinkLoading(false);
        }
    };

    const handleSavePersonal = async () => {
        setLoading(true);
        try {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, { name: personalData.name });
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

    const handleCopyLink = () => {
        if (!uniqueLink) return;
        navigator.clipboard.writeText(uniqueLink);
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
                            <LinkIcon size={24} />
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
                                    <Loader2 className="animate-spin" size={16} aria-hidden="true" />
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
                                            ? <CheckCircle size={16} aria-hidden="true" />
                                            : <Copy size={16} aria-hidden="true" />}
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
                            size="lg"
                            onClick={handleSavePersonal}
                            loading={loading}
                        >
                            {!loading && <Save size={18} aria-hidden="true" />}
                            Update Profile
                        </Button>
                    </div>
                </FormSection>
            </Stack>
        </div>
    );
}
