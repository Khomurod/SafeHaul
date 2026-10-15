import { useState, useEffect, useMemo } from 'react';
import { db } from '@lib/firebase';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import {
    NoPreservedPdfError,
    downloadPreservedApplicationPdf,
} from '@features/applications/services/applicationPdfService';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';
import { useToast } from '@shared/components/feedback';

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
    const dqStatus = useMemo(() => {
        if (!dqFiles) return null;
        const requiredDocTypes = ['mvr', 'medical', 'roadtest', 'psp', 'clearinghouse', 'clearinghouse_annual', 'violations'];
        const keyMappings = {
            'mvr': ['mvr', 'mvr (annual)', 'motor vehicle record'],
            'medical': ['medical', 'med card', 'medical card', 'medical examiner'],
            'roadtest': ['road test', 'roadtest', 'road test certificate'],
            'psp': ['psp', 'psp report', 'pre-employment screening'],
            'clearinghouse': ['clearinghouse report (full)', 'clearinghouse full', 'ch full'],
            'clearinghouse_annual': ['clearinghouse report (annual)', 'clearinghouse annual', 'ch annual'],
            'violations': ['certificate of violations', 'violations', 'certificate of violations (annual)']
        };

        const textOf = (f) => ({
            type: (f.fileType || f.type || f.docType || '').toLowerCase(),
            name: (f.fileName || f.name || '').toLowerCase(),
        });
        // The entries the tab lists (removing one keeps its record, with
        // `removedAt`), less the consents the application syncs: an MVR Consent
        // is the driver's permission, not the MVR it permits.
        const listed = dqFiles.filter((f) => {
            const { type, name } = textOf(f);
            return !f.removedAt && !type.includes('consent') && !name.includes('consent');
        });
        let completeCount = 0;
        requiredDocTypes.forEach(docKey => {
            const matches = listed.filter(f => {
                const { type, name } = textOf(f);
                const keywords = keyMappings[docKey] || [docKey];
                return keywords.some(kw => type.includes(kw) || name.includes(kw));
            });
            if (matches.length > 0) completeCount++;
        });

        return completeCount === requiredDocTypes.length ? 'complete' : 'incomplete';
    }, [dqFiles]);

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
            showError(e.message || 'Could not open the application document. Please try again.');
        }
    };

    return {
        ...details,
        dqStatus,
        handleDownloadPdf,
    };
}
