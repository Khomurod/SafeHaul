/**
 * The features the owner switches for a company, in the order every screen
 * lists them. A feature is on unless the company's `features` sets it to
 * `false`; one marked `defaultOn: false` is off until a super admin switches
 * it on (`true`). A scheduled switch-off is an ISO time in `featureSchedules`.
 *
 * `callTracking` is Facebook leads: the Settings → Connections section. The
 * stored key keeps its old name; Facebook lead capture is switched off, so the
 * section shows only where it was explicitly switched on.
 *
 * `gmailSending` is Send from Gmail: Settings → Email offers Connect Gmail only
 * where it is switched on, and the server refuses to start a connection while
 * it is off. A Gmail already connected keeps sending until an admin disconnects
 * it, so the Email tab also shows the card while one is connected.
 */
export const COMPANY_FEATURES = Object.freeze([
    { key: 'pev', label: 'PEV' },
    { key: 'campaignsEnabled', label: 'Campaigns' },
    { key: 'eDocs', label: 'E-Docs' },
    { key: 'importLeads', label: 'Import Leads' },
    { key: 'callTracking', label: 'Facebook leads', defaultOn: false },
    { key: 'gmailSending', label: 'Send from Gmail', defaultOn: false },
]);

const OFF_UNLESS_SET = new Set(
    COMPANY_FEATURES.filter((feature) => feature.defaultOn === false).map((feature) => feature.key),
);

/** Whether `company` has feature `key` on, by that feature's default when it never set it. */
export const isFeatureOn = (company, key) => {
    const value = company?.features?.[key];
    return OFF_UNLESS_SET.has(key) ? value === true : value !== false;
};
