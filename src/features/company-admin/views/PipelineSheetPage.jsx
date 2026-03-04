// src/features/company-admin/views/PipelineSheetPage.jsx
// Excel-like hiring pipeline tracker with virtualized rows, click-to-edit cells, and real-time sync.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { useData } from '@/context/DataContext';
import { usePipelineEntries } from '../hooks/usePipelineEntries';
// formatPhoneNumber available from '@shared/utils/helpers' if display formatting is needed later
import { Plus, Loader2, Trash2, ClipboardList } from 'lucide-react';

// --- Constants ---
const STAGE_OPTIONS = [
    { value: 'in_process', label: 'In Process' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'hired', label: 'Hired' },
    { value: 'rejected', label: 'Rejected' },
];

const TYPE_OPTIONS = [
    'Company Driver',
    'Owner Operator',
    'Lease Purchase',
    'Student',
];

// --- Helpers ---
function getRowBg(hiringStage) {
    switch (hiringStage) {
        case 'hired': return 'bg-green-50';
        case 'rejected': return 'bg-red-50';
        case 'on_hold': return 'bg-yellow-50';
        case 'in_process':
        default: return 'bg-white';
    }
}

function getStagePillClass(stage) {
    switch (stage) {
        case 'hired': return 'text-green-700 bg-green-100 ring-1 ring-green-600/20';
        case 'rejected': return 'text-red-700 bg-red-100 ring-1 ring-red-600/20';
        case 'on_hold': return 'text-yellow-700 bg-yellow-100 ring-1 ring-yellow-600/20';
        default: return 'text-blue-700 bg-blue-100 ring-1 ring-blue-600/20';
    }
}

function isStale(entry) {
    if (entry.hiringStage !== 'in_process') return false;
    const ts = entry.lastModifiedAt?.toMillis?.() || entry._localLastModifiedAt || 0;
    if (!ts) return false;
    return Date.now() - ts > 24 * 60 * 60 * 1000;
}

// --- Stable component overrides for TableVirtuoso ---
// MUST be defined outside the render function to prevent remounting rows on every state change.
const VirtuosoTable = (props) => (
    <table {...props} className="w-full table-fixed border-collapse" />
);
const VirtuosoTableHead = React.forwardRef((props, ref) => (
    <thead {...props} ref={ref} className="sticky top-0 z-10" />
));
const VirtuosoTableRow = (props) => (
    <tr {...props} className="hover:brightness-95 transition-colors" />
);

const TABLE_COMPONENTS = {
    Table: VirtuosoTable,
    TableHead: VirtuosoTableHead,
    TableRow: VirtuosoTableRow,
};

// --- Click-to-Edit Text Cell ---
function EditableCell({ value, onSave, placeholder = '—', type = 'text', className = '' }) {
    const [editing, setEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value || '');
    const inputRef = useRef(null);

    useEffect(() => {
        setLocalValue(value || '');
    }, [value]);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select?.();
        }
    }, [editing]);

    const handleSave = useCallback(() => {
        setEditing(false);
        if (localValue !== (value || '')) {
            onSave(localValue);
        }
    }, [localValue, value, onSave]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && type !== 'textarea') {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            setLocalValue(value || '');
            setEditing(false);
        }
    }, [handleSave, value, type]);

    if (!editing) {
        return (
            <div
                className={`cursor-pointer px-2 py-1 min-h-[28px] rounded hover:bg-gray-100 transition-colors truncate ${className}`}
                onClick={() => setEditing(true)}
                title={value || placeholder}
            >
                <span className={value ? 'text-gray-900' : 'text-gray-400 italic'}>
                    {value || placeholder}
                </span>
            </div>
        );
    }

    if (type === 'textarea') {
        return (
            <textarea
                ref={inputRef}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none bg-white"
                rows={2}
            />
        );
    }

    return (
        <input
            ref={inputRef}
            type={type}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
    );
}

