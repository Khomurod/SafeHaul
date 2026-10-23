// src/features/company-admin/components/modals/pev/useFmcsaEmployerLookup.js
//
// Encapsulates the FMCSA carrier-candidate lookup for the PEV request flow:
// debounced-by-deps fetch with AbortController, loading/error/rows state. Extracted
// from PEVRequestModal so the data lifecycle is isolated and unit-testable. Wraps
// the pure helpers in @shared/services/fmcsaEmployerSocrata (reused, not reinvented).

import { useState, useEffect, useRef } from 'react';
import {
    FMCSA_SELECT_PEV,
    fetchFmcsaCarrierCandidatesForPev,
    fetchFmcsaCarriersByDot,
} from '@shared/services/fmcsaEmployerSocrata';

/**
 * @param {object} params
 * @param {string} params.companyLabel  Employer display name (search term).
 * @param {string} params.employerStateRaw  Raw employer state (used to prioritize results).
 * @param {string} [params.dotNumber]  The row's USDOT number: that carrier is asked for
 *   first, and the name search runs only when FMCSA has no carrier with it.
 * @param {string} [params.socrataToken]  Socrata app token; lookup is skipped without it.
 * @param {() => void} [params.onRowsLoaded]  Called after a successful fetch (memoize it).
 * @returns {{ fmcsaLoading: boolean, fmcsaError: string|null, fmcsaRows: any[] }}
 */
export function useFmcsaEmployerLookup({ companyLabel, employerStateRaw, dotNumber = '', socrataToken, onRowsLoaded }) {
    const [fmcsaLoading, setFmcsaLoading] = useState(false);
    const [fmcsaError, setFmcsaError] = useState(null);
    const [fmcsaRows, setFmcsaRows] = useState([]);
    const abortRef = useRef(null);

    useEffect(() => {
        const dot = /^\d{1,9}$/.test(String(dotNumber ?? '').trim()) ? String(dotNumber).trim() : '';
        if (!socrataToken || ((companyLabel || '').length < 2 && !dot)) {
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
                const byDot = dot
                    ? await fetchFmcsaCarriersByDot([dot], { appToken: socrataToken, signal: controller.signal, select: FMCSA_SELECT_PEV })
                    : [];
                const rows = byDot.length > 0 || (companyLabel || '').length < 2
                    ? byDot
                    : await fetchFmcsaCarrierCandidatesForPev(companyLabel, {
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
    }, [socrataToken, companyLabel, employerStateRaw, dotNumber, onRowsLoaded]);

    return { fmcsaLoading, fmcsaError, fmcsaRows };
}

export default useFmcsaEmployerLookup;
