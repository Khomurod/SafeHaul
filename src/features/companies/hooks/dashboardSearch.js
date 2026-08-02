/**
 * Pure helpers for Applications/Leads dashboard search.
 *
 * Search runs as a small set of parallel single-field Firestore queries
 * (equality or bounded prefix) built from a classified search term, then the
 * merged results are verified client-side with recordMatchesSearch and
 * filtered with applyClientSideFilters. Because every server query touches a
 * single field, only automatic single-field indexes are needed — no composite
 * index permutations, no missing-index errors when search is combined with
 * pipeline tabs or filters.
 */
import {
    normalizeSearchText,
    normalizeSearchEmail,
    normalizeSearchPhone,
    normalizeSearchConfirmation,
    normalizeSearchApplicationId,
} from '@shared/utils/searchNormalization';
import { statusMatchesSegment } from '@shared/utils/applicationStatus';

const CONFIRMATION_PATTERN = /^[A-Za-z]{2,5}\s*-\s*\d{4}\s*-\s*[A-Za-z0-9]{4,8}$/;
const PHONE_PATTERN = /^[+()\-.\s\d]{7,}$/;
const APPLICATION_ID_PATTERN = /^[a-z0-9]{20}(_[a-z0-9]+)*$/i;
const ANON_ID_PATTERN = /^anon_[a-z0-9]+_[a-z0-9]+$/i;

/** Firestore's documented "end of prefix range" sentinel. */
export const PREFIX_END = '';

/** Per-plan fetch cap. Merged, deduped, verified results are capped separately. */
export const SEARCH_PLAN_LIMIT = 30;
export const SEARCH_RESULT_LIMIT = 50;

const titleCase = (value) =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/**
 * Classify a raw search input.
 * @returns {null | {type: 'email'|'phone'|'confirmation'|'applicationId'|'name', value: string, raw: string}}
 */
export function classifySearchTerm(rawTerm) {
    const raw = String(rawTerm ?? '').trim();
    if (!raw) return null;

    if (raw.includes('@')) {
        return { type: 'email', value: normalizeSearchEmail(raw), raw };
    }
    if (CONFIRMATION_PATTERN.test(raw)) {
        return { type: 'confirmation', value: normalizeSearchConfirmation(raw), raw };
    }
    const compact = raw.replace(/\s+/g, '');
    if (APPLICATION_ID_PATTERN.test(compact) || ANON_ID_PATTERN.test(compact)) {
        return { type: 'applicationId', value: normalizeSearchApplicationId(compact), raw };
    }
    if (PHONE_PATTERN.test(raw)) {
        const digits = normalizeSearchPhone(raw);
        if (digits.length >= 7) {
            return { type: 'phone', value: digits, raw };
        }
    }
    return { type: 'name', value: normalizeSearchText(raw), raw };
}

/**
 * Build the parallel single-field query plans for a classified term.
 * Each plan is {kind: 'eq'|'prefix'|'docId', field?, value}.
 * Legacy plans keep pre-normalization documents findable (their stored
 * casing/formats) until the backfill has run.
 */
export function buildSearchPlans(classified) {
    if (!classified) return [];
    const { type, value, raw } = classified;

    if (type === 'email') {
        // buildApplicationDoc has always lowercased `email`, so the legacy plan
        // shares the same value; dedupe to one query when they collide.
        return [
            { kind: 'eq', field: 'emailNormalized', value },
            { kind: 'eq', field: 'email', value },
        ];
    }
    if (type === 'phone') {
        return [
            { kind: 'eq', field: 'phoneNormalized', value },
            { kind: 'eq', field: 'phone', value: raw },
        ];
    }
    if (type === 'confirmation') {
        return [
            { kind: 'eq', field: 'confirmationNumberNormalized', value },
            { kind: 'eq', field: 'confirmationNumber', value },
        ];
    }
    if (type === 'applicationId') {
        return [
            { kind: 'docId', value },
            { kind: 'eq', field: 'applicationIdNormalized', value },
            { kind: 'eq', field: 'applicationId', value: raw.replace(/\s+/g, '') },
        ];
    }

    // Name term: bounded prefix scans on the persisted normalized fields, plus
    // the legacy title-cased lastName/firstName prefixes for old documents.
    const legacy = titleCase(value);
    return [
        { kind: 'prefix', field: 'firstNameNormalized', value },
        { kind: 'prefix', field: 'lastNameNormalized', value },
        { kind: 'prefix', field: 'fullNameNormalized', value },
        { kind: 'prefix', field: 'lastName', value: legacy },
        { kind: 'prefix', field: 'firstName', value: legacy },
    ];
}

