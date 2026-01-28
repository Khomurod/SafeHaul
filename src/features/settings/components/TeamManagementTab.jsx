import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { UserPlus, Loader2, Plus, Link as LinkIcon, Copy, CheckCircle } from 'lucide-react';
import { useToast } from '@shared/components/feedback';

export function TeamManagementTab({ currentCompanyProfile, isCompanyAdmin, onShowManageTeam }) {
    const { showSuccess, showError } = useToast();
    const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'hr_user' });
    const [addUserLoading, setAddUserLoading] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);

    const inviteLink = `${window.location.origin}/join/${currentCompanyProfile?.id}`;

    const handleCopyInviteLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            setLinkCopied(true);
            showSuccess("Invite link copied to clipboard!");
            setTimeout(() => setLinkCopied(false), 3000);
        } catch (err) {
            showError("Failed to copy link");
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setAddUserLoading(true);
        try {
            const createFn = httpsCallable(functions, 'createPortalUser');
            await createFn({
                fullName: newUser.fullName,
                email: newUser.email,
                password: newUser.password,
                companyId: currentCompanyProfile.id,
                role: newUser.role
            });
            
            showSuccess(`User ${newUser.fullName} created successfully!`);
            setNewUser({ fullName: '', email: '', password: '', role: 'hr_user' });
        } catch (error) {
            console.error(error);
            showError("Failed to create user: " + error.message);
        } finally {
            setAddUserLoading(false);
        }
    };

    if (!isCompanyAdmin) {
        return <div className="p-10 text-center text-gray-500">Access Denied. Only Admins can manage the team.</div>;
    }

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in">
            <div className="border-b border-gray-200 pb-4 mb-6">
                <h2 className="text-xl font-bold text-gray-900">Team Management</h2>
                <p className="text-sm text-gray-500 mt-1">Add new recruiters or admins to your company dashboard.</p>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-blue-900 mb-2 flex items-center gap-2">
                    <LinkIcon size={20} /> Team Invite Link
                </h3>
                <p className="text-sm text-blue-700 mb-4">
                    Share this link with new team members. They can create their own account and join your company.
                </p>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        readOnly
                        value={inviteLink}
                        className="flex-1 p-3 bg-white border border-blue-300 rounded-lg text-sm text-gray-700 font-mono"
                    />
                    <button
                        onClick={handleCopyInviteLink}
                        className={`px-4 py-3 font-bold rounded-lg flex items-center gap-2 transition-all ${
                            linkCopied 
                                ? 'bg-green-600 text-white' 
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                    >
                        {linkCopied ? <CheckCircle size={18} /> : <Copy size={18} />}
                        {linkCopied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <UserPlus size={20} /> Add New User
                </h3>
                <form onSubmit={handleCreateUser} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                            <input
                                required
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newUser.fullName}
                                onChange={e => setNewUser({ ...newUser, fullName: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                            <input
                                required
                                type="email"
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newUser.email}
                                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
                            <input
                                required
                                type="password"
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newUser.password}
                                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Role</label>
                            <select
                                className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newUser.role}
                                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                            >
                                <option value="hr_user">Recruiter (Standard)</option>
                                <option value="company_admin">Company Admin (Full Access)</option>
                            </select>
                        </div>
                    </div>
                    <div className="pt-2 flex justify-end">
                        <button
                            type="submit"
                            disabled={addUserLoading}
                            className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
                        >
                            {addUserLoading ? <Loader2 className="animate-spin" /> : <Plus size={18} />} Create User
                        </button>
                    </div>
                </form>
            </div>

            <div className="text-center pt-4">
                <button
                    onClick={onShowManageTeam}
                    className="text-blue-600 hover:underline text-sm font-semibold"
                >
                    View All Team Members & Goals
                </button>
            </div>
        </div>
    );
}
