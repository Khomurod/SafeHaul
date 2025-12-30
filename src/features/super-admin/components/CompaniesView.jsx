import React, { useState, useMemo, useEffect } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Building, FileText, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Loader2, Crown, Shield } from 'lucide-react';

function Card({ title, icon, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col ${className}`}>
      <div className="p-5 border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          {icon}
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

export function CompaniesView({ 
  listLoading, 
  statsError, 
  companyList, 
  onViewApps, 
  onEdit, 
  onDelete 
}) {
  const [companySearch, setCompanySearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const filteredCompanyList = useMemo(() => {
    const searchTerm = companySearch.toLowerCase();
    if (!searchTerm) return companyList;
    
    return companyList.filter(company => {
      const name = company.companyName?.toLowerCase() || '';
      const slug = company.appSlug?.toLowerCase() || '';
      const id = company.id.toLowerCase();
      
      return name.includes(searchTerm) || slug.includes(searchTerm) || id.includes(searchTerm);
    });
  }, [companySearch, companyList]);

  const totalPages = Math.ceil(filteredCompanyList.length / itemsPerPage);
  const paginatedData = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return filteredCompanyList.slice(start, start + itemsPerPage);
  }, [filteredCompanyList, currentPage, itemsPerPage]);

  useEffect(() => {
      setCurrentPage(1);
  }, [companySearch, itemsPerPage]);

  return (
    <Card title="Manage Companies" icon={<Building size={20} className="text-blue-600"/>} className="h-full">
      
      <div className="p-4 border-b border-gray-200 bg-white flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
        <div>
             <p className="text-sm text-gray-500">Registered Companies: <strong>{companyList.length}</strong></p>
        </div>
        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search companies..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 bg-gray-50">
        <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Company Name</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Slug / ID</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Plan</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
                {listLoading ? (
                    <tr><td colSpan="4" className="p-10 text-center text-gray-500"><Loader2 className="animate-spin mx-auto mb-2"/>Loading companies...</td></tr>
                ) : statsError.companies ? (
                    <tr><td colSpan="4" className="p-10 text-center text-red-500">Error loading companies.</td></tr>
                ) : filteredCompanyList.length === 0 ? (
                    <tr><td colSpan="4" className="p-10 text-center text-gray-400">No companies found.</td></tr>
                ) : (
                    paginatedData.map(company => (
                        <tr key={company.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 align-middle">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-lg font-bold text-gray-500 shrink-0">
                                        {company.companyLogoUrl ? (
                                            <img src={company.companyLogoUrl} alt="Logo" className="w-full h-full object-contain rounded-lg" />
                                        ) : (
                                            getFieldValue(company.companyName).charAt(0)
                                        )}
                                    </div>
                                    <span className="font-semibold text-gray-900">{getFieldValue(company.companyName)}</span>
                                </div>
                            </td>
                            <td className="px-6 py-4 align-middle">
                                <div className="flex flex-col">
                                    <span className="text-sm font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded w-fit">/{getFieldValue(company.appSlug)}</span>
                                    <span className="text-xs text-gray-400 mt-1 font-mono">{company.id}</span>
                                </div>
                            </td>
                            <td className="px-6 py-4 align-middle">
                                {company.planType === 'paid' ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-200">
                                        <Crown size={12} fill="currentColor" /> Pro Plan
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200">
                                        <Shield size={12} /> Free Plan
                                    </span>
                                )}
                            </td>
                            <td className="px-6 py-4 align-middle text-right">
                                <div className="flex justify-end gap-2">
                                    <button 
                                        onClick={() => onViewApps({ id: company.id, name: company.companyName })} 
                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="View Applications"
                                    >
                                        <FileText size={18} />
                                    </button>
                                    <button 
                                        onClick={() => onEdit(company.id)} 
                                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                        title="Edit Company"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button 
                                        onClick={() => onDelete({ id: company.id, name: company.companyName })} 
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Delete Company"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
      </div>

      <div className="border-t border-gray-200 p-4 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
            <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Show</span>
                <select 
                    value={itemsPerPage} 
                    onChange={(e) => setItemsPerPage(Number(e.target.value))} 
                    className="border-gray-300 rounded-md text-xs py-1.5 pl-2 pr-6 bg-white focus:ring-blue-500 focus:border-blue-500"
                >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                </select>
                <span>per page</span>
            </div>

            <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">
                    Page <strong>{currentPage}</strong> of <strong>{totalPages || 1}</strong>
                </span>
                <div className="flex gap-1">
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                        disabled={currentPage === 1}
                        className="p-2 rounded-md bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white transition-all"
                    >
                        <ChevronLeft size={16} className="text-gray-600"/>
                    </button>
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                        disabled={currentPage >= totalPages}
                        className="p-2 rounded-md bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white transition-all"
                    >
                        <ChevronRight size={16} className="text-gray-600"/>
                    </button>
                </div>
            </div>
      </div>
    </Card>
  );
}