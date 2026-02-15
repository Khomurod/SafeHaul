import React, { useState, useEffect, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { auth, storage, db } from '@lib/firebase';
import { updateProfile, updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, updateDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { User, Mail, Lock, Save, Camera, Upload, AlertCircle } from 'lucide-react';
import { getPortalUser } from '@features/auth/services/userService';

export const UserProfilePage = () => {
    const { currentUser, currentCompanyProfile } = useData();
    const { showSuccess, showError } = useToast();
    const fileInputRef = useRef(null);

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
    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

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
            // Username uniqueness check
            const trimmedUsername = profileData.username.trim();
            if (trimmedUsername) {
                const usersRef = collection(db, 'users');
                const q = query(usersRef, where('username', '==', trimmedUsername));
                const snapshot = await getDocs(q);
                const otherUsers = snapshot.docs.filter(doc => doc.id !== currentUser.uid);
                if (otherUsers.length > 0) {
                    showError('This username is already taken. Please choose a different one.');
                    setIsSavingProfile(false);
                    return;
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
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Page Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <User size={24} className="text-indigo-600" />
                    My Profile
                </h1>
                <p className="text-sm text-gray-500">Manage your account settings and preferences.</p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                <div className="max-w-2xl mx-auto space-y-6">

                    {/* Profile Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <User size={18} /> Profile Information
                        </h2>

                        {/* Avatar Section */}
                        <div className="flex items-center gap-6 mb-8">
                            <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                />
                                {profileData.photoURL ? (
                                    <img src={profileData.photoURL} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-gray-200 group-hover:opacity-75 transition" />
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold group-hover:opacity-75 transition">
                                        {getInitials(profileData.displayName)}
                                    </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera size={24} className="text-white drop-shadow-md" />
                                </div>
                                <button className="absolute bottom-0 right-0 p-1.5 bg-white border border-gray-300 rounded-full shadow hover:bg-gray-50 transition z-10">
                                    {isUploadingAvatar ? <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-600 rounded-full border-t-transparent"></div> : <Upload size={14} className="text-gray-600" />}
                                </button>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-medium text-gray-900">{profileData.displayName || 'No Name Set'}</h3>
                                <p className="text-sm text-gray-500">{currentCompanyProfile?.companyName || 'No Company'}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    {isUploadingAvatar ? 'Uploading image...' : 'Click avatar to upload new image'}
                                </p>
                            </div>
                        </div>

                        {/* Edit Fields */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                                    <input
                                        type="text"
                                        name="displayName"
                                        value={profileData.displayName}
                                        onChange={handleProfileChange}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                    <input
                                        type="text"
                                        name="username"
                                        value={profileData.username}
                                        onChange={handleProfileChange}
                                        placeholder="@username"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                    />
                                </div>
                            </div>

                            {/* Email Section */}
                            <div className="pt-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Mail size={14} className="inline mr-1" /> Email Address
                                </label>
                                {!isEditingEmail ? (
                                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                        <span className="text-gray-700">{profileData.email}</span>
                                        <button
                                            onClick={() => setIsEditingEmail(true)}
                                            className="text-xs font-medium text-blue-600 hover:text-blue-700"
                                        >
                                            Change Email
                                        </button>
                                    </div>
                                ) : (
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 space-y-3 animate-in fade-in slide-in-from-top-2">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">New Email</label>
                                            <input
                                                type="email"
                                                value={newEmail}
                                                onChange={(e) => setNewEmail(e.target.value)}
                                                className="w-full px-3 py-2 border border-blue-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Confirm Password</label>
                                            <input
                                                type="password"
                                                value={emailPassword}
                                                onChange={(e) => setEmailPassword(e.target.value)}
                                                placeholder="Required to change email"
                                                className="w-full px-3 py-2 border border-blue-200 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                        </div>
                                        <div className="flex justify-end gap-2 pt-1">
                                            <button
                                                onClick={() => { setIsEditingEmail(false); setEmailPassword(''); setNewEmail(currentUser.email); }}
                                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded-md transition"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleUpdateEmail}
                                                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition"
                                            >
                                                Update Email
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={handleSaveProfile}
                                disabled={isSavingProfile}
                                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium flex items-center gap-2 disabled:opacity-50 shadow-sm"
                            >
                                <Save size={16} /> {isSavingProfile ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>

                    {/* Password Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Lock size={18} /> Change Password
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                                <input
                                    type="password"
                                    name="currentPassword"
                                    value={passwordData.currentPassword}
                                    onChange={handlePasswordChange}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    placeholder="••••••••"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                    <input
                                        type="password"
                                        name="newPassword"
                                        value={passwordData.newPassword}
                                        onChange={handlePasswordChange}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                                    <input
                                        type="password"
                                        name="confirmPassword"
                                        value={passwordData.confirmPassword}
                                        onChange={handlePasswordChange}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={handleChangePassword}
                                disabled={isSavingPassword}
                                className="px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-medium flex items-center gap-2 disabled:opacity-50 shadow-sm"
                            >
                                <Lock size={16} /> {isSavingPassword ? 'Changing...' : 'Change Password'}
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default UserProfilePage;
