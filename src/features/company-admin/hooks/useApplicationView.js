import { useState, useEffect, useMemo } from 'react';
import { db } from '@lib/firebase';
import { collection, doc, getDocs, query, orderBy } from 'firebase/firestore';
import { generateApplicationPDF } from '@shared/utils/pdfGenerator.js';
import { getFieldValue } from '@shared/utils/helpers.js';
import { useData } from '@/context/DataContext';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback';

export function useApplicationView(companyId, applicationId, onStatusUpdate, onClosePanel, onPhoneClick) {
    const { currentUserClaims, currentUser } = useData();
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
    const [dqFiles, setDqFiles] = useState([]);

    // --- DQ Logic ---
    useEffect(() => {
        const fetchDQFiles = async () => {
            if (!companyId || !applicationId) return;
            try {
                const collName = collectionName || 'applications';
                const appRef = doc(db, 'companies', companyId, collName, applicationId);
                const dqFilesRef = collection(appRef, 'dq_files');
                const q = query(dqFilesRef, orderBy('createdAt', 'desc'));
                const snapshot = await getDocs(q);
                const files = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                setDqFiles(files);
            } catch (err) {
                console.error('Error fetching DQ files:', err);
            }
        };
        fetchDQFiles();
    }, [companyId, applicationId, collectionName]);

    const dqStatus = useMemo(() => {
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

        let completeCount = 0;
        requiredDocTypes.forEach(docKey => {
            const matches = dqFiles.filter(f => {
                const type = (f.fileType || f.type || f.docType || '').toLowerCase();
                const name = (f.fileName || f.name || '').toLowerCase();
                const keywords = keyMappings[docKey] || [docKey];
                return keywords.some(kw => type.includes(kw) || name.includes(kw));
            });
            if (matches.length > 0) completeCount++;
        });

        return { complete: completeCount, total: requiredDocTypes.length };
    }, [dqFiles]);

    // --- Helpers ---
    const isSuperAdmin = currentUserClaims?.roles?.globalRole === 'super_admin';
    const canEditAllFields = details.isCompanyAdmin || isSuperAdmin;
    const currentAppName = getFieldValue(appData?.['firstName']) + ' ' + getFieldValue(appData?.['lastName']);
    const driverId = appData?.driverId || appData?.userId;

    // --- Handlers ---
    const handleDownloadPdf = async () => {
        if (!appData || !companyProfile) return;
        try {
            generateApplicationPDF({ applicant: appData, agreements: [], company: companyProfile });
            // PDF-2 FIX: Audit every PDF download per FCRA § 604 and 49 CFR Part 391.
            // Log who downloaded what and when so the DQ file access trail is complete.
            try {
                const userName = currentUser?.displayName || currentUser?.email || 'Unknown';
                await logActivity(
                    companyId,
                    collectionName || 'applications',
                    applicationId,
                    'PDF Downloaded',
                    `Application PDF downloaded by ${userName}`
                );
            } catch (logErr) {
                console.warn('[useApplicationView] Failed to log PDF download activity:', logErr);
            }
        } catch (e) {
            console.error('PDF Generation failed:', e);
            // Was a blocking `alert()`. The toast is a `role="alert"` live region, so
            // the failure is still announced — without freezing the tab. Wording
            // preserved verbatim.
            showError("PDF Generation failed. Please try again.");
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
            default: console.log('Workflow action:', action);
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
