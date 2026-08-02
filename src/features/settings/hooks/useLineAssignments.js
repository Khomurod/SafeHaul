/**
 * useLineAssignments
 * ==================
 * Data/logic layer for the SMS number-assignment settings screen.
 * Extracted verbatim from NumberAssignmentManager.jsx — behavior unchanged:
 *  - live listener on the sms_provider integration doc
 *  - roster fetch (memberships -> users)
 *  - surfacing assignments whose owner is missing from the roster
 *  - one-time legacy line-token backfill
 *  - line verification + token-based save via saveSmsLineAssignments
 */
import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db, functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { sanitizePhone } from '../utils/linePhone';

export function useLineAssignments(companyId) {
    const { showSuccess, showError } = useToast();
    const [configDoc, setConfigDoc] = useState(null);
    const [configError, setConfigError] = useState(null);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Connection verification state
    const [verifyingLine, setVerifyingLine] = useState(null); // phoneNumber
    const [lineStatuses, setLineStatuses] = useState({}); // { phoneNumber: { success: bool, timestamp, identity } }

    // Local state for edits before save
    const [assignments, setAssignments] = useState({});
    const [initialAssignments, setInitialAssignments] = useState({});
    const [defaultNumber, setDefaultNumber] = useState('');
    const [assignmentTokenOverrides, setAssignmentTokenOverrides] = useState({});
    const [savedAssignmentTokens, setSavedAssignmentTokens] = useState({});
    const [defaultTokenOverride, setDefaultTokenOverride] = useState(null);
    const [savedDefaultToken, setSavedDefaultToken] = useState('');
    const tokenBackfillAttempted = useRef({}); // companyId -> bool (one-time auto-heal guard)

    const hasTokenChanges = Object.keys(assignmentTokenOverrides).length > 0 || defaultTokenOverride !== null;
    const hasChanges = JSON.stringify(assignments) !== JSON.stringify(initialAssignments) ||
        defaultNumber !== (configDoc?.defaultPhoneNumber || configDoc?.config?.defaultPhoneNumber || '') ||
        hasTokenChanges;

    useEffect(() => {
        if (!companyId) return;

        // 1. Listen to Integration Doc
        const unsub = onSnapshot(doc(db, 'companies', companyId, 'integrations', 'sms_provider'), (snap) => {
            setConfigError(null);
            if (snap.exists()) {
                const data = snap.data();
                console.log("[SMS Config] Loaded Data:", data);
                setConfigDoc(data);

                // Sanitize incoming assignments
                const incomingAssignments = data.assignments || {};
                const sanitizedMap = {};
                Object.keys(incomingAssignments).forEach(uid => {
                    sanitizedMap[uid] = sanitizePhone(incomingAssignments[uid]);
                });

                setAssignments(sanitizedMap);
                setInitialAssignments(JSON.parse(JSON.stringify(sanitizedMap))); // Deep copy
                setDefaultNumber(sanitizePhone(data.defaultPhoneNumber || data.config?.defaultPhoneNumber || ''));
                setAssignmentTokenOverrides({});
                setSavedAssignmentTokens(data.assignmentLineTokens || {});
                setDefaultTokenOverride(null);
                setSavedDefaultToken(data.defaultLineToken || '');
            } else {
                console.log("[SMS Config] Document does not exist.");
                setConfigDoc(null);
            }
            setLoading(false);
        }, (error) => {
            // Defect fix: `onSnapshot` was called with no error callback, so a failed
            // listen (permission denied, rules change, Firestore outage) left `loading`
            // stuck `true` forever and the screen showed "Loading inventory..." with no
            // way out and nothing logged for the user. Settle the state and surface the
            // failure instead of spinning silently.
            console.error('[SMS Config] Listener failed:', error);
            setConfigDoc(null);
            setConfigError(error);
            setLoading(false);
        });

        // 2. Fetch Users (Recruiters/Admins)
        const fetchUsers = async () => {
            try {
                // Get memberships
                const q = query(collection(db, 'memberships'), where('companyId', '==', companyId));
                const memberSnap = await getDocs(q);

                const membershipMap = {};
                const memberUserIds = [];

                memberSnap.docs.forEach(d => {
                    const data = d.data();
                    if (data.userId) {
                        memberUserIds.push(data.userId);
                        membershipMap[data.userId] = data.role;
                    }
                });

                if (memberUserIds.length === 0) {
                    setUsers([]);
                    return;
                }

                // Batch fetch users
                const batchSize = 30;
                const fetchedUsers = [];

                for (let i = 0; i < memberUserIds.length; i += batchSize) {
                    const batchIds = memberUserIds.slice(i, i + batchSize);
                    const userQ = query(
                        collection(db, 'users'),
                        where(documentId(), 'in', batchIds)
                    );
                    const userSnap = await getDocs(userQ);
                    userSnap.docs.forEach(d => {
                        fetchedUsers.push({
                            id: d.id,
                            ...d.data(),
                            role: membershipMap[d.id]
                        });
                    });
                }

                setUsers(fetchedUsers);
            } catch (e) {
                console.error("Error fetching users for assignment", e);
            }
        };

        fetchUsers();

        return () => unsub();
    }, [companyId]);

    // One-time auto-heal for LEGACY assignments. If a company already had line
    // assignments / a default line saved as raw phone numbers (before stable line
    // tokens existed), the doc has `assignments` but no `assignmentLineTokens`. A
    // browser that redacts phone numbers then can't connect the saved phone to a line
    // and shows "No Direct Line" even though the assignment is live. We ask the backend
    // (which sees the real phones) to backfill the line tokens exactly once. This is
    // non-destructive: it changes no assignment, only fills in the missing token map.
    useEffect(() => {
        if (!companyId || !configDoc) return;
        if (tokenBackfillAttempted.current[companyId]) return;

        const assignmentKeys = Object.keys(configDoc.assignments || {});
        const hasAnyToken = Object.values(configDoc.assignmentLineTokens || {}).some(Boolean);
        const defaultNeedsToken = !!configDoc.defaultPhoneNumber && !configDoc.defaultLineToken;
        const needsHeal = (assignmentKeys.length > 0 && !hasAnyToken) || defaultNeedsToken;
        if (!needsHeal) return;

        tokenBackfillAttempted.current[companyId] = true;
        (async () => {
            try {
                const backfill = httpsCallable(functions, 'saveSmsLineAssignments');
                // Empty assignmentTokens => no assignment is changed; the callable just
                // backfills the missing line tokens from the authoritative inventory.
                await backfill({ companyId, assignmentTokens: {} });
            } catch (e) {
                console.warn('[SMS] line-token backfill skipped:', e?.message || e);
            }
        })();
    }, [companyId, configDoc]);

    // Surface EVERY user that has a line assigned, even when the company
    // memberships -> users join did not return them. A number can be linked and
    // actively sending while its owner is missing from the roster (a former
    // member, a missing/!companyId membership record, or an account whose
    // users-doc id differs from the uid the assignment was keyed by). Without
    // this, that assignment is invisible: the matrix only renders rows built
    // from memberships, so the linked number silently shows as unassigned for
    // everyone. We resolve any assignment-key uid that isn't already listed and
    // append it (flagged), so the assignment is always visible and manageable.
    useEffect(() => {
        const assignedUids = Object.keys(assignments || {}).filter(
            (uid) => uid && sanitizePhone(assignments[uid])
        );
        if (assignedUids.length === 0) return;

        const known = new Set(users.map((u) => u.id));
        const missing = assignedUids.filter((uid) => !known.has(uid));
        if (missing.length === 0) return;

        let cancelled = false;
        (async () => {
            const extras = [];
            const resolved = new Set();
            for (let i = 0; i < missing.length; i += 30) {
                const batch = missing.slice(i, i + 30);
                try {
                    const snap = await getDocs(
                        query(collection(db, 'users'), where(documentId(), 'in', batch))
                    );
                    snap.docs.forEach((d) => {
                        resolved.add(d.id);
                        extras.push({ id: d.id, ...d.data(), role: 'external', _unlinkedAssignment: true });
                    });
                } catch (e) {
                    console.error('[SMS Config] Failed to resolve assigned user docs', e);
                }
            }
            // Assignment keys with no users doc at all still get a placeholder row
            // so the dangling assignment is visible and can be cleared/reassigned.
            missing.forEach((uid) => {
                if (!resolved.has(uid)) {
                    extras.push({ id: uid, name: 'Unknown / former user', email: uid, role: 'unassigned', _unlinkedAssignment: true });
                }
            });
            if (!cancelled && extras.length) {
                setUsers((prev) => {
                    const ids = new Set(prev.map((p) => p.id));
                    const merged = extras.filter((e) => !ids.has(e.id));
                    return merged.length ? [...prev, ...merged] : prev;
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [assignments, users]);

    const handleVerifyLine = async (phoneNumber) => {
        // Guard against malformed/blank numbers (the bare "+") reaching the backend.
        if (!phoneNumber || phoneNumber.replace(/[^0-9]/g, '').length === 0) return;
        setVerifyingLine(phoneNumber);

        try {
            const verifyFn = httpsCallable(functions, 'verifyLineConnection');
            const result = await verifyFn({ companyId, phoneNumber });

            setLineStatuses(prev => ({
                ...prev,
                [phoneNumber]: {
                    success: true,
                    identity: result.data.identity,
                    timestamp: result.data.timestamp
                }
            }));
            showSuccess(`Line ${phoneNumber} is active (${result.data.identity})`);
        } catch (error) {
            console.error(`Verification Failed: ${phoneNumber}`, error);
            setLineStatuses(prev => ({
                ...prev,
                [phoneNumber]: {
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                }
            }));
            showError(`Line ${phoneNumber} connection failed: ${error.message}`);
        } finally {
            setVerifyingLine(null);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Save through the backend by stable line tokens instead of raw phone values.
            // Some browser/privacy layers redact phone numbers in Firestore snapshots before
            // React sees them, so saving raw <option> phone values can turn a selected line
            // into an empty string. The callable re-reads the authoritative inventory with
            // Admin SDK and maps stable line IDs back to real phone numbers server-side.
            const saveAssignments = httpsCallable(functions, 'saveSmsLineAssignments');
            await saveAssignments({
                companyId,
                assignmentTokens: assignmentTokenOverrides,
                ...(defaultTokenOverride !== null ? { defaultToken: defaultTokenOverride } : {})
            });

            setInitialAssignments(JSON.parse(JSON.stringify(assignments)));
            setSavedAssignmentTokens(prev => ({ ...prev, ...assignmentTokenOverrides }));
            if (defaultTokenOverride !== null) setSavedDefaultToken(defaultTokenOverride);
            setAssignmentTokenOverrides({});
            setDefaultTokenOverride(null);
            showSuccess("Assignments updated successfully.");
        } catch (error) {
            console.error(error);
            showError("Failed to save assignments.");
        } finally {
            setSaving(false);
        }
    };

    // Warn about unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (hasChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasChanges]);

    return {
        loading,
        configDoc,
        configError,
        users,
        saving,
        verifyingLine,
        lineStatuses,
        assignments,
        setAssignments,
        defaultNumber,
        setDefaultNumber,
        assignmentTokenOverrides,
        setAssignmentTokenOverrides,
        savedAssignmentTokens,
        defaultTokenOverride,
        setDefaultTokenOverride,
        savedDefaultToken,
        hasChanges,
        handleVerifyLine,
        handleSave,
    };
}
