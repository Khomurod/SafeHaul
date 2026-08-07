// functions/shared/publicProfileSync.js
//
// Keeps `public_profiles/{companyId}` converged on the current projection.
//
// WHY THIS EXISTS
// ---------------
// `syncPublicProfile` is an onWrite trigger: it refreshes a company's public
// profile when that company document is written, and never otherwise. So when
// the projection itself changes — new allowlisted keys, a different default —
// every profile written before the change stays as it was. A company that
// configured `addressHistory`, `employmentHistory`, `mvrConsent` or
// `referralSource` before the allowlist was widened would carry an old profile,
// and its public apply page would keep ignoring those settings, until somebody
// happened to edit the company again. Nothing in the deploy path fixed that: the
// only repair was a super-admin callable that no deployment ran.
//
// This module is the reconciler. It walks the companies collection — the source
// of truth — compares each company's profile `dtoVersion` against the current
// one, and rewrites only what is stale. A scheduled function calls it, so the
// fleet converges without anyone remembering to press a button.
//
// PROPERTIES
//   * Idempotent. Once converged, a pass reads and writes nothing.
//   * Safe against the trigger. Each rewrite happens in a transaction that reads
//     both the company and the profile, so a company edited mid-pass cannot be
//     reverted to the settings this pass happened to read — see WHY A
//     TRANSACTION below.
//   * Resumable. A pass that hits its ceiling records where it stopped, and the
//     next pass starts there instead of re-walking from the beginning.
//   * Complete. It iterates COMPANIES, not profiles. A query for profiles whose
//     `dtoVersion` differs would silently miss every legacy profile, because
//     Firestore never returns documents that lack the queried field — which is
//     exactly the population that needs repair.
//
// WHY A TRANSACTION AND NOT A BATCH
// ---------------------------------
// A batch made this sequence possible:
//
//   1. the pass reads company X;
//   2. an admin saves new application settings on X;
//   3. `syncPublicProfile` writes the new settings to X's profile;
//   4. the pass commits, overwriting them with the settings from step 1 — and
//      stamping the CURRENT dtoVersion while doing it.
//
// The company's newly saved settings are gone, and because the version stamp now
// looks current, no later pass ever notices. A transaction that reads the
// company and the profile makes step 4 fail and retry against the fresh data
// instead, which is the only outcome that cannot silently lose a setting.

const { PUBLIC_PROFILE_DTO_VERSION, buildPublicProfileDto } = require('./publicProfileDto');

/** Companies read per page. `getAll` and transaction limits are both generous. */
const DEFAULT_PAGE_SIZE = 200;

/** Ceiling for one pass, so a scheduled run cannot exceed its timeout. */
const DEFAULT_MAX_COMPANIES = 5000;

/** Firestore document id ordering, so a cursor is just a company id. */
const DOCUMENT_ID_PATH = '__name__';

/**
 * Reconcile companies' public profiles with the current projection.
 *
 * @param {object} opts
 * @param {object} opts.db              Firestore (Admin SDK).
 * @param {*} opts.serverTimestamp      `FieldValue.serverTimestamp()`.
 * @param {*} [opts.deleteSentinel]     `FieldValue.delete()` — see buildPublicProfileDto.
 * @param {boolean} [opts.force]        Rewrite even profiles already current.
 * @param {string|null} [opts.startAfterId] Resume point from a previous pass.
 * @param {number} [opts.pageSize]
 * @param {number} [opts.maxCompanies]
 * @param {string} [opts.documentIdPath] Injected for tests; `__name__` in Firestore.
 * @param {string} [opts.logLabel]
 * @returns {Promise<{scanned:number, synced:number, upToDate:number, conflicted:number,
 *   truncated:boolean, lastCompanyId:string|null}>}
 */
