import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { useDriverDashboard } from '../hooks/useDriverDashboard';
import { DriverOfferModal } from './dashboard/DriverOfferModal';
import { LogOut, User, FileText, ChevronRight, Loader2, Briefcase, MapPin, Clock, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';

export function DriverDashboard() {
  const { handleLogout } = useData(); // Use global logout
  const navigate = useNavigate();

  // Use the new hook
  const { 
      currentUser, 
      profile, 
      applications, 
      loading, 
      refreshData 
  } = useDriverDashboard();

  // Find active offer (Status is 'Offer Sent' and no response yet)
  const offerApp = applications.find(app => 
      app.status === 'Offer Sent' && 
      (!app.offerDetails?.response || app.offerDetails.response === 'Pending')
  );

  // Helper for status badges
  const getStatusColor = (status) => {
      const s = (status || '').toLowerCase();
      if (s.includes('offer') || s.includes('hired') || s.includes('approved')) return 'bg-green-100 text-green-800 border-green-200';
      if (s.includes('rejected') || s.includes('declined')) return 'bg-red-100 text-red-800 border-red-200';
      if (s.includes('new') || s.includes('submitted')) return 'bg-blue-100 text-blue-800 border-blue-200';
      return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  if (loading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500">
              <Loader2 className="animate-spin mb-2" size={32} />
              <p>Loading Dashboard...</p>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-10">

      {/* Confetti Offer Modal */}
      {offerApp && (
          <DriverOfferModal 
              application={offerApp} 
              onClose={() => refreshData()} 
              onUpdate={refreshData} 
          />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 px-6 py-4 shadow-sm">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-blue-200 shadow-md">
                    <User size={20} />
                </div>
                <div>
                    <h1 className="font-bold text-gray-900 leading-tight">Driver Portal</h1>
                    <p className="text-xs text-gray-500">Welcome back, {profile?.personalInfo?.firstName || currentUser?.email}</p>
                </div>
            </div>
            <button 
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                title="Sign Out"
            >
                <LogOut size={20} />
            </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">

        {/* 1. Profile Status Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center text-green-600 border border-green-100">
                    <CheckCircle size={28} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Master Profile</h2>
                    <p className="text-sm text-gray-500">
                        {profile ? "Your profile is active and ready for applications." : "Complete your profile to apply faster."}
                    </p>
                </div>
            </div>
            <Link 
                to="/driver/profile" 
                className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm flex items-center gap-2"
            >
                Edit Profile <ChevronRight size={16} />
            </Link>
        </div>

        {/* 2. Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <p className="text-xs font-bold text-gray-400 uppercase">Applications</p>
                <p className="text-2xl font-bold text-blue-600">{applications.length}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <p className="text-xs font-bold text-gray-400 uppercase">Active Offers</p>
                <p className="text-2xl font-bold text-green-600">{applications.filter(a => a.status === 'Offer Sent').length}</p>
            </div>
        </div>

        {/* 3. My Applications List */}
        <div>
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <FileText size={20} className="text-blue-600" /> My Applications
            </h3>

            {applications.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Briefcase size={32} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">No applications yet</h4>
                    <p className="text-gray-500 mb-6">Start applying to jobs to see your status here.</p>
                    <Link 
                        to="/driver/apply" 
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-md"
                    >
                        Start New Application
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    {applications.map(app => (
                        <div key={app.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <h4 className="text-lg font-bold text-gray-900">{app.companyName || "General Application"}</h4>
                                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${getStatusColor(app.status)}`}>
                                        {app.status}
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                    <span className="flex items-center gap-1"><Clock size={14}/> {app.submittedAt ? new Date(app.submittedAt.seconds * 1000).toLocaleDateString() : 'Draft'}</span>
                                    <span className="flex items-center gap-1"><MapPin size={14}/> {app.city || 'Remote'}, {app.state || 'US'}</span>
                                </div>
                            </div>

                            <div className="flex items-center">
                                {app.status === 'Offer Sent' ? (
                                    <button 
                                        onClick={() => refreshData()} 
                                        className="px-5 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm animate-pulse"
                                    >
                                        View Offer
                                    </button>
                                ) : (
                                    <div className="text-sm text-gray-400 font-medium flex items-center gap-1">
                                        {app.status === 'New Application' ? 'In Review' : 'View Details'} <ChevronRight size={16} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

      </main>
    </div>
  );
}