import React from 'react';
import { Building, Calendar, FileText } from 'lucide-react';

export function ApplicationStatusCard({ application }) {
  if (!application) return null;

  const getStatusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('offer')) return 'bg-green-100 text-green-800 border-green-200';
    if (s.includes('rejected')) return 'bg-red-100 text-red-800 border-red-200';
    if (s.includes('review')) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const dateStr = application.submittedAt?.seconds 
    ? new Date(application.submittedAt.seconds * 1000).toLocaleDateString() 
    : 'Recently';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
            <Building size={24} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-lg">{application.companyName}</h3>
            <p className="text-sm text-gray-500">ID: <span className="font-mono">{application.id.slice(0, 8)}</span></p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(application.status)}`}>
            {application.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} />
            <span>Applied: {dateStr}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
            <FileText size={16} />
            <span>Type: {application.type === 'global_lead' ? 'General Pool' : 'Direct App'}</span>
        </div>
      </div>

      {/* Simple Progress Bar */}
      <div className="w-full bg-gray-100 h-2 rounded-full mt-2">
          <div className={`h-2 rounded-full ${application.status.includes('Offer') ? 'bg-green-500 w-full' : 'bg-blue-500 w-1/2'}`}></div>
      </div>
      <p className="text-xs text-gray-400 mt-2 text-right">Status updated recently</p>
    </div>
  );
}