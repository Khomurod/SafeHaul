/**
 * The leads lists, each at its own address: All, Assigned to me and Unassigned
 * (`LeadListTabs`). The first two are the old Company Leads and My Leads
 * addresses, so a bookmark or a dashboard tile opens its tab. The menu's one
 * Leads item opens All for a company admin and Assigned to me for anyone else
 * (`LeadsRedirect`).
 */
export const LEAD_LIST_TABS = Object.freeze([
    Object.freeze({ scope: 'company_leads', label: 'All', path: '/company/drivers/leads/company' }),
    Object.freeze({ scope: 'my_leads', label: 'Assigned to me', path: '/company/drivers/leads/my' }),
    Object.freeze({ scope: 'unassigned_leads', label: 'Unassigned', path: '/company/drivers/leads/unassigned' }),
]);
