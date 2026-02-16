import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { ERROR_MESSAGES } from '../constants/campaignConstants';

export function useCampaignTargeting(companyId, filters, currentUser) {
    const [matchCount, setMatchCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Debounce ref to prevent rapid-fire queries
    const timeoutRef = useRef(null);

    useEffect(() => {
        // --- 1. DEFENSIVE GUARDS ---
        if (!currentUser || !companyId) return;

        const fetchCount = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const getCountFn = httpsCallable(functions, 'getFilterCount');

                // Prepare backend-compatible filters
                const backendFilters = {
                    ...filters,
                    // Map booleans/strings to backend expectations if necessary
                    excludeRecentDays: filters.excludeRecentDays ? 7 : null,
                    campaignLimit: filters.campaignLimit ? parseInt(filters.campaignLimit) : null
                };

                const result = await getCountFn({ companyId, filters: backendFilters });
                let count = result.data.count || 0;

                // Apply client-side cap visualization if set
                if (backendFilters.campaignLimit) {
                    count = Math.min(count, backendFilters.campaignLimit);
                }

                setMatchCount(count);
                if (count === 0) setError(ERROR_MESSAGES.ZERO_RESULTS);

            } catch (err) {
                console.error("Targeting Error:", err);
                setMatchCount(0);
                setError("Failed to calculate audience.");
            } finally {
                setIsLoading(false);
            }
        };

        // Clear previous timeout
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Set new timeout (Debounce 500ms)
        timeoutRef.current = setTimeout(fetchCount, 500);

        return () => clearTimeout(timeoutRef.current);
    }, [
        // Deep dependency check on relevant filter keys to trigger re-fetch
        filters.leadType,
        filters.status?.join(','), // Join array to primitive for stable comparison
        filters.recruiterId,
        filters.createdAfter,
        filters.notContactedSince,
        filters.lastCallOutcome,
        filters.segmentId,
        filters.excludeRecentDays,
        filters.campaignLimit,
        companyId,
        currentUser
    ]);

    return { matchCount, isLoading, error };
}
