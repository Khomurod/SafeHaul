import React, { useState, useMemo, useCallback, useId } from 'react';
import { Icon, Briefcase, CheckCircle2, ShieldCheck, Info } from '@design-system/icons';
import { getFieldValue } from '@shared/utils/helpers';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';

import { VOEPreviewModal } from '../modals/VOEPreviewModal';
import { PEVRequestModal } from '../modals/PEVRequestModal';
import { db, functions } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { PaywallMessage } from '@shared/components/feedback/PaywallMessage';
import { Card, MetricCard } from '@/design-system/components';
import { PEVEmployerCard, PEVHistoryModal } from './PEVTabParts';

/**
 * Previous Employment Verification — initiation and tracking.
 *
 * Presentation uses the approved `Card`, `MetricCard`, `Badge`, `Button`
 * and `IconButton` primitives, the approved accessible `Modal`, and `--ds-*`
 * tokens.
 *
 * DELIBERATELY NOT MIGRATED in this campaign: `VOEPreviewModal`'s generated
 * document layout and its PDF/print rendering, and the external employer
 * response portal. The transition into `VOEPreviewModal` — including the fact
 * that closing it returns to the request modal rather than the list — is
 * unchanged.
 *
 * Frozen contracts: the `features.pev === false` paywall gate; the
 * `sendVerificationRequest` payload; the
 * `logActivity(companyId, collectionName, applicationId, 'PEV_REQUEST', entry, 'pev')`
 * argument list and the exact log-entry string; the Firestore
 * `updateDoc(companies/{companyId}/{collectionName}/{applicationId}, { employers })`
 * write and the verification/history object shapes; the optimistic
 * `localOverrides` merge; the `getSignedPevUrl({ storagePath })` payload and the
 * `http(s)`-opens-directly rule; every `window.open(url, '_blank',
 * 'noopener,noreferrer')` call; the clipboard write; the
 * `companies/{companyId}/{collectionName}/{applicationId}/pev_results/{Date.now()}_{name}`
 * Storage path and the `.pdf,image/*` accept list; the `'email' | 'fax' |
 * 'manual'` delivery values and their `Email | Fax | Manual` labels; the
 * `'Manual Download'` recipient fallback; and every toast string.
 *
 * Rules this tab keeps:
 * - **The verification-history overlay is the approved accessible `Modal`**
 *   (`role="dialog"`, `aria-modal`, focus containment, focus restoration,
 *   Escape), because it opens on top of the driver dossier, which *is* a modal
 *   dialog.
 * - **Its close control has an accessible name** and a real close icon.
 * - **The history dialog's title reads `companyName || name`**, the same chain
 *   as the list, so a legacy employer is named rather than "Not Specified": it
 *   is the one place that tells you *whose* verification trail you are reading.
 * - **The Resend action has an accessible name**, not a `title` alone.
 * - **No interface text below the 12 px floor**, the summary cards, the status
 *   badges and the FMCSA notes included.
 * - **The employer list is a real list**, so assistive technology announces how
 *   many employers there are.
 * - **The in-flight upload and signed-URL fetches announce** through a
 *   `role="status"` live region.
 * - **Status is never colour alone**: the pill is an approved `Badge` whose tone
 *   is layered over its own text.
 */

