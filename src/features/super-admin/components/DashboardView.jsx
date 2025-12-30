import React from 'react';
import { Building, Users, FileText } from 'lucide-react';

function StatCard({ title, value, icon, loading, hasError }) {
  let displayValue = value;
  if (loading) displayValue = "...";
  if (hasError) displayValue = "Error";
  
  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 flex items-center gap-4">
      <div className={`p-3 rounded-full ${hasError ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className={`text-3xl font-bold ${hasError ? 'text-red-600' : 'text-gray-900'} ${loading ? 'animate-pulse' : ''}`}>
          {displayValue}
        </p>
      </div>
    </div>
  );
}

export function DashboardView({ stats, statsLoading, statsError }) {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Total Companies" 
          value={stats.companyCount} 
          icon={<Building size={24} />} 
          loading={statsLoading} 
          hasError={statsError.companies} 
        />
        <StatCard 
          title="Total Users" 
          value={stats.userCount} 
          icon={<Users size={24} />} 
          loading={statsLoading} 
          hasError={statsError.users} 
        />
        <StatCard 
          title="Total Applications" 
          value={stats.appCount} 
          icon={<FileText size={24} />} 
          loading={statsLoading} 
          hasError={statsError.apps} 
        />
      </div>
    </div>
  );
}