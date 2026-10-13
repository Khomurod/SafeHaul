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
import { toUsStateCode, toUsStateName } from '@shared/utils/usStates';
import { NORTH_AMERICAN_REGION_NAMES, fmcsaRegionOutsideUs } from '@shared/utils/northAmericanRegions';
import { parseIsoDateParts } from '@shared/utils/dateFormHelpers';

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

const REGION_BY_LOWER_NAME = new Map(NORTH_AMERICAN_REGION_NAMES.map((name) => [name.toLowerCase(), name]));

const regionCode = (name) => toUsStateCode(name) || fmcsaRegionOutsideUs(name)?.code || '';

/** Postal codes two regions share ("NL": Newfoundland and Labrador, Nuevo León). */
const SHARED_REGION_CODES = (() => {
    const seen = new Set();
    const shared = new Set();
    for (const code of NORTH_AMERICAN_REGION_NAMES.map(regionCode)) {
        if (seen.has(code)) shared.add(code);
        seen.add(code);
    }
    return shared;
})();

/**
 * The stored spellings the State filter matches for a picked region, used by
 * the Firestore `in` and by the client-side mirror alike. The picker offers the
 * regions the application's own address pickers do (the US, Canada, Mexico). An
 * application holds its picker's full name ("Texas"), though one filled in from
 * a licence may hold the postal code ("TX"); a lead holds whatever its import
 * file or the quick-add box said. So the filter matches the name as written, in
 * capitals and in lower case, and the code in every casing ("TX", "tx", "Tx",
 * "tX"), unless two regions share the code. At most seven values, which keeps a
 * segment's `status in` (three at most) inside Firestore's 30 alternatives. A
 * name typed in mixed case ("tExAs") is not matched.
 *
 * @param {unknown} value the picked region, e.g. `'Texas'`
 * @returns {string[]} e.g. `['Texas', 'TEXAS', 'texas', 'TX', 'tx', 'Tx', 'tX']`;
 *   a value that names no region is matched as it is
 */
export function stateFilterValues(value) {
    const text = String(value ?? '').trim();
    const name = toUsStateName(text) || REGION_BY_LOWER_NAME.get(text.toLowerCase()) || '';
    if (!name) return text ? [text] : [];
    const code = regionCode(name);
    const codes = code && !SHARED_REGION_CODES.has(code)
        ? [code, code.toLowerCase(), code[0] + code[1].toLowerCase(), code[0].toLowerCase() + code[1]]
        : [];
    return [...new Set([name, name.toUpperCase(), name.toLowerCase(), ...codes])];
}

/**
 * The day picked in the date filter, as the instants it covers on the
 * recruiter's clock: from that day's local midnight to the next one, so a day
 * the clocks change on is 23 or 25 hours long. The list query asks Firestore for
 * a `createdAt` in this range, and the client-side mirror applies the same one.
 *
 * @param {unknown} dateFilter e.g. `'2026-10-12'`
 * @returns {{ start: Date, end: Date } | null} `null` for anything but a real
 *   `YYYY-MM-DD` day, which sets no date constraint
 */
export function dateFilterRange(dateFilter) {
    const parts = parseIsoDateParts(dateFilter);
    if (!parts) return null;
    return {
        start: new Date(parts.year, parts.month - 1, parts.day),
        end: new Date(parts.year, parts.month - 1, parts.day + 1),
    };
}

/** A stored time (a Firestore Timestamp or its plain `{ seconds }` form) in milliseconds; `null` if there is none. */
function timeMillis(ts) {
    if (!ts) return null;
    try {
        const millis = ts.toDate ? ts.toDate().getTime() : ts.seconds * 1000;
        return Number.isFinite(millis) ? millis : null;
    } catch {
        return null;
    }
}

/** When a record was created; `null` for one without createdAt, which the list's date order leaves out. */
export function createdAtMillis(record) {
    return timeMillis(record?.createdAt);
}

function matchesDateFilter(record, dateFilter) {
    const range = dateFilterRange(dateFilter);
    if (!range) return true;
    const at = createdAtMillis(record);
    return at !== null && at >= range.start.getTime() && at < range.end.getTime();
}

/**
 * Records in the order of the list's Added Date: the day each was created, else
 * submitted, newest first or, with `'asc'`, earliest first. A record with
 * neither comes last. The browse list gets this order from Firestore; search
 * results, at most 50, and the E2E fixtures are sorted here.
 */
export function sortByAddedDate(records, direction = 'desc') {
    const sign = direction === 'asc' ? 1 : -1;
    const addedAt = (record) => createdAtMillis(record) ?? timeMillis(record?.submittedAt);
    return [...(records || [])].sort((a, b) => {
        const aAt = addedAt(a);
        const bAt = addedAt(b);
        if (aAt === null || bAt === null) return (aAt === null) - (bAt === null);
        return sign * (aAt - bAt);
    });
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
        if (filters.state && !stateFilterValues(filters.state).includes(record.state)) {
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

/** Merge result lists, dedupe by id, newest Added Date first (`sortByAddedDate`), capped. */
export function mergeSearchResults(lists, cap = SEARCH_RESULT_LIMIT) {
    const byId = new Map();
    for (const list of lists || []) {
        for (const record of list || []) {
            if (record && record.id && !byId.has(record.id)) {
                byId.set(record.id, record);
            }
        }
    }
    return sortByAddedDate([...byId.values()], 'desc').slice(0, cap);
}
