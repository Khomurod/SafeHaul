import React, { useState, useEffect, useMemo } from 'react';
import { loadApplications } from '@features/applications/services/applicationService';
import { getFieldValue, getStatusColor } from '@shared/utils/helpers';
import { X, Search, FileText, Calendar, User, Loader2, AlertCircle } from 'lucide-react';

export function ViewCompanyAppsModal({ companyId, companyName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchApplications() {
      if (!companyId) return;
      setLoading(true);
      setError('');
      try {
        const querySnapshot = await loadApplications(companyId);

        if (!querySnapshot || querySnapshot.length === 0) {
          setApplications([]);
        } else {
          setApplications(querySnapshot);
        }
      } catch (err) {
        console.error("Error loading applications:", err);
        setError("Could not load applications. Please check your internet connection or permissions.");
      } finally {
        setLoading(false);
      }
    }
    fetchApplications();
  }, [companyId]);

  // --- SMART NAME RESOLVER ---
  // Checks all possible locations where data might be saved
  const getDriverName = (app) => {
    const fname = 
        app.firstName || 
        app['first-name'] || 
        app.personalInfo?.firstName || 
        app.personalInfo?.['first-name'] || 
        '';

    const lname = 
        app.lastName || 
        app['last-name'] || 
        app.personalInfo?.lastName || 
        app.personalInfo?.['last-name'] || 
        '';

    if (!fname && !lname) return 'Unknown Driver';
    return `${fname} ${lname}`.trim();
  };

  const getDriverEmail = (app) => {
      return app.email || app.personalInfo?.email || 'No Email';
  };

  const getDriverPhone = (app) => {
      return app.phone || app.personalInfo?.phone || 'No Phone';
  };

  // Filter logic
  const filteredApplications = useMemo(() => {
    const searchTerm = search.toLowerCase();
    if (!searchTerm) return applications;

    return applications.filter(app => {
      const name = getDriverName(app).toLowerCase();
      const email = getDriverEmail(app).toLowerCase();
      const status = (app.status || '').toLowerCase();
      return name.includes(searchTerm) || email.includes(searchTerm) || status.includes(searchTerm);
    });
  }, [search, applications]);

  return (
    <div 
      id="view-apps-modal" 
      className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <FileText className="text-blue-600" /> Driver Applications
            </h2>
            <p className="text-sm text-gray-500">Viewing records for <span className="font-semibold text-gray-900">{companyName}</span></p>
          </div>
          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors" onClick={onClose}>
            <X size={24} />
          </button>
        </header>

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 bg-white shrink-0">
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by driver name, email, or status..."
              className="w-full p-2.5 pl-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-0 bg-gray-50">
          {loading && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <Loader2 className="animate-spin mb-2" size={32} />
                  <p>Loading records...</p>
              </div>
          )}

          {error && (
              <div className="flex flex-col items-center justify-center h-64 text-red-600 px-6 text-center">
                  <AlertCircle size={32} className="mb-2" />
                  <p>{error}</p>
              </div>
          )}

          {!loading && !error && filteredApplications.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <User size={48} className="mb-2 opacity-20" />
                <p>{search ? "No matches found." : "No applications submitted yet."}</p>
            </div>
          )}

          {!loading && !error && filteredApplications.length > 0 && (
              <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100 text-xs font-bold text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                      <tr>
                          <th className="px-6 py-3 border-b border-gray-200">Driver Name</th>
                          <th className="px-6 py-3 border-b border-gray-200">Contact</th>
                          <th className="px-6 py-3 border-b border-gray-200 text-center">Status</th>
                          <th className="px-6 py-3 border-b border-gray-200 text-right">Date</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                      {filteredApplications.map(app => (
                        <tr key={app.id} className="hover:bg-blue-50 transition-colors">
                            <td className="px-6 py-4">
                                <span className="font-bold text-gray-900 block">
                                    {getDriverName(app)}
                                </span>
                                <span className="text-xs text-gray-400 font-mono">{app.id}</span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                                <div>{getDriverEmail(app)}</div>
                                <div className="text-xs text-gray-400">{getDriverPhone(app)}</div>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(app.status || 'New Application').replace('bg-', 'bg-opacity-10 bg-').replace('text-', 'border-')}`}>
                                    {app.status || 'New Application'}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-right text-sm text-gray-500">
                                <div className="flex items-center justify-end gap-1">
                                    <Calendar size={12} />
                                    {app.submittedAt?.seconds 
                                        ? new Date(app.submittedAt.seconds * 1000).toLocaleDateString() 
                                        : (app.createdAt?.seconds 
                                            ? new Date(app.createdAt.seconds * 1000).toLocaleDateString() 
                                            : '--')}
                                </div>
                            </td>
                        </tr>
                    ))}
                  </tbody>
              </table>
          )}
        </div>

        {/* Footer */}
        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end items-center rounded-b-xl shrink-0">
          <button 
            className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition-all shadow-sm" 
            onClick={onClose}
          >
            Close View
          </button>
        </footer>
      </div>
    </div>
  );
}