import React, { useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { auth, storage, db } from '@lib/firebase';
import { updateProfile, updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { User, Mail, Lock, Save } from 'lucide-react';
import { getPortalUser } from '@features/auth/services/userService';
import {
    Button,
    FieldDisplay,
    FormField,
    FormSection,
    Input,
} from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { ProfileAvatarField } from '@features/company-admin/components/profile/ProfileAvatarField';

export const UserProfilePage = () => {
    const { currentUser, currentCompanyProfile } = useData();
    const { showSuccess, showError } = useToast();

    const [profileData, setProfileData] = useState({
        displayName: '',
        email: '',
        photoURL: '',
        username: ''
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

    useEffect(() => {
        const fetchUserData = async () => {
            if (currentUser) {
                // Base data from Auth
                let data = {
                    displayName: currentUser.displayName || '',
                    email: currentUser.email || '',
                    photoURL: currentUser.photoURL || '',
                    username: ''
                };

                // Fetch extended data from Firestore
                try {
                    const userDoc = await getPortalUser(currentUser.uid);
                    if (userDoc) {
                        // Prefer Firestore name over Auth displayName
                        data.displayName = userDoc.name || userDoc.displayName || data.displayName;
                        data.username = userDoc.username || '';
                        // Prefer Firestore photo if available, else Auth
                        if (userDoc.photoURL) data.photoURL = userDoc.photoURL;
                    }
                } catch (err) {
                    console.error("Error fetching user details:", err);
                }

                setProfileData(data);
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

            showSuccess("Avatar updated successfully!");
        } catch (err) {
            console.error("Avatar upload error:", err);
            showError("Failed to upload avatar.");
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    // --- Profile Save (Name & Username) ---
    const handleSaveProfile = async () => {
        if (!profileData.displayName.trim()) {
            showError('Display name cannot be empty.');
            return;
        }
        setIsSavingProfile(true);
        try {
            // Username uniqueness check (best-effort, non-blocking).
            // SEC-002: the global `users` collection is no longer listable across
            // tenants by company staff, so this cross-company query is only allowed
            // for super admins. For everyone else it will be permission-denied — we
            // must skip the courtesy check rather than block the whole profile save
            // (uniqueness was never server-enforced anyway).
            const trimmedUsername = profileData.username.trim();
            if (trimmedUsername) {
                try {
                    const usersRef = collection(db, 'users');
                    const q = query(usersRef, where('username', '==', trimmedUsername));
                    const snapshot = await getDocs(q);
                    const otherUsers = snapshot.docs.filter(doc => doc.id !== currentUser.uid);
                    if (otherUsers.length > 0) {
                        showError('This username is already taken. Please choose a different one.');
                        setIsSavingProfile(false);
                        return;
                    }
                } catch (usernameCheckErr) {
                    // Permission-denied (non-super-admin) or transient error: skip the
                    // client-side uniqueness hint and let the save proceed.
                    console.warn('[UserProfilePage] Username uniqueness check skipped:', usernameCheckErr?.message || usernameCheckErr);
                }
            }

            // 1. Update Auth
            if (currentUser.displayName !== profileData.displayName) {
                await updateProfile(auth.currentUser, {
                    displayName: profileData.displayName.trim()
                });
            }

            // 2. Update Firestore
            await updateDoc(doc(db, "users", currentUser.uid), {
                name: profileData.displayName.trim(),
                username: trimmedUsername
            });

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
        <div className="flex h-full flex-col bg-ds-surface-subtle">
            {/* Page Header */}
            <div className="shrink-0 border-b border-ds-border bg-ds-surface px-6 py-4">
                <PageHeader
                    title={(
                        <span className="inline-flex items-center gap-ds-2">
                            <User size={24} className="text-ds-action-primary" aria-hidden="true" />
                            My Profile
                        </span>
                    )}
                    description="Manage your account settings and preferences."
                />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 overflow-auto p-6">
                <div className="mx-auto w-full max-w-2xl">
                    <Stack gap="lg">

                        {/* Profile Section */}
                        <FormSection
                            title="Profile Information"
                            description="Your name, photo, username, and sign-in email."
                        >
                            {/* Avatar */}
                            <ProfileAvatarField
                                photoURL={profileData.photoURL}
                                initials={getInitials(profileData.displayName)}
                                uploading={isUploadingAvatar}
                                onFileSelect={handleFileChange}
                            />

                            <FieldDisplay label="Company">
                                {currentCompanyProfile?.companyName || 'No Company'}
                            </FieldDisplay>

                            {/* Name & Username */}
                            <div className="grid grid-cols-1 gap-ds-5 md:grid-cols-2">
                                <FormField id="profile-display-name" label="Display Name">
                                    <Input
                                        type="text"
                                        name="displayName"
                                        value={profileData.displayName}
                                        onChange={handleProfileChange}
                                        autoComplete="name"
                                    />
                                </FormField>
                                <FormField id="profile-username" label="Username">
                                    <Input
                                        type="text"
                                        name="username"
                                        value={profileData.username}
                                        onChange={handleProfileChange}
                                        placeholder="@username"
                                        autoComplete="username"
                                    />
                                </FormField>
                            </div>

                            {/* Email */}
                            {!isEditingEmail ? (
                                <div className="flex flex-wrap items-end justify-between gap-ds-3">
                                    <FieldDisplay label="Email Address" className="min-w-0 flex-1">
                                        {profileData.email}
                                    </FieldDisplay>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setIsEditingEmail(true)}
                                    >
                                        <Mail size={16} aria-hidden="true" />
                                        Change Email
                                    </Button>
                                </div>
                            ) : (
                                <div
                                    role="group"
                                    aria-label="Change email address"
                                    className="flex flex-col gap-ds-4 rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-4"
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

                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="lg"
                                    onClick={handleSaveProfile}
                                    loading={isSavingProfile}
                                >
                                    {!isSavingProfile && <Save size={18} aria-hidden="true" />}
                                    {isSavingProfile ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </FormSection>

                        {/* Password Section */}
                        <FormSection
                            title="Change Password"
                            description="Update the password you use to sign in."
                        >
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
                            <div className="grid grid-cols-1 gap-ds-5 md:grid-cols-2">
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

                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="lg"
                                    onClick={handleChangePassword}
                                    loading={isSavingPassword}
                                >
                                    {!isSavingPassword && <Lock size={18} aria-hidden="true" />}
                                    {isSavingPassword ? 'Changing...' : 'Change Password'}
                                </Button>
                            </div>
                        </FormSection>

                    </Stack>
                </div>
            </div>
        </div>
    );
};

export default UserProfilePage;
