/**
 * Data cleanup → test accounts: what the removed Deep Diagnostic left behind.
 *
 * Each diagnostic run created an Auth user `systest_<ms>@example.com` with a
 * fixed password and its `users/{uid}` document, memberships, companies
 * `SYS_TEST_<ms>` and `SYS_TEST_B_<ms>` with their records, a driver
 * `SYS_DRIVER_<ms>`, their public profiles and a few Storage files. Its own
 * cleanup never removed the login, and a failed step skipped it entirely.
 *
 * Matching is exact: the whole email, company id, driver id or file path must
 * have the diagnostic's shape. A company or driver of that name that exists
 * without the diagnostic's `isTestRecord: true` is left and counted as
 * `skipped`, and so is a login that is the caller's own or a Super Admin's,
 * and a `users` document with a test address whose uid is any other login's.
 *
 * Deleted in the order `deletePortalUser` uses: the login first, so the
 * membership trigger cannot rebuild the user's claims, then memberships, the
 * user document, the company and driver trees, the public profiles and the
 * files. Deleting the company records can make the dashboard trigger write
 * one stats document back; a second run removes it.
 */
const { isSuperAdminClaims } = require('../../shared/superAdmin');
const { createWriter } = require('./shared');

const TEST_EMAIL = /^systest_\d+@example\.com$/i;
const TEST_COMPANY_ID = /^SYS_TEST_(?:B_)?\d+$/;
const TEST_DRIVER_ID = /^SYS_DRIVER_\d+$/;
/** Storage prefixes the diagnostic wrote under, and the exact file shapes under them. */
const TEST_FILES = Object.freeze([
    { prefix: 'system_health_tests/SYS_TEST_', shape: /^system_health_tests\/SYS_TEST_\d+\.txt$/ },
    { prefix: 'companies/SYS_TEST_', shape: /^companies\/(SYS_TEST_(?:B_)?\d+)\/.+$/ },
]);
/** The character after `_`, so `[prefix, prefix + '`')` is every string starting with the prefix. */
const prefixEnd = (prefix) => `${prefix.slice(0, -1)}\``;
const IN_LIMIT = 30;

/** The test logins, and every other login's uid, which nothing here may delete. */
async function findLogins(ctx, counts) {
    const uids = [];
    const kept = new Set();
    let pageToken;
    do {
        if (ctx.outOfTime()) return { uids, kept, done: false };
        const page = await ctx.auth.listUsers(1000, pageToken);
        for (const user of page.users || []) {
            if (!TEST_EMAIL.test(user.email || '')) {
                kept.add(user.uid);
            } else if (user.uid === ctx.callerUid || isSuperAdminClaims(user.customClaims)) {
                kept.add(user.uid);
                counts.skipped += 1;
            } else uids.push(user.uid);
        }
        pageToken = page.pageToken;
    } while (pageToken);
    return { uids, kept, done: true };
}

/**
 * `users` documents of the logins, and of test logins already deleted, found by
 * their email. One whose uid is a kept login's is left, whatever it says.
 */
async function findUserDocs(ctx, loginUids, keptUids, counts) {
    const users = ctx.db.collection('users');
    const byEmail = await users.where('email', '>=', 'systest_').where('email', '<', prefixEnd('systest_')).get();
    const refs = new Map();
    for (const doc of byEmail.docs) {
        if (!TEST_EMAIL.test(String(doc.data()?.email || ''))) continue;
        if (keptUids.has(doc.id)) counts.skipped += 1;
        else refs.set(doc.id, doc.ref);
    }
    for (const uid of loginUids) {
        if (refs.has(uid)) continue;
        const snap = await users.doc(uid).get();
        if (snap.exists) refs.set(uid, snap.ref);
    }
    return refs;
}

/**
 * Memberships of the test logins, and memberships in test companies. Those in a
 * kept look-alike company stay with it, and those of a login that could not be
 * deleted stay until a later run deletes the login.
 */
async function findMemberships(ctx, uids, keptCompanies, failedUids) {
    const memberships = ctx.db.collection('memberships');
    const refs = new Map();
    for (let i = 0; i < uids.length; i += IN_LIMIT) {
        const snap = await memberships.where('userId', 'in', uids.slice(i, i + IN_LIMIT)).get();
        for (const doc of snap.docs) refs.set(doc.ref.path, doc);
    }
    const inTestCompanies = await memberships
        .where('companyId', '>=', 'SYS_TEST_').where('companyId', '<', prefixEnd('SYS_TEST_')).get();
    for (const doc of inTestCompanies.docs) {
        if (TEST_COMPANY_ID.test(String(doc.data()?.companyId || ''))) refs.set(doc.ref.path, doc);
    }
    return [...refs.values()]
        .filter((doc) => !keptCompanies.has(String(doc.data()?.companyId || '')))
        .filter((doc) => !failedUids.has(String(doc.data()?.userId || '')))
        .map((doc) => doc.ref);
}

