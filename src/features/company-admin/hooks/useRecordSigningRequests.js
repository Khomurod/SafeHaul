/**
 * A driver record's signing documents, live, for the dossier's Documents tab.
 *
 * One listener on `signing_requests` where the record's link field equals its id
 * (`sourceApplicationId` for an application, `sourceLeadId` for a lead):
 * equality only, sorted in the browser, so no composite index is needed (the
 * same reasoning as `useSigningRequestCounts`). For an application it also reads
 * the company's post-application forms (`companies/{id}.postApplicationTemplates`,
 * team-readable) once, so a required form nobody has started shows as "Not
 * started" (`recordDocumentRows`); the list shows once both are read. A failed
 * read of the forms still lists the requests and says so (`formsError`).
 */
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { normalizePostApplicationTemplates } from '@features/driver-app/components/application/publicApplyHelpers';
import { useRerenderAt } from '@shared/hooks/useRerenderAt';
import { nextLinkExpiry, recordDocumentRows, recordLinkField } from '../utils/recordSigningDocuments';

export function useRecordSigningRequests({ companyId, recordId, collectionName }) {
    const isApplication = collectionName !== 'leads';
    const [requests, setRequests] = useState({ rows: [], loaded: false, error: null });
    const [forms, setForms] = useState({ list: [], loaded: false, error: null });

    useEffect(() => {
        if (!companyId || !recordId) return undefined;
        setRequests({ rows: [], loaded: false, error: null });
        const linked = query(
            collection(db, 'companies', companyId, 'signing_requests'),
            where(recordLinkField(collectionName), '==', recordId),
        );
        return onSnapshot(linked, (snapshot) => {
            setRequests({ rows: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })), loaded: true, error: null });
        }, (err) => {
            console.error('[useRecordSigningRequests] Could not load signing documents:', err);
            setRequests({ rows: [], loaded: true, error: 'Could not load this driver\'s signing documents.' });
        });
    }, [companyId, recordId, collectionName]);

    useEffect(() => {
        if (!companyId || !isApplication) {
            setForms({ list: [], loaded: true, error: null });
            return undefined;
        }
        setForms({ list: [], loaded: false, error: null });
        let current = true;
        getDoc(doc(db, 'companies', companyId)).then((snap) => {
            if (!current) return;
            const raw = snap.exists() ? snap.data()?.postApplicationTemplates : [];
            setForms({ list: normalizePostApplicationTemplates(raw), loaded: true, error: null });
        }, (err) => {
            console.error('[useRecordSigningRequests] Could not load post-application forms:', err);
            if (current) setForms({ list: [], loaded: true, error: 'Could not load the company\'s after-application forms.' });
        });
        return () => { current = false; };
    }, [companyId, isApplication]);

    // Built on every render, from the clock then: a link that runs out while the
    // tab is open turns to "Link expired" at that moment.
    useRerenderAt(nextLinkExpiry(requests.rows));
    const rows = recordDocumentRows({
        requests: requests.rows,
        forms: forms.list,
        applicationId: isApplication ? recordId : null,
        now: Date.now(),
    });

    return {
        rows,
        // The forms too, so a Not started row never appears after the list.
        isLoading: !requests.loaded || !forms.loaded,
        error: requests.error,
        formsError: forms.error,
    };
}

export default useRecordSigningRequests;
