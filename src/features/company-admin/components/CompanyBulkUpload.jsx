import React, { useId, useState } from 'react';
import { Wrench } from 'lucide-react';
import { useBulkImport } from '@shared/hooks';
import { useCompanyLeadUpload } from '../hooks/useCompanyLeadUpload';
import { BulkUploadLayout } from '@shared/components/admin/BulkUploadLayout';
import { Modal } from '@shared/components/modals/Modal';
import {
    Button, Card, Checkbox, ChoiceGroup, Radio,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * Company lead bulk import.
 *
 * Feature-owned: the "Import Private Leads" vocabulary, the CSV template
 * contents, the assignment vocabulary and its `'unassigned'` / `'round_robin'`
 * values, the team-member list, and the data-repair action. All visual and
 * interaction behaviour comes from the design system and `BulkUploadLayout`.
 *
 * Migrated 2026-07-27. Defects fixed, presentation only:
 *
 *  1. The two assignment tiles were toggle `<button>`s whose selection was
 *     communicated by colour alone — now a real radio group.
 *  2. Each team member was a `<div onClick>` with a decorative check icon: no
 *     role, no accessible name, no checked state, and unreachable by keyboard.
 *     They are now real checkboxes.
 *  3. The distribution note used `text-[10px]`, below the 12 px floor.
 *  4. The repair action used a blocking `window.confirm`, which cannot be
 *     reached as page content and steals focus. It is now an accessible
 *     confirmation dialog with the same question, verbatim.
 *  5. Upload, import and repair failures used blocking `alert()`. They now
 *     render in place as `role="alert"` messages with the same text.
 *
 * Frozen: `uploadLeads(csvData, importMethod)`, the CSV template headers /
 * sample row / filename, the accepted formats, the instructions text, the
 * assignment values, the team-member ids and round-robin behaviour, and every
 * user-facing string.
 */
export function CompanyBulkUpload({ companyId, onClose, onUploadComplete, isEmbedded = false }) {
    const instanceId = useId().replace(/:/g, '');
    const repairTitleId = `bulk-upload-repair-title-${instanceId}`;
    const recipientsLabelId = `bulk-upload-recipients-${instanceId}`;

    /**
     * Single non-blocking sink for everything that used to be an `alert()`.
     * `tone` keeps a failure assertive and an informational outcome polite.
     * Cleared whenever the user starts the action again so a stale message can
     * never be mistaken for a fresh one.
     */
    const [feedback, setFeedback] = useState({ message: '', tone: 'error' });
    const reportError = (message) => setFeedback({ message, tone: 'error' });
    const reportInfo = (message) => setFeedback({ message, tone: 'info' });
    const clearFeedback = () => setFeedback({ message: '', tone: 'error' });
    const [repairConfirmOpen, setRepairConfirmOpen] = useState(false);

    const {
        csvData,
        step: importStep,
        importMethod, setImportMethod,
        sheetUrl, setSheetUrl,
        processingSheet,
        handleSheetImport,
        handleFileChange,
        reset: resetImport
    } = useBulkImport({ onError: reportError });

    const {
        uploading,
        progress,
        progressCount,
        stats,
        step: uploadStep, setStep: setUploadStep,
        assignmentMode, setAssignmentMode,
        teamMembers,
        selectedUserIds, setSelectedUserIds,
        uploadLeads,
        runDataRepair
    } = useCompanyLeadUpload(companyId, onUploadComplete, {
        onError: reportError,
        onInfo: reportInfo,
    });

    const currentStep = uploadStep !== 'upload' ? uploadStep : importStep;

    const handleConfirm = async () => {
        clearFeedback();
        try {
            await uploadLeads(csvData, importMethod);
        } catch (error) {
            reportError(error.message);
        }
    };

    const handleReset = () => {
        clearFeedback();
        resetImport();
        setUploadStep('upload');
    };

    const handleFileSelected = (event) => {
        clearFeedback();
        handleFileChange(event);
    };

    const handleSheetImportClick = () => {
        clearFeedback();
        handleSheetImport();
    };

    const handleToggleUser = (userId) => {
        setSelectedUserIds(prev => {
            if (prev.includes(userId)) return prev.filter(id => id !== userId);
            return [...prev, userId];
        });
    };

    const handleSelectAll = () => {
        if (selectedUserIds.length === teamMembers.length) {
            setSelectedUserIds([]);
        } else {
            setSelectedUserIds(teamMembers.map(m => m.id));
        }
    };

    const handleRepairClick = () => {
        clearFeedback();
        setRepairConfirmOpen(true);
    };

    const handleRepairConfirmed = () => {
        setRepairConfirmOpen(false);
        runDataRepair();
    };

    const allSelected = selectedUserIds.length === teamMembers.length;

    const CustomPreviewContent = (
        <Card
            padding="md"
            className="border-ds-status-info-border bg-ds-status-info-bg"
        >
            <Stack gap="md">
                {/*
                  "Lead Assignment" is the group's `<legend>`, not a separate
                  heading: the pre-migration markup showed it as a heading AND
                  gave the two options no group at all, so assistive technology
                  never heard the question before the answers. Repeating it as a
                  heading as well would announce it twice.
                */}
                <ChoiceGroup legend="Lead Assignment" orientation="horizontal">
                    <Radio
                        name={`lead-assignment-${instanceId}`}
                        label="Unassigned (Pool)"
                        value="unassigned"
                        checked={assignmentMode === 'unassigned'}
                        onChange={() => setAssignmentMode('unassigned')}
                    />
                    <Radio
                        name={`lead-assignment-${instanceId}`}
                        label="Distribute to Team"
                        value="round_robin"
                        checked={assignmentMode === 'round_robin'}
                        onChange={() => setAssignmentMode('round_robin')}
                    />
                </ChoiceGroup>

                {assignmentMode === 'round_robin' && (
                    <Card padding="sm" className="border-ds-status-info-border">
                        <div className="mb-ds-2 flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle pb-ds-2">
                            <span
                                id={recipientsLabelId}
                                className="text-ds-xs font-bold uppercase text-ds-content-muted"
                            >
                                Select Recipients
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleSelectAll}
                                aria-describedby={recipientsLabelId}
                            >
                                {allSelected ? 'Deselect All' : 'Select All'}
                            </Button>
                        </div>

                        {/*
                          `role="group"` rather than the approved `ChoiceGroup`:
                          the group's label row also carries the Select All
                          action, and `ChoiceGroup` renders a `<legend>` with no
                          slot for an action beside it. The semantics that matter
                          — a named group wrapping real checkboxes — are the same.
                          Recorded as a feature-owned exception in the roadmap.
                        */}
                        <div
                            role="group"
                            aria-labelledby={recipientsLabelId}
                            className="grid max-h-40 grid-cols-1 gap-ds-2 overflow-y-auto sm:grid-cols-2"
                        >
                            {teamMembers.map(member => (
                                <Checkbox
                                    key={member.id}
                                    label={member.name}
                                    checked={selectedUserIds.includes(member.id)}
                                    onChange={() => handleToggleUser(member.id)}
                                />
                            ))}
                        </div>

                        <p className="mt-ds-2 text-center text-ds-xs text-ds-content-secondary">
                            Leads will be distributed equally among the {selectedUserIds.length} selected member{selectedUserIds.length !== 1 && 's'}.
                        </p>
                    </Card>
                )}
            </Stack>
        </Card>
    );

    const RepairButton = currentStep === 'upload' && !uploading ? (
        <Button
            variant="ghost"
            size="sm"
            onClick={handleRepairClick}
            title="Fix leads where phone numbers were pasted into the email field"
        >
            <Wrench size={14} aria-hidden="true" /> Fix Data Mismatch
        </Button>
    ) : null;

    const handleDownloadTemplate = () => {
        const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'City', 'State', 'Experience', 'Job Type'];
        const sampleRow = ['John', 'Doe', 'john@example.com', '(555) 123-4567', 'Dallas', 'TX', '5', 'OTR'];
        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + sampleRow.join(",");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "leads_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const uploadInstructions = `
      Format: CSV, XLS, or XLSX.
      Required: First Name + Last Name (or just "Name"), Phone.

      - We automatically detect headers.
      - Phone numbers are normalized automatically.
      - Emails are optional — placeholders are auto-generated when missing.
  `;

    return (
        <>
            <BulkUploadLayout
                title="Import Private Leads"
                step={currentStep}
                importMethod={importMethod}
                setImportMethod={setImportMethod}
                sheetUrl={sheetUrl}
                setSheetUrl={setSheetUrl}
                processingSheet={processingSheet}
                handleSheetImport={handleSheetImportClick}
                handleFileChange={handleFileSelected}
                csvData={csvData}
                reset={handleReset}
                onConfirm={handleConfirm}
                onClose={onClose}
                uploading={uploading}
                progress={progress}
                progressCount={progressCount}
                stats={stats}
                headerAction={RepairButton}
                onDownloadTemplate={handleDownloadTemplate}
                instructions={uploadInstructions}
                isEmbedded={isEmbedded}
                error={feedback.tone === 'error' ? feedback.message : ''}
                notice={feedback.tone === 'info' ? feedback.message : ''}
            >
                {currentStep === 'preview' ? CustomPreviewContent : null}
            </BulkUploadLayout>

            {repairConfirmOpen && (
                <Modal
                    onClose={() => setRepairConfirmOpen(false)}
                    labelledBy={repairTitleId}
                    className="w-full max-w-md rounded-ds-xl bg-ds-surface p-ds-6 shadow-ds-lg"
                >
                    <h2 id={repairTitleId} className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        Fix Data Mismatch
                    </h2>
                    <p className="mb-ds-6 text-ds-content-secondary">
                        This will scan your leads for &apos;Email&apos; fields that look like Phone Numbers and move them to the correct field. Continue?
                    </p>
                    <div className="flex justify-end gap-ds-3">
                        <Button variant="secondary" onClick={() => setRepairConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleRepairConfirmed}>
                            Continue
                        </Button>
                    </div>
                </Modal>
            )}
        </>
    );
}
