/**
 * The features the owner switches for a company, in the order every screen
 * lists them. A feature is on unless the company's `features` sets it to
 * `false`; a scheduled switch-off is an ISO time in `featureSchedules`.
 */
export const COMPANY_FEATURES = Object.freeze([
    { key: 'pev', label: 'PEV' },
    { key: 'campaignsEnabled', label: 'Campaigns' },
    { key: 'eDocs', label: 'E-Docs' },
    { key: 'importLeads', label: 'Import Leads' },
    { key: 'callTracking', label: 'Call Tracking' },
]);

export const isFeatureOn = (company, key) => company?.features?.[key] !== false;
