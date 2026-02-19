import React, { useState, useRef } from 'react';
import { Upload, X, CheckCircle, RefreshCw, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';

/**
 * UploadField
 * A reliable file upload component with progress tracking, retry logic, and previews.
 * 
 * @param {string} label - Label for the input
 * @param {object|string} value - The current value (URL string or file object {name, url})
 * @param {function} onUpload - Async function(file) -> Promise<result>
 * @param {function} onChange - Function to update parent state (fieldName, result)
 * @param {string} name - Field name
 * @param {boolean} required - Is required?
 * @param {string} accept - File types to accept (default: "image/*,application/pdf")
 */
const UploadField = ({
    label,
    value,
    onUpload,
    onChange,
    name,
    required = false,
    accept = "image/*,application/pdf"
}) => {
    const [status, setStatus] = useState('idle'); // idle, uploading, success, error
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState(null);
    const fileInputRef = useRef(null);

    // Determine current display
    const hasValue = !!value;
    const fileName = value?.name || (typeof value === 'string' ? 'Uploaded File' : null);
    const fileUrl = value?.url || (typeof value === 'string' ? value : null);
    const isImage = fileName?.match(/\.(jpg|jpeg|png|gif|webp)$/i) || (typeof value === 'string');

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset
        setStatus('uploading');
        setProgress(10); // Start progress
        setErrorMsg(null);

        // Fake progress for UX (since Firebase uploadBytes doesn't give granular progress easily without stream)
        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 90) return 90;
                return prev + Math.random() * 10;
            });
        }, 200);

        try {
            // Perform Upload
            const result = await onUpload(name, file);

            clearInterval(progressInterval);
            setProgress(100);
            setStatus('success');

            // Notify Parent
            onChange(name, result);

            // Reset status after a moment to show the "File Card"
            setTimeout(() => {
                setStatus('idle');
            }, 1000);

        } catch (err) {
            clearInterval(progressInterval);
            console.error("Upload failed in component:", err);
            setStatus('error');
            setErrorMsg("Upload failed. Please try again.");
            setProgress(0);
        }
    };

    const handleRetry = () => {
        fileInputRef.current?.click();
    };

    const handleClear = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("Are you sure you want to remove this file?")) {
            onChange(name, null);
            setStatus('idle');
            setProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
                {label} {required && <span className="text-red-500">*</span>}
            </label>

            {/* ERROR STATE */}
            {status === 'error' && (
                <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2 text-red-700">
                        <AlertCircle size={18} />
                        <span className="text-sm font-medium">{errorMsg}</span>
                    </div>
                    <button
                        type="button"
                        onClick={handleRetry}
                        className="px-3 py-1 bg-white border border-red-200 text-red-600 text-xs font-bold rounded shadow-sm hover:bg-gray-50 flex items-center gap-1"
                    >
                        <RefreshCw size={12} /> Retry
                    </button>
                </div>
            )}

            {/* UPLOADING STATE */}
            {status === 'uploading' && (
                <div className="p-4 border border-blue-200 bg-blue-50/50 rounded-lg space-y-2">
                    <div className="flex justify-between text-xs font-semibold text-blue-700 mb-1">
                        <span>Uploading...</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                        <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>
            )}

            {/* SUCCESS / VIEW STATE */}
            {(hasValue && status !== 'uploading' && status !== 'error') && (
                <div className="group relative flex items-center p-3 border border-green-200 bg-green-50/30 rounded-lg hover:bg-green-50 transition-all">
                    <div className="flex-shrink-0 h-10 w-10 bg-green-100 rounded-lg flex items-center justify-center text-green-600 mr-3 overflow-hidden">
                        {isImage && fileUrl ? (
                            <img src={fileUrl} alt="Preview" className="h-full w-full object-cover" />
                        ) : (
                            <FileText size={20} />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                            {fileName}
                        </p>
                        <p className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle size={12} /> Uploaded Successfully
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* View Link */}
                        {fileUrl && (
                            <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                                title="View File"
                            >
                                <ImageIcon size={18} />
                            </a>
                        )}
                        {/* Remove Button */}
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                            title="Remove File"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* IDLE / EMPTY STATE */}
            {(!hasValue && status !== 'uploading') && (
                <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`cursor-pointer border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-gray-50 transition-colors ${status === 'error' ? 'border-red-300' : 'border-gray-300 hover:border-blue-400'}`}
                >
                    <div className="h-10 w-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-2">
                        <Upload size={20} />
                    </div>
                    <p className="text-sm font-medium text-gray-900">Click to upload</p>
                    <p className="text-xs text-gray-500 mt-1">
                        {accept.includes('image') ? 'PDF, PNG, JPG accepted' : 'Files accepted'}
                    </p>
                </div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                name={name}
                className="hidden"
                accept={accept}
                onChange={handleFileSelect}
            />
        </div>
    );
};

export default UploadField;
