import { useState, useEffect, useMemo } from 'react';
import { db } from '@lib/firebase';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import {
    NoPreservedPdfError,
    downloadPreservedApplicationPdf,
} from '@features/applications/services/applicationPdfService';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';
import { useToast } from '@shared/components/feedback';
import { buildDqChecklist } from '../utils/dqChecklist';
import { todayUtc } from '../utils/dqExpiry';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

export function useApplicationView(companyId, applicationId, onStatusUpdate) {
    const { showError } = useToast();
    const details = useApplicationDetails(companyId, applicationId, onStatusUpdate);

    const { appData, collectionName } = details;

    // The DQ File tab's entries; `null` until they have loaded, or when they
    // cannot be read.
    const [dqFiles, setDqFiles] = useState(null);
    const recordLoaded = Boolean(appData);

    // --- DQ Logic ---
    // Live, so an upload, a removal or a sync in the DQ File tab moves the
    // sidebar's marker at once. It waits for the record: until it loads,
    // `collectionName` is the default `applications`, also for a lead.
    useEffect(() => {
        if (!companyId || !applicationId || !recordLoaded) return undefined;
        setDqFiles(null);
        const appRef = doc(db, 'companies', companyId, collectionName || 'applications', applicationId);
        return onSnapshot(
            query(collection(appRef, 'dq_files'), orderBy('createdAt', 'desc')),
            (snapshot) => setDqFiles(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
            (err) => {
                console.error('Error fetching DQ files:', err);
                setDqFiles(null);
            },
        );
    }, [companyId, applicationId, collectionName, recordLoaded]);

    // `'complete'` or `'incomplete'`, the values the sidebar's marker reads;
    // `null` while the entries are unknown, so no marker claims what nobody saw.
    // It is the DQ tab's checklist: incomplete while an item that is not
    // optional is missing or expired (`dqChecklist.js`), so the marker and the
    // list never disagree.
    // Expiry is judged by the UTC day, so a new day rebuilds it on its first render.
    const today = todayUtc();
    const dqStatus = useMemo(() => {
        if (!dqFiles) return null;
        const { missing, expired } = buildDqChecklist({ files: dqFiles, record: appData, now: new Date(`${today}T12:00:00Z`) });
        return missing + expired > 0 ? 'incomplete' : 'complete';
    }, [dqFiles, appData, today]);

    /**
     * Download the PRESERVED original application document.
     *
     * It is fetched, never generated. The old handler called a browser-side
     * jsPDF generator over live application data, which meant "the original"
     * was recomputed from whatever the record said that afternoon; two
     * downloads a month apart could legitimately differ. The server now renders
     * it once from the frozen submission record and stores it, and this asks
     * for those bytes.
     *
     * The audit record is written server-side, before the link is issued, so
     * an access that could not be recorded does not happen — a client-side
     * `logActivity` after the fact could always be skipped by a failure or a
     * closed tab.
     */
    const handleDownloadPdf = async () => {
        if (!companyId || !applicationId) return;
        try {
            await downloadPreservedApplicationPdf({ companyId, applicationId });
        } catch (e) {
            if (e instanceof NoPreservedPdfError) {
                showError(e.message);
                return;
            }
            console.error('Preserved application PDF unavailable:', e);
            showError(plainErrorMessage(e, 'Could not open the application document.'));
        }
    };

    return {
        ...details,
        dqStatus,
        handleDownloadPdf,
    };
}
