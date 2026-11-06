/**
 * The leads list a staff member works from: a company admin, all the company's
 * leads; anyone else, the leads assigned to them. Add lead and Import leads
 * return to it.
 *
 * @param {boolean} isCompanyAdmin `isCompanyAdminForRoute` for the company
 * @returns {string}
 */
export const leadsListPath = (isCompanyAdmin) => (
    isCompanyAdmin ? '/company/drivers/leads/company' : '/company/drivers/leads/my'
);
