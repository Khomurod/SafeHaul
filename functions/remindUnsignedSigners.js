/**
 * remindUnsignedSigners.js — the automatic reminder: once a day, a document
 * still waiting for its signature three days after it was sent gets one
 * reminder, sent by the same rules as Remind (`shared/signerReminder.js`):
 * the channels it was sent by, a text to an application's driver only after
 * their "Yes", never to an opted-out number, the same link with seven more
 * days, recorded in `reminders` with `lastBy` the system (`AUTO_REMINDER_ACTOR`).
 *
 * Which documents: per company, `status == 'sent'` made 3 to 7 days ago
 * (`createdAt`, the `signing_requests` status + createdAt composite in
 * `firestore.indexes.json`), while the link it was sent with still works; a
 * missed run is caught up within the week. A company that turned E-Docs off
 * (`features.eDocs === false`) or that Super Admin deactivated is not read.
 *
 * Once per document: one transaction claims the reminder (`autoReminder:
 * { sentAt }`) with the `reminders` record before anything is sent, so a rerun,
 * a duplicate invocation or an overlapping run finds it claimed and sends
 * nothing. After the sends it records `autoReminder.outcome`: `sent` when the
 * link reached the signer by one channel at least, else `failed`, whose reason
 * the document shows as for Remind (`emailError`, `smsError`); a failed one does
 * not count in `reminders` and is not tried again (Remind still may).
 *
 * Not now, maybe later: a document whose signer got a message about it in the
 * last day (Remind, a correction's new link, Send to driver) waits a day; one
 * with no channel to send by (a copied link, a text-only document whose driver
 * did not answer Yes) or no link is refused by the shared rules. Neither is
 * marked: each run looks again while the document is in its window, since a
 * correction may give it a channel. A run stops starting reminders after
 * `RUN_BUDGET_MS`; the rest go on the next run.
 *
 * Logs carry ids and counts only, never tokens, addresses or numbers.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db } = require('./firebaseAdmin');
const { isCompanyDeactivated } = require('./shared/companyTenant');
const { claimReminder, deliverReminder, isRefusal, millisOf } = require('./shared/signerReminder');

const DAY_MS = 24 * 60 * 60 * 1000;

/** How old a document is when it is reminded, in days since it was sent. */
const WINDOW_DAYS = Object.freeze({ from: 3, to: 7 });

/** A message to the signer this recent holds the reminder a day. */
const RECENT_MESSAGE_MS = DAY_MS;

/** Who `reminders.lastBy` names for an automatic reminder: not a user. */
const AUTO_REMINDER_ACTOR = 'system:auto-reminder';

/** How long one run starts reminders, inside its 540-second timeout. */
const RUN_BUDGET_MS = 7 * 60 * 1000;

const LOG = '[remindUnsignedSigners]';

/** When the signer last got a message about request `data`: a reminder, an email or a text. */
function lastMessageAt(data) {
    const emailed = typeof data.emailSentAt === 'string' ? Date.parse(data.emailSentAt) : millisOf(data.emailSentAt);
    const times = [millisOf(data.reminders?.lastAt), millisOf(data.smsSentAt), emailed]
        .filter((time) => Number.isFinite(time));
    return times.length ? Math.max(...times) : null;
}

/** Why request `data` gets no automatic reminder now, or null when it may. */
function holdOf(data, now) {
    if (data.autoReminder) return 'done';
    const last = lastMessageAt(data);
    if (last !== null && now - last < RECENT_MESSAGE_MS) return 'recent';
    return null;
}

/** Claims request `ref`'s automatic reminder: `{ claimed }`, or `{ skipped: why }` with nothing written. */
async function claimAutoReminder(companyRef, ref) {
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) return { skipped: 'gone' };
            const data = snap.data() || {};
            const hold = holdOf(data, Date.now());
            if (hold) return { skipped: hold };
            const claimed = await claimReminder(tx, {
                companyRef,
                ref,
                data,
                by: AUTO_REMINDER_ACTOR,
                record: { autoReminder: { sentAt: admin.firestore.Timestamp.now() } },
            });
            return { claimed };
        });
    } catch (error) {
        // Refused inside the transaction, so nothing it wrote is kept.
        if (isRefusal(error)) return { skipped: error.details?.reason || 'refused' };
        throw error;
    }
}

/** Sends one claimed reminder and records how it went. */
async function sendAutoReminder(companyId, ref, claimed, counts) {
    const requestId = ref.id;
    const { went } = await deliverReminder({ companyId, requestId, ref, claimed, logTag: 'remindUnsignedSigners' });
    const outcome = went.email || went.sms ? 'sent' : 'failed';
    await ref.update({ 'autoReminder.outcome': outcome });
    counts[outcome] += 1;
    console.log(`${LOG} companyId=${companyId} requestId=${requestId} outcome=${outcome} email=${went.email} sms=${went.sms}`);
}

/** Reminds a company's documents in their window; false once the run is out of time. */
async function remindCompany(companyId, now, stopAt, counts) {
    const companyRef = db.collection('companies').doc(companyId);
    const due = await companyRef.collection('signing_requests')
        .where('status', '==', 'sent')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(now - WINDOW_DAYS.to * DAY_MS))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(now - WINDOW_DAYS.from * DAY_MS))
        .orderBy('createdAt', 'desc')
        // References only: each document is read, and judged, in its own transaction.
        .select()
        .get();

    for (const doc of due.docs) {
        if (Date.now() >= stopAt) return false;
        try {
            const { claimed, skipped } = await claimAutoReminder(companyRef, doc.ref);
            if (skipped) {
                counts.skipped[skipped] = (counts.skipped[skipped] || 0) + 1;
                continue;
            }
            await sendAutoReminder(companyId, doc.ref, claimed, counts);
        } catch (error) {
            // Before the claim, the next run tries again; after it, the claim stands and nothing is sent again.
            counts.errors += 1;
            console.error(`${LOG} companyId=${companyId} requestId=${doc.id} stopped: ${error?.code ?? 'error'}`);
        }
    }
    return true;
}

exports.remindUnsignedSigners = onSchedule({
    // Daytime across the US, so a reminder text never arrives at night.
    schedule: '0 11 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 540,
    // The secret decrypts an SMTP password stored encrypted (emailService.js) and the SMS line's credentials.
    secrets: ['SMS_ENCRYPTION_KEY'],
}, async () => {
    const now = Date.now();
    const stopAt = now + RUN_BUDGET_MS;
    const counts = { companies: 0, sent: 0, failed: 0, errors: 0, skipped: {} };
    let finished = true;

    const companies = await db.collection('companies').select('features', 'isActive', 'status').get();
    for (const company of companies.docs) {
        const data = company.data() || {};
        if (data.features?.eDocs === false || isCompanyDeactivated(data)) continue;
        counts.companies += 1;
        try {
            finished = await remindCompany(company.id, now, stopAt, counts);
        } catch (error) {
            counts.errors += 1;
            console.error(`${LOG} companyId=${company.id} documents not read: ${error?.code ?? 'error'}`);
        }
        if (!finished) break;
    }

    const skipped = Object.entries(counts.skipped).map(([why, count]) => `${why}=${count}`).join(' ') || 'none';
    console.log(`${LOG} companies=${counts.companies} sent=${counts.sent} failed=${counts.failed} errors=${counts.errors}`
        + ` skipped: ${skipped}${finished ? '' : '; out of time, the next run sends the rest'}`);
});

exports.AUTO_REMINDER_ACTOR = AUTO_REMINDER_ACTOR;
