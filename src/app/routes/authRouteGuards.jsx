import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { isCompanyWorkspaceRole } from '@app/auth/roles';

// Keep Auth screens eager-loaded as they are the entry point
import { LoginScreen, NoAccessScreen, returnPathFrom } from '@features/auth';

// --- ROUTE GUARDS ---
export function RootRedirect() {
  const { currentUser, userRole } = useData();
  if (!currentUser) return <Navigate to="/login" />;

  if (userRole === 'super_admin') return <Navigate to="/super-admin" />;
  if (isCompanyWorkspaceRole(userRole)) return <Navigate to="/company/dashboard" />;

  // Signed in, but no workspace to send the account to. Sending it to sign in
  // again would only bring it back here.
  return <NoAccessScreen />;
}

// P3-12 FIX: Redirect authenticated users away from login page, to the page
// that sent them here if there was one.
export function AuthGuardedLogin() {
  const { currentUser } = useData();
  const location = useLocation();
  if (currentUser) return <Navigate to={returnPathFrom(location.state) || '/'} replace />;
  return <LoginScreen />;
}

export function ProtectedRoute({ children, allowedRoles }) {
  const { currentUser, userRole } = useData();
  const location = useLocation();
  if (!currentUser) {
    // Signing in returns to this page. Replacing it keeps Back from landing on
    // a page that only sends the visitor to sign in again.
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  if (allowedRoles && !allowedRoles.includes(userRole)) return <Navigate to="/" />;
  return children;
}
