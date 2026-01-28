import { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import {
    collection, query, where, getDocs,
    limit, Timestamp, getCountFromServer
} from 'firebase/firestore';
import {
    APPLICATION_STATUSES,
    LAST_CALL_RESULTS,
    getDbValue,
    ERROR_MESSAGES
} from '../constants/campaignConstants';

export function useCampaignTargeting(companyId, currentUser, isAuthLoading) {
    const [filters, setFilters] = useState({
        recruiterId: 'all',
        status: [],
        leadType: 'applications',
        limit: 100,
        createdAfter: '',
        notContactedSince: '',
        lastCallOutcome: 'all'
    });

    const [previewLeads, setPreviewLeads] = useState([]);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [matchCount, setMatchCount] = useState(0);
    const [previewError, setPreviewError] = useState(null);

    useEffect(() => {
        let isCancelled = false;

        const fetchTargetingData = async () => {
            // --- 1. DEFENSIVE GUARDS (Bulletproof Logic) ---
            if (isAuthLoading) {
                setPreviewError(ERROR_MESSAGES.LOADING);
                return;
            }
            if (!currentUser) {
                setPreviewError(ERROR_MESSAGES.MISSING_AUTH);
                return;
            }
            if (!companyId) {
                setPreviewError(ERROR_MESSAGES.MISSING_COMPANY);
                return;
            }

            setIsPreviewLoading(true);
            setPreviewError(null);

            try {
                let q;

                // --- 2. SMART SEGMENT BYPASS ---
                if (filters.segmentId && filters.segmentId !== 'all') {
                    q = query(collection(db, 'companies', companyId, 'segments', filters.segmentId, 'members'));
                } else {
                    // --- 3. DYNAMIC FILTERING (Using Unified Dictionary) ---
                    let baseRef;
                    if (filters.leadType === 'global') {
                        baseRef = collection(db, 'leads');
                    } else if (filters.leadType === 'leads') {
                        // Allow ALL leads in the company's subcollection, not just platform leads
                        // This fixes issues where imported/migrated leads aren't shown
                        baseRef = collection(db, 'companies', companyId, 'leads');
                    } else {
                        baseRef = collection(db, 'companies', companyId, 'applications');
                    }

                    q = query(baseRef);

                    // Status Filter (Mapped from Dictionary)
                    if (filters.status && filters.status.length > 0 && filters.status !== 'all') {
                        const dbStatuses = filters.status.map(s => getDbValue(s, APPLICATION_STATUSES));
                        q = query(q, where('status', 'in', dbStatuses));
                    }

                    // Recruiter Filter
                    if (filters.recruiterId === 'my_leads') {
                        q = query(q, where('assignedTo', '==', currentUser.uid));
                    } else if (filters.recruiterId && filters.recruiterId !== 'all') {
                        q = query(q, where('assignedTo', '==', filters.recruiterId));
                    }

                    // Created After Filter
                    if (filters.createdAfter) {
                        const date = new Date(filters.createdAfter);
                        q = query(q, where('createdAt', '>=', Timestamp.fromDate(date)));
                    }

                    // Not Contacted Since Filter
                    if (filters.notContactedSince) {
                        const days = parseInt(filters.notContactedSince);
                        const date = new Date();
                        date.setDate(date.getDate() - days);
                        q = query(q, where('lastContactedAt', '<=', Timestamp.fromDate(date)));
                    }

                    // Last Call Outcome Filter (Mapped from Dictionary)
                    if (filters.lastCallOutcome && filters.lastCallOutcome !== 'all') {
                        const dbOutcome = getDbValue(filters.lastCallOutcome, LAST_CALL_RESULTS);
                        q = query(q, where('lastCallOutcome', '==', dbOutcome));
                    }
                }

                // Fetch Count
                const countSnap = await getCountFromServer(q);
                const count = countSnap.data().count;

                if (!isCancelled) {
                    setMatchCount(count);
                    // --- 4. ZERO RESULTS HANDLING ---
                    if (count === 0) {
                        setPreviewError(ERROR_MESSAGES.ZERO_RESULTS);
                    }
                }

                // Fetch Preview
                const snap = await getDocs(query(q, limit(filters.limit)));
                if (!isCancelled) {
                    setPreviewLeads(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                }

            } catch (err) {
                console.error("Targeting Error:", err);
                if (!isCancelled) {
                    setPreviewLeads([]);
                    setMatchCount(0);
                    setPreviewError(err.message);
                }
            } finally {
                if (!isCancelled) setIsPreviewLoading(false);
            }
        };

        const timer = setTimeout(fetchTargetingData, 500);
        return () => { isCancelled = true; clearTimeout(timer); };
    }, [
        filters.leadType,
        filters.status,
        filters.recruiterId,
        filters.createdAfter,
        filters.notContactedSince,
        filters.lastCallOutcome,
        filters.segmentId,
        filters.limit,
        companyId,
        currentUser,
        isAuthLoading
    ]);

    return {
        filters, setFilters,
        previewLeads, isPreviewLoading,
        matchCount, previewError
    };
}