async function reconcilePublicProfiles({
    db,
    serverTimestamp,
    deleteSentinel,
    force = false,
    startAfterId = null,
    pageSize = DEFAULT_PAGE_SIZE,
    maxCompanies = DEFAULT_MAX_COMPANIES,
    documentIdPath = DOCUMENT_ID_PATH,
    logLabel = 'reconcilePublicProfiles',
} = {}) {
    if (!db) throw new Error('reconcilePublicProfiles requires a Firestore instance');

    const companies = db.collection('companies');
    const profiles = db.collection('public_profiles');
    // Explicit document-id ordering, so `startAfter` accepts a bare company id
    // and a pass can resume across invocations rather than only within one.
    const ordered = companies.orderBy(documentIdPath);

    let scanned = 0;
    let synced = 0;
    let upToDate = 0;
    let conflicted = 0;
    let cursor = startAfterId;
    let truncated = false;

    for (;;) {
        if (scanned >= maxCompanies) {
            truncated = true;
            break;
        }

        const remaining = Math.min(pageSize, maxCompanies - scanned);
        const page = await (cursor ? ordered.startAfter(cursor) : ordered).limit(remaining).get();
        if (page.empty) break;

        // One read for the whole page's profiles rather than one per company, so
        // a converged fleet costs two reads per company per pass and no writes.
        const existing = await db.getAll(...page.docs.map((doc) => profiles.doc(doc.id)));
        const versionById = new Map(
            existing.map((snap) => [snap.id, snap.exists ? snap.data()?.dtoVersion : undefined]),
        );

        for (const doc of page.docs) {
            scanned += 1;
            cursor = doc.id;

            if (!force && versionById.get(doc.id) === PUBLIC_PROFILE_DTO_VERSION) {
                upToDate += 1;
                continue;
            }

            const outcome = await rewriteProfile({
                db, companies, profiles, companyId: doc.id, force, serverTimestamp, deleteSentinel,
            });
            if (outcome === 'synced') synced += 1;
            else if (outcome === 'current') upToDate += 1;
            else conflicted += 1;
        }

        if (page.size < remaining) break;
    }

    if (synced > 0 || conflicted > 0 || truncated) {
        console.log(
            `[${logLabel}] Scanned ${scanned} companies: ${synced} public profiles resynced, `
            + `${upToDate} already at projection v${PUBLIC_PROFILE_DTO_VERSION}`
            + (conflicted ? `, ${conflicted} left for the next pass after a concurrent edit` : '')
            + (truncated ? `; stopped at the ${maxCompanies}-company ceiling, resuming after ${cursor}` : ''),
        );
    }

    return {
        scanned,
        synced,
        upToDate,
        conflicted,
        truncated,
        // Where the next pass should resume. Null once the walk has completed.
        lastCompanyId: truncated ? cursor : null,
    };
}

/**
 * Rewrite one profile, transactionally, from the company as it is RIGHT NOW.
 *
 * Reads the company inside the transaction rather than trusting the page read,
 * so the settings written are the current ones even if the company was edited
 * mid-pass. Reads the profile too, so a concurrent `syncPublicProfile` write
 * aborts and retries this instead of being clobbered.
 *
 * @returns {'synced'|'current'|'gone'} — `current` when another writer already
 *   brought it up to date; `gone` when the company was deleted mid-pass.
 */
async function rewriteProfile({
    db, companies, profiles, companyId, force, serverTimestamp, deleteSentinel,
}) {
    return db.runTransaction(async (transaction) => {
        const companyRef = companies.doc(companyId);
        const profileRef = profiles.doc(companyId);
        const [companySnap, profileSnap] = await Promise.all([
            transaction.get(companyRef),
            transaction.get(profileRef),
        ]);

        // Deleted between the page read and now. `syncPublicProfile` removes the
        // profile on delete; writing one back would resurrect it.
        if (!companySnap.exists) return 'gone';

        if (!force && profileSnap.exists && profileSnap.data()?.dtoVersion === PUBLIC_PROFILE_DTO_VERSION) {
            return 'current';
        }

        transaction.set(
            profileRef,
            buildPublicProfileDto(companySnap.data(), serverTimestamp, { deleteSentinel }),
            { merge: true },
        );
        return 'synced';
    });
}

/**
 * Run the reconciler to completion, resuming across passes.
 *
 * The per-pass ceiling exists so one invocation cannot run past its timeout; on
 * its own it would mean a fleet larger than the ceiling never got past its first
 * N companies, because every pass restarted at the beginning and the
 * already-current ones consumed the whole budget. This loops within the run and,
 * when it still cannot finish, hands the resume point to the caller.
 *
 * @param {object} opts Everything `reconcilePublicProfiles` takes, plus:
 * @param {number} [opts.maxPasses] Ceiling on loop iterations for one invocation.
 * @returns {Promise<{scanned, synced, upToDate, conflicted, truncated, lastCompanyId}>}
 */
async function reconcilePublicProfilesToCompletion({ maxPasses = 20, ...options } = {}) {
    const totals = { scanned: 0, synced: 0, upToDate: 0, conflicted: 0 };
    let startAfterId = options.startAfterId || null;
    let truncated = false;

    for (let pass = 0; pass < maxPasses; pass += 1) {
        const result = await reconcilePublicProfiles({ ...options, startAfterId });
        totals.scanned += result.scanned;
        totals.synced += result.synced;
        totals.upToDate += result.upToDate;
        totals.conflicted += result.conflicted;

        truncated = result.truncated;
        startAfterId = result.lastCompanyId;
        if (!truncated) break;
    }

    return { ...totals, truncated, lastCompanyId: truncated ? startAfterId : null };
}

module.exports = {
    DEFAULT_MAX_COMPANIES,
    DEFAULT_PAGE_SIZE,
    DOCUMENT_ID_PATH,
    reconcilePublicProfiles,
    reconcilePublicProfilesToCompletion,
};
