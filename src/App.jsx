import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { DataProvider, useData } from '@/context/DataContext';
import { ToastProvider, ErrorBoundary, GlobalLoadingState } from '@shared/components/feedback';

// Keep Auth screens eager-loaded as they are the entry point
import { LoginScreen, TeamMemberSignup } from '@features/auth';

// --- LAZY LOADED FEATURES (Performance Optimization) ---
const SuperAdminDashboard = React.lazy(() => import('@features/super-admin/components/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const CompanyAdminDashboard = React.lazy(() => import('@features/company-admin/components/CompanyAdminDashboard').then(m => ({ default: m.CompanyAdminDashboard })));
const CompanySettings = React.lazy(() => import('@features/settings/components/CompanySettings').then(m => ({ default: m.CompanySettings })));
const DriverDashboard = React.lazy(() => import('@features/driver-app/components/DriverDashboard').then(m => ({ default: m.DriverDashboard })));
const DriverApplicationWizard = React.lazy(() => import('@features/driver-app/components/application/DriverApplicationWizard').then(m => ({ default: m.DriverApplicationWizard })));

// Handles public application links
const PublicApplyHandler = React.lazy(() => import('@features/driver-app/components/application/PublicApplyHandler').then(m => ({ default: m.PublicApplyHandler })));

// --- ROUTE GUARDS ---

function RootRedirect() {
  const { currentUser, userRole, loading } = useData();

  if (loading) {
    return <GlobalLoadingState />;
  }

  if (!currentUser) return <Navigate to="/login" />;

  if (!userRole) {
    return <GlobalLoadingState />;
  }

  switch (userRole) {
    case 'super_admin': return <Navigate to="/super-admin" />;
    case 'admin': return <Navigate to="/company/dashboard" />;
    case 'driver': return <Navigate to="/driver/dashboard" />;
    default: return <GlobalLoadingState />;
  }
}

function ProtectedRoute({ children, allowedRoles }) {
  const { currentUser, userRole, loading } = useData();

  if (loading) {
    return <GlobalLoadingState />;
  }

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  if (allowedRoles && !allowedRoles.includes(userRole)) {
      return <Navigate to="/" />;
  }

  return children;
}

// --- MAIN ROUTER ---

function AppRoutes() {
  const { currentCompanyProfile } = useData();

  return (
      <Suspense fallback={<GlobalLoadingState />}>
        <Routes>
            {/* --- PUBLIC ROUTES --- */}
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/join/:companyId" element={<TeamMemberSignup />} />

            {/* Handles 'myapp.com/apply/company-name' links */}
            <Route path="/apply/:slug" element={<PublicApplyHandler />} />

            {/* --- SUPER ADMIN --- */}
            <Route path="/super-admin/*" element={
                <ProtectedRoute allowedRoles={['super_admin']}>
                    <SuperAdminDashboard />
                </ProtectedRoute>
            } />

            {/* --- COMPANY ADMIN (HR) --- */}
            <Route path="/company/dashboard" element={
                <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
                    {currentCompanyProfile ? (
                        <CompanyAdminDashboard />
                    ) : (
                        <div className="min-h-screen flex items-center justify-center text-gray-500">
                            Please select a company.
                        </div>
                    )}
                </ProtectedRoute>
            } />

            <Route path="/company/settings" element={
                <ProtectedRoute allowedRoles={['admin', 'super_admin']}>
                    {currentCompanyProfile ? <CompanySettings /> : <Navigate to="/company/dashboard" />}
                </ProtectedRoute>
            } />

            {/* --- DRIVER APP --- */}
            <Route path="/driver/dashboard" element={
                <ProtectedRoute allowedRoles={['driver']}>
                    <DriverDashboard />
                </ProtectedRoute>
            } />

            <Route path="/driver/apply" element={
                <ProtectedRoute allowedRoles={['driver']}>
                    <DriverApplicationWizard />
                </ProtectedRoute>
            } />

            <Route path="/driver/apply/:companyId" element={
                <ProtectedRoute allowedRoles={['driver']}>
                    <DriverApplicationWizard />
                </ProtectedRoute>
            } />

            {/* --- FALLBACKS --- */}
            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <DataProvider> 
          <Router>
            <AppRoutes />
          </Router>
        </DataProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}