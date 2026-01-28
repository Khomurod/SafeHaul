import React, { useState } from 'react';
import { updateUser } from '@features/auth/services/userService';
import { auth, functions } from '@lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { KeyRound, Trash2, Loader2 } from 'lucide-react';

export function EditUserNameForm({ userId, initialName, email, companyId, onSave }) {
    const [userName, setUserName] = useState(initialName || '');
    const [userEmail, setUserEmail] = useState(email || '');

    const [saveLoading, setSaveLoading] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const handleSave = async () => {
      setSaveLoading(true);
      setSaveMessage('Saving...');
      try {
        // Send both name and email to the update service
        await updateUser(userId, { name: userName, email: userEmail }, companyId);
        setSaveMessage('Profile saved!');
        if (onSave) onSave();

        setTimeout(() => setSaveMessage(''), 2000);
      } catch (error) {
        console.error("Error updating user:", error);
        setSaveMessage('Error: ' + (error.message || 'Unknown error'));
      } finally {
        setSaveLoading(false);
      }
    };

    const handleResetPassword = async () => {
        if (!userEmail) return;
        if (!window.confirm(`Send password reset email to ${userEmail}?`)) return;

        setResetLoading(true);
        try {
            await sendPasswordResetEmail(auth, userEmail);
            alert(`Password reset email sent to ${userEmail}`);
        } catch (error) {
            console.error("Reset Password Error:", error);
            alert("Failed to send reset email: " + error.message);
        } finally {
            setResetLoading(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!window.confirm(`Are you sure you want to delete this user? This action cannot be undone.`)) return;
        setDeleteLoading(true);
        try {
            const deleteFn = httpsCallable(functions, 'deletePortalUser');
            await deleteFn({ userId, companyId });
            alert("User deleted/removed successfully.");
            if (onSave) onSave(); // Triggers refresh in parent
        } catch (error) {
            console.error("Delete User Error:", error);
            alert("Failed to delete user: " + error.message);
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-6">

            {/* Header */}
            <div>
                <h3 className="text-lg font-semibold text-gray-700">User Profile</h3>
                <p className="text-sm text-gray-500">Update basic information.</p>
            </div>

            {/* Form Fields */}
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
                <div>
                    <label htmlFor="edit-user-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input 
                        type="text" 
                        id="edit-user-name" 
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" 
                        required 
                        value={userName} 
                        onChange={(e) => setUserName(e.target.value)} 
                    />
                </div>
                <div>
                    <label htmlFor="edit-user-email" className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <input 
                        type="email" 
                        id="edit-user-email" 
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" 
                        required
                        value={userEmail} 
                        onChange={(e) => setUserEmail(e.target.value)}
                    />
                </div>

                {/* Save Button */}
                <div className="flex items-center gap-4 pt-2">
                    <button 
                        type="submit" 
                        className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2" 
                        disabled={saveLoading}
                    >
                        {saveLoading && <Loader2 size={16} className="animate-spin" />}
                        {saveLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <p className={`text-sm font-medium ${saveMessage.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                        {saveMessage}
                    </p>
                </div>
            </form>

            {/* Account Actions Section */}
            <div className="pt-6 border-t border-gray-100">
                <h4 className="text-sm font-bold text-gray-900 mb-4">Account Actions</h4>
                <div className="flex flex-col sm:flex-row gap-3">
                    <button 
                        type="button"
                        onClick={handleResetPassword}
                        disabled={resetLoading}
                        className="flex-1 px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100 font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                        {resetLoading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                        Send Password Reset
                    </button>

                    <button 
                        type="button"
                        onClick={handleDeleteUser}
                        disabled={deleteLoading}
                        className="flex-1 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                        {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        Delete User
                    </button>
                </div>
            </div>
        </div>
    );
}