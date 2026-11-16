/**
 * notifyDqExpiry.js — the bell's daily word about a hired driver's DQ deadline:
 * a hired driver whose earliest valid-until date (`dqExpiresNext`,
 * `shared/dqExpiry.js`) is today or within the next 30 days gets one notice that
 * it expires soon, and one that it expired once the date has passed, up to 30
 * days after it: an older one is not told (it stays on Needs attention), so the
 * first run does not fill the bell with stale records. In the app only: nothing
 * is emailed or texted, and the driver is not told.
 *
 * Which drivers: per company not deactivated, the applications with a hired
 * status (`HIRED_STATUSES`) whose `dqExpiresNext` is within 30 days either side
 * of today, by the UTC day as the DQ tab judges it: the query the dashboard's Needs
 * attention runs (`dashboardAttention.js`), on the applications status +
 * dqExpiresNext composite in `firestore.indexes.json`, earliest first. Leads,
 * and applications not hired, are not read.
 *
 * Once per stage and date: a notice's id is `dq_<stage>_<applicationId>_<date>`
 * (`createNotification`'s `options.id`), so a rerun, a retried run or an
 * overlapping one adds nothing. A driver first seen past the date gets only
 * "expired"; a renewal that moves the date gets notices of its own. The notices
 * already there are looked up first, so a driver already told costs one read and
 * their DQ file is read only when a notice is due.
 *
 * The notice names the driver, the documents that hold the date (the
 * application's `dq_files` not removed whose `expirationDate` it is) and the date,
 * and opens the driver's dossier. A record none of whose files holds the date
 * (its `dqExpiresNext` behind a change) gets nothing until the date is put right.
 * It goes to the driver's assignee while on the team (`assigneeOnTeam`), else to
 * the whole team.
 *
 * A run stops writing notices, and reading companies, after `RUN_BUDGET_MS`; the
 * next day's run starts one company further on (`inTurn`, as
 * `autoSendPostApplicationForms` does), passes over the drivers already told
 * and goes on, so one long company cannot keep the rest waiting. A company or a
 * driver that fails is logged and the rest go on.
 *
 * Logs carry ids, stages and counts only, never names or dates.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db } = require('./firebaseAdmin');
const { HIRED_STATUSES } = require('./shared/applicationStatus');
const { isCompanyDeactivated } = require('./shared/companyTenant');
const { createNotification } = require('./shared/createNotification');
const { calendarDay, expiryContribution } = require('./shared/dqExpiry');
const { assigneeOnTeam } = require('./shared/notificationAudience');
const { clipText } = require('./shared/plainText');

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead a date expires soon, and how long after it passed it is still told, in days: Needs attention's DQ window. */
const WINDOW_DAYS = 30;

/** How long one run writes notices, inside its 540-second timeout. */
const RUN_BUDGET_MS = 7 * 60 * 1000;

/** How many drivers' notices one read looks up. */
const LOOKUP_SIZE = 100;

const LOG = '[notifyDqExpiry]';

const STAGES = Object.freeze({
    expiring: { type: 'dq_expiring', title: 'DQ document expires soon' },
    expired: { type: 'dq_expired', title: 'DQ document expired' },
});

/** A DQ record's document by its server `type`, or the type the team chose (`fileType`, lower case). */
const DOCUMENT_NAMES = Object.freeze({
    license_front: 'CDL',
    license_back: 'CDL',
    cdl: 'CDL',
    'cdl front': 'CDL',
    'cdl back': 'CDL',
    medical_card: 'medical card',
    'medical card': 'medical card',
    twic_card: 'TWIC card',
    'twic card': 'TWIC card',
    mvr: 'MVR',
    'mvr (annual)': 'MVR',
});

const isoDay = (millis) => new Date(millis).toISOString().slice(0, 10);

/** The companies starting one further on each day, so a run cut short does not starve the last ones. */
function inTurn(docs, now) {
    if (docs.length < 2) return docs;
    const start = Math.floor(now / DAY_MS) % docs.length;
    return [...docs.slice(start), ...docs.slice(0, start)];
}

function documentName(file) {
    const chosen = typeof file.fileType === 'string' ? file.fileType.trim() : '';
    return DOCUMENT_NAMES[file.type] || DOCUMENT_NAMES[chosen.toLowerCase()]
        || clipText(chosen || file.label, 40) || 'DQ document';
}

function driverName(data) {
    return clipText(`${data.firstName || ''} ${data.lastName || ''}`, 80) || 'A hired driver';
}

/** "Dana Driver's CDL and medical card are valid until Nov 20, 2026". */
function noticeMessage(stage, data, documents, day) {
    const list = documents.length > 1
        ? `${documents.slice(0, -1).join(', ')} and ${documents.at(-1)}`
        : documents[0];
    const verb = stage === 'expired' ? (documents.length > 1 ? 'were' : 'was') : (documents.length > 1 ? 'are' : 'is');
    const date = new Date(`${day}T00:00:00Z`)
        .toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    return `${driverName(data)}'s ${list} ${verb} valid until ${date}`;
}

