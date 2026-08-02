/**
 * Super Admin tooling: list tenants, delete sandbox test apps, transfer SANDBOX -> real company.
 */

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');

const SANDBOX_ID = 'SANDBOX';
const INACTIVE_STATUSES = ['inactive', 'suspended', 'disabled'];

function assertSuperAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const token = context.auth.token || {};
  const gr = token.globalRole || (token.roles && token.roles.globalRole);
  if (gr !== 'super_admin') {
    throw new functions.https.HttpsError('permission-denied', 'Super Admin only.');
  }
}

function isTenantEligible(docId, data) {
  if (!data || docId === SANDBOX_ID) return false;
  if (data.isActive === false) return false;
  const st = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  if (st !== '' && INACTIVE_STATUSES.includes(st)) return false;
  return true;
}

exports.listSandboxTenantCompanies = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (_data, context) => {
    assertSuperAdmin(context);
    const snap = await db.collection('companies').limit(500).get();
    const companies = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (!isTenantEligible(doc.id, d)) return;
      companies.push({
        id: doc.id,
        companyName: d.companyName || doc.id,
        isActive: d.isActive !== false,
      });
    });
    companies.sort((a, b) => String(a.companyName || '').localeCompare(String(b.companyName || '')));
    return { companies };
  });

exports.deleteSandboxApplication = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (data, context) => {
    assertSuperAdmin(context);
    const applicationId = data?.applicationId;
    if (!applicationId || typeof applicationId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'applicationId required.');
    }
    const ref = db.collection('companies').doc(SANDBOX_ID).collection('applications').doc(applicationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Application not found.');
    }
    const d = snap.data() || {};
    if (d.companyId !== SANDBOX_ID) {
      throw new functions.https.HttpsError('failed-precondition', 'Not a sandbox application.');
    }
    await db.recursiveDelete(ref);
    return { success: true };
  });

exports.transferSandboxApplication = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    assertSuperAdmin(context);
    const applicationId = data?.applicationId;
    const targetCompanyId = data?.targetCompanyId;
    if (!applicationId || typeof applicationId !== 'string' || !targetCompanyId || typeof targetCompanyId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'applicationId and targetCompanyId required.');
    }
    if (targetCompanyId === SANDBOX_ID) {
      throw new functions.https.HttpsError('invalid-argument', 'Choose a real tenant company.');
    }

    const target = await assertCompanyAcceptingIntake(db, targetCompanyId);
    const sourceRef = db.collection('companies').doc(SANDBOX_ID).collection('applications').doc(applicationId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Application not found.');
    }
    const payload = sourceSnap.data() || {};
    if (payload.companyId !== SANDBOX_ID) {
      throw new functions.https.HttpsError('failed-precondition', 'Not a sandbox application.');
    }

    const destRef = db.collection('companies').doc(targetCompanyId).collection('applications').doc(applicationId);
    const destSnap = await destRef.get();
    if (destSnap.exists) {
      throw new functions.https.HttpsError(
        'already-exists',
        'An application with this id already exists under the target company.'
      );
    }

    const companyName = target.companyName || targetCompanyId;
    const moved = {
      ...payload,
      companyId: targetCompanyId,
      companyName,
      status: 'New Application',
      transferredFromSandboxAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await destRef.set(moved);
    await db.recursiveDelete(sourceRef);

    return { success: true, companyId: targetCompanyId, companyName, applicationId };
  });
