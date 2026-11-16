import { COMPANY_ROUTE_MANIFEST } from './companyRouteManifest';
import { isFeatureOn } from '@shared/utils/companyFeatures';

/**
 * Whether a company page may be offered to the signed-in person: a menu item in
 * the sidebar, or a button on another page that leads to it (the Leads page's
 * Add lead and Import leads).
 *
 * It reads what the page itself declares, so an entry point is never shown for
 * a page that would refuse the person:
 *
 *  - `adminOnly` needs a company admin of this company or a super admin
 *    (`isCompanyAdminForRoute`, the check `CompanyAdminRoute` makes);
 *  - `featureFlag` needs the company's feature on (`isFeatureOn`: a missing key
 *    is on unless the feature is off by default; `docs/feature-flags.md`).
 *
 * @param {object|undefined} route an entry of `COMPANY_ROUTE_MANIFEST`
 * @param {{ isCompanyAdmin: boolean, features?: Record<string, boolean> }} access
 * @returns {boolean}
 */
export function canOfferCompanyRoute(route, { isCompanyAdmin, features }) {
  if (!route) return false;
  if (route.adminOnly && !isCompanyAdmin) return false;
  if (route.featureFlag && !isFeatureOn({ features }, route.featureFlag)) return false;
  return true;
}

/** The manifest entry with this id. */
export const companyRoute = (id) => COMPANY_ROUTE_MANIFEST.find((route) => route.id === id);

/** The address of a company page, as the router serves it. */
export const companyRoutePath = (route) => `/company/${route.path}`;
