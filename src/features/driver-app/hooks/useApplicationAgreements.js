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

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { E2E_AGREEMENTS, E2E_AGREEMENT_VERSION } from './e2eAgreementFixtures';

export function useApplicationAgreements(companyId) {
    const [agreements, setAgreements] = useState([]);
    const [agreementVersion, setAgreementVersion] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Bumped to retry after a failure without remounting the step.
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    useEffect(() => {
        if (!companyId) {
            setAgreements([]);
            setAgreementVersion(null);
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
            setAgreementVersion(E2E_AGREEMENT_VERSION);
            setLoading(false);
            setError(null);
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const call = httpsCallable(functions, 'getApplicationAgreements');
                const { data } = await call({ companyId });
                if (!active) return;

                const list = Array.isArray(data?.agreements) ? data.agreements : [];
                if (list.length === 0) {
                    // An empty set is a failure, not an application with no
                    // agreements. Treating it as "nothing to accept" would let the
                    // driver sign a certification with no disclosures attached.
                    throw new Error('No agreements were returned.');
                }

                setAgreements(list);
                setAgreementVersion(data?.agreementVersion || null);
            } catch (err) {
                if (!active) return;
                setAgreements([]);
                setAgreementVersion(null);
                setError(
                    err?.message
                        ? `The required agreements could not be loaded. ${err.message}`
                        : 'The required agreements could not be loaded.'
                );
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [companyId, attempt]);

    return { agreements, agreementVersion, loading, error, retry };
}

export default useApplicationAgreements;
