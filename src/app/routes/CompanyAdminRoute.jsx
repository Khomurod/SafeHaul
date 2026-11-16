import { Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * UI-006: route-level guard for company pages whose manifest entry is
 * `adminOnly` (Settings, Import Leads), with or without a menu item.
 *
 * Lower roles (recruiter / hr_user) that guess or bookmark an admin-only URL are
 * redirected to the company dashboard. The sidebar and the pages that link to an
 * admin-only page read the same `adminOnly` and the same isCompanyAdminForRoute()
 * check (`canOfferCompanyRoute`), so what is offered and what opens by URL can
 * never drift apart.
 */
export function CompanyAdminRoute({ children }) {
  const { currentUserClaims, currentCompanyProfile } = useData();
  if (!isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id)) {
    return <Navigate to="/company/dashboard" replace />;
  }
  return children;
}

export default CompanyAdminRoute;
