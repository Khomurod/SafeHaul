/**
 * Super Admin → Maintenance → Data cleanup: the one-time removal of data that
 * older code left behind, run by the owner one item at a time.
 *
 * `{ mode: 'check', item }` counts what the item would change and writes
 * nothing. `{ mode: 'run', item }` changes it; it needs a recent sign-in, as
 * every privileged console action does, and leaves a value-free audit record
 * (`environment_audit_log`). Each item selects by the data's current state, so
 * a run is safe to repeat: one that reaches the time budget answers
 * `done: false`, and pressing Run again goes on from where the data now is.
 *
 * The items and what each one touches are in `./cleanup/<item>.js`.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, auth, db, storage } = require('../firebaseAdmin');
const { assertSuperAdminAuth } = require('../shared/superAdmin');
const { assertRecentAuth } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');

const ITEMS = Object.freeze({
    testAccounts: require('./cleanup/testAccounts'),
    ssnCopies: require('./cleanup/ssnCopies'),
    pevLinks: require('./cleanup/pevLinks'),
    leadFields: require('./cleanup/leadFields'),
    searchFields: require('./cleanup/searchFields'),
    smtpCopies: require('./cleanup/smtpCopies'),
});
const MODES = Object.freeze(['check', 'run']);
/** Counts that describe what is left alone, not what a run changes. */
const LEFT_ALONE = Object.freeze(['skipped', 'driverTypeSeveral', 'unverifiable']);
/** Work stops here, well inside the function's 540 s, so the answer always arrives. */
const TIME_BUDGET_MS = 480 * 1000;

const isItem = (item) => typeof item === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, item);

/**
 * What a run would change (a check) or changed (a run), when the item does not
 * say: every count but those of records left alone.
 */
const totalOf = (counts) => Object.entries(counts)
    .filter(([key]) => !LEFT_ALONE.includes(key))
    .reduce((sum, [, value]) => sum + value, 0);

/**
 * Runs one item.
 *
 * @param {{ item: string, mode: 'check'|'run', outOfTime: () => boolean, callerUid?: string }} options
 */
async function execute({ item, mode, outOfTime, callerUid }) {
    const ctx = {
        db,
        auth,
        bucket: storage.bucket(),
        FieldValue: admin.firestore.FieldValue,
        FieldPath: admin.firestore.FieldPath,
        outOfTime,
        callerUid,
        apply: mode === 'run',
    };
    const { done, counts, notes, total } = await ITEMS[item].sweep(ctx);
    return { item, mode, done, counts, total: total ?? totalOf(counts), ...(notes ? { notes } : {}) };
}

exports.dataCleanup = onCall({
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
    // The SMTP item decrypts a stored password and encrypts the copy it keeps.
    secrets: ['SMS_ENCRYPTION_KEY'],
}, async (request) => {
    assertSuperAdminAuth(request.auth);
    const { mode, item } = request.data || {};
    if (!MODES.includes(mode) || !isItem(item)) {
        throw new HttpsError('invalid-argument', 'Choose a cleanup item and check or run.');
    }
    if (mode === 'run') await assertRecentAuth(request, ACTIONS.DATA_CLEANUP, { item });

    const startedAt = Date.now();
    const outOfTime = () => Date.now() - startedAt >= TIME_BUDGET_MS;
    try {
        const result = await execute({ item, mode, outOfTime, callerUid: request.auth.uid });
        if (mode === 'run') {
            await recordAuditEvent({
                auth: request.auth,
                action: ACTIONS.DATA_CLEANUP,
                result: RESULTS.SUCCESS,
                metadata: { item, mode, count: result.total, done: result.done },
            });
        }
        return result;
    } catch (error) {
        console.error(`[dataCleanup] ${item} ${mode} failed: ${error?.message || error}`);
        if (mode === 'run') {
            await recordAuditEvent({
                auth: request.auth, action: ACTIONS.DATA_CLEANUP, result: RESULTS.FAILED, metadata: { item, mode },
            });
        }
        throw new HttpsError('internal', 'The cleanup stopped with an error. Press Check to see what is left.');
    }
});

exports.__private = { ITEMS, TIME_BUDGET_MS, execute };
