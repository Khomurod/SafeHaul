import React, { useId, useRef, useState, useEffect } from 'react';
import { db, auth } from '@lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getPortalUser } from '@features/auth/services/userService';
import { Send, MessageSquare, Clock, History } from 'lucide-react';
import { logActivity } from '@shared/utils/activityLogger';
import { sanitizeUserContent } from '@shared/utils/sanitizeUserContent';
import { Badge, Button, Card, FieldMessage, FormField, Textarea } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * Internal notes for one application or lead, plus anonymised shared history from
 * previous companies.
 *
 * Migrated to the design system 2026-07-28. This was one of the four dossier tab
 * bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
 * and recorded as residual debt since.
 *
 * Presentation only. Frozen and unchanged: the
 * `companies/{companyId}/{collectionName}/{applicationId}/internal_notes` path and
 * its `orderBy('createdAt', 'desc')`; the parent-document `sharedHistory` read and
 * its anonymisation to `"Previous Recruiter"`; `sanitizeUserContent` on every
 * stored and displayed note; the merge-and-sort rule and its three timestamp
 * shapes (Firestore `seconds`, `Date`, ISO string); the written note shape
 * (`text`, `author`, `serverTimestamp()`, `type: 'note'`); the
 * `logActivity(companyId, collectionName, applicationId, "Note Added", <first 100
 * chars + ellipsis>, "note")` call; the optimistic-append shape; the
 * `getPortalUser` → `'Admin'` fallback; the empty-note no-op; and every
 * user-facing string.
 *
 * Defects fixed:
 *  1. **`alert("Failed to save note.")`** — a blocking dialog for a routine save
 *     failure. Now an announced in-place message with the wording preserved.
 *  2. **The note composer had no accessible name.** The `<label>` had no
 *     `htmlFor` and the `<textarea>` had no `id`, so a screen reader announced an
 *     unnamed multiline field. `FormField` owns the association, and the
 *     "Visible only to your team" line is now its accessible description rather
 *     than unrelated text below it.
 *  3. **Sub-12px functional text** — `text-[9px]` on the "Shared History" badge
 *     and `text-[10px]` on every timestamp.
 *  4. **`text-gray-400` on white = 2.56:1** on the privacy note and all
 *     timestamps, and `text-gray-300` on the empty-state icon.
 *  5. **The loading state was an unannounced bare spinner.**
 *  6. **Duplicate submission was possible** — `sending` is React state, so two
 *     activations inside one render both passed it.
 *  7. **A `title` attribute was the only marker on the shared-history avatar**,
 *     duplicating the visible badge; it is removed rather than relied on.
 *  8. Legacy palette throughout (purple-50/100/200/600/800, gray-*, blue-600) and
 *     a hand-rolled inline `<svg>` shield replaced by the approved Lucide icon.
 */
