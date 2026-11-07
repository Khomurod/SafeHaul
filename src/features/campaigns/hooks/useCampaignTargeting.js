import { useState, useEffect, useRef, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { ERROR_MESSAGES, UPLOAD_EXCLUDE_DEFAULT, campaignLimitOf } from '../constants/campaignConstants';

const NO_KEYS = new Set();

/**
 * The "Exclude Previously Messaged" window the count applies, or null for none.
 * An upload is counted with the window the screen shows until another is
 * picked; only "No Exclusion" turns it off.
 */
const windowOf = (filters) => {
    const setting = filters.leadType === 'import'
        ? (filters.excludeRecentDays || UPLOAD_EXCLUDE_DEFAULT)
        : filters.excludeRecentDays;
    return setting && setting !== 'off' ? setting : null;
};

/**
 * What a count depends on, and who asked (`my_leads` is the asker's own leads).
 * Limit Volume and the un-ticks are not: they come off the answer.
 */
const audienceKeyOf = (companyId, method, filters, uid) => JSON.stringify([
    companyId, uid, method, filters.leadType, filters.status, filters.recruiterId,
    filters.createdAfter, filters.notContactedSince, filters.lastCallOutcome, filters.segmentId,
    windowOf(filters),
]);

/** Asks the server who the audience is: `{ total, alreadyMessaged, keys, error }`. */
async function countAudience({ companyId, filters, method }) {
    const exclusion = windowOf(filters);

    // Import mode: ask which rows this channel already reached.
    if (filters.leadType === 'import') {
        const rawData = filters.rawData || [];
        if (rawData.length === 0) return { total: 0, alreadyMessaged: 0, keys: NO_KEYS, error: ERROR_MESSAGES.ZERO_RESULTS };
        if (!exclusion) return { total: rawData.length, alreadyMessaged: 0, keys: NO_KEYS, error: null };
        try {
            const result = await httpsCallable(functions, 'checkImportPhones')({
                companyId,
                method,
                excludeRecentDays: exclusion,
                // Each row by the key the preview and the launch name it by.
                recipients: rawData.map((row, index) => ({
                    key: row.id || `import_${index}`,
                    phone: row.normalizedPhone || row.phone || '',
                    email: row.email || '',
                })),
            });
            const keys = new Set(result.data.excludedKeys || []);
            const total = Math.max(0, rawData.length - keys.size);
            return { total, alreadyMessaged: keys.size, keys, error: total === 0 ? ERROR_MESSAGES.ZERO_RESULTS : null };
        } catch (err) {
            console.error('checkImportPhones error:', err);
            // Non-fatal: the raw count, so the recruiter isn't blocked. The launch checks every row again.
            return { total: rawData.length, alreadyMessaged: 0, keys: NO_KEYS, error: null };
        }
    }

    try {
        const result = await httpsCallable(functions, 'getFilterCount')({
            companyId,
            method,
            // The whole audience: Limit Volume is applied to the answer, in the hook.
            filters: { ...filters, excludeRecentDays: exclusion, campaignLimit: null },
        });
        const total = result.data.count || 0;
        return { total, alreadyMessaged: result.data.alreadyMessaged || 0, keys: NO_KEYS, error: total === 0 ? ERROR_MESSAGES.ZERO_RESULTS : null };
    } catch (err) {
        console.error('Targeting Error:', err);
        return { total: 0, alreadyMessaged: 0, keys: NO_KEYS, error: ERROR_MESSAGES.COUNT_FAILED };
    }
}

/**
 * The audience count for a campaign of `method`'s channel ('sms' or 'email').
 * "Already messaged" is a recipient a campaign of the same channel reached
 * inside the window (`functions/bulkActions/helpers/recentlyMessaged.js`):
 * `alreadyMessaged` says how many the count leaves out, and for an uploaded
 * list `alreadyMessagedKeys` names those rows by their preview key.
 *
 * Without a window the count is a cheap server aggregation and follows the
 * filters by itself. With one, the server reads every matching record and its
 * ledger entry, so the count waits for `recount` (Recalculate audience): until
 * then `needsRecount` is true and nothing counted for other filters is shown.
 * Limit Volume trims a CRM count here, in the browser: changing it counts
 * nothing again. None of this decides who is messaged; the launch checks every
 * recipient again on the server.
 */
export function useCampaignTargeting(companyId, filters, currentUser, method = 'sms') {
    // Who is signed in by uid, not the user object: a new object for the same
    // user is not new filters, another user is (their own leads differ).
    const signedIn = Boolean(currentUser);
    const isImport = filters.leadType === 'import';
    const rows = isImport ? (filters.rawData ?? null) : null;
    const key = audienceKeyOf(companyId, method, filters, currentUser?.uid ?? null);
    // An upload with no rows has nothing to look up, so it counts by itself.
    const onRequest = windowOf(filters) !== null && !(isImport && !rows?.length);

    // The last answer, and the audience it is for (`key`, and the uploaded rows by identity).
    const [counted, setCounted] = useState(null);
    // The count in flight: `{ id, key, rows }`.
    const [pending, setPending] = useState(null);
    const lastRunRef = useRef(0);
    const latestRef = useRef(null);
    latestRef.current = { companyId, filters, method, key, rows };

    const isFor = (entry) => Boolean(entry) && entry.key === key && entry.rows === rows;

    const run = useCallback(async (audience) => {
        const id = lastRunRef.current + 1;
        lastRunRef.current = id;
        setPending({ id, key: audience.key, rows: audience.rows });
        const result = await countAudience(audience);
        // An answer for filters the recruiter has since changed, or one a later
        // count overtook, arrives too late to count.
        const now = latestRef.current;
        if (id === lastRunRef.current && now.key === audience.key && now.rows === audience.rows) {
            setCounted({ key: audience.key, rows: audience.rows, ...result });
        }
        setPending((current) => (current?.id === id ? null : current));
    }, []);

    // The cheap count follows the filters, 500 ms after the last change.
    useEffect(() => {
        if (!signedIn || !companyId || onRequest) return undefined;
        const timer = setTimeout(() => run(latestRef.current), 500);
        return () => clearTimeout(timer);
    }, [key, rows, onRequest, signedIn, companyId, run]);

    // Recalculate audience, and Try again after a failed count.
    const recount = useCallback(() => {
        if (!signedIn || !companyId) return;
        run(latestRef.current);
    }, [signedIn, companyId, run]);

    const needsRecount = onRequest && !isFor(counted);
    // The cheap count shows the last answer until the next one arrives.
    const shown = needsRecount ? null : counted;
    // An uploaded list has no Limit Volume (the launch sends every row it keeps).
    const limit = isImport ? 0 : campaignLimitOf(filters);
    const total = shown?.total ?? 0;

    return {
        matchCount: limit > 0 ? Math.min(total, limit) : total,
        alreadyMessaged: shown?.alreadyMessaged ?? 0,
        alreadyMessagedKeys: shown?.keys ?? NO_KEYS,
        isLoading: isFor(pending),
        error: shown?.error ?? null,
        needsRecount,
        recount,
        retry: recount,
    };
}
