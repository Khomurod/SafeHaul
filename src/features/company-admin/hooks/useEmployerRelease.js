import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { releaseStatementFor } from '@shared/legal/employerReleaseAgreement';

async function sha256Hex(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The applicant's release naming this employer, as the request PDF prints it
 * (`functions/employmentVerification/requests.js`): from the submission record
 * the application points at, and only while the signature on file is the one it
 * was accepted with. Null when there is none, or the record cannot be read; the
 * document then prints the release in the Certification of Applicant.
 *
 * `applicant.id` must be the document id: the loaded application data does not
 * carry it, so the caller adds it.
 *
 * @returns {{ release: object|null, loading: boolean }}
 */
export function useEmployerRelease({ companyId, applicant, employerName }) {
    const applicationId = applicant?.id || null;
    const snapshotId = applicant?.submissionRecord?.snapshotId || null;
    const signature = typeof applicant?.signature === 'string' ? applicant.signature : '';
    const readable = Boolean(companyId && applicationId && snapshotId && signature);
    // What the stored answer was read for: an answer for other inputs is never
    // returned, even on the render before the effect starts the new read.
    const inputs = JSON.stringify([companyId, applicationId, snapshotId, signature, employerName]);
    const [state, setState] = useState({ release: null, loading: readable, inputs });

    useEffect(() => {
        if (!readable) {
            setState({ release: null, loading: false, inputs });
            return undefined;
        }
        let live = true;
        setState({ release: null, loading: true, inputs });
        (async () => {
            try {
                const snap = await getDoc(doc(db, 'companies', companyId, 'applications', applicationId, 'submission', snapshotId));
                const found = snap.exists() ? releaseStatementFor(snap.data()?.agreements, employerName) : null;
                const matches = Boolean(found?.signatureSha256) && found.signatureSha256 === await sha256Hex(signature);
                if (live) setState({ release: matches ? found : null, loading: false, inputs });
            } catch {
                if (live) setState({ release: null, loading: false, inputs });
            }
        })();
        return () => { live = false; };
    }, [readable, inputs, companyId, applicationId, snapshotId, signature, employerName]);

    return state.inputs === inputs
        ? { release: state.release, loading: state.loading }
        : { release: null, loading: readable };
}
