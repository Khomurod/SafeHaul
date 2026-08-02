import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBrowserValueConfigured } from '../config/browserVisibleEnvironment';
import { describeVaultError, listEnvironmentAndIntegrations } from '../services/environmentVault';

/**
 * Loads the Environment & Integrations inventory and owns its filter state.
 *
 * The hook never holds a secret. The callable it drives returns rows whose value
 * is already `********`; the only refinement made here is turning a build-time
 * row's `unknown` status into `configured` / `missing` using a **presence
 * boolean** read from the running bundle. No value is stored, derived or cached.
 */

export const STATUS_LABELS = Object.freeze({
    configured: 'Configured',
    missing: 'Missing',
    unknown: 'Unknown',
});

const EMPTY_FILTERS = Object.freeze({
    category: 'all',
    source: 'all',
    integration: 'all',
    scopeKind: 'all',
    company: 'all',
    status: 'all',
    writability: 'all',
});

/** Rows whose status the server cannot determine but the browser can. */
function refineStatus(entry) {
    if (entry.statusResolvedBy !== 'client-bundle') return entry;
    return { ...entry, status: isBrowserValueConfigured(entry.key) ? 'configured' : 'missing' };
}

function matchesSearch(entry, needle) {
    if (!needle) return true;
    const haystack = [
        entry.key,
        entry.displayName,
        entry.integration,
        entry.companyName,
        entry.description,
        entry.source,
        entry.category,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(needle);
}

function matchesFilters(entry, filters) {
    if (filters.category !== 'all' && entry.category !== filters.category) return false;
    if (filters.source !== 'all' && entry.source !== filters.source) return false;
    if (filters.integration !== 'all' && entry.integration !== filters.integration) return false;
    if (filters.scopeKind !== 'all' && entry.scope !== filters.scopeKind) return false;
    if (filters.company !== 'all' && entry.companyId !== filters.company) return false;
    if (filters.status !== 'all' && entry.status !== filters.status) return false;
    if (filters.writability === 'editable' && !entry.permissions.editable) return false;
    if (filters.writability === 'read-only' && entry.permissions.editable) return false;
    return true;
}

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function useEnvironmentInventory() {
    const [entries, setEntries] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [companyError, setCompanyError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listEnvironmentAndIntegrations({});
            if (!mounted.current) return;
            setEntries((data?.entries || []).map(refineStatus));
            setRecentActivity(data?.recentActivity || []);
            setCompanyError(data?.companyError || null);
        } catch (err) {
            if (!mounted.current) return;
            // Mapped through the shared describer rather than matched here: the
            // Firebase SDK prefixes callable codes with `functions/`, so an
            // inline `=== 'permission-denied'` never matched and a denied Super
            // Admin check was reported as a generic load failure.
            setError(describeVaultError(err, 'The configuration inventory could not be loaded.'));
            setEntries([]);
            setRecentActivity([]);
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const setFilter = useCallback((name, value) => {
        setFilters((previous) => ({ ...previous, [name]: value }));
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setSearch('');
    }, []);

    const options = useMemo(() => ({
        categories: uniqueSorted(entries.map((entry) => entry.category)),
        sources: uniqueSorted(entries.map((entry) => entry.source)),
        integrations: uniqueSorted(entries.map((entry) => entry.integration)),
        companies: [...new Map(
            entries
                .filter((entry) => entry.companyId)
                .map((entry) => [entry.companyId, entry.companyName || entry.companyId]),
        ).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    }), [entries]);

    const visibleEntries = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return entries.filter((entry) => matchesSearch(entry, needle) && matchesFilters(entry, filters));
    }, [entries, search, filters]);

    const summary = useMemo(() => ({
        total: entries.length,
        configured: entries.filter((entry) => entry.status === 'configured').length,
        missing: entries.filter((entry) => entry.status === 'missing').length,
        protected: entries.filter((entry) => !entry.permissions.editable).length,
        needsDeployment: entries.filter((entry) => entry.requiresDeployment).length,
    }), [entries]);

    const isFiltered = search.trim() !== '' || Object.keys(EMPTY_FILTERS)
        .some((name) => filters[name] !== EMPTY_FILTERS[name]);

    return {
        entries,
        visibleEntries,
        recentActivity,
        companyError,
        loading,
        error,
        reload: load,
        search,
        setSearch,
        filters,
        setFilter,
        resetFilters,
        isFiltered,
        options,
        summary,
    };
}
