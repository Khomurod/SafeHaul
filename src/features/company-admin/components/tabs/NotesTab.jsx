import React, { useState, useEffect } from 'react';
import { db, auth } from '@lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getPortalUser } from '@features/auth/services/userService';
import { Send, MessageSquare, Clock, Loader2, History } from 'lucide-react';

function ShieldIcon({size}) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 11h.01"/></svg>
    )
}

export function NotesTab({ companyId, applicationId, collectionName = 'applications' }) {
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    async function init() {
        setLoading(true);
        try {
            // 1. Fetch Local Internal Notes (Your company's private notes)
            const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
            const q = query(notesRef, orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);

            const localNotes = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                isLocal: true
            }));

            // 2. Fetch Shared History (Anonymized notes from previous companies)
            // These live on the parent document in the 'sharedHistory' array
            const parentDocRef = doc(db, "companies", companyId, collectionName, applicationId);
            const parentSnap = await getDoc(parentDocRef);

            let sharedNotes = [];
            if (parentSnap.exists() && parentSnap.data().sharedHistory) {
                const history = parentSnap.data().sharedHistory || [];
                sharedNotes = history.map((item, index) => ({
                    id: `shared_${index}`,
                    text: item.text,
                    author: "Previous Recruiter", // Anonymized
                    createdAt: item.date, // Timestamp from backend
                    type: 'note',
                    isLocal: false, // Mark as shared/imported
                    isShared: true
                }));
            }

            // 3. Merge and Sort by Date (Newest First)
            const allNotes = [...localNotes, ...sharedNotes].sort((a, b) => {
                const getTime = (t) => {
                    if (!t) return 0;
                    if (t.seconds) return t.seconds * 1000; // Firestore Timestamp
                    if (t instanceof Date) return t.getTime(); // JS Date
                    return new Date(t).getTime(); // ISO String
                };
                return getTime(b.createdAt) - getTime(a.createdAt);
            });

            setNotes(allNotes);

            // 4. Get Current User Name for the input form
            if (auth.currentUser) {
                const userProfile = await getPortalUser(auth.currentUser.uid);
                setCurrentUser(userProfile ? userProfile.name : 'Admin');
            }
        } catch (e) {
            console.error("Error loading notes:", e);
        } finally {
            setLoading(false);
        }
    }
    init();
  }, [companyId, applicationId, collectionName]);

  const handleSend = async (e) => {
      e.preventDefault();
      if (!newNote.trim()) return;

      setSending(true);
      try {
          const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
          await addDoc(notesRef, {
              text: newNote,
              author: currentUser,
              createdAt: serverTimestamp(),
              type: 'note'
          });

          // Optimistic update (only adds to top)
          const optimisticNote = {
              id: Date.now().toString(),
              text: newNote,
              author: currentUser,
              createdAt: { seconds: Date.now() / 1000 }, 
              type: 'note',
              isLocal: true
          };
          setNotes([optimisticNote, ...notes]);
          setNewNote('');
      } catch (error) {
          console.error("Failed to add note:", error);
          alert("Failed to save note.");
      } finally {
          setSending(false);
      }
  };

  return (
    <div className="space-y-6">
        {/* Input Area */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Internal Note (Private)</label>
            <form onSubmit={handleSend}>
                <textarea 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm outline-none"
                    rows="3"
                    placeholder="Log a call, interview notes, or reason for rejection..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                ></textarea>
                <div className="flex justify-between items-center mt-3">
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                        <ShieldIcon size={12} /> Visible only to your team
                    </p>
                    <button 
                        type="submit" 
                        disabled={!newNote.trim() || sending}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-all"
                    >
                        {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                        Add Note
                    </button>
                </div>
            </form>
        </div>

        {/* Notes List */}
        <div className="space-y-4">
            {loading ? (
                <div className="text-center py-10"><Loader2 className="animate-spin mx-auto text-gray-400"/></div>
            ) : notes.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <MessageSquare className="mx-auto text-gray-300 mb-2" size={32} />
                    <p className="text-gray-500 text-sm">No notes yet.</p>
                </div>
            ) : (
                notes.map(note => (
                    <div key={note.id} className="flex gap-3">
                        <div className="mt-1 flex-shrink-0">
                             {note.isShared ? (
                                 <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold border border-purple-200" title="Shared History">
                                     <History size={14} />
                                  </div>
                             ) : (
                                 <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-xs font-bold">
                                      {note.author ? note.author.charAt(0).toUpperCase() : 'A'}
                                 </div>
                             )}
                        </div>

                        <div className={`flex-1 p-3 rounded-lg rounded-tl-none border ${note.isShared ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-bold ${note.isShared ? 'text-purple-800' : 'text-gray-700'}`}>
                                        {note.author || 'Unknown'}
                                    </span>
                                    {note.isShared && (
                                         <span className="text-[9px] uppercase font-bold bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">Shared History</span>
                                    )}
                                </div>
                                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                    <Clock size={10} />
                                    {note.createdAt?.seconds 
                                        ? new Date(note.createdAt.seconds * 1000).toLocaleString() 
                                        : new Date(note.createdAt).toLocaleString() !== 'Invalid Date' 
                                            ? new Date(note.createdAt).toLocaleString() 
                                            : 'Just now'}
                                </span>
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{note.text}</p>
                        </div>
                    </div>
                ))
            )}
        </div>
    </div>
  );
}