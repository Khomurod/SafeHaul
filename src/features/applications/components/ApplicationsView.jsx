import React, { useState, useMemo, useEffect } from 'react';
import { getFieldValue, getStatusColor } from '@shared/utils/helpers';
import { FileText, Search, ArrowDownUp, Filter, Zap, ChevronLeft, ChevronRight, Building2, Loader2 } from 'lucide-react';

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

const sortApplications = (apps, config) => {
  const { key, direction } = config;
  
  return [...apps].sort((a, b) => {
    let aVal, bVal;
    
    switch(key) {
      case 'name':
        aVal = `${a['firstName'] || ''} ${a['lastName'] || ''}`.toLowerCase().trim();
        bVal = `${b['firstName'] || ''} ${b['lastName'] || ''}`.toLowerCase().trim();
        break;
      case 'company':
        aVal = a.companyName?.toLowerCase() || '';
        bVal = b.companyName?.toLowerCase() || '';
        break;
      case 'state':
        aVal = a['state'] || '';
        bVal = b['state'] || '';
        break;
      case 'submittedAt':
      default:
        aVal = a.submittedAt?.seconds || a.createdAt?.seconds || 0;
        bVal = b.submittedAt?.seconds || b.createdAt?.seconds || 0;
        break;
    }

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });
};

export function ApplicationsView({ 
  listLoading, 
  statsError, 
  allApplications, 
  allCompaniesMap,
  onAppClick 
}) {
  const [appSearch, setAppSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'submittedAt', direction: 'desc' });
  const [filterSource, setFilterSource] = useState('All');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const filteredApplications = useMemo(() => {
    const searchTerm = appSearch.toLowerCase();
    
    const appsWithData = allApplications.map(app => ({
      ...app,
      companyName: allCompaniesMap.get(app.companyId) || (app.companyId === 'general-leads' ? 'General Pool' : 'Unknown')
    }));
    
    const filtered = appsWithData.filter(app => {
      const name = `${app['firstName'] || ''} ${app['lastName'] || ''}`.toLowerCase();
      const companyName = app.companyName.toLowerCase();
      const matchesText = (name.includes(searchTerm) ||
              app.email?.toLowerCase().includes(searchTerm) ||
              companyName.includes(searchTerm));

      let matchesTab = true;
      if (filterSource === 'Added by Safehaul') {
          matchesTab = app.sourceType === 'Added by Safehaul';
      } else if (filterSource === 'Company App') {
          matchesTab = app.sourceType !== 'Added by Safehaul' && app.sourceType !== 'General Lead';
      }

      return matchesText && matchesTab;
    });
    
    return sortApplications(filtered, sortConfig);
    
  }, [appSearch, allApplications, allCompaniesMap, sortConfig, filterSource]);

  const totalPages = Math.ceil(filteredApplications.length / itemsPerPage);
  const paginatedData = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return filteredApplications.slice(start, start + itemsPerPage);
  }, [filteredApplications, currentPage, itemsPerPage]);

  useEffect(() => {
      setCurrentPage(1);
  }, [appSearch, filterSource, itemsPerPage]);
  
  const handleSortChange = (e) => {
    const [key, direction] = e.target.value.split(',');
    setSortConfig({ key, direction });
  };

  return (
    <Card title="Driver Applications Master List" icon={<FileText size={20} className="text-blue-600"/>} className="h-full">
      
      <div className="bg-white p-4 border-b border-gray-200 flex flex-col gap-4">
          
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button 
                onClick={() => setFilterSource('All')} 
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${filterSource === 'All' ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
                All Drivers
            </button>
            <button 
                onClick={() => setFilterSource('Company App')} 
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${filterSource === 'Company App' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
                <Building2 size={14}/> Direct Apps
            </button>
            <button 
                onClick={() => setFilterSource('Added by Safehaul')} 
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${filterSource === 'Added by Safehaul' ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
                <Zap size={14} /> SafeHaul Leads
            </button>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="relative w-full sm:max-w-md">
                <input
                    type="text"
                    placeholder="Search driver, email, or company..."
                    className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                />
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              
              <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative w-full sm:w-auto">
                    <select
                        className="w-full sm:w-48 pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm font-medium bg-white focus:ring-2 focus:ring-blue-500 appearance-none"
                        onChange={handleSortChange}
                        value={`${sortConfig.key},${sortConfig.direction}`}
                    >
                        <option value="submittedAt,desc">Newest First</option>
                        <option value="submittedAt,asc">Oldest First</option>
                        <option value="name,asc">Name (A-Z)</option>
                        <option value="name,desc">Name (Z-A)</option>
                        <option value="company,asc">Company (A-Z)</option>
                    </select>
                    <ArrowDownUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
              </div>
          </div>
      </div>
      
      <div className="flex-1 overflow-auto min-h-0 bg-gray-50">
        <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Driver</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Company / Source</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Status</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Date</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
                {listLoading ? (
                    <tr><td colSpan="4" className="p-10 text-center text-gray-500"><Loader2 className="animate-spin mx-auto mb-2"/>Loading applications...</td></tr>
                ) : statsError.apps ? (
                    <tr><td colSpan="4" className="p-10 text-center text-red-500">Error loading data.</td></tr>
                ) : filteredApplications.length === 0 ? (
                    <tr><td colSpan="4" className="p-10 text-center text-gray-400">No applications found matching your criteria.</td></tr>
                ) : (
                    paginatedData.map(app => {
                         const name = `${getFieldValue(app['firstName'])} ${getFieldValue(app['lastName'])}`;
                         const isSafeHaul = app.sourceType === 'Added by Safehaul';

                         return (
                            <tr 
                                key={app.id} 
                                onClick={() => onAppClick(app)}
                                className="hover:bg-gray-50 cursor-pointer transition-colors group"
                            >
                                <td className="px-6 py-4 align-middle">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 group-hover:bg-blue-100 group-hover:border-blue-200 transition-colors">
                                            {name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-gray-900">{name}</p>
                                            <p className="text-xs text-gray-500">{getFieldValue(app.email)}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-middle">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-gray-800">{app.companyName}</span>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            {isSafeHaul ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase tracking-wide">
                                                    <Zap size={10} fill="currentColor" /> SafeHaul
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 uppercase tracking-wide">
                                                    <Building2 size={10} /> Direct
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 align-middle">
                                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusColor(app.status || 'New Application').replace('bg-', 'bg-opacity-90 bg-').replace('text-', 'border-')}`}>
                                        {app.status || 'New Application'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 align-middle text-right text-sm text-gray-500 font-mono">
                                     {app.createdAt ? new Date(app.createdAt.seconds * 1000).toLocaleDateString() : '--'}
                                </td>
                            </tr>
                         );
                    })
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
