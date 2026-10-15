// src/features/driver-app/hooks/useApplicationAgreements.js
//
// Loads the legal agreements the consent step must display.
//
// The text comes from the server, not from this bundle, because the submission
// snapshot freezes wording resolved from the same server registry. A locally
// held copy could drift from it, and we would then preserve — and bind a
// signature to — wording the driver never saw.
//
// FAILURE IS NOT SILENT
// ---------------------
// If the agreements cannot be loaded there is nothing legitimate to sign, so the
// hook reports the failure and the consent step blocks submission. Letting an
// applicant certify against agreements that never rendered would manufacture
// exactly the false evidence this work exists to prevent.
//
// ONE READ PER PAGE
// -----------------
// Step 4 and Step 9 both show agreements, and a driver moves between them and
// back. The set a company's page received is the one shown on every step, so it
// is read once per page load; a failure, or an empty set, is never remembered,
// and Try again or the next step asks afresh.

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { E2E_AGREEMENTS } from './e2eAgreementFixtures';

/** companyId -> the read in flight or done; a failed read is removed. */
const agreementReads = new Map();

function readAgreements(companyId) {
    if (!agreementReads.has(companyId)) {
        const read = (async () => {
            const call = httpsCallable(functions, 'getApplicationAgreements');
            const { data } = await call({ companyId });
            const list = Array.isArray(data?.agreements) ? data.agreements : [];
            if (list.length === 0) {
                // An empty set is a failure, not an application with no
                // agreements. Treating it as "nothing to accept" would let the
                // driver sign a certification with no disclosures attached.
                throw new Error('No agreements were returned.');
            }
            return list;
        })();
        agreementReads.set(companyId, read);
        read.catch(() => { if (agreementReads.get(companyId) === read) agreementReads.delete(companyId); });
    }
    return agreementReads.get(companyId);
}

/** For tests: forget every read. */
export function resetApplicationAgreementsCache() {
    agreementReads.clear();
}

export function useApplicationAgreements(companyId) {
    const [agreements, setAgreements] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Bumped to retry after a failure without remounting the step.
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    useEffect(() => {
        if (!companyId) {
            setAgreements([]);
            setLoading(false);
            setError(null);
            return undefined;
        }

        // E2E runs point at an unreachable Firebase project on purpose, so the
        // callable can never succeed there. Serving the fixture through this same
        // hook keeps the step's real logic — per-agreement acceptance, the
        // submit gate, the failure branch — under test.
        if (isE2ETestMode) {
            setAgreements(E2E_AGREEMENTS);
            setLoading(false);
            setError(null);
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const list = await readAgreements(companyId);
                if (!active) return;
                setAgreements(list);
            } catch (err) {
                if (!active) return;
                setAgreements([]);
                // In words a driver can act on. The reason ("internal", "Failed
                // to fetch") told them nothing and stays in the console.
                console.error('Application agreements failed to load:', err);
                setError('The required agreements could not be loaded. Check your internet connection, then press Try again.');
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [companyId, attempt]);

    return { agreements, loading, error, retry };
}

export default useApplicationAgreements;