// --- Click-to-Edit Select Cell ---
function EditableSelectCell({ value, options, onSave, className = '' }) {
    const [editing, setEditing] = useState(false);
    const selectRef = useRef(null);

    useEffect(() => {
        if (editing && selectRef.current) {
            selectRef.current.focus();
        }
    }, [editing]);

    if (!editing) {
        return (
            <div
                className={`cursor-pointer px-2 py-1 min-h-[28px] rounded hover:bg-gray-100 transition-colors ${className}`}
                onClick={() => setEditing(true)}
            >
                <span className="text-gray-900">{value || '—'}</span>
            </div>
        );
    }

    return (
        <select
            ref={selectRef}
            value={value}
            onChange={(e) => {
                onSave(e.target.value);
                setEditing(false);
            }}
            onBlur={() => setEditing(false)}
            className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        >
            {options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    );
}

// --- Comments Cell (debounced) ---
function CommentsCell({ value, onSave, onEditStart, onEditEnd }) {
    const [localValue, setLocalValue] = useState(value || '');
    const [editing, setEditing] = useState(false);
    const textareaRef = useRef(null);

    useEffect(() => {
        if (!editing) {
            setLocalValue(value || '');
        }
    }, [value, editing]);

    useEffect(() => {
        if (editing && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [editing]);

    const handleChange = useCallback((e) => {
        const newVal = e.target.value;
        setLocalValue(newVal);
        onSave(newVal); // Hook handles debouncing
    }, [onSave]);

    if (!editing) {
        return (
            <div
                className="cursor-pointer px-2 py-1 min-h-[28px] rounded hover:bg-gray-100 transition-colors"
                onClick={() => { setEditing(true); onEditStart?.(); }}
                title={value || 'Click to add comments'}
            >
                <span className={value ? 'text-gray-900 text-sm whitespace-pre-wrap line-clamp-2' : 'text-gray-400 italic text-sm'}>
                    {value || 'Add comments...'}
                </span>
            </div>
        );
    }

    return (
        <textarea
            ref={textareaRef}
            value={localValue}
            onChange={handleChange}
            onBlur={() => { setEditing(false); onEditEnd?.(); }}
            className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none bg-white"
            rows={3}
        />
    );
}

// ========================================================
// MAIN PAGE COMPONENT
// ========================================================
export function PipelineSheetPage() {
    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id;

    const {
        entries,
        loading,
        addEntry,
        updateField,
        updateComments,
        deleteEntry,
        beginEdit,
        endEdit,
        entryCount,
    } = usePipelineEntries(companyId);

    const [confirmDelete, setConfirmDelete] = useState(null);

    const handleAddDriver = useCallback(() => {
        addEntry({});
    }, [addEntry]);

    const handleDelete = useCallback((entryId) => {
        if (confirmDelete === entryId) {
            deleteEntry(entryId);
            setConfirmDelete(null);
        } else {
            setConfirmDelete(entryId);
            // Auto-clear confirm state after 3 seconds
            setTimeout(() => setConfirmDelete(null), 3000);
        }
    }, [confirmDelete, deleteEntry]);

    // --- Loading State ---
    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 size={32} className="animate-spin text-blue-500" />
                    <p className="text-gray-500 text-sm">Loading pipeline...</p>
                </div>
            </div>
        );
    }

    // --- Empty State ---
    if (entryCount === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-4 max-w-sm text-center">
                    <div className="bg-gray-100 p-5 rounded-full">
                        <ClipboardList size={48} className="text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">No pipeline entries yet</h3>
                    <p className="text-gray-500 text-sm">
                        Click "Add Driver" to start tracking your hiring pipeline. Changes sync in real-time across your team.
                    </p>
                    <button
                        onClick={handleAddDriver}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium shadow-sm"
                    >
                        <Plus size={18} />
                        Add Your First Driver
                    </button>
                </div>
            </div>
        );
    }

    // --- Table Header ---
    const fixedHeaderContent = () => (
        <tr className="bg-gray-50">
            <th className="w-[45px] px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                #
            </th>
            <th className="w-[180px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Driver Name
            </th>
            <th className="w-[150px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Driver Type
            </th>
            <th className="w-[150px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Phone Number
            </th>
            <th className="w-[150px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Hiring Stage
            </th>
            <th className="min-w-[200px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Comments
            </th>
            <th className="w-[140px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Last Checked
            </th>
            <th className="w-[120px] px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                Added Date
            </th>
            <th className="w-[50px] px-3 py-3 border-b border-gray-200" />
        </tr>
    );

    // --- Table Row ---
    const itemContent = (index, entry) => {
        const stale = isStale(entry);
        return (
            <>
                {/* Row Number */}
                <td className={`px-2 py-1 border-b border-gray-100 text-center text-xs font-medium text-gray-400 ${getRowBg(entry.hiringStage)}`}>
                    {index + 1}
                </td>

                {/* Driver Name */}
                <td className={`px-1 py-1 border-b border-gray-100 ${getRowBg(entry.hiringStage)}`}>
                    <EditableCell
                        value={entry.driverName}
                        placeholder="Enter name"
                        onSave={(val) => updateField(entry.id, 'driverName', val)}
                    />
                </td>

                {/* Driver Type */}
                <td className={`px-1 py-1 border-b border-gray-100 ${getRowBg(entry.hiringStage)}`}>
                    <EditableSelectCell
                        value={entry.driverType}
                        options={TYPE_OPTIONS}
                        onSave={(val) => updateField(entry.id, 'driverType', val)}
                    />
                </td>

                {/* Phone Number */}
                <td className={`px-1 py-1 border-b border-gray-100 ${getRowBg(entry.hiringStage)}`}>
                    <EditableCell
                        value={entry.phoneNumber}
                        placeholder="Enter phone"
                        type="tel"
                        onSave={(val) => updateField(entry.id, 'phoneNumber', val)}
                        className="font-mono text-sm"
                    />
                </td>

                {/* Hiring Stage */}
                <td className={`px-1 py-1 border-b border-gray-100 ${getRowBg(entry.hiringStage)}`}>
                    <select
                        value={entry.hiringStage}
                        onChange={(e) => updateField(entry.id, 'hiringStage', e.target.value)}
                        className={`w-full px-2 py-1.5 text-xs font-semibold rounded-md cursor-pointer border-0 focus:outline-none focus:ring-2 focus:ring-blue-400 ${getStagePillClass(entry.hiringStage)}`}
                    >
                        {STAGE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </td>

                {/* Comments */}
                <td className={`px-1 py-1 border-b border-gray-100 ${getRowBg(entry.hiringStage)}`}>
                    <CommentsCell
                        key={entry.id}
                        value={entry.comments}
                        onSave={(val) => updateComments(entry.id, val)}
                        onEditStart={() => beginEdit(entry.id)}
                        onEditEnd={endEdit}
                    />
                </td>

                {/* Last Checked */}
                <td className={`px-2 py-1 border-b border-gray-100 text-sm ${stale
                    ? 'bg-purple-100 text-purple-800 font-bold border border-purple-200'
                    : getRowBg(entry.hiringStage) + ' text-gray-600'
                    }`}>
                    {entry.lastCheckedDisplay || '—'}
                    {stale && (
                        <div className="text-[10px] font-medium text-purple-600 mt-0.5">
                            Stale — 24h+
                        </div>
                    )}
                </td>

                {/* Added Date */}
                <td className={`px-2 py-1 border-b border-gray-100 text-sm text-gray-600 ${getRowBg(entry.hiringStage)}`}>
                    {(() => {
                        const ts = entry.createdAt;
                        if (!ts) return <span className="text-gray-400 italic">—</span>;
                        try {
                            const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
                            if (isNaN(d.getTime())) return <span className="text-gray-400 italic">—</span>;
                            return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                        } catch {
                            return <span className="text-gray-400 italic">—</span>;
                        }
                    })()}
                </td>

                {/* Delete */}
                <td className={`px-1 py-1 border-b border-gray-100 text-center ${getRowBg(entry.hiringStage)}`}>
                    <button
                        onClick={() => handleDelete(entry.id)}
                        className={`p-1 rounded transition-colors ${confirmDelete === entry.id
                            ? 'bg-red-100 text-red-600 hover:bg-red-200'
                            : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                            }`}
                        title={confirmDelete === entry.id ? 'Click again to confirm delete' : 'Delete entry'}
                    >
                        <Trash2 size={15} />
                    </button>
                </td>
            </>
        );
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-gray-50">
            {/* Header Toolbar */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
                    <span className="px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                        {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                    </span>
                </div>
                <button
                    onClick={handleAddDriver}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm shadow-sm"
                >
                    <Plus size={16} />
                    Add Driver
                </button>
            </div>

            {/* Virtualized Table — fills remaining height */}
            <div className="flex-1 min-h-0">
                <TableVirtuoso
                    data={entries}
                    style={{ height: '100%' }}
                    computeItemKey={(index, entry) => entry.id}
                    fixedHeaderContent={fixedHeaderContent}
                    itemContent={itemContent}
                    components={TABLE_COMPONENTS}
                />
            </div>
        </div>
    );
}

export default PipelineSheetPage;
