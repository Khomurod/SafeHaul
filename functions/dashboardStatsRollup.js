'use strict';

/**
 * Maintains companies/{companyId}/internal_stats/dashboard for employer KPI tiles.
 * Server-only writes; clients read via rules. Counters are adjusted incrementally with
 * early exits to avoid extra writes on irrelevant application updates.
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');

const INTERNAL_STATS = 'internal_stats';
const DASHBOARD_DOC_ID = 'dashboard';

function isHiredStatus(status) {
  return status === 'Hired' || status === 'Approved';
}

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

function hasSuperAdminRole(claims = {}) {
  const globalRole = claims.globalRole || claims.roles?.globalRole;
  return globalRole === 'super_admin';
}

/**
 * Super-admin: recompute exact counts from Firestore and set internal_stats/dashboard.
 */
exports.reconcileCompanyDashboardStats = onCall(
  { cors: true, region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    if (!hasSuperAdminRole(request.auth.token)) {
      throw new HttpsError('permission-denied', 'Super admin only.');
    }

    const companyId = request.data?.companyId;
    if (!companyId || typeof companyId !== 'string') {
      throw new HttpsError('invalid-argument', 'companyId is required.');
    }

    const base = db.collection('companies').doc(companyId);
    const appsCol = base.collection('applications');
    const leadsCol = base.collection('leads');

    const [appsSnap, leadsSnap, hiredSnap] = await Promise.all([
      appsCol.count().get(),
      leadsCol.count().get(),
      appsCol.where('status', 'in', ['Hired', 'Approved']).count().get(),
    ]);

    const applicationsTotal = appsSnap.data().count;
    const leadsTotal = leadsSnap.data().count;
    const hiredTotal = hiredSnap.data().count;

    const ref = base.collection(INTERNAL_STATS).doc(DASHBOARD_DOC_ID);
    await ref.set(
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

    return { success: true, applicationsTotal, leadsTotal, hiredTotal };
  },
);

exports.computeApplicationRollupDeltas = computeApplicationRollupDeltas;
exports.computeLeadRollupDeltas = computeLeadRollupDeltas;
