import React, { useState, useEffect, useMemo } from 'react';
import { X, User, Users, Mail, Target, Loader2, Link as LinkIcon, Copy, Phone, CheckCircle, Pencil, Trash2 } from 'lucide-react';
import { db, functions } from '@lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback';
import { EditUserModal } from '@features/super-admin/components/modals/EditUserModal';

export function ManageTeamModal({ companyId, onClose }) {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companySlug, setCompanySlug] = useState('');
  const [companyName, setCompanyName] = useState('Current Company'); // New state for name
  const [editingUserId, setEditingUserId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);

  const { showSuccess, showInfo, showError } = useToast ? useToast() : { showSuccess: alert, showInfo: alert, showError: alert };

  // FIX: Robust base URL resolution
  const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

  useEffect(() => {
    if (!companyId) return;

    const fetchSlugAndName = async () => {
        try {
            const compDoc = await getDoc(doc(db, "companies", companyId));
            if(compDoc.exists()) {
                 const d = compDoc.data();
                 setCompanySlug(d.appSlug || companyId);
                 setCompanyName(d.companyName || 'Current Company');
            }
        } catch(e) { console.warn("Error fetching company info:", e); }
    };
    fetchSlugAndName();

    const q = query(collection(db, "memberships"), where("companyId", "==", companyId));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const members = [];

      for (const memDoc of snapshot.docs) {
        const memData = memDoc.data();
        const userId = memData.userId;

        let userData = { name: 'Unknown', email: 'No Email' };
        try {
            const userDoc = await getDoc(doc(db, "users", userId));
            if (userDoc.exists()) {
                userData = userDoc.data();
            }
        } catch (e) { console.log("Error fetching user:", e) }

        let goals = { callGoal: 150, contactGoal: 50 };
        try {
            const settingsSnap = await getDoc(doc(db, "companies", companyId, "team", userId));
            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                goals = { 
                    callGoal: data.callGoal || 150, 
                    contactGoal: data.contactGoal || 50 
                };
            }
        } catch (e) { console.log("Error fetching goals:", e) }

        members.push({ 
            id: userId, 
            ...userData, 
            role: memData.role, 
            ...goals 
        });
      }
      setTeam(members);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [companyId]);

  const handleCopyLink = (userId) => {
      const cleanBase = appBaseUrl.replace(/\/$/, "");
      const link = `${cleanBase}/apply/${companySlug}?recruiter=${userId}`;
      navigator.clipboard.writeText(link);
      showSuccess("Custom recruiter link copied!");
  };

  const handleSaveGoal = async (userId, field, value) => {
      try {
          await setDoc(doc(db, "companies", companyId, "team", userId), {
              [field]: Number(value),
              updatedAt: new Date()
          }, { merge: true });
      } catch (err) { 
          console.error(err);
          alert("Error saving goal");
      }
  };

  const handleDeleteUser = async (userId, userName) => {
      if (!window.confirm(`Are you sure you want to remove ${userName || 'this user'} from the team?`)) {
          return;
      }

      setDeleteLoading(userId);
      try {
          const deleteFn = httpsCallable(functions, 'deletePortalUser');
          await deleteFn({ userId, companyId });
          showSuccess(`${userName || 'User'} has been removed from the team.`);
      } catch (error) {
          console.error("Error deleting user:", error);
          showError("Failed to remove user: " + (error.message || 'Unknown error'));
      } finally {
          setDeleteLoading(null);
      }
  };

  // FIX: Use a Map object instead of a plain object to satisfy UserMembershipsManager
  const companiesMap = useMemo(() => {
      const map = new Map();
      map.set(companyId, companyName);
      return map;
  }, [companyId, companyName]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl border border-gray-200 flex flex-col max-h-[90vh]">

        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Users className="text-blue-600" /> Manage Team & Links
            </h2>
            <p className="text-sm text-gray-500">Set goals and get tracking links for your recruiters.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

            <div>
                {loading ? (
                    <div className="text-center py-8 text-gray-500"><Loader2 className="animate-spin mx-auto mb-2"/> Loading team...</div>
                ) : team.length === 0 ? (
                    <p className="text-center text-gray-400 italic py-4">No members found.</p>
                ) : (
                    <div className="space-y-3">
                        {team.map(member => (
                            <div key={member.id} className="flex flex-col lg:flex-row items-center justify-between p-4 bg-white border border-gray-200 rounded-lg shadow-sm gap-4 hover:border-blue-300 transition-colors">
                                <div className="flex items-center gap-3 w-full lg:w-1/3">
                                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold shrink-0">
                                        {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                                    </div>
                                    <div className="overflow-hidden">
                                        <p className="font-bold text-gray-900 truncate">{member.name || 'Unknown'}</p>
                                        <p className="text-xs text-gray-500 truncate">{member.email}</p>
                                    </div>
                                </div>

                                <div className="flex gap-4 items-center w-full lg:w-auto">
                                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                                        <Phone size={14} className="text-blue-500"/>
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-bold text-gray-400 uppercase">Dials</span>
                                            <input 
                                                type="number" 
                                                className="w-12 p-0 text-sm bg-transparent border-none text-center font-bold focus:ring-0 outline-none"
                                                defaultValue={member.callGoal}
                                                onBlur={(e) => handleSaveGoal(member.id, 'callGoal', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                                        <Users size={14} className="text-green-600"/>
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-bold text-gray-400 uppercase">Contacts</span>
                                            <input 
                                                type="number" 
                                                className="w-12 p-0 text-sm bg-transparent border-none text-center font-bold focus:ring-0 outline-none"
                                                defaultValue={member.contactGoal}
                                                onBlur={(e) => handleSaveGoal(member.id, 'contactGoal', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <button 
                                        onClick={() => handleCopyLink(member.id)}
                                        className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors text-sm font-semibold ml-2"
                                        title="Copy Custom Tracking Link"
                                    >
                                        <LinkIcon size={14} /> Link
                                    </button>

                                    <button 
                                        onClick={() => setEditingUserId(member.id)}
                                        className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors text-sm font-semibold"
                                        title="Edit User"
                                    >
                                        <Pencil size={14} />
                                    </button>

                                    <button 
                                        onClick={() => handleDeleteUser(member.id, member.name)}
                                        disabled={deleteLoading === member.id}
                                        className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg border border-red-200 transition-colors text-sm font-semibold disabled:opacity-50"
                                        title="Remove from Team"
                                    >
                                        {deleteLoading === member.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

        </div>
      </div>

      {editingUserId && (
          <EditUserModal 
              userId={editingUserId}
              companyId={companyId}
              allCompaniesMap={companiesMap}
              onClose={() => setEditingUserId(null)}
              onSave={() => {}}
          />
      )}
    </div>
  );
}