/** Test companies, including ones whose document is gone but whose records remain. */
async function findCompanies(ctx, counts) {
    const refs = (await ctx.db.collection('companies').listDocuments()).filter((ref) => TEST_COMPANY_ID.test(ref.id));
    const found = [];
    const kept = new Set();
    for (const ref of refs) {
        const snap = await ref.get();
        if (snap.exists && snap.data()?.isTestRecord !== true) {
            kept.add(ref.id);
            counts.skipped += 1;
        } else found.push(ref);
    }
    return { found, kept };
}

async function findByIdPrefix(ctx, collectionName, prefix, shape, isOwnRecord, counts) {
    const { documentId } = ctx.FieldPath;
    const snap = await ctx.db.collection(collectionName)
        .where(documentId(), '>=', prefix).where(documentId(), '<', prefixEnd(prefix)).get();
    const found = [];
    for (const doc of snap.docs) {
        if (!shape.test(doc.id)) continue;
        if (isOwnRecord(doc)) found.push(doc.ref);
        else counts.skipped += 1;
    }
    return found;
}

async function findFiles(ctx, keptCompanies) {
    const files = [];
    for (const { prefix, shape } of TEST_FILES) {
        const [inPrefix] = await ctx.bucket.getFiles({ prefix });
        for (const file of inPrefix) {
            const match = shape.exec(file.name);
            if (match && !(match[1] && keptCompanies.has(match[1]))) files.push(file);
        }
    }
    return files;
}

async function deleteLogins(ctx, uids) {
    const failed = new Set();
    for (let i = 0; i < uids.length; i += 1000) {
        const chunk = uids.slice(i, i + 1000);
        const result = await ctx.auth.deleteUsers(chunk);
        for (const error of result?.errors || []) {
            // A login already gone is the outcome this asks for.
            if (error?.error?.code !== 'auth/user-not-found') failed.add(chunk[error.index]);
        }
    }
    return failed;
}

async function sweep(ctx) {
    const counts = {
        logins: 0, memberships: 0, userDocs: 0, companies: 0, drivers: 0, publicProfiles: 0, files: 0, skipped: 0,
    };
    const logins = await findLogins(ctx, counts);
    if (!logins.done) return { done: false, counts };

    // A login that could not be deleted keeps its membership and user document
    // until a later run: without the login first, the trigger would rebuild them.
    const failed = ctx.apply ? await deleteLogins(ctx, logins.uids) : new Set();
    const loginUids = logins.uids.filter((uid) => !failed.has(uid));
    counts.logins = loginUids.length;

    const userDocs = await findUserDocs(ctx, loginUids, logins.kept, counts);
    for (const uid of failed) userDocs.delete(uid);
    const companies = await findCompanies(ctx, counts);
    const memberships = await findMemberships(ctx, [...new Set([...loginUids, ...userDocs.keys()])], companies.kept, failed);
    const drivers = await findByIdPrefix(ctx, 'drivers', 'SYS_DRIVER_', TEST_DRIVER_ID,
        (doc) => doc.data()?.isTestRecord === true, counts);
    const profiles = await findByIdPrefix(ctx, 'public_profiles', 'SYS_TEST_', TEST_COMPANY_ID,
        (doc) => !companies.kept.has(doc.id), counts);
    const files = await findFiles(ctx, companies.kept);

    counts.memberships = memberships.length;
    counts.userDocs = userDocs.size;
    counts.companies = companies.found.length;
    counts.drivers = drivers.length;
    counts.publicProfiles = profiles.length;
    counts.files = files.length;
    if (!ctx.apply) return { done: true, counts };

    const writer = createWriter(ctx.db, true);
    for (const ref of memberships) await writer.delete(ref);
    await writer.flush();
    for (const ref of userDocs.values()) await writer.delete(ref);
    await writer.flush();
    for (const ref of [...companies.found, ...drivers]) {
        if (ctx.outOfTime()) return { done: false, counts };
        await ctx.db.recursiveDelete(ref);
    }
    for (const ref of profiles) await writer.delete(ref);
    await writer.flush();
    for (const file of files) {
        try {
            await file.delete();
        } catch (error) {
            if (error?.code !== 404) throw error;
        }
    }
    return { done: failed.size === 0, counts };
}

module.exports = { sweep, TEST_COMPANY_ID, TEST_DRIVER_ID, TEST_EMAIL };
