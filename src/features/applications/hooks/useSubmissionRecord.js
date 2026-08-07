// src/features/applications/hooks/useSubmissionRecord.js
//
// The single browser-side read path for a preserved submission record.
//
// Every surface that shows "what the applicant actually submitted" — the driver
// review screen, the recruiter summary and full application views, and the
// change-review workflow — resolves the record through this hook and renders it
// through `presentSubmission`. That is what keeps the four surfaces agreeing
// with each other and with the generated PDF.
//
// WHY THE PATH IS HARD-CODED TO `applications`
// --------------------------------------------
// `writeSubmissionSnapshot` writes to
// `companies/{companyId}/applications/{applicationId}/submission/{vN}`, and guest
// submission always targets the `applications` collection. Mirroring that exactly
// is the property that matters: a reader addressing a different collection would
// silently resolve nothing and report a real, preserved application as historical.
// Records that live elsewhere (leads) legitimately have no snapshot and correctly
// fall through to the honest "not preserved" notice.
//
// WHY SEQUENCE v1
// ---------------
// Sequence 1 is the ORIGINAL submission, forever. Re-submissions add siblings
// rather than overwriting, so "the original" always resolves here.

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { presentSubmission } from '@features/applications/services/submissionPresenter';

/** The original submission is always sequence 1. */
const ORIGINAL_SNAPSHOT_ID = 'v1';

/**
 * Resolve the preserved submission record for an application.
 *
 * @param {string} companyId
 * @param {string} applicationId
 * @returns {{record: object|null, loading: boolean, error: string|null}}
 *   `record` is the output of `presentSubmission` — never raw snapshot data — or
 *   `null` before the ids are known. When nothing was preserved, or the read
 *   failed, `record.isPreserved` is false and `record.notice` explains why. It
 *   never presents live data as the submitted original.
 */
export function useSubmissionRecord(companyId, applicationId) {
    const [record, setRecord] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!companyId || !applicationId) {
            setRecord(null);
            setLoading(false);
            setError(null);
            return undefined;
        }

        // Guards against a slow response for a previous application overwriting a
        // newer one — which would show one driver's record under another's name.
        let active = true;

        setLoading(true);
        setError(null);

        (async () => {
            try {
                const ref = doc(
                    db,
                    'companies', companyId,
                    'applications', applicationId,
                    'submission', ORIGINAL_SNAPSHOT_ID
                );
                const snap = await getDoc(ref);
                if (!active) return;
                // A missing document is not an error: it means the application
                // predates snapshots. presentSubmission turns that into the
                // honest historical notice.
                setRecord(presentSubmission(snap.exists() ? snap.data() : null));
            } catch (err) {
                if (!active) return;
                // A failed read must never look like a preserved record. Present
                // the "not preserved" shape and surface the error separately.
                setError(err?.message || 'Could not load the preserved submission record.');
                setRecord(presentSubmission(null));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [companyId, applicationId]);

    return { record, loading, error };
}
