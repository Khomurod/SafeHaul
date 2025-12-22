import React, { useState, useMemo, useEffect } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Users, Briefcase, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Loader2, ShieldCheck } from 'lucide-react';

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

export function UsersView({ 
  listLoading, 
  statsError, 
  userList, 
  allCompaniesMap, 
  onEdit, 
  onDelete 
}) {
  const [userSearch, setUserSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const filteredUserList = useMemo(() => {
    const searchTerm = userSearch.toLowerCase();
    if (!searchTerm) return userList;

    return userList.filter(user => {
      return (user.name?.toLowerCase().includes(searchTerm) ||
              user.email?.toLowerCase().includes(searchTerm));
    });
  }, [userSearch, userList]);

  const totalPages = Math.ceil(filteredUserList.length / itemsPerPage);
  const paginatedData = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return filteredUserList.slice(start, start + itemsPerPage);
  }, [filteredUserList, currentPage, itemsPerPage]);

  useEffect(() => {
      setCurrentPage(1);
  }, [userSearch, itemsPerPage]);

  return (
    <Card title="Manage All Users" icon={<Users size={20} className="text-blue-600"/>} className="h-full">
      
      <div className="p-4 border-b border-gray-200 bg-white flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
        <div>
             <p className="text-sm text-gray-500">Total Users: <strong>{userList.length}</strong></p>
        </div>
        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search users..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 bg-gray-50">
        <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">User</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Role & Access</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
                {listLoading ? (
                    <tr><td colSpan="3" className="p-10 text-center text-gray-500"><Loader2 className="animate-spin mx-auto mb-2"/>Loading users...</td></tr>
                ) : statsError.users ? (
                    <tr><td colSpan="3" className="p-10 text-center text-red-500">Error loading users.</td></tr>
                ) : filteredUserList.length === 0 ? (
                    <tr><td colSpan="3" className="p-10 text-center text-gray-400">No users found.</td></tr>
                ) : (
                    paginatedData.map(user => (
                        <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 align-middle">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-purple-100 border border-purple-200 flex items-center justify-center text-sm font-bold text-purple-700 shrink-0">
                                        {getFieldValue(user.name).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">{getFieldValue(user.name)}</p>
                                        <p className="text-xs text-gray-500">{getFieldValue(user.email)}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 align-middle">
                                <div className="flex flex-wrap gap-2">
                                    {user.globalRole === 'super_admin' ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                                            <ShieldCheck size={12} /> Super Admin
                                        </span>
                                    ) : user.memberships.length > 0 ? (
                                        user.memberships.map(mem => (
                                            <div key={mem.companyId} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                                <Briefcase size={12} />
                                                {mem.role === 'company_admin' ? 'Admin' : 'User'} at {allCompaniesMap.get(mem.companyId) || "Unknown"}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs text-gray-400 italic">No active memberships</span>
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4 align-middle text-right">
                                <div className="flex justify-end gap-2">
                                    <button 
                                        onClick={() => onEdit({ id: user.id })} 
                                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                        title="Edit User"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button 
                                        onClick={() => onDelete({ id: user.id, name: user.name })} 
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Delete User"
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