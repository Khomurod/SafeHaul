/**
 * Re-renders the caller just after the first `sending` claim among `records`
 * lapses, so "Sending copy…" turns into "Copy may not have been sent" and Try
 * again at that moment, not on the next unrelated render (`utils/signedCopy.js`
 * reads the clock only when it is asked).
 *
 * One timer, for the earliest claim that still holds; it is set again after each
 * tick and whenever that claim changes, and cleared on unmount.
 */
import { useEffect, useState } from 'react';
import { CLAIM_LIFETIME_MS, sendingClaimExpiresAt } from '@features/signing/utils/signedCopy';

// Fire a little after the claim lapses, so the clock reads it as lapsed.
const AFTER_EXPIRY_MS = 1000;

/** @param {Array<object|null|undefined>} records `signedCopy` records, as shown. */
export function useRerenderWhenClaimsExpire(records) {
    const [tick, setTick] = useState(0);
    const now = Date.now();
    let nextExpiry = null;
    for (const record of records) {
        const expiresAt = sendingClaimExpiresAt(record, now);
        if (expiresAt !== null && (nextExpiry === null || expiresAt < nextExpiry)) nextExpiry = expiresAt;
    }

    useEffect(() => {
        if (nextExpiry === null) return undefined;
        // Never past one claim lifetime: an approval time far in the future
        // must not overflow the timer into firing at once, again and again.
        const delay = Math.min(Math.max(0, nextExpiry - Date.now()), CLAIM_LIFETIME_MS) + AFTER_EXPIRY_MS;
        const timer = setTimeout(() => setTick((count) => count + 1), delay);
        return () => clearTimeout(timer);
    }, [nextExpiry, tick]);
}
