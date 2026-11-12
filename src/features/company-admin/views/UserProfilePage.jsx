import React, { useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { auth, db } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { updateProfile, updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Icon, Mail, Save } from '@design-system/icons';
import { forgetPortalUser, getPortalUser } from '@features/auth/services/userService';
import {
    Button,
    FieldDisplay,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useUnsavedChanges } from '@/design-system/patterns';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { ProfileAvatarField } from '@features/company-admin/components/profile/ProfileAvatarField';
import { PersonalLinkCard } from '@features/company-admin/components/profile/PersonalLinkCard';

/*
 * Columns by the width of the card, not the window: two (photo | company,
 * name | email) and three passwords side by side where the card's body is at
 * least 640px wide, one below that. Each grid sits in a size container of its
 * own, inside the card.
 */
const CARD_GRID = 'min-w-0 [container-type:inline-size]';
const TWO_UP = 'grid min-w-0 items-start gap-x-ds-6 gap-y-ds-5 [@container_(min-width:640px)]:grid-cols-2';
const THREE_UP = 'grid min-w-0 items-end gap-x-ds-5 gap-y-ds-5 [@container_(min-width:640px)]:grid-cols-3';

/*
 * A read-only value on the line an input's text sits on, so Company and Email
 * read level with Display Name beside them; on a phone, where nothing sits
 * beside it, just the text.
 */
const VALUE_ON_INPUT_LINE = 'mt-ds-1 flex min-h-ds-control items-center max-md:mt-0 max-md:min-h-0';

/**
 * Profile: every staff member's own page — their personal application link,
 * name, photo, sign-in email and password. Settings no longer has a profile
 * section; its old address opens this page.
 *
 * The standard page canvas, under the "Account" eyebrow, with three stacked
 * sections (the heading and what it is for above a full-width card): the
 * personal link, Profile Information (Save Changes in the card's footer) and
 * Change Password (its button in the footer).
 */
export const UserProfilePage = () => {
    const { currentUser, currentCompanyProfile } = useData();
    const { showSuccess, showError } = useToast();
    const isMobile = useIsMobile();

    const [profileData, setProfileData] = useState({
        displayName: '',
        email: '',
        photoURL: '',
    });
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    // Email Update State
    const [newEmail, setNewEmail] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [isEditingEmail, setIsEditingEmail] = useState(false);

    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [isSavingPassword, setIsSavingPassword] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    // The name as read or last saved: an unsaved change to it asks before the page is left.
    const [savedName, setSavedName] = useState('');
    useUnsavedChanges(profileData.displayName.trim() !== savedName.trim());

    useEffect(() => {
        const fetchUserData = async () => {
            if (currentUser) {
                // Base data from Auth
                let data = {
                    displayName: currentUser.displayName || '',
                    email: currentUser.email || '',
                    photoURL: currentUser.photoURL || '',
                };

                // Fetch extended data from Firestore, fresh: this form saves it
                // back, so it must not start from the copy the top bar keeps.
                try {
                    const userDoc = await getPortalUser(currentUser.uid, { fresh: true });
                    if (userDoc) {
                        // Prefer Firestore name over Auth displayName
                        data.displayName = userDoc.name || userDoc.displayName || data.displayName;
                        // Prefer Firestore photo if available, else Auth
                        if (userDoc.photoURL) data.photoURL = userDoc.photoURL;
                    }
                } catch (err) {
                    console.error("Error fetching user details:", err);
                }

                setProfileData(data);
                setSavedName(data.displayName);
                setNewEmail(currentUser.email || ''); // Init email edit field
            }
        };
        fetchUserData();
    }, [currentUser]);

    const handleProfileChange = (e) => {
        const { name, value } = e.target;
        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    const handlePasswordChange = (e) => {
        const { name, value } = e.target;
        setPasswordData(prev => ({ ...prev, [name]: value }));
    };

    // --- Avatar Handling ---
    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation: Size < 2MB, Type Image
        if (file.size > 2 * 1024 * 1024) {
            showError("Image size must be less than 2MB.");
            return;
        }
        if (!file.type.startsWith('image/')) {
            showError("File must be an image.");
            return;
        }

        setIsUploadingAvatar(true);
        try {
            const storageRef = ref(storage, `avatars/${currentUser.uid}/${file.name}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            // Update State
            setProfileData(prev => ({ ...prev, photoURL: downloadURL }));

            // Update Auth & Firestore immediately for Avatar
            await updateProfile(auth.currentUser, { photoURL: downloadURL });
            await updateDoc(doc(db, "users", currentUser.uid), { photoURL: downloadURL });
            forgetPortalUser(currentUser.uid);

            showSuccess("Avatar updated successfully!");
        } catch (err) {
            console.error("Avatar upload error:", err);
            showError("Failed to upload avatar.");
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    // --- Profile Save (Name) ---
    const handleSaveProfile = async () => {
        if (!profileData.displayName.trim()) {
            showError('Display name cannot be empty.');
            return;
        }
        setIsSavingProfile(true);
        try {
            // 1. Update Auth
            if (currentUser.displayName !== profileData.displayName) {
                await updateProfile(auth.currentUser, {
                    displayName: profileData.displayName.trim()
                });
            }

            // 2. Update Firestore: only the name. A `username` stored by an
            // earlier version of this page stays as it is; nothing reads it.
            await updateDoc(doc(db, "users", currentUser.uid), {
                name: profileData.displayName.trim(),
            });
            setSavedName(profileData.displayName.trim());
            // The next screen to show the name reads it again.
            forgetPortalUser(currentUser.uid);

            showSuccess('Profile updated successfully!');
        } catch (err) {
            console.error('Error updating profile:', err);
            showError('Failed to update profile.');
        } finally {
            setIsSavingProfile(false);
        }
    };

    // --- Email Update ---
    const handleUpdateEmail = async () => {
        if (!newEmail || !emailPassword) {
            showError("Please provide new email and current password.");
            return;
        }
        if (newEmail === currentUser.email) {
            setIsEditingEmail(false);
            return;
        }

        setIsSavingProfile(true);
        try {
            // 1. Re-authenticate
            const credential = EmailAuthProvider.credential(currentUser.email, emailPassword);
            await reauthenticateWithCredential(auth.currentUser, credential);

            // 2. Update Email in Auth
            await updateEmail(auth.currentUser, newEmail);

            // 3. Update Firestore
            await updateDoc(doc(db, "users", currentUser.uid), { email: newEmail });
            forgetPortalUser(currentUser.uid);

            showSuccess("Email updated! You may need to sign in again.");
            setIsEditingEmail(false);
            setEmailPassword('');
        } catch (err) {
            console.error("Email update error:", err);
            if (err.code === 'auth/wrong-password') {
                showError("Incorrect password.");
            } else if (err.code === 'auth/email-already-in-use') {
                showError("Email is already in use.");
            } else if (err.code === 'auth/requires-recent-login') {
                showError("Please sign out and sign in again to change email.");
            } else {
                showError("Failed to update email.");
            }
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleCancelEmailEdit = () => {
        setIsEditingEmail(false);
        setEmailPassword('');
        setNewEmail(currentUser.email);
    };

    // --- Password Change ---
    const handleChangePassword = async () => {
        if (!passwordData.currentPassword || !passwordData.newPassword) {
            showError('Please fill in both current and new password fields.');
            return;
        }
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            showError('New passwords do not match.');
            return;
        }
        if (passwordData.newPassword.length < 6) {
            showError('New password must be at least 6 characters.');
            return;
        }

        setIsSavingPassword(true);
        try {
            // Re-authenticate first
            const credential = EmailAuthProvider.credential(currentUser.email, passwordData.currentPassword);
            await reauthenticateWithCredential(auth.currentUser, credential);

            // Then update password
            await updatePassword(auth.currentUser, passwordData.newPassword);
            showSuccess('Password changed successfully!');
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (err) {
            console.error('Error changing password:', err);
            if (err.code === 'auth/wrong-password') {
                showError('Current password is incorrect.');
            } else {
                showError('Failed to change password. Please try again.');
            }
        } finally {
            setIsSavingPassword(false);
        }
    };

    const getInitials = (name) => {
        // Trim-safe: the initials prop is evaluated eagerly regardless of whether
        // a photo exists, so a whitespace-only name must not throw (it would crash
        // the page even for photo-backed accounts).
        const trimmed = (name || '').trim();
        if (!trimmed) return 'U';
        const parts = trimmed.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return trimmed.substring(0, 2).toUpperCase();
    };

    return (
        <div className="min-h-full bg-ds-canvas">
            <PageContainer width="standard">
                <Stack gap="lg">
                    <PageHeader
                        eyebrow="Account"
                        title="My Profile"
                        description="Manage your account settings and preferences."
                    />

                    <Stack gap="xl">
                        {/* A link names the company it applies to: with none chosen there is none. */}
                        {currentCompanyProfile?.id && (
                            <PersonalLinkCard
                                currentUser={currentUser}
                                currentCompanyProfile={currentCompanyProfile}
                            />
                        )}

                        <FormSection
                            layout="stacked"
                            title="Profile Information"
                            description="Your name, photo, and sign-in email."
                            footer={(
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleSaveProfile}
                                    loading={isSavingProfile}
                                >
                                    {!isSavingProfile && <Icon icon={Save} size="lg" />}
                                    {isSavingProfile ? 'Saving...' : 'Save Changes'}
                                </Button>
                            )}
                        >
                            <div className={CARD_GRID}>
                                <div className={TWO_UP}>
                                    <ProfileAvatarField
                                        photoURL={profileData.photoURL}
                                        initials={getInitials(profileData.displayName)}
                                        uploading={isUploadingAvatar}
                                        onFileSelect={handleFileChange}
                                    />

                                    <FieldDisplay label="Company">
                                        <span className={VALUE_ON_INPUT_LINE}>
                                            {currentCompanyProfile?.companyName || 'No Company'}
                                        </span>
                                    </FieldDisplay>

                                    <FormField id="profile-display-name" label="Display Name">
                                        <Input
                                            type="text"
                                            name="displayName"
                                            value={profileData.displayName}
                                            onChange={handleProfileChange}
                                            autoComplete="name"
                                        />
                                    </FormField>

                                    {!isEditingEmail ? (
                                        <div className="flex min-w-0 flex-wrap items-end gap-x-ds-3 gap-y-ds-2">
                                            <FieldDisplay label="Email Address" className="min-w-0 max-w-full">
                                                <span className={VALUE_ON_INPUT_LINE}>
                                                    <span className="min-w-0">{emailWithBreak(profileData.email)}</span>
                                                </span>
                                            </FieldDisplay>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size={isMobile ? 'md' : 'sm'}
                                                fullWidth={isMobile}
                                                className="md:mb-ds-1"
                                                onClick={() => setIsEditingEmail(true)}
                                            >
                                                <Icon icon={Mail} />
                                                Change Email
                                            </Button>
                                        </div>
                                    ) : (
                                        <div
                                            role="group"
                                            aria-label="Change email address"
                                            className="col-span-full flex flex-col gap-ds-4 rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-4"
                                        >
                                            <FormField id="profile-new-email" label="New Email">
                                                <Input
                                                    type="email"
                                                    value={newEmail}
                                                    onChange={(e) => setNewEmail(e.target.value)}
                                                    autoComplete="email"
                                                />
                                            </FormField>
                                            <FormField
                                                id="profile-email-current-password"
                                                label="Current Password"
                                                description="Required to change your email."
                                            >
                                                <Input
                                                    type="password"
                                                    value={emailPassword}
                                                    onChange={(e) => setEmailPassword(e.target.value)}
                                                    autoComplete="current-password"
                                                />
                                            </FormField>
                                            <div className="flex flex-wrap justify-end gap-ds-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={handleCancelEmailEdit}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="primary"
                                                    size="sm"
                                                    onClick={handleUpdateEmail}
                                                    loading={isSavingProfile}
                                                >
                                                    Update Email
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </FormSection>

                        <FormSection
                            layout="stacked"
                            title="Change Password"
                            description="Update the password you use to sign in."
                            footer={(
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleChangePassword}
                                    loading={isSavingPassword}
                                >
                                    {isSavingPassword ? 'Changing...' : 'Change Password'}
                                </Button>
                            )}
                        >
                            <div className={CARD_GRID}>
                                <div className={THREE_UP}>
                                    <FormField id="profile-current-password" label="Current Password">
                                        <Input
                                            type="password"
                                            name="currentPassword"
                                            value={passwordData.currentPassword}
                                            onChange={handlePasswordChange}
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                        />
                                    </FormField>
                                    <FormField id="profile-new-password" label="New Password">
                                        <Input
                                            type="password"
                                            name="newPassword"
                                            value={passwordData.newPassword}
                                            onChange={handlePasswordChange}
                                            autoComplete="new-password"
                                            placeholder="••••••••"
                                        />
                                    </FormField>
                                    <FormField id="profile-confirm-password" label="Confirm New Password">
                                        <Input
                                            type="password"
                                            name="confirmPassword"
                                            value={passwordData.confirmPassword}
                                            onChange={handlePasswordChange}
                                            autoComplete="new-password"
                                            placeholder="••••••••"
                                        />
                                    </FormField>
                                </div>
                            </div>
                        </FormSection>
                    </Stack>
                </Stack>
            </PageContainer>
        </div>
    );
};

/**
 * The address with a line-break opportunity after its "@", so a narrow column
 * breaks it there rather than mid-word. Plain text either side of a `<wbr>`.
 */
function emailWithBreak(email) {
    const at = (email || '').indexOf('@');
    if (at < 0) return email;
    return (
        <>
            {email.slice(0, at + 1)}
            <wbr />
            {email.slice(at + 1)}
        </>
    );
}

export default UserProfilePage;
