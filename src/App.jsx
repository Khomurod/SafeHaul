// src/App.jsx
import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { DataProvider, useData } from '@/context/DataContext';
import {
  ToastProvider,
  ErrorBoundary,
  FeatureErrorBoundary,
  GlobalLoadingState,
} from '@shared/components/feedback';
import { QueueStatusIndicator } from '@shared/components/feedback/QueueStatusIndicator';
import { featureScreens, companyChildRouteDefs } from '@app/routes/featureRegistry';
import { isCompanyWorkspaceRole } from '@app/auth/roles';
import { CompanyAdminRoute } from '@app/routes/CompanyAdminRoute';
import {
  COMPANY_WORKSPACE_ROUTE,
  PROTECTED_FEATURE_ROUTE_MANIFEST,
  PUBLIC_FEATURE_ROUTE_MANIFEST,
} from '@app/routes/appRouteManifest';

import { isE2ETestMode } from '@lib/runtime/e2eMode';

// Keep Auth screens eager-loaded as they are the entry point
import { LoginScreen } from '@features/auth';

/**
 * E2E-only mount point for `VOEPreviewModal`, whose Print pipeline can only be
 * proven in a real browser and which is unreachable through the driver dossier
 * under `VITE_E2E_TEST_MODE=1`. See `src/app/e2e/VOEPreviewHarness.jsx`.
 *
 * Lazy, and only routed in test mode: a production build has no route to it.
 */
const VOEPreviewHarness = isE2ETestMode
  ? lazy(() => import('@app/e2e/VOEPreviewHarness'))
  : null;

function withFeatureBoundary(featureName, element) {
  return (
    <FeatureErrorBoundary featureName={featureName}>
      {element}
    </FeatureErrorBoundary>
  );
}

// --- ROUTE GUARDS ---
function RootRedirect() {
  const { currentUser, userRole, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (!currentUser) return <Navigate to="/login" />;

  if (userRole === 'super_admin') return <Navigate to="/super-admin" />;
  if (isCompanyWorkspaceRole(userRole)) return <Navigate to="/company/dashboard" />;

  if (!userRole) return null;

  return <Navigate to="/login" />;
}

// P3-12 FIX: Redirect authenticated users away from login page
function AuthGuardedLogin() {
  const { currentUser, loading } = useData();
  if (loading) return <GlobalLoadingState />;
  if (currentUser) return <Navigate to="/" replace />;
  return <LoginScreen />;
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
  const CompanyWorkspaceLayout = featureScreens[COMPANY_WORKSPACE_ROUTE.screen];

  return (
    <Suspense fallback={<GlobalLoadingState />}>
      <Routes>
        {/* --- PUBLIC ROUTES (No Login Required) --- */}
        {/* P3-12 FIX: Redirect authenticated users away from login */}
        <Route path="/login" element={<AuthGuardedLogin />} />
        {/* /join/:companyId route REMOVED — the underlying joinCompanyTeam
            Cloud Function was disabled, so this link only produced permission
            errors. Use the Super Admin "Create Portal User" flow instead. */}

        {/* Public feature routes */}
        {PUBLIC_FEATURE_ROUTE_MANIFEST.map((routeDef) => {
          const Screen = featureScreens[routeDef.screen];
          if (!Screen) return null;

          return (
            <Route
              key={routeDef.id}
              path={routeDef.path}
              element={withFeatureBoundary(routeDef.featureName, <Screen />)}
            />
          );
        })}

        {/* E2E-only harness route. Absent from production builds entirely. */}
        {VOEPreviewHarness && (
          <Route path="/e2e/voe-preview" element={<VOEPreviewHarness />} />
        )}

        {/* --- PROTECTED ROUTES (Login Required) --- */}
        {PROTECTED_FEATURE_ROUTE_MANIFEST.map((routeDef) => {
          const Screen = featureScreens[routeDef.screen];
          if (!Screen) return null;

          return (
            <Route
              key={routeDef.id}
              path={routeDef.path}
              element={(
                <ProtectedRoute allowedRoles={routeDef.allowedRoles}>
                  {withFeatureBoundary(routeDef.featureName, <Screen />)}
                </ProtectedRoute>
              )}
            />
          );
        })}

        {/* Company workspace */}
        {CompanyWorkspaceLayout && (
          <Route
            path={COMPANY_WORKSPACE_ROUTE.path}
            element={(
              <ProtectedRoute allowedRoles={COMPANY_WORKSPACE_ROUTE.allowedRoles}>
                {withFeatureBoundary(
                  COMPANY_WORKSPACE_ROUTE.featureName,
                  <CompanyWorkspaceLayout />,
                )}
              </ProtectedRoute>
            )}
          >
          <Route index element={<Navigate to={COMPANY_WORKSPACE_ROUTE.indexRedirect} replace />} />
          {companyChildRouteDefs.map((routeDef) => {
            const Screen = featureScreens[routeDef.screen];
            if (!Screen) return null;

            if (routeDef.id === 'settings' && !currentCompanyProfile) {
              return (
                <Route
                  key={routeDef.path}
                  path={routeDef.path}
                  element={<Navigate to="/company/dashboard" />}
                />
              );
            }

            const screenContent = routeDef.requiresCompanyProfile && !currentCompanyProfile
              ? (
                <div className="min-h-screen flex items-center justify-center text-gray-700">
                  Please select a company.
                </div>
                )
              : <Screen {...(routeDef.props || {})} />;

            // UI-006: admin-only pages get a route guard that mirrors the sidebar.
            const content = routeDef.adminOnly
              ? <CompanyAdminRoute>{screenContent}</CompanyAdminRoute>
              : screenContent;

            return (
              <Route
                key={routeDef.path}
                path={routeDef.path}
                element={withFeatureBoundary(routeDef.featureName, content)}
              />
            );
          })}
          {/* Unknown company sub-paths (including removed routes like /company/search)
              redirect to the dashboard rather than rendering an empty workspace. */}
          <Route path="*" element={<Navigate to="/company/dashboard" replace />} />
          </Route>
        )}

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
