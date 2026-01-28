import React from 'react';
import { Users, CheckSquare, Square, Wrench, Loader2 } from 'lucide-react';
import { useBulkImport } from '@shared/hooks';
import { useCompanyLeadUpload } from '../hooks/useCompanyLeadUpload';
import { BulkUploadLayout } from '@shared/components/admin/BulkUploadLayout';

export function CompanyBulkUpload({ companyId, onClose, onUploadComplete }) {
    const {
        csvData,
        step: importStep, setStep: setImportStep,
        importMethod, setImportMethod,
        sheetUrl, setSheetUrl,
        processingSheet,
        handleSheetImport,
        handleFileChange,
        reset: resetImport
    } = useBulkImport();

    const {
        uploading,
        progress,
        stats,
        step: uploadStep, setStep: setUploadStep,
        assignmentMode, setAssignmentMode,
        teamMembers,
        selectedUserIds, setSelectedUserIds,
        uploadLeads,
        runDataRepair
    } = useCompanyLeadUpload(companyId, onUploadComplete);

    const currentStep = uploadStep !== 'upload' ? uploadStep : importStep;

    const handleConfirm = async () => {
        try {
            await uploadLeads(csvData, importMethod);
        } catch (error) {
            alert(error.message);
        }
    };

    const handleReset = () => {
        resetImport();
        setUploadStep('upload');
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
        if (confirm("This will scan your leads for 'Email' fields that look like Phone Numbers and move them to the correct field. Continue?")) {
            runDataRepair();
        }
    };

    const CustomPreviewContent = (
        <div className="space-y-6 mb-4">
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <h4 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                    <Users size={16} /> Lead Assignment
                </h4>
                <div className="flex gap-3 mb-4">
                    <button
                        onClick={() => setAssignmentMode('unassigned')}
                        className={`flex-1 py-2 px-3 text-xs font-semibold rounded border transition-all ${assignmentMode === 'unassigned' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                        Unassigned (Pool)
                    </button>
                    <button
                        onClick={() => setAssignmentMode('round_robin')}
                        className={`flex-1 py-2 px-3 text-xs font-semibold rounded border transition-all ${assignmentMode === 'round_robin' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                        Distribute to Team
                    </button>
                </div>

                {assignmentMode === 'round_robin' && (
                    <div className="bg-white rounded-lg border border-blue-200 p-3 animate-in fade-in">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-100">
                            <span className="text-xs font-bold text-gray-500 uppercase">Select Recipients</span>
                            <button onClick={handleSelectAll} className="text-xs text-blue-600 hover:underline font-medium">
                                {selectedUserIds.length === teamMembers.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                            {teamMembers.map(member => {
                                const isSelected = selectedUserIds.includes(member.id);
                                return (
                                    <div
                                        key={member.id}
                                        onClick={() => handleToggleUser(member.id)}
                                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors border ${isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50 border-transparent'}`}
                                    >
                                        {isSelected ?
                                            <CheckSquare size={16} className="text-blue-600" /> :
                                            <Square size={16} className="text-gray-300" />
                                        }
                                        <span className={`text-sm ${isSelected ? 'text-blue-900 font-medium' : 'text-gray-600'}`}>{member.name}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-blue-400 mt-2 text-center">
                            Leads will be distributed equally among the {selectedUserIds.length} selected member{selectedUserIds.length !== 1 && 's'}.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );

    const RepairButton = currentStep === 'upload' && !uploading ? (
        <button
            onClick={handleRepairClick}
            className="flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-800 hover:bg-orange-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-orange-200"
            title="Fix leads where phone numbers were pasted into the email field"
        >
            {uploading ? <Loader2 className="animate-spin" size={14} /> : <Wrench size={14} />} Fix Data Mismatch
        </button>
    ) : null;

    const handleDownloadTemplate = () => {
        const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'City', 'State', 'Experience', 'Job Type'];
        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
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
      Required: First Name + Last Name (or just "Name"), Email, Phone.
      
      - We automatically detect headers.
      - Phone numbers are normalized automatically.
      - Emails are required for automation.
  `;

    return (
        <BulkUploadLayout
            title="Import Private Leads"
            step={currentStep}
            importMethod={importMethod}
            setImportMethod={setImportMethod}
            sheetUrl={sheetUrl}
            setSheetUrl={setSheetUrl}
            processingSheet={processingSheet}
            handleSheetImport={handleSheetImport}
            handleFileChange={handleFileChange}
            csvData={csvData}
            reset={handleReset}
            onConfirm={handleConfirm}
            onClose={onClose}
            uploading={uploading}
            progress={progress}
            stats={stats}
            children={currentStep === 'preview' ? CustomPreviewContent : null}
            headerAction={RepairButton}
            onDownloadTemplate={handleDownloadTemplate}
            instructions={uploadInstructions}
        />
    );
}
