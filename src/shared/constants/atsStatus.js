/** Canonical ATS funnel statuses (recruiter-editable). */
export const ATS_PIPELINE_STATUSES = [
    'New',
    'Contact Attempt 1',
    'Contact Attempt 2',
    'Contact Attempt 3',
    'In Process',
    'Hired',
    'Terminated',
    'Declined',
];

/** Optional CRM bucket for lead tabs (stored as status). */
export const ATS_INTERESTED_STATUS = 'Interested';

/** Legacy / workflow values kept selectable so older records stay editable. */
export const ATS_LEGACY_STATUS_ALIASES = [
    'New Application',
    'Approved',
    'Rejected',
    'Background Check',
    'In Review',
    'Qualified',
    'Hold',
    'Stale',
    'Offer Accepted',
    'Offer Declined',
];

/** Full dropdown list (deduped). */
export const ATS_STATUS_DROPDOWN_OPTIONS = [
    ...ATS_PIPELINE_STATUSES,
    ATS_INTERESTED_STATUS,
    ...ATS_LEGACY_STATUS_ALIASES,
];

export const CONTACT_ATTEMPT_STATUSES = [
    'Contact Attempt 1',
    'Contact Attempt 2',
    'Contact Attempt 3',
];

// ---------------------------------------------------------------------------
// Creation defaults (stored values — renaming these breaks existing documents)
// ---------------------------------------------------------------------------

/** First recruiter pipeline status (Quick Add lead page default). */
export const ATS_STATUS_NEW = 'New';

/** Status written when a lead is created (bulk import, quick-lead modal; the
 *  Facebook ingestion Cloud Function writes the same literal server-side). */
export const LEAD_DEFAULT_STATUS = 'New Lead';

/** Status written when a driver application is created/submitted. */
export const APPLICATION_DEFAULT_STATUS = 'New Application';

/** Driver offer response statuses. Must stay in sync with the driver
 *  self-update whitelist in src/firestore.rules (rules cannot import JS). */
export const OFFER_ACCEPTED_STATUS = 'Offer Accepted';
export const OFFER_DECLINED_STATUS = 'Offer Declined';
