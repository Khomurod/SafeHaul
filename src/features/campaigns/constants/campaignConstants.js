/**
 * Campaign Constants (The "Dictionary")
 * 
 * This file serves as the single source of truth for all status strings, 
 * outcome types, and filter labels used in the Engagement Engine.
 * 
 * Both the UI dropdowns and the Firestore query logic MUST import from here
 * to prevent data "drift."
 */

export const APPLICATION_STATUSES = [
    { id: 'new', label: 'New Application', value: 'New Application' },
    { id: 'contacted', label: 'Contacted', value: 'Contacted' },
    { id: 'interview', label: 'Interview Scheduled', value: 'Interview Scheduled' },
    { id: 'offer', label: 'Offer Sent', value: 'Offer Sent' },
    { id: 'hired', label: 'Hired', value: 'Hired' },
    { id: 'rejected', label: 'Rejected', value: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn', value: 'Withdrawn' },
    { id: 'inactive', label: 'Inactive (30d+)', value: 'Inactive' }
];

export const LAST_CALL_RESULTS = [
    { id: 'no_answer', label: 'No Answer', value: 'No Answer' },
    { id: 'left_voicemail', label: 'Left Voicemail', value: 'Left Voicemail' },
    { id: 'busy', label: 'Busy', value: 'Busy' },
    { id: 'wrong_number', label: 'Wrong Number', value: 'Wrong Number' },
    { id: 'not_interested', label: 'Not Interested', value: 'Not Interested' }
];

export const CAMPAIGN_MODES = {
    DASHBOARD: 'dashboard',
    WIZARD: 'wizard',
    AUDIENCE: 'audience',
    AUTOMATIONS: 'automations'
};

export const WIZARD_STEPS = {
    TARGETING: 1,
    MESSAGE: 2,
    REVIEW: 3
};

/**
 * Transforms a UI filter selection into a database-ready query value.
 */
export const getDbValue = (id, dictionary) => {
    const item = dictionary.find(i => i.id === id);
    return item ? item.value : id;
};

/**
 * Friendly error messages for Bulletproof Logic
 */
export const ERROR_MESSAGES = {
    ZERO_RESULTS: "No drivers match these filters. Try removing the 'Date' or 'Recruiter' filter to see more results.",
    MISSING_AUTH: "Verifying your security credentials...",
    MISSING_COMPANY: "Selecting your company profile...",
    LOADING: "Scanning the network for active matches..."
};
