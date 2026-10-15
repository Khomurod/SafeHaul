import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Compatibility redirect for the old "Start an application" URL.
 *
 * `Started (unfinished)` and `Start an application` are one workspace — see
 * `UnfinishedApplicationsPage` for why that changes no permission. Starting an
 * application is the primary action *inside* that workspace, so this path has
 * no screen of its own.
 *
 * It is not deleted, because a recruiter may have bookmarked it and internal links
 * may still point at it: a route that 404s is a worse outcome than a route that
 * takes you where the feature went.
 *
 * The query string is carried over deliberately. `?e2eAuth=company_admin` is how
 * the browser suite authenticates, and a redirect that dropped it would send an
 * e2e run to a signed-out page — which is exactly the kind of "the redirect works,
 * the test doesn't" failure that costs an afternoon. `LegacyInterestRedirect`
 * preserves its parameters for the same reason.
 */
export function StartApplicationRedirect() {
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  const to = qs ? `/company/drivers/unfinished?${qs}` : '/company/drivers/unfinished';
  return <Navigate to={to} replace />;
}

export default StartApplicationRedirect;
