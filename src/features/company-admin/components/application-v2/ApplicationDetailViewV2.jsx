import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, FileSignature, Edit2, Save, Trash2, ArrowRight, MessageSquare, Clock, Folder, UserCheck, Mail, Briefcase } from 'lucide-react';
import { db } from '@lib/firebase';
import { collection, doc, getDocs, query, orderBy } from 'firebase/firestore';
import { generateApplicationPDF } from '@shared/utils/pdfGenerator.js';
import { getFieldValue } from '@shared/utils/helpers.js';
import { useData } from '@/context/DataContext';
import { useApplicationDetails } from '@features/applications/hooks/useApplicationDetails';

// V2 Components
import { CandidateHero } from './CandidateHero';
import { RiskAssessmentBanner } from './RiskAssessmentBanner';
import { QuickFactsBar } from './QuickFactsBar';
import { StatusWorkflowGuide } from './StatusWorkflowGuide';
import { EmploymentTimeline } from './EmploymentTimeline';
import { DQComplianceIndicator } from './DQComplianceIndicator';
import { AccordionSection } from './AccordionSection';

// Existing section components (reused)
import { PersonalInfoSection } from '../application/sections/PersonalInfoSection';
import { QualificationsSection } from '../application/sections/QualificationsSection';
import { SupplementalSection } from '../application/sections/SupplementalSection';

// Tabs (lazy loaded)
const DQFileTab = React.lazy(() => import('../tabs').then(m => ({ default: m.DQFileTab })));
const GeneralDocumentsTab = React.lazy(() => import('../tabs').then(m => ({ default: m.GeneralDocumentsTab })));
const NotesTab = React.lazy(() => import('../tabs').then(m => ({ default: m.NotesTab })));
const ActivityHistoryTab = React.lazy(() => import('../tabs').then(m => ({ default: m.ActivityHistoryTab })));
const PEVTab = React.lazy(() => import('../tabs').then(m => ({ default: m.PEVTab })));

import { SendOfferModal } from '../modals';
import { MoveApplicationModal, DeleteConfirmModal } from '@shared/components/modals/ApplicationModals.jsx';
import { ContactTab } from '@features/companies';

/**
 * ApplicationDetailViewV2 - Modern, redesigned application detail panel
 * 
 * Features:
 * - Candidate hero header with quick contact actions
 * - Risk assessment banner with color-coded flags
 * - Quick facts bar (CDL, TWIC, DQ status)
 * - Status workflow guide with suggested next steps
 * - Employment timeline visualization
 * - Accordion-based data sections
 */
