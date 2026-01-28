// src/hooks/useLeadWithSource.js
/**
 * useLeadWithSource - Hydrates lead references with source data
 *
 * This hook solves the Ghost Lead problem by working with a reference-based
 * lead model. Company leads now store only a reference to the source lead
 * plus company-specific operational data (status, assignedTo, etc.).
 *
 * Features:
 * - Hydrates leadRef or originalLeadId to get full lead data
 * - Merges source data with company operational data
 * - Handles legacy leads that have full data inline
 * - Provides loading state for async hydration
 */

import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';

// In-memory cache for source leads (reduces Firestore reads)
const sourceCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Hydrate a single company lead with its source data
 *
 * @param {object} companyLead - The company-specific lead document
 * @returns {{ lead, loading, error }}
 */
export function useLeadWithSource(companyLead) {
    const [hydratedLead, setHydratedLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!companyLead) {
            setLoading(false);
            return;
        }

        // If lead already has full data (legacy model), use as-is
        if (companyLead.firstName && !companyLead.leadRef && !companyLead.originalLeadId) {
            setHydratedLead(companyLead);
            setLoading(false);
            return;
        }

        // Determine source document path
        const sourceId = companyLead.originalLeadId || null;
        const sourcePath = companyLead.leadRef || (sourceId ? `leads/${sourceId}` : null);

        if (!sourcePath) {
            // No reference available, use company lead as-is
            setHydratedLead(companyLead);
            setLoading(false);
            return;
        }

        const hydrate = async () => {
            setLoading(true);
            setError(null);

            try {
                // Check cache
                const cached = sourceCache.get(sourcePath);
                if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                    setHydratedLead(mergeLeadData(cached.data, companyLead));
                    setLoading(false);
                    return;
                }

                // Fetch source document
                const sourceRef = doc(db, sourcePath);
                const sourceSnap = await getDoc(sourceRef);

                if (sourceSnap.exists()) {
                    const sourceData = sourceSnap.data();

                    // Cache the source data
                    sourceCache.set(sourcePath, { data: sourceData, timestamp: Date.now() });

                    // Merge source data with company operational data
                    setHydratedLead(mergeLeadData(sourceData, companyLead));
                } else {
                    // Source document missing (Ghost Lead)
                    console.warn(`[useLeadWithSource] Ghost lead detected: ${sourcePath}`);
                    setHydratedLead({
                        ...companyLead,
                        _isGhost: true,
                        firstName: companyLead.firstName || 'Unknown',
                        lastName: companyLead.lastName || 'Driver'
                    });
                }
            } catch (err) {
                console.error('[useLeadWithSource] Hydration error:', err);
                setError(err.message);
                // Fallback to company lead data
                setHydratedLead(companyLead);
            } finally {
                setLoading(false);
            }
        };

        hydrate();
    }, [companyLead?.id, companyLead?.leadRef, companyLead?.originalLeadId]);

    return { lead: hydratedLead, loading, error };
}

/**
 * Merge source lead data with company operational data
 * Company data takes precedence for operational fields
 */
function mergeLeadData(sourceData, companyData) {
    return {
        // Source data (contact info, demographics)
        firstName: sourceData.firstName || 'Unknown',
        lastName: sourceData.lastName || 'Driver',
        fullName: sourceData.fullName,
        email: sourceData.email || '',
        phone: sourceData.phone || '',
        normalizedPhone: sourceData.normalizedPhone || '',
        city: sourceData.city || '',
        state: sourceData.state || '',
        driverType: sourceData.driverType || 'Unspecified',
        experience: sourceData.experience || '',
        source: sourceData.source || 'SafeHaul Network',

        // Company operational data (overrides)
        ...companyData,

        // Preserve the ID from company document
        id: companyData.id,

        // Mark as hydrated for debugging
        _hydrated: true,
        _sourceRef: companyData.leadRef || companyData.originalLeadId
    };
}

/**
 * Batch hydrate multiple leads
 * Useful for lists where we want to minimize loading states
 *
 * @param {object[]} companyLeads - Array of company lead documents
 * @returns {{ leads, loading, error }}
 */
export function useLeadsWithSource(companyLeads) {
    const [hydratedLeads, setHydratedLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Memoize leads to prevent infinite loops
    const leadsKey = useMemo(() => {
        return companyLeads?.map(l => l.id).join(',') || '';
    }, [companyLeads]);

    useEffect(() => {
        if (!companyLeads || companyLeads.length === 0) {
            setHydratedLeads([]);
            setLoading(false);
            return;
        }

        const hydrateAll = async () => {
            setLoading(true);
            setError(null);

            try {
                const results = await Promise.all(
                    companyLeads.map(async (lead) => {
                        // If already has full data (legacy), return as-is
                        if (lead.firstName && !lead.leadRef && !lead.originalLeadId) {
                            return lead;
                        }

                        const sourceId = lead.originalLeadId;
                        const sourcePath = lead.leadRef || (sourceId ? `leads/${sourceId}` : null);

                        if (!sourcePath) {
                            return lead;
                        }

                        // Check cache
                        const cached = sourceCache.get(sourcePath);
                        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                            return mergeLeadData(cached.data, lead);
                        }

                        // Fetch source
                        try {
                            const sourceRef = doc(db, sourcePath);
                            const sourceSnap = await getDoc(sourceRef);

                            if (sourceSnap.exists()) {
                                const sourceData = sourceSnap.data();
                                sourceCache.set(sourcePath, { data: sourceData, timestamp: Date.now() });
                                return mergeLeadData(sourceData, lead);
                            } else {
                                return { ...lead, _isGhost: true, firstName: lead.firstName || 'Unknown', lastName: lead.lastName || 'Driver' };
                            }
                        } catch (err) {
                            console.warn(`[useLeadsWithSource] Failed to hydrate ${lead.id}:`, err);
                            return lead;
                        }
                    })
                );

                setHydratedLeads(results);
            } catch (err) {
                console.error('[useLeadsWithSource] Batch hydration error:', err);
                setError(err.message);
                setHydratedLeads(companyLeads); // Fallback
            } finally {
                setLoading(false);
            }
        };

        hydrateAll();
    }, [leadsKey]);

    return { leads: hydratedLeads, loading, error };
}

/**
 * Clear the source cache (useful after updates)
 */
export function clearLeadSourceCache() {
    sourceCache.clear();
}

export default useLeadWithSource;
