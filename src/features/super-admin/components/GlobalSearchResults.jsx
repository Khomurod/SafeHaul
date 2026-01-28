import React from 'react';
import { getFieldValue, getStatusColor } from '@shared/utils/helpers.js';
import { Building, Users, FileText, Edit2 } from 'lucide-react';

export function GlobalSearchResults({
  results,
  totalResults,
  allCompaniesMap,
  onViewApps,
  onEditCompany,
  onEditUser,
  onAppClick
}) {
  const { companies, users, applications } = results;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">
        Search Results <span className="text-gray-400 font-normal">({totalResults} found)</span>
      </h1>
      
      <section>
        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Building size={20} /> Companies ({companies.length})
        </h2>
        <div className="space-y-4">
          {companies.length > 0 ? (
            companies.map(company => (
              <div key={company.id} className="p-4 border border-gray-200 rounded-lg bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="mb-3 sm:mb-0">
                  <h3 className="font-semibold text-lg text-gray-900">{getFieldValue(company.companyName)}</h3>
                  <p className="text-sm text-gray-600">/{getFieldValue(company.appSlug)}</p>
                </div>
                <div className="flex gap-2 justify-end shrink-0">
                  <button onClick={() => onViewApps({ id: company.id, name: company.companyName })} className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-all flex items-center gap-2">
                    <FileText size={14} /> View Apps
                  </button>
                  <button onClick={() => onEditCompany(company.id)} className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-all flex items-center gap-2">
                    <Edit2 size={14} /> Edit
                  </button>
                </div>
              </div>
            ))
          ) : <p className="text-gray-500 p-4 bg-white rounded-lg border">No companies found.</p>}
        </div>
      </section>
      
      <section>
        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Users size={20} /> Users ({users.length})
        </h2>
        <div className="space-y-4">
          {users.length > 0 ? (
            users.map(user => (
              <div key={user.id} className="p-4 border border-gray-200 rounded-lg bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="mb-3 sm:mb-0">
                  <h3 className="font-semibold text-lg text-gray-900">{getFieldValue(user.name)}</h3>
                  <p className="text-sm text-gray-600">{getFieldValue(user.email)}</p>
                </div>
                <div className="flex gap-2 justify-end shrink-0">
                  <button onClick={() => onEditUser({ id: user.id })} className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-all flex items-center gap-2">
                    <Edit2 size={14} /> Edit
                  </button>
                </div>
              </div>
            ))
          ) : <p className="text-gray-500 p-4 bg-white rounded-lg border">No users found.</p>}
        </div>
      </section>
      
      <section>
        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <FileText size={20} /> Driver Applications ({applications.length})
        </h2>
        <div className="space-y-4">
          {applications.length > 0 ? (
            applications.map(app => (
              <button 
                key={app.id} 
                className="w-full p-4 border border-gray-200 rounded-lg bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between text-left hover:border-blue-500 hover:shadow-md transition-all"
                onClick={() => onAppClick(app)}
              >
                <div>
                  <h3 className="font-semibold text-lg text-gray-900">{`${getFieldValue(app['firstName'])} ${getFieldValue(app['lastName'])}`}</h3>
                  <p className="text-sm text-gray-600">{getFieldValue(app.email)}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    From: <span className="font-medium text-gray-700">{allCompaniesMap.get(app.companyId) || 'Unknown Company'}</span>
                  </p>
                </div>
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(app.status || 'New Application')}`}>
                  {app.status || 'New Application'}
                </span>
              </button>
            ))
          ) : <p className="text-gray-500 p-4 bg-white rounded-lg border">No driver applications found.</p>}
        </div>
      </section>
      
    </div>
  );
}