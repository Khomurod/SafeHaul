// src/features/company-admin/components/modals/pev/useFmcsaEmployerLookup.js
//
// Encapsulates the FMCSA carrier-candidate lookup for the PEV request flow:
// debounced-by-deps fetch with AbortController, loading/error/rows state. Extracted
// from PEVRequestModal so the data lifecycle is isolated and unit-testable. Wraps
// the pure helpers in @shared/services/fmcsaEmployerSocrata (reused, not reinvented).

import { useState, useEffect, useRef } from 'react';
import { fetchFmcsaCarrierCandidatesForPev } from '@shared/services/fmcsaEmployerSocrata';

/**
 * @param {object} params
 * @param {string} params.companyLabel  Employer display name (search term).
 * @param {string} params.employerStateRaw  Raw employer state (used to prioritize results).
 * @param {string} [params.socrataToken]  Socrata app token; lookup is skipped without it.
 * @param {() => void} [params.onRowsLoaded]  Called after a successful fetch (memoize it).
 * @returns {{ fmcsaLoading: boolean, fmcsaError: string|null, fmcsaRows: any[] }}
 */
export function useFmcsaEmployerLookup({ companyLabel, employerStateRaw, socrataToken, onRowsLoaded }) {
    const [fmcsaLoading, setFmcsaLoading] = useState(false);
    const [fmcsaError, setFmcsaError] = useState(null);
    const [fmcsaRows, setFmcsaRows] = useState([]);
    const abortRef = useRef(null);

    useEffect(() => {
        if (!socrataToken || (companyLabel || '').length < 2) {
            setFmcsaRows([]);
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        let cancelled = false;
        (async () => {
            setFmcsaLoading(true);
            setFmcsaError(null);
            try {
                const rows = await fetchFmcsaCarrierCandidatesForPev(companyLabel, {
                    appToken: socrataToken,
                    signal: controller.signal,
                    employerState: employerStateRaw,
                });
                if (!cancelled) {
                    setFmcsaRows(rows);
                    onRowsLoaded?.();
                }
            } catch (e) {
                if (e?.name === 'AbortError') return;
                if (!cancelled) {
                    console.warn('[PEVRequestModal] FMCSA lookup', e);
                    setFmcsaError('Could not load FMCSA registry suggestions.');
                    setFmcsaRows([]);
                }
            } finally {
                if (!cancelled) setFmcsaLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [socrataToken, companyLabel, employerStateRaw, onRowsLoaded]);

    return { fmcsaLoading, fmcsaError, fmcsaRows };
}

export default useFmcsaEmployerLookup;
