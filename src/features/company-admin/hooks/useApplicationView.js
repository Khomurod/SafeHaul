import { useState, useEffect, useMemo } from 'react';
import { db } from '@lib/firebase';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import {
    NoPreservedPdfError,
    downloadPreservedApplicationPdf,
} from '@features/applications/services/applicationPdfService';
import { getFieldValue } from '@shared/utils/helpers.js';
import { useData } from '@/context/DataContext';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';
import { useToast } from '@shared/components/feedback';

export function useApplicationView(companyId, applicationId, onStatusUpdate, onClosePanel, onPhoneClick) {
    const { currentUserClaims } = useData();
    const { showError } = useToast();
    const details = useApplicationDetails(companyId, applicationId, onStatusUpdate);

    // Deconstruct key items from details for easier access
    const {
        appData, companyProfile, collectionName, handleStatusUpdate
    } = details;

    // --- Local State ---
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [showOfferModal, setShowOfferModal] = useState(false);
    const [activeSection, setActiveSection] = useState('application'); // 'application' | 'dq' | 'files' | 'contact' | 'pev' | 'notes' | 'activity'
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

    // --- Helpers ---
    const isSuperAdmin = currentUserClaims?.roles?.globalRole === 'super_admin';
    const canEditAllFields = details.isCompanyAdmin || isSuperAdmin;
    const currentAppName = getFieldValue(appData?.['firstName']) + ' ' + getFieldValue(appData?.['lastName']);
    const driverId = appData?.driverId || appData?.userId;

    // --- Handlers ---
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

    const handleManagementComplete = () => {
        if (onStatusUpdate) onStatusUpdate();
        if (onClosePanel) onClosePanel();
    };

    // --- Device Detection Helper ---
    const isMobile = () => {
        return window.matchMedia('(pointer: coarse)').matches ||
            /Mobi|Android/i.test(navigator.userAgent);
    };

    const handleWorkflowAction = (action) => {
        switch (action) {
            case 'call':
                if (appData?.phone) {
                    // M7 FIX: Mobile = tel: link only, Desktop = modal only, never both
                    if (isMobile()) {
                        window.location.href = `tel:${appData.phone}`;
                        // Exit early - no modal on mobile
                        return;
                    }
                    // Desktop: open call outcome modal via callback
                    if (onPhoneClick) onPhoneClick(null, appData);
                }
                break;
            case 'contact': setActiveSection('contact'); break;
            case 'go-to-dq': setActiveSection('dq'); break;
            case 'go-to-pev': setActiveSection('pev'); break;
            case 'add-note': setActiveSection('notes'); break;
            case 'send-offer': setShowOfferModal(true); break;
            case 'background': handleStatusUpdate('Background Check'); break;
            default: break;
        }
    };

    return {
        ...details,
        // State
        showDeleteConfirm, setShowDeleteConfirm,
        showMoveModal, setShowMoveModal,
        showOfferModal, setShowOfferModal,
        activeSection, setActiveSection,
        dqStatus,
        // Computed
        isSuperAdmin,
        canEditAllFields,
        currentAppName,
        driverId,
        // Handlers
        handleDownloadPdf,
        handleManagementComplete,
        handleWorkflowAction
    };
}
