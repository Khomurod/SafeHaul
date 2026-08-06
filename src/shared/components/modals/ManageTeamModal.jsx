import React, { useId, useState, useEffect } from 'react';
import { Users, Link as LinkIcon, Phone, Trash2, X, AlertTriangle } from 'lucide-react';
import { db, functions } from '@lib/firebase';
import { collection, query, where, doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback';
import { Badge, Button, FieldMessage, IconButton } from '@/design-system/components';
import { Modal } from './Modal';

const DEFAULT_GOALS = { callGoal: 150, contactGoal: 50 };

/**
 * How a member record that is NOT simply healthy is described.
 *
 * Every one of these used to render as a normal-looking row reading
 * "Unknown / No Email", so an admin could not tell a member whose profile merely
 * lacked a name from a membership pointing at an account that no longer exists.
 * `listCompanyTeam` returns the distinction; this maps it to plain language.
 */
const MEMBER_STATUS = {
    auth_missing: {
        tone: 'danger',
        label: 'No sign-in account',
        detail: 'This membership points to an account that no longer exists. Remove it, or re-invite the person.',
    },
    unreadable: {
        tone: 'warning',
        label: 'Profile unreadable',
        detail: 'Their profile record could not be read, so these details may be out of date.',
    },
    unidentified: {
        tone: 'warning',
        label: 'No name or email',
        detail: 'This account has no name or email recorded anywhere. Ask them to sign in, or remove and re-invite.',
    },
};

export function ManageTeamModal({ companyId, onClose }) {
    const [team, setTeam] = useState([]);
    const [loading, setLoading] = useState(true);
    const [companySlug, setCompanySlug] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(null);
    /**
     * Set when the roster itself could not be loaded. Previously a failure here
     * produced a list of fabricated "Unknown" members, which read as real data.
     */
    const [loadError, setLoadError] = useState(null);
    /** Membership documents that carry no userId, so they can never name a person. */
    const [invalidMemberships, setInvalidMemberships] = useState([]);
    /**
     * `{ userId, userName } | null` — replaces `window.confirm` with an
     * accessible confirmation dialog, keeping the exact frozen question text.
     */
    const [pendingDelete, setPendingDelete] = useState(null);
    /**
     * `{ [userId]: string } | {}` — replaces `alert("Error saving goal")` with
     * an inline, per-member message, keeping the exact frozen text.
     */
    const [goalErrors, setGoalErrors] = useState({});
    const confirmTitleId = useId().replace(/:/g, '');

    const { showSuccess, showError } = useToast();

    // FIX: Robust base URL resolution
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    useEffect(() => {
        if (!companyId) return;

        const fetchSlugAndName = async () => {
            try {
                const compDoc = await getDoc(doc(db, "companies", companyId));
                if (compDoc.exists()) {
                    const d = compDoc.data();
                    setCompanySlug(d.appSlug || companyId);
                }
            } catch (e) { console.warn("Error fetching company info:", e); }
        };
        fetchSlugAndName();

        let cancelled = false;
        // Snapshots can arrive faster than a roster round-trip completes; only the
        // newest response may write state, or a stale one could overwrite it.
        let latestRequest = 0;

        const listCompanyTeam = httpsCallable(functions, 'listCompanyTeam');

        const fetchGoals = async (userId) => {
            try {
                const settingsSnap = await getDoc(doc(db, "companies", companyId, "team", userId));
                if (!settingsSnap.exists()) return DEFAULT_GOALS;
                const data = settingsSnap.data();
                return {
                    callGoal: data.callGoal || DEFAULT_GOALS.callGoal,
                    contactGoal: data.contactGoal || DEFAULT_GOALS.contactGoal,
                };
            } catch (e) {
                console.warn("Error fetching goals:", e);
                return DEFAULT_GOALS;
            }
        };

        // Identity is resolved server-side (Admin SDK + Firebase Auth fallback), so a
        // member is never reduced to a placeholder just because their profile
        // document is absent, stale, or unreadable from the browser.
        const loadTeam = async () => {
            const request = ++latestRequest;
            try {
                const { data } = await listCompanyTeam({ companyId });
                const members = data?.members || [];
                const goals = await Promise.all(members.map((m) => fetchGoals(m.id)));
                if (cancelled || request !== latestRequest) return;

                setTeam(members.map((member, i) => ({ ...member, ...goals[i] })));
                setInvalidMemberships(data?.invalidMemberships || []);
                setLoadError(null);
            } catch (e) {
                if (cancelled || request !== latestRequest) return;
                console.error("Error loading team:", e);
                setLoadError("We couldn't load your team. Please close this window and try again.");
            } finally {
                if (!cancelled && request === latestRequest) setLoading(false);
            }
        };

        // The membership query is the change signal only — it fires immediately with
        // the current documents and again on every add/remove, keeping the roster live.
        const q = query(collection(db, "memberships"), where("companyId", "==", companyId));
        const unsubscribe = onSnapshot(
            q,
            () => { loadTeam(); },
            (err) => {
                console.error("Error watching memberships:", err);
                if (cancelled) return;
                setLoadError("We couldn't load your team. Please close this window and try again.");
                setLoading(false);
            },
        );

        return () => {
            cancelled = true;
            unsubscribe();
        };
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
            setGoalErrors((prev) => {
                if (!(userId in prev)) return prev;
                const next = { ...prev };
                delete next[userId];
                return next;
            });
        } catch (err) {
            console.error(err);
            setGoalErrors((prev) => ({ ...prev, [userId]: "Error saving goal" }));
        }
    };

    const handleDeleteUser = (userId, userName) => {
        setPendingDelete({ userId, userName });
    };

    const confirmDeleteUser = async () => {
        const { userId, userName } = pendingDelete;
        setPendingDelete(null);

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

    return (
        <Modal
            onClose={onClose}
            labelledBy="manage-team-title"
            describedBy="manage-team-desc"
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <header className="flex items-center justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-6">
                <div className="min-w-0">
                    <h2 id="manage-team-title" className="flex items-center gap-2 text-ds-heading-md font-bold text-ds-content">
                        <Users className="text-ds-content-link" aria-hidden="true" /> Manage Team &amp; Links
                    </h2>
                    <p id="manage-team-desc" className="text-ds-sm text-ds-content-muted">
                        Set goals and get tracking links for your recruiters.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </header>

            <div className="flex-1 overflow-y-auto p-ds-6">
                {loading ? (
                    <p role="status" className="py-8 text-center text-ds-content-muted">Loading team…</p>
                ) : loadError ? (
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                ) : team.length === 0 && invalidMemberships.length === 0 ? (
                    <p className="py-4 text-center italic text-ds-content-muted">No members found.</p>
                ) : (
                    <ul className="space-y-3">
                        {team.map(member => {
                            // A member always gets the best label available: their real
                            // name, else their email, else an explicit statement that the
                            // record has no identity — never a fabricated "Unknown" person.
                            const memberName = member.name || member.email || 'Unnamed member';
                            // Don't repeat the email underneath itself when it is
                            // standing in as the member's title.
                            const memberEmailLine = member.name
                                ? (member.email || 'No email on file')
                                : (member.email ? null : 'No email on file');
                            const statusInfo = MEMBER_STATUS[member.status];
                            const isDuplicated = member.duplicateMembershipCount > 0;
                            const goalErrorId = `manage-team-goal-error-${member.id}`;
                            const goalError = goalErrors[member.id];
                            return (
                                <li
                                    key={member.id}
                                    className="flex flex-col items-center justify-between gap-ds-4 rounded-ds-lg border border-ds-border bg-ds-surface p-ds-4 shadow-ds-xs lg:flex-row lg:flex-wrap"
                                >
                                    <div className="flex w-full min-w-0 items-center gap-ds-3 lg:w-1/3">
                                        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-surface-subtle font-bold text-ds-content-secondary">
                                            {member.name || member.email ? memberName.charAt(0).toUpperCase() : '?'}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate font-bold text-ds-content">{memberName}</p>
                                            {memberEmailLine && (
                                                <p className="truncate text-ds-xs text-ds-content-muted">
                                                    {memberEmailLine}
                                                </p>
                                            )}
                                            {(statusInfo || isDuplicated) && (
                                                <div className="mt-ds-1 flex flex-wrap items-center gap-ds-2">
                                                    {statusInfo && (
                                                        <Badge tone={statusInfo.tone} icon={AlertTriangle}>
                                                            {statusInfo.label}
                                                        </Badge>
                                                    )}
                                                    {isDuplicated && (
                                                        <Badge tone="warning" icon={AlertTriangle}>
                                                            Duplicate membership
                                                        </Badge>
                                                    )}
                                                </div>
                                            )}
                                            {statusInfo && (
                                                <p className="mt-ds-1 text-ds-xs text-ds-content-muted">{statusInfo.detail}</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex w-full flex-wrap items-center gap-ds-4 lg:w-auto">
                                        <div className="flex items-center gap-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2">
                                            <Phone size={14} className="text-ds-content-link" aria-hidden="true" />
                                            <div className="flex flex-col">
                                                <span className="text-ds-xs font-bold uppercase text-ds-content-muted">Dials</span>
                                                <input
                                                    type="number"
                                                    aria-label={`Daily dial goal for ${memberName}`}
                                                    aria-describedby={goalError ? goalErrorId : undefined}
                                                    aria-invalid={goalError ? true : undefined}
                                                    className="w-14 rounded-ds-sm bg-transparent text-center text-ds-sm font-bold text-ds-content outline-none focus-visible:shadow-ds-focus"
                                                    defaultValue={member.callGoal}
                                                    onBlur={(e) => handleSaveGoal(member.id, 'callGoal', e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2">
                                            <Users size={14} className="text-ds-status-success-fg" aria-hidden="true" />
                                            <div className="flex flex-col">
                                                <span className="text-ds-xs font-bold uppercase text-ds-content-muted">Contacts</span>
                                                <input
                                                    type="number"
                                                    aria-label={`Daily contact goal for ${memberName}`}
                                                    aria-describedby={goalError ? goalErrorId : undefined}
                                                    aria-invalid={goalError ? true : undefined}
                                                    className="w-14 rounded-ds-sm bg-transparent text-center text-ds-sm font-bold text-ds-content outline-none focus-visible:shadow-ds-focus"
                                                    defaultValue={member.contactGoal}
                                                    onBlur={(e) => handleSaveGoal(member.id, 'contactGoal', e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            aria-label={`Copy tracking link for ${memberName}`}
                                            onClick={() => handleCopyLink(member.id)}
                                        >
                                            <LinkIcon size={14} aria-hidden="true" /> Link
                                        </Button>

                                        <IconButton
                                            label={`Remove ${memberName} from the team`}
                                            variant="danger"
                                            size="sm"
                                            loading={deleteLoading === member.id}
                                            onClick={() => handleDeleteUser(member.id, memberName)}
                                        >
                                            <Trash2 size={14} aria-hidden="true" />
                                        </IconButton>
                                    </div>

                                    {goalError && (
                                        <FieldMessage id={goalErrorId} tone="error" className="w-full">
                                            {goalError}
                                        </FieldMessage>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}

                {/* Membership records with no user attached cannot be rendered as
                    people at all, so they are reported rather than dropped silently. */}
                {!loading && !loadError && invalidMemberships.length > 0 && (
                    <div className="mt-ds-4 flex flex-wrap items-center gap-ds-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-3">
                        <Badge tone="warning" icon={AlertTriangle}>Data issue</Badge>
                        <p className="text-ds-sm text-ds-content-secondary">
                            {invalidMemberships.length === 1
                                ? '1 membership record has no user attached and cannot be shown. Contact support to clean it up.'
                                : `${invalidMemberships.length} membership records have no user attached and cannot be shown. Contact support to clean them up.`}
                        </p>
                    </div>
                )}
            </div>

            {pendingDelete && (
                <Modal
                    onClose={() => setPendingDelete(null)}
                    labelledBy={confirmTitleId}
                    className="w-full max-w-sm rounded-ds-xl border border-ds-border bg-ds-surface p-ds-6 shadow-ds-lg"
                >
                    <h3 id={confirmTitleId} className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        Remove team member
                    </h3>
                    <p className="mb-ds-6 text-ds-content-secondary">
                        Are you sure you want to remove {pendingDelete.userName || 'this user'} from the team?
                    </p>
                    <div className="flex justify-end gap-ds-3">
                        <Button variant="secondary" onClick={() => setPendingDelete(null)}>
                            Cancel
                        </Button>
                        <Button variant="danger" onClick={confirmDeleteUser}>
                            Remove
                        </Button>
                    </div>
                </Modal>
            )}
        </Modal>
    );
}
