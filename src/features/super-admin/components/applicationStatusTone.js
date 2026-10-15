/**
 * An application's status → its semantic `Badge` tone, for the owner panel's
 * application lists. Feature-owned on purpose: the design system must not know
 * what "Background Check" means, and the feature must not invent colours. The
 * keys are the exact frozen status strings; any other status is neutral.
 */
const STATUS_TONES = Object.freeze({
    'Approved': 'success',
    'Rejected': 'danger',
    'Background Check': 'accent',
    'Awaiting Documents': 'warning',
    'Pending Review': 'info',
    'New Application': 'neutral',
});

export function applicationStatusTone(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_TONES, status) ? STATUS_TONES[status] : 'neutral';
}
