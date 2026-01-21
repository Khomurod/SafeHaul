// src/App.jsx
import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { DataProvider, useData } from '@/context/DataContext';
import { ToastProvider, ErrorBoundary, GlobalLoadingState } from '@shared/components/feedback';
import { QueueStatusIndicator } from '@shared/components/feedback/QueueStatusIndicator';

// Keep Auth screens eager-loaded as they are the entry point
import { LoginScreen, TeamMemberSignup } from '@features/auth';

// --- LAZY LOADED FEATURES (Performance Optimization) ---
const SuperAdminDashboard = React.lazy(() => import('@features/super-admin/components/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const CompanyAdminDashboard = React.lazy(() => import('@features/company-admin/components/CompanyAdminDashboard').then(m => ({ default: m.CompanyAdminDashboard })));
const CompanySettings = React.lazy(() => import('@features/settings/components/CompanySettings').then(m => ({ default: m.CompanySettings })));
const DriverDashboard = React.lazy(() => import('@features/driver-app/components/DriverDashboard').then(m => ({ default: m.DriverDashboard })));
const DriverApplicationWizard = React.lazy(() => import('@features/driver-app/components/application/DriverApplicationWizard').then(m => ({ default: m.DriverApplicationWizard })));
const PublicApplyHandler = React.lazy(() => import('@features/driver-app/components/application/PublicApplyHandler').then(m => ({ default: m.PublicApplyHandler })));

// --- NEW: INTEREST PAGE (DriverReach/Tenstreet Feature) ---
const InterestPage = React.lazy(() => import('@features/driver-app/components/InterestPage').then(m => ({ default: m.InterestPage })));

// --- DIGITAL SIGNATURE FEATURES ---
const SigningRoom = React.lazy(() => import('@features/signing/SigningRoom'));

// NEW: The Documents Dashboard (Replaces CreateEnvelopePage)
const DocumentsManager = React.lazy(() => import('@features/company-admin/views/DocumentsManager'));

// --- ROUTE GUARDS ---
function RootRedirect() {
  const { currentUser, userRole, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (!currentUser) return <Navigate to="/login" />;

  if (userRole === 'super_admin') return <Navigate to="/super-admin" />;
  if (userRole === 'company_admin') return <Navigate to="/company/dashboard" />;
  if (userRole === 'driver') return <Navigate to="/driver/dashboard" />;

  return <GlobalLoadingState />;
}

function ProtectedRoute({ children, allowedRoles }) {
  const { currentUser, userRole, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (!currentUser) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(userRole)) return <Navigate to="/" />;
  return children;
}

// --- MAIN ROUTER ---
function AppRoutes() {
  const { currentCompanyProfile } = useData();

  return (
    <Suspense fallback={<GlobalLoadingState />}>
      <Routes>
        {/* --- PUBLIC ROUTES (No Login Required) --- */}
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/join/:companyId" element={<TeamMemberSignup />} />

        {/* Public Driver Routes */}
        <Route path="/apply/:slug" element={<PublicApplyHandler />} />

        {/* FIX: New route for personalized recruiter invites */}
        <Route path="/interest/:slug" element={<InterestPage />} />

        {/* Signing Room (Publicly Accessible via Token) */}
        <Route path="/sign/:companyId/:requestId" element={<SigningRoom />} />

        {/* --- PROTECTED ROUTES (Login Required) --- */}

        {/* Super Admin */}
        <Route path="/super-admin/*" element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <SuperAdminDashboard />
          </ProtectedRoute>
        } />

        {/* Company Admin / HR */}
        <Route path="/company/dashboard" element={
          <ProtectedRoute allowedRoles={['company_admin', 'super_admin']}>
            {currentCompanyProfile ? <CompanyAdminDashboard /> : <div className="min-h-screen flex items-center justify-center">Please select a company.</div>}
          </ProtectedRoute>
        } />

        {/* Documents Center Hub */}
        <Route path="/company/documents" element={
          <ProtectedRoute allowedRoles={['company_admin', 'super_admin']}>
            <DocumentsManager />
          </ProtectedRoute>
        } />

        <Route path="/company/settings" element={
          <ProtectedRoute allowedRoles={['company_admin', 'super_admin']}>
            {currentCompanyProfile ? <CompanySettings /> : <Navigate to="/company/dashboard" />}
          </ProtectedRoute>
        } />

        {/* Driver App */}
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

        {/* Fallbacks */}
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
            {/* Bulletproof: Show queue/offline status indicator */}
            <QueueStatusIndicator />
          </Router>
        </DataProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}