export function PEVTab({ companyId, applicationId, appData, collectionName = 'applications' }) {
    const { showSuccess, showError } = useToast();
    const { currentCompanyProfile } = useData();
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [showInitiateModal, setShowInitiateModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const historyTitleId = `pev-history-title-${useId().replace(/:/g, '')}`;
    const closeHistoryRef = React.useRef(null);

    // Base statuses derived from Firestore data (reactive to parent appData refreshes)
    const baseStatuses = useMemo(() => {
        const result = {};
        (appData?.employers || []).forEach((emp, idx) => {
            result[idx] = emp.verification || { status: 'Not Started', history: [] };
        });
        return result;
    }, [appData]);

    // Local overrides for instant optimistic UI updates (merged over base)
    const [localOverrides, setLocalOverrides] = useState({});

    // Merged view: base from Firestore + any local optimistic changes
    const verificationStatuses = useMemo(() => ({
        ...baseStatuses,
        ...localOverrides
    }), [baseStatuses, localOverrides]);

    const [uploadingResult, setUploadingResult] = useState(false);
    const fileRef = React.useRef(null);
    const [uploadTargetIndex, setUploadTargetIndex] = useState(null);
    const [historyTargetIndex, setHistoryTargetIndex] = useState(null);
    const [loadingResultUrl, setLoadingResultUrl] = useState(null); // Track which index is loading a signed URL

    const employers = useMemo(() => appData?.employers || [], [appData]);

    /**
     * Write a verification mirror onto one employer row, without clobbering the rest.
     *
     * `[...employers]` from `appData` is a snapshot of whenever the dossier last
     * read the application, and writing the WHOLE array back would lose anything
     * that changed on another row in between — including the stable `employerId`
     * that `sendVerificationRequest` stamps on the rows it resolves, after which
     * the employer's own answer would have no row it could safely be filed
     * against.
     *
     * So the document is re-read here and the change applied to what is actually
     * stored — and the row is found by `employerId` when the callable returned one,
     * because an index is exactly the thing that moves.
     *
     * @param {{employerId?: string, index: number, apply: (verification: object) => void}} target
     * @returns {Promise<object|null>} the verification as written, for the
     *   optimistic override, or null when the row could not be found.
     */
    const writeVerification = useCallback(async ({ employerId, index, apply }) => {
        const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
        const snap = await getDoc(appRef);
        const rows = snap.exists() && Array.isArray(snap.data()?.employers)
            ? [...snap.data().employers]
            : [];
        const found = employerId
            ? rows.findIndex((row) => row?.employerId === employerId)
            : index;
        if (found < 0 || !rows[found]) return null;

        const verification = { history: [], ...(rows[found].verification || {}) };
        apply(verification);
        rows[found] = { ...rows[found], verification };
        await updateDoc(appRef, { employers: rows });
        return verification;
    }, [companyId, collectionName, applicationId]);

    /**
     * Opens a PEV result file. Handles both:
     *  - Cloud Storage paths (from portal submissions) → calls getSignedPevUrl for a fresh signed URL
     *  - Full URLs (from manual uploads via getDownloadURL) → opens directly
     */
    const handleViewResult = useCallback(async (urlOrPath, index = null) => {
        if (!urlOrPath) return;

        // If it's already a full URL (https://...), open directly (manual upload case)
        if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
            window.open(urlOrPath, '_blank', 'noopener,noreferrer');
            return;
        }

        // Otherwise it's a Cloud Storage path — need to get a signed URL
        setLoadingResultUrl(index);
        try {
            const getSignedUrl = httpsCallable(functions, 'getSignedPevUrl');
            const result = await getSignedUrl({ storagePath: urlOrPath });
            if (result.data?.url) {
                window.open(result.data.url, '_blank', 'noopener,noreferrer');
            } else {
                showError('Could not retrieve the document URL.');
            }
        } catch (error) {
            console.error('Error fetching signed URL:', error);
            if (error?.code === 'functions/not-found') {
                showError('The result file was not found in storage. It may have been deleted.');
            } else {
                showError('Failed to open the verification result.');
            }
        } finally {
            setLoadingResultUrl(null);
        }
    }, [showError]);

    const stats = useMemo(() => {
        const total = employers.length;
        const completed = Object.values(verificationStatuses).filter(s => s.status === 'Completed').length;
        const pending = Object.values(verificationStatuses).filter(s => ['Sent', 'Requested'].includes(s.status)).length;
        return { total, completed, pending };
    }, [employers, verificationStatuses]);

    const handleInitiate = (employer, index) => {
        setSelectedEmployer({ ...employer, index });
        setShowInitiateModal(true);
    };

    const handleProceedToPreview = (method, contactInfo) => {
        setShowInitiateModal(false);
        setSelectedEmployer(prev => ({ ...prev, deliveryMethod: method, contactInfo }));
        setShowPreviewModal(true);
    };

    const handleFinalSend = async () => {
        // Set once the server has filed the request, so a later failure is not
        // reported as a failed send and the link, which is never stored, survives.
        let filed = null;
        try {
            const emp = selectedEmployer;
            const method = emp.deliveryMethod === 'email' ? 'Email' : emp.deliveryMethod === 'fax' ? 'Fax' : 'Manual';
            const recipient = emp.deliveryMethod === 'email' ? emp.contactInfo?.email : 'Manual Download';

            const applicantName = `${getFieldValue(appData?.firstName)} ${getFieldValue(appData?.lastName)}`.trim();
            const employerName = getFieldValue(emp.companyName || emp.name);
            const startDate = getFieldValue(emp.startDate);
            const endDate = getFieldValue(emp.endDate);

            const sendVerificationFn = httpsCallable(functions, 'sendVerificationRequest');
            const result = await sendVerificationFn({
                companyId,
                applicationId,
                collectionName,
                employerIndex: emp.index,
                employerName,
                employerEmail: emp.deliveryMethod === 'email' ? emp.contactInfo?.email : null,
                applicantName,
                employmentStartDate: startDate,
                employmentEndDate: endDate,
                deliveryMethod: emp.deliveryMethod,
            });

            if (!result.data?.success) {
                showError(`Verification request failed: ${result.data?.error || 'Unknown error'}. Please check your email settings.`);
                return;
            }

            // The link is the employer's key to the verification form. Anyone who can
            // read this application could use it, so it is never stored (PEV-SEC-3):
            // it shows in this session only, for a manual send to pass on.
            const verificationUrl = result.data.verificationUrl;
            filed = { index: emp.index, method, verificationUrl };
            const logEntry = `Initiated ${method} verification for ${employerName} (Sent to: ${recipient})`;

            await logActivity(
                companyId,
                collectionName,
                applicationId,
                'PEV_REQUEST',
                logEntry,
                'pev'
            );

            // Written onto the stored row, not a stale snapshot — see `writeVerification`.
            const written = await writeVerification({
                employerId: result.data.employerId,
                index: emp.index,
                apply: (verification) => {
                    // An older screen stored the previous request's link here; it is not this request's.
                    delete verification.verificationUrl;
                    delete verification.token;
                    verification.status = 'Sent';
                    verification.method = method;
                    verification.history = [...(verification.history || []), {
                        action: 'Sent via Portal',
                        method,
                        recipient,
                        timestamp: new Date().toISOString(),
                    }];
                },
            });

            if (written) {
                setLocalOverrides(prev => ({
                    ...prev,
                    [emp.index]: verificationUrl ? { ...written, verificationUrl } : written,
                }));
            }

            showSuccess(`Verification request sent to ${getFieldValue(emp.companyName || emp.name)} via ${method} (${recipient})`);
            setShowPreviewModal(false);
            setSelectedEmployer(null);
        } catch (error) {
            console.error("PEV Send Error:", error);
            if (!filed) return showError("Failed to initiate verification.");
            // Shown as sent, with its link, in this session: sending again would file a second request.
            const { index, ...sent } = filed;
            setLocalOverrides(prev => ({ ...prev, [index]: { ...(prev[index] || baseStatuses[index]), status: 'Sent', ...sent } }));
            showError("The request was created, but this application did not update. Its link is on the employer's row.");
            setShowPreviewModal(false);
            setSelectedEmployer(null);
        }
    };

    const handleUploadResult = async (e, index) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingResult(true);
        try {
            const storagePath = `companies/${companyId}/${collectionName}/${applicationId}/pev_results/${Date.now()}_${file.name}`;
            const fileRefObj = ref(storage, storagePath);
            await uploadBytes(fileRefObj, file);
            const downloadUrl = await getDownloadURL(fileRefObj);

            // Update DB, against what is stored rather than a stale snapshot.
            const written = await writeVerification({
                employerId: employers[index]?.employerId,
                index,
                apply: (verification) => {
                    verification.status = 'Completed';
                    verification.resultUrl = downloadUrl;
                    verification.history = [...(verification.history || []), {
                        action: 'Result Uploaded',
                        fileName: file.name,
                        url: downloadUrl,
                        timestamp: new Date().toISOString(),
                    }];
                },
            });

            if (written) {
                setLocalOverrides(prev => ({
                    ...prev,
                    [index]: written,
                }));
            }

            showSuccess('Verification result uploaded successfully.');
        } catch (error) {
            console.error("Upload Error:", error);
            showError("Failed to upload verification result.");
        } finally {
            setUploadingResult(false);
            if (fileRef.current) fileRef.current.value = null;
            setUploadTargetIndex(null);
        }
    };

    if (currentCompanyProfile?.features?.pev === false) {
        return (
            <div className="p-ds-8">
                <PaywallMessage
                    // `<h4>` under the dossier header's `<h3>` section title.
                    headingLevel="h4"
                    title="PEV Module Unavailable"
                    message="The Previous Employment Verification module is currently turned off for your company. Please contact our Sales Team to enable automated VOE."
                />
            </div>
        );
    }

    const historyEmployer = historyTargetIndex === null ? null : employers[historyTargetIndex];
    const historyEntries = historyTargetIndex === null
        ? []
        : (verificationStatuses[historyTargetIndex]?.history || []);

    return (
        <div className="mx-auto max-w-6xl space-y-ds-6">
            {/* Summary */}
            <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-3">
                <MetricCard
                    label="Total Employers"
                    value={stats.total}
                    tone="info"
                    icon={<Icon icon={Briefcase} size="2xl" />}
                />
                <MetricCard
                    label="Completed"
                    value={stats.completed}
                    tone="success"
                    icon={<Icon icon={CheckCircle2} size="2xl" />}
                />
                <MetricCard
                    label="Compliance Status"
                    value="Audit in Progress"
                    tone="warning"
                    icon={<Icon icon={ShieldCheck} size="2xl" />}
                />
            </div>

            {/* Verification Center */}
            <Card padding="lg">
                {/* `<h4>` sits under the dossier header's `<h3>` section title. */}
                <h4 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-body-lg font-bold text-ds-content">
                    Verification Center (DOT Compliance)
                </h4>

                <div className="space-y-ds-4">
                    <p className="flex items-start gap-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 text-ds-xs font-medium text-ds-content-secondary">
                        <Icon icon={Info} size="sm" className="mt-0.5 shrink-0 text-ds-action-primary" />
                        FMCSA 391.23(a)(2) requires investigation of employment history for the previous 3 years from the date of the application.
                    </p>

                    {/*
                      One live region for both asynchronous actions in this tab.
                      Previously the upload and the signed-URL fetch showed only a
                      spinning icon, so neither was announced at all.
                    */}
                    <p role="status" className="ds-visually-hidden">
                        {uploadingResult
                            ? 'Uploading verification result…'
                            : loadingResultUrl !== null
                                ? 'Opening the verification result…'
                                : ''}
                    </p>

                    {employers.length === 0 ? (
                        <div className="rounded-ds-lg border-2 border-dashed border-ds-border p-ds-12 text-center">
                            {/* Page-level empty state in a fluid box: 40 -> `3xl` (32). */}
                            <Icon icon={Briefcase} size="3xl" className="mx-auto mb-ds-3 text-ds-content-muted" />
                            <p className="italic text-ds-content-secondary">No historical employers detected in this application.</p>
                        </div>
                    ) : (
                        <ul className="grid gap-ds-4">
                            {employers.map((emp, index) => {
                                const vStatus = verificationStatuses[index] || { status: 'Not Started' };
                                return (
                                    <li key={index}>
                                        <PEVEmployerCard
                                            emp={emp}
                                            index={index}
                                            vStatus={vStatus}
                                            handleInitiate={handleInitiate}
                                            handleViewResult={handleViewResult}
                                            loadingResultUrl={loadingResultUrl}
                                            uploadingResult={uploadingResult}
                                            uploadTargetIndex={uploadTargetIndex}
                                            setUploadTargetIndex={setUploadTargetIndex}
                                            setHistoryTargetIndex={setHistoryTargetIndex}
                                            fileRef={fileRef}
                                            showSuccess={showSuccess}
                                        />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </Card>

            {/* VOE Modals */}
            {showInitiateModal && selectedEmployer && (
                <PEVRequestModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowInitiateModal(false);
                        setSelectedEmployer(null);
                    }}
                    onProceed={handleProceedToPreview}
                />
            )}

            {showPreviewModal && selectedEmployer && (
                <VOEPreviewModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowPreviewModal(false);
                        setShowInitiateModal(true); // Go back to choice
                    }}
                    onSend={handleFinalSend}
                />
            )}

            {/*
              Hidden file input, driven by the per-employer "Upload Result"
              button.

              DOCUMENTED EXCEPTION — feature-owned file input; the design system
              has no approved file-input contract yet (Phase 4, recorded in the
              roadmap), the same gap the public application's `UploadField`
              documents.

              DEFECT FIX: it carried no accessible name and was hidden by a CSS
              class alone. Any environment that does not apply the stylesheet
              exposed an unlabelled file control (axe `label`, critical). It now
              names itself and is hidden by the native attribute as well, so it
              leaves the accessibility tree without depending on CSS.
            */}
            <input
                type="file"
                ref={fileRef}
                hidden
                className="hidden"
                accept=".pdf,image/*"
                aria-label="Upload verification result file"
                onChange={(e) => handleUploadResult(e, uploadTargetIndex)}
            />

            {/* History */}
            {historyTargetIndex !== null && (
                <PEVHistoryModal
                    historyTitleId={historyTitleId}
                    closeHistoryRef={closeHistoryRef}
                    setHistoryTargetIndex={setHistoryTargetIndex}
                    historyEmployer={historyEmployer}
                    historyEntries={historyEntries}
                    handleViewResult={handleViewResult}
                    loadingResultUrl={loadingResultUrl}
                />
            )}
        </div>
    );
}