/** The company's hired drivers whose earliest date is due, each with the notice it is owed. */
async function dueDrivers(applications, now) {
    const today = isoDay(now);
    const due = await applications
        .where('status', 'in', [...HIRED_STATUSES])
        .where('dqExpiresNext', '>=', isoDay(now - WINDOW_DAYS * DAY_MS))
        .where('dqExpiresNext', '<=', isoDay(now + WINDOW_DAYS * DAY_MS))
        .orderBy('dqExpiresNext', 'asc')
        .select('firstName', 'lastName', 'assignedTo', 'dqExpiresNext')
        .get();
    return due.docs.flatMap((doc) => {
        const data = doc.data() || {};
        const day = calendarDay(data.dqExpiresNext);
        if (day !== data.dqExpiresNext) return [];
        const stage = day < today ? 'expired' : 'expiring';
        return [{ id: doc.id, ref: doc.ref, data, day, stage, noticeId: `dq_${stage}_${doc.id}_${day}` }];
    });
}

/** Writes one driver's notice: its stage, or why none was written. */
async function notifyDriver(companyId, driver, recipientFor) {
    const files = await driver.ref.collection('dq_files').get();
    const documents = [...new Set(files.docs
        .map((doc) => doc.data() || {})
        .filter((file) => expiryContribution(file) === driver.day)
        .map(documentName))]
        .sort((a, b) => a.localeCompare(b));
    if (documents.length === 0) return 'stale';

    const recipientId = await recipientFor(driver.data.assignedTo);
    const { type, title } = STAGES[driver.stage];
    const created = await createNotification(db, companyId, {
        type,
        title,
        message: noticeMessage(driver.stage, driver.data, documents, driver.day),
        relatedType: 'application',
        relatedId: driver.id,
        ...(recipientId && { recipientId }),
    }, { id: driver.noticeId });
    return created ? driver.stage : 'told';
}

/** Tells a company's due drivers not yet told; false once the run is out of time. */
async function notifyCompany(companyId, now, stopAt, counts) {
    const company = db.collection('companies').doc(companyId);
    const notices = company.collection('notifications');
    const drivers = await dueDrivers(company.collection('applications'), now);
    // One team read per assignee, and only for a notice that is written.
    const recipients = new Map();
    const recipientFor = (assignedTo) => {
        if (!recipients.has(assignedTo)) recipients.set(assignedTo, assigneeOnTeam(db, companyId, assignedTo));
        return recipients.get(assignedTo);
    };

    for (let start = 0; start < drivers.length; start += LOOKUP_SIZE) {
        if (Date.now() >= stopAt) return false;
        const batch = drivers.slice(start, start + LOOKUP_SIZE);
        const existing = await db.getAll(...batch.map((driver) => notices.doc(driver.noticeId)));
        for (const [index, driver] of batch.entries()) {
            if (existing[index].exists) {
                counts.told += 1;
                continue;
            }
            if (Date.now() >= stopAt) return false;
            try {
                const outcome = await notifyDriver(companyId, driver, recipientFor);
                counts[outcome] += 1;
                if (outcome === driver.stage) {
                    console.log(`${LOG} companyId=${companyId} applicationId=${driver.id} stage=${outcome}`);
                }
            } catch (error) {
                // Nothing was written: the next run tries again.
                counts.errors += 1;
                console.error(`${LOG} companyId=${companyId} applicationId=${driver.id} not told: ${error?.code ?? 'error'}`);
            }
        }
    }
    return true;
}

exports.notifyDqExpiry = onSchedule({
    // 08:00 Eastern, 05:00 Pacific: in the bell for the start of the US working
    // day, when the UTC day the dates are judged by is the US one.
    schedule: '0 7 * * *',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    timeoutSeconds: 540,
}, async () => {
    const now = Date.now();
    const stopAt = now + RUN_BUDGET_MS;
    const counts = { companies: 0, expiring: 0, expired: 0, told: 0, stale: 0, errors: 0 };
    let finished = true;

    const companies = await db.collection('companies').select('isActive', 'status').get();
    for (const company of inTurn(companies.docs, now)) {
        if (Date.now() >= stopAt) {
            finished = false;
            break;
        }
        if (isCompanyDeactivated(company.data() || {})) continue;
        counts.companies += 1;
        try {
            finished = await notifyCompany(company.id, now, stopAt, counts);
        } catch (error) {
            counts.errors += 1;
            console.error(`${LOG} companyId=${company.id} stopped: ${error?.code ?? 'error'}`);
        }
        if (!finished) break;
    }

    console.log(`${LOG} companies=${counts.companies} expiring=${counts.expiring} expired=${counts.expired}`
        + ` alreadyTold=${counts.told} stale=${counts.stale} errors=${counts.errors}`
        + `${finished ? '' : '; out of time, the next run tells the rest'}`);
});
