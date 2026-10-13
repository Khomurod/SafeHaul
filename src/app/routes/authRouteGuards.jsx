import React from 'react';
import { Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { GlobalLoadingState } from '@shared/components/feedback';
import { isCompanyWorkspaceRole } from '@app/auth/roles';

// Keep Auth screens eager-loaded as they are the entry point
import { LoginScreen } from '@features/auth';

// --- ROUTE GUARDS ---
export function RootRedirect() {
  const { currentUser, userRole, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (!currentUser) return <Navigate to="/login" />;

  if (userRole === 'super_admin') return <Navigate to="/super-admin" />;
  if (isCompanyWorkspaceRole(userRole)) return <Navigate to="/company/dashboard" />;

  if (!userRole) return null;

  return <Navigate to="/login" />;
}

// P3-12 FIX: Redirect authenticated users away from login page
export function AuthGuardedLogin() {
  const { currentUser, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (currentUser) return <Navigate to="/" replace />;
  return <LoginScreen />;
}

export function ProtectedRoute({ children, allowedRoles }) {
  const { currentUser, userRole, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (!currentUser) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(userRole)) return <Navigate to="/" />;
  return children;
}