export function NotesTab({ companyId, applicationId, collectionName = 'applications' }) {
    const [notes, setNotes] = useState([]);
    const [newNote, setNewNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    /** Replaces `alert("Failed to save note.")`. */
    const [sendError, setSendError] = useState('');

    const noteFieldId = useId();
    /**
     * Ref, not state: `sending` only takes effect on the next render, so two
     * activations dispatched before React re-renders would both get past it.
     */
    const submittingRef = useRef(false);

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
                    text: sanitizeUserContent(doc.data().text || ''),
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
                        text: sanitizeUserContent(item.text || ''),
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
        if (submittingRef.current) return;

        submittingRef.current = true;
        setSending(true);
        setSendError('');
        try {
            const sanitizedNote = sanitizeUserContent(newNote);
            const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
            await addDoc(notesRef, {
                text: sanitizedNote,
                author: currentUser,
                createdAt: serverTimestamp(),
                type: 'note'
            });

            // Log to global activity history
            await logActivity(companyId, collectionName, applicationId, "Note Added", sanitizedNote.substring(0, 100) + (sanitizedNote.length > 100 ? "..." : ""), "note");

            // Optimistic update (only adds to top)
            const optimisticNote = {
                id: Date.now().toString(),
                text: sanitizedNote,
                author: currentUser,
                createdAt: { seconds: Date.now() / 1000 },
                type: 'note',
                isLocal: true
            };
            setNotes([optimisticNote, ...notes]);
            setNewNote('');
        } catch (error) {
            console.error("Failed to add note:", error);
            setSendError("Failed to save note.");
        } finally {
            submittingRef.current = false;
            setSending(false);
        }
    };

    return (
        <Stack gap="lg">
            {/* Input Area */}
            <Card padding="md">
                <form onSubmit={handleSend}>
                    <FormField
                        id={noteFieldId}
                        label="Internal Note (Private)"
                        description="Visible only to your team"
                    >
                        <Textarea
                            rows="3"
                            placeholder="Log a call, interview notes, or reason for rejection..."
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                        />
                    </FormField>
                    <div className="mt-ds-3 flex flex-wrap items-center justify-end gap-ds-3">
                        <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={!newNote.trim() || sending}
                            loading={sending}
                        >
                            {!sending && <Send size={16} aria-hidden="true" />}
                            Add Note
                        </Button>
                    </div>
                    {/* Replaces the blocking `alert()`. */}
                    <div role="alert">
                        {sendError && <FieldMessage tone="error">{sendError}</FieldMessage>}
                    </div>
                </form>
            </Card>

            {/* Notes List */}
            <Stack gap="md">
                {loading ? (
                    <p role="status" className="py-ds-10 text-center text-ds-sm text-ds-content-secondary">
                        Loading notes...
                    </p>
                ) : notes.length === 0 ? (
                    <div className="rounded-ds-lg border border-dashed border-ds-border py-ds-10 text-center">
                        <MessageSquare className="mx-auto mb-ds-2 text-ds-content-secondary" size={32} aria-hidden="true" />
                        <p className="text-ds-sm text-ds-content-secondary">No notes yet.</p>
                    </div>
                ) : (
                    notes.map(note => (
                        <article key={note.id} className="flex gap-ds-3">
                            <div className="mt-1 shrink-0">
                                {note.isShared ? (
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 items-center justify-center rounded-full border border-ds-status-accent-border bg-ds-status-accent-bg text-ds-status-accent-fg"
                                    >
                                        <History size={14} />
                                    </span>
                                ) : (
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-surface-subtle text-ds-xs font-bold text-ds-content-secondary"
                                    >
                                        {note.author ? note.author.charAt(0).toUpperCase() : 'A'}
                                    </span>
                                )}
                            </div>

                            <div
                                className={`flex-1 rounded-ds-md rounded-tl-none border p-ds-3 ${
                                    note.isShared
                                        ? 'border-ds-status-accent-border bg-ds-status-accent-bg'
                                        : 'border-ds-border-subtle bg-ds-surface-subtle'
                                }`}
                            >
                                <div className="mb-1 flex flex-wrap items-center justify-between gap-ds-2">
                                    <div className="flex flex-wrap items-center gap-ds-2">
                                        <span
                                            className={`text-ds-xs font-bold ${
                                                note.isShared ? 'text-ds-status-accent-fg' : 'text-ds-content-secondary'
                                            }`}
                                        >
                                            {note.author || 'Unknown'}
                                        </span>
                                        {note.isShared && (
                                            <Badge tone="accent">Shared History</Badge>
                                        )}
                                    </div>
                                    <span className="flex items-center gap-1 text-ds-xs text-ds-content-secondary">
                                        <Clock size={12} aria-hidden="true" />
                                        {note.createdAt?.seconds
                                            ? new Date(note.createdAt.seconds * 1000).toLocaleString()
                                            : new Date(note.createdAt).toLocaleString() !== 'Invalid Date'
                                                ? new Date(note.createdAt).toLocaleString()
                                                : 'Just now'}
                                    </span>
                                </div>
                                <p className="whitespace-pre-wrap break-words text-ds-sm leading-relaxed text-ds-content">
                                    {note.text}
                                </p>
                            </div>
                        </article>
                    ))
                )}
            </Stack>
        </Stack>
    );
}
