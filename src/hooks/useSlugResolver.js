// src/hooks/useSlugResolver.js
/**
 * useSlugResolver - Resolves company slugs via backend
 *
 * This hook calls the backend resolveCompanySlug function to convert
 * a URL slug (e.g., "ray-star-llc") to a Firebase CompanyUID.
 *
 * This eliminates the client-side slug resolution that was identified
 * as a fragile routing risk in the architecture review.
 *
 * Features:
 * - Local cache to avoid redundant API calls
 * - Error handling for invalid/missing slugs
 * - Loading state for UI feedback
 */

import { useState, useEffect, useCallback } from 'react';

// Local cache to avoid redundant API calls during session
const LOCAL_CACHE = new Map();

// Function URLs by environment
const FUNCTION_BASE_URL = import.meta.env.PROD
    ? 'https://us-central1-truckerapp-system.cloudfunctions.net'
    : 'https://us-central1-truckerapp-system.cloudfunctions.net'; // Same for now

/**
 * Hook to resolve a company slug to its Firebase UID via backend
 *
 * @param {string} slug - The company slug from the URL
 * @returns {{ companyId, companyName, loading, error, refetch }}
 */
export function useSlugResolver(slug) {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const resolve = useCallback(async (slugToResolve) => {
        if (!slugToResolve) {
            setLoading(false);
            setError('No slug provided');
            return;
        }

        const normalizedSlug = slugToResolve.toLowerCase().trim();

        // Check local cache first
        if (LOCAL_CACHE.has(normalizedSlug)) {
            const cached = LOCAL_CACHE.get(normalizedSlug);
            setResult(cached);
            setLoading(false);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${FUNCTION_BASE_URL}/resolveCompanySlug?slug=${encodeURIComponent(normalizedSlug)}`
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to resolve company (${response.status})`);
            }

            const data = await response.json();

            // Cache the result
            LOCAL_CACHE.set(normalizedSlug, data);
            setResult(data);

        } catch (err) {
            console.error('[useSlugResolver] Error:', err);
            setError(err.message);
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, []);

    // Resolve on mount or when slug changes
    useEffect(() => {
        resolve(slug);
    }, [slug, resolve]);

    // Provide a refetch function
    const refetch = useCallback(() => {
        // Clear cache for this slug and re-resolve
        if (slug) {
            LOCAL_CACHE.delete(slug.toLowerCase().trim());
            resolve(slug);
        }
    }, [slug, resolve]);

    return {
        companyId: result?.companyId || null,
        companyName: result?.companyName || null,
        logoUrl: result?.logoUrl || null,
        isActive: result?.isActive ?? true,
        loading,
        error,
        refetch
    };
}

/**
 * Standalone function to resolve slug without React hook
 * Useful for non-component code (e.g., services)
 *
 * @param {string} slug - The company slug
 * @returns {Promise<{ companyId, companyName, isActive, error? }>}
 */
export async function resolveSlug(slug) {
    if (!slug) {
        return { error: 'No slug provided' };
    }

    const normalizedSlug = slug.toLowerCase().trim();

    // Check local cache
    if (LOCAL_CACHE.has(normalizedSlug)) {
        return LOCAL_CACHE.get(normalizedSlug);
    }

    try {
        const response = await fetch(
            `${FUNCTION_BASE_URL}/resolveCompanySlug?slug=${encodeURIComponent(normalizedSlug)}`
        );

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return { error: errData.error || `Failed to resolve (${response.status})` };
        }

        const data = await response.json();
        LOCAL_CACHE.set(normalizedSlug, data);
        return data;

    } catch (err) {
        return { error: err.message };
    }
}

export default useSlugResolver;