/**
 * Client-side truth test for a record against a classified term. Used both to
 * verify merged Firestore results (prefix scans on legacy fields can overshoot)
 * and as the search implementation for the E2E fixture dataset.
 */
export function recordMatchesSearch(record, classified) {
    if (!classified) return true;
    if (!record) return false;
    const { type, value } = classified;

    if (type === 'email') {
        return normalizeSearchEmail(record.email) === value;
    }
    if (type === 'phone') {
        const digits = normalizeSearchPhone(record.phone || record.phoneNumber);
        return digits !== '' && digits === value;
    }
    if (type === 'confirmation') {
        return normalizeSearchConfirmation(record.confirmationNumber) === value;
    }
    if (type === 'applicationId') {
        return (
            normalizeSearchApplicationId(record.id) === value ||
            normalizeSearchApplicationId(record.applicationId) === value
        );
    }

    const first = normalizeSearchText(record.firstName);
    const last = normalizeSearchText(record.lastName);
    const full = normalizeSearchText(`${first} ${last}`);
    const storedFull = normalizeSearchText(record.fullName);
    return (
        first.startsWith(value) ||
        last.startsWith(value) ||
        full.startsWith(value) ||
        (storedFull !== '' && storedFull.startsWith(value))
    );
}

/** Lead pipeline segments keep their existing exact status vocabularies. */
const LEAD_SEGMENT_STATUSES = {
    attempting: ['Contact Attempt 1', 'Contact Attempt 2', 'Contact Attempt 3'],
    in_process: ['In Process'],
    interested: ['Interested'],
};

export function leadStatusMatchesSegment(rawStatus, segmentId) {
    if (!segmentId || segmentId === 'all') return true;
    const statuses = LEAD_SEGMENT_STATUSES[segmentId];
    if (!statuses) return true;
    return statuses.includes(String(rawStatus ?? ''));
}

function matchesDateFilter(record, dateFilter) {
    if (!dateFilter) return true;
    const ts = record.submittedAt || record.createdAt;
    if (!ts) return false;
    try {
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        const filterDate = new Date(`${dateFilter}T00:00:00`);
        return (
            d.getFullYear() === filterDate.getFullYear() &&
            d.getMonth() === filterDate.getMonth() &&
            d.getDate() === filterDate.getDate()
        );
    } catch {
        return false;
    }
}

/**
 * Apply the active tab scope, pipeline segment, and toolbar filters to a set
 * of records client-side. Mirrors the Firestore constraints used in browse
 * mode so merged search results honor the same visibility rules.
 */
export function applyClientSideFilters(records, {
    activeTab,
    pipelineSegment,
    filters = {},
    currentUid = null,
} = {}) {
    const isApplications = activeTab === 'applications';
    return (records || []).filter((record) => {
        if (!record) return false;

        if (isApplications) {
            if (!statusMatchesSegment(record.status, pipelineSegment)) return false;
        } else if (!leadStatusMatchesSegment(record.status, pipelineSegment)) {
            return false;
        }

        if (activeTab === 'my_leads' && currentUid && record.assignedTo !== currentUid) {
            return false;
        }
        if (
            filters.myAssignmentsOnly &&
            currentUid &&
            (activeTab === 'applications' || activeTab === 'company_leads') &&
            record.assignedTo !== currentUid
        ) {
            return false;
        }
        if (filters.assignee) {
            if (filters.assignee === '__unassigned__') {
                if (record.assignedTo) return false;
            } else if (record.assignedTo !== filters.assignee) {
                return false;
            }
        }
        if (filters.state && String(record.state || '').toUpperCase() !== filters.state.toUpperCase()) {
            return false;
        }
        if (filters.driverType) {
            const types = Array.isArray(record.driverType)
                ? record.driverType
                : (record.driverType ? [record.driverType] : []);
            if (!types.includes(filters.driverType)) return false;
        }
        if (!matchesDateFilter(record, filters.dateFilter)) return false;

        return true;
    });
}

/** Merge result lists, dedupe by id, newest submittedAt/createdAt first. */
export function mergeSearchResults(lists, cap = SEARCH_RESULT_LIMIT) {
    const byId = new Map();
    for (const list of lists || []) {
        for (const record of list || []) {
            if (record && record.id && !byId.has(record.id)) {
                byId.set(record.id, record);
            }
        }
    }
    const merged = [...byId.values()];
    merged.sort((a, b) => {
        const aTs = a.submittedAt?.seconds || a.createdAt?.seconds || 0;
        const bTs = b.submittedAt?.seconds || b.createdAt?.seconds || 0;
        return bTs - aTs;
    });
    return merged.slice(0, cap);
}
