// src/features/company-admin/components/LeadAssignmentModal.jsx
import React, { useId, useRef, useState, useEffect } from 'react';
import { X, Users, User, CheckCircle } from 'lucide-react';
import { db } from '@lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { logActivity } from '@shared/utils/activityLogger';
import {
    Button, Checkbox, FieldMessage, FormField, IconButton, Select,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Bulk lead assignment — manual pick or round-robin distribution.
 *
 * Launched from the company candidate list. Migrated to the design system
 * 2026-07-28; it was a hand-built overlay found by the repository-wide dialog
 * scan.
 *
 * Presentation only. Frozen and unchanged: the `memberships` query by
 * `companyId` and the per-member `users/{userId}` read; the deterministic
 * `localeCompare` sort by name that keeps round-robin from drifting; the
 * default-select-all round-robin pool; the `'manual'` / `'round_robin'` mode
 * values with `'manual'` initial; the `writeBatch` update payload
 * (`assignedTo`, `assignedToName`, `assignedAt`, `updatedAt` — both
 * `serverTimestamp()`); the `"Unknown"` assignee-name fallback; the
 * `rrIndex % distributionPool.length` rotation and the empty-pool skip; the
 * per-lead `logActivity(companyId, 'leads', leadId, 'Lead Assigned', 'Assigned to
 * specific user' | 'Assigned to round-robin pool', 'assignment')` calls; the
 * `onSuccess()`-then-`onClose()` ordering; and every user-facing string.
 *
 * Defects fixed:
 *  1. **The overlay was a hand-built `fixed inset-0` div** with no
 *     `role="dialog"`, no `aria-modal`, no focus move, no focus trap, no Escape
 *     and no focus restoration. It now uses the shared accessible `Modal`.
 *  2. **The round-robin recruiter list was completely unusable by keyboard.**
 *     Each row was a `<div onClick>` with a `CheckSquare`/`Square` icon standing
 *     in for a checkbox — no `role`, no `tabIndex`, no key handling, no
 *     `aria-checked` and no accessible name. A keyboard or screen-reader user
 *     could not change the distribution pool at all. Each row is now a real
 *     `Checkbox` named with the recruiter, so the browser supplies the semantics
 *     and the keyboard model.
 *  3. **Three blocking `alert()` calls** carried both guards and the failure.
 *     They are now announced in-place messages with the wording preserved.
 *  4. **The mode selector was colour-only** — a blue vs purple tint with no
 *     `aria-pressed` and nothing but the tint distinguishing the active choice.
 *     It is now a `role="group"` of `Button`s with `aria-pressed`.
 *  5. **The recruiter `<select>` had no accessible name** — its `<label>` had no
 *     `htmlFor` and the select had no `id`.
 *  6. **The close control had no accessible name.**
 *  7. **The recruiter list was an unnamed scroll region.**
 *  8. **The team load was an unannounced bare spinner.**
 *  9. **Duplicate submission was possible** — `processing` is React state.
 * 10. `bg-black/50`, `text-gray-400` on the unchecked box, and the rest of the
 *     legacy palette replaced with `--ds-*` tokens.
 *
 * Also removed: a dead `currentUserName` local that was computed from
 * `auth.currentUser` on every assignment and never used.
 */
export function LeadAssignmentModal({ companyId, selectedLeadIds, onClose, onSuccess }) {
    const [team, setTeam] = useState([]);
    const [loadingTeam, setLoadingTeam] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');

    // 'manual' | 'round_robin'
    const [mode, setMode] = useState('manual');

    // For Manual
    const [selectedUserId, setSelectedUserId] = useState('');
    // For Round Robin
    const [rrUserIds, setRrUserIds] = useState([]);

    const titleId = useId();
    const descriptionId = useId();
    const recruiterFieldId = useId();
    const poolLabelId = useId();
    /**
     * Ref, not state: `processing` only takes effect on the next render, so two
     * activations dispatched before React re-renders would both get past it.
     */
    const submittingRef = useRef(false);

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
        if (mode === 'manual' && !selectedUserId) {
            setError("Please select a recruiter.");
            return;
        }
        if (mode === 'round_robin' && rrUserIds.length === 0) {
            setError("Please select at least one recruiter.");
            return;
        }
        if (submittingRef.current) return;

        setError('');
        submittingRef.current = true;
        setProcessing(true);
        try {
            const batch = writeBatch(db);

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
            setError("Failed to assign leads.");
        } finally {
            submittingRef.current = false;
            setProcessing(false);
        }
    };

    const toggleRrUser = (uid) => {
        setRrUserIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="flex items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <Users className="text-ds-content-link" size={20} aria-hidden="true" /> Assign Leads
                    </h2>
                    <p id={descriptionId} className="text-ds-xs text-ds-content-secondary">
                        Assigning <strong className="text-ds-content">{selectedLeadIds.length}</strong> selected leads
                    </p>
                </div>
                <IconButton label="Close assign leads" variant="ghost" size="sm" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="overflow-y-auto p-ds-6">
                {loadingTeam ? (
                    <p role="status" className="py-ds-8 text-center text-ds-sm text-ds-content-secondary">
                        Loading team...
                    </p>
                ) : (
                    <Stack gap="lg">
                        {/* Mode Selection */}
                        <div role="group" aria-label="Assignment method" className="flex gap-ds-3">
                            <Button
                                variant={mode === 'manual' ? 'primary' : 'secondary'}
                                aria-pressed={mode === 'manual'}
                                className="flex-1"
                                onClick={() => setMode('manual')}
                            >
                                <User size={20} aria-hidden="true" />
                                Manual Pick
                            </Button>
                            <Button
                                variant={mode === 'round_robin' ? 'primary' : 'secondary'}
                                aria-pressed={mode === 'round_robin'}
                                className="flex-1"
                                onClick={() => setMode('round_robin')}
                            >
                                <Users size={20} aria-hidden="true" />
                                Round Robin
                            </Button>
                        </div>

                        {/* Manual Body */}
                        {mode === 'manual' && (
                            <FormField id={recruiterFieldId} label="Select Recruiter">
                                <Select
                                    value={selectedUserId}
                                    onChange={(e) => setSelectedUserId(e.target.value)}
                                >
                                    <option value="">-- Choose User --</option>
                                    {team.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </Select>
                            </FormField>
                        )}

                        {/* RR Body */}
                        {mode === 'round_robin' && (
                            <Stack gap="sm">
                                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                                    <span id={poolLabelId} className="text-ds-xs font-bold uppercase text-ds-content-secondary">
                                        Distribute Amongst
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setRrUserIds(team.map(m => m.id))}
                                    >
                                        Select All
                                    </Button>
                                </div>
                                {/*
                                  Was a list of `<div onClick>` rows with an icon
                                  standing in for a checkbox — no semantics and no
                                  keyboard path at all.
                                */}
                                <div
                                    role="group"
                                    aria-labelledby={poolLabelId}
                                    tabIndex={0}
                                    className="max-h-48 overflow-y-auto rounded-ds-md border border-ds-border-subtle focus-visible:outline-none focus-visible:shadow-ds-focus"
                                >
                                    {team.map(m => (
                                        <div
                                            key={m.id}
                                            className={`border-b border-ds-border-subtle p-ds-3 last:border-0 ${
                                                rrUserIds.includes(m.id) ? 'bg-ds-status-accent-bg' : ''
                                            }`}
                                        >
                                            <Checkbox
                                                label={m.name || 'Unnamed recruiter'}
                                                checked={rrUserIds.includes(m.id)}
                                                onChange={() => toggleRrUser(m.id)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </Stack>
                        )}

                        {/* Replaces the three blocking `alert()` calls. */}
                        <div role="alert">
                            {error && <FieldMessage tone="error">{error}</FieldMessage>}
                        </div>
                    </Stack>
                )}
            </div>

            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button
                    variant="primary"
                    onClick={handleAssign}
                    disabled={processing || loadingTeam}
                    loading={processing}
                >
                    {!processing && <CheckCircle size={16} aria-hidden="true" />}
                    {processing ? 'Assigning...' : 'Confirm Assignment'}
                </Button>
            </div>
        </Modal>
    );
}
