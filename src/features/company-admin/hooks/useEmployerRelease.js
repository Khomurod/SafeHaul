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
 * @returns {{ release: object|null, loading: boolean }}
 */
export function useEmployerRelease({ companyId, applicant, employerName }) {
    const applicationId = applicant?.id || null;
    const snapshotId = applicant?.submissionRecord?.snapshotId || null;
    const signature = typeof applicant?.signature === 'string' ? applicant.signature : '';
    const readable = Boolean(companyId && applicationId && snapshotId && signature);
    const [state, setState] = useState({ release: null, loading: readable });

    useEffect(() => {
        if (!readable) {
            setState({ release: null, loading: false });
            return undefined;
        }
        let live = true;
        setState({ release: null, loading: true });
        (async () => {
            try {
                const snap = await getDoc(doc(db, 'companies', companyId, 'applications', applicationId, 'submission', snapshotId));
                const found = snap.exists() ? releaseStatementFor(snap.data()?.agreements, employerName) : null;
                const matches = Boolean(found?.signatureSha256) && found.signatureSha256 === await sha256Hex(signature);
                if (live) setState({ release: matches ? found : null, loading: false });
            } catch {
                if (live) setState({ release: null, loading: false });
            }
        })();
        return () => { live = false; };
    }, [readable, companyId, applicationId, snapshotId, signature, employerName]);

    return state;
}
