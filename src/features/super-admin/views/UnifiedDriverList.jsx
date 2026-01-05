// src/features/super-admin/views/UnifiedDriverList.jsx
import React, { useState, useMemo } from 'react';
import { db } from '@lib/firebase'; // Updated to use alias
import { doc, deleteDoc } from 'firebase/firestore';
import { 
    Search, Trash2, Filter, Download, 
    FileText, Zap, User, Briefcase, Share2, Loader2 
} from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers'; // Updated to use alias
import { useToast } from '@shared/components/feedback'; // Updated to use alias

// Helper for Source Badge
const SourceBadge = ({ type }) => {
    switch (type) {
        case 'Company App':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200">
                    <FileText size={12}/> Direct App
                </span>
            );
        case 'Global Pool':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200">
                    <Zap size={12}/> Global Pool
                </span>
            );
        case 'Distributed Lead':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                    <Share2 size={12}/> Distributed
                </span>
            );
        case 'Company Import':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">
                    <Briefcase size={12}/> Company Import
                </span>
            );
        default:
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {type}
                </span>
            );
    }
};

export function UnifiedDriverList({ 
    allApplications, 
    allCompaniesMap, 
    onAppClick,
    onDataUpdate
}) {
    const { showSuccess, showError } = useToast();
    const [search, setSearch] = useState('');
    const [filterSource, setFilterSource] = useState('All');
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [deletingId, setDeletingId] = useState(null);

    // --- Pagination ---
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);

    // --- Data Processing ---
    const filteredData = useMemo(() => {
        let data = [...allApplications];

        // 1. Search
        if (search) {
            const term = search.toLowerCase();
            data = data.filter(item => {
                const name = `${item.firstName || ''} ${item.lastName || ''}`.toLowerCase();
                const email = (item.email || '').toLowerCase();
                const phone = (item.phone || '').toLowerCase();
                const company = (allCompaniesMap.get(item.companyId) || '').toLowerCase();

                return name.includes(term) || email.includes(term) || phone.includes(term) || company.includes(term);
            });
        }

        // 2. Filter Source
        if (filterSource !== 'All') {
            data = data.filter(item => item.sourceType === filterSource);
        }

        // 3. Sort
        data.sort((a, b) => {
            const aDate = a.createdAt?.seconds || 0;
            const bDate = b.createdAt?.seconds || 0;

            if (sortConfig.key === 'date') {
                return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
            }
            if (sortConfig.key === 'name') {
                const aName = `${a.firstName} ${a.lastName}`;
                const bName = `${b.firstName} ${b.lastName}`;
                return sortConfig.direction === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
            }
            return 0;
        });

        return data;
    }, [allApplications, search, filterSource, sortConfig, allCompaniesMap]);

    // --- Pagination Logic ---
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(start, start + itemsPerPage);
    }, [filteredData, currentPage, itemsPerPage]);

    // --- Actions ---
    const handleDelete = async (e, item) => {
        e.stopPropagation();
        if (!window.confirm(`SUPER ADMIN WARNING:\n\nAre you sure you want to PERMANENTLY DELETE this record for ${item.firstName} ${item.lastName}?\n\nThis will remove it from the source collection. This cannot be undone.`)) {
            return;
        }

        setDeletingId(item.id);
        try {
            // Determine Path based on Source Type logic
            let docRef;
            if (item.sourceType === 'Global Pool' || item.sourceType === 'Bulk Lead') {
                // It's in the root leads collection
                docRef = doc(db, "leads", item.id);
            } else if (item.companyId && item.companyId !== 'general-leads') {
                // It's inside a company
                // Check if it's an application or a lead
                const collectionName = item.sourceType === 'Company App' ? 'applications' : 'leads';
                docRef = doc(db, "companies", item.companyId, collectionName, item.id);
            } else {
                // Fallback guessing
                docRef = doc(db, "leads", item.id);
            }

            await deleteDoc(docRef);
            showSuccess("Record deleted successfully.");
            onDataUpdate(); // Refresh the list
        } catch (err) {
            console.error("Delete failed:", err);
            showError("Failed to delete. Check console.");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="space-y-6 h-full flex flex-col">

            {/* Header / Controls */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-end md:items-center shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">Unified Driver Database</h2>
                    <p className="text-sm text-gray-500">{filteredData.length} records found across all systems</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    {/* Search */}
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                        <input 
                            type="text" 
                            placeholder="Global Search..." 
                            className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-64"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    {/* Filter */}
                    <div className="relative">
                        <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                        <select 
                            className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                            value={filterSource}
                            onChange={(e) => setFilterSource(e.target.value)}
                        >
                            <option value="All">All Sources</option>
                            <option value="Global Pool">Global Pool</option>
                            <option value="Company App">Direct Applications</option>
                            <option value="Distributed Lead">Distributed Leads</option>
                            <option value="Company Import">Company Imports</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3 border-b border-gray-200">Driver</th>
                                <th className="px-6 py-3 border-b border-gray-200">Source / Type</th>
                                <th className="px-6 py-3 border-b border-gray-200">Owner</th>
                                <th className="px-6 py-3 border-b border-gray-200">Status</th>
                                <th className="px-6 py-3 border-b border-gray-200">Date</th>
                                <th className="px-6 py-3 border-b border-gray-200 text-right">Admin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {paginatedData.map(item => (
                                <tr 
                                    key={item.id} 
                                    onClick={() => onAppClick(item)}
                                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                                >
                                    <td className="px-6 py-3">
                                        <div className="font-bold text-gray-900">
                                            {item.firstName} {item.lastName}
                                        </div>
                                        <div className="text-xs text-gray-400 font-mono flex gap-2">
                                            {item.email}
                                        </div>
                                    </td>
                                    <td className="px-6 py-3">
                                        <SourceBadge type={item.sourceType} />
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className="text-xs text-gray-600 font-medium">
                                            {allCompaniesMap.get(item.companyId) || (item.companyId === 'general-leads' ? 'System (Unassigned)' : item.companyId)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`inline-block px-2 py-0.5 text-xs rounded border bg-gray-50 text-gray-600 border-gray-200`}>
                                            {item.status || 'New'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-sm text-gray-500">
                                        {item.createdAt?.seconds 
                                            ? new Date(item.createdAt.seconds * 1000).toLocaleDateString() 
                                            : '--'}
                                    </td>
                                    <td className="px-6 py-3 text-right" onClick={e => e.stopPropagation()}>
                                        <button 
                                            onClick={(e) => handleDelete(e, item)}
                                            disabled={deletingId === item.id}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Delete Permanently"
                                        >
                                            {deletingId === item.id ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredData.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-10 text-center text-gray-400">
                                        No drivers found matching your search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center text-sm text-gray-600">
                    <div>Showing {paginatedData.length} of {filteredData.length}</div>
                    <div className="flex gap-2">
                        <button 
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                        >
                            Prev
                        </button>
                        <button 
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}