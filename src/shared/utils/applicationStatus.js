/**
 * Centralized application-status normalization.
 *
 * Application documents carry several historical spellings for the same
 * pipeline stage ('New' vs 'New Application', 'Hired' vs 'Approved',
 * 'Declined' vs 'Rejected'). Every consumer — pipeline tabs, Firestore
 * queries, status pills, stats — must map raw statuses through this module so
 * the UI and queries cannot drift apart.
 *
 * The RAW variant lists are stored data values (see src/shared/constants/atsStatus.js
 * and firestore.rules allowedRecruiterPipelineStatus). Renaming them breaks
 * existing documents; only APPEND new variants.
 */

/** Raw stored status variants per canonical application pipeline segment. */
export const APPLICATION_STATUS_GROUPS = Object.freeze({
    new: Object.freeze(['New', 'New Application']),
    hired: Object.freeze(['Hired', 'Approved']),
    terminated: Object.freeze(['Terminated']),
    declined: Object.freeze(['Declined', 'Rejected']),
});

const CANONICAL_BY_LOWERCASE = (() => {
    const map = new Map();
    for (const [canonical, variants] of Object.entries(APPLICATION_STATUS_GROUPS)) {
        for (const variant of variants) {
            map.set(variant.toLowerCase(), canonical);
        }
    }
    return map;
})();

/**
 * Normalize a raw stored status to a canonical segment id
 * ('new' | 'hired' | 'terminated' | 'declined') or 'other' for everything else
 * (contact attempts, in-process, offers, legacy workflow states, missing).
 */
export function normalizeApplicationStatus(rawStatus) {
    const key = String(rawStatus ?? '').trim().toLowerCase();
    if (!key) return 'other';
    return CANONICAL_BY_LOWERCASE.get(key) || 'other';
}

/**
 * Raw stored status values to use in a Firestore `where('status', 'in', ...)`
 * for a pipeline segment. Returns null for 'all' / unknown segments (no
 * constraint should be applied).
 */
export function getStatusesForSegment(segmentId) {
    const variants = APPLICATION_STATUS_GROUPS[segmentId];
    return variants ? [...variants] : null;
}

/** True when a record's raw status belongs to the given pipeline segment. */
export function statusMatchesSegment(rawStatus, segmentId) {
    if (!segmentId || segmentId === 'all') return true;
    return normalizeApplicationStatus(rawStatus) === segmentId;
}
