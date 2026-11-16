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

/**
 * The "← Leads" link above the title of Add lead and Import leads
 * (`PageHeader back`): a real link to the person's leads list, followed inside
 * the app. A click with a modifier key, or with another button, is left to the
 * browser, so the list still opens in a new tab or window when asked.
 *
 * @param {boolean} isCompanyAdmin `isCompanyAdminForRoute` for the company
 * @param {(path: string) => void} navigate the router's `navigate`
 * @returns {{ label: string, href: string, onClick: (event: MouseEvent) => void }}
 */
export const leadsBackLink = (isCompanyAdmin, navigate) => {
    const href = leadsListPath(isCompanyAdmin);
    return {
        label: 'Leads',
        href,
        onClick: (event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(href);
        },
    };
};
