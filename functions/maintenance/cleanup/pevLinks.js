/**
 * Data cleanup → old PEV links.
 *
 * An older PEV screen stored the past employer's form token and link on the
 * application's (or lead's) employer row, `employers[i].verification.token` and
 * `.verificationUrl`, in each history entry, and at the end of the
 * `PEV_REQUEST` activity log (` | Portal: <link>`). The whole team can read
 * those, so anyone could answer the form as the employer (PEV-SEC-3).
 *
 * The row is rewritten in a transaction, because the PEV screen and the
 * reminder and response handlers each rewrite the whole `employers` list: a
 * plain write could undo one of theirs. Everything else on the row stays as
 * it is. The request records in `verification_requests` are not touched, so
 * an employer who has not answered yet still can.
 *
 * Activity logs are looked for only under records with a verification on an
 * employer row: a query across every activity log would need a new index.
 */
const { createWriter, forEachCompanyRecord, has } = require('./shared');

const LINK_KEYS = Object.freeze(['token', 'verificationUrl']);
const PORTAL_SUFFIX = / \| Portal: \S+$/;
const COLLECTIONS = Object.freeze(['applications', 'leads']);

const holdsLink = (entry) => LINK_KEYS.some((key) => has(entry, key));

function withoutLink(entry) {
    const copy = { ...entry };
    for (const key of LINK_KEYS) delete copy[key];
    return copy;
}

/**
 * The employer list without stored links. Rows and entries are copied only
 * where they change, so every other value (timestamps included) is written back
 * exactly as it was read.
 *
 * @param {unknown} employers
 * @returns {{ employers: unknown, changed: boolean, verified: boolean }}
 */
function stripEmployers(employers) {
    if (!Array.isArray(employers)) return { employers, changed: false, verified: false };
    let changed = false;
    let verified = false;
    const next = employers.map((row) => {
        const verification = row && typeof row === 'object' ? row.verification : null;
        if (!verification || typeof verification !== 'object') return row;
        verified = true;
        const history = Array.isArray(verification.history) ? verification.history : null;
        const historyHasLink = Boolean(history) && history.some(holdsLink);
        if (!holdsLink(verification) && !historyHasLink) return row;
        changed = true;
        const cleaned = withoutLink(verification);
        if (historyHasLink) cleaned.history = history.map((entry) => (holdsLink(entry) ? withoutLink(entry) : entry));
        return { ...row, verification: cleaned };
    });
    return { employers: next, changed, verified };
}

async function sweep(ctx) {
    const counts = { records: 0, activityLogs: 0 };
    const writer = createWriter(ctx.db, ctx.apply);

    for (const collectionName of COLLECTIONS) {
        const finished = await forEachCompanyRecord(ctx, collectionName, ['employers'], async (doc) => {
            const { changed, verified } = stripEmployers(doc.data()?.employers);
            if (changed) {
                counts.records += 1;
                if (ctx.apply) await rewriteEmployers(ctx.db, doc.ref);
            }
            if (!verified) return;
            const logs = await doc.ref.collection('activity_logs').where('action', '==', 'PEV_REQUEST').get();
            for (const log of logs.docs) {
                const details = log.data()?.details;
                if (typeof details !== 'string' || !PORTAL_SUFFIX.test(details)) continue;
                counts.activityLogs += 1;
                await writer.update(log.ref, { details: details.replace(PORTAL_SUFFIX, '') });
            }
        });
        if (!finished) {
            await writer.flush();
            return { done: false, counts };
        }
    }
    await writer.flush();
    return { done: true, counts };
}

/** Rewrites the stored list, read again inside the transaction. */
function rewriteEmployers(db, ref) {
    return db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(ref);
        if (!fresh.exists) return;
        const { employers, changed } = stripEmployers(fresh.data()?.employers);
        if (changed) transaction.update(ref, { employers });
    });
}

module.exports = { sweep, stripEmployers, PORTAL_SUFFIX };
