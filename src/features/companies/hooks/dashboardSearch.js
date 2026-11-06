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
import { getStatusesForSegment, statusMatchesSegment } from '@shared/utils/applicationStatus';
import { toUsStateCode, toUsStateName } from '@shared/utils/usStates';
import { NORTH_AMERICAN_REGION_NAMES, fmcsaRegionOutsideUs } from '@shared/utils/northAmericanRegions';
import { parseIsoDateParts } from '@shared/utils/dateFormHelpers';
import { periodRange } from './dashboardPeriods';

const CONFIRMATION_PATTERN = /^[A-Za-z]{2,5}\s*-\s*\d{4}\s*-\s*[A-Za-z0-9]{4,8}$/;
const PHONE_PATTERN = /^[+()\-.\s\d]{7,}$/;
const APPLICATION_ID_PATTERN = /^[a-z0-9]{20}(_[a-z0-9]+)*$/i;
const ANON_ID_PATTERN = /^anon_[a-z0-9]+_[a-z0-9]+$/i;

/** Firestore's documented "end of prefix range" sentinel. */
export const PREFIX_END = '';

/** Per-plan fetch cap. Merged, deduped, verified results are capped separately. */
export const SEARCH_PLAN_LIMIT = 30;
export const SEARCH_RESULT_LIMIT = 50;
/** The shortest name a search sends: `searchableTerm`. */
export const MIN_NAME_SEARCH_LENGTH = 2;

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
 * The term a list or the template picker should search for: `''` (no search,
 * the list as it is) for an empty box or a name shorter than
 * `MIN_NAME_SEARCH_LENGTH`. One letter would run five prefix queries of up to
 * `SEARCH_PLAN_LIMIT` whole documents each, up to 150 downloaded to show at
 * most `SEARCH_RESULT_LIMIT`. An email, phone, confirmation number or
 * application id is never cut.
 * @returns {string} `rawTerm` unchanged, or `''`
 */
export function searchableTerm(rawTerm) {
    const classified = classifySearchTerm(rawTerm);
    if (!classified) return '';
    if (classified.type === 'name' && classified.value.length < MIN_NAME_SEARCH_LENGTH) return '';
    return String(rawTerm);
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
 * `limit` keeps at most that many, the name and the postal code first: the two
 * spellings an application itself stores.
 *
 * @param {unknown} value the picked region, e.g. `'Texas'`
 * @param {number} [limit] the most spellings to return
 * @returns {string[]} e.g. `['Texas', 'TEXAS', 'texas', 'TX', 'tx', 'Tx', 'tX']`;
 *   a value that names no region is matched as it is
 */
export function stateFilterValues(value, limit = Infinity) {
    const text = String(value ?? '').trim();
    const name = toUsStateName(text) || REGION_BY_LOWER_NAME.get(text.toLowerCase()) || '';
    if (!name) return text ? [text] : [];
    const code = regionCode(name);
    const codes = code && !SHARED_REGION_CODES.has(code)
        ? [code, code.toLowerCase(), code[0] + code[1].toLowerCase(), code[0].toLowerCase() + code[1]]
        : [];
    const all = [...new Set([name, name.toUpperCase(), name.toLowerCase(), ...codes])];
    if (all.length <= limit) return all;
    const first = [name, ...codes.slice(0, 1)];
    return [...first, ...all.filter((spelling) => !first.includes(spelling))].slice(0, limit);
}

/** Firestore's limit on the alternatives one query expands into: each `in` value times each other's. */
export const QUERY_ALTERNATIVES_LIMIT = 30;

/**
 * The State filter's spellings for a list beside its segment's `status in`: as
 * many as Firestore's 30 alternatives leave room for. Every segment leaves all
 * seven, but In process's twelve statuses leave two (the name and the postal
 * code), so there a lower-case or other spelling a lead import kept is not found.
 * The query and its client-side mirror both use it.
 */
export function stateValuesForSegment(state, { activeTab, pipelineSegment } = {}) {
    const statuses = activeTab === 'applications'
        ? getStatusesForSegment(pipelineSegment)
        : LEAD_SEGMENT_STATUSES[pipelineSegment];
    return stateFilterValues(state, Math.floor(QUERY_ALTERNATIVES_LIMIT / Math.max(1, statuses?.length || 1)));
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

/**
 * The Added dates the filters ask for: the picked day, the month of a period of
 * applications added (`filters.period`, field `createdAt`), or the days both
 * share, which may be none (`start >= end`). `null` when neither is set.
 *
 * @returns {{ start: Date, end: Date } | null}
 */
export function addedWindow(filters = {}) {
    const day = dateFilterRange(filters.dateFilter);
    const month = filters.period?.field === 'createdAt' ? periodRange(filters.period) : null;
    if (!day || !month) return day || month;
    return {
        start: day.start > month.start ? day.start : month.start,
        end: day.end < month.end ? day.end : month.end,
    };
}

/** The hire dates a period of applications hired asks for (`filters.period`, field `hiredAt`); `null` otherwise. */
export function hiredWindow(filters = {}) {
    return filters.period?.field === 'hiredAt' ? periodRange(filters.period) : null;
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

/** Whether a stored time lies in a window; a window not asked for (`null`) takes everything. */
function within(at, window) {
    if (!window) return true;
    return at !== null && at >= window.start.getTime() && at < window.end.getTime();
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
        if (filters.state && !stateValuesForSegment(filters.state, { activeTab, pipelineSegment }).includes(record.state)) {
            return false;
        }
        if (filters.driverType) {
            const types = Array.isArray(record.driverType)
                ? record.driverType
                : (record.driverType ? [record.driverType] : []);
            if (!types.includes(filters.driverType)) return false;
        }
        if (!within(createdAtMillis(record), addedWindow(filters))) return false;
        if (!within(timeMillis(record.hiredAt), hiredWindow(filters))) return false;

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
