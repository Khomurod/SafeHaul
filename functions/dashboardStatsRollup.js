'use strict';

/**
 * Maintains companies/{companyId}/internal_stats/dashboard for employer KPI tiles.
 * Server-only writes; clients read via rules. Counters are adjusted incrementally with
 * early exits to avoid extra writes on irrelevant application updates. The same
 * application trigger stamps the hire date, `hiredAt` (`shared/hireDate.js`).
 *
 * Increments drift: a counter that began after records existed goes below zero as
 * they are deleted, and a trigger delivered twice counts twice. So every company is
 * recounted daily (`reconcileDashboardStatsDaily`) and marked `reconciledAt`; the
 * browser trusts a counter only when it was recounted lately and none is negative,
 * and counts the records itself otherwise (`src/features/companies/hooks/dashboardQueries.js`).
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { admin, db } = require('./firebaseAdmin');
const { assertSuperAdminAuth } = require('./shared/superAdmin');
const { HIRED_STATUSES, isHiredStatus } = require('./shared/applicationStatus');
const { entersHiredStatus, recordHireDate } = require('./shared/hireDate');

const INTERNAL_STATS = 'internal_stats';
const DASHBOARD_DOC_ID = 'dashboard';

function hiredDeltaForStatusChange(beforeStatus, afterStatus) {
  return (isHiredStatus(afterStatus) ? 1 : 0) - (isHiredStatus(beforeStatus) ? 1 : 0);
}

/**
 * @param {FirebaseFirestore.DocumentSnapshot} beforeSnap
 * @param {FirebaseFirestore.DocumentSnapshot} afterSnap
 * @returns {{ applicationsTotal: number, hiredTotal: number } | null} null = no rollup write
 */
function computeApplicationRollupDeltas(beforeSnap, afterSnap) {
  const beforeExists = beforeSnap.exists;
  const afterExists = afterSnap.exists;
  const before = beforeExists ? beforeSnap.data() : null;
  const after = afterExists ? afterSnap.data() : null;

  if (!beforeExists && afterExists) {
    return {
      applicationsTotal: 1,
      hiredTotal: isHiredStatus(after.status) ? 1 : 0,
    };
  }
  if (beforeExists && !afterExists) {
    return {
      applicationsTotal: -1,
      hiredTotal: isHiredStatus(before.status) ? -1 : 0,
    };
  }
  if (beforeExists && afterExists) {
    const hd = hiredDeltaForStatusChange(before.status, after.status);
    if (hd === 0) return null;
    return { applicationsTotal: 0, hiredTotal: hd };
  }
  return null;
}

/**
 * @param {FirebaseFirestore.DocumentSnapshot} beforeSnap
 * @param {FirebaseFirestore.DocumentSnapshot} afterSnap
 * @returns {{ leadsTotal: number } | null}
 */
function computeLeadRollupDeltas(beforeSnap, afterSnap) {
  if (!beforeSnap.exists && afterSnap.exists) return { leadsTotal: 1 };
  if (beforeSnap.exists && !afterSnap.exists) return { leadsTotal: -1 };
  return null;
}

async function applyDashboardIncrements(companyId, deltas) {
  const apps = deltas.applicationsTotal || 0;
  const hired = deltas.hiredTotal || 0;
  const leads = deltas.leadsTotal || 0;
  if (apps === 0 && hired === 0 && leads === 0) return;

  const ref = db.collection('companies').doc(companyId).collection(INTERNAL_STATS).doc(DASHBOARD_DOC_ID);
  const payload = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 1,
  };
  if (apps !== 0) payload.applicationsTotal = admin.firestore.FieldValue.increment(apps);
  if (hired !== 0) payload.hiredTotal = admin.firestore.FieldValue.increment(hired);
  if (leads !== 0) payload.leadsTotal = admin.firestore.FieldValue.increment(leads);

  await ref.set(payload, { merge: true });
}

