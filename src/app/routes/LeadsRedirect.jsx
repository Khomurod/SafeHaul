import { Navigate, useLocation } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * The menu's Leads item: the tab a person starts on. A company admin, who
 * hands leads out, opens All; anyone else opens Assigned to me. Both see all
 * three tabs, so this decides a starting point, not what anyone may see.
 *
 * The query string is carried over, as `StartApplicationRedirect` does:
 * `?e2eAuth=company_admin` is how the browser suite signs in. So is any `state`
 * a link sent, and the entry is replaced, so Back does not land here and bounce.
 */
export function LeadsRedirect() {
  const { currentUserClaims, currentCompanyProfile } = useData();
  const { search, state } = useLocation();
  const pathname = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id)
    ? '/company/drivers/leads/company'
    : '/company/drivers/leads/my';
  return <Navigate to={{ pathname, search }} state={state} replace />;
}

export default LeadsRedirect;
