import React, { useId, useRef, useState, useEffect } from 'react';
import { db, auth } from '@lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { getPortalUser } from '@features/auth/services/userService';
import { Icon, Send, MessageSquare, Clock, History } from '@design-system/icons';
import { logActivity } from '@shared/utils/activityLogger';
import { sanitizeUserContent } from '@shared/utils/sanitizeUserContent';
import { Avatar, Badge, Button, Card, FieldMessage, FormField, Textarea } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { EmptyState, LoadingState } from '@design-system/patterns';

/**
 * Internal notes for one application or lead, plus anonymised shared history from
 * previous companies.
 *
 * Built on the design system's components and `--ds-*` tokens.
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
 * Rules this tab keeps:
 *  1. **A failed save is an announced in-place message** worded "Failed to save
 *     note.", never a blocking `alert()`.
 *  2. **The note composer has an accessible name.** `FormField` owns the
 *     label/field association, and the "Visible only to your team" line is its
 *     accessible description.
 *  3. **No functional text below 12px**, the "Shared History" badge and every
 *     timestamp included.
 *  4. **Contrast holds** on the privacy note, the timestamps and the
 *     empty-state icon (`text-gray-400` on white is 2.56:1).
 *  5. **The loading state is announced.**
 *  6. **Duplicate submission is blocked by a ref** — `sending` is React state,
 *     so two activations inside one render would both pass it.
 *  7. **The shared-history avatar carries no `title`**; the visible badge is the
 *     marker.
 *  8. `--ds-*` tokens and the approved Lucide icons throughout, not the legacy
 *     palette or a hand-rolled inline `<svg>`.
 *  9. **The loading and empty panels are the approved `LoadingState` and
 *     `EmptyState`**, which is the pattern's own rule: the three states of one
 *     slot look alike, and the empty one is announced when the notes finish
 *     loading instead of appearing silently.
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
            // The notes, the shared history and the writer's name are read side
            // by side. The name settles on its own, so failing to read it leaves
            // the notes on screen, as when it was read after them.
            const writerRead = auth.currentUser
                ? getPortalUser(auth.currentUser.uid).then((profile) => ({ profile }), (error) => ({ error }))
                : null;
            try {
                // 1. Fetch Local Internal Notes (Your company's private notes)
                const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
                const q = query(notesRef, orderBy("createdAt", "desc"));
                // 2. Fetch Shared History (Anonymized notes from previous companies)
                // These live on the parent document in the 'sharedHistory' array
                const parentDocRef = doc(db, "companies", companyId, collectionName, applicationId);
                const [snapshot, parentSnap] = await Promise.all([getDocs(q), getDoc(parentDocRef)]);

                const localNotes = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    text: sanitizeUserContent(doc.data().text || ''),
                    isLocal: true
                }));

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
                if (writerRead) {
                    const writer = await writerRead;
                    if (writer.error) throw writer.error;
                    setCurrentUser(writer.profile ? writer.profile.name : 'Admin');
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
                            {!sending && <Icon icon={Send} />}
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
                    <LoadingState surface="bare" headingLevel={3} title="Loading notes..." />
                ) : notes.length === 0 ? (
                    <EmptyState
                        surface="bare"
                        icon={MessageSquare}
                        headingLevel={3}
                        title="No notes yet."
                    />
                ) : (
                    notes.map(note => (
                        <article key={note.id} className="flex gap-ds-3">
                            <div className="mt-1 shrink-0">
                                {note.isShared ? (
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 items-center justify-center rounded-ds-full border border-ds-status-accent-border bg-ds-status-accent-bg text-ds-status-accent-fg"
                                    >
                                        <Icon icon={History} size="sm" />
                                    </span>
                                ) : (
                                    <Avatar size="sm" tone="neutral">
                                        {note.author ? note.author.charAt(0).toUpperCase() : 'A'}
                                    </Avatar>
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
                                        <Icon icon={Clock} size="xs" />
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