exports.onApplicationWrittenDashboardRollup = onDocumentWritten(
  {
    document: 'companies/{companyId}/applications/{applicationId}',
    region: 'us-central1',
  },
  async (event) => {
    const change = event.data;
    if (!change) return;
    const companyId = event.params.companyId;
    // The hire date (`shared/hireDate.js`), whichever path moved the status.
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    if (entersHiredStatus(before, after)) {
      try {
        await recordHireDate(change.after.ref, Date.parse(event.time));
      } catch (e) {
        console.error('[dashboardRollup] hire date not recorded:', companyId, event.params.applicationId, e?.message || e);
      }
    }
    const deltas = computeApplicationRollupDeltas(change.before, change.after);
    if (!deltas) return;
    try {
      await applyDashboardIncrements(companyId, deltas);
    } catch (e) {
      console.error('[dashboardRollup] application write failed:', companyId, e);
    }
  },
);

exports.onLeadWrittenDashboardRollup = onDocumentWritten(
  {
    document: 'companies/{companyId}/leads/{leadId}',
    region: 'us-central1',
  },
  async (event) => {
    const change = event.data;
    if (!change) return;
    const companyId = event.params.companyId;
    const deltas = computeLeadRollupDeltas(change.before, change.after);
    if (!deltas) return;
    try {
      await applyDashboardIncrements(companyId, deltas);
    } catch (e) {
      console.error('[dashboardRollup] lead write failed:', companyId, e);
    }
  },
);

/**
 * Counts a company's applications, leads and hired applications and sets them on
 * its counters, marked recounted. Returns the three counts.
 */
async function recountCompanyDashboard(companyId) {
  const base = db.collection('companies').doc(companyId);
  const appsCol = base.collection('applications');
  const leadsCol = base.collection('leads');

  const [appsSnap, leadsSnap, hiredSnap] = await Promise.all([
    appsCol.count().get(),
    leadsCol.count().get(),
    appsCol.where('status', 'in', [...HIRED_STATUSES]).count().get(),
  ]);

  const applicationsTotal = appsSnap.data().count;
  const leadsTotal = leadsSnap.data().count;
  const hiredTotal = hiredSnap.data().count;

  await base.collection(INTERNAL_STATS).doc(DASHBOARD_DOC_ID).set(
    {
      applicationsTotal,
      leadsTotal,
      hiredTotal,
      schemaVersion: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { applicationsTotal, leadsTotal, hiredTotal };
}

/**
 * Super-admin: recompute exact counts from Firestore and set internal_stats/dashboard.
 */
exports.reconcileCompanyDashboardStats = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    assertSuperAdminAuth(request.auth, 'Super admin only.');

    const companyId = request.data?.companyId;
    if (!companyId || typeof companyId !== 'string') {
      throw new HttpsError('invalid-argument', 'companyId is required.');
    }

    return { success: true, ...(await recountCompanyDashboard(companyId)) };
  },
);

/** Companies recounted at once: three count queries each. */
const RECOUNT_PARALLEL = 10;

/**
 * Every day, every company's counters are recounted. One that cannot be counted
 * is logged by id and keeps its counters, which the browser stops trusting a day
 * and a half after their last recount.
 */
exports.reconcileDashboardStatsDaily = onSchedule(
  { schedule: 'every 24 hours', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const snap = await db.collection('companies').select().get();
    const ids = snap.docs.map((doc) => doc.id);
    let failed = 0;
    for (let i = 0; i < ids.length; i += RECOUNT_PARALLEL) {
      const slice = ids.slice(i, i + RECOUNT_PARALLEL);
      const results = await Promise.allSettled(slice.map((companyId) => recountCompanyDashboard(companyId)));
      results.forEach((result, j) => {
        if (result.status === 'fulfilled') return;
        failed += 1;
        console.error(`[dashboardRollup] recount failed for ${slice[j]}:`, result.reason?.message || result.reason);
      });
    }
    console.log(`[dashboardRollup] recounted ${ids.length - failed} of ${ids.length} companies`);
  },
);

exports.computeApplicationRollupDeltas = computeApplicationRollupDeltas;
exports.computeLeadRollupDeltas = computeLeadRollupDeltas;
