import React, { useState, useMemo } from 'react';
import { db } from '@lib/firebase';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Search, Zap, Lock, Unlock, Layers, Loader2, CheckCircle } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';

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

export function FeaturesView({ companyList, onDataUpdate }) {
  const { showSuccess, showError, showInfo } = useToast();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const filteredList = useMemo(() => {
    if (!search) return companyList;
    const term = search.toLowerCase();
    return companyList.filter(c => c.companyName?.toLowerCase().includes(term));
  }, [companyList, search]);

  const toggleFeature = async (company, featureKey, currentValue) => {
    try {
        const docRef = doc(db, "companies", company.id);
        await updateDoc(docRef, {
            [`features.${featureKey}`]: !currentValue
        });
        showSuccess(`Updated ${company.companyName}`);
        onDataUpdate(); 
    } catch (e) {
        console.error("Update failed:", e);
        showError("Failed to toggle feature.");
    }
  };

  const handleBulkAction = async (featureKey, targetState) => {
      if (!window.confirm(`Are you sure you want to ${targetState ? 'ENABLE' : 'DISABLE'} ${featureKey} for ALL ${companyList.length} companies?`)) return;
      
      setBulkLoading(true);
      showInfo("Processing bulk update...");

      try {
          const BATCH_SIZE = 400;
          const chunks = [];
          for (let i = 0; i < companyList.length; i += BATCH_SIZE) {
              chunks.push(companyList.slice(i, i + BATCH_SIZE));
          }

          for (const chunk of chunks) {
              const batch = writeBatch(db);
              chunk.forEach(company => {
                  const ref = doc(db, "companies", company.id);
                  batch.update(ref, { [`features.${featureKey}`]: targetState });
              });
              await batch.commit();
          }

          showSuccess(`Successfully ${targetState ? 'Enabled' : 'Disabled'} feature for all companies.`);
          onDataUpdate();
      } catch (e) {
          console.error("Bulk update failed:", e);
          showError("Bulk update failed.");
      } finally {
          setBulkLoading(false);
      }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
        
        <Card title="Global Feature Controls" icon={<Layers size={20} className="text-blue-600"/>} className="shrink-0">
            <div className="p-6 bg-gradient-to-r from-gray-50 to-white">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg">Search For Drivers Access</h3>
                        <p className="text-sm text-gray-500">
                            Control access to the "Search For Drivers" global database. 
                            If disabled, users will see the "Under Development" screen with a redirect to SafeHaul Leads.
                        </p>
                    </div>
                    
                    <div className="flex gap-3">
                        <button 
                            onClick={() => handleBulkAction('searchDB', false)}
                            disabled={bulkLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 font-bold rounded-lg hover:bg-red-50 hover:border-red-300 transition shadow-sm disabled:opacity-50"
                        >
                            {bulkLoading ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                            Disable for All
                        </button>
                        <button 
                            onClick={() => handleBulkAction('searchDB', true)}
                            disabled={bulkLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-md disabled:opacity-50"
                        >
                            {bulkLoading ? <Loader2 className="animate-spin" size={18} /> : <Unlock size={18} />}
                            Enable for All
                        </button>
                    </div>
                </div>
            </div>
        </Card>

        <Card title="Company Feature Overrides" icon={<Zap size={20} className="text-purple-600"/>} className="flex-1 min-h-0">
            <div className="p-4 border-b border-gray-200 bg-white">
                <div className="relative max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                        type="text" 
                        placeholder="Search companies..." 
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-gray-50">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Company Name</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-center">Search For Drivers</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {filteredList.map(company => {
                            const isSearchEnabled = company.features?.searchDB === true;

                            return (
                                <tr key={company.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">
                                        {company.companyName}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button 
                                            onClick={() => toggleFeature(company, 'searchDB', isSearchEnabled)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                                isSearchEnabled ? 'bg-green-500' : 'bg-gray-200'
                                            }`}
                                        >
                                            <span
                                                className={`${
                                                    isSearchEnabled ? 'translate-x-6' : 'translate-x-1'
                                                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                                            />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {isSearchEnabled ? (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                                                <CheckCircle size={12} /> Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-500 border border-gray-200">
                                                <Lock size={12} /> Locked
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    </div>
  );
}