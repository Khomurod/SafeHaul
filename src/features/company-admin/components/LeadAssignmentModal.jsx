// src/features/company-admin/components/LeadAssignmentModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Users, User, CheckCircle, Loader2, CheckSquare, Square } from 'lucide-react';
import { db, auth } from '@lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { logActivity } from '@shared/utils/activityLogger';

export function LeadAssignmentModal({ companyId, selectedLeadIds, onClose, onSuccess }) {
    const [team, setTeam] = useState([]);
    const [loadingTeam, setLoadingTeam] = useState(true);
    const [processing, setProcessing] = useState(false);

    // 'manual' | 'round_robin'
    const [mode, setMode] = useState('manual'); 

    // For Manual
    const [selectedUserId, setSelectedUserId] = useState('');
    // For Round Robin
    const [rrUserIds, setRrUserIds] = useState([]);

    useEffect(() => {
        const fetchTeam = async () => {
            try {
                const q = query(collection(db, "memberships"), where("companyId", "==", companyId));
                const snap = await getDocs(q);
                const members = [];

                for (const m of snap.docs) {
                    try {
                        const uSnap = await getDoc(doc(db, "users", m.data().userId));
                        if (uSnap.exists()) {

                            members.push({ id: uSnap.id, name: uSnap.data().name });
                        }
                    } catch (e) { console.error(e); }
                }

                // FIX: Deterministic Sort by Name (or ID) to prevent round-robin drift
                members.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                setTeam(members);
                // Default select all for RR
                setRrUserIds(members.map(m => m.id));
            } catch (e) {
                console.error("Error loading team:", e);
            } finally {

                setLoadingTeam(false);
            }
        };
        fetchTeam();
    }, [companyId]);

    const handleAssign = async () => {
        if (mode === 'manual' && !selectedUserId) return alert("Please select a recruiter.");
        if (mode === 'round_robin' && rrUserIds.length === 0) return alert("Please select at least one recruiter.");

        setProcessing(true);
        try {
            const batch = writeBatch(db);
            const currentUser = auth.currentUser;
            const currentUserName = currentUser?.displayName || currentUser?.email || "Admin";

            let rrIndex = 0;

            // Pool is already sorted from useEffect, filter it by selection
            const distributionPool = mode === 'round_robin' 
                ? team.filter(m => rrUserIds.includes(m.id)) 
                : [];

            selectedLeadIds.forEach(leadId => {
                const leadRef = doc(db, "companies", companyId, "leads", leadId);

                let assigneeId, assigneeName;

                if (mode === 'manual') {
                    assigneeId = selectedUserId;

                    assigneeName = team.find(t => t.id === selectedUserId)?.name || "Unknown";
                } else {
                    // Safety check if pool is empty
                    if (distributionPool.length === 0) return;

                    const member = distributionPool[rrIndex % distributionPool.length];
                    assigneeId = member.id;
                    assigneeName = member.name;
                    rrIndex++;
                }

                batch.update(leadRef, {
                    assignedTo: assigneeId,
                    assignedToName: assigneeName,

                    assignedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            });

            await batch.commit();

            // Log activity
            // Note: If batch > 250, we might need chunking, but for UI limits this is usually fine.
            await Promise.all(selectedLeadIds.map(leadId => 
                logActivity(
                    companyId, 
                    'leads', 
                    leadId, 

                    'Lead Assigned', 
                    `Assigned to ${mode === 'manual' ? 'specific user' : 'round-robin pool'}`, 
                    'assignment'
                )
            ));

            onSuccess();
            onClose();

        } catch (error) {
            console.error("Assignment error:", error);
            alert("Failed to assign leads.");
        } finally {
            setProcessing(false);
        }
    };

    const toggleRrUser = (uid) => {
        setRrUserIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">

                <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <div>

                         <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <Users className="text-blue-600" size={20} /> Assign Leads
                        </h2>
                        <p className="text-xs text-gray-500">

                           Assigning <strong className="text-gray-800">{selectedLeadIds.length}</strong> selected leads
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} 
 /></button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {loadingTeam ?
 (
                        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600"/></div>
                    ) : (
                        <div className="space-y-6">


     {/* Mode Selection */}
                            <div className="flex gap-3">
                                <button 

       onClick={() => setMode('manual')}
                                    className={`flex-1 py-3 px-2 border rounded-xl flex flex-col items-center gap-2 transition-all ${mode === 'manual' ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                                >

                                   <User size={20} />
                                    <span className="text-xs font-bold uppercase">Manual Pick</span>

          </button>
                                <button 
                                    onClick={() => setMode('round_robin')}

                 className={`flex-1 py-3 px-2 border rounded-xl flex flex-col items-center gap-2 transition-all ${mode === 'round_robin' ?
 'bg-purple-50 border-purple-500 text-purple-700 ring-1 ring-purple-500' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                                >
                                    <Users size={20} />

                <span className="text-xs font-bold uppercase">Round Robin</span>
                                </button>
                            </div>


        {/* Manual Body */}
                            {mode === 'manual' && (
                                <div className="space-y-2 animate-in fade-in">

              <label className="block text-xs font-bold text-gray-500 uppercase">Select Recruiter</label>
                                    <select 
                                        className="w-full p-3 border border-gray-300 
 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                        value={selectedUserId}
                                        onChange={(e) => setSelectedUserId(e.target.value)}

                     >
                                        <option value="">-- Choose User --</option>

      {team.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}

                              </select>
                                </div>
                            )}


                  {/* RR Body */}
                            {mode === 'round_robin' && (
                                <div className="space-y-2 animate-in fade-in">

                        <div className="flex justify-between items-center">
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Distribute Amongst</label>

             <button 
                                            type="button"

  onClick={() => setRrUserIds(team.map(m => m.id))}
                                            className="text-xs text-purple-600 hover:underline font-bold"
                                        >

                                     Select All
                                        </button>

              </div>
                                    <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                                        {team.map(m => {

                                         const isSelected = rrUserIds.includes(m.id);
 return (
                                                <div 

   key={m.id}
                                                    onClick={() => toggleRrUser(m.id)}

         className={`flex items-center gap-3 p-3 border-b last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'}`}
                                                >

                     {isSelected ? <CheckSquare size={16} className="text-purple-600"/> : <Square size={16} className="text-gray-400"/>}
                                                    <span className={`text-sm ${isSelected ? 'text-purple-900 font-medium' : 'text-gray-600'}`}>{m.name}</span>

                                    </div>
                                            )

                    })}
                                    </div>
                                </div>

                )}

                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">

                   <button onClick={onClose} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
                    <button 
                        onClick={handleAssign}
                        disabled={processing ||
 loadingTeam}
                        className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                    >
                        {processing ?
 <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                        {processing ?
 'Assigning...' : 'Confirm Assignment'}
                    </button>
                </div>
            </div>
        </div>
    );
}