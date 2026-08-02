import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { ERROR_MESSAGES } from '../constants/campaignConstants';

export function useCampaignTargeting(companyId, filters, currentUser) {
    const [matchCount, setMatchCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    // Set of normalized phone strings that should be excluded (import mode only)
    const [excludedPhones, setExcludedPhones] = useState(new Set());

    // Debounce ref to prevent rapid-fire queries
    const timeoutRef = useRef(null);

    useEffect(() => {
        // --- 1. DEFENSIVE GUARDS ---
        if (!currentUser || !companyId) return;

        const fetchCount = async () => {
            setIsLoading(true);
            setError(null);

            // Import mode: check sms_sent_phones for already-messaged numbers
            if (filters.leadType === 'import') {
                const rawData = filters.rawData || [];
                const importCount = rawData.length;

                if (importCount === 0) {
                    setMatchCount(0);
                    setExcludedPhones(new Set());
                    setError(ERROR_MESSAGES.ZERO_RESULTS);
                    setIsLoading(false);
                    return;
                }

                // If no exclusion filter is set, just return raw count
                const excludeSetting = filters.excludeRecentDays;
                if (!excludeSetting || excludeSetting === 'off') {
                    setMatchCount(importCount);
                    setExcludedPhones(new Set());
                    setIsLoading(false);
                    return;
                }

                // Extract normalized phones from the imported rows
                const phones = rawData
                    .map(row => row.normalizedPhone)
                    .filter(p => p && p.length > 0);

                try {
                    const checkFn = httpsCallable(functions, 'checkImportPhones');
                    const result = await checkFn({
                        companyId,
                        phones,
                        excludeRecentDays: excludeSetting
                    });

                    const excluded = new Set(result.data.excludedPhones || []);
                    setExcludedPhones(excluded);
                    const filteredCount = Math.max(0, importCount - excluded.size);
                    setMatchCount(filteredCount);
                    if (filteredCount === 0) setError(ERROR_MESSAGES.ZERO_RESULTS);
                } catch (err) {
                    console.error('checkImportPhones error:', err);
                    // Non-fatal: fall back to raw count so the user isn't blocked
                    setMatchCount(importCount);
                    setExcludedPhones(new Set());
                } finally {
                    setIsLoading(false);
                }
                return;
            }

            try {
                const getCountFn = httpsCallable(functions, 'getFilterCount');

                // Prepare backend-compatible filters
                const backendFilters = {
                    ...filters,
                    // Map booleans/strings to backend expectations if necessary
                    excludeRecentDays: (filters.excludeRecentDays && filters.excludeRecentDays !== 'off')
                        ? filters.excludeRecentDays
                        : null,
                    campaignLimit: filters.campaignLimit ? parseInt(filters.campaignLimit) : null
                };

                const result = await getCountFn({ companyId, filters: backendFilters });
                let count = result.data.count || 0;

                // Apply client-side cap visualization if set
                if (backendFilters.campaignLimit) {
                    count = Math.min(count, backendFilters.campaignLimit);
                }

                setMatchCount(count);
                setExcludedPhones(new Set());
                if (count === 0) setError(ERROR_MESSAGES.ZERO_RESULTS);

            } catch (err) {
                console.error("Targeting Error:", err);
                setMatchCount(0);
                setExcludedPhones(new Set());
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
        filters.rawData,        // Re-check when import data changes
        companyId,
        currentUser
    ]);

    return { matchCount, isLoading, error, excludedPhones };
}
