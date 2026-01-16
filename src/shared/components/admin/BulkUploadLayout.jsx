import React from 'react';
import { Upload, FileSpreadsheet, Link as LinkIcon, X, CheckCircle, AlertCircle, Loader2, ArrowRight, RotateCcw, Download, HelpCircle } from 'lucide-react';

export function BulkUploadLayout({
    title = "Bulk Upload",
    step,
    importMethod,
    setImportMethod,
    sheetUrl,
    setSheetUrl,
    processingSheet,
    handleSheetImport,
    handleFileChange,
    csvData,
    reset,
    onConfirm,
    onClose,
    uploading,
    progress,
    stats,
    children,
    headerAction,
    // NEW PROPS
    onDownloadTemplate,
    instructions
}) {
    const steps = [
        { id: 'upload', label: 'Upload' },
        { id: 'preview', label: 'Preview' },
        { id: 'success', label: 'Finish' }
    ];

    const currentStepIndex = steps.findIndex(s => s.id === step);

    const renderStepIndicator = () => (
        <div className="flex items-center justify-center mb-6">
            {steps.map((s, idx) => (
                <div key={s.id} className="flex items-center">
                    <div className={`flex items-center gap-2 ${idx <= currentStepIndex ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${idx < currentStepIndex ? 'bg-blue-600 text-white border-blue-600' :
                                idx === currentStepIndex ? 'bg-white text-blue-600 border-blue-600' :
                                    'bg-white text-gray-400 border-gray-200'
                            }`}>
                            {idx < currentStepIndex ? <CheckCircle size={14} /> : idx + 1}
                        </div>
                        <span className="text-sm font-medium">{s.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                        <div className={`w-8 h-0.5 mx-2 ${idx < currentStepIndex ? 'bg-blue-600' : 'bg-gray-200'}`} />
                    )}
                </div>
            ))}
        </div>
    );

    const renderUploadStep = () => (
        <div className="space-y-6">
            {instructions && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 flex items-start gap-3">
                    <HelpCircle size={18} className="shrink-0 mt-0.5" />
                    <div>
                        <h4 className="font-bold mb-1">Instructions</h4>
                        <div className="opacity-90 leading-relaxed whitespace-pre-line">{instructions}</div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-6">
                <button
                    onClick={() => setImportMethod('file')}
                    className={`p-4 border-2 rounded-xl transition-all ${importMethod === 'file'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                >
                    <Upload className="mx-auto mb-2" size={24} />
                    <span className="font-medium">Upload File</span>
                </button>
                <button
                    onClick={() => setImportMethod('gsheet')}
                    className={`p-4 border-2 rounded-xl transition-all ${importMethod === 'gsheet'
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                >
                    <FileSpreadsheet className="mx-auto mb-2" size={24} />
                    <span className="font-medium">Google Sheet</span>
                </button>
            </div>

            {onDownloadTemplate && (
                <div className="flex justify-end mb-2">
                    <button
                        onClick={onDownloadTemplate}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 hover:underline"
                    >
                        <Download size={14} /> Download CSV Template
                    </button>
                </div>
            )}

            {importMethod === 'file' && (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors">
                    <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                        <Upload className="mx-auto mb-4 text-gray-400" size={40} />
                        <p className="text-gray-600 font-medium">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400 mt-1">CSV, XLS, or XLSX files</p>
                    </label>
                </div>
            )}

            {importMethod === 'gsheet' && (
                <div className="space-y-4">
                    <div className="flex gap-2">
                        <input
                            type="url"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="Paste Google Sheet URL..."
                            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                        <button
                            onClick={handleSheetImport}
                            disabled={!sheetUrl || processingSheet}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {processingSheet ? <Loader2 className="animate-spin" size={18} /> : <LinkIcon size={18} />}
                            Import
                        </button>
                    </div>
                    <p className="text-xs text-gray-500">Make sure the sheet is publicly accessible or shared with view permissions.</p>
                </div>
            )}
        </div>
    );

    const renderPreviewStep = () => (
        <div className="space-y-4">
            {children}

            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-3 bg-gray-100 border-b border-gray-200 flex justify-between items-center">
                    <span className="font-medium text-gray-700">Preview ({csvData?.length || 0} records)</span>
                    <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                        <RotateCcw size={14} /> Reset
                    </button>
                </div>
                <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {csvData?.[0] && Object.keys(csvData[0]).slice(0, 5).map((key) => (
                                    <th key={key} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                        {key}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {csvData?.slice(0, 10).map((row, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    {Object.values(row).slice(0, 5).map((val, j) => (
                                        <td key={j} className="px-3 py-2 text-gray-700 truncate max-w-[150px]">
                                            {String(val || '')}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <button
                onClick={onConfirm}
                disabled={uploading}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {uploading ? (
                    <>
                        <Loader2 className="animate-spin" size={20} />
                        {progress || 'Processing...'}
                    </>
                ) : (
                    <>
                        Confirm Upload <ArrowRight size={18} />
                    </>
                )}
            </button>
        </div>
    );

    const renderSuccessStep = () => (
        <div className="text-center py-8">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={64} />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Upload Complete!</h3>
            <div className="flex justify-center gap-6 text-sm text-gray-600 mb-6">
                <span><strong className="text-green-600">{stats?.created || 0}</strong> Created</span>
                <span><strong className="text-blue-600">{stats?.updated || 0}</strong> Updated</span>
            </div>
            <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200"
            >
                Close
            </button>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200">
                <div className="p-5 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                    <div className="flex items-center gap-3">
                        {headerAction}
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-6">
                    {renderStepIndicator()}
                    {step === 'upload' && renderUploadStep()}
                    {step === 'preview' && renderPreviewStep()}
                    {step === 'success' && renderSuccessStep()}
                </div>
            </div>
        </div>
    );
}
