import { LEAD_LIST_TABS } from './leadLists';

const pathOf = (scope) => LEAD_LIST_TABS.find((tab) => tab.scope === scope).path;

/**
 * The leads list a staff member works from: a company admin, All (every lead
 * of the company); anyone else, Assigned to me. The menu's Leads item opens it
 * (`LeadsRedirect`), and Add lead and Import leads return to it.
 *
 * @param {boolean} isCompanyAdmin `isCompanyAdminForRoute` for the company
 * @returns {string}
 */
export const leadsListPath = (isCompanyAdmin) => pathOf(isCompanyAdmin ? 'company_leads' : 'my_leads');
