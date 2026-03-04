// src/features/company-admin/hooks/usePipelineEntries.js
// Custom hook for pipeline tracking — real-time listener, sorting, optimistic updates, debounced saves.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '@lib/firebase';

// --- Sorting priority: 0 = top, 2 = bottom ---
const STAGE_PRIORITY = { hired: 0, rejected: 0, on_hold: 1, in_process: 2 };

/**
 * Multi-tier sort for pipeline entries:
 * Tier 1 (Top): hired/rejected — sorted by statusChangedAt DESC
 * Tier 2 (Middle): on_hold — sorted by statusChangedAt DESC
 * Tier 3 (Bottom): in_process — sorted by lastModifiedAt DESC
 */
function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        const tierA = STAGE_PRIORITY[a.hiringStage] ?? 2;
        const tierB = STAGE_PRIORITY[b.hiringStage] ?? 2;
        if (tierA !== tierB) return tierA - tierB;

        // Within Tier 0 and 1: sort by statusChangedAt DESC
        if (tierA <= 1) {
            const tsA = a.statusChangedAt?.toMillis?.() || a._localStatusChangedAt || 0;
            const tsB = b.statusChangedAt?.toMillis?.() || b._localStatusChangedAt || 0;
            return tsB - tsA;
        }

        // Within Tier 2 (in_process): sort by lastModifiedAt DESC
        const tsA = a.lastModifiedAt?.toMillis?.() || a._localLastModifiedAt || 0;
        const tsB = b.lastModifiedAt?.toMillis?.() || b._localLastModifiedAt || 0;
        return tsB - tsA;
    });
}

export function usePipelineEntries(companyId) {
    const [rawEntries, setRawEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const debounceTimers = useRef({});
    const rawEntriesRef = useRef(rawEntries);
    rawEntriesRef.current = rawEntries;
    const prevSortedRef = useRef([]);

    // --- Real-Time Listener ---
    useEffect(() => {
        if (!companyId) {
            setRawEntries([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const colRef = collection(db, 'companies', companyId, 'pipeline_entries');

        const unsubscribe = onSnapshot(colRef, (snapshot) => {
            const entries = snapshot.docs.map((docSnap) => ({
                id: docSnap.id,
                ...docSnap.data(),
            }));
            setRawEntries(entries);
            setLoading(false);
        }, (error) => {
            console.error('[Pipeline] Snapshot error:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    // --- Sorted entries via useMemo ---
    // Freeze sort order while a cell is being actively edited to prevent row jumping.
    const entries = useMemo(() => {
        if (editingId) {
            // Preserve current row order but pick up updated field values
            const map = new Map(rawEntries.map(e => [e.id, e]));
            const result = prevSortedRef.current
                .map(e => map.get(e.id))
                .filter(Boolean);
            // Append any brand-new entries not yet in the previous order
            const existing = new Set(result.map(e => e.id));
            rawEntries.forEach(e => { if (!existing.has(e.id)) result.push(e); });
            prevSortedRef.current = result;
            return result;
        }
        const sorted = sortEntries(rawEntries);
        prevSortedRef.current = sorted;
        return sorted;
    }, [rawEntries, editingId]);

    // --- Add Entry ---
    const addEntry = useCallback(async (data = {}) => {
        if (!companyId) return;
        const colRef = collection(db, 'companies', companyId, 'pipeline_entries');
        const newDocRef = doc(colRef);

        const newEntry = {
            driverName: data.driverName || '',
            driverType: data.driverType || 'Company Driver',
            phoneNumber: data.phoneNumber || '',
            hiringStage: 'in_process',
            comments: '',
            lastModifiedAt: serverTimestamp(),
            statusChangedAt: serverTimestamp(),
            lastCheckedDisplay: '',
            createdAt: serverTimestamp(),
        };

        // Optimistic: add to local state immediately
        const optimisticEntry = {
            ...newEntry,
            id: newDocRef.id,
            _localLastModifiedAt: Date.now(),
            _localStatusChangedAt: Date.now(),
        };
        setRawEntries(prev => [...prev, optimisticEntry]);

        try {
            await setDoc(newDocRef, newEntry);
        } catch (error) {
            console.error('[Pipeline] Failed to add entry:', error);
            // Revert optimistic add
            setRawEntries(prev => prev.filter(e => e.id !== newDocRef.id));
        }
    }, [companyId]);

    // --- Update Field (optimistic) ---
    const updateField = useCallback(async (entryId, field, value) => {
        if (!companyId || !entryId) return;

        const isStageChange = field === 'hiringStage';

        // Optimistic local update
        setRawEntries(prev => prev.map(e => {
            if (e.id !== entryId) return e;
            const updated = { ...e, [field]: value, _localLastModifiedAt: Date.now() };
            if (isStageChange) {
                updated._localStatusChangedAt = Date.now();
            }
            return updated;
        }));

        // Firestore write
        const docRef = doc(db, 'companies', companyId, 'pipeline_entries', entryId);
        const payload = { [field]: value, lastModifiedAt: serverTimestamp() };
        if (isStageChange) {
            payload.statusChangedAt = serverTimestamp();
        }

        try {
            await updateDoc(docRef, payload);
        } catch (error) {
            console.error('[Pipeline] Failed to update field:', error);
        }
    }, [companyId]);

    // --- Update Comments (debounced 500ms) ---
    const updateComments = useCallback((entryId, value) => {
        if (!companyId || !entryId) return;

        // Optimistic local update (immediate) — do NOT update _localLastModifiedAt
        // because that would trigger a re-sort and unmount the editing cell
        setRawEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, comments: value } : e
        ));

        // Clear existing debounce timer for this entry
        if (debounceTimers.current[entryId]) {
            clearTimeout(debounceTimers.current[entryId]);
        }

        // Set new debounce timer
        debounceTimers.current[entryId] = setTimeout(async () => {
            const docRef = doc(db, 'companies', companyId, 'pipeline_entries', entryId);
            try {
                await updateDoc(docRef, {
                    comments: value,
                    lastModifiedAt: serverTimestamp(),
                });
            } catch (error) {
                console.error('[Pipeline] Failed to save comments:', error);
            }
            delete debounceTimers.current[entryId];
        }, 500);
    }, [companyId]);

    // --- Delete Entry ---
    const deleteEntry = useCallback(async (entryId) => {
        if (!companyId || !entryId) return;

        // Snapshot current entries for revert via ref (avoids stale closure)
        const previousEntries = rawEntriesRef.current;
        setRawEntries(prev => prev.filter(e => e.id !== entryId));

        const docRef = doc(db, 'companies', companyId, 'pipeline_entries', entryId);
        try {
            await deleteDoc(docRef);
        } catch (error) {
            console.error('[Pipeline] Failed to delete entry:', error);
            // Revert
            setRawEntries(previousEntries);
        }
    }, [companyId]);

    // --- Edit-lock helpers (freeze sort while editing) ---
    const beginEdit = useCallback((entryId) => setEditingId(entryId), []);
    const endEdit = useCallback(() => setEditingId(null), []);

    // --- Cleanup debounce timers on unmount ---
    useEffect(() => {
        return () => {
            Object.values(debounceTimers.current).forEach(clearTimeout);
        };
    }, []);

    return {
        entries,
        loading,
        addEntry,
        updateField,
        updateComments,
        deleteEntry,
        beginEdit,
        endEdit,
        entryCount: entries.length,
    };
}
