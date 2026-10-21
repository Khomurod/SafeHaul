import { useState, useEffect, useRef, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { ERROR_MESSAGES, UPLOAD_EXCLUDE_DEFAULT } from '../constants/campaignConstants';

/**
 * The audience count for a campaign of `method`'s channel ('sms' or 'email').
 * "Already messaged" is a recipient a campaign of the same channel reached
 * inside the window (`functions/bulkActions/helpers/recentlyMessaged.js`):
 * `alreadyMessaged` says how many the count leaves out, and for an uploaded
 * list `alreadyMessagedKeys` names those rows by their preview key.
 */
export function useCampaignTargeting(companyId, filters, currentUser, method = 'sms') {
    const [matchCount, setMatchCount] = useState(0);
    const [alreadyMessaged, setAlreadyMessaged] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    // The uploaded rows a campaign of this channel already reached, by row key.
    const [alreadyMessagedKeys, setAlreadyMessagedKeys] = useState(new Set());

    // Debounce ref to prevent rapid-fire queries
    const timeoutRef = useRef(null);
    // Bumped by `retry` to count the same filters again after a failure.
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    useEffect(() => {
        // --- 1. DEFENSIVE GUARDS ---
        if (!currentUser || !companyId) return;

        // An answer for filters the recruiter has since changed arrives too late
        // to count: it must not overwrite the count for the current ones.
        let stale = false;

        const fetchCount = async () => {
            setIsLoading(true);
            setError(null);

            // Import mode: ask which rows this channel already reached.
            if (filters.leadType === 'import') {
                const rawData = filters.rawData || [];
                const importCount = rawData.length;
                setAlreadyMessaged(0);

                if (importCount === 0) {
                    setMatchCount(0);
                    setAlreadyMessagedKeys(new Set());
                    setError(ERROR_MESSAGES.ZERO_RESULTS);
                    setIsLoading(false);
                    return;
                }

                // The window the screen shows applies until another is picked;
                // only "No Exclusion" returns the raw count.
                const excludeSetting = filters.excludeRecentDays || UPLOAD_EXCLUDE_DEFAULT;
                if (excludeSetting === 'off') {
                    setMatchCount(importCount);
                    setAlreadyMessagedKeys(new Set());
                    setIsLoading(false);
                    return;
                }

                // Each row by the key the preview and the launch name it by.
                const recipients = rawData.map((row, index) => ({
                    key: row.id || `import_${index}`,
                    phone: row.normalizedPhone || row.phone || '',
                    email: row.email || '',
                }));

                try {
                    const checkFn = httpsCallable(functions, 'checkImportPhones');
                    const result = await checkFn({
                        companyId,
                        method,
                        excludeRecentDays: excludeSetting,
                        recipients,
                    });
                    if (stale) return;

                    const excluded = new Set(result.data.excludedKeys || []);
                    setAlreadyMessagedKeys(excluded);
                    setAlreadyMessaged(excluded.size);
                    const filteredCount = Math.max(0, importCount - excluded.size);
                    setMatchCount(filteredCount);
                    if (filteredCount === 0) setError(ERROR_MESSAGES.ZERO_RESULTS);
                } catch (err) {
                    if (stale) return;
                    console.error('checkImportPhones error:', err);
                    // Non-fatal: fall back to raw count so the user isn't blocked
                    setMatchCount(importCount);
                    setAlreadyMessagedKeys(new Set());
                } finally {
                    if (!stale) setIsLoading(false);
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

                const result = await getCountFn({ companyId, filters: backendFilters, method });
                if (stale) return;
                let count = result.data.count || 0;
                setAlreadyMessaged(result.data.alreadyMessaged || 0);

                // Apply client-side cap visualization if set
                if (backendFilters.campaignLimit) {
                    count = Math.min(count, backendFilters.campaignLimit);
                }

                setMatchCount(count);
                setAlreadyMessagedKeys(new Set());
                if (count === 0) setError(ERROR_MESSAGES.ZERO_RESULTS);

            } catch (err) {
                if (stale) return;
                console.error("Targeting Error:", err);
                setMatchCount(0);
                setAlreadyMessaged(0);
                setAlreadyMessagedKeys(new Set());
                setError(ERROR_MESSAGES.COUNT_FAILED);
            } finally {
                if (!stale) setIsLoading(false);
            }
        };

        // Clear previous timeout
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Set new timeout (Debounce 500ms)
        timeoutRef.current = setTimeout(fetchCount, 500);

        return () => {
            stale = true;
            clearTimeout(timeoutRef.current);
        };
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
        method,
        companyId,
        currentUser,
        attempt
    ]);

    return { matchCount, alreadyMessaged, isLoading, error, alreadyMessagedKeys, retry };
}
