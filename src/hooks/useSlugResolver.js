// src/hooks/useSlugResolver.js
/**
 * useSlugResolver - Resolves company slugs via Firestore
 *
 * This hook queries the Firestore 'companies' collection to convert
 * a URL slug (e.g., "ray-star-llc") to a Firebase CompanyUID.
 *
 * This eliminates the redundant Cloud Function call and improves
 * initial page load performance.
 *
 * Features:
 * - Local cache to avoid redundant queries during session
 * - Error handling for invalid/missing slugs
 * - Loading state for UI feedback
 */

import { useState, useEffect, useCallback } from 'react';
import { db } from '@lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

// Local cache to avoid redundant queries during session
const LOCAL_CACHE = new Map();

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
            const q = query(
                collection(db, "companies"),
                where("appSlug", "==", normalizedSlug),
                limit(1)
            );
            const snap = await getDocs(q);

            if (snap.empty) {
                throw new Error("Company not found.");
            }

            const docSnap = snap.docs[0];
            const rawData = docSnap.data();
            const data = {
                companyId: docSnap.id,
                companyName: rawData.companyName,
                logoUrl: rawData.logoUrl,
                isActive: rawData.isActive ?? true
            };

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
        const q = query(
            collection(db, "companies"),
            where("appSlug", "==", normalizedSlug),
            limit(1)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            return { error: 'Company not found' };
        }

        const docSnap = snap.docs[0];
        const rawData = docSnap.data();
        const data = {
            companyId: docSnap.id,
            companyName: rawData.companyName,
            logoUrl: rawData.logoUrl,
            isActive: rawData.isActive ?? true
        };

        LOCAL_CACHE.set(normalizedSlug, data);
        return data;

    } catch (err) {
        return { error: err.message };
    }
}

export default useSlugResolver;
