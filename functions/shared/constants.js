// Shared Constants for SafeHaul Cloud Functions

const APPLICATION_STATUSES = [
    { id: 'new', label: 'New Application', value: 'New Application' },
    { id: 'contacted', label: 'Contacted', value: 'Contacted' },
    { id: 'interview', label: 'Interview Scheduled', value: 'Interview Scheduled' },
    { id: 'offer', label: 'Offer Sent', value: 'Offer Sent' },
    { id: 'hired', label: 'Hired', value: 'Hired' },
    { id: 'rejected', label: 'Rejected', value: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn', value: 'Withdrawn' },
    { id: 'inactive', label: 'Inactive (30d+)', value: 'Inactive' }
];

const LAST_CALL_RESULTS = [
    { id: 'no_answer', label: 'No Answer', value: 'No Answer' },
    { id: 'left_voicemail', label: 'Left Voicemail', value: 'Left Voicemail' },
    { id: 'busy', label: 'Busy', value: 'Busy' },
    { id: 'wrong_number', label: 'Wrong Number', value: 'Wrong Number' },
    { id: 'not_interested', label: 'Not Interested', value: 'Not Interested' }
];

const LIFECYCLE_STATUSES = {
    PROCESSING: 'processing',
    FAILED: 'failed',
    COMPLETE: 'complete',
    VALIDATION_ERROR: 'validation_error'
};

/**
 * Helper to get the DB value (legacy string) from an ID.
 * @param {string} id - The ID to look up
 * @param {Array} dictionary - The constant array to search
 * @returns {string} - The value or the ID itself if not found
 */
const getDbValue = (id, dictionary) => {
    const item = dictionary.find(i => i.id === id);
    return item ? item.value : id;
};

module.exports = {
    APPLICATION_STATUSES,
    LAST_CALL_RESULTS,
    LIFECYCLE_STATUSES,
    getDbValue
};
