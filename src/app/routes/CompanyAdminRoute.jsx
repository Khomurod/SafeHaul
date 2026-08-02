import { Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * UI-006: route-level guard for adminOnly company pages (e.g. Settings).
 *
 * Lower roles (recruiter / hr_user) that guess or bookmark an admin-only URL are
 * redirected to the company dashboard, mirroring the sidebar which already hides
 * these items. Uses the same isCompanyAdminForRoute() check the sidebar uses, so
 * menu visibility and direct-URL access can never drift apart.
 */
export function CompanyAdminRoute({ children }) {
  const { currentUserClaims, currentCompanyProfile } = useData();
  if (!isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id)) {
    return <Navigate to="/company/dashboard" replace />;
  }
  return children;
}

export default CompanyAdminRoute;