export function ApplicationDetailViewV2({
    companyId,
    applicationId,
    onClosePanel,
    onStatusUpdate,
    isCompanyAdmin,
    onPhoneClick
}) {
    const { currentUserClaims } = useData();
    const {
        loading, error, appData, companyProfile, collectionName, fileUrls, currentStatus,
        isEditing, setIsEditing, isSaving, isUploading, canEdit,
        teamMembers, assignedTo, handleAssignChange,
        loadApplication, handleDataChange, handleAdminFileUpload, handleAdminFileDelete, handleSaveEdit, handleStatusUpdate,
        handleDriverTypeUpdate
    } = useApplicationDetails(companyId, applicationId, onStatusUpdate);

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [showOfferModal, setShowOfferModal] = useState(false);
    const [activeSection, setActiveSection] = useState('overview'); // 'overview' | 'contact' | 'notes' | 'dq' | 'pev' | 'docs' | 'activity'
    const [dqFiles, setDqFiles] = useState([]);

    // Calculate DQ status from actual dqFiles (Firestore data)
    // This matches what DQComplianceIndicator displays
    const dqStatus = useMemo(() => {
        // Count unique document types that have been uploaded
        const requiredDocTypes = ['mvr', 'medical', 'roadtest', 'psp', 'clearinghouse', 'clearinghouse_annual', 'violations'];

        // Match dqFiles to required doc types (same logic as DQComplianceIndicator)
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

    // Fetch DQ files from Firestore subcollection
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

    const isSuperAdmin = currentUserClaims?.roles?.globalRole === 'super_admin';
    const canEditAllFields = isCompanyAdmin || isSuperAdmin;

    const currentAppName = getFieldValue(appData?.['firstName']) + ' ' + getFieldValue(appData?.['lastName']);
    const driverId = appData?.driverId || appData?.userId;

    const handleDownloadPdf = () => {
        if (!appData || !companyProfile) return;
        try {
            generateApplicationPDF({ applicant: appData, agreements: [], company: companyProfile });
        } catch (e) {
            alert("PDF Generation failed.");
        }
    };

    const handleManagementComplete = () => {
        if (onStatusUpdate) onStatusUpdate();
        onClosePanel();
    };

    // Workflow action handler
    const handleWorkflowAction = (action) => {
        switch (action) {
            case 'call':
                if (appData?.phone) {
                    window.location.href = `tel:${appData.phone}`;
                    if (onPhoneClick) onPhoneClick(null, appData);
                }
                break;
            case 'contact':
                setActiveSection('contact');
                break;
            case 'go-to-dq':
                setActiveSection('dq');
                break;
            case 'go-to-pev':
                setActiveSection('pev');
                break;
            case 'add-note':
                setActiveSection('notes');
                break;
            case 'send-offer':
                setShowOfferModal(true);
                break;
            case 'background':
                handleStatusUpdate('Background Check');
                break;
            default:
                console.log('Workflow action:', action);
        }
    };

    // Tab navigation buttons
    const navItems = [
        { id: 'overview', label: 'Overview', icon: Briefcase },
        { id: 'contact', label: 'Contact', icon: Mail },
        { id: 'notes', label: 'Notes', icon: MessageSquare },
        { id: 'dq', label: 'DQ File', icon: UserCheck },
        { id: 'pev', label: 'PEV', icon: Briefcase },
        { id: 'docs', label: 'Documents', icon: Folder },
        { id: 'activity', label: 'Activity', icon: Clock }
    ];

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex items-center justify-center h-64">
                    <p className="text-red-500">{error}</p>
                </div>
            );
        }

        if (!appData) {
            return (
                <div className="flex items-center justify-center h-64">
                    <p className="text-gray-500">No data available</p>
                </div>
            );
        }

        // Render active section
        switch (activeSection) {
            case 'contact':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <ContactTab companyId={companyId} recordId={applicationId} collectionName={collectionName} email={appData.email} phone={appData.phone} applicantData={appData} />
                    </React.Suspense>
                );
            case 'notes':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <NotesTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />
                    </React.Suspense>
                );
            case 'dq':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <DQFileTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />
                    </React.Suspense>
                );
            case 'pev':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <PEVTab companyId={companyId} applicationId={applicationId} appData={appData} />
                    </React.Suspense>
                );
            case 'docs':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <GeneralDocumentsTab companyId={companyId} applicationId={applicationId} appData={appData} fileUrls={fileUrls} collectionName={collectionName} />
                    </React.Suspense>
                );
            case 'activity':
                return (
                    <React.Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>}>
                        <ActivityHistoryTab companyId={companyId} applicationId={applicationId} collectionName={collectionName} />
                    </React.Suspense>
                );
            default:
                // Overview - the new redesigned view
                return (
                    <div className="space-y-5">
                        {/* Risk Assessment */}
                        <RiskAssessmentBanner appData={appData} />

                        {/* Quick Facts - now using calculated dqStatus */}
                        <QuickFactsBar appData={appData} dqStatus={dqStatus} />

                        {/* Workflow Guide */}
                        <StatusWorkflowGuide currentStatus={currentStatus} onAction={handleWorkflowAction} />

                        {/* Employment Timeline */}
                        <EmploymentTimeline appData={appData} />

                        {/* DQ Compliance Preview */}
                        <DQComplianceIndicator
                            dqFiles={dqFiles}
                            onViewDQFile={() => setActiveSection('dq')}
                        />

                        {/* Collapsible Data Sections */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <AccordionSection
                                title="Personal Information"
                                preview={`${appData.firstName || ''} ${appData.lastName || ''} • ${appData.city || ''}, ${appData.state || ''}`}
                                defaultOpen={false}
                                variant="default"
                            >
                                <PersonalInfoSection
                                    appData={appData}
                                    isEditing={isEditing}
                                    handleDataChange={handleDataChange}
                                    canEditAllFields={canEditAllFields}
                                    onPhoneClick={onPhoneClick}
                                />
                            </AccordionSection>

                            <AccordionSection
                                title="Position & Qualifications"
                                preview={`${appData.positionApplyingTo || 'Driver'} • ${Array.isArray(appData.driverType) ? appData.driverType.join(', ') : appData.driverType || 'N/A'}`}
                                defaultOpen={false}
                                variant="default"
                            >
                                <QualificationsSection
                                    appData={appData}
                                    isEditing={isEditing}
                                    handleDataChange={handleDataChange}
                                    canEditAllFields={canEditAllFields}
                                />
                            </AccordionSection>

                            <AccordionSection
                                title="Driving Record & Safety"
                                preview={`${appData.violations?.length || 0} violations • ${appData.accidents?.length || 0} accidents`}
                                defaultOpen={false}
                                variant="default"
                            >
                                <SupplementalSection appData={appData} />
                            </AccordionSection>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div
            className="fixed inset-0 bg-slate-900/60 z-[60] backdrop-blur-sm flex justify-end transition-opacity duration-300"
            onClick={onClosePanel}
        >
            <div
                className="bg-gray-50 w-[90%] md:w-[80%] lg:w-[70%] xl:w-[65%] h-full shadow-2xl flex flex-col transform transition-transform duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Top Bar */}
                <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center shrink-0 shadow-sm z-10">
                    <div className="flex items-center gap-4">
                        {/* Assignee Dropdown */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-gray-400 uppercase">Assignee:</label>
                            <select
                                className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={assignedTo}
                                onChange={(e) => handleAssignChange(e.target.value)}
                                disabled={!canEdit}
                            >
                                <option value="">Unassigned</option>
                                {teamMembers.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!loading && appData && (
                            <>
                                {canEdit && ['Approved', 'Background Check'].includes(currentStatus) && (
                                    <button
                                        onClick={() => setShowOfferModal(true)}
                                        className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 transition shadow-sm flex items-center gap-2"
                                    >
                                        <FileSignature size={16} /> Offer
                                    </button>
                                )}
                                <button
                                    className="px-3 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 text-sm transition flex items-center gap-2"
                                    onClick={handleDownloadPdf}
                                >
                                    <Download size={16} /> PDF
                                </button>
                            </>
                        )}
                        <div className="h-6 w-px bg-gray-300 mx-1" />
                        <button
                            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition"
                            onClick={onClosePanel}
                        >
                            <X size={22} />
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className="p-6 space-y-5">
                        {/* Candidate Hero */}
                        {!loading && appData && (
                            <CandidateHero
                                appData={appData}
                                currentStatus={currentStatus}
                                handleStatusUpdate={handleStatusUpdate}
                                canEdit={canEdit}
                                onPhoneClick={onPhoneClick}
                            />
                        )}

                        {/* Section Nav */}
                        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
                            {navItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveSection(item.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeSection === item.id
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                        }`}
                                >
                                    <item.icon size={16} />
                                    <span className="hidden sm:inline">{item.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Active Content */}
                        {renderContent()}
                    </div>
                </div>

                {/* Footer Actions */}
                {(canEdit || isSuperAdmin) && activeSection === 'overview' && !loading && (
                    <div className="p-4 border-t border-gray-200 bg-white flex justify-between items-center shrink-0 z-10">
                        <div className="flex gap-3">
                            {isSuperAdmin && !isEditing && (
                                <button
                                    className="px-4 py-2 bg-indigo-100 text-indigo-700 font-bold rounded-lg hover:bg-indigo-200 transition flex items-center gap-2"
                                    onClick={() => setShowMoveModal(true)}
                                >
                                    <ArrowRight size={16} /> Move
                                </button>
                            )}
                            {!isEditing ? (
                                <button
                                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition flex items-center gap-2 shadow-sm"
                                    onClick={() => setIsEditing(true)}
                                >
                                    <Edit2 size={16} /> Edit
                                </button>
                            ) : (
                                <>
                                    <button
                                        className="px-4 py-2 text-gray-600 hover:underline font-medium"
                                        onClick={() => { setIsEditing(false); loadApplication(); }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition flex items-center gap-2 shadow-md"
                                        onClick={handleSaveEdit}
                                        disabled={isSaving}
                                    >
                                        <Save size={16} /> Save
                                    </button>
                                </>
                            )}
                        </div>
                        {!isEditing && (
                            <button
                                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-bold transition flex items-center gap-2"
                                onClick={() => setShowDeleteConfirm(true)}
                            >
                                <Trash2 size={16} /> Delete
                            </button>
                        )}
                    </div>
                )}

                {/* Modals */}
                {showDeleteConfirm && (
                    <DeleteConfirmModal
                        appName={currentAppName}
                        companyId={companyId}
                        applicationId={applicationId}
                        collectionName={collectionName}
                        onClose={() => setShowDeleteConfirm(false)}
                        onDeletionComplete={handleManagementComplete}
                    />
                )}
                {showMoveModal && isSuperAdmin && (
                    <MoveApplicationModal
                        sourceCompanyId={companyId}
                        applicationId={applicationId}
                        onClose={() => setShowMoveModal(false)}
                        onMoveComplete={handleManagementComplete}
                    />
                )}
                {showOfferModal && (
                    <SendOfferModal
                        companyId={companyId}
                        applicationId={applicationId}
                        driverId={driverId}
                        driverName={currentAppName}
                        onClose={() => setShowOfferModal(false)}
                        onOfferSent={() => { handleStatusUpdate('Offer Sent'); loadApplication(); }}
                    />
                )}
            </div>
        </div>
    );
}

export default ApplicationDetailViewV2